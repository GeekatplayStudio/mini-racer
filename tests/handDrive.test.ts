import { describe, expect, it } from 'vitest';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { DriveKeys, HandDriver } from '../src/game/handDrive';
import { createQuickRace } from '../src/game/raceSetup';
import { createCarState, stepCar } from '../src/sim/car';
import { Race, RaceCar } from '../src/sim/race';

const DT = 1 / 240;
const NONE: DriveKeys = { left: false, right: false, up: false, down: false };
const session = (): ReturnType<typeof createQuickRace> =>
  createQuickRace({ trackDef: BRANDS_HATCH_INDY, gridSize: 6, laps: 2, seed: 11, playerGrid: 2 });
const spec = session().race.cars[0].spec;
const ROAD = { gripFront: 1, gripRear: 1, drag: 0 };

/** Drives a car alone on an endless flat road for some seconds with the keys held. */
function drive(keys: DriveKeys, seconds: number, speed = 0): ReturnType<typeof createCarState> {
  const hand = new HandDriver();
  const st = createCarState(spec, 0, 0, 0);
  st.vx = speed;
  for (let i = 0; i < seconds / DT; i++) stepCar(spec, st, hand.update(keys, spec, st, DT), ROAD, 75, DT);
  return st;
}

/**
 * Presses keys the way a person would, all or nothing: steer at a point on
 * the racing line ahead, lift and brake for the corners coming up.
 */
function keysFor(race: Race, car: RaceCar): DriveKeys {
  const { track, line } = race;
  const st = car.state;
  const v = Math.hypot(st.vx, st.vy);
  const ahead = track.indexAt(car.loc.s + 10 + v * 0.45);
  const want = Math.atan2(line.y[ahead] - st.y, line.x[ahead] - st.x) - st.heading;
  const err = Math.atan2(Math.sin(want), Math.cos(want));
  let bend = 0;
  for (let m = 0; m < 30 + v * 1.6; m += 4) bend = Math.max(bend, Math.abs(line.curvature[track.indexAt(car.loc.s + m)]));
  const safe = Math.sqrt((1.25 * 9.81) / Math.max(bend, 1e-4));
  return { left: err < -0.02, right: err > 0.02, up: v < safe * 0.95, down: v > safe * 1.05 };
}

describe('HandDriver', () => {
  it('accelerates on the throttle key and stops on the brake key', () => {
    const fast = drive({ ...NONE, up: true }, 4);
    expect(fast.vx).toBeGreaterThan(20);
    const hand = new HandDriver();
    const st = createCarState(spec, 0, 0, 0);
    st.vx = 30;
    for (let i = 0; i < 4 / DT; i++) stepCar(spec, st, hand.update({ ...NONE, down: true }, spec, st, DT), ROAD, 75, DT);
    expect(st.vx).toBeLessThan(1);
  });

  it('reverses once stopped with the brake key held', () => {
    const st = drive({ ...NONE, down: true }, 3);
    expect(st.vx).toBeLessThan(-0.5);
  });

  it('steers left and right on A and D', () => {
    expect(drive({ ...NONE, up: true, right: true }, 2, 15).heading).toBeGreaterThan(0.3);
    expect(drive({ ...NONE, up: true, left: true }, 2, 15).heading).toBeLessThan(-0.3);
  });

  it('holds a full-lock turn at speed without spinning', () => {
    for (const speed of [20, 40, 60]) {
      const hand = new HandDriver();
      const st = createCarState(spec, 0, 0, 0);
      st.vx = speed;
      st.gear = 3;
      for (let i = 0; i < 4 / DT; i++) {
        const keys = { ...NONE, right: true, up: Math.hypot(st.vx, st.vy) < speed };
        stepCar(spec, st, hand.update(keys, spec, st, DT), ROAD, 75, DT);
        expect(Math.abs(Math.atan2(st.vy, st.vx))).toBeLessThan(0.25);
      }
      expect(Math.abs(st.ay)).toBeGreaterThan(1.3 * 9.81);
    }
  });
});

describe('Driving the player car by hand', () => {
  it('uses the keys while racing and leaves the start to the driver', () => {
    const { race, playerCar } = session();
    const me = race.cars[playerCar];
    const hand = new HandDriver();
    me.manual = hand.controls;
    while (race.phase === 'countdown') {
      expect(race.drivenByHand(me)).toBe(false);
      hand.update({ ...NONE, up: true }, me.spec, me.state, DT);
      race.step();
      if (race.phase === 'countdown') expect(me.controls).not.toBe(hand.controls);
    }
    expect(race.drivenByHand(me)).toBe(true);
    expect(me.controls).toBe(hand.controls);
  });

  it('completes laps on the keys alone', () => {
    const { race, playerCar } = session();
    const me = race.cars[playerCar];
    const hand = new HandDriver();
    me.manual = hand.controls;
    let walls = 0;
    while (!me.finished && race.time < 200) {
      hand.update(keysFor(race, me), me.spec, me.state, DT);
      race.step();
      walls += race.events.filter((e) => e.type === 'wall' && e.car === playerCar).length;
      race.events.length = 0;
    }
    expect(me.finished).toBe(true);
    expect(walls).toBe(0);
    // A hand on the keys is slower than the driver, but not by much.
    expect(me.bestLap).toBeLessThan(race.fastestLap * 1.25);
  });

  it('hands the car back to the driver, who carries on', () => {
    const { race, playerCar } = session();
    const me = race.cars[playerCar];
    const hand = new HandDriver();
    me.manual = hand.controls;
    // Left on the grid with no keys pressed for ten seconds, then given back.
    while (race.time < 10) {
      hand.update(NONE, me.spec, me.state, DT);
      race.step();
    }
    expect(Math.hypot(me.state.vx, me.state.vy)).toBeLessThan(2);
    me.manual = null;
    while (race.phase !== 'finished' && race.time < 300) race.step();
    expect(me.finished).toBe(true);
  });

  it('lets the driver take the pit lane', () => {
    const { race, playerCar } = session();
    const me = race.cars[playerCar];
    const hand = new HandDriver();
    me.manual = hand.controls;
    me.pitRequested = true;
    let inLane = false;
    while (me.pitStops === 0 && race.time < 200) {
      hand.update(keysFor(race, me), me.spec, me.state, DT);
      race.step();
      if (me.pitPhase !== 0) {
        inLane = true;
        expect(race.drivenByHand(me)).toBe(false);
      }
    }
    expect(inLane).toBe(true);
    expect(me.pitStops).toBe(1);
  });
});
