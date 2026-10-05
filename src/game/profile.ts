import { LIVERIES } from '../data/cars';
import { Part, SLOTS, SlotId, getPart } from '../data/parts';
import type { PreparedTrack } from './trackCache';
import type { Weather } from '../sim/race';
import {
  DriverDef,
  SKILLS,
  SKILL_CAP_AT_CREATION,
  STARTING_POINTS,
  Skill,
  pointsAllowed,
  pointsSpent,
} from '../sim/driver';
import type { TrackDef } from '../sim/track';
import { CarBuild, Condition, MAX_CARS, autoBuild, buildResale, completionKit, deriveCar, incompatibility, newBuildId, orphanedBy, resaleValue, swapCost } from './build';
import { tunedMap } from './ecu';

export const STARTING_MONEY = 300000;
export const MAX_DRIVERS = 3;

/** Preset-based driver appearance. Indices into the option lists in the UI. */
export interface DriverLook {
  sex: number;
  skin: number;
  hair: number;
  hairColor: number;
  beard: number;
  helmet: number;
  suit: number;
  age: number;
  face: number;
  eyes: number;
  glasses: number;
  hat: number;
}

export interface PlayerDriver {
  def: DriverDef;
  look: DriverLook;
}

/** Everything the player owns. Saved as one JSON document. */
export interface Profile {
  version: 1;
  money: number;
  cars: CarBuild[];
  drivers: PlayerDriver[];
  selectedCar: string | null;
  selectedDriver: string | null;
  races: number;
  wins: number;
  /** Test mode: nothing costs money and locked settings can be edited. */
  admin: boolean;
  prefs: RacePrefs;
  history: RaceRecord[];
  photos: Photo[];
}

/** The player's choices on the race entry screen. */
export interface RacePrefs {
  trackId: string;
  /** 0 sprint, 1 feature, 2 endurance. */
  distance: number;
  /** Multiplier on tyre wear and fuel use. */
  wearScale: number;
  /** Who calls pit stops for the player's car. */
  pitMode: 'auto' | 'manual';
  /** Other cars on track during practice. */
  traffic: boolean;
  /** Most road hazards on track at once; 0 for none. */
  hazards: number;
  weather: Weather;
}

export const WEATHERS: readonly { id: Weather; label: string }[] = [
  { id: 'clear', label: 'Dry' },
  { id: 'rain', label: 'Showers' },
  { id: 'snow', label: 'Light snow' },
];

export const HAZARD_LEVELS: readonly { label: string; max: number }[] = [
  { label: 'Off', max: 0 },
  { label: 'Few (2)', max: 2 },
  { label: 'Some (5)', max: 5 },
  { label: 'Many (10)', max: 10 },
  { label: 'Chaos (18)', max: 18 },
];

export const DISTANCES: readonly { label: string; laps: number }[] = [
  { label: 'Sprint', laps: 1 },
  { label: 'Feature', laps: 3 },
  { label: 'Endurance', laps: 8 },
];
export const WEAR_SCALES: readonly { label: string; scale: number }[] = [
  { label: 'Real', scale: 1 },
  { label: 'Fast x6', scale: 6 },
  { label: 'Brutal x15', scale: 15 },
];

export function defaultPrefs(): RacePrefs {
  return { trackId: 'brands-hatch-indy', distance: 0, wearScale: 1, pitMode: 'auto', traffic: false, hazards: 0, weather: 'clear' };
}

/** One line of the team's race history. */
export interface RaceRecord {
  /** Milliseconds since 1970. */
  date: number;
  trackId: string;
  practice: boolean;
  /** 0 when the car did not finish. */
  position: number;
  grid: number;
  entries: number;
  laps: number;
  lapsDone: number;
  bestLap: number;
  raceTime: number;
  pitStops: number;
  fee: number;
  prize: number;
  car: string;
  driver: string;
  driverId: string;
  /** Empty when classified; otherwise why the car stopped. */
  retired: string;
  /** Id of the finish-line photo, if one was taken. */
  photo?: string;
}

export interface Photo {
  id: string;
  kind: 'team' | 'finish';
  /** JPEG data URL. */
  data: string;
  caption: string;
  date: number;
}

export const MAX_PHOTOS = 10;
export const MAX_HISTORY = 200;

/** Takes money for a purchase; in test mode everything is free. False when the team cannot pay. */
export function charge(profile: Profile, cost: number): boolean {
  if (profile.admin) return true;
  if (cost > profile.money) return false;
  profile.money -= cost;
  return true;
}

/** Pays money in; nothing is earned in test mode, so it cannot be used to fill the bank. */
function credit(profile: Profile, amount: number): void {
  if (!profile.admin) profile.money += amount;
}

/** Fills in fields that older saves do not have. */
/** Race rules from storage, a server or the address bar, reduced to values the game understands. */
export function sanitizePrefs(raw: Partial<RacePrefs> | null | undefined): RacePrefs {
  const d = defaultPrefs();
  const p = { ...d, ...(raw ?? {}) };
  const int = (v: unknown, lo: number, hi: number, fallback: number): number =>
    typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback;
  return {
    trackId: typeof p.trackId === 'string' ? p.trackId : d.trackId,
    distance: int(p.distance, 0, DISTANCES.length - 1, d.distance),
    wearScale: typeof p.wearScale === 'number' && Number.isFinite(p.wearScale) && p.wearScale >= 0.5 && p.wearScale <= 20 ? p.wearScale : d.wearScale,
    pitMode: p.pitMode === 'manual' ? 'manual' : 'auto',
    traffic: p.traffic === true,
    hazards: int(p.hazards, 0, 18, d.hazards),
    weather: p.weather === 'rain' || p.weather === 'snow' ? p.weather : 'clear',
  };
}

export function upgradeProfile(p: Profile): Profile {
  p.admin = p.admin === true;
  p.history = Array.isArray(p.history) ? p.history : [];
  p.photos = Array.isArray(p.photos) ? p.photos : [];
  p.prefs = sanitizePrefs(p.prefs);
  return p;
}

export function addPhoto(profile: Profile, kind: Photo['kind'], data: string, caption: string): Photo {
  const photo: Photo = { id: `ph-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e5).toString(36)}`, kind, data, caption, date: Date.now() };
  profile.photos.unshift(photo);
  // Storage is small: keep the newest.
  profile.photos.length = Math.min(profile.photos.length, MAX_PHOTOS);
  return photo;
}

export function recordRace(profile: Profile, record: RaceRecord): void {
  profile.history.unshift(record);
  profile.history.length = Math.min(profile.history.length, MAX_HISTORY);
}

/** Replaces every part except the chassis with the best set the budget buys, trading in the old parts. */
export function applyAutoBuild(profile: Profile, car: CarBuild, ref: PreparedTrack, reserve: number): Result {
  let tradeIn = 0;
  for (const slot of SLOTS) if (slot.id !== 'chassis') tradeIn += resaleValue(car.parts[slot.id]);
  const budget = profile.admin ? Number.MAX_SAFE_INTEGER : profile.money + tradeIn - reserve;
  const result = autoBuild(car, budget, ref);
  if (!result) return fail('Not enough money for even the cheapest parts');
  if (!profile.admin) profile.money += tradeIn - result.cost;
  car.parts = result.build.parts;
  car.ecu = undefined;
  return ok;
}

/** Where the profile is kept. A server-backed store can replace the local one. */
export interface ProfileStore {
  load(): Profile | null;
  /** False when the team could not be written, e.g. browser storage is full. */
  save(profile: Profile): boolean;
}

export class MemoryStore implements ProfileStore {
  private data: string | null = null;
  load(): Profile | null {
    return this.data ? (JSON.parse(this.data) as Profile) : null;
  }
  save(profile: Profile): boolean {
    this.data = JSON.stringify(profile);
    return true;
  }
}

export class LocalStore implements ProfileStore {
  constructor(private readonly key = 'miniracer.profile.v1') {}
  load(): Profile | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const p = JSON.parse(raw) as Profile;
      return p && p.version === 1 && Array.isArray(p.cars) && Array.isArray(p.drivers) ? upgradeProfile(p) : null;
    } catch {
      return null;
    }
  }
  save(profile: Profile): boolean {
    try {
      localStorage.setItem(this.key, JSON.stringify(profile));
      return true;
    } catch {
      // Storage full or blocked: the game carries on, and the caller tells the player.
      return false;
    }
  }
}

export function newProfile(): Profile {
  return { version: 1, money: STARTING_MONEY, cars: [], drivers: [], selectedCar: null, selectedDriver: null, races: 0, wins: 0, admin: false, history: [], photos: [], prefs: defaultPrefs() };
}

export type Result = { ok: true } | { ok: false; reason: string };
const ok: Result = { ok: true };
const fail = (reason: string): Result => ({ ok: false, reason });

// --- Cars -------------------------------------------------------------------

/** Buys a chassis and starts a new car around it. */
export function buyCar(profile: Profile, chassis: Part, cond: Condition, name: string): Result {
  if (profile.cars.length >= MAX_CARS) return fail(`The garage holds ${MAX_CARS} cars`);
  if (chassis.slot !== 'chassis') return fail('Not a chassis');
  const car: CarBuild = {
    id: newBuildId(),
    name: name.trim().slice(0, 24) || chassis.name.replace(' shell', ''),
    parts: {},
    livery: { ...LIVERIES[profile.cars.length % LIVERIES.length] },
  };
  const cost = swapCost(car, chassis, cond);
  if (!charge(profile, cost)) return fail('Not enough money');
  car.parts.chassis = { part: chassis.id, cond };
  profile.cars.push(car);
  profile.selectedCar = car.id;
  return ok;
}

/** Fits a part, trading in whatever was in the slot. */
export function fitPart(profile: Profile, car: CarBuild, part: Part, cond: Condition): Result {
  const why = incompatibility(car, part);
  if (why) return fail(why);
  let refund = 0;
  const orphans = orphanedBy(car, part);
  for (const slot of orphans) refund += resaleValue(car.parts[slot]);
  const cost = swapCost(car, part, cond) - refund;
  if (!charge(profile, cost)) return fail('Not enough money');
  for (const slot of orphans) delete car.parts[slot];
  car.parts[part.slot] = { part: part.id, cond };
  return ok;
}

/** Fills every empty slot with the cheapest part that fits, as one purchase. */
export function fitKit(profile: Profile, car: CarBuild, cond: Condition): Result {
  const kit = completionKit(car, cond);
  if (!kit.parts.length) return fail('Nothing is missing');
  if (!charge(profile, kit.cost)) return fail('Not enough money');
  for (const part of kit.parts) car.parts[part.slot] = { part: part.id, cond };
  return ok;
}

export const DYNO_FEE = 1500;

/**
 * Pays a tuner for a dyno session: a sound map for the fitted hardware, with
 * a safety margin a careful owner can still improve on by hand.
 */
export function dynoSession(profile: Profile, car: CarBuild): Result {
  const d = deriveCar(car);
  if (!d.hardware) return fail('The engine cannot run yet');
  if (!charge(profile, DYNO_FEE)) return fail('Not enough money');
  const keep = d.ecu;
  car.ecu = { ...tunedMap(d.hardware, 1.5), tc: keep?.tc ?? 8, abs: keep?.abs ?? 8, launchRpm: keep?.launchRpm ?? d.hardware.redline * 0.55, pitLimit: keep?.pitLimit ?? 60 };
  return ok;
}

/** Removes a part and pays its resale value. The chassis can only go with the whole car. */
export function removePart(profile: Profile, car: CarBuild, slot: SlotId): Result {
  if (slot === 'chassis') return fail('Sell the car to remove its chassis');
  const f = car.parts[slot];
  if (!f || !getPart(f.part)) return fail('Nothing fitted');
  credit(profile, resaleValue(f));
  delete car.parts[slot];
  return ok;
}

export function sellCar(profile: Profile, carId: string): Result {
  const i = profile.cars.findIndex((c) => c.id === carId);
  if (i < 0) return fail('No such car');
  credit(profile, buildResale(profile.cars[i]));
  profile.cars.splice(i, 1);
  if (profile.selectedCar === carId) profile.selectedCar = profile.cars[0]?.id ?? null;
  return ok;
}

// --- Drivers ----------------------------------------------------------------

/** Highest value one skill may hold: 20 at creation, rising with career points. */
export function skillCap(def: DriverDef): number {
  return SKILL_CAP_AT_CREATION + (pointsAllowed(def) - STARTING_POINTS);
}

export function blankDriver(): DriverDef {
  const skills = {} as Record<Skill, number>;
  for (const s of SKILLS) skills[s] = 0;
  return {
    id: `drv-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    name: '', code: '', nationality: 'GBR', skills, aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0,
  };
}

export function validateNewDriver(def: DriverDef): Result {
  if (def.name.trim().length < 2) return fail('Give the driver a name');
  for (const s of SKILLS) {
    const v = def.skills[s];
    if (!Number.isInteger(v) || v < 0 || v > SKILL_CAP_AT_CREATION) return fail('A skill is out of range');
  }
  const spent = pointsSpent(def);
  if (spent > STARTING_POINTS) return fail('More than 100 points spent');
  if (spent < STARTING_POINTS) return fail(`Spend all 100 points (${STARTING_POINTS - spent} left)`);
  return ok;
}

/** Signs a new driver. From here the allocation is locked. */
export function hireDriver(profile: Profile, def: DriverDef, look: DriverLook): Result {
  if (profile.drivers.length >= MAX_DRIVERS) return fail(`The team holds ${MAX_DRIVERS} drivers`);
  const valid = validateNewDriver(def);
  if (!valid.ok) return valid;
  const name = def.name.trim().slice(0, 22);
  const last = name.split(/\s+/).pop() ?? name;
  const driver: DriverDef = {
    ...def,
    name,
    code: last.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X'),
    skills: { ...def.skills },
    racesCompleted: 0,
  };
  profile.drivers.push({ def: driver, look: { ...look } });
  profile.selectedDriver = driver.id;
  return ok;
}

export function pointsAvailable(def: DriverDef): number {
  return pointsAllowed(def) - pointsSpent(def);
}

/** Spends one earned point. Points can only ever be added. */
export function addSkillPoint(def: DriverDef, skill: Skill): Result {
  if (pointsAvailable(def) <= 0) return fail('No points to spend');
  if (def.skills[skill] >= skillCap(def)) return fail('That skill is at its limit');
  def.skills[skill] += 1;
  return ok;
}

export function fireDriver(profile: Profile, driverId: string): Result {
  const i = profile.drivers.findIndex((d) => d.def.id === driverId);
  if (i < 0) return fail('No such driver');
  profile.drivers.splice(i, 1);
  if (profile.selectedDriver === driverId) profile.selectedDriver = profile.drivers[0]?.def.id ?? null;
  return ok;
}

// --- Economy ----------------------------------------------------------------

export function entryFee(track: TrackDef): number {
  return 2500 + 1500 * track.difficulty;
}

const PRIZE_SHARE = [0.26, 0.18, 0.13, 0.1, 0.08, 0.065, 0.05, 0.04, 0.03, 0.025];

/** Prize for a finishing position; harder tracks pay more. */
export function prizeMoney(track: TrackDef, position: number): number {
  const pool = 60000 * (0.6 + 0.4 * track.difficulty);
  const share = PRIZE_SHARE[position - 1] ?? 0.015;
  return Math.round((pool * share) / 100) * 100;
}

/**
 * Takes the entry fee. A team that cannot pay still gets in on a wildcard
 * entry, so the player can never be locked out of racing.
 */
export function payEntry(profile: Profile, track: TrackDef): { paid: number; wildcard: boolean } {
  const fee = entryFee(track);
  if (profile.admin) return { paid: 0, wildcard: false };
  if (profile.money < fee) return { paid: 0, wildcard: true };
  profile.money -= fee;
  return { paid: fee, wildcard: false };
}

/** Banks the result of a race: prize money, win count and driver experience. */
export function settleRace(profile: Profile, driverId: string, track: TrackDef, position: number): number {
  const prize = profile.admin ? 0 : prizeMoney(track, position);
  credit(profile, prize);
  profile.races += 1;
  if (position === 1) profile.wins += 1;
  const driver = profile.drivers.find((d) => d.def.id === driverId);
  if (driver) driver.def.racesCompleted += 1;
  return prize;
}
