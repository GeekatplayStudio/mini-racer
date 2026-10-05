import { CarModel, GT3_CARS, LIVERIES, Livery } from '../data/cars';
import { getPart } from '../data/parts';
import { DriverDef, deriveProfile, generateDriver } from '../sim/driver';
import { computeSpeedProfile } from '../sim/line';
import { PitMode, Race, Weather } from '../sim/race';
import { Rng } from '../sim/rng';
import { Track, TrackDef } from '../sim/track';
import { CarBuild, bodyOf, deriveCar, generateBuild } from './build';
import type { DriverLook } from './profile';
import { PreparedTrack, prepareTrack } from './trackCache';

/** One car on the grid with everything the presentation needs to draw it. */
export interface Entry {
  driver: DriverDef;
  model: CarModel;
  livery: Livery;
  rimColor: number;
  isPlayer: boolean;
  /** Seconds saved per pit stop by the car's jacks and wheel nuts. */
  pitSaving: number;
  /** The driver's face for the radio; drivers without one get a generated face. */
  look?: DriverLook;
}

export interface RaceSession {
  track: Track;
  race: Race;
  /** Indexed by RaceCar.id. */
  entries: Entry[];
  playerCar: number;
  /** False for practice: no fee, no prize, no experience. */
  counts: boolean;
  trackDef: TrackDef;
  /** Grid position the player's car started from, 1-based. */
  playerGrid: number;
}

export interface QuickRaceOptions {
  trackDef: TrackDef;
  gridSize: number;
  laps: number;
  seed: number;
  /** 0-based grid position the player's car starts from. */
  playerGrid: number;
}

const DEFAULT_RIM = 0xb8bcc8;

/** A race with a generated field of fixed-specification cars; used for demos and tests. */
export function createQuickRace(opts: QuickRaceOptions): RaceSession {
  const rng = new Rng(opts.seed);
  const { track, line } = prepareTrack(opts.trackDef);
  const playerGrid = Math.min(Math.max(0, Math.floor(opts.playerGrid)), opts.gridSize - 1);
  const entries: Entry[] = [];
  const codes = new Set<string>();
  for (let i = 0; i < opts.gridSize; i++) {
    entries.push({
      driver: uniqueDriver(rng, i, codes),
      model: GT3_CARS[(i * 3 + rng.int(0, 2)) % GT3_CARS.length],
      livery: LIVERIES[i % LIVERIES.length],
      rimColor: DEFAULT_RIM,
      isPlayer: i === playerGrid,
      pitSaving: 12,
    });
  }
  const race = new Race(
    track,
    entries.map((e) => ({ driver: e.driver, spec: e.model.spec })),
    opts.laps,
    rng.int(1, 0x7fffffff),
    line,
  );
  return { track, race, entries, playerCar: playerGrid, counts: true, trackDef: opts.trackDef, playerGrid: playerGrid + 1 };
}

function uniqueDriver(rng: Rng, index: number, codes: Set<string>): DriverDef {
  // Timing-screen codes must be unique on the grid.
  let driver = generateDriver(rng, index);
  for (let tries = 0; codes.has(driver.code) && tries < 50; tries++) driver = generateDriver(rng, index);
  codes.add(driver.code);
  return driver;
}

/** Pace a car and driver should manage over one lap, used to set the grid. */
function qualifyingLap(ref: PreparedTrack, entry: Entry): number {
  const p = deriveProfile(entry.driver);
  const spec = entry.model.spec;
  const v = computeSpeedProfile(ref.track, ref.line, spec, {
    mass: spec.mass + p.mass + spec.fuelCapacity * 0.35,
    cornerGrip: p.cornerGrip,
    brakeGrip: p.brakeGrip,
  });
  let t = 0;
  for (let i = 0; i < ref.track.n; i++) t += ref.track.ds / v[i];
  return t;
}

function entryFromBuild(build: CarBuild, driver: DriverDef, ref: PreparedTrack, isPlayer: boolean): Entry | null {
  const derived = deriveCar(build, ref);
  const body = bodyOf(build);
  if (!derived.spec || !body) return null;
  const wheels = build.parts.wheels ? getPart(build.parts.wheels.part) : undefined;
  return {
    driver,
    model: { spec: derived.spec, body },
    livery: build.livery,
    rimColor: wheels?.look.c ?? DEFAULT_RIM,
    isPlayer,
    pitSaving: derived.stats?.pitSaving ?? 0,
  };
}

export interface PlayerRaceOptions {
  trackDef: TrackDef;
  car: CarBuild;
  driver: DriverDef;
  gridSize: number;
  laps: number;
  seed: number;
  /** Practice: no fee, no prize, nothing recorded against the driver. */
  practice: boolean;
  /** Put other cars on track in practice too. */
  traffic?: boolean;
  /** Who calls the player's pit stops. */
  pitMode?: PitMode;
  /** Multiplier on tyre wear and fuel use. */
  wearScale?: number;
  /** Most road hazards on track at once; 0 for none. */
  hazards?: number;
  weather?: Weather;
}

/**
 * The player's car and driver against a field built from the parts catalog
 *. The grid is set by each entry's expected lap time.
 */
export function createPlayerRace(opts: PlayerRaceOptions): RaceSession | null {
  const rng = new Rng(opts.seed);
  const ref = prepareTrack(opts.trackDef);
  const player = entryFromBuild(opts.car, opts.driver, ref, true);
  if (!player) return null;

  const entries: Entry[] = [player];
  if (!opts.practice || opts.traffic) {
    const codes = new Set<string>([opts.driver.code]);
    // Harder tracks draw better-funded teams.
    const level = 1.8 + 0.35 * opts.trackDef.difficulty;
    const liveries = LIVERIES.filter((l) => l.base !== opts.car.livery.base);
    for (let i = 1; i < opts.gridSize; i++) {
      const build = generateBuild(rng, level + rng.normal() * 0.5, liveries[(i - 1) % liveries.length], `ai-car-${i}`);
      const entry = entryFromBuild(build, uniqueDriver(rng, i, codes), ref, false);
      if (entry) entries.push(entry);
    }
    const pace = new Map(entries.map((e) => [e, qualifyingLap(ref, e) * (1 + rng.normal() * 0.002)]));
    entries.sort((a, b) => (pace.get(a) ?? 0) - (pace.get(b) ?? 0));
  }

  const race = new Race(
    ref.track,
    entries.map((e) => ({
      driver: e.driver,
      spec: e.model.spec,
      pitSaving: e.pitSaving,
      pitMode: e.isPlayer ? (opts.pitMode ?? 'auto') : 'auto',
    })),
    opts.laps,
    rng.int(1, 0x7fffffff),
    ref.line,
    { wearScale: opts.wearScale ?? 1, hazards: opts.hazards ?? 0, weather: opts.weather ?? 'clear' },
  );
  const playerCar = entries.indexOf(player);
  return { track: ref.track, race, entries, playerCar, counts: !opts.practice, trackDef: opts.trackDef, playerGrid: playerCar + 1 };
}
