import { LIVERIES } from '../data/cars';
import { getPart } from '../data/parts';
import { TRACKS } from '../data/tracks';
import { CarBuild, bodyOf, deriveCar, generateBuild } from '../game/build';
import type { Entry, RaceSession } from '../game/raceSetup';
import { PreparedTrack, prepareTrack } from '../game/trackCache';
import { DriverDef, deriveProfile, generateDriver } from '../sim/driver';
import { computeSpeedProfile } from '../sim/line';
import { Race, RaceOptions } from '../sim/race';
import { Rng } from '../sim/rng';
import type { TrackDef } from '../sim/track';
import type { OnlineEntrant, OnlineRaceSetup } from './protocol';

const DEFAULT_RIM = 0xb8bcc8;

export function trackById(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}

function entryOf(build: CarBuild, driver: DriverDef, ref: PreparedTrack, isPlayer: boolean): Entry | null {
  const derived = deriveCar(build, ref);
  const body = bodyOf(build);
  if (!derived.legal || !derived.spec || !body) return null;
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

/** True when the build is a complete, race-legal car on this circuit. */
export function raceLegal(build: CarBuild, trackDef: TrackDef): boolean {
  return entryOf(build, { code: '' } as DriverDef, prepareTrack(trackDef), false) !== null;
}

/** Lap a car and driver should manage, used to set the grid. */
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

export interface OnlinePlan {
  trackId: string;
  laps: number;
  /** Cars wanted on the grid; bots fill what the human teams leave. */
  grid: number;
  options: RaceOptions;
}

/**
 * Server side: fills the grid around the human entries with bots from the
 * parts catalog, as a single-player race does, and sets the grid by expected
 * lap time. Null when the circuit is unknown or a human car is not legal.
 */
export function planOnlineRace(plan: OnlinePlan, humans: readonly OnlineEntrant[], seed: number): OnlineRaceSetup | null {
  const trackDef = trackById(plan.trackId);
  if (!trackDef) return null;
  const ref = prepareTrack(trackDef);
  const rng = new Rng(seed);
  const field: { entrant: OnlineEntrant; entry: Entry }[] = [];
  // Timing-screen codes must be unique on the grid; two teams may well bring a "SMI".
  const codes = new Set<string>();
  for (const human of humans) {
    let code = human.driver.code;
    for (let n = 2; codes.has(code) && n < 100; n++) code = `${human.driver.code.slice(0, n < 10 ? 2 : 1)}${n}`;
    codes.add(code);
    const entrant = code === human.driver.code ? human : { ...human, driver: { ...human.driver, code } };
    const entry = entryOf(entrant.build, entrant.driver, ref, false);
    if (!entry) return null;
    field.push({ entrant, entry });
  }

  // Harder tracks draw better-funded teams.
  const level = 1.8 + 0.35 * trackDef.difficulty;
  const taken = new Set(humans.map((e) => e.build.livery.base));
  const free = LIVERIES.filter((l) => !taken.has(l.base));
  const liveries = free.length ? free : LIVERIES;
  for (let i = humans.length; i < plan.grid; i++) {
    const build = generateBuild(rng, level + rng.normal() * 0.5, liveries[(i - humans.length) % liveries.length], `ai-car-${i}`);
    let driver = generateDriver(rng, i);
    for (let tries = 0; codes.has(driver.code) && tries < 50; tries++) driver = generateDriver(rng, i);
    codes.add(driver.code);
    const entry = entryOf(build, driver, ref, false);
    if (entry) field.push({ entrant: { build, driver }, entry });
  }

  const pace = new Map(field.map((f) => [f, qualifyingLap(ref, f.entry) * (1 + rng.normal() * 0.002)]));
  field.sort((a, b) => (pace.get(a) ?? 0) - (pace.get(b) ?? 0));
  return {
    trackId: trackDef.id,
    laps: plan.laps,
    seed: rng.int(1, 0x7fffffff),
    options: plan.options,
    entrants: field.map((f) => f.entrant),
  };
}

/**
 * Builds the race a setup describes. The server steps the result; a client
 * only fills it from snapshots. `playerCar` is the grid index of the viewer's own car.
 */
export function sessionFromSetup(setup: OnlineRaceSetup, playerCar: number): RaceSession | null {
  const trackDef = trackById(setup.trackId);
  if (!trackDef) return null;
  const ref = prepareTrack(trackDef);
  const entries: Entry[] = [];
  for (let i = 0; i < setup.entrants.length; i++) {
    const e = setup.entrants[i];
    const entry = entryOf(e.build, e.driver, ref, i === playerCar);
    if (!entry) return null;
    entries.push(entry);
  }
  const race = new Race(
    ref.track,
    entries.map((e, i) => ({ driver: e.driver, spec: e.model.spec, pitSaving: e.pitSaving, pitMode: setup.entrants[i].pitMode ?? 'auto' })),
    setup.laps,
    setup.seed,
    ref.line,
    setup.options,
  );
  return { track: ref.track, race, entries, playerCar, counts: true, trackDef, playerGrid: playerCar + 1 };
}
