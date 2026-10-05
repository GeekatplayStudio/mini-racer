import { describe, expect, it } from 'vitest';
import { GT3_CARS } from '../src/data/cars';
import { getPart } from '../src/data/parts';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { deriveCar } from '../src/game/build';
import {
  applyAutoBuild,
  buyCar,
  newProfile,
  removePart,
  sanitizePrefs,
  sellCar,
  settleRace,
  upgradeProfile,
} from '../src/game/profile';
import { prepareTrack } from '../src/game/trackCache';
import { generateDriver } from '../src/sim/driver';
import { PitPhase, Race, RaceEvent } from '../src/sim/race';
import { Rng } from '../src/sim/rng';
import { PIT_BOXES } from '../src/sim/track';

const brands = prepareTrack(BRANDS_HATCH_INDY);

function race(cars: number, laps: number, wearScale = 1, seed = 5): Race {
  const rng = new Rng(seed);
  const entrants = Array.from({ length: cars }, (_, i) => ({ driver: generateDriver(rng, i), spec: GT3_CARS[i % GT3_CARS.length].spec }));
  return new Race(brands.track, entrants, laps, seed, brands.line, { wearScale });
}

function runUntil(r: Race, done: () => boolean, seconds: number): RaceEvent[] {
  const events: RaceEvent[] = [];
  const end = r.steps + seconds * 240;
  while (!done() && r.steps < end) {
    r.step();
    events.push(...r.events);
    r.events.length = 0;
  }
  return events;
}

describe('Race rules', () => {
  it('a lap with a pit stop in it does not reset the fuel figure', () => {
    const r = race(1, 6);
    const car = r.cars[0];
    runUntil(r, () => car.fuelPerLap > 0, 200);
    const before = car.fuelPerLap;
    expect(before).toBeGreaterThan(0.3);
    r.command(0, 'box');
    // Through the stop and over the line once more.
    runUntil(r, () => car.pitStops > 0 && car.pitPhase === PitPhase.None, 200);
    const lap = r.lapsDone(car);
    runUntil(r, () => r.lapsDone(car) > lap, 120);
    // Before the fix this read only the few metres from the box to the line.
    expect(car.fuelPerLap).toBeGreaterThan(before * 0.6);
    expect(car.fuelPerLap).toBeLessThan(before * 1.6);
  }, 30000);

  it('a lapped car that takes the flag is classified behind cars on the lead lap', () => {
    const r = race(3, 5);
    runUntil(r, () => r.phase === 'racing' && r.time > 5, 60);
    const [winner, lapped, second] = r.cars;
    const L = r.track.length;
    // The winner is home; the lapped car takes the flag a lap down; the second car is still on its last lap.
    Object.assign(winner, { finished: true, crossings: 6, finishTime: 100, progress: 5 * L + 3 });
    Object.assign(lapped, { finished: true, crossings: 5, finishTime: 102, progress: 4 * L + 3 });
    Object.assign(second, { crossings: 5, progress: 4 * L + 900 });
    second.state.x = r.track.x[450];
    second.state.y = r.track.y[450];
    r.step();
    expect(r.order.map((c) => c.id)).toEqual([winner.id, second.id, lapped.id]);
    // And once the second car finishes too, it stays ahead.
    Object.assign(second, { finished: true, crossings: 6, finishTime: 105, progress: 5 * L + 3 });
    r.step();
    expect(r.order.map((c) => c.id)).toEqual([winner.id, second.id, lapped.id]);
  }, 30000);

  it('a stop called for the final lap is cancelled rather than made', () => {
    const r = race(1, 2);
    const car = r.cars[0];
    // Start of the last lap.
    runUntil(r, () => r.lapsDone(car) === 1, 200);
    r.command(0, 'box');
    const events = runUntil(r, () => car.finished, 200);
    expect(car.finished).toBe(true);
    expect(car.pitStops).toBe(0);
    expect(events.some((e) => e.type === 'pit' && e.stage === 'cancelled')).toBe(true);
  }, 30000);

  it('every car on the largest grid has its own pit box', () => {
    const boxes = new Set(Array.from({ length: PIT_BOXES }, (_, i) => Math.round(brands.track.pitBox(i))));
    expect(boxes.size).toBe(PIT_BOXES);
    const sorted = [...boxes].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(10);
    for (const s of sorted) expect(brands.track.inPitZone(s)).toBe(true);
  });
});

describe('Money', () => {
  it('test mode earns nothing: selling, removing parts and prizes leave the bank alone', () => {
    const p = newProfile();
    p.admin = true;
    expect(buyCar(p, getPart('ch-porsche-992')!, 'new', 'Test car').ok).toBe(true);
    const start = p.money;
    const car = p.cars[0];
    const slot = Object.keys(car.parts).find((s) => s !== 'chassis');
    if (slot) removePart(p, car, slot as never);
    settleRace(p, 'nobody', BRANDS_HATCH_INDY, 1);
    sellCar(p, car.id);
    expect(p.money).toBe(start);
  });

  it('pressing auto build again never makes the car worse or costs money for parts it keeps', () => {
    const p = newProfile();
    expect(buyCar(p, getPart('ch-audi-r8')!, 'used', 'Auto').ok).toBe(true);
    const car = p.cars[0];
    expect(applyAutoBuild(p, car, brands, 20000).ok).toBe(true);
    const rating = deriveCar(car, brands).stats!.rating;
    const money = p.money;
    expect(applyAutoBuild(p, car, brands, 20000).ok).toBe(true);
    expect(deriveCar(car, brands).stats!.rating).toBeGreaterThanOrEqual(rating);
    expect(applyAutoBuild(p, car, brands, 20000).ok).toBe(true);
    expect(deriveCar(car, brands).stats!.rating).toBeGreaterThanOrEqual(rating);
    expect(p.money).toBeGreaterThanOrEqual(Math.min(money, 20000) - 1);
  }, 60000);
});

describe('Saved settings', () => {
  it('race rules from a damaged save or a link fall back to safe values', () => {
    const bad = sanitizePrefs({ distance: 7, wearScale: Number.NaN, hazards: -3, weather: 'fog' as never, pitMode: 'later' as never, traffic: 'yes' as never });
    expect(bad).toMatchObject({ distance: 0, wearScale: 1, hazards: 0, weather: 'clear', pitMode: 'auto', traffic: false });
    const good = sanitizePrefs({ distance: 2, wearScale: 6, hazards: 10, weather: 'snow', pitMode: 'manual', traffic: true });
    expect(good).toMatchObject({ distance: 2, wearScale: 6, hazards: 10, weather: 'snow', pitMode: 'manual', traffic: true });
    const old = upgradeProfile({ ...newProfile(), prefs: { weather: 'fog' } as never });
    expect(old.prefs.weather).toBe('clear');
  });
});
