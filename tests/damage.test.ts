import { describe, expect, it } from 'vitest';
import { GT3_CARS } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { prepareTrack } from '../src/game/trackCache';
import { Controls, createCarState, stepCar } from '../src/sim/car';
import { generateDriver } from '../src/sim/driver';
import { PitPhase, Race, RaceEvent } from '../src/sim/race';
import { Rng } from '../src/sim/rng';

const brands = prepareTrack(BRANDS_HATCH_INDY);

function race(cars: number, laps: number, hazards = 0, seed = 2): Race {
  const rng = new Rng(seed);
  const entrants = Array.from({ length: cars }, (_, i) => ({ driver: generateDriver(rng, i), spec: GT3_CARS[i % GT3_CARS.length].spec }));
  return new Race(brands.track, entrants, laps, seed, brands.line, { hazards });
}

/** Tyre wear added over a few seconds, with the car held at a lateral offset from the centre line. */
function wearAt(offset: number): number {
  const r = race(1, 5);
  for (let i = 0; i < 240 * 14; i++) r.step();
  const car = r.cars[0];
  const before = car.state.tyreWear;
  for (let i = 0; i < 240 * 3; i++) {
    const k = car.loc.index;
    const [x, y] = brands.track.pointAt(car.loc.s, offset);
    car.state.x = x;
    car.state.y = y;
    car.state.heading = brands.track.heading[k];
    car.state.vx = 30;
    car.state.vy = 0;
    car.state.yawRate = 0;
    r.step();
  }
  return car.state.tyreWear - before;
}

describe('Damage and recovery', () => {
  it('a damaged car is slower but still drives', () => {
    const spec = GT3_CARS[0].spec;
    const ctl: Controls = { steer: 0, throttle: 1, brake: 0, reverse: false };
    const speedWith = (damage: number): number => {
      const st = createCarState(spec, 0, 0, 0);
      st.damage = damage;
      for (let i = 0; i < 240 * 25; i++) stepCar(spec, st, ctl, { gripFront: 1, gripRear: 1, drag: 0 }, 75, 1 / 240);
      return st.vx;
    };
    const fresh = speedWith(0), hurt = speedWith(0.6), wrecked = speedWith(1);
    expect(hurt).toBeLessThan(fresh * 0.99);
    expect(wrecked).toBeLessThan(hurt);
    // Even a car hit as hard as it can be keeps most of its speed.
    expect(wrecked).toBeGreaterThan(fresh * 0.8);
  });

  it('cars get going again after crashes: nobody is left stranded and everyone finishes', () => {
    const r = race(10, 3, 10);
    const stall = r.cars.map(() => 0);
    let worst = 0;
    const events: RaceEvent[] = [];
    while (r.phase !== 'finished' && r.time < 600) {
      r.step();
      events.push(...r.events);
      r.events.length = 0;
      if (r.phase !== 'racing') continue;
      r.cars.forEach((c, i) => {
        const v = Math.hypot(c.state.vx, c.state.vy);
        stall[i] = c.finished || c.retired || c.pitPhase !== PitPhase.None || v > 5 ? 0 : stall[i] + 1 / 240;
        worst = Math.max(worst, stall[i]);
      });
    }
    expect(r.phase).toBe('finished');
    expect(r.cars.every((c) => c.finished)).toBe(true);
    expect(worst).toBeLessThan(30);
    // There were knocks along the way, and they show on the cars.
    expect(events.some((e) => e.type === 'contact' || e.type === 'wall')).toBe(true);
    expect(r.cars.some((c) => c.state.damage > 0.05)).toBe(true);
    expect(r.cars.some((c) => c.dents.some((d) => d > 0))).toBe(true);
    for (const e of events) if (e.type === 'damage') expect(r.cars[e.car].dents.some((d) => d >= 0.35)).toBe(true);
  }, 60000);

  it('a pit stop repairs part of the damage', () => {
    const r = race(1, 6);
    const car = r.cars[0];
    car.state.damage = 0.6;
    car.dents = [0.9, 0, 0.5, 0];
    r.command(0, 'box');
    while (car.pitStops === 0 && r.time < 200) r.step();
    expect(car.pitStops).toBe(1);
    expect(car.state.damage).toBeCloseTo(0.3, 5);
    expect(car.dents[0]).toBeCloseTo(0.3, 5);
    expect(car.dents[2]).toBe(0);
  }, 30000);
});

describe('Tyre wear off the track', () => {
  it('grass wears tyres much faster than tarmac', () => {
    const road = wearAt(0);
    const grass = wearAt(brands.track.halfWidth + 2);
    expect(road).toBeGreaterThan(0);
    expect(grass).toBeGreaterThan(road * 2.5);
  });

  it('dirt stays on the tyres for a while after rejoining', () => {
    const r = race(1, 5);
    for (let i = 0; i < 240 * 14; i++) r.step();
    const car = r.cars[0];
    const [x, y] = brands.track.pointAt(car.loc.s, brands.track.halfWidth + 2);
    car.state.x = x;
    car.state.y = y;
    r.step();
    r.step();
    expect(car.dirt).toBeGreaterThan(0.5);
    const [bx, by] = brands.track.pointAt(car.loc.s, 0);
    car.state.x = bx;
    car.state.y = by;
    for (let i = 0; i < 240; i++) r.step();
    expect(car.dirt).toBeGreaterThan(0);
    expect(car.dirt).toBeLessThan(0.7);
  });
});
