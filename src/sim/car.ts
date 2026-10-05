import { AIR_DENSITY, GRAVITY, clamp, interpTable } from './math';

/**
 * Physical description of a complete car. In the full game this is derived
 * from the fitted parts; the simulation only ever sees this.
 */
export interface CarSpec {
  id: string;
  name: string;
  /** Kerb mass without driver or fuel, kg. */
  mass: number;
  wheelbase: number;
  /** Fraction of static weight on the front axle. */
  frontWeight: number;
  cgHeight: number;
  length: number;
  width: number;
  engine: {
    rpm: readonly number[];
    /** Full-throttle torque at each rpm point, Nm. */
    torque: readonly number[];
    idle: number;
    redline: number;
  };
  gears: readonly number[];
  finalDrive: number;
  wheelRadius: number;
  drivelineEfficiency: number;
  /** Torque interruption per shift, s. */
  shiftTime: number;
  /** Drag area Cd*A, m^2. */
  cdA: number;
  /** Downforce area Cl*A, m^2. */
  clA: number;
  /** Fraction of downforce on the front axle. */
  aeroBalance: number;
  /** Total brake force at full pedal, N. */
  brakeForce: number;
  /** Fraction of brake force on the front axle. */
  brakeBias: number;
  tyre: {
    muFront: number;
    muRear: number;
    /** Pacejka stiffness and shape factors. */
    b: number;
    c: number;
    /** Grip lost per unit of load above static, as a fraction. */
    loadSensitivity: number;
    /** Wear per metre at full grip use; 1.0 wear is a finished tyre. */
    wearRate: number;
  };
  maxSteer: number;
  /** Traction control and ABS intervention, 0 (off) to 1 (full). */
  tractionControl: number;
  abs: number;
  fuelCapacity: number;
  /** Cockpit comfort, 0 (bare) to about 0.4; slows driver fatigue. */
  comfort: number;
  /** Wear the tyres start a session with, 0 (new) to 1. */
  startTyreWear: number;
  /** Grip the aids hold in reserve, as a fraction: safer but slower at high settings. */
  tcMargin: number;
  absMargin: number;
  /** Fuel burned relative to a best-power mixture; richer maps use more. */
  fuelUse: number;
  /** Engine speed held on the start line, rpm. */
  launchRpm: number;
  /** Fuel on board at the start, kg. */
  startFuel: number;
}

export interface Controls {
  /** -1 (toward negative heading) to 1. */
  steer: number;
  throttle: number;
  brake: number;
  /** Drive backwards in first gear; used to get out of a barrier. */
  reverse: boolean;
}

export interface CarState {
  x: number;
  y: number;
  heading: number;
  /** Velocity in the car frame: forward and toward positive heading. */
  vx: number;
  vy: number;
  yawRate: number;
  /** Actual front-wheel angle after the steering rate limit, rad. */
  steerAngle: number;
  /** 0-based gear index. */
  gear: number;
  rpm: number;
  shiftTimer: number;
  fuel: number;
  /** 0 (new) to 1 (finished). */
  tyreWear: number;
  /** 0 (pristine) to 1 (wrecked). */
  damage: number;
  /** Smoothed accelerations in the car frame, m/s^2. */
  ax: number;
  ay: number;
  /** Tyre slide intensity 0..1 per axle, for skid marks, smoke and sound. */
  slideFront: number;
  slideRear: number;
  throttle: number;
  brake: number;
}

export interface CarEnvironment {
  gripFront: number;
  gripRear: number;
  /** Surface drag as a fraction of weight. */
  drag: number;
}

export const STEER_RATE = 3.2;
const DRIVER_MASS_DEFAULT = 75;
/** Brake-specific fuel consumption, kg per joule of crank work (about 265 g/kWh). */
const FUEL_PER_JOULE = 7.4e-8;

export function createCarState(spec: CarSpec, x: number, y: number, heading: number): CarState {
  return {
    x,
    y,
    heading,
    vx: 0,
    vy: 0,
    yawRate: 0,
    steerAngle: 0,
    gear: 0,
    rpm: spec.engine.idle,
    shiftTimer: 0,
    fuel: Math.min(spec.fuelCapacity, spec.startFuel),
    tyreWear: spec.startTyreWear,
    damage: 0,
    ax: 0,
    ay: 0,
    slideFront: 0,
    slideRear: 0,
    throttle: 0,
    brake: 0,
  };
}

export function engineTorque(spec: CarSpec, rpm: number): number {
  return interpTable(spec.engine.rpm, spec.engine.torque, rpm);
}

export function rpmAt(spec: CarSpec, speed: number, gear: number): number {
  return (speed / spec.wheelRadius) * spec.gears[gear] * spec.finalDrive * (60 / (2 * Math.PI));
}

/** Best full-throttle drive force at the wheels over all gears, N. */
export function maxDriveForce(spec: CarSpec, speed: number): number {
  let best = 0;
  for (let g = 0; g < spec.gears.length; g++) {
    const rpm = rpmAt(spec, speed, g);
    if (rpm > spec.engine.redline) continue;
    const t = engineTorque(spec, Math.max(rpm, spec.engine.idle));
    const f = (t * spec.gears[g] * spec.finalDrive * spec.drivelineEfficiency) / spec.wheelRadius;
    if (f > best) best = f;
  }
  return best;
}

export function totalMass(spec: CarSpec, st: CarState, driverMass = DRIVER_MASS_DEFAULT): number {
  return spec.mass + driverMass + st.fuel;
}

/** Simplified Pacejka curve, normalised so the peak is 1. */
function tyreCurve(slip: number, b: number, c: number): number {
  return Math.sin(c * Math.atan(b * slip));
}

/**
 * Advances one car by dt using a two-axle (bicycle) model: slip-angle tyres
 * with a friction circle, longitudinal load transfer, speed-squared aero and
 * an engine driving the rear axle through a sequential gearbox.
 */
export function stepCar(
  spec: CarSpec,
  st: CarState,
  ctl: Controls,
  env: CarEnvironment,
  driverMass: number,
  dt: number,
): void {
  const m = spec.mass + driverMass + st.fuel;
  const L = spec.wheelbase;
  const a = L * (1 - spec.frontWeight);
  const b = L - a;
  const iz = m * a * b * 1.15;

  const throttle = clamp(ctl.throttle, 0, 1);
  const brake = clamp(ctl.brake, 0, 1);
  st.throttle = throttle;
  st.brake = brake;

  const steerTarget = clamp(ctl.steer, -1, 1) * spec.maxSteer;
  const maxDelta = STEER_RATE * dt;
  st.steerAngle += clamp(steerTarget - st.steerAngle, -maxDelta, maxDelta);
  const delta = st.steerAngle;

  const speed = Math.hypot(st.vx, st.vy);
  const vxAbs = Math.abs(st.vx);

  // Vertical loads: static + aero + longitudinal transfer.
  // Bent bodywork costs a little downforce, power and drag; the car still runs.
  const downforce = 0.5 * AIR_DENSITY * spec.clA * speed * speed * (1 - 0.25 * st.damage);
  const transfer = (m * st.ax * spec.cgHeight) / L;
  const fzFrontStatic = m * GRAVITY * spec.frontWeight;
  const fzRearStatic = m * GRAVITY * (1 - spec.frontWeight);
  const fzFront = Math.max(200, fzFrontStatic + downforce * spec.aeroBalance - transfer);
  const fzRear = Math.max(200, fzRearStatic + downforce * (1 - spec.aeroBalance) + transfer);

  const wearGrip = 1 - 0.14 * st.tyreWear * st.tyreWear - 0.04 * st.tyreWear;
  const sens = spec.tyre.loadSensitivity;
  const muFront =
    spec.tyre.muFront * env.gripFront * wearGrip * (1 - sens * (fzFront / fzFrontStatic - 1));
  const muRear =
    spec.tyre.muRear * env.gripRear * wearGrip * (1 - sens * (fzRear / fzRearStatic - 1));
  const capFront = muFront * fzFront;
  const capRear = muRear * fzRear;

  // Slip angles. A floor on the forward speed keeps the model stable near rest.
  const vxSlip = Math.max(vxAbs, 4);
  const dir = st.vx >= 0 ? 1 : -1;
  const alphaFront = Math.atan2(st.vy + a * st.yawRate, vxSlip) - delta * dir;
  const alphaRear = Math.atan2(st.vy - b * st.yawRate, vxSlip);
  let fyFront = -capFront * tyreCurve(alphaFront, spec.tyre.b, spec.tyre.c);
  let fyRear = -capRear * tyreCurve(alphaRear, spec.tyre.b, spec.tyre.c);

  // Gearbox: sequential auto-shift on rpm.
  const eng = spec.engine;
  let rpm = rpmAt(spec, vxAbs, st.gear);
  if (st.shiftTimer > 0) {
    st.shiftTimer -= dt;
  } else if (ctl.reverse) {
    st.gear = 0;
    rpm = rpmAt(spec, vxAbs, 0);
  } else if (rpm > eng.redline * 0.975 && st.gear < spec.gears.length - 1) {
    st.gear++;
    st.shiftTimer = spec.shiftTime;
    rpm = rpmAt(spec, vxAbs, st.gear);
  } else if (st.gear > 0 && rpmAt(spec, vxAbs, st.gear - 1) < eng.redline * 0.8) {
    st.gear--;
    st.shiftTimer = spec.shiftTime;
    rpm = rpmAt(spec, vxAbs, st.gear);
  }
  // Below idle the clutch slips and the engine holds launch revs.
  const launchRpm = eng.idle + (Math.min(spec.launchRpm, eng.redline) - eng.idle) * throttle;
  const engineRpm = clamp(Math.max(rpm, st.gear === 0 ? launchRpm : eng.idle), eng.idle, eng.redline);
  st.rpm += (engineRpm - st.rpm) * Math.min(1, dt * 18);

  const ratio = spec.gears[st.gear] * spec.finalDrive;
  let fxRear = 0;
  let crankPower = 0;
  if (st.shiftTimer <= 0) {
    // No fuel, no fire.
    const limiter = rpm >= eng.redline || st.fuel <= 0 ? 0 : 1;
    const torque = engineTorque(spec, engineRpm) * throttle * limiter * (1 - 0.1 * st.damage);
    // Engine braking when off throttle.
    const drag =
      throttle < 0.05
        ? -0.05 * engineTorque(spec, engineRpm) * (engineRpm / eng.redline) * clamp(vxAbs / 2, 0, 1) * dir
        : 0;
    fxRear = ((torque + drag) * ratio * spec.drivelineEfficiency) / spec.wheelRadius;
    if (ctl.reverse) fxRear *= -0.5;
    crankPower = torque * engineRpm * ((2 * Math.PI) / 60);
  }

  // Brakes oppose the direction of travel and fade out at a standstill.
  const brakeScale = clamp(vxAbs / 0.5, 0, 1) * dir;
  let fxFront = -brake * spec.brakeForce * spec.brakeBias * brakeScale;
  fxRear -= brake * spec.brakeForce * (1 - spec.brakeBias) * brakeScale;

  // Traction control and ABS keep longitudinal force inside what the tyre has
  // left after cornering; with them off the raw demand goes to the friction circle.
  const tcRear = fxRear > 0 ? spec.tractionControl : spec.abs;
  fxRear = limitLongitudinal(fxRear, fyRear, capRear, tcRear, fxRear > 0 ? spec.tcMargin : spec.absMargin);
  fxFront = limitLongitudinal(fxFront, fyFront, capFront, spec.abs, spec.absMargin);

  // Friction circle: longitudinal use reduces the lateral force available.
  fyFront = limitLateral(fyFront, fxFront, capFront);
  fyRear = limitLateral(fyRear, fxRear, capRear);

  const aeroDrag = 0.5 * AIR_DENSITY * spec.cdA * (1 + 0.3 * st.damage) * speed * speed;
  const rolling = m * GRAVITY * (0.012 + env.drag);
  const resist = speed > 0.05 ? (aeroDrag + rolling) / speed : 0;

  const cosD = Math.cos(delta);
  const sinD = Math.sin(delta);
  const fx = fxRear + fxFront * cosD - fyFront * sinD - resist * st.vx;
  const fy = fyRear + fyFront * cosD + fxFront * sinD - resist * st.vy;
  const mz = a * (fyFront * cosD + fxFront * sinD) - b * fyRear;

  const axNow = fx / m;
  const ayNow = fy / m;
  st.vx += (axNow + st.vy * st.yawRate) * dt;
  st.vy += (ayNow - st.vx * st.yawRate) * dt;
  st.yawRate += (mz / iz) * dt;

  // Settle completely when nearly stopped with no drive demand.
  if (speed < 0.6 && throttle < 0.02) {
    const k = Math.max(0, 1 - 6 * dt);
    st.vx *= k;
    st.vy *= k;
    st.yawRate *= k;
  }

  const smooth = Math.min(1, dt * 12);
  st.ax += (axNow - st.ax) * smooth;
  st.ay += (ayNow - st.ay) * smooth;

  const cosH = Math.cos(st.heading);
  const sinH = Math.sin(st.heading);
  st.x += (st.vx * cosH - st.vy * sinH) * dt;
  st.y += (st.vx * sinH + st.vy * cosH) * dt;
  st.heading += st.yawRate * dt;

  // Slide intensity: how far past the grip peak each axle is working.
  const peakSlip = Math.tan(Math.PI / (2 * spec.tyre.c)) / spec.tyre.b;
  const moving = clamp((speed - 4) / 6, 0, 1);
  const useFront = Math.hypot(fxFront, fyFront) / capFront;
  const useRear = Math.hypot(fxRear, fyRear) / capRear;
  st.slideFront = moving * clamp((Math.abs(alphaFront) / peakSlip - 1.05) * 1.6, 0, 1);
  st.slideRear = moving * clamp((Math.abs(alphaRear) / peakSlip - 1.05) * 1.6, 0, 1);

  st.tyreWear = Math.min(
    1,
    st.tyreWear +
      spec.tyre.wearRate * speed * dt * (0.25 + 0.75 * (useFront * useFront + useRear * useRear) * 0.5) *
        (1 + 3 * (st.slideFront + st.slideRear)),
  );
  st.fuel = Math.max(0, st.fuel - crankPower * FUEL_PER_JOULE * spec.fuelUse * dt);
}

function limitLongitudinal(fx: number, fy: number, cap: number, assist: number, margin: number): number {
  const hardLimit = cap;
  const lateral = Math.min(Math.abs(fy), cap);
  const assisted = Math.sqrt(Math.max(0, cap * cap - lateral * lateral)) * (1 - margin);
  const limit = hardLimit + (assisted - hardLimit) * assist;
  return clamp(fx, -limit, limit);
}

function limitLateral(fy: number, fx: number, cap: number): number {
  const room = Math.sqrt(Math.max(cap * cap * 0.02, cap * cap - fx * fx));
  return clamp(fy, -room, room);
}
