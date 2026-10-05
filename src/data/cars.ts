import type { CarSpec } from '../sim/car';

/** Visual proportions of a car body; the renderer lofts a low-poly shell from these. */
export interface BodyStyle {
  /** Where the cabin sits along the car: 0 is the nose, 1 the tail. */
  cabinStart: number;
  cabinEnd: number;
  /** Heights in metres. */
  noseHeight: number;
  hoodHeight: number;
  roofHeight: number;
  deckHeight: number;
  /** Roof width as a fraction of body width. */
  roofWidth: number;
  /** How far the rear arches bulge beyond the front, fraction of width. */
  rearFlare: number;
  wingHeight: number;
  /** Fastback (sloping to the tail) rather than a notch with a deck. */
  fastback: boolean;
}

export interface Livery {
  /** Main body colour. */
  base: number;
  /** Stripe and wing colour. */
  accent: number;
  /** Number shown on the roof and timing screens. */
  number: number;
}

export interface CarModel {
  spec: CarSpec;
  body: BodyStyle;
}

export interface EngineInput {
  powerKw: number;
  redline: number;
  turbo: boolean;
}

/** Builds a full-throttle torque table that peaks at the requested power. */
export function makeEngine(e: EngineInput): CarSpec['engine'] {
  const shape = e.turbo
    ? [0.55, 0.82, 1.0, 1.0, 1.0, 0.97, 0.9, 0.8, 0.68]
    : [0.62, 0.72, 0.82, 0.9, 0.97, 1.0, 0.98, 0.93, 0.84];
  const rpm = shape.map((_, i) => Math.round(e.redline * (0.2 + (0.8 * i) / (shape.length - 1))));
  let peak = 0;
  for (let i = 0; i < shape.length; i++) peak = Math.max(peak, shape[i] * rpm[i] * ((2 * Math.PI) / 60));
  const scale = (e.powerKw * 1000) / peak;
  return {
    rpm,
    torque: shape.map((s) => Math.round(s * scale)),
    idle: Math.round(e.redline * 0.2),
    redline: e.redline,
  };
}

const GEAR_STEPS = [2.85, 2.12, 1.66, 1.35, 1.14, 1.0];
const WHEEL_RADIUS = 0.345;

interface SpecInput {
  id: string;
  name: string;
  mass: number;
  wheelbase: number;
  frontWeight: number;
  length: number;
  width: number;
  engine: EngineInput;
  /** Speed at the redline in top gear, km/h. */
  topSpeedKmh: number;
  cdA: number;
  clA: number;
  muFront: number;
  muRear: number;
}

function makeSpec(i: SpecInput): CarSpec {
  const topRatio = (i.engine.redline * ((2 * Math.PI) / 60) * WHEEL_RADIUS) / (i.topSpeedKmh / 3.6);
  return {
    id: i.id,
    name: i.name,
    mass: i.mass,
    wheelbase: i.wheelbase,
    frontWeight: i.frontWeight,
    cgHeight: 0.44,
    length: i.length,
    width: i.width,
    engine: makeEngine(i.engine),
    gears: GEAR_STEPS,
    finalDrive: topRatio,
    wheelRadius: WHEEL_RADIUS,
    drivelineEfficiency: 0.93,
    shiftTime: 0.06,
    cdA: i.cdA,
    clA: i.clA,
    aeroBalance: i.frontWeight - 0.05,
    brakeForce: 1.95 * (i.mass + 110) * 9.81,
    brakeBias: i.frontWeight + 0.23,
    tyre: {
      muFront: i.muFront,
      muRear: i.muRear,
      b: 14,
      c: 1.45,
      loadSensitivity: 0.08,
      wearRate: 8e-6,
    },
    maxSteer: 0.42,
    tractionControl: 0.9,
    abs: 0.9,
    fuelCapacity: 88,
    comfort: 0.2,
    startTyreWear: 0,
    tcMargin: 0.02,
    absMargin: 0.02,
    fuelUse: 1,
    launchRpm: i.engine.redline * 0.55,
    startFuel: 31,
  };
}

/**
 * The GT3 field for the first race slice. Figures follow each car's
 * homologated layout and published output, levelled as Balance of Performance does.
 */
export const GT3_CARS: readonly CarModel[] = [
  {
    spec: makeSpec({
      id: 'porsche-911-gt3-r-992', name: 'Porsche 911 GT3 R (992)', mass: 1250, wheelbase: 2.507,
      frontWeight: 0.41, length: 4.62, width: 2.04, engine: { powerKw: 415, redline: 9250, turbo: false },
      topSpeedKmh: 282, cdA: 0.94, clA: 2.7, muFront: 1.55, muRear: 1.72,
    }),
    body: { cabinStart: 0.3, cabinEnd: 0.72, noseHeight: 0.5, hoodHeight: 0.72, roofHeight: 1.26, deckHeight: 0.86, roofWidth: 0.66, rearFlare: 0.07, wingHeight: 1.3, fastback: true },
  },
  {
    spec: makeSpec({
      id: 'bmw-m4-gt3', name: 'BMW M4 GT3', mass: 1300, wheelbase: 2.917,
      frontWeight: 0.5, length: 5.02, width: 2.04, engine: { powerKw: 434, redline: 7000, turbo: true },
      topSpeedKmh: 286, cdA: 0.97, clA: 2.75, muFront: 1.6, muRear: 1.7,
    }),
    body: { cabinStart: 0.4, cabinEnd: 0.8, noseHeight: 0.56, hoodHeight: 0.84, roofHeight: 1.3, deckHeight: 0.95, roofWidth: 0.68, rearFlare: 0.03, wingHeight: 1.36, fastback: false },
  },
  {
    spec: makeSpec({
      id: 'mercedes-amg-gt3-evo', name: 'Mercedes-AMG GT3 Evo', mass: 1285, wheelbase: 2.665,
      frontWeight: 0.49, length: 4.75, width: 2.05, engine: { powerKw: 405, redline: 7500, turbo: false },
      topSpeedKmh: 280, cdA: 0.95, clA: 2.8, muFront: 1.6, muRear: 1.7,
    }),
    body: { cabinStart: 0.46, cabinEnd: 0.84, noseHeight: 0.52, hoodHeight: 0.8, roofHeight: 1.24, deckHeight: 0.9, roofWidth: 0.64, rearFlare: 0.04, wingHeight: 1.3, fastback: true },
  },
  {
    spec: makeSpec({
      id: 'ferrari-296-gt3', name: 'Ferrari 296 GT3', mass: 1250, wheelbase: 2.66,
      frontWeight: 0.42, length: 4.57, width: 2.05, engine: { powerKw: 441, redline: 8000, turbo: true },
      topSpeedKmh: 288, cdA: 0.9, clA: 2.6, muFront: 1.56, muRear: 1.72,
    }),
    body: { cabinStart: 0.26, cabinEnd: 0.62, noseHeight: 0.42, hoodHeight: 0.62, roofHeight: 1.16, deckHeight: 0.84, roofWidth: 0.62, rearFlare: 0.06, wingHeight: 1.22, fastback: false },
  },
  {
    spec: makeSpec({
      id: 'audi-r8-lms-gt3-evo2', name: 'Audi R8 LMS GT3 Evo II', mass: 1235, wheelbase: 2.65,
      frontWeight: 0.43, length: 4.58, width: 2.0, engine: { powerKw: 430, redline: 8500, turbo: false },
      topSpeedKmh: 284, cdA: 0.93, clA: 2.65, muFront: 1.56, muRear: 1.72,
    }),
    body: { cabinStart: 0.27, cabinEnd: 0.63, noseHeight: 0.46, hoodHeight: 0.66, roofHeight: 1.17, deckHeight: 0.88, roofWidth: 0.64, rearFlare: 0.04, wingHeight: 1.24, fastback: false },
  },
  {
    spec: makeSpec({
      id: 'lamborghini-huracan-gt3-evo2', name: 'Lamborghini Huracán GT3 EVO2', mass: 1230, wheelbase: 2.645,
      frontWeight: 0.42, length: 4.55, width: 2.05, engine: { powerKw: 430, redline: 8500, turbo: false },
      topSpeedKmh: 285, cdA: 0.92, clA: 2.6, muFront: 1.56, muRear: 1.72,
    }),
    body: { cabinStart: 0.25, cabinEnd: 0.6, noseHeight: 0.4, hoodHeight: 0.58, roofHeight: 1.14, deckHeight: 0.86, roofWidth: 0.6, rearFlare: 0.05, wingHeight: 1.2, fastback: false },
  },
  {
    spec: makeSpec({
      id: 'mclaren-720s-gt3-evo', name: 'McLaren 720S GT3 Evo', mass: 1240, wheelbase: 2.67,
      frontWeight: 0.42, length: 4.66, width: 2.04, engine: { powerKw: 425, redline: 8000, turbo: true },
      topSpeedKmh: 287, cdA: 0.9, clA: 2.62, muFront: 1.56, muRear: 1.72,
    }),
    body: { cabinStart: 0.27, cabinEnd: 0.61, noseHeight: 0.42, hoodHeight: 0.6, roofHeight: 1.16, deckHeight: 0.8, roofWidth: 0.58, rearFlare: 0.06, wingHeight: 1.2, fastback: true },
  },
  {
    spec: makeSpec({
      id: 'aston-martin-vantage-gt3', name: 'Aston Martin Vantage AMR GT3', mass: 1265, wheelbase: 2.704,
      frontWeight: 0.49, length: 4.6, width: 2.04, engine: { powerKw: 400, redline: 7200, turbo: true },
      topSpeedKmh: 281, cdA: 0.95, clA: 2.75, muFront: 1.6, muRear: 1.7,
    }),
    body: { cabinStart: 0.42, cabinEnd: 0.8, noseHeight: 0.52, hoodHeight: 0.78, roofHeight: 1.25, deckHeight: 0.92, roofWidth: 0.64, rearFlare: 0.05, wingHeight: 1.3, fastback: true },
  },
];

/** Team colours for generated entries. */
export const LIVERIES: readonly Livery[] = [
  { base: 0xd8232a, accent: 0xf4f4f0, number: 7 },
  { base: 0xf2c21a, accent: 0x1a1a22, number: 23 },
  { base: 0x1f6fe0, accent: 0xf4f4f0, number: 46 },
  { base: 0xf4f4f0, accent: 0xe0531f, number: 11 },
  { base: 0x1fa85a, accent: 0xf2c21a, number: 88 },
  { base: 0x22242c, accent: 0x33d6c8, number: 5 },
  { base: 0xf07a1c, accent: 0x1a1a22, number: 59 },
  { base: 0x8a35d6, accent: 0xf4f4f0, number: 31 },
  { base: 0x10b6d8, accent: 0xd8232a, number: 99 },
  { base: 0xe84a8a, accent: 0x22242c, number: 16 },
];
