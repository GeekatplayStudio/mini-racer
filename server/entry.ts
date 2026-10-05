import { SLOTS } from '../src/data/parts';
import { CONDITIONS, CarBuild, Condition, Fitted } from '../src/game/build';
import { ECU_POINTS, EcuMap, Setup } from '../src/game/ecu';
import { GRID_MAX, GRID_MIN, GameRules, HAZARDS_MAX, LAPS_MAX, WEAR_MAX, WEATHERS } from '../src/net/protocol';
import { trackById } from '../src/net/onlineRace';
import { DriverDef, SKILLS, SKILL_CAP_AT_CREATION, STARTING_POINTS, Skill, pointsAllowed, pointsSpent } from '../src/sim/driver';

// Everything a client sends about its car and driver is rebuilt here field by
// field: only known keys of the right type and range reach the simulation.

const isNum = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isInt = (v: unknown, lo: number, hi: number): v is number => isNum(v, lo, hi) && Number.isInteger(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function column(v: unknown): number[] | null {
  if (!Array.isArray(v) || v.length !== ECU_POINTS || !v.every((x) => isNum(x, -1000, 1000))) return null;
  return v.slice() as number[];
}

function cleanEcu(raw: unknown): EcuMap | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return null;
  const ign = column(raw.ign), lambda = column(raw.lambda), boost = column(raw.boost);
  if (!ign || !lambda || !boost) return null;
  const { revLimit, tc, abs, launchRpm, pitLimit } = raw;
  if (!isNum(revLimit, 0, 30000) || !isNum(tc, 0, 100) || !isNum(abs, 0, 100) || !isNum(launchRpm, 0, 30000) || !isNum(pitLimit, 0, 1000)) return null;
  return { ign, lambda, boost, revLimit, tc, abs, launchRpm, pitLimit };
}

function cleanSetup(raw: unknown): Setup | undefined | null {
  if (raw === undefined || raw === null) return undefined;
  if (!isObject(raw)) return null;
  const { wing, brakeBias, fuel, balance } = raw;
  if (!isNum(wing, -100, 100) || !isNum(brakeBias, -100, 100) || !isNum(fuel, 0, 1000) || !isNum(balance, -100, 100)) return null;
  return { wing, brakeBias, fuel, balance };
}

/** A copy of the car a client entered holding only what a build may hold; null when it is malformed. */
export function cleanBuild(raw: unknown): CarBuild | null {
  if (!isObject(raw) || !isText(raw.id, 64) || !isText(raw.name, 40) || !isObject(raw.parts) || !isObject(raw.livery)) return null;
  const parts: CarBuild['parts'] = {};
  for (const slot of SLOTS) {
    const f = raw.parts[slot.id];
    if (f === undefined || f === null) continue;
    if (!isObject(f) || !isText(f.part, 64) || !isText(f.cond, 8) || !(f.cond in CONDITIONS)) return null;
    parts[slot.id] = { part: f.part, cond: f.cond as Condition } satisfies Fitted;
  }
  const { base, accent, number } = raw.livery;
  if (!isInt(base, 0, 0xffffff) || !isInt(accent, 0, 0xffffff) || !isInt(number, 0, 999)) return null;
  const ecu = cleanEcu(raw.ecu);
  const setup = cleanSetup(raw.setup);
  if (ecu === null || setup === null) return null;
  const build: CarBuild = { id: raw.id, name: raw.name, parts, livery: { base, accent, number } };
  if (ecu) build.ecu = ecu;
  if (setup) build.setup = setup;
  return build;
}

/** A copy of the driver a client entered, checked against the rules for skill points; null when it breaks them. */
export function cleanDriver(raw: unknown): DriverDef | null {
  if (!isObject(raw) || !isText(raw.id, 64) || !isText(raw.name, 40) || !isObject(raw.skills)) return null;
  const name = raw.name.trim().slice(0, 22);
  if (name.length < 2) return null;
  if (!isInt(raw.racesCompleted, 0, 1e6) || !isNum(raw.aggression, 0, 1) || !isNum(raw.risk, 0, 1) || !isNum(raw.weight, 40, 150)) return null;
  const earned = Math.floor(raw.racesCompleted / 10);
  const skills = {} as Record<Skill, number>;
  for (const s of SKILLS) {
    const v = raw.skills[s];
    if (!isInt(v, 0, SKILL_CAP_AT_CREATION + earned)) return null;
    skills[s] = v;
  }
  const last = name.split(/\s+/).pop() ?? name;
  const def: DriverDef = {
    id: raw.id,
    name,
    code: last.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X'),
    nationality: isText(raw.nationality, 3) ? raw.nationality.replace(/[^A-Za-z]/g, '').toUpperCase() : '',
    skills,
    aggression: raw.aggression,
    risk: raw.risk,
    weight: raw.weight,
    racesCompleted: raw.racesCompleted,
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
