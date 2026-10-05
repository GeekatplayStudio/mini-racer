import { clamp, lerp } from './math';
import { Rng } from './rng';

/** Skills bought from the point pool; higher is better. */
export const SKILLS = [
  'reaction',
  'anticipation',
  'carControl',
  'braking',
  'cornering',
  'racecraft',
  'consistency',
  'attention',
  'endurance',
  'composure',
  'sympathy',
  'discipline',
] as const;
export type Skill = (typeof SKILLS)[number];

export const SKILL_LABELS: Record<Skill, string> = {
  reaction: 'Reaction',
  anticipation: 'Anticipation',
  carControl: 'Car control',
  braking: 'Braking',
  cornering: 'Cornering',
  racecraft: 'Racecraft',
  consistency: 'Consistency',
  attention: 'Attention to detail',
  endurance: 'Endurance',
  composure: 'Composure',
  sympathy: 'Mechanical sympathy',
  discipline: 'Discipline',
};

export const STARTING_POINTS = 100;
export const SKILL_CAP_AT_CREATION = 20;
/** Skill level at which an attribute counts as fully developed. */
const SKILL_FULL = 20;

export interface DriverDef {
  id: string;
  name: string;
  /** Three-letter timing-screen code. */
  code: string;
  nationality: string;
  skills: Record<Skill, number>;
  /** Temperament trade-offs, each 0..1, locked at creation. */
  aggression: number;
  risk: number;
  /** Body mass, kg. */
  weight: number;
  racesCompleted: number;
}

/** Behaviour parameters the simulation uses, derived once from a DriverDef. */
export interface DriverProfile {
  /** Delay before reacting to the start and to incidents, s. */
  reactionTime: number;
  /** How far ahead traffic is read, s of travel. */
  lookahead: number;
  /** Fraction of available grip used in corners. */
  cornerGrip: number;
  /** Fraction of available grip used under braking. */
  brakeGrip: number;
  /** Lap-to-lap pace variation, standard deviation as a fraction. */
  paceNoise: number;
  /** Lateral wander off the ideal line, m. */
  lineNoise: number;
  /** Chance of an error at each braking zone. */
  mistakeRate: number;
  /** Fatigue gained per second of racing (1.0 is exhausted). */
  fatigueRate: number;
  /** How much pressure raises the mistake rate, 0..1. */
  pressureSensitivity: number;
  /** Slide angle the driver can catch, rad. */
  catchAngle: number;
  /** Distance kept behind a car when following, m. */
  followGap: number;
  /** Lateral clearance wanted when passing, m. */
  passMargin: number;
  /** Speed advantage needed before attempting a pass, m/s. */
  passThreshold: number;
  /** Multiplier on tyre wear the driver causes. */
  wearFactor: number;
  aggression: number;
  mass: number;
}

export function skillLevel(def: DriverDef, skill: Skill): number {
  return clamp(def.skills[skill] / SKILL_FULL, 0, 1.4);
}

export function pointsSpent(def: DriverDef): number {
  let total = 0;
  for (const s of SKILLS) total += def.skills[s];
  return total;
}

/** Points a driver may hold: 100 plus one per 10 completed races. */
export function pointsAllowed(def: DriverDef): number {
  return STARTING_POINTS + Math.floor(def.racesCompleted / 10);
}

/**
 * Turns the player's allocation into behaviour. Attributes interact here:
 * risk pushes grip use up but is only safe with car control; aggression
 * shortens gaps but needs racecraft to stay clean.
 */
export function deriveProfile(def: DriverDef): DriverProfile {
  const k = (s: Skill): number => skillLevel(def, s);
  const risk = clamp(def.risk, 0, 1);
  const aggression = clamp(def.aggression, 0, 1);

  const control = k('carControl');
  // Risk beyond what car control supports turns into errors rather than pace.
  const unsupportedRisk = Math.max(0, risk - 0.25 - control * 0.75);

  return {
    reactionTime: lerp(0.5, 0.14, Math.min(1, k('reaction'))),
    lookahead: lerp(0.8, 2.6, Math.min(1, k('anticipation'))),
    cornerGrip: 0.85 + 0.085 * Math.min(1.2, k('cornering')) + 0.04 * risk,
    brakeGrip: 0.78 + 0.13 * Math.min(1.2, k('braking')) + 0.05 * risk,
    paceNoise: lerp(0.022, 0.003, Math.min(1, k('consistency'))),
    lineNoise: lerp(0.7, 0.08, Math.min(1, (k('cornering') + k('consistency')) / 2)),
    mistakeRate:
      lerp(0.03, 0.002, Math.min(1, (k('consistency') + k('attention')) / 2)) *
      (1 + 2.5 * unsupportedRisk + 0.8 * risk),
    fatigueRate: lerp(1 / 900, 1 / 9000, Math.min(1, k('endurance'))) * (1 + (def.weight - 70) / 200),
    pressureSensitivity: lerp(1, 0.1, Math.min(1, k('composure'))),
    catchAngle: lerp(0.06, 0.3, Math.min(1, control)),
    followGap: lerp(9, 3.5, aggression) * lerp(1.15, 0.9, Math.min(1, k('racecraft'))),
    passMargin: lerp(1.3, 0.55, aggression) + lerp(0.5, 0, Math.min(1, k('racecraft'))),
    passThreshold: lerp(2.2, 0.3, aggression),
    wearFactor: lerp(1.3, 0.85, Math.min(1, k('sympathy'))) * (1 + 0.2 * aggression),
    aggression,
    mass: def.weight,
  };
}

const FIRST_NAMES = [
  'Luca', 'Hugo', 'Mateo', 'Jonas', 'Kai', 'Oscar', 'Felix', 'Nico', 'Theo', 'Emil', 'Rafael', 'Kenji',
  'Sofia', 'Maya', 'Elena', 'Ines', 'Freya', 'Tatiana', 'Aiko', 'Lena', 'Marta', 'Bruno', 'Viktor', 'Dario',
];
const LAST_NAMES: readonly (readonly [string, string])[] = [
  ['Moretti', 'ITA'], ['Lindqvist', 'SWE'], ['Okafor', 'NGA'], ['Brandt', 'GER'], ['Tanaka', 'JPN'],
  ['Delacroix', 'FRA'], ['Hartley', 'GBR'], ['Varga', 'HUN'], ['Santos', 'BRA'], ['Kowalski', 'POL'],
  ['Navarro', 'ESP'], ['Petrov', 'BUL'], ['Halloran', 'IRL'], ['Vermeer', 'NED'], ['Castellano', 'ARG'],
  ['Nakamura', 'JPN'], ['Fischer', 'AUT'], ['Rossetti', 'ITA'], ['Whitlock', 'GBR'], ['Dumont', 'BEL'],
  ['Salonen', 'FIN'], ['Mbeki', 'RSA'], ['Ortega', 'MEX'], ['Keller', 'SUI'],
];

/**
 * Generates a plausible opponent: 100 points spread unevenly across skills so
 * each driver has clear strengths, plus a temperament.
 */
export function generateDriver(rng: Rng, index: number): DriverDef {
  const weights = SKILLS.map(() => 0.35 + rng.next() ** 1.6);
  const sum = weights.reduce((acc, w) => acc + w, 0);
  const skills = {} as Record<Skill, number>;
  let used = 0;
  SKILLS.forEach((s, i) => {
    const pts = Math.min(SKILL_CAP_AT_CREATION, Math.floor((weights[i] / sum) * STARTING_POINTS));
    skills[s] = pts;
    used += pts;
  });
  // Hand out the remainder one point at a time.
  let guard = 0;
  while (used < STARTING_POINTS && guard++ < 1000) {
    const s = SKILLS[rng.int(0, SKILLS.length - 1)];
    if (skills[s] < SKILL_CAP_AT_CREATION) {
      skills[s]++;
      used++;
    }
  }
  const [last, nationality] = rng.pick(LAST_NAMES);
  const first = rng.pick(FIRST_NAMES);
  return {
    id: `ai-${index}`,
    name: `${first} ${last}`,
    code: last.slice(0, 3).toUpperCase(),
    nationality,
    skills,
    aggression: clamp(0.5 + rng.normal() * 0.22, 0.05, 0.95),
    risk: clamp(0.45 + rng.normal() * 0.2, 0.05, 0.95),
    weight: Math.round(clamp(72 + rng.normal() * 7, 56, 92)),
    racesCompleted: 0,
  };
}
