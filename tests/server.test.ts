import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RunningServer, startServer } from '../server/app';
import { LIVERIES } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { CarBuild, generateBuild } from '../src/game/build';
import { Profile, STARTING_MONEY, entryFee, hireDriver, newProfile, prizeMoney } from '../src/game/profile';
import { sessionFromSetup } from '../src/net/onlineRace';
import type { ClientMessage, GameRules, ServerMessage } from '../src/net/protocol';
import { DriverDef, SKILLS, Skill } from '../src/sim/driver';
import { Rng } from '../src/sim/rng';
import { applySnapshot } from '../src/sim/snapshot';

type Of<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

const look = { sex: 0, skin: 0, hair: 1, hairColor: 0, beard: 0, helmet: 0, suit: 0, age: 1, face: 0, eyes: 0, glasses: 0, hat: 0 };

function driver(id: string, name: string): DriverDef {
  const skills = {} as Record<Skill, number>;
  SKILLS.forEach((s, i) => (skills[s] = i < 4 ? 9 : 8));
  // Full discipline: orders are obeyed, and quickly.
  skills.discipline = 20;
  skills.reaction = 1;
  skills.anticipation = 5;
  return { id, name, code: '', nationality: 'GBR', skills, aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0 };
}

/** A small team with one legal car and one signed driver. */
function team(seed: number, driverName: string): Profile {
  const p = newProfile();
  const car = generateBuild(new Rng(seed), 3, { ...LIVERIES[seed % LIVERIES.length] }, `car-${seed}`);
  p.cars.push(car);
  p.selectedCar = car.id;
  const hired = hireDriver(p, driver(`drv-${seed}`, driverName), look);
  if (!hired.ok) throw new Error(hired.reason);
  return p;
}

/** A WebSocket client that keeps everything it is told. */
class Player {
  readonly inbox: ServerMessage[] = [];
  private ws!: WebSocket;
  private waiting: (() => void)[] = [];
  closed = false;

  constructor(private readonly url: string, readonly token: string) {}

  async connect(auth = true): Promise<this> {
    this.closed = false;
    this.ws = new WebSocket(this.url);
    this.ws.addEventListener('message', (e) => {
      this.inbox.push(JSON.parse(String(e.data)) as ServerMessage);
      this.waiting.splice(0).forEach((wake) => wake());
    });
    this.ws.addEventListener('close', () => {
      this.closed = true;
      this.waiting.splice(0).forEach((wake) => wake());
    });
    await new Promise<void>((open, fail) => {
      this.ws.addEventListener('open', () => open());
      this.ws.addEventListener('error', () => fail(new Error('socket error')));
    });
    if (auth) {
      this.send({ t: 'auth', token: this.token });
      await this.next('hello');
    }
    return this;
  }

  send(msg: ClientMessage | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  raw(text: string): void {
    this.ws.send(text);
  }

  /** The first message of a type that passes the test, taken out of the inbox; waits for it if need be. */
  async next<T extends ServerMessage['t']>(type: T, test: (m: Of<T>) => boolean = () => true, ms = 8000): Promise<Of<T>> {
    const until = Date.now() + ms;
    for (;;) {
      const i = this.inbox.findIndex((m) => m.t === type && test(m as Of<T>));
      if (i >= 0) return this.inbox.splice(i, 1)[0] as Of<T>;
      const left = until - Date.now();
      if (left <= 0 || this.closed) throw new Error(`No "${type}" message arrived (${this.closed ? 'socket closed' : 'timeout'})`);
      await new Promise<void>((wake) => {
        const timer = setTimeout(wake, left);
        this.waiting.push(() => {
          clearTimeout(timer);
          wake();
        });
      });
    }
  }

  has(type: ServerMessage['t']): boolean {
    return this.inbox.some((m) => m.t === type);
  }

  clear(): void {
    this.inbox.length = 0;
  }

  close(): void {
    this.ws.close();
  }
}

const pause = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const RULES: GameRules = { trackId: BRANDS_HATCH_INDY.id, laps: 1, grid: 3, humans: 2, wearScale: 1, hazards: 0, weather: 'clear' };

describe('Game server', () => {
  let server: RunningServer;
  let dataDir: string;
  let http: string;
  let ws: string;

  const call = async (method: string, path: string, body?: unknown, token?: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`${http}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const account = async (name: string): Promise<string> => {
    const res = await call('POST', '/api/register', { name, password: 'correct horse' });
    expect(res.status).toBe(200);
    return res.body.token as string;
  };

  /** A signed-in, connected player whose team is saved on the server. */
  const player = async (name: string, seed: number): Promise<{ p: Player; profile: Profile; car: CarBuild; driver: DriverDef }> => {
    const token = await account(name);
    const profile = team(seed, `${name} Driver`);
    expect((await call('PUT', '/api/profile', { profile }, token)).status).toBe(200);
    const p = await new Player(ws, token).connect();
    return { p, profile, car: profile.cars[0], driver: profile.drivers[0].def };
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'miniracer-test-'));
    // Tests only: thirty simulated seconds per real second, and a short roll-on after the flag.
    server = await startServer({ port: 0, host: '127.0.0.1', dataDir, simSpeed: 30, cooldown: 0.3, authAttempts: 1000 });
    http = `http://127.0.0.1:${server.port}`;
    ws = `ws://127.0.0.1:${server.port}/ws`;
  });

  afterAll(async () => {
    await server.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('accounts', () => {
    it('registers, signs in and refuses a wrong password', async () => {
      const made = await call('POST', '/api/register', { name: 'Alice_1', password: 'correct horse' });
      expect(made.status).toBe(200);
      expect(made.body.name).toBe('Alice_1');
      expect(made.body.token).toMatch(/^[0-9a-f]{64}$/);
      expect((await call('GET', '/api/me', undefined, made.body.token as string)).body.name).toBe('Alice_1');

      // The name is not case sensitive; the password is.
      const again = await call('POST', '/api/login', { name: 'alice_1', password: 'correct horse' });
      expect(again.status).toBe(200);
      expect(again.body.name).toBe('Alice_1');
      expect(again.body.token).not.toBe(made.body.token);

      const wrong = await call('POST', '/api/login', { name: 'Alice_1', password: 'Correct horse' });
      expect(wrong.status).toBe(401);
      expect(wrong.body.token).toBeUndefined();
      const nobody = await call('POST', '/api/login', { name: 'nobody', password: 'correct horse' });
      expect(nobody.status).toBe(401);
      expect(nobody.body.error).toBe(wrong.body.error);
    });

    it('refuses a name that is taken, whatever its case', async () => {
      await account('Taken');
      expect((await call('POST', '/api/register', { name: 'Taken', password: 'another password' })).status).toBe(409);
      expect((await call('POST', '/api/register', { name: 'TAKEN', password: 'another password' })).status).toBe(409);
    });

    it('validates names, passwords and request bodies', async () => {
      for (const name of ['ab', 'a'.repeat(21), 'has space', 'semi;colon', '../etc', '', 42, null]) {
        expect((await call('POST', '/api/register', { name, password: 'long enough' })).status, String(name)).toBe(400);
      }
      for (const password of ['short', 'x'.repeat(101), '', 12345678, null]) {
        expect((await call('POST', '/api/register', { name: 'Fine_name', password })).status, String(password)).toBe(400);
      }
      expect((await call('POST', '/api/register', '{not json')).status).toBe(400);
      expect((await call('POST', '/api/register', { name: 'Big', password: 'x'.repeat(8000) })).status).toBe(413);
      expect((await call('GET', '/api/nothing')).status).toBe(404);
      expect((await call('GET', '/api/health')).body.ok).toBe(true);
    });

    it('never stores a password or a token in the clear', async () => {
      const token = await account('Secretive');
      const files = [join(dataDir, 'sessions.json'), ...readdirSync(join(dataDir, 'users')).map((f) => join(dataDir, 'users', f))];
      const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
      expect(all).toContain('Secretive');
      expect(all).not.toContain('correct horse');
      expect(all).not.toContain(token);
    });

    it('signs out', async () => {
      const token = await account('Leaver');
      expect((await call('POST', '/api/logout', undefined, token)).status).toBe(200);
      expect((await call('GET', '/api/me', undefined, token)).status).toBe(401);
      expect((await call('GET', '/api/me', undefined, 'f'.repeat(64))).status).toBe(401);
      expect((await call('GET', '/api/me')).status).toBe(401);
    });

    it('limits sign-in attempts per address', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'miniracer-test-'));
      const strict = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, authAttempts: 3 });
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 5; i++) {
          const res = await fetch(`http://127.0.0.1:${strict.port}/api/login`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'someone', password: `guess number ${i}` }),
          });
          statuses.push(res.status);
        }
        expect(statuses).toEqual([401, 401, 401, 429, 429]);
      } finally {
        await strict.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('saved team', () => {
    it('saves a team and gives it back, without the photos', async () => {
      const token = await account('Keeper');
      expect((await call('GET', '/api/profile', undefined, token)).body).toEqual({ profile: null, rev: 0 });
      const profile = team(3, 'Kim Keeper');
      profile.money = 123456;
      profile.photos.push({ id: 'ph-1', kind: 'team', data: `data:image/jpeg;base64,${'A'.repeat(50000)}`, caption: 'x', date: 1 });
      const saved = await call('PUT', '/api/profile', { profile }, token);
      expect(saved.body).toEqual({ ok: true, rev: 1 });
      const back = await call('GET', '/api/profile', undefined, token);
      expect(back.body.rev).toBe(1);
      expect(back.body.profile).toEqual({ ...JSON.parse(JSON.stringify(profile)), photos: [] });
      expect((await call('PUT', '/api/profile', { profile }, token)).body.rev).toBe(2);
      // An upload made against an older revision is refused; one against the current one goes in.
      expect((await call('PUT', '/api/profile', { profile, base: 1 }, token)).status).toBe(409);
      expect((await call('PUT', '/api/profile', { profile, base: 2 }, token)).body.rev).toBe(3);
      // Test mode never reaches the stored team.
      await call('PUT', '/api/profile', { profile: { ...profile, admin: true } }, token);
      expect(((await call('GET', '/api/profile', undefined, token)).body.profile as Profile).admin).toBe(false);
    });

    it('refuses teams from strangers, junk and oversized uploads', async () => {
      const token = await account('Careful');
      const profile = team(4, 'Cara Careful');
      expect((await call('PUT', '/api/profile', { profile })).status).toBe(401);
      expect((await call('GET', '/api/profile')).status).toBe(401);
      expect((await call('PUT', '/api/profile', { profile: { version: 2 } }, token)).status).toBe(400);
      expect((await call('PUT', '/api/profile', { profile: 'nope' }, token)).status).toBe(400);
      expect((await call('PUT', '/api/profile', { profile: { ...profile, money: 'lots' } }, token)).status).toBe(400);
      const fat = { ...profile, history: Array.from({ length: 150 }, () => ({ car: 'x'.repeat(3000) })) };
      expect((await call('PUT', '/api/profile', { profile: fat }, token)).status).toBe(413);
      expect((await call('GET', '/api/profile', undefined, token)).body.profile).toBeNull();
    });

    it('keeps each account to its own team', async () => {
      const a = await account('Owner_A');
      const b = await account('Owner_B');
      await call('PUT', '/api/profile', { profile: team(5, 'Ann A') }, a);
      expect((await call('GET', '/api/profile', undefined, b)).body.profile).toBeNull();
    });
  });

  describe('lobby', () => {
    it('needs a valid token before anything else', async () => {
      const stranger = await new Player(ws, 'f'.repeat(64)).connect(false);
      stranger.send({ t: 'list' });
      expect((await stranger.next('error')).message).toMatch(/sign in/i);
      stranger.send({ t: 'auth', token: stranger.token });
      await stranger.next('error');
      await pause(100);
      expect(stranger.closed).toBe(true);
    });

    it('lists games, seats a second player and frees the seat when they drop', async () => {
      const a = await player('Host_1', 11);
      const b = await player('Guest_1', 12);
      a.p.send({ t: 'create', ...RULES, grid: 8, humans: 3 });
      const room = (await a.p.next('room')).room;
      expect(room?.host).toBe('Host_1');
      expect(room?.seats.map((s) => s?.name ?? null)).toEqual(['Host_1', null, null]);

      const listed = (await b.p.next('games', (m) => m.games.some((g) => g.id === room?.id))).games.find((g) => g.id === room?.id);
      expect(listed).toMatchObject({ host: 'Host_1', grid: 8, humans: 3, filled: 1, trackId: BRANDS_HATCH_INDY.id, laps: 1 });

      b.p.send({ t: 'join', game: room?.id ?? '' });
      expect((await a.p.next('room', (m) => m.room?.seats[1] !== null)).room?.seats[1]).toMatchObject({ name: 'Guest_1', ready: false, car: null });
      b.p.send({ t: 'entry', car: b.car, driver: b.driver });
      expect((await a.p.next('room', (m) => !!m.room?.seats[1]?.car)).room?.seats[1]?.driver).toBe('Guest_1 Driver');

      // The guest's connection drops: the seat opens again and the list says so.
      b.p.close();
      expect((await a.p.next('room', (m) => m.room?.seats[1] === null)).room?.seats.filter(Boolean).length).toBe(1);
      a.p.send({ t: 'list' });
      expect((await a.p.next('games', (m) => m.games.find((g) => g.id === room?.id)?.filled === 1)).games.length).toBeGreaterThan(0);

      // The host leaves: the game closes.
      a.p.clear();
      a.p.send({ t: 'leave' });
      expect((await a.p.next('room')).room).toBeNull();
      // Older lists may still be on their way; the server must end up announcing one without the game.
      await a.p.next('games', (m) => !m.games.some((g) => g.id === room?.id));
      a.p.close();
    });

    it('passes the host on when the host leaves', async () => {
      const a = await player('Host_2', 13);
      const b = await player('Guest_2', 14);
      a.p.send({ t: 'create', ...RULES, humans: 2 });
      const id = (await a.p.next('room')).room?.id ?? '';
      b.p.send({ t: 'join', game: id });
      await b.p.next('room');
      a.p.send({ t: 'leave' });
      const room = (await b.p.next('room', (m) => m.room?.host === 'Guest_2')).room;
      expect(room?.seats.map((s) => s?.name ?? null)).toEqual([null, 'Guest_2']);
      b.p.send({ t: 'leave' });
      a.p.close();
      b.p.close();
    });

    it('refuses bad rules, illegal cars and over-skilled drivers', async () => {
      const a = await player('Host_3', 15);
      for (const bad of [{ trackId: 'nowhere' }, { grid: 13 }, { grid: 1 }, { humans: 4 }, { humans: 0 }, { laps: 0 }, { laps: 1.5 }, { weather: 'fog' }, { hazards: -1 }, { wearScale: 1000 }]) {
        a.p.send({ t: 'create', ...RULES, ...bad });
        await a.p.next('error');
      }
      expect(a.p.has('room')).toBe(false);
      a.p.send({ t: 'create', ...RULES });
      await a.p.next('room');

      a.p.send({ t: 'ready', ready: true });
      expect((await a.p.next('error')).message).toMatch(/car and a driver/i);

      const stripped: CarBuild = { ...a.car, parts: { chassis: a.car.parts.chassis } };
      a.p.send({ t: 'entry', car: stripped, driver: a.driver });
      expect((await a.p.next('error')).message).toMatch(/not race legal/i);
      a.p.send({ t: 'entry', car: { ...a.car, parts: 'all of them' }, driver: a.driver });
      await a.p.next('error');
      a.p.send({ t: 'entry', car: { ...a.car, ecu: { ign: 'x' } }, driver: a.driver });
      await a.p.next('error');

      const superhuman = { ...a.driver, skills: { ...a.driver.skills, cornering: 20, braking: 20, carControl: 20, racecraft: 20 } };
      a.p.send({ t: 'entry', car: a.car, driver: superhuman });
      expect((await a.p.next('error')).message).toMatch(/driver/i);
      a.p.send({ t: 'entry', car: a.car, driver: { ...a.driver, weight: NaN } });
      await a.p.next('error');

      // Junk on the wire is ignored without ending the connection.
      a.p.raw('not json at all');
      a.p.raw('[1,2,3]');
      a.p.send({ t: 'bogus' });
      await a.p.next('error');
      a.p.clear();
      a.p.send({ t: 'entry', car: a.car, driver: a.driver });
      expect((await a.p.next('room')).room?.seats[0]?.car).toBeTruthy();
      a.p.send({ t: 'leave' });
      a.p.close();
    });
  });

  describe('racing', () => {
    it('starts when both players are ready, runs to the flag and pays the prize', async () => {
      const a = await player('Racer_A', 21);
      const b = await player('Racer_B', 22);
      a.p.send({ t: 'create', ...RULES });
      const id = (await a.p.next('room')).room?.id ?? '';
      b.p.send({ t: 'join', game: id });
      await b.p.next('room');
      a.p.send({ t: 'entry', car: a.car, driver: a.driver });
      b.p.send({ t: 'entry', car: b.car, driver: b.driver, pitMode: 'manual' });
      a.p.send({ t: 'ready', ready: true });
      await a.p.next('room', (m) => m.room?.seats[0]?.ready === true);
      await pause(150);
      expect(a.p.has('race')).toBe(false);
      b.p.send({ t: 'ready', ready: true });

      const startA = await a.p.next('race');
      const startB = await b.p.next('race');
      expect(startA.resumed).toBe(false);
      expect(startA.setup).toEqual(startB.setup);
      expect(startA.setup.entrants.length).toBe(3);
      expect(startA.setup.entrants.filter((e) => e.owner).map((e) => e.owner).sort()).toEqual(['Racer_A', 'Racer_B']);
      expect(startA.setup.entrants[startA.you].owner).toBe('Racer_A');
      expect(startB.setup.entrants[startB.you].owner).toBe('Racer_B');
      expect(startA.you).not.toBe(startB.you);
      expect(startA.fee).toBe(entryFee(BRANDS_HATCH_INDY));
      // The game is no longer on offer.
      a.p.send({ t: 'list' });
      expect((await a.p.next('games')).games.some((g) => g.id === id)).toBe(false);

      // Each client builds the same race and only ever fills it from snapshots.
      const session = sessionFromSetup(startA.setup, startA.you);
      if (!session) throw new Error('no session');
      const race = session.race;
      const grid = race.cars.map((c) => ({ x: c.state.x, y: c.state.y }));
      const follow = async (until: () => boolean, ms = 20000): Promise<void> => {
        const end = Date.now() + ms;
        while (!until()) {
          if (Date.now() > end) throw new Error('The race did not get there in time');
          applySnapshot(race, (await a.p.next('snap')).s);
        }
      };

      await follow(() => race.phase === 'racing' && race.time > 4);
      race.cars.forEach((c, i) => {
        expect(Math.hypot(c.state.x - grid[i].x, c.state.y - grid[i].y)).toBeGreaterThan(20);
        expect(Math.hypot(c.state.vx, c.state.vy)).toBeGreaterThan(10);
      });
      expect(race.events.some((e) => e.type === 'green')).toBe(true);
      expect(race.cars[startB.you].pitMode).toBe('manual');

      // An order from A reaches A's car and nobody else's.
      expect(race.cars.map((c) => c.pace)).toEqual([0, 0, 0]);
      a.p.send({ t: 'cmd', command: 'push' });
      await follow(() => race.cars[startA.you].pace === 1);
      expect(race.cars.map((c) => c.pace)).toEqual(race.cars.map((_, i) => (i === startA.you ? 1 : 0)));
      expect(race.events.filter((e) => e.type === 'radio')).toEqual([{ type: 'radio', car: startA.you, command: 'push', obeyed: true }]);

      // B cannot give orders to A's car, or to a bot.
      const bot = startA.setup.entrants.findIndex((e) => !e.owner);
      b.p.send({ t: 'cmd', command: 'save', car: startA.you });
      expect((await b.p.next('error')).message).toMatch(/own car/i);
      b.p.send({ t: 'cmd', command: 'hold', car: bot });
      await b.p.next('error');
      b.p.send({ t: 'cmd', command: 'explode' });
      await b.p.next('error');
      b.p.send({ t: 'cmd', command: 'hold' });
      await follow(() => race.cars[startB.you].stance === -1);
      expect(race.cars[startA.you].pace).toBe(1);
      expect(race.cars[startA.you].stance).toBe(0);
      expect(race.cars[bot].pace).toBe(0);
      expect(race.cars[bot].stance).toBe(0);
      expect(race.cars[startB.you].pace).toBe(0);

      // B's connection drops mid-race: the car races on, and B gets back in with the same token.
      b.p.close();
      await follow(() => race.time > 14);
      const back = await new Player(ws, b.p.token).connect();
      const resumed = await back.next('race');
      expect(resumed.resumed).toBe(true);
      expect(resumed.you).toBe(startB.you);
      expect(resumed.fee).toBe(0);
      expect(resumed.setup).toEqual(startA.setup);
      // The first snapshot after coming back carries everything.
      const first = (await back.next('snap')).s;
      expect(first.s).toBeDefined();
      back.send({ t: 'cmd', command: 'attack' });
      await follow(() => race.cars[startB.you].stance === 1);

      // To the flag.
      await follow(() => race.phase === 'finished', 60000);
      expect(race.events.some((e) => e.type === 'end')).toBe(true);
      expect(race.order.every((c) => c.finished || c.retired)).toBe(true);
      const mine = race.cars[startA.you];
      expect(mine.finished).toBe(true);
      expect(race.lapsDone(mine)).toBe(1);

      const result = await a.p.next('result');
      expect(result.classified).toBe(true);
      expect(result.position).toBe(mine.position);
      expect(result.prize).toBe(prizeMoney(BRANDS_HATCH_INDY, mine.position));
      expect(result.prize).toBeGreaterThan(0);
      expect(result.standings.map((r) => r.driver)).toEqual(race.order.map((c) => c.driver.name));
      expect(result.record).toMatchObject({ trackId: BRANDS_HATCH_INDY.id, position: mine.position, entries: 3, laps: 1, lapsDone: 1, prize: result.prize, fee: startA.fee, driverId: a.driver.id, retired: '' });
      const resultB = await back.next('result');
      expect(resultB.position).toBe(race.cars[startB.you].position);
      expect(new Set([result.position, resultB.position]).size).toBe(2);

      // The prize and the entry fee are on the team the server keeps.
      const stored = await call('GET', '/api/profile', undefined, a.p.token);
      const saved = stored.body.profile as Profile;
      expect(stored.body.rev).toBe(result.rev);
      expect(saved.money).toBe(STARTING_MONEY - startA.fee + result.prize);
      expect(saved.races).toBe(1);
      expect(saved.wins).toBe(result.position === 1 ? 1 : 0);
      expect(saved.drivers[0].def.racesCompleted).toBe(1);
      expect(saved.history[0]).toEqual(result.record);

      // Afterwards both are free to play again.
      await pause(500);
      a.p.clear();
      a.p.send({ t: 'create', ...RULES });
      expect((await a.p.next('room')).room?.host).toBe('Racer_A');
      a.p.send({ t: 'leave' });
      a.p.close();
      back.close();
    }, 90000);

    it('fills open seats with bots when the host starts now', async () => {
      const a = await player('Starter', 31);
      const b = await player('Slowpoke', 32);
      a.p.send({ t: 'create', ...RULES, grid: 5, humans: 3 });
      const id = (await a.p.next('room')).room?.id ?? '';
      b.p.send({ t: 'join', game: id });
      await b.p.next('room');
      a.p.send({ t: 'entry', car: a.car, driver: a.driver });
      a.p.send({ t: 'ready', ready: true });
      await a.p.next('room', (m) => m.room?.seats[0]?.ready === true);

      // Only the host may start, and not while someone in the room is not ready.
      b.p.send({ t: 'start' });
      expect((await b.p.next('error')).message).toMatch(/host/i);
      a.p.send({ t: 'start' });
      expect((await a.p.next('error')).message).toMatch(/Slowpoke/);
      b.p.send({ t: 'entry', car: b.car, driver: b.driver });
      b.p.send({ t: 'ready', ready: true });
      await a.p.next('room', (m) => m.room?.seats[1]?.ready === true);
      // A seat is still open, so nothing starts by itself.
      await pause(200);
      expect(a.p.has('race')).toBe(false);

      a.p.send({ t: 'start' });
      const start = await a.p.next('race');
      expect(start.setup.entrants.length).toBe(5);
      expect(start.setup.entrants.filter((e) => e.owner).length).toBe(2);
      expect(start.setup.entrants.filter((e) => !e.owner).length).toBe(3);
      expect(new Set(start.setup.entrants.map((e) => e.driver.code)).size).toBe(5);
      const session = sessionFromSetup(start.setup, start.you);
      expect(session?.race.cars.length).toBe(5);
      expect(session?.entries[start.you].isPlayer).toBe(true);
      await a.p.next('snap');

      // Walking away gives up the result; when everyone has, the game is gone.
      a.p.send({ t: 'leave' });
      const quit = await a.p.next('result');
      expect(quit.classified).toBe(false);
      expect(quit.prize).toBe(0);
      expect(quit.record.retired).toBe('withdrew');
      b.p.send({ t: 'leave' });
      await b.p.next('result');
      await b.p.next('room', (m) => m.room === null);
      b.p.clear();
      await pause(200);
      expect(b.p.has('snap')).toBe(false);
      a.p.close();
      b.p.close();
    }, 30000);

    it('keeps one connection per account', async () => {
      const a = await player('Twice', 41);
      const second = await new Player(ws, a.p.token).connect();
      expect((await a.p.next('error')).message).toMatch(/somewhere else/i);
      await pause(100);
      expect(a.p.closed).toBe(true);
      second.send({ t: 'list' });
      await second.next('games');
      second.close();
    });
  });
});
