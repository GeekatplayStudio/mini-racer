import { describe, expect, it } from 'vitest';
import { GT3_CARS } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { CarSpec, Controls, createCarState, engineTorque, maxDriveForce, rpmAt, stepCar } from '../src/sim/car';
import { computeRacingLine, computeSpeedProfile } from '../src/sim/line';
import { Track } from '../src/sim/track';

const DT = 1 / 240;
const ROAD = { gripFront: 1, gripRear: 1, drag: 0 };
const base = GT3_CARS[0].spec;

function drive(spec: CarSpec, seconds: number, ctl: Partial<Controls>, startSpeed = 0, env = ROAD) {
  const st = createCarState(spec, 0, 0, 0);
  st.vx = startSpeed;
  const controls: Controls = { steer: 0, throttle: 0, brake: 0, reverse: false, ...ctl };
  for (let t = 0; t < seconds; t += DT) stepCar(spec, st, controls, env, 75, DT);
  return st;
}

function withEngineScale(spec: CarSpec, k: number): CarSpec {
  return { ...spec, engine: { ...spec.engine, torque: spec.engine.torque.map((t) => t * k) } };
}

describe('GT3 car data', () => {
  it.each(GT3_CARS.map((m) => [m.spec.name, m.spec] as const))('%s is a plausible GT3 car', (_name, spec) => {
    let peakKw = 0;
    for (let rpm = spec.engine.idle; rpm <= spec.engine.redline; rpm += 100) {
      peakKw = Math.max(peakKw, (engineTorque(spec, rpm) * rpm * 2 * Math.PI) / 60000);
    }
    expect(peakKw).toBeGreaterThan(380);
    expect(peakKw).toBeLessThan(460);
    expect(spec.mass).toBeGreaterThan(1200);
    expect(spec.mass).toBeLessThan(1350);
    // Redline in top gear lands near 285 km/h.
    const top = spec.gears.length - 1;
    expect(rpmAt(spec, 285 / 3.6, top)).toBeGreaterThan(spec.engine.redline * 0.95);
    expect(rpmAt(spec, 285 / 3.6, top)).toBeLessThan(spec.engine.redline * 1.05);
  });
});

describe('Car physics', () => {
  it('stays at rest with no input', () => {
    const st = drive(base, 2, {});
    expect(Math.hypot(st.x, st.y)).toBeLessThan(0.01);
  });

  it('accelerates from rest to 100 km/h in a realistic time', () => {
    const st = createCarState(base, 0, 0, 0);
    const ctl: Controls = { steer: 0, throttle: 1, brake: 0, reverse: false };
    let t = 0;
    while (st.vx < 100 / 3.6 && t < 10) {
      stepCar(base, st, ctl, ROAD, 75, DT);
      t += DT;
    }
    expect(t).toBeGreaterThan(2.3);
    expect(t).toBeLessThan(4.5);
  });

  it('drives straight when not steered', () => {
    const st = drive(base, 6, { throttle: 1 });
    expect(Math.abs(st.y)).toBeLessThan(0.01);
    expect(Math.abs(st.heading)).toBeLessThan(1e-4);
  });

  it('goes faster with more power', () => {
    const slow = drive(withEngineScale(base, 0.8), 25, { throttle: 1 });
    const fast = drive(withEngineScale(base, 1.0), 25, { throttle: 1 });
    expect(fast.vx).toBeGreaterThan(slow.vx + 1);
    expect(fast.x).toBeGreaterThan(slow.x);
  });

  it('is slower on the straight with more drag', () => {
    // Compared before either car reaches the redline in top gear.
    const slippery = drive({ ...base, cdA: base.cdA * 0.8 }, 14, { throttle: 1 });
    const draggy = drive({ ...base, cdA: base.cdA * 1.3 }, 14, { throttle: 1 });
    expect(slippery.vx).toBeGreaterThan(draggy.vx + 2);
    expect(slippery.x).toBeGreaterThan(draggy.x + 5);
  });

  it('stops from 200 km/h in a realistic distance', () => {
    const st = createCarState(base, 0, 0, 0);
    st.vx = 200 / 3.6;
    const ctl: Controls = { steer: 0, throttle: 0, brake: 1, reverse: false };
    while (st.vx > 0.5) stepCar(base, st, ctl, ROAD, 75, DT);
    expect(st.x).toBeGreaterThan(70);
    expect(st.x).toBeLessThan(130);
    expect(Math.abs(st.y)).toBeLessThan(0.5);
  });

  it('takes longer to stop on grass', () => {
    const stop = (grip: number): number => {
      const st = createCarState(base, 0, 0, 0);
      st.vx = 40;
      const ctl: Controls = { steer: 0, throttle: 0, brake: 1, reverse: false };
      while (st.vx > 0.5) stepCar(base, st, ctl, { gripFront: grip, gripRear: grip, drag: 0 }, 75, DT);
      return st.x;
    };
    expect(stop(0.48)).toBeGreaterThan(stop(1) * 1.5);
  });

  it('turns toward positive heading with positive steer', () => {
    const st = drive(base, 2, { steer: 0.2, throttle: 0.3 }, 20);
    expect(st.heading).toBeGreaterThan(0.2);
    expect(st.y).toBeGreaterThan(1);
  });

  it('corners harder at speed with more downforce', () => {
    const lateral = (spec: CarSpec): number => {
      const st = drive(spec, 3, { steer: 0.12, throttle: 0.6 }, 60);
      return Math.abs(st.ay);
    };
    expect(lateral({ ...base, clA: base.clA * 1.6 })).toBeGreaterThan(lateral({ ...base, clA: 0.2 }) * 1.1);
  });

  it('loses grip as tyres wear', () => {
    const lateral = (wear: number): number => {
      const st = createCarState(base, 0, 0, 0);
      st.vx = 45;
      st.tyreWear = wear;
      const ctl: Controls = { steer: 0.3, throttle: 0.4, brake: 0, reverse: false };
      for (let t = 0; t < 1.5; t += DT) stepCar(base, st, ctl, ROAD, 75, DT);
      return Math.abs(st.ay);
    };
    expect(lateral(0)).toBeGreaterThan(lateral(1) * 1.08);
  });

  it('burns fuel and wears tyres when driven', () => {
    const st = drive(base, 20, { throttle: 1 });
    const fresh = createCarState(base, 0, 0, 0);
    expect(st.fuel).toBeLessThan(fresh.fuel);
    expect(st.tyreWear).toBeGreaterThan(0);
  });

  it('carries a heavier driver more slowly', () => {
    const run = (driverMass: number): number => {
      const st = createCarState(base, 0, 0, 0);
      const ctl: Controls = { steer: 0, throttle: 1, brake: 0, reverse: false };
      for (let t = 0; t < 8; t += DT) stepCar(base, st, ctl, ROAD, driverMass, DT);
      return st.x;
    };
    expect(run(55)).toBeGreaterThan(run(95));
  });

  it('backs up in reverse', () => {
    const st = drive(base, 2, { throttle: 0.8, reverse: true });
    expect(st.x).toBeLessThan(-1);
  });

  it('shifts up through the gears and stays below the redline', () => {
    const st = drive(base, 20, { throttle: 1 });
    expect(st.gear).toBeGreaterThanOrEqual(4);
    expect(st.rpm).toBeLessThanOrEqual(base.engine.redline);
  });

  it('never has more drive force at higher speed in top-gear range', () => {
    expect(maxDriveForce(base, 20)).toBeGreaterThan(maxDriveForce(base, 60));
  });
});

describe('Speed profile', () => {
  const track = new Track(BRANDS_HATCH_INDY);
  const line = computeRacingLine(track);
  const lapTime = (spec: CarSpec, cornerGrip = 0.93, brakeGrip = 0.9): number => {
    const v = computeSpeedProfile(track, line, spec, { mass: spec.mass + 105, cornerGrip, brakeGrip });
    let t = 0;
    for (let i = 0; i < track.n; i++) t += track.ds / v[i];
    return t;
  };

  it('predicts a GT3 lap of Brands Hatch Indy in the real range', () => {
    const t = lapTime(base);
    expect(t).toBeGreaterThan(40);
    expect(t).toBeLessThan(48);
  });

  it('is quicker with more grip, power or skill, and slower with more weight', () => {
    const ref = lapTime(base);
    expect(lapTime({ ...base, tyre: { ...base.tyre, muFront: base.tyre.muFront * 1.1, muRear: base.tyre.muRear * 1.1 } })).toBeLessThan(ref);
    expect(lapTime(withEngineScale(base, 1.15))).toBeLessThan(ref);
    expect(lapTime({ ...base, mass: base.mass + 150 })).toBeGreaterThan(ref);
    expect(lapTime(base, 0.86, 0.8)).toBeGreaterThan(ref);
  });

  it('never asks for more cornering speed than grip allows', () => {
    const v = computeSpeedProfile(track, line, base, { mass: base.mass + 105, cornerGrip: 0.93, brakeGrip: 0.9 });
    for (let i = 0; i < track.n; i++) {
      const lateralG = (v[i] * v[i] * Math.abs(line.curvature[i])) / 9.81;
      expect(lateralG).toBeLessThan(3.2);
    }
  });
});
