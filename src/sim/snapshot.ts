import { CarSpec, CarState } from './car';
import { Hazard, HazardKind, PitPhase, Race, RaceCar, RaceEvent, RacePhase } from './race';
import { Surface } from './track';

/**
 * Race state on the wire. A server that runs the race encodes what the
 * picture and the timing screens read; a client applies it to its own Race,
 * which it built from the same inputs but never steps.
 *
 * Every value is a scaled integer (or null for "no time yet"), so a snapshot
 * is small as JSON and decodes to the same numbers everywhere.
 */
export interface Snapshot {
  /** Race-level values, in RACE_FIELDS order. */
  r: Wire[];
  /** Car ids in race order. */
  o: number[];
  /** Per car, by id: the fast-changing values in CAR_FAST order. */
  c: Wire[][];
  /** Per car, by id: the slow-changing values in CAR_SLOW order. Full snapshots only. */
  s?: Wire[][];
  /** Hazards on the track, in HAZARD_FIELDS order. Full snapshots only. */
  h?: Wire[][];
  /** Puddle sizes, m x 100, in the race's own puddle order. Full snapshots only. */
  p?: Wire[];
  /** Race events since the previous snapshot. */
  e?: RaceEvent[];
}

type Wire = number | null;

/** One value of T on the wire: how to read it, how to write it back, and its resolution. */
interface Field<T> {
  get(from: T): number;
  set(to: T, value: number): void;
  /** Steps per unit: 100 keeps two decimals. 1 for whole numbers and flags. */
  scale: number;
}

function field<T>(scale: number, get: (from: T) => number, set: (to: T, value: number) => void): Field<T> {
  return { get, set, scale };
}

const flag = <T>(get: (from: T) => boolean, set: (to: T, value: boolean) => void): Field<T> =>
  field(1, (from) => (get(from) ? 1 : 0), (to, v) => set(to, v !== 0));

const PHASES: readonly RacePhase[] = ['countdown', 'racing', 'finished'];
const RETIRE_REASONS: readonly RaceCar['retireReason'][] = ['', 'fuel', 'tyres'];
const HAZARD_KINDS: readonly HazardKind[] = ['oil', 'wreck', 'animal', 'tyre', 'debris'];

/** Where a car parked behind the barrier is kept, as in Race. */
const PARKED_D = 1e6;

// To carry a new value, add a row to the table it belongs in: fast rows go out
// with every snapshot, slow rows a few times a second and whenever something happens.

const RACE_FIELDS: readonly Field<Race>[] = [
  field(1, (r) => PHASES.indexOf(r.phase), (r, v) => (r.phase = PHASES[v] ?? 'countdown')),
  field(10000, (r) => r.clock, (r, v) => (r.clock = v)),
  field(10000, (r) => r.time, (r, v) => (r.time = v)),
  field(1, (r) => r.lights, (r, v) => (r.lights = v)),
  field(1000, (r) => r.fastestLap, (r, v) => (r.fastestLap = v)),
  field(1, (r) => r.fastestLapCar, (r, v) => (r.fastestLapCar = v)),
  field(1, (r) => r.steps, (r, v) => (r.steps = v)),
  field(1000, (r) => r.wetness, (r, v) => (r.wetness = v)),
];

const state = (scale: number, key: Exclude<keyof CarState, 'gear'>): Field<RaceCar> =>
  field(scale, (c) => c.state[key], (c, v) => (c.state[key] = v));

const CAR_FAST: readonly Field<RaceCar>[] = [
  state(100, 'x'),
  state(100, 'y'),
  state(10000, 'heading'),
  state(100, 'vx'),
  state(100, 'vy'),
  state(1000, 'yawRate'),
  state(1000, 'steerAngle'),
  field(1, (c) => c.state.gear, (c, v) => (c.state.gear = v)),
  state(1, 'rpm'),
  state(100, 'throttle'),
  state(100, 'brake'),
  state(10, 'ax'),
  state(10, 'ay'),
  state(100, 'slideFront'),
  state(100, 'slideRear'),
  field(1, (c) => c.surface, (c, v) => (c.surface = v as Surface)),
  field(100, (c) => c.progress, (c, v) => (c.progress = v)),
  field(1, (c) => c.pitPhase, (c, v) => (c.pitPhase = v as PitPhase)),
  flag((c) => c.finished, (c, v) => (c.finished = v)),
  flag((c) => c.retired, (c, v) => (c.retired = v)),
  flag((c) => c.parked, (c, v) => (c.parked = v)),
  flag((c) => c.pitRequested, (c, v) => (c.pitRequested = v)),
];

const dent = (zone: number): Field<RaceCar> => field(100, (c) => c.dents[zone], (c, v) => (c.dents[zone] = v));

const CAR_SLOW: readonly Field<RaceCar>[] = [
  field(1, (c) => c.crossings, (c, v) => (c.crossings = v)),
  field(1000, (c) => c.lapStart, (c, v) => (c.lapStart = v)),
  field(1000, (c) => c.lastLap, (c, v) => (c.lastLap = v)),
  field(1000, (c) => c.bestLap, (c, v) => (c.bestLap = v)),
  field(1000, (c) => c.finishTime, (c, v) => (c.finishTime = v)),
  field(1, (c) => c.contacts, (c, v) => (c.contacts = v)),
  field(1, (c) => RETIRE_REASONS.indexOf(c.retireReason), (c, v) => (c.retireReason = RETIRE_REASONS[v] ?? '')),
  flag((c) => c.pitMode === 'manual', (c, v) => (c.pitMode = v ? 'manual' : 'auto')),
  field(100, (c) => c.pitTimer, (c, v) => (c.pitTimer = v)),
  field(1, (c) => c.pitStops, (c, v) => (c.pitStops = v)),
  field(100, (c) => c.pitSaving, (c, v) => (c.pitSaving = v)),
  field(100000, (c) => c.fuelPerLap, (c, v) => (c.fuelPerLap = v)),
  field(1, (c) => c.pace, (c, v) => (c.pace = v)),
  field(1, (c) => c.stance, (c, v) => (c.stance = v)),
  dent(0),
  dent(1),
  dent(2),
  dent(3),
  field(100, (c) => c.dirt, (c, v) => (c.dirt = v)),
  state(100000, 'fuel'),
  state(10000, 'tyreWear'),
  state(1000, 'damage'),
];

const HAZARD_FIELDS: readonly Field<Hazard>[] = [
  field(1, (h) => h.id, (h, v) => (h.id = v)),
  field(1, (h) => HAZARD_KINDS.indexOf(h.kind), (h, v) => (h.kind = HAZARD_KINDS[v] ?? 'debris')),
  field(100, (h) => h.s, (h, v) => (h.s = v)),
  field(100, (h) => h.d, (h, v) => (h.d = v)),
  field(100, (h) => h.x, (h, v) => (h.x = v)),
  field(100, (h) => h.y, (h, v) => (h.y = v)),
  field(100, (h) => h.radius, (h, v) => (h.radius = v)),
  flag((h) => h.solid, (h, v) => (h.solid = v)),
  field(10, (h) => h.life, (h, v) => (h.life = v)),
  field(100, (h) => h.drift, (h, v) => (h.drift = v)),
  field(1, (h) => h.tint, (h, v) => (h.tint = v)),
];

function pack<T>(fields: readonly Field<T>[], from: T): Wire[] {
  const out: Wire[] = new Array(fields.length);
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const v = f.get(from);
    // Only "no lap yet" is ever infinite.
    out[i] = Number.isFinite(v) ? Math.round(v * f.scale) : null;
  }
  return out;
}

function unpack<T>(fields: readonly Field<T>[], row: readonly Wire[], to: T): void {
  // A row from a newer or older build may be a different length: take what both sides know.
  const n = Math.min(fields.length, row.length);
  for (let i = 0; i < n; i++) {
    const v = row[i];
    fields[i].set(to, v === null ? Infinity : v / fields[i].scale);
  }
}

/**
 * Captures the race for the wire.
 * @param full include the slow-changing values and the hazards as well.
 * @param events events to send along; the caller drains race.events itself.
 */
export function encodeSnapshot(race: Race, full: boolean, events?: readonly RaceEvent[]): Snapshot {
  const snap: Snapshot = {
    r: pack(RACE_FIELDS, race),
    o: race.order.map((c) => c.id),
    c: race.cars.map((c) => pack(CAR_FAST, c)),
  };
  if (full) {
    snap.s = race.cars.map((c) => pack(CAR_SLOW, c));
    snap.h = race.hazards.map((h) => pack(HAZARD_FIELDS, h));
    // Puddles sit where the seed put them on both sides; only their size changes.
    if (race.puddles.length) snap.p = race.puddles.map((p) => Math.round(p.radius * 100));
  }
  if (events?.length) snap.e = [...events];
  return snap;
}

function blankHazard(): Hazard {
  return {
    id: 0, kind: 'debris', s: 0, d: 0, x: 0, y: 0, radius: 0, solid: true, life: 0, drift: 0, tint: 0,
    view: {
      spec: { length: 0, width: 0 } as CarSpec,
      state: { x: 0, y: 0, vx: 0, vy: 0, heading: 0 } as CarState,
      loc: { index: 0, s: 0, d: 0 },
      obstacle: true,
      soft: false,
    },
  };
}

/**
 * Writes a snapshot into a race built from the same track and entrants.
 * Events carried by the snapshot are appended to race.events.
 */
export function applySnapshot(race: Race, snap: Snapshot): void {
  unpack(RACE_FIELDS, snap.r, race);
  const track = race.track;
  const full = !!snap.s;

  for (let i = 0; i < race.cars.length; i++) {
    const car = race.cars[i];
    if (snap.c[i]) unpack(CAR_FAST, snap.c[i], car);
    if (snap.s?.[i]) unpack(CAR_SLOW, snap.s[i], car);
    if (car.parked) {
      car.loc = { index: car.loc.index, s: car.loc.s, d: PARKED_D };
    } else {
      // The slow rows arrive after gaps too (joining late, reconnecting): search the whole lap then.
      car.loc = track.locate(car.state.x, car.state.y, full ? -1 : car.loc.index);
    }
  }

  for (let i = 0; i < snap.o.length && i < race.order.length; i++) {
    const car = race.cars[snap.o[i]];
    if (!car) continue;
    race.order[i] = car;
    car.position = i + 1;
  }

  if (snap.h) {
    // Keep the objects the picture already holds; it tells hazards apart by id.
    const known = new Map(race.hazards.map((h) => [h.id, h]));
    race.hazards = snap.h.map((row) => {
      const h = known.get(row[0] ?? 0) ?? blankHazard();
      unpack(HAZARD_FIELDS, row, h);
      const size = h.radius * 2;
      h.view.spec.length = size;
      h.view.spec.width = size;
      h.view.state.x = h.x;
      h.view.state.y = h.y;
      h.view.loc = { index: track.indexAt(h.s), s: h.s, d: h.d };
      h.view.soft = !h.solid;
      return h;
    });
  }

  if (snap.p) {
    for (let i = 0; i < snap.p.length && i < race.puddles.length; i++) {
      const v = snap.p[i];
      if (v !== null) race.puddles[i].radius = v / 100;
    }
  }

  if (snap.e) race.events.push(...snap.e);
}
