import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RunningServer, startServer } from '../server/app';
import { cleanBuild } from '../server/entry';
import { LIVERIES } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { CarBuild, generateBuild } from '../src/game/build';
import { Profile, STARTING_MONEY, entryFee, hireDriver, newProfile, prizeMoney } from '../src/game/profile';
import { NetClient } from '../src/net/client';
import { raceLegal, sessionFromSetup } from '../src/net/onlineRace';
import type { ClientMessage, GameRules, ServerMessage } from '../src/net/protocol';
import { DriverDef, SKILLS, Skill } from '../src/sim/driver';
import { Rng } from '../src/sim/rng';
import { applySnapshot } from '../src/sim/snapshot';

/** Disk faults a test can switch on, by file name: what `statSync` and `createReadStream` then fail with. */
const faults = vi.hoisted(() => ({ stat: new Map<string, string>(), read: new Map<string, string>() }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  const { Readable } = await import('node:stream');
  const name = (path: unknown): string => String(path).split(/[\\/]/).pop() ?? '';
  const fault = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: simulated`), { code });
  return {
    ...real,
    statSync: ((path: string, options?: unknown) => {
      const code = faults.stat.get(name(path));
      if (code) throw fault(code);
      return (real.statSync as (p: string, o?: unknown) => unknown)(path, options);
    }) as typeof real.statSync,
    createReadStream: ((path: string, options?: unknown) => {
      const code = faults.read.get(name(path));
      if (!code) return (real.createReadStream as (p: string, o?: unknown) => unknown)(path, options);
      // As from the real thing: the stream is handed back, and the error follows on it.
      const stream = new Readable({ read: () => undefined });
      process.nextTick(() => stream.destroy(fault(code)));
      return stream;
    }) as typeof real.createReadStream,
  };
});

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
const STRANGER = 'f'.repeat(64);
/** A client frame with an opcode no WebSocket defines: the server's socket library reports it as an error. */
const BAD_FRAME = Buffer.from([0x8f, 0x80, 1, 2, 3, 4]);

/** Opens a WebSocket by hand, sends `frame` once the server has answered the upgrade, and returns what came back. */
function rawSocket(port: number, frame: Buffer): Promise<string> {
  return new Promise((done) => {
    const sock = connect(port, '127.0.0.1');
    let got = '';
    let sent = false;
    const finish = (): void => {
      sock.destroy();
      done(got);
    };
    sock.on('error', () => undefined);
    sock.on('close', finish);
    sock.on('data', (d: Buffer) => {
      got += d.toString('latin1');
      if (sent || !got.includes('\r\n\r\n')) return;
      sent = true;
      sock.write(frame);
      setTimeout(finish, 200);
    });
    sock.write(['GET /ws HTTP/1.1', 'Host: 127.0.0.1', 'Upgrade: websocket', 'Connection: Upgrade',
      'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version: 13', '', ''].join('\r\n'));
  });
}

/** A second server for a test that needs its own limits. */
async function sideServer(options: Partial<Parameters<typeof startServer>[0]> = {}): Promise<{ server: RunningServer; http: string; ws: string; done(): Promise<void> }> {
  const dir = mkdtempSync(join(tmpdir(), 'miniracer-test-'));
  const server = await startServer({ port: 0, host: '127.0.0.1', dataDir: dir, authAttempts: 1000, ...options });
  return {
    server,
    http: `http://127.0.0.1:${server.port}`,
    ws: `ws://127.0.0.1:${server.port}/ws`,
    done: async () => {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe('Game server', () => {
  let server: RunningServer;
  let dataDir: string;
  let http: string;
  let ws: string;

  const call = async (method: string, path: string, body?: unknown, token?: string, base = http): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };

  const account = async (name: string, base = http): Promise<string> => {
    const res = await call('POST', '/api/register', { name, password: 'correct horse' }, undefined, base);
    expect(res.status).toBe(200);
    return res.body.token as string;
  };

  /** A signed-in, connected player whose team is saved on the server. */
  const player = async (name: string, seed: number, at = { http, ws }): Promise<{ name: string; p: Player; profile: Profile; car: CarBuild; driver: DriverDef }> => {
    const token = await account(name, at.http);
    const profile = team(seed, `${name} Driver`);
    expect((await call('PUT', '/api/profile', { profile }, token, at.http)).status).toBe(200);
    const p = await new Player(at.ws, token).connect();
    return { name, p, profile, car: profile.cars[0], driver: profile.drivers[0].def };
  };

  /** The team the server keeps for a token. */
  const stored = async (token: string, base = http): Promise<{ rev: number; profile: Profile }> => {
    const res = await call('GET', '/api/profile', undefined, token, base);
    return { rev: res.body.rev as number, profile: res.body.profile as Profile };
  };

  /** Seats players in a new game and has them all enter and get ready; returns each one's start. */
  const race = async (rules: GameRules, ...players: Awaited<ReturnType<typeof player>>[]): Promise<Of<'race'>[]> => {
    const [host, ...guests] = players;
    host.p.send({ t: 'create', ...rules });
    const id = (await host.p.next('room')).room?.id ?? '';
    for (const g of guests) {
      g.p.send({ t: 'join', game: id });
      await g.p.next('room');
    }
    for (const x of players) {
      x.p.send({ t: 'entry', car: x.car, driver: x.driver });
      await x.p.next('room', (m) => !!m.room?.seats.find((s) => s?.name === x.name)?.car);
    }
    for (const x of players) x.p.send({ t: 'ready', ready: true });
    return Promise.all(players.map((x) => x.p.next('race')));
  };

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'miniracer-test-'));
    // Tests only: thirty simulated seconds per real second, and a short roll-on after the flag.
    // Every test player connects from this one address.
    server = await startServer({ port: 0, host: '127.0.0.1', dataDir, simSpeed: 30, cooldown: 0.3, authAttempts: 1000, maxPerAddress: 1000 });
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

    it('refuses teams with malformed cars or drivers', async () => {
      const token = await account('Tidy');
      const profile = team(6, 'Tom Tidy');
      const [car] = profile.cars;
      const [hired] = profile.drivers;
      const broken: Partial<Record<keyof Profile, unknown>>[] = [
        { drivers: [null] },
        { drivers: [{}] },
        { drivers: [{ ...hired, def: null }] },
        { drivers: [{ ...hired, def: { ...hired.def, id: 7 } }] },
        { drivers: [{ ...hired, def: { ...hired.def, racesCompleted: 'many' } }] },
        { drivers: [{ ...hired, def: { ...hired.def, racesCompleted: NaN } }] },
        { drivers: [{ ...hired, def: { ...hired.def, skills: null } }] },
        { cars: [null] },
        { cars: [{ ...car, id: 5 }] },
        { cars: [{ ...car, parts: ['engine'] }] },
      ];
      for (const bad of broken) {
        expect((await call('PUT', '/api/profile', { profile: { ...profile, ...bad } }, token)).status, JSON.stringify(bad).slice(0, 80)).toBe(400);
      }
      expect((await call('GET', '/api/profile', undefined, token)).body.profile).toBeNull();
      expect((await call('PUT', '/api/profile', { profile }, token)).status).toBe(200);
    });

    it('uploads the team from the game without its photos', async () => {
      const token = await account('Snapper');
      const profile = team(7, 'Sam Snapper');
      // Ten photos are far more than one upload may carry.
      for (let i = 0; i < 10; i++) profile.photos.push({ id: `ph-${i}`, kind: 'team', data: `data:image/jpeg;base64,${'A'.repeat(200000)}`, caption: '', date: i });
      vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ name: 'Snapper', token }), setItem: () => undefined, removeItem: () => undefined });
      try {
        const net = new NetClient(http);
        expect(net.signedIn).toBe(true);
        expect((await net.saveProfile(profile)).rev).toBe(1);
      } finally {
        vi.unstubAllGlobals();
      }
      // The device keeps its photos; the server has the rest of the team.
      expect(profile.photos.length).toBe(10);
      const kept = await stored(token);
      expect(kept.profile.photos).toEqual([]);
      expect(kept.profile.cars).toEqual(JSON.parse(JSON.stringify(profile.cars)));
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

    it('refuses parts in conditions or slots that do not exist', async () => {
      const a = await player('Host_4', 16);
      a.p.send({ t: 'create', ...RULES });
      await a.p.next('room');
      const engine = a.car.parts.engine;
      if (!engine) throw new Error('no engine');
      // Names every plain object answers to, which once passed as a condition and filled the car with NaN.
      for (const cond of ['toString', 'valueOf', '__proto__', 'constructor', 'hasOwnProperty']) {
        const car = { ...a.car, parts: { ...a.car.parts, engine: { ...engine, cond } } };
        expect(cleanBuild(JSON.parse(JSON.stringify(car)))).toBeNull();
        // Even a build that got past the checks would not be raced.
        expect(raceLegal(car as CarBuild, BRANDS_HATCH_INDY)).toBe(false);
        a.p.send({ t: 'entry', car, driver: a.driver });
        expect((await a.p.next('error')).message).toMatch(/not race legal/i);
      }
      // A real part in a slot it was not made for.
      expect(cleanBuild({ ...a.car, parts: { ...a.car.parts, engine: a.car.parts.tyres } })).toBeNull();
      expect(cleanBuild({ ...a.car, parts: { ...a.car.parts, engine: { ...engine, part: 'toString' } } })).toBeNull();
      expect(cleanBuild(a.car)?.parts).toEqual(a.car.parts);
      a.p.send({ t: 'leave' });
      a.p.close();
    });

    it('takes a driver\'s experience from the saved team, never from the entry', async () => {
      const a = await player('Veteran', 17);
      a.p.send({ t: 'create', ...RULES });
      await a.p.next('room');
      // The driver has spent all 100 starting points; each 10 races completed allow one more.
      const plus = (n: number): Record<Skill, number> => ({ ...a.driver.skills, cornering: a.driver.skills.cornering + n });
      a.p.send({ t: 'entry', car: a.car, driver: { ...a.driver, racesCompleted: 1e6, skills: plus(5) } });
      expect((await a.p.next('error')).message).toMatch(/driver/i);

      // Fifty races on the team kept on the server: five more points, whatever the entry claims.
      const veteran = structuredClone(a.profile);
      veteran.drivers[0].def.racesCompleted = 50;
      expect((await call('PUT', '/api/profile', { profile: veteran }, a.p.token)).status).toBe(200);
      a.p.send({ t: 'entry', car: a.car, driver: { ...a.driver, racesCompleted: 0, skills: plus(5) } });
      expect((await a.p.next('room', (m) => !!m.room?.seats[0]?.car)).room?.seats[0]?.driver).toBe('Veteran Driver');
      a.p.send({ t: 'entry', car: a.car, driver: { ...a.driver, racesCompleted: 1e6, skills: plus(6) } });
      expect((await a.p.next('error')).message).toMatch(/driver/i);
      // A driver the saved team does not have has no experience at all.
      a.p.send({ t: 'entry', car: a.car, driver: { ...a.driver, id: 'drv-stranger', racesCompleted: 1e6, skills: plus(1) } });
      expect((await a.p.next('error')).message).toMatch(/driver/i);
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

    it('banks every other team when one team\'s saved file is broken', async () => {
      const broken = await player('Broken_1', 51);
      const quitter = await player('Broken_2', 52);
      const sound = await player('Sound_1', 53);
      await race({ ...RULES, grid: 4, humans: 3 }, broken, quitter, sound);
      // Mid-race two saved teams go bad on disk, past anything an upload could do.
      for (const key of ['broken_1', 'broken_2']) {
        const file = join(dataDir, 'profiles', `p-${key}.json`);
        const saved = JSON.parse(readFileSync(file, 'utf8')) as { profile: Profile };
        (saved.profile.drivers as unknown[]) = [null];
        writeFileSync(file, JSON.stringify(saved));
      }

      // Walking away still frees the team, though nothing can be banked for it.
      quitter.p.send({ t: 'leave' });
      expect((await quitter.p.next('room', (m) => m.room === null && !!m.reason)).reason).toMatch(/could not be saved/i);
      await quitter.p.next('room', (m) => m.room === null && !m.reason);
      quitter.p.clear();
      quitter.p.send({ t: 'create', ...RULES });
      expect((await quitter.p.next('room')).room?.host).toBe('Broken_2');
      quitter.p.send({ t: 'leave' });

      // At the flag the broken team, banked first, fails; the sound one is still paid.
      const result = await sound.p.next('result', () => true, 30000);
      const kept = await stored(sound.p.token);
      expect(kept.rev).toBe(result.rev);
      expect(kept.profile.history[0]).toEqual(result.record);
      expect(kept.profile.money).toBe(STARTING_MONEY - entryFee(BRANDS_HATCH_INDY) + result.prize);
      expect((await broken.p.next('room', (m) => m.room === null && !!m.reason)).reason).toMatch(/could not be saved/i);
      expect(broken.p.has('result')).toBe(false);
      // And the server carries on.
      expect((await call('GET', '/api/health')).status).toBe(200);
      for (const x of [broken, quitter, sound]) x.p.close();
    }, 60000);

    it('gives a team the result banked while its device was away', async () => {
      const a = await player('Away_1', 61);
      const [start] = await race({ ...RULES, grid: 2, humans: 1 }, a);
      expect(start.fee).toBe(entryFee(BRANDS_HATCH_INDY));
      // The device goes away for the whole race, and past the end of the game.
      a.p.close();
      let kept = await stored(a.p.token);
      for (const until = Date.now() + 30000; !kept.profile.history.length; kept = await stored(a.p.token)) {
        if (Date.now() > until) throw new Error('The race was never banked');
        await pause(200);
      }
      await pause(500);

      const back = await new Player(ws, a.p.token).connect();
      const result = await back.next('result');
      expect(result.record).toEqual(kept.profile.history[0]);
      expect(result.rev).toBe(kept.rev);
      expect(result.prize).toBe(kept.profile.money - STARTING_MONEY + start.fee);
      expect(back.has('race')).toBe(false);
      back.close();
      // It is handed over once.
      const again = await new Player(ws, a.p.token).connect();
      await pause(200);
      expect(again.has('result')).toBe(false);
      again.close();
    }, 60000);

    it('takes no entry fee when one cannot be taken, and starts once it can', async () => {
      const a = await player('Payer_A', 71);
      const b = await player('Payer_B', 72);
      // B's saved team cannot be written for a while: its next write fails.
      const blocker = join(dataDir, 'profiles', `p-payer_b.json.${process.pid}.tmp`);
      mkdirSync(blocker);
      a.p.send({ t: 'create', ...RULES });
      const id = (await a.p.next('room')).room?.id ?? '';
      b.p.send({ t: 'join', game: id });
      await b.p.next('room');
      a.p.send({ t: 'entry', car: a.car, driver: a.driver });
      b.p.send({ t: 'entry', car: b.car, driver: b.driver });
      await a.p.next('room', (m) => !!m.room?.seats[1]?.car);
      a.p.send({ t: 'ready', ready: true });
      b.p.send({ t: 'ready', ready: true });
      expect((await a.p.next('error')).message).toMatch(/could not be started/i);
      expect((await b.p.next('error')).message).toMatch(/could not be started/i);
      expect(a.p.has('race')).toBe(false);
      // A, charged first, has had the fee back; the game is still waiting in the lobby.
      expect((await stored(a.p.token)).profile.money).toBe(STARTING_MONEY);
      expect((await stored(b.p.token)).profile.money).toBe(STARTING_MONEY);

      rmSync(blocker, { recursive: true, force: true });
      a.p.send({ t: 'ready', ready: true });
      b.p.send({ t: 'ready', ready: true });
      const start = await a.p.next('race');
      await b.p.next('race');
      expect(start.fee).toBe(entryFee(BRANDS_HATCH_INDY));
      expect((await stored(a.p.token)).profile.money).toBe(STARTING_MONEY - start.fee);
      expect((await stored(b.p.token)).profile.money).toBe(STARTING_MONEY - start.fee);
      a.p.send({ t: 'leave' });
      b.p.send({ t: 'leave' });
      await b.p.next('room', (m) => m.room === null);
      a.p.close();
      b.p.close();
    }, 30000);

    it('refunds the entry fees of a race the server had to stop', async () => {
      // Real time, and a race may run for 0.4 s: it is stopped long before the flag.
      const side = await sideServer({ maxRaceTime: 0.4 });
      try {
        const a = await player('Stopped_A', 81, side);
        const b = await player('Stopped_B', 82, side);
        const [startA] = await race(RULES, a, b);
        expect(startA.fee).toBe(entryFee(BRANDS_HATCH_INDY));
        // B's device is away when it happens.
        b.p.close();
        expect((await a.p.next('room', (m) => m.room === null && !!m.reason, 5000)).reason).toMatch(/stopped.*refunded/i);
        const result = await a.p.next('result');
        expect(result).toMatchObject({ classified: false, prize: 0, position: 0 });
        expect(result.record).toMatchObject({ retired: 'abandoned', fee: 0, prize: 0 });
        for (const x of [a, b]) {
          const kept = await stored(x.p.token, side.http);
          expect(kept.profile.money).toBe(STARTING_MONEY);
          expect(kept.profile.races).toBe(0);
          expect(kept.profile.history[0]).toMatchObject({ retired: 'abandoned', fee: 0 });
        }
        // B hears about it on coming back.
        const back = await new Player(side.ws, b.p.token).connect();
        expect((await back.next('result')).record.retired).toBe('abandoned');
        a.p.close();
        back.close();
      } finally {
        await side.done();
      }
    }, 30000);
  });

  describe('robustness', () => {
    it('survives a bad frame from a connection it turns away, and from one it took', async () => {
      const side = await sideServer({ maxClients: 1 });
      try {
        const first = await new Player(side.ws, STRANGER).connect(false);
        // Full: the second connection is dropped at once; a bad frame on it must not end the process.
        await rawSocket(side.server.port, BAD_FRAME);
        await pause(100);
        expect(first.closed).toBe(false);
        expect((await call('GET', '/api/health', undefined, undefined, side.http)).status).toBe(200);
        first.close();
        await pause(100);
        // Room again: this time the connection is taken, then sends the bad frame.
        expect(await rawSocket(side.server.port, BAD_FRAME)).toContain('101 Switching Protocols');
        expect((await call('GET', '/api/health', undefined, undefined, side.http)).status).toBe(200);
        expect((await new Player(side.ws, STRANGER).connect(false)).closed).toBe(false);
      } finally {
        await side.done();
      }
    });

    it('limits connections per address and before sign-in, and closes games left idle', async () => {
      const side = await sideServer({ maxPerAddress: 3, maxUnauthenticated: 2, authTimeout: 1.5, idleTimeout: 0.5 });
      try {
        const tokenA = await account('Limit_A', side.http);
        const tokenB = await account('Limit_B', side.http);
        /** A new connection, and after a moment whether the server kept it. */
        const knock = async (): Promise<Player> => {
          const p = new Player(side.ws, STRANGER);
          await p.connect(false).catch(() => undefined);
          await pause(150);
          return p;
        };
        const a = await knock();
        const b = await knock();
        expect(a.closed || b.closed).toBe(false);
        // Two connections are waiting to sign in: a third stranger is turned away.
        expect((await knock()).closed).toBe(true);
        // Signing in moves a connection out of that budget.
        a.send({ t: 'auth', token: tokenA });
        await a.next('hello');
        const c = await knock();
        expect(c.closed).toBe(false);
        c.send({ t: 'auth', token: tokenB });
        await c.next('hello');
        // Three from this address, two of them signed in: a fourth is turned away whoever it is.
        expect((await knock()).closed).toBe(true);

        // A stranger that never signs in is let go soon, which makes room again.
        for (const until = Date.now() + 4000; !b.closed && Date.now() < until; ) await pause(50);
        expect(b.closed).toBe(true);
        expect(a.closed || c.closed).toBe(false);
        expect((await knock()).closed).toBe(false);

        // A game nobody joins, enters or gets ready in is closed, and its players are told why.
        a.send({ t: 'create', ...RULES });
        expect((await a.next('room')).room?.host).toBe('Limit_A');
        expect((await a.next('room', (m) => m.room === null, 3000)).reason).toMatch(/too long/i);
        a.clear();
        a.send({ t: 'list' });
        expect((await a.next('games')).games).toEqual([]);
        a.send({ t: 'create', ...RULES });
        expect((await a.next('room', (m) => m.room !== null)).room?.host).toBe('Limit_A');
        a.close();
        c.close();
      } finally {
        await side.done();
      }
    });

    it('serves the game, caches only built assets, and survives files it cannot read', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'miniracer-test-'));
      // The build itself sits inside a folder called "assets": only assets/ within the build is cached for good.
      const root = join(dir, 'assets', 'dist');
      mkdirSync(join(root, 'assets'), { recursive: true });
      writeFileSync(join(root, 'index.html'), '<!doctype html><title>MiniRacer</title>');
      writeFileSync(join(root, 'assets', 'game-1a2b3c.js'), 'console.log(1)');
      writeFileSync(join(root, 'locked.js'), 'x');
      writeFileSync(join(root, 'flaky.css'), 'x');
      writeFileSync(join(root, 'gone.png'), 'x');
      const site = await startServer({ port: 0, host: '127.0.0.1', dataDir: join(dir, 'data'), staticDir: root });
      const get = (path: string): Promise<Response> => fetch(`http://127.0.0.1:${site.port}${path}`);
      try {
        const page = await get('/');
        expect(page.status).toBe(200);
        expect(page.headers.get('cache-control')).toBe('no-cache');
        expect(await page.text()).toContain('MiniRacer');
        expect((await get('/garage')).headers.get('content-type')).toMatch(/text\/html/);
        const asset = await get('/assets/game-1a2b3c.js');
        expect(asset.headers.get('cache-control')).toMatch(/immutable/);
        expect(await asset.text()).toBe('console.log(1)');
        expect((await get('/missing.js')).status).toBe(404);

        // One file cannot be opened, one cannot even be looked at, and one vanishes between the look and the read.
        faults.read.set('locked.js', 'EACCES');
        faults.stat.set('flaky.css', 'EACCES');
        faults.read.set('gone.png', 'ENOENT');
        expect((await get('/locked.js')).status).toBe(500);
        expect((await get('/flaky.css')).status).toBe(500);
        expect((await get('/gone.png')).status).toBe(404);
        expect((await get('/api/health')).status).toBe(200);
        expect(await (await get('/')).text()).toContain('MiniRacer');
      } finally {
        faults.read.clear();
        faults.stat.clear();
        await site.close();
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
