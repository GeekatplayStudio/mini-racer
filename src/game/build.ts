import { BodyStyle, Livery, makeEngine } from '../data/cars';
import { alias } from '../data/naming';
import { ChassisData, PARTS, Part, SLOTS, SlotDef, SlotId, getPart, partsForSlot } from '../data/parts';
import { CarSpec, Controls, createCarState, engineTorque, stepCar } from '../sim/car';
import { computeSpeedProfile } from '../sim/line';
import { AIR_DENSITY, GRAVITY, clamp } from '../sim/math';
import { Rng } from '../sim/rng';
import {
  ECU_POINTS,
  EcuMap,
  EcuResult,
  EngineHardware,
  RATED_BOOST,
  Setup,
  evaluateEcu,
  sanitizeMap,
  sanitizeSetup,
  tunedMap,
} from './ecu';
import type { PreparedTrack } from './trackCache';

export type Condition = 'new' | 'used' | 'worn';

export interface ConditionDef {
  label: string;
  /** Fraction of the new price. */
  price: number;
  /** Fraction of the part's performance that is left. */
  perf: number;
  /** Multiplier on the part's reliability. */
  rel: number;
  /** Wear a set of tyres in this condition starts with. */
  tyreWear: number;
}

export const CONDITIONS: Record<Condition, ConditionDef> = {
  new: { label: 'New', price: 1, perf: 1, rel: 1, tyreWear: 0 },
  used: { label: 'Used', price: 0.6, perf: 0.985, rel: 0.997, tyreWear: 0.25 },
  worn: { label: 'Worn', price: 0.35, perf: 0.955, rel: 0.993, tyreWear: 0.5 },
};
export const CONDITION_ORDER: readonly Condition[] = ['new', 'used', 'worn'];

/** Fraction of a part's current price paid back when it is sold or traded in. */
export const RESALE = 0.6;
export const MAX_CARS = 5;

export interface Fitted {
  part: string;
  cond: Condition;
}

/** A car as the player owns it: parts, engine map and set-up. Pure data, saved as is. */
export interface CarBuild {
  id: string;
  name: string;
  parts: Partial<Record<SlotId, Fitted>>;
  livery: Livery;
  /** Engine map; absent means the safe base map. */
  ecu?: EcuMap;
  setup?: Setup;
}

export interface CarStats {
  powerHp: number;
  torqueNm: number;
  massKg: number;
  /** hp per tonne, with driver. */
  powerToWeight: number;
  topSpeedKmh: number;
  /** 0-100 km/h, s. */
  accel: number;
  /** 200-0 km/h, m. */
  braking: number;
  /** Downforce at 200 km/h, kg. */
  downforceKg: number;
  dragCdA: number;
  /** Share of downforce on the front axle, before the stability limit. */
  aeroFront: number;
  /** Peak cornering at 120 km/h, g. */
  gripG: number;
  shiftMs: number;
  /** Chance of finishing a race without a mechanical failure, 0..1. */
  reliability: number;
  fuelKg: number;
  /** Fuel burned per benchmark lap, kg, and laps on the starting load. */
  fuelPerLap: number;
  fuelLaps: number;
  /** Benchmark laps before the tyres are finished. */
  tyreLaps: number;
  revLimit: number;
  frontWeight: number;
  safety: number;
  comfort: number;
  /** Seconds saved per pit stop by jacks and wheel nuts. */
  pitSaving: number;
  /** Reference-driver lap of the benchmark track, s. */
  lapTime: number;
  /** 0-100 overall rating from lap time and reliability. */
  rating: number;
}

export interface DerivedCar {
  /** Every needed slot filled and every part compatible. */
  legal: boolean;
  missing: SlotId[];
  issues: string[];
  /** Advice that does not stop the car racing, e.g. ECU warnings. */
  notes: string[];
  /** Sum of the current value of all fitted parts. */
  value: number;
  massKg: number;
  chassis: ChassisData | null;
  /** Present once chassis, engine, gearbox and tyres are fitted. */
  spec: CarSpec | null;
  stats: CarStats | null;
  /** Engine hardware limits and the evaluated map, for the tuning screen. */
  hardware: EngineHardware | null;
  ecu: EcuMap | null;
  ecuResult: EcuResult | null;
  setup: Setup | null;
}

export function partPrice(part: Part, cond: Condition): number {
  return Math.round((part.price * CONDITIONS[cond].price) / 10) * 10;
}

export function resaleValue(fitted: Fitted | undefined): number {
  if (!fitted) return 0;
  const part = getPart(fitted.part);
  return part ? Math.round((partPrice(part, fitted.cond) * RESALE) / 10) * 10 : 0;
}

/** Money needed to fit a part, after trading in whatever is in the slot. Negative means money back. */
export function swapCost(build: CarBuild, part: Part, cond: Condition): number {
  return partPrice(part, cond) - resaleValue(build.parts[part.slot]);
}

/** What selling the whole car returns. */
export function buildResale(build: CarBuild): number {
  let total = 0;
  for (const slot of SLOTS) total += resaleValue(build.parts[slot.id]);
  return total;
}

function partIn(build: CarBuild, slot: SlotId): Part | undefined {
  const f = build.parts[slot];
  return f ? getPart(f.part) : undefined;
}

/** Whether a slot exists on this car: forced-induction slots only with a turbocharged engine. */
export function slotApplies(build: CarBuild, slot: SlotDef): boolean {
  if (!slot.turboOnly) return true;
  return partIn(build, 'engine')?.fx.turbo === true;
}

/** Why a part cannot go on this car, or null if it can. */
export function incompatibility(build: CarBuild, part: Part): string | null {
  const chassisPart = partIn(build, 'chassis');
  const chassis = chassisPart?.chassis;
  if (part.slot === 'chassis') return null;
  if (!chassis) return 'Fit a chassis first';
  if (part.slot === 'engine' && part.fits && !part.fits.includes(chassis.engineFamily)) {
    return `Does not fit the ${alias(chassisPart?.maker ?? 'chassis')} engine bay`;
  }
  if (part.slot === 'gearbox' && part.fits && !part.fits.includes(chassis.layout)) {
    return `Not made for a ${chassis.layout}-engined car`;
  }
  const def = SLOTS.find((s) => s.id === part.slot);
  if (def?.turboOnly && !slotApplies(build, def)) {
    return partIn(build, 'engine') ? 'Only for turbocharged engines' : 'Fit an engine first';
  }
  return null;
}

/** Slots that must be cleared when a part goes in because what is there no longer fits. */
export function orphanedBy(build: CarBuild, incoming: Part): SlotId[] {
  if (incoming.slot !== 'chassis' && incoming.slot !== 'engine') return [];
  const trial: CarBuild = { ...build, parts: { ...build.parts, [incoming.slot]: { part: incoming.id, cond: 'new' } } };
  const out: SlotId[] = [];
  for (const slot of SLOTS) {
    if (slot.id === incoming.slot) continue;
    const p = partIn(build, slot.id);
    if (p && incompatibility(trial, p)) out.push(slot.id);
  }
  // A new chassis that drops the engine also drops what hangs off it.
  if (out.includes('engine')) {
    for (const slot of SLOTS) if (slot.turboOnly && build.parts[slot.id] && !out.includes(slot.id)) out.push(slot.id);
  }
  return out;
}

const NO_FX: Part['fx'] = {};
/** Lateral grip split between the axles; rear-heavy cars run wider rear tyres. */
const GRIP_SPLIT = { rear: [0.957, 1.049], mid: [0.957, 1.049], front: [0.978, 1.034] } as const;
const DRIVER_KG = 75;
/** Aftermarket downforce figures are quoted in free air; on the car they deliver less. */
const AERO_SCALE = 0.85;
/** Engine figures are quoted fully built and mapped; lesser parts and a safe map cost power. */
const POWER_BASE = 0.905;
const POWER_SLOTS: readonly SlotId[] = ['intake', 'exhaust', 'ecu', 'cooling', 'pistons', 'rods', 'crank', 'valvetrain', 'oil', 'throttle', 'injectors', 'turbo', 'intercooler', 'louvers'];
const WHEEL_RADIUS = 0.345;
/** Tyre grip figures assume a fully sorted chassis; each suspension part earns some of it back. */
const GRIP_BASE = 0.978;

/**
 * Turns a build into the physical car the simulation runs.
 * Nothing about performance is stored: it all follows from the fitted parts,
 * the engine map and the set-up.
 */
export function deriveCar(build: CarBuild, ref?: PreparedTrack, quick = false): DerivedCar {
  const fitted = new Map<SlotId, { part: Part; cond: Condition }>();
  const missing: SlotId[] = [];
  const issues: string[] = [];
  const notes: string[] = [];
  let value = 0;
  let mass = 0;
  let reliability = 1;

  for (const slot of SLOTS) {
    if (!slotApplies(build, slot)) continue;
    const f = build.parts[slot.id];
    const part = f ? getPart(f.part) : undefined;
    if (!f || !part || part.slot !== slot.id) {
      missing.push(slot.id);
      continue;
    }
    fitted.set(slot.id, { part, cond: f.cond });
    value += partPrice(part, f.cond);
    mass += part.mass;
    reliability *= Math.min(1, part.rel * CONDITIONS[f.cond].rel);
    const why = incompatibility(build, part);
    if (why) issues.push(`${slot.label}: ${why}`);
  }

  const chassis = fitted.get('chassis')?.part.chassis ?? null;
  const engine = fitted.get('engine');
  const gearbox = fitted.get('gearbox');
  const tyres = fitted.get('tyres');
  const base: DerivedCar = {
    legal: missing.length === 0 && issues.length === 0,
    missing, issues, notes, value, massKg: mass, chassis,
    spec: null, stats: null, hardware: null, ecu: null, ecuResult: null, setup: null,
  };
  if (!chassis || !engine || !gearbox || !tyres || issues.length) return base;

  const fx = (slot: SlotId): Part['fx'] => fitted.get(slot)?.part.fx ?? NO_FX;
  const perf = (slot: SlotId): number => {
    const f = fitted.get(slot);
    return f ? CONDITIONS[f.cond].perf : 1;
  };
  /** How much of a part's condition loss reaches the stat it feeds. */
  const dulled = (slot: SlotId, share: number): number => 1 - (1 - perf(slot)) * share;
  const sum = (key: 'revs' | 'knock' | 'comfort' | 'safety' | 'pit'): number => {
    let total = 0;
    for (const f of fitted.values()) total += f.part.fx[key] ?? 0;
    return total;
  };

  // --- Engine: hardware, then the map the player has programmed ------------
  const e = engine.part.fx;
  const turbo = e.turbo === true;
  const redline = e.redline ?? 7000;
  const hardware: EngineHardware = {
    redline,
    turbo,
    revCeiling: redline + sum('revs'),
    knockBonus: sum('knock'),
    boostMax: turbo ? (fx('turbo').boostMax ?? 0.9) : 0,
    tcBest: fx('ecu').tc ?? 0.4,
    absBest: fx('abs').abs ?? 0,
  };
  const ecu = sanitizeMap(hardware, build.ecu);
  const tune = evaluateEcu(hardware, ecu);
  notes.push(...tune.warnings);

  let power = perf('engine') * POWER_BASE;
  for (const s of POWER_SLOTS) power *= 1 + (fx(s).power ?? 0);
  if (!fitted.has('cooling')) power *= 0.97;
  let kw = (e.kw ?? 300) * power;
  // The fuel system can only feed so much power.
  const flow = Math.min(fx('injectors').flow ?? 300, fx('fuelpump').flow ?? 300);
  const peakFactor = Math.max(...tune.factor.slice(3));
  if (kw * peakFactor > flow) {
    notes.push(`Fuel system limits power to ${Math.round(flow * 1.341)} hp: fit bigger injectors or pump`);
    kw = flow / peakFactor;
  }
  const table = makeEngine({ powerKw: kw, redline, turbo });
  const torque = table.rpm.map((rpm, i) => {
    // Map columns run from 30% to 100% of the redline.
    const x = clamp((rpm / redline - 0.3) / 0.1, 0, ECU_POINTS - 1);
    const lo = Math.floor(x);
    const hi = Math.min(ECU_POINTS - 1, lo + 1);
    return table.torque[i] * (tune.factor[lo] + (tune.factor[hi] - tune.factor[lo]) * (x - lo));
  });
  const rpm = [...table.rpm];
  if (tune.revLimit > redline) {
    // Past the rated redline the engine runs out of breath.
    rpm.push(tune.revLimit);
    torque.push(torque[torque.length - 1] * (1 - 1.6 * (tune.revLimit / redline - 1)));
  }
  const engineTable: CarSpec['engine'] = { rpm, torque, idle: table.idle, redline: tune.revLimit };
  reliability *= tune.reliability;

  // --- Driveline -----------------------------------------------------------
  let eff = 0.9 * dulled('gearbox', 0.3);
  for (const s of ['gearbox', 'driveshafts', 'uprights'] as const) eff += fx(s).eff ?? 0;
  const shiftTime = Math.max(
    0.02,
    ((gearbox.part.fx.shift ?? 0.09) + (fx('clutch').shift ?? 0.015) + (fx('flywheel').shift ?? 0.01)) * (fx('shift').shift ?? 1.6),
  );
  const gears = gearbox.part.fx.gears ?? [2.85, 2.12, 1.66, 1.35, 1.14, 1.0];
  const finalDrive =
    ((redline * ((2 * Math.PI) / 60) * WHEEL_RADIUS) / (chassis.topSpeedKmh / 3.6)) * (fx('finaldrive').ratio ?? 1);

  // --- Set-up --------------------------------------------------------------
  const fuelCapacity = fx('fuelcell').fuelKg ?? 60;
  const setup = sanitizeSetup(build.setup, fuelCapacity);

  // --- Aero: the bare body plus each device, with where its load lands -----
  let clA = chassis.clA;
  let cdA = chassis.cdA;
  let clFront = chassis.clA * 0.4;
  for (const s of ['splitter', 'wing', 'diffuser', 'canards', 'louvers', 'mirrors', 'ducts'] as const) {
    const f = fx(s);
    const angle = s === 'wing' ? 1 + 0.06 * setup.wing : 1;
    const cl = (f.cl ?? 0) * perf(s) * AERO_SCALE * angle;
    clA += cl;
    cdA += (f.cd ?? 0) * (s === 'wing' ? 1 + 0.09 * setup.wing : 1);
    clFront += cl * (f.front ?? 0.5);
  }
  const aeroFront = clFront / clA;
  // Keep the centre of pressure at or behind the centre of mass so the car stays stable at speed.
  const aeroBalance = clamp(aeroFront, chassis.frontWeight - 0.14, chassis.frontWeight - 0.01);
  if (aeroFront > chassis.frontWeight) notes.push('Aero balance is too far forward: add rear wing or remove front downforce');

  // --- Grip ----------------------------------------------------------------
  let grip = GRIP_BASE;
  let wear = 1;
  for (const f of fitted.values()) {
    grip *= 1 + (f.part.fx.grip ?? 0);
    wear *= 1 + (f.part.fx.wear ?? 0);
  }
  grip *= dulled('dampers', 0.4);
  if (!fitted.has('dampers')) grip *= 0.96;
  const mu = (tyres.part.fx.mu ?? 1.6) * perf('tyres') * grip;
  const split = GRIP_SPLIT[chassis.layout];
  // A stiffer rear bar moves grip to the front axle, and the other way round.
  const shift = 0.004 * setup.balance;

  // --- Brakes --------------------------------------------------------------
  let brake = dulled('pads', 0.5) * dulled('discs', 0.5);
  for (const s of ['discs', 'pads', 'calipers', 'pedals', 'lines', 'ducts'] as const) brake *= 1 + (fx(s).brake ?? (fitted.has(s) ? 0 : -0.06));
  // Without ABS the driver has to leave a margin to avoid locking a wheel.
  if (hardware.absBest < 0.3) brake *= 0.94;

  const comfort = sum('comfort');
  const safety = sum('safety');

  const spec: CarSpec = {
    id: build.id,
    name: alias(build.name),
    mass,
    wheelbase: chassis.wheelbase,
    frontWeight: chassis.frontWeight,
    cgHeight: 0.44,
    length: chassis.length,
    width: chassis.width,
    engine: engineTable,
    gears,
    finalDrive,
    wheelRadius: WHEEL_RADIUS,
    drivelineEfficiency: eff,
    shiftTime,
    cdA,
    clA,
    aeroBalance,
    brakeForce: 1.95 * (mass + 110) * GRAVITY * brake,
    brakeBias: clamp(chassis.frontWeight + 0.23 + 0.01 * setup.brakeBias, 0.5, 0.85),
    tyre: {
      muFront: mu * split[0] * (1 + shift),
      muRear: mu * split[1] * (1 - shift),
      b: 14,
      c: 1.45,
      loadSensitivity: 0.08,
      wearRate: (tyres.part.fx.tyreWear ?? 8e-6) * wear,
    },
    maxSteer: 0.42,
    tractionControl: tune.tcAssist,
    abs: tune.absAssist,
    tcMargin: tune.tcMargin,
    absMargin: tune.absMargin,
    fuelUse: tune.fuelUse,
    launchRpm: ecu.launchRpm,
    startFuel: setup.fuel,
    fuelCapacity,
    comfort,
    startTyreWear: CONDITIONS[tyres.cond].tyreWear,
  };

  return {
    ...base,
    spec, hardware, ecu, ecuResult: tune, setup,
    stats: measure(spec, { aeroFront, reliability, safety, comfort, pit: sum('pit') }, ref, quick),
  };
}

const ROAD = { gripFront: 1, gripRear: 1, drag: 0 };
const FUEL_PER_JOULE = 7.4e-8;

/** Figures for the stats panel, measured by running the car through the simulation. */
function measure(
  spec: CarSpec,
  extra: { aeroFront: number; reliability: number; safety: number; comfort: number; pit: number },
  ref?: PreparedTrack,
  quick = false,
): CarStats {
  const dt = 1 / 120;
  let peakKw = 0;
  let peakTorque = 0;
  for (let rpm = spec.engine.idle; rpm <= spec.engine.redline; rpm += 100) {
    const t = engineTorque(spec, rpm);
    peakTorque = Math.max(peakTorque, t);
    peakKw = Math.max(peakKw, (t * rpm * 2 * Math.PI) / 60000);
  }
  const fresh: CarSpec = { ...spec, startTyreWear: 0 };

  const go: Controls = { steer: 0, throttle: 1, brake: 0, reverse: false };
  const st = createCarState(fresh, 0, 0, 0);
  let accel = 0;
  let t = 0;
  let last = 0;
  // The quick pass skips the straight-line runs; the lap estimate is what comparisons need.
  for (; !quick && t < 45; t += dt) {
    stepCar(fresh, st, go, ROAD, DRIVER_KG, dt);
    if (!accel && st.vx >= 100 / 3.6) accel = t;
    // Top speed: stop once it has stopped rising.
    if (t > 12 && Math.round(t / dt) % 240 === 0) {
      if (st.vx - last < 0.05) break;
      last = st.vx;
    }
  }
  const topSpeed = st.vx * 3.6;

  const stop: Controls = { steer: 0, throttle: 0, brake: 1, reverse: false };
  const bs = createCarState(fresh, 0, 0, 0);
  bs.vx = 200 / 3.6;
  for (let i = 0; !quick && i < 2000 && bs.vx > 0.5; i++) stepCar(fresh, bs, stop, ROAD, DRIVER_KG, dt);

  const m = spec.mass + DRIVER_KG;
  const v = 120 / 3.6;
  const muAvg = (spec.tyre.muFront * spec.frontWeight + spec.tyre.muRear * (1 - spec.frontWeight)) * 0.94;
  const gripG = (muAvg * (GRAVITY + (0.5 * AIR_DENSITY * spec.clA * v * v) / m)) / GRAVITY;

  let lapTime = 0;
  let fuelPerLap = 0;
  let lapLength = 1944;
  if (ref) {
    const total = m + spec.startFuel;
    const profile = computeSpeedProfile(ref.track, ref.line, fresh, { mass: total, cornerGrip: 0.93, brakeGrip: 0.9 });
    const n = ref.track.n;
    const ds = ref.track.ds;
    lapLength = ref.track.length;
    for (let i = 0; i < n; i++) {
      const a = profile[i], b = profile[(i + 1) % n];
      lapTime += ds / a;
      // Engine work over this step: acceleration plus drag and rolling resistance.
      const force = (total * (b * b - a * a)) / (2 * ds) + 0.5 * AIR_DENSITY * spec.cdA * a * a + total * GRAVITY * 0.012;
      if (force > 0) fuelPerLap += ((force * ds) / spec.drivelineEfficiency) * FUEL_PER_JOULE * spec.fuelUse;
    }
  }

  const reliability = extra.reliability;
  const pace = clamp((50.5 - lapTime) / (50.5 - 40.5), 0, 1);
  return {
    powerHp: peakKw * 1.341,
    torqueNm: peakTorque,
    massKg: spec.mass,
    powerToWeight: (peakKw * 1.341) / (m / 1000),
    topSpeedKmh: topSpeed,
    accel,
    braking: bs.x,
    downforceKg: (0.5 * AIR_DENSITY * spec.clA * (200 / 3.6) ** 2) / GRAVITY,
    dragCdA: spec.cdA,
    aeroFront: extra.aeroFront,
    gripG,
    shiftMs: spec.shiftTime * 1000,
    reliability,
    fuelKg: spec.fuelCapacity,
    fuelPerLap,
    fuelLaps: fuelPerLap > 0 ? spec.startFuel / fuelPerLap : 0,
    tyreLaps: 1 / (spec.tyre.wearRate * lapLength * 0.72),
    revLimit: spec.engine.redline,
    frontWeight: spec.frontWeight,
    safety: extra.safety,
    comfort: extra.comfort,
    pitSaving: extra.pit,
    lapTime,
    rating: ref ? Math.round(100 * (0.85 * pace + 0.15 * clamp((reliability - 0.3) / 0.6, 0, 1))) : 0,
  };
}

export function newBuildId(): string {
  return `car-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** Cheapest way to fill every empty slot, in the given condition. */
export function completionKit(build: CarBuild, cond: Condition): { parts: Part[]; cost: number } {
  const trial: CarBuild = { ...build, parts: { ...build.parts } };
  const out: Part[] = [];
  let cost = 0;
  // Engine first: it decides whether the forced-induction slots exist.
  const order = [...SLOTS].sort((a, b) => Number(b.id === 'engine') - Number(a.id === 'engine'));
  for (const slot of order) {
    if (trial.parts[slot.id] || !slotApplies(trial, slot)) continue;
    const options = partsForSlot(slot.id).filter((p) => !incompatibility(trial, p)).sort((a, b) => a.price - b.price);
    const pick = options[0];
    if (!pick) continue;
    trial.parts[slot.id] = { part: pick.id, cond };
    out.push(pick);
    cost += partPrice(pick, cond);
  }
  return { parts: out, cost };
}

/**
 * Builds a complete, legal opponent car from the catalog.
 * @param level 1 (club parts, worn) to 4 (factory parts, new).
 */
export function generateBuild(rng: Rng, level: number, livery: Livery, id: string): CarBuild {
  const chassis = rng.pick(partsForSlot('chassis'));
  const build: CarBuild = { id, name: chassis.name.replace(' shell', ''), parts: { chassis: { part: chassis.id, cond: 'new' } }, livery };
  const order = [...SLOTS].sort((a, b) => Number(b.id === 'engine') - Number(a.id === 'engine'));
  for (const slot of order) {
    if (slot.id === 'chassis' || !slotApplies(build, slot)) continue;
    const options = PARTS.filter((p) => p.slot === slot.id && !incompatibility(build, p));
    // Prefer parts near the target level, with some spread so cars differ.
    const target = clamp(level + rng.normal() * 0.8, 1, 4);
    let best = options[0];
    let bestScore = Infinity;
    for (const p of options) {
      const score = Math.abs(p.tier - target) + rng.next() * 0.9;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    const roll = rng.next() + (level - 2.5) * 0.15;
    const cond: Condition = roll > 0.45 ? 'new' : roll > 0.12 ? 'used' : 'worn';
    build.parts[slot.id] = { part: best.id, cond };
  }
  // Better-funded teams have had the car on the dyno.
  if (level >= 2) {
    const hw = deriveCar(build).hardware;
    if (hw) build.ecu = tunedMap(hw, clamp(4.5 - level, 0.5, 3));
  }
  return build;
}

/** Display name of the car: the chassis it is built on. */
export function chassisName(build: CarBuild): string {
  const p = partIn(build, 'chassis');
  return p ? alias(`${p.maker} ${p.name.replace(' shell', '')}`) : 'No chassis';
}

export function bodyOf(build: CarBuild): BodyStyle | null {
  return partIn(build, 'chassis')?.chassis?.body ?? null;
}

/** What auto build optimises: mostly lap time, with some weight on finishing the race. */
function buildScore(build: CarBuild, ref: PreparedTrack): number {
  const s = deriveCar(build, ref, true).stats;
  if (!s) return -Infinity;
  return 0.85 * ((50.5 - s.lapTime) / 10) + 0.15 * clamp((s.reliability - 0.3) / 0.6, 0, 1);
}

function partsCost(build: CarBuild): number {
  let total = 0;
  for (const slot of SLOTS) {
    if (slot.id === 'chassis') continue;
    const f = build.parts[slot.id];
    const p = f ? getPart(f.part) : undefined;
    if (f && p) total += partPrice(p, f.cond);
  }
  return total;
}

/** After an engine change: forced-induction parts appear or go with it. */
function settleTurboSlots(build: CarBuild): void {
  for (const slot of SLOTS) {
    if (!slot.turboOnly) continue;
    if (!slotApplies(build, slot)) delete build.parts[slot.id];
    else if (!build.parts[slot.id]) {
      const cheapest = partsForSlot(slot.id).sort((a, b) => a.price - b.price)[0];
      build.parts[slot.id] = { part: cheapest.id, cond: 'worn' };
    }
  }
}

export interface AutoBuildResult {
  build: CarBuild;
  /** Price of every part except the chassis. */
  cost: number;
}

/**
 * Picks the parts that make the fastest, most dependable car for a budget,
 * keeping the chassis. It starts from the cheapest legal car and keeps buying
 * the upgrade that gains the most per dollar until the money runs out.
 * Returns null when even the cheapest parts cost more than the budget.
 */
export function autoBuild(build: CarBuild, budget: number, ref: PreparedTrack): AutoBuildResult | null {
  if (!build.parts.chassis) return null;
  const cur: CarBuild = { ...build, parts: { chassis: build.parts.chassis }, ecu: undefined };
  for (const p of completionKit(cur, 'worn').parts) cur.parts[p.slot] = { part: p.id, cond: 'worn' };
  let spent = partsCost(cur);
  if (spent > budget) return null;
  let score = buildScore(cur, ref);

  const trialWith = (part: Part, cond: Condition): CarBuild => {
    const t: CarBuild = { ...cur, parts: { ...cur.parts, [part.slot]: { part: part.id, cond } } };
    if (part.slot === 'engine') settleTurboSlots(t);
    return t;
  };

  for (let pass = 0; pass < 3; pass++) {
    const ranked: { part: Part; cond: Condition; ratio: number }[] = [];
    for (const part of PARTS) {
      if (part.slot === 'chassis' || incompatibility(cur, part)) continue;
      for (const cond of CONDITION_ORDER) {
        const f = cur.parts[part.slot];
        if (f && f.part === part.id && f.cond === cond) continue;
        const t = trialWith(part, cond);
        const gain = buildScore(t, ref) - score;
        const extra = partsCost(t) - spent;
        if (gain > 1e-7) ranked.push({ part, cond, ratio: gain / Math.max(extra, 100) });
      }
    }
    if (!ranked.length) break;
    ranked.sort((a, b) => b.ratio - a.ratio);
    let changed = false;
    for (const c of ranked) {
      if (incompatibility(cur, c.part)) continue;
      const t = trialWith(c.part, c.cond);
      const cost = partsCost(t);
      if (cost > budget) continue;
      const s = buildScore(t, ref);
      if (s <= score + 1e-7) continue;
      cur.parts = t.parts;
      spent = cost;
      score = s;
      changed = true;
    }
    if (!changed) break;
  }
  return { build: cur, cost: spent };
}

export { RATED_BOOST };
