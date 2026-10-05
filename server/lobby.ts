import { randomBytes, randomInt } from 'node:crypto';
import type { WebSocket } from 'ws';
import { chassisName } from '../src/game/build';
import { RaceRecord, payEntry, prizeMoney, recordRace, settleRace } from '../src/game/profile';
import type { RaceSession } from '../src/game/raceSetup';
import { planOnlineRace, raceLegal, sessionFromSetup, trackById } from '../src/net/onlineRace';
import { COMMAND_IDS, ClientMessage, GameInfo, GameRules, OnlineEntrant, OnlineRaceSetup, ResultRow, RoomInfo, ServerMessage } from '../src/net/protocol';
import type { Command } from '../src/sim/race';
import type { TrackDef } from '../src/sim/track';
import { Accounts } from './accounts';
import { cleanBuild, cleanDriver, cleanRules, own, storedRaces } from './entry';
import { RaceRun } from './raceRun';

export interface LobbyOptions {
  /** Simulated seconds per real second. Leave at 1 outside tests. */
  simSpeed?: number;
  /** Seconds the cars roll on after the finish before the game closes. */
  cooldown?: number;
  /** Most games open or running at once. */
  maxGames?: number;
  /** Most connections at once. */
  maxClients?: number;
  /** Most connections at once from one address. */
  maxPerAddress?: number;
  /** Most connections at once that have not signed in yet. */
  maxUnauthenticated?: number;
  /** Seconds a new connection has to sign in. */
  authTimeout?: number;
  /** Seconds a game may wait for its start with nobody joining, entering or getting ready. */
  idleTimeout?: number;
  /** Seconds a race may run before the server stops it. */
  maxRaceTime?: number;
}

interface Client {
  ws: WebSocket;
  /** Account key and display name once the token is accepted. */
  key: string;
  name: string;
  game: Game | null;
  alive: boolean;
  /** Dropped by the server; its close event needs no more handling. */
  gone: boolean;
  /** Messages in the current second, to stop a flood. */
  count: number;
  countFrom: number;
  authTimer: ReturnType<typeof setTimeout> | null;
}

interface Seat {
  key: string;
  name: string;
  entry: OnlineEntrant | null;
  ready: boolean;
  /** Null while the team's connection is down. */
  client: Client | null;
  /** Index of the team's car in the race. */
  car: number;
  fee: number;
  /** Walked away during the race: the car runs on, but there is no prize. */
  forfeited: boolean;
  /** The result (or the refund of a stopped race) is on the team kept here. */
  banked: boolean;
}

interface Game {
  id: string;
  host: string;
  rules: GameRules;
  seats: (Seat | null)[];
  state: 'lobby' | 'racing' | 'done';
  setup: OnlineRaceSetup | null;
  session: RaceSession | null;
  run: RaceRun | null;
  /** Last time someone joined, entered or got ready, ms. */
  touched: number;
}

type ResultMessage = Extract<ServerMessage, { t: 'result' }>;

const MESSAGES_PER_SECOND = 40;
/** Snapshots are skipped for a connection with this much unsent data, bytes. */
const BACKLOG_LIMIT = 512 * 1024;
/** How long a result waits for a team whose device was away at the flag, ms. */
const RESULT_KEEP_MS = 24 * 3600e3;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The lobby and every game: who sits where, when a race starts, and what each connection is told. */
export class Lobby {
  private readonly clients = new Set<Client>();
  /** Signed-in connections by account key; one per account. */
  private readonly online = new Map<string, Client>();
  private readonly games = new Map<string, Game>();
  /** The game each account is in, kept across a dropped connection while a race runs. */
  private readonly membership = new Map<string, Game>();
  /** Connections open per address. */
  private readonly perAddress = new Map<string, number>();
  /** Results banked while the team's device was away, by account key. */
  private readonly unsent = new Map<string, { msg: ResultMessage; until: number }>();
  /** Connections that have not signed in yet. */
  private pending = 0;
  private readonly heartbeat: ReturnType<typeof setInterval>;
  private readonly sweeper: ReturnType<typeof setInterval>;
  private readonly simSpeed: number;
  private readonly cooldownMs: number;
  private readonly maxGames: number;
  private readonly maxClients: number;
  private readonly maxPerAddress: number;
  private readonly maxUnauthenticated: number;
  private readonly authTimeoutMs: number;
  private readonly idleMs: number;
  private readonly maxRaceMs: number | undefined;

  constructor(private readonly accounts: Accounts, options: LobbyOptions = {}) {
    this.simSpeed = options.simSpeed ?? 1;
    this.cooldownMs = (options.cooldown ?? 20) * 1000;
    this.maxGames = options.maxGames ?? 20;
    this.maxClients = options.maxClients ?? 300;
    this.maxPerAddress = options.maxPerAddress ?? 6;
    this.maxUnauthenticated = options.maxUnauthenticated ?? 50;
    this.authTimeoutMs = (options.authTimeout ?? 5) * 1000;
    this.idleMs = (options.idleTimeout ?? 15 * 60) * 1000;
    this.maxRaceMs = options.maxRaceTime === undefined ? undefined : options.maxRaceTime * 1000;
    // Connections that stop answering pings are closed, which frees their seats.
    this.heartbeat = setInterval(() => {
      for (const c of this.clients) {
        if (!c.alive) {
          c.ws.terminate();
          continue;
        }
        c.alive = false;
        c.ws.ping();
      }
    }, 30000);
    // Games left waiting for their start are closed, so idle rooms cannot fill the server.
    this.sweeper = setInterval(() => {
      try {
        this.sweep();
      } catch (err) {
        console.error('Lobby sweep failed:', err);
      }
    }, Math.max(50, Math.min(30000, this.idleMs / 4)));
  }

  close(): void {
    clearInterval(this.heartbeat);
    clearInterval(this.sweeper);
    for (const g of this.games.values()) {
      g.run?.stop();
      // A restart ends the races in progress; nobody pays for a race that produced no result.
      if (g.state === 'racing') this.abandon(g, trackById(g.rules.trackId) as TrackDef);
    }
    for (const c of this.clients) {
      if (c.authTimer) clearTimeout(c.authTimer);
      c.ws.terminate();
    }
    this.clients.clear();
    this.games.clear();
    this.membership.clear();
    this.online.clear();
  }

  /** Takes over a new WebSocket connection from `address`. */
  attach(ws: WebSocket, address = 'unknown'): void {
    // Before anything else: an 'error' with no listener (a bad frame, a reset) would end the process.
    ws.on('error', () => ws.terminate());
    const fromHere = this.perAddress.get(address) ?? 0;
    if (this.clients.size >= this.maxClients || fromHere >= this.maxPerAddress || this.pending >= this.maxUnauthenticated) {
      ws.terminate();
      return;
    }
    this.perAddress.set(address, fromHere + 1);
    this.pending++;
    const client: Client = { ws, key: '', name: '', game: null, alive: true, gone: false, count: 0, countFrom: Date.now(), authTimer: null };
    this.clients.add(client);
    client.authTimer = setTimeout(() => {
      if (!client.key) ws.close(4401, 'Sign in first');
    }, this.authTimeoutMs);
    ws.on('pong', () => (client.alive = true));
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - client.countFrom > 1000) {
        client.countFrom = now;
        client.count = 0;
      }
      if (++client.count > MESSAGES_PER_SECOND) {
        ws.close(4008, 'Too many messages');
        return;
      }
      let msg: unknown;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      if (!isObject(msg) || typeof msg.t !== 'string') return;
      try {
        this.handle(client, msg as Record<string, unknown> & { t: string });
      } catch (err) {
        console.error('Message failed:', err);
        this.send(client, { t: 'error', message: 'The server could not do that' });
      }
    });
    ws.on('close', () => {
      if (client.authTimer) clearTimeout(client.authTimer);
      this.clients.delete(client);
      if (!client.key) this.pending--;
      const left = (this.perAddress.get(address) ?? 1) - 1;
      if (left > 0) this.perAddress.set(address, left);
      else this.perAddress.delete(address);
      try {
        if (!client.gone) this.dropped(client);
      } catch (err) {
        console.error('Closing a connection failed:', err);
      }
    });
  }

  private send(client: Client | null, msg: ServerMessage): void {
    if (client && client.ws.readyState === client.ws.OPEN) client.ws.send(JSON.stringify(msg));
  }

  private fail(client: Client, message: string): void {
    this.send(client, { t: 'error', message });
  }

  private handle(client: Client, msg: Record<string, unknown> & { t: string }): void {
    if (msg.t === 'auth') {
      this.auth(client, msg.token);
      return;
    }
    if (!client.key) {
      this.fail(client, 'Sign in first');
      return;
    }
    switch (msg.t as ClientMessage['t']) {
      case 'list':
        this.send(client, { t: 'games', games: this.openGames() });
        break;
      case 'create':
        this.create(client, msg);
        break;
      case 'join':
        this.join(client, msg.game);
        break;
      case 'leave':
        this.leave(client);
        break;
      case 'entry':
        this.entry(client, msg);
        break;
      case 'ready':
        this.ready(client, msg.ready === true);
        break;
      case 'start':
        this.startNow(client);
        break;
      case 'cmd':
        this.command(client, msg);
        break;
      default:
        this.fail(client, 'Unknown message');
    }
  }

  // --- Connections --------------------------------------------------------------

  private auth(client: Client, token: unknown): void {
    if (client.key) return;
    const who = this.accounts.whoIs(token);
    if (!who) {
      this.fail(client, 'Sign in again');
      client.ws.close(4401, 'Sign in again');
      return;
    }
    // One connection per account: the newest wins.
    const old = this.online.get(who.key);
    if (old) {
      old.gone = true;
      this.dropped(old);
      this.fail(old, 'Signed in from somewhere else');
      old.ws.close(4001, 'Signed in elsewhere');
    }
    client.key = who.key;
    client.name = who.name;
    this.pending--;
    this.online.set(who.key, client);
    this.send(client, { t: 'hello', name: who.name, rev: this.accounts.profileRev(who.key) });
    this.send(client, { t: 'games', games: this.openGames() });

    // Back into a race that is still running.
    const game = this.membership.get(who.key);
    const seat = game?.seats.find((s) => s?.key === who.key);
    if (game && seat && game.state === 'racing' && game.setup && game.run) {
      client.game = game;
      seat.client = client;
      game.run.needFull = true;
      this.send(client, { t: 'race', setup: game.setup, you: seat.car, fee: 0, rev: this.accounts.profileRev(who.key), resumed: true });
    }
    // A result banked while the device was away.
    const kept = this.unsent.get(who.key);
    if (kept) {
      this.unsent.delete(who.key);
      if (kept.until > Date.now()) this.send(client, kept.msg);
    }
  }

  /** A connection has gone away. */
  private dropped(client: Client): void {
    if (!client.key) return;
    if (this.online.get(client.key) === client) this.online.delete(client.key);
    const game = client.game;
    client.game = null;
    if (!game) return;
    if (game.state === 'lobby') {
      this.vacate(game, client.key);
      return;
    }
    // Mid-race the car carries on with its driver; the seat waits for the team to come back.
    const seat = game.seats.find((s) => s?.key === client.key);
    if (seat && seat.client === client) seat.client = null;
    if (game.state === 'done') this.membership.delete(client.key);
  }

  // --- Lobby --------------------------------------------------------------------

  private openGames(): GameInfo[] {
    const out: GameInfo[] = [];
    for (const g of this.games.values()) {
      if (g.state !== 'lobby') continue;
      out.push({ ...g.rules, id: g.id, host: this.hostName(g), filled: g.seats.filter(Boolean).length });
    }
    return out;
  }

  private hostName(game: Game): string {
    return game.seats.find((s) => s?.key === game.host)?.name ?? '';
  }

  private roomInfo(game: Game): RoomInfo {
    return {
      ...game.rules,
      id: game.id,
      host: this.hostName(game),
      seats: game.seats.map((s) => s && {
        name: s.name,
        ready: s.ready,
        connected: s.client !== null,
        car: s.entry ? chassisName(s.entry.build) : null,
        driver: s.entry ? s.entry.driver.name : null,
      }),
    };
  }

  private tellRoom(game: Game): void {
    const room = this.roomInfo(game);
    for (const s of game.seats) if (s) this.send(s.client, { t: 'room', room });
  }

  private tellLobby(): void {
    const games = this.openGames();
    for (const c of this.online.values()) if (!c.game || c.game.state === 'lobby') this.send(c, { t: 'games', games });
  }

  /** The game the account is in now. A finished game no longer holds anyone. */
  private current(client: Client): Game | null {
    const game = this.membership.get(client.key) ?? null;
    if (game && game.state === 'done') {
      this.membership.delete(client.key);
      client.game = null;
      return null;
    }
    return game;
  }

  private newSeat(client: Client): Seat {
    return { key: client.key, name: client.name, entry: null, ready: false, client, car: -1, fee: 0, forfeited: false, banked: false };
  }

  /** Closes games that have waited too long for their start, and forgets results nobody came back for. */
  private sweep(): void {
    const now = Date.now();
    for (const game of [...this.games.values()]) {
      if (game.state !== 'lobby' || now - game.touched <= this.idleMs) continue;
      for (const s of game.seats) if (s) this.send(s.client, { t: 'room', room: null, reason: 'The game was closed: nothing happened in it for too long' });
      this.closeGame(game);
    }
    for (const [key, kept] of this.unsent) if (kept.until <= now) this.unsent.delete(key);
  }

  private create(client: Client, raw: Record<string, unknown>): void {
    if (this.current(client)) return this.fail(client, 'Leave your current game first');
    if (this.games.size >= this.maxGames) return this.fail(client, 'The server is full; try again shortly');
    const rules = cleanRules(raw);
    if (typeof rules === 'string') return this.fail(client, rules);
    const game: Game = {
      id: randomBytes(6).toString('hex'),
      host: client.key,
      rules,
      seats: Array.from({ length: rules.humans }, () => null),
      state: 'lobby',
      setup: null,
      session: null,
      run: null,
      touched: Date.now(),
    };
    game.seats[0] = this.newSeat(client);
    this.games.set(game.id, game);
    this.membership.set(client.key, game);
    client.game = game;
    this.tellRoom(game);
    this.tellLobby();
  }

  private join(client: Client, id: unknown): void {
    if (this.current(client)) return this.fail(client, 'Leave your current game first');
    const game = typeof id === 'string' ? this.games.get(id) : undefined;
    if (!game || game.state !== 'lobby') return this.fail(client, 'That game is no longer open');
    const free = game.seats.indexOf(null);
    if (free < 0) return this.fail(client, 'That game is full');
    game.seats[free] = this.newSeat(client);
    game.touched = Date.now();
    this.membership.set(client.key, game);
    client.game = game;
    this.tellRoom(game);
    this.tellLobby();
  }

  private leave(client: Client): void {
    const game = this.current(client);
    client.game = null;
    if (!game) {
      this.send(client, { t: 'room', room: null });
      return;
    }
    if (game.state === 'lobby') {
      this.vacate(game, client.key);
    } else {
      // Walking away from a running race gives up the result.
      const seat = game.seats.find((s) => s?.key === client.key);
      try {
        if (seat && game.state === 'racing' && !seat.forfeited) {
          seat.forfeited = true;
          this.bankSafely(game, seat, trackById(game.rules.trackId) as TrackDef);
        }
      } finally {
        // Whatever happened to the result, the team is out of this game.
        if (seat) seat.client = null;
        this.membership.delete(client.key);
        if (game.seats.every((s) => !s || s.forfeited)) this.closeGame(game);
      }
    }
    this.send(client, { t: 'room', room: null });
    this.send(client, { t: 'games', games: this.openGames() });
  }

  /** Frees a seat before the start; the host's role passes on, and an empty game closes. */
  private vacate(game: Game, key: string): void {
    const i = game.seats.findIndex((s) => s?.key === key);
    if (i >= 0) game.seats[i] = null;
    this.membership.delete(key);
    const next = game.seats.find(Boolean);
    if (!next) {
      this.games.delete(game.id);
    } else {
      game.touched = Date.now();
      if (game.host === key) game.host = next.key;
      this.tellRoom(game);
      this.maybeStart(game, false);
    }
    this.tellLobby();
  }

  private seatOf(client: Client, state: Game['state']): { game: Game; seat: Seat } | null {
    const game = this.current(client);
    const seat = game?.seats.find((s) => s?.key === client.key);
    return game && seat && game.state === state ? { game, seat } : null;
  }

  private entry(client: Client, raw: Record<string, unknown>): void {
    const at = this.seatOf(client, 'lobby');
    if (!at) return this.fail(client, 'You are not in a game');
    at.game.touched = Date.now();
    const track = trackById(at.game.rules.trackId) as TrackDef;
    const build = cleanBuild(own(raw, 'car'));
    const rawDriver = own(raw, 'driver');
    // Experience, which lifts the skill caps, comes from the team kept here and never from the client.
    const races = storedRaces(this.accounts.loadProfile(at.seat.key)?.profile, isObject(rawDriver) ? own(rawDriver, 'id') : undefined);
    const driver = cleanDriver(rawDriver, races);
    const legal = !!build && raceLegal(build, track);
    if (!build || !driver || !legal) {
      at.seat.entry = null;
      at.seat.ready = false;
      this.tellRoom(at.game);
      return this.fail(client, !driver ? 'That driver cannot be entered' : 'That car is not race legal');
    }
    at.seat.entry = { build, driver, owner: at.seat.name, pitMode: raw.pitMode === 'manual' ? 'manual' : 'auto' };
    this.tellRoom(at.game);
  }

  private ready(client: Client, ready: boolean): void {
    const at = this.seatOf(client, 'lobby');
    if (!at) return this.fail(client, 'You are not in a game');
    if (ready && !at.seat.entry) return this.fail(client, 'Choose a car and a driver first');
    at.seat.ready = ready;
    at.game.touched = Date.now();
    this.tellRoom(at.game);
    this.maybeStart(at.game, false);
  }

  private startNow(client: Client): void {
    const at = this.seatOf(client, 'lobby');
    if (!at) return this.fail(client, 'You are not in a game');
    if (at.game.host !== client.key) return this.fail(client, 'Only the host can start the game');
    const waiting = at.game.seats.find((s) => s && !s.ready);
    if (waiting) return this.fail(client, `Waiting for ${waiting.name} to be ready`);
    this.maybeStart(at.game, true);
  }

  /**
   * The system starts the game when every seat is taken and everyone is ready.
   * The host can force the start with seats still open; bots take those.
   */
  private maybeStart(game: Game, forced: boolean): void {
    if (game.state !== 'lobby') return;
    const humans = game.seats.filter((s): s is Seat => s !== null);
    if (!humans.length || humans.some((s) => !s.ready || !s.entry)) return;
    if (!forced && humans.length < game.seats.length) return;
    this.startRace(game, humans);
  }

  // --- Racing -------------------------------------------------------------------

  private startRace(game: Game, humans: Seat[]): void {
    const rules = game.rules;
    const track = trackById(rules.trackId) as TrackDef;
    const setup = planOnlineRace(
      { trackId: rules.trackId, laps: rules.laps, grid: rules.grid, options: { wearScale: rules.wearScale, hazards: rules.hazards, weather: rules.weather } },
      humans.map((s) => s.entry as OnlineEntrant),
      randomInt(1, 0x7fffffff),
    );
    const session = setup && sessionFromSetup(setup, -1);
    if (!setup || !session) {
      for (const s of humans) {
        s.ready = false;
        this.send(s.client, { t: 'error', message: 'The race could not be set up; check the cars' });
      }
      this.tellRoom(game);
      return;
    }
    for (const s of humans) s.car = setup.entrants.findIndex((e) => e.owner === s.name);

    // The entry fees come last, off the teams saved on the server as in a single-player race.
    // If one cannot be taken, those already taken go back and the game stays in the lobby.
    const revs = new Map<Seat, number>();
    const charged: Seat[] = [];
    try {
      for (const s of humans) {
        s.fee = 0;
        let fee = 0;
        revs.set(s, this.accounts.updateProfile(s.key, (p) => {
          fee = payEntry(p, track).paid;
        }));
        s.fee = fee;
        charged.push(s);
      }
    } catch (err) {
      console.error('Entry fees could not be taken:', err);
      for (const s of charged) this.refund(s);
      for (const s of humans) {
        s.ready = false;
        this.send(s.client, { t: 'error', message: 'The race could not be started; get ready to try again' });
      }
      this.tellRoom(game);
      return;
    }

    game.setup = setup;
    game.session = session;
    game.state = 'racing';
    game.run = new RaceRun(session.race, {
      snapshot: (snap) => {
        const text = JSON.stringify({ t: 'snap', s: snap } satisfies ServerMessage);
        for (const s of game.seats) {
          const ws = s?.client?.ws;
          // A connection that cannot keep up misses snapshots rather than queueing them.
          if (ws && ws.readyState === ws.OPEN && (ws.bufferedAmount < BACKLOG_LIMIT || snap.s)) ws.send(text);
        }
      },
      finished: () => this.finish(game, track),
      closed: (failed) => {
        if (failed) {
          // Stopped before the flag: nobody pays for a race that produced no result.
          const refunded = game.state === 'racing';
          if (refunded) this.abandon(game, track);
          const reason = refunded ? 'The race was stopped by the server; entry fees are refunded' : 'The race was stopped by the server';
          for (const s of game.seats) if (s) this.send(s.client, { t: 'room', room: null, reason });
        }
        this.closeGame(game);
      },
    }, this.simSpeed, this.cooldownMs, this.maxRaceMs);

    for (const s of humans) this.send(s.client, { t: 'race', setup, you: s.car, fee: s.fee, rev: revs.get(s) ?? 0, resumed: false });
    game.run.start();
    this.tellLobby();
  }

  /** Gives a team its entry fee back. */
  private refund(s: Seat): void {
    const fee = s.fee;
    try {
      if (fee > 0) {
        this.accounts.updateProfile(s.key, (p) => {
          p.money += fee;
        });
      }
      s.fee = 0;
    } catch (err) {
      console.error(`Entry fee for ${s.key} could not be refunded:`, err);
    }
  }

  private command(client: Client, raw: Record<string, unknown>): void {
    const at = this.seatOf(client, 'racing');
    if (!at || !at.game.session) return this.fail(client, 'You are not in a race');
    // A team only ever talks to its own driver.
    if (Object.hasOwn(raw, 'car') && raw.car !== at.seat.car) return this.fail(client, 'You can only give orders to your own car');
    const command = COMMAND_IDS.find((c) => c === raw.command) as Command | undefined;
    if (!command) return this.fail(client, 'Unknown order');
    at.game.session.race.command(at.seat.car, command);
  }

  /** The flag has fallen: every team still on the pit wall gets its result. */
  private finish(game: Game, track: TrackDef): void {
    if (!game.session || game.state !== 'racing') return;
    game.state = 'done';
    for (const s of game.seats) if (s && s.entry && !s.forfeited) this.bankSafely(game, s, track);
  }

  /** Banks one team's result; one team's broken save must not cost the others theirs. */
  private bankSafely(game: Game, s: Seat, track: TrackDef): void {
    try {
      this.bank(game, s, track);
    } catch (err) {
      console.error(`Result for ${s.key} could not be banked:`, err);
      this.send(s.client, { t: 'room', room: null, reason: 'Your result could not be saved on the server' });
    }
  }

  private standings(game: Game): ResultRow[] {
    return (game.session?.race.order ?? []).map((car, i) => ({
      position: i + 1,
      driver: car.driver.name,
      owner: game.setup?.entrants[car.id].owner,
      finished: car.finished,
    }));
  }

  /** The history line for one team's race. */
  private recordOf(game: Game, s: Seat, track: TrackDef, outcome: Pick<RaceRecord, 'position' | 'fee' | 'prize' | 'retired'>): RaceRecord {
    const race = (game.session as RaceSession).race;
    const me = race.cars[s.car];
    return {
      date: Date.now(),
      trackId: track.id,
      practice: false,
      position: outcome.position,
      grid: s.car + 1,
      entries: race.cars.length,
      laps: race.laps,
      lapsDone: race.lapsDone(me),
      bestLap: Number.isFinite(me.bestLap) ? me.bestLap : 0,
      raceTime: me.finishTime,
      pitStops: me.pitStops,
      fee: outcome.fee,
      prize: outcome.prize,
      car: chassisName((s.entry as OnlineEntrant).build),
      driver: me.driver.name,
      driverId: (s.entry as OnlineEntrant).driver.id,
      retired: outcome.retired,
    };
  }

  /** Banks one team's result on the server and tells the team, now or when it comes back. Throws when the save fails. */
  private bank(game: Game, s: Seat, track: TrackDef): void {
    const session = game.session;
    if (!session || !s.entry) return;
    const me = session.race.cars[s.car];
    const classified = me.finished && !s.forfeited;
    const prize = classified ? prizeMoney(track, me.position) : 0;
    const driverId = s.entry.driver.id;
    const record = this.recordOf(game, s, track, {
      position: classified ? me.position : 0,
      fee: s.fee,
      prize,
      retired: classified ? '' : s.forfeited ? 'withdrew' : me.retireReason === 'fuel' ? 'out of fuel' : me.retireReason === 'tyres' ? 'tyre failure' : 'not classified',
    });
    const rev = this.accounts.updateProfile(s.key, (p) => {
      if (classified) settleRace(p, driverId, track, me.position);
      else {
        // A retirement still counts as a start for the team and the driver.
        p.races += 1;
        const d = p.drivers.find((x) => x.def.id === driverId);
        if (d) d.def.racesCompleted += 1;
      }
      recordRace(p, record);
    });
    s.banked = true;
    this.deliver(s, { t: 'result', position: record.position, classified, prize, record, rev, standings: this.standings(game) });
  }

  /**
   * The race was stopped before the flag. Every team without a result gets its
   * entry fee back, and the race goes into its history as abandoned.
   */
  private abandon(game: Game, track: TrackDef): void {
    if (!game.session) return;
    for (const s of game.seats) {
      if (!s || !s.entry || s.banked) continue;
      try {
        const fee = s.fee;
        const record = this.recordOf(game, s, track, { position: 0, fee: 0, prize: 0, retired: 'abandoned' });
        const rev = this.accounts.updateProfile(s.key, (p) => {
          p.money += fee;
          recordRace(p, record);
        });
        s.fee = 0;
        s.banked = true;
        this.deliver(s, { t: 'result', position: 0, classified: false, prize: 0, record, rev, standings: this.standings(game) });
      } catch (err) {
        console.error(`Entry fee for ${s.key} could not be refunded:`, err);
      }
    }
  }

  /** Sends a team its result, or keeps it for when the team's device comes back. */
  private deliver(s: Seat, msg: ResultMessage): void {
    const ws = s.client?.ws;
    if (ws && ws.readyState === ws.OPEN) this.send(s.client, msg);
    else this.unsent.set(s.key, { msg, until: Date.now() + RESULT_KEEP_MS });
  }

  private closeGame(game: Game): void {
    game.run?.stop();
    game.state = 'done';
    this.games.delete(game.id);
    for (const s of game.seats) {
      if (!s) continue;
      if (this.membership.get(s.key) === game) this.membership.delete(s.key);
      if (s.client?.game === game) s.client.game = null;
    }
    this.tellLobby();
  }
}
