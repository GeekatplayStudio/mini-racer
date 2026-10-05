import { SLOTS, getPart } from '../src/data/parts';
import { CONDITION_ORDER, CarBuild, Fitted } from '../src/game/build';
import { ECU_POINTS, EcuMap, Setup } from '../src/game/ecu';
import type { Profile } from '../src/game/profile';
import { GRID_MAX, GRID_MIN, GameRules, HAZARDS_MAX, LAPS_MAX, WEAR_MAX, WEATHERS } from '../src/net/protocol';
import { trackById } from '../src/net/onlineRace';
import { DriverDef, SKILLS, SKILL_CAP_AT_CREATION, STARTING_POINTS, Skill, pointsAllowed, pointsSpent } from '../src/sim/driver';

// Everything a client sends about its car and driver is rebuilt here field by
// field: only known keys of the right type and range reach the simulation.
// Values are read as own properties only, and a value that names something
// (a condition, a part) is looked up in an allow-list, never with `in` or [ ]
// on a plain object: "toString" or "__proto__" must not pass as a name.

/** Most completed races a driver is credited with, whatever the stored team says. */
export const RACES_MAX = 1000;

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A field the client actually sent; nothing inherited. */
export const own = (o: Record<string, unknown>, key: string): unknown => (Object.hasOwn(o, key) ? o[key] : undefined);

function column(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== ECU_POINTS || !v.every((x) => isNum(x, -1000, 1000))) return null;
  return v.slice() as number[];
}

function cleanEcu(raw: unknown): EcuMap | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return null;
  const ign = column(own(raw, 'ign')), lambda = column(own(raw, 'lambda')), boost = column(own(raw, 'boost'));
  if (!ign || !lambda || !boost) return null;
  const revLimit = own(raw, 'revLimit'), tc = own(raw, 'tc'), abs = own(raw, 'abs'), launchRpm = own(raw, 'launchRpm'), pitLimit = own(raw, 'pitLimit');
  if (!isNum(revLimit, 0, 30000) || !isNum(tc, 0, 100) || !isNum(abs, 0, 100) || !isNum(launchRpm, 0, 30000) || !isNum(pitLimit, 0, 1000)) return null;
  return { ign, lambda, boost, revLimit, tc, abs, launchRpm, pitLimit };
}

function cleanSetup(raw: unknown): Setup | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return null;
  const wing = own(raw, 'wing'), brakeBias = own(raw, 'brakeBias'), fuel = own(raw, 'fuel'), balance = own(raw, 'balance');
  if (!isNum(wing, -100, 100) || !isNum(brakeBias, -100, 100) || !isNum(fuel, 0, 1000) || !isNum(balance, -100, 100)) return null;
  return { wing, brakeBias, fuel, balance };
}

/** A copy of the car a client entered holding only what a build may hold; null when it is malformed. */
export function cleanBuild(raw: unknown): CarBuild | null {
  if (!isObject(raw)) return null;
  const id = own(raw, 'id'), name = own(raw, 'name'), rawParts = own(raw, 'parts'), livery = own(raw, 'livery');
  if (!isText(id, 64) || !isText(name, 40) || !isObject(rawParts) || !isObject(livery)) return null;
  const parts: CarBuild['parts'] = {};
  for (const slot of SLOTS) {
    const f = own(rawParts, slot.id);
    if (f === undefined || f === null) continue;
    if (!isObject(f)) return null;
    const part = own(f, 'part');
    const cond = CONDITION_ORDER.find((c) => c === own(f, 'cond'));
    // Only a catalog part made for this slot, in a known condition.
    if (!isText(part, 64) || !cond || getPart(part)?.slot !== slot.id) return null;
    parts[slot.id] = { part, cond } satisfies Fitted;
  }
  const base = own(livery, 'base'), accent = own(livery, 'accent'), number = own(livery, 'number');
  if (!isInt(base, 0, 0xffffff) || !isInt(accent, 0, 0xffffff) || !isInt(number, 0, 999)) return null;
  const ecu = cleanEcu(own(raw, 'ecu'));
  const setup = cleanSetup(own(raw, 'setup'));
  if (ecu === null || setup === null) return null;
  const build: CarBuild = { id, name, parts, livery: { base, accent, number } };
  if (ecu) build.ecu = ecu;
  if (setup) build.setup = setup;
  return build;
}

/**
 * Races a driver has completed, as the team stored on the server says: a
 * client's own figure is never believed, since it lifts the skill caps.
 * 0 for a driver the stored team does not have.
 */
export function storedRaces(stored: Profile | null | undefined, driverId: unknown): number {
  if (!stored || !Array.isArray(stored.drivers) || typeof driverId !== 'string') return 0;
  const known = (stored.drivers as unknown[]).find((d) => isObject(d) && isObject(d.def) && d.def.id === driverId) as { def: { racesCompleted: unknown } } | undefined;
  const races = known?.def.racesCompleted;
  return typeof races === 'number' && Number.isFinite(races) ? Math.min(RACES_MAX, Math.max(0, Math.floor(races))) : 0;
}

/**
 * A copy of the driver a client entered, checked against the rules for skill
 * points; null when it breaks them. `racesCompleted` comes from the server
 * (see storedRaces), not from the client.
 */
export function cleanDriver(raw: unknown, racesCompleted: number): DriverDef | null {
  if (!isObject(raw)) return null;
  const id = own(raw, 'id'), rawName = own(raw, 'name'), rawSkills = own(raw, 'skills');
  const aggression = own(raw, 'aggression'), risk = own(raw, 'risk'), weight = own(raw, 'weight'), nationality = own(raw, 'nationality');
  if (!isText(id, 64) || !isText(rawName, 40) || !isObject(rawSkills)) return null;
  const name = rawName.trim().slice(0, 22);
  if (name.length < 2) return null;
  if (!isInt(racesCompleted, 0, RACES_MAX) || !isNum(aggression, 0, 1) || !isNum(risk, 0, 1) || !isNum(weight, 40, 150)) return null;
  const earned = Math.floor(racesCompleted / 10);
  const skills = {} as Record<Skill, number>;
  for (const s of SKILLS) {
    const v = own(rawSkills, s);
    if (!isInt(v, 0, SKILL_CAP_AT_CREATION + earned)) return null;
    skills[s] = v;
  }
  const last = name.split(/\s+/).pop() ?? name;
  const def: DriverDef = {
    id,
    name,
    code: last.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X'),
    nationality: isText(nationality, 3) ? nationality.replace(/[^A-Za-z]/g, '').toUpperCase() : '',
    skills,
    aggression,
    risk,
    weight,
    racesCompleted,
  };
  if (pointsSpent(def) > Math.max(STARTING_POINTS, pointsAllowed(def))) return null;
  return def;
}

/** The host's choices for a new game, or a message saying what is wrong with them. */
export function cleanRules(raw: Record<string, unknown>): GameRules | string {
  if (typeof raw.trackId !== 'string' || !trackById(raw.trackId)) return 'Unknown circuit';
  if (!isInt(raw.laps, 1, LAPS_MAX)) return `Laps: 1 to ${LAPS_MAX}`;
  if (!isInt(raw.grid, GRID_MIN, GRID_MAX)) return `Grid: ${GRID_MIN} to ${GRID_MAX} cars`;
  if (!isInt(raw.humans, 1, raw.grid)) return 'Human seats: 1 up to the grid size';
  if (!isNum(raw.wearScale, 0.5, WEAR_MAX)) return 'Tyre and fuel use is out of range';
  if (!isInt(raw.hazards, 0, HAZARDS_MAX)) return 'Road hazards are out of range';
  const weather = WEATHERS.find((w) => w === raw.weather);
  if (!weather) return 'Unknown weather';
  return { trackId: raw.trackId, laps: raw.laps, grid: raw.grid, humans: raw.humans, wearScale: raw.wearScale, hazards: raw.hazards, weather };
}
