import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_HISTORY, Profile, upgradeProfile } from '../src/game/profile';
import { NAME_PATTERN, PASSWORD_MAX, PASSWORD_MIN } from '../src/net/protocol';

/** A request the server refuses, with the HTTP status that says why. */
export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

interface UserFile {
  name: string;
  salt: string;
  hash: string;
  created: number;
}

interface ProfileFile {
  /** Goes up by one with every write, so a device can tell whether it has the latest. */
  rev: number;
  updated: number;
  profile: Profile;
}

interface Session {
  user: string;
  expires: number;
}

const SESSION_DAYS = 30;
const SESSIONS_PER_USER = 8;
const KEY_LENGTH = 64;
/** Most characters of JSON one saved team may take. */
export const PROFILE_LIMIT = 256 * 1024;

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

const digest = (token: string): string => createHash('sha256').update(token).digest('hex');

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** Waits without giving up the thread; only for the short retries below. */
const sleepSync = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/** Errors a rename gives on Windows while a virus scanner or indexer briefly holds the file. */
const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);

/** Writes beside the target and renames over it, so a crash never leaves half a file. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 5 || !BUSY.has((err as NodeJS.ErrnoException).code ?? '')) {
        rmSync(tmp, { force: true });
        throw err;
      }
      sleepSync(10 * 2 ** attempt);
    }
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A car the server can read: the game checks the rest when it is raced. */
function sound(car: unknown): boolean {
  return isObject(car) && typeof car.id === 'string' && isObject(car.parts);
}

/** A driver the server can bank a race to. */
function soundDriver(d: unknown): boolean {
  if (!isObject(d) || !isObject(d.def)) return false;
  const { id, racesCompleted, skills } = d.def;
  return typeof id === 'string' && typeof racesCompleted === 'number' && Number.isFinite(racesCompleted) && racesCompleted >= 0 && isObject(skills);
}

/**
 * Checks a team sent by a client and trims it for storage. Photos are large
 * pictures and stay on the device that took them.
 */
export function cleanProfile(raw: unknown): Profile {
  const p = raw as Profile | null;
  if (!p || typeof p !== 'object' || p.version !== 1 || !Array.isArray(p.cars) || !Array.isArray(p.drivers)) {
    throw new ApiError(400, 'That is not a team file');
  }
  if (typeof p.money !== 'number' || !Number.isFinite(p.money)) throw new ApiError(400, 'That is not a team file');
  if (p.cars.length > 20 || p.drivers.length > 20) throw new ApiError(400, 'Too many cars or drivers');
  // A malformed entry would break banking a race result later, on the server.
  if (!p.cars.every(sound) || !p.drivers.every(soundDriver)) throw new ApiError(400, 'That is not a team file');
  const out = upgradeProfile({ ...p, photos: [] });
  // Test mode makes entries free; it never reaches a team kept online.
  out.admin = false;
  out.history = out.history.slice(0, MAX_HISTORY);
  out.races = Number.isFinite(out.races) ? out.races : 0;
  out.wins = Number.isFinite(out.wins) ? out.wins : 0;
  if (JSON.stringify(out).length > PROFILE_LIMIT) throw new ApiError(413, 'The team file is too large');
  return out;
}

/** User accounts, sessions and saved teams, kept as JSON files in one directory. */
export class Accounts {
  private readonly users: string;
  private readonly profiles: string;
  private readonly sessionFile: string;
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly dir: string) {
    this.users = join(dir, 'users');
    this.profiles = join(dir, 'profiles');
    this.sessionFile = join(dir, 'sessions.json');
    mkdirSync(this.users, { recursive: true });
    mkdirSync(this.profiles, { recursive: true });
    const saved = readJson<Record<string, Session>>(this.sessionFile) ?? {};
    const now = Date.now();
    for (const [key, s] of Object.entries(saved)) {
      if (s && typeof s.user === 'string' && s.expires > now) this.sessions.set(key, s);
    }
  }

  /** Names are unique whatever their case; the lower-case form is the key everywhere. */
  static key(name: string): string {
    return name.toLowerCase();
  }

  // The prefix keeps names such as "con" or "nul" from being device names on Windows.
  private userFile(key: string): string {
    return join(this.users, `u-${key}.json`);
  }

  private profileFile(key: string): string {
    return join(this.profiles, `p-${key}.json`);
  }

  private static check(name: unknown, password: unknown): asserts name is string {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      throw new ApiError(400, 'User name: 3 to 20 letters, digits, _ or -');
    }
    if (typeof password !== 'string' || password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
      throw new ApiError(400, `Password: ${PASSWORD_MIN} to ${PASSWORD_MAX} characters`);
    }
  }

  async register(name: unknown, password: unknown): Promise<{ name: string; token: string }> {
    Accounts.check(name, password);
    const key = Accounts.key(name);
    if (existsSync(this.userFile(key))) throw new ApiError(409, 'That user name is taken');
    const salt = randomBytes(16);
    const hash = await hashPassword(password as string, salt);
    // Someone else may have taken the name while the hash was being worked out.
    if (existsSync(this.userFile(key))) throw new ApiError(409, 'That user name is taken');
    const user: UserFile = { name, salt: salt.toString('hex'), hash: hash.toString('hex'), created: Date.now() };
    writeJson(this.userFile(key), user);
    return { name, token: this.open(key) };
  }

  async login(name: unknown, password: unknown): Promise<{ name: string; token: string }> {
    const bad = new ApiError(401, 'Wrong user name or password');
    if (typeof name !== 'string' || typeof password !== 'string' || !NAME_PATTERN.test(name) || password.length > PASSWORD_MAX) throw bad;
    const key = Accounts.key(name);
    const user = readJson<UserFile>(this.userFile(key));
    // Hash even for an unknown name, so the reply takes as long either way.
    const salt = user ? Buffer.from(user.salt, 'hex') : Buffer.alloc(16);
    const hash = await hashPassword(password, salt);
    if (!user) throw bad;
    const want = Buffer.from(user.hash, 'hex');
    if (want.length !== hash.length || !timingSafeEqual(want, hash)) throw bad;
    return { name: user.name, token: this.open(key) };
  }

  private open(key: string): string {
    const token = randomBytes(32).toString('hex');
    const mine = [...this.sessions].filter(([, s]) => s.user === key).sort((a, b) => a[1].expires - b[1].expires);
    while (mine.length >= SESSIONS_PER_USER) this.sessions.delete((mine.shift() as [string, Session])[0]);
    // Only a digest is kept: a copy of the data directory does not hand out working tokens.
    this.sessions.set(digest(token), { user: key, expires: Date.now() + SESSION_DAYS * 86400e3 });
    this.saveSessions();
    return token;
  }

  private saveSessions(): void {
    writeJson(this.sessionFile, Object.fromEntries(this.sessions));
  }

  /** The account a token belongs to: its key and display name. */
  whoIs(token: unknown): { key: string; name: string } | null {
    if (typeof token !== 'string' || token.length !== 64) return null;
    const id = digest(token);
    const s = this.sessions.get(id);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.sessions.delete(id);
      return null;
    }
    const user = readJson<UserFile>(this.userFile(s.user));
    return user ? { key: s.user, name: user.name } : null;
  }

  logout(token: string): void {
    if (this.sessions.delete(digest(token))) this.saveSessions();
  }

  loadProfile(key: string): { rev: number; profile: Profile } | null {
    const f = readJson<ProfileFile>(this.profileFile(key));
    return f && f.profile ? { rev: f.rev, profile: f.profile } : null;
  }

  profileRev(key: string): number {
    return this.loadProfile(key)?.rev ?? 0;
  }

  /**
   * Stores a team and returns its new revision. With `base`, only when the
   * stored team is still that revision: a device must not overwrite changes
   * it has not seen, such as a race result banked here.
   */
  saveProfile(key: string, profile: Profile, base?: number): number {
    const current = this.profileRev(key);
    if (base !== undefined && base !== current) throw new ApiError(409, 'The team was changed somewhere else');
    const rev = current + 1;
    const file: ProfileFile = { rev, updated: Date.now(), profile };
    writeJson(this.profileFile(key), file);
    return rev;
  }

  /** Changes the stored team in place, if there is one. Returns the revision afterwards (0 for none). */
  updateProfile(key: string, change: (profile: Profile) => void): number {
    const stored = this.loadProfile(key);
    if (!stored) return 0;
    change(stored.profile);
    return this.saveProfile(key, stored.profile);
  }

  get directory(): string {
    return this.dir;
  }
}

/** Counts attempts per address in a fixed window; used on sign-in and registration. */
export class RateLimit {
  private readonly hits = new Map<string, { count: number; reset: number }>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** False when this address has used up its attempts for now. */
  allow(who: string): boolean {
    const now = Date.now();
    if (this.hits.size > 10000) {
      for (const [k, v] of this.hits) if (v.reset < now) this.hits.delete(k);
    }
    const h = this.hits.get(who);
    if (!h || h.reset < now) {
      this.hits.set(who, { count: 1, reset: now + this.windowMs });
      return true;
    }
    h.count++;
    return h.count <= this.max;
  }
}
