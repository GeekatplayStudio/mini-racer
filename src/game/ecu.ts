import { clamp } from '../sim/math';

/**
 * Engine control unit model. The player edits ignition, mixture and boost
 * against engine speed, as on a real programmable ECU; this module works out
 * what the engine then does: torque, knock, fuel use and how long it lasts.
 */

/** Columns of every map: engine speed from 30% to 100% of the rated redline. */
export const ECU_POINTS = 8;
export const AID_LEVELS = 12;

export interface EcuMap {
  /** Ignition advance, degrees before top dead centre. */
  ign: number[];
  /** Mixture as lambda: 1.00 is chemically correct, lower is richer. */
  lambda: number[];
  /** Boost target, bar above atmosphere (turbocharged engines). */
  boost: number[];
  revLimit: number;
  /** Traction control and ABS switch positions, 1 (least help) to 12. */
  tc: number;
  abs: number;
  launchRpm: number;
  /** Pit-lane speed limiter, km/h. */
  pitLimit: number;
}

/** What the fitted hardware allows. */
export interface EngineHardware {
  redline: number;
  turbo: boolean;
  /** Highest engine speed the internals take without damage. */
  revCeiling: number;
  /** Extra advance before knock from ignition, intercooler and fuel, degrees. */
  knockBonus: number;
  /** Boost the turbochargers hold efficiently, bar. */
  boostMax: number;
  /** Best traction control and ABS quality the electronics can deliver, 0..1. */
  tcBest: number;
  absBest: number;
}

export const RATED_BOOST = 1.0;
export const BEST_LAMBDA = 0.88;

export const ECU_LIMITS = {
  ign: { min: 0, max: 45, step: 0.5 },
  lambda: { min: 0.75, max: 1.1, step: 0.01 },
  boost: { min: 0, max: 2, step: 0.05 },
  aid: { min: 1, max: AID_LEVELS, step: 1 },
  pitLimit: { min: 40, max: 100, step: 5 },
} as const;

export function rpmAtPoint(redline: number, i: number): number {
  return Math.round((redline * (0.3 + 0.1 * i)) / 50) * 50;
}

/** Advance that gives best torque if knock allows (MBT). */
export function bestAdvance(hw: EngineHardware, i: number): number {
  const x = i / (ECU_POINTS - 1);
  return hw.turbo ? 10 + 12 * x : 14 + 16 * x ** 0.8;
}

/** Most advance the engine takes before it knocks, for a mixture and boost. */
export function knockLimit(hw: EngineHardware, i: number, lambda: number, boost: number): number {
  const base = bestAdvance(hw, i) + (hw.turbo ? -1.5 : 3);
  // Richer mixture cools the charge; more boost heats it.
  const mixture = (BEST_LAMBDA - lambda) * 25;
  const pressure = hw.turbo ? -(boost - RATED_BOOST) * 14 : 0;
  return base + hw.knockBonus + mixture + pressure;
}

/** A conservative map: retarded, rich, boost turned down. Every engine runs on it. */
export function safeMap(hw: EngineHardware): EcuMap {
  const ign: number[] = [];
  const lambda: number[] = [];
  const boost: number[] = [];
  for (let i = 0; i < ECU_POINTS; i++) {
    const rich = 0.84;
    const b = hw.turbo ? Math.min(RATED_BOOST - 0.1, hw.boostMax) : 0;
    const limit = Math.min(bestAdvance(hw, i), knockLimit(hw, i, rich, b));
    ign.push(Math.round((limit - 3) * 2) / 2);
    lambda.push(rich);
    boost.push(Math.round(b * 20) / 20);
  }
  return {
    ign, lambda, boost,
    revLimit: Math.round((Math.min(hw.redline, hw.revCeiling) - 100) / 50) * 50,
    tc: 8, abs: 8,
    launchRpm: Math.round((hw.redline * 0.55) / 100) * 100,
    pitLimit: 60,
  };
}

/**
 * A competent map for the hardware: best-power mixture, boost at what the
 * turbos hold, and ignition a chosen margin short of knock.
 */
export function tunedMap(hw: EngineHardware, marginDeg: number): EcuMap {
  const map = safeMap(hw);
  for (let i = 0; i < ECU_POINTS; i++) {
    const lambda = hw.turbo ? 0.86 : BEST_LAMBDA;
    const boost = hw.turbo ? Math.round(Math.min(hw.boostMax, RATED_BOOST + 0.1) * 20) / 20 : 0;
    const limit = Math.min(bestAdvance(hw, i), knockLimit(hw, i, lambda, boost) - marginDeg);
    map.ign[i] = Math.floor(limit * 2) / 2;
    map.lambda[i] = lambda;
    map.boost[i] = boost;
  }
  map.revLimit = Math.floor(Math.min(hw.revCeiling, hw.redline + 400) / 50) * 50;
  return map;
}

export function revLimitRange(hw: EngineHardware): { min: number; max: number } {
  return { min: Math.round((hw.redline * 0.8) / 50) * 50, max: Math.round((hw.redline + 400) / 50) * 50 };
}

/** Brings a saved or hand-edited map inside what the controls allow. */
export function sanitizeMap(hw: EngineHardware, map: EcuMap | undefined): EcuMap {
  const base = safeMap(hw);
  if (!map) return base;
  const column = (values: number[] | undefined, fallback: number[], lim: { min: number; max: number }): number[] =>
    fallback.map((f, i) => (Number.isFinite(values?.[i]) ? clamp(values![i], lim.min, lim.max) : f));
  const range = revLimitRange(hw);
  return {
    ign: column(map.ign, base.ign, ECU_LIMITS.ign),
    lambda: column(map.lambda, base.lambda, ECU_LIMITS.lambda),
    boost: hw.turbo ? column(map.boost, base.boost, ECU_LIMITS.boost) : base.boost,
    revLimit: clamp(Number.isFinite(map.revLimit) ? map.revLimit : base.revLimit, range.min, range.max),
    tc: clamp(Math.round(map.tc ?? base.tc), 1, AID_LEVELS),
    abs: clamp(Math.round(map.abs ?? base.abs), 1, AID_LEVELS),
    launchRpm: clamp(map.launchRpm ?? base.launchRpm, 2000, range.max),
    pitLimit: clamp(map.pitLimit ?? base.pitLimit, ECU_LIMITS.pitLimit.min, ECU_LIMITS.pitLimit.max),
  };
}

export interface EcuResult {
  /** Torque at each map column relative to a perfect tune at rated boost. */
  factor: number[];
  /** Degrees of advance past the knock limit at each column; 0 when safe. */
  knockOver: number[];
  /** Advance still available before knock at each column, degrees. */
  knockMargin: number[];
  /** Fuel burned per unit of power, relative to best-power mixture. */
  fuelUse: number;
  /** Multiplier on engine reliability. */
  reliability: number;
  revLimit: number;
  tcAssist: number;
  tcMargin: number;
  absAssist: number;
  absMargin: number;
  warnings: string[];
}

export function evaluateEcu(hw: EngineHardware, map: EcuMap): EcuResult {
  const factor: number[] = [];
  const knockOver: number[] = [];
  const knockMargin: number[] = [];
  const warnings: string[] = [];
  let reliability = 1;
  let fuel = 0;
  let worstKnock = 0, worstKnockAt = 0, leanAt = -1, breathAt = -1;

  for (let i = 0; i < ECU_POINTS; i++) {
    const lambda = map.lambda[i];
    const asked = hw.turbo ? map.boost[i] : 0;
    // Past its efficient range the turbo makes heat, not pressure.
    const boost = Math.min(asked, hw.boostMax + (asked - hw.boostMax) * 0.25);
    const limit = knockLimit(hw, i, lambda, asked);
    const over = Math.max(0, map.ign[i] - limit);
    const fromBest = map.ign[i] - bestAdvance(hw, i);

    let f = 1 - 0.0011 * fromBest * fromBest;
    f *= 1 - 1.9 * (lambda - BEST_LAMBDA) ** 2;
    if (hw.turbo) f *= (1 + boost) / (1 + RATED_BOOST);
    // Knock: the engine loses torque and starts hurting itself.
    f *= 1 - Math.min(0.3, 0.02 * over);
    factor.push(Math.max(0.3, f));
    knockOver.push(over);
    knockMargin.push(limit - map.ign[i]);

    // The top half of the rev range is where the engine lives on track.
    const weight = i >= 3 ? 1 : 0.3;
    reliability -= 0.012 * over * weight;
    if (lambda > 0.93) {
      reliability -= 0.15 * (lambda - 0.93) * weight;
      if (i >= 3 && leanAt < 0) leanAt = i;
    }
    if (hw.turbo) {
      if (asked > hw.boostMax + 1e-6) {
        reliability -= 0.1 * (asked - hw.boostMax) * weight;
        if (breathAt < 0) breathAt = i;
      }
      if (asked > RATED_BOOST) reliability -= 0.03 * (asked - RATED_BOOST) * weight;
    }
    if (over > worstKnock) {
      worstKnock = over;
      worstKnockAt = i;
    }
    if (i >= 3) fuel += BEST_LAMBDA / lambda;
  }

  const overRev = map.revLimit - hw.revCeiling;
  if (overRev > 0) reliability -= 0.00012 * overRev;

  if (worstKnock > 0) warnings.push(`Knock at ${rpmAtPoint(hw.redline, worstKnockAt)} rpm: retard the ignition or richen the mixture`);
  if (leanAt >= 0) warnings.push(`Lean mixture at ${rpmAtPoint(hw.redline, leanAt)} rpm: exhaust temperature is too high`);
  if (breathAt >= 0) warnings.push(`Turbos are out of breath above ${hw.boostMax.toFixed(2)} bar`);
  if (overRev > 0) warnings.push(`Rev limit is ${Math.round(overRev)} rpm above what the internals take`);

  const aid = (level: number, best: number): [number, number] => {
    const t = (level - 1) / (AID_LEVELS - 1);
    // High settings step in early and hold grip in reserve; low settings leave it to the driver.
    // A skilled foot does part of the job even with no unit fitted.
    return [Math.max(0.4, best * (0.45 + 0.55 * t)), 0.004 + 0.05 * t * t];
  };
  const [tcAssist, tcMargin] = aid(map.tc, hw.tcBest);
  const [absAssist, absMargin] = aid(map.abs, hw.absBest);

  return {
    factor, knockOver, knockMargin,
    fuelUse: fuel / (ECU_POINTS - 3),
    reliability: clamp(reliability, 0.3, 1),
    revLimit: map.revLimit,
    tcAssist, tcMargin, absAssist, absMargin,
    warnings,
  };
}

/** Chassis settings changed with spanners rather than parts. */
export interface Setup {
  /** Rear wing angle steps, -5 (flat) to +5 (steep). */
  wing: number;
  /** Brake balance, percentage points toward the front, -5 to +5. */
  brakeBias: number;
  /** Fuel at the start, kg. */
  fuel: number;
  /** Anti-roll bar balance, -5 (front stiffer: understeer) to +5 (rear stiffer: oversteer). */
  balance: number;
}

export const SETUP_LIMITS = {
  wing: { min: -5, max: 5 },
  brakeBias: { min: -5, max: 5 },
  balance: { min: -5, max: 5 },
} as const;

export function defaultSetup(fuelCapacity: number): Setup {
  return { wing: 0, brakeBias: 0, fuel: Math.min(fuelCapacity, 32), balance: 0 };
}

export function sanitizeSetup(setup: Setup | undefined, fuelCapacity: number): Setup {
  const d = defaultSetup(fuelCapacity);
  if (!setup) return d;
  const n = (v: number | undefined, lo: number, hi: number, fallback: number): number =>
    Number.isFinite(v) ? clamp(v as number, lo, hi) : fallback;
  return {
    wing: Math.round(n(setup.wing, -5, 5, 0)),
    brakeBias: Math.round(n(setup.brakeBias, -5, 5, 0)),
    fuel: Math.round(n(setup.fuel, 8, fuelCapacity, d.fuel)),
    balance: Math.round(n(setup.balance, -5, 5, 0)),
  };
}
