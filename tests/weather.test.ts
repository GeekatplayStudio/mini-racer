import { describe, expect, it } from 'vitest';
import { GT3_CARS } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { prepareTrack } from '../src/game/trackCache';
import { generateDriver } from '../src/sim/driver';
import { Race, Weather } from '../src/sim/race';
import { Rng } from '../src/sim/rng';

const brands = prepareTrack(BRANDS_HATCH_INDY);

function race(weather: Weather | undefined, cars = 1, laps = 4, seed = 11): Race {
  const rng = new Rng(4);
  const entrants = Array.from({ length: cars }, (_, i) => ({ driver: generateDriver(rng, i), spec: GT3_CARS[i % GT3_CARS.length].spec }));
  return new Race(brands.track, entrants, laps, seed, brands.line, weather ? { weather } : {});
}

/** Runs to the flag; returns the longest any running car spent at a crawl, s. */
function run(r: Race, seconds: number, each?: () => void): number {
  const still = r.cars.map(() => 0);
  let worst = 0;
  const end = r.steps + seconds * 240;
  while (r.phase !== 'finished' && r.steps < end) {
    r.step();
    r.events.length = 0;
    each?.();
    if (r.phase !== 'racing' || r.time < 5) continue;
    for (const c of r.cars) {
      const idle = c.finished || c.retired || c.pitPhase !== 0;
      still[c.id] = !idle && Math.hypot(c.state.vx, c.state.vy) < 2 ? still[c.id] + 1 / 240 : 0;
      worst = Math.max(worst, still[c.id]);
    }
  }
  return worst;
}

function bestLap(weather: Weather | undefined): number {
  const r = race(weather);
  run(r, 400);
  expect(r.phase).toBe('finished');
  return r.cars[0].bestLap;
}

describe('Weather', () => {
  const dry = bestLap(undefined);

  it('a clear day is the race as it always was', () => {
    const a = race(undefined, 4, 2);
    const b = race('clear', 4, 2);
    run(a, 300);
    run(b, 300);
    expect(b.cars.map((c) => c.finishTime)).toEqual(a.cars.map((c) => c.finishTime));
    expect(b.cars.map((c) => c.state.x)).toEqual(a.cars.map((c) => c.state.x));
    expect(bestLap('clear')).toBe(dry);
    // The lap this car and driver have always done here.
    expect(dry).toBeCloseTo(DRY_LAP, 6);
    expect(a.wetness).toBe(0);
  });

  it('rain and snow cost a few seconds a lap, snow more than rain', () => {
    const rain = bestLap('rain');
    const snow = bestLap('snow');
    expect(rain / dry).toBeGreaterThan(1.03);
    expect(rain / dry).toBeLessThan(1.1);
    expect(snow / dry).toBeGreaterThan(1.04);
    expect(snow / dry).toBeLessThan(1.12);
    expect(snow).toBeGreaterThan(rain);
  });

  it('puddles and slush lie only on a wet track, on the road and away from the pits', () => {
    expect(race(undefined).puddles).toHaveLength(0);
    expect(race('clear').puddles).toHaveLength(0);
    for (const weather of ['rain', 'snow'] as const) {
      for (let seed = 1; seed <= 12; seed++) {
        const r = race(weather, 1, 1, seed);
        expect(r.puddles.length).toBeGreaterThanOrEqual(3);
        expect(r.wetness).toBeGreaterThan(0);
        for (const p of r.puddles) {
          expect(p.kind).toBe(weather === 'rain' ? 'water' : 'slush');
          expect(brands.track.inPitZone(p.s)).toBe(false);
          expect(Math.abs(p.d)).toBeLessThan(brands.track.halfWidth);
          // Clear of the last grid slot too.
          expect(p.s).toBeLessThan(brands.track.gridSlot(25).s);
        }
      }
    }
  });

  it('puddles grow and shrink slowly and take grip from a car in them', () => {
    const r = race('rain', 1, 3);
    const sizes = r.puddles.map((p) => p.radius);
    run(r, 60);
    expect(r.puddles.some((p, i) => Math.abs(p.radius - sizes[i]) > 0.02)).toBe(true);
    for (const p of r.puddles) expect(p.radius).toBeGreaterThan(p.base * 0.6);
    for (const p of r.puddles) expect(p.radius).toBeLessThan(p.base * 1.3);
    // Keep a pool under the car through a corner.
    const car = r.cars[0];
    const pool = r.puddles[0];
    let slid = 0;
    for (let i = 0; i < 480; i++) {
      pool.x = car.state.x;
      pool.y = car.state.y;
      r.step();
      slid = Math.max(slid, car.state.slideFront + car.state.slideRear, Math.abs(car.state.vy));
    }
    expect(slid).toBeGreaterThan(0.3);
  });

  for (const weather of ['rain', 'snow'] as const) {
    it(`a full grid races to the flag in ${weather}`, () => {
      const r = race(weather, 10, 4);
      const stalled = run(r, 900);
      expect(r.phase).toBe('finished');
      expect(r.cars.every((c) => c.finished && !c.retired)).toBe(true);
      expect(new Set(r.cars.map((c) => c.position)).size).toBe(10);
      expect(stalled).toBeLessThan(30);
    }, 120000);
  }

  it('is part of the replay: the same seed gives the same race', () => {
    const play = (weather: Weather): string => {
      const r = race(weather, 5, 2);
      run(r, 400);
      return r.puddles.map((p) => `${p.s}:${p.d}:${p.radius}`).join(',') + r.cars.map((c) => `${c.finishTime}:${c.state.x}`).join('|');
    };
    expect(play('rain')).toBe(play('rain'));
    expect(play('snow')).toBe(play('snow'));
    expect(play('rain')).not.toBe(play('snow'));
  }, 120000);
});

/** Best lap of the first GT3 car alone on a dry track with this seed, before weather existed. */
const DRY_LAP = 43.9875;
