import { describe, expect, it } from 'vitest';
import { GT3_CARS } from '../src/data/cars';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { prepareTrack } from '../src/game/trackCache';
import { generateDriver } from '../src/sim/driver';
import { HazardKind, Race, RaceEvent } from '../src/sim/race';
import { Rng } from '../src/sim/rng';

const brands = prepareTrack(BRANDS_HATCH_INDY);

function race(hazards: number, cars = 4, laps = 5): Race {
  const rng = new Rng(4);
  const entrants = Array.from({ length: cars }, (_, i) => ({ driver: generateDriver(rng, i), spec: GT3_CARS[i].spec }));
  return new Race(brands.track, entrants, laps, 11, brands.line, { hazards });
}

function run(r: Race, seconds: number, each?: () => void): RaceEvent[] {
  const events: RaceEvent[] = [];
  const end = r.steps + seconds * 240;
  while (r.phase !== 'finished' && r.steps < end) {
    r.step();
    events.push(...r.events);
    r.events.length = 0;
    each?.();
  }
  return events;
}

describe('Road hazards', () => {
  it('never appear when switched off', () => {
    const r = race(0);
    const events = run(r, 120);
    expect(r.hazards).toHaveLength(0);
    expect(events.some((e) => e.type === 'hazard')).toBe(false);
  });

  it('appear at random up to the chosen number, on the track and away from the pits', () => {
    const r = race(6);
    const kinds = new Set<HazardKind>();
    let most = 0;
    const events = run(r, 260, () => {
      most = Math.max(most, r.hazards.length);
      for (const h of r.hazards) {
        kinds.add(h.kind);
        expect(Math.abs(h.d)).toBeLessThan(brands.track.halfWidth + 3.5);
        expect(brands.track.inPitZone(h.s)).toBe(false);
      }
    });
    expect(most).toBeGreaterThanOrEqual(2);
    expect(most).toBeLessThanOrEqual(6);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
    expect(events.filter((e) => e.type === 'hazard' && e.stage === 'appeared').length).toBeGreaterThanOrEqual(3);
  }, 30000);

  it('are cleared by the marshals after a while', () => {
    const r = race(3);
    const events = run(r, 260);
    expect(events.some((e) => e.type === 'hazard' && (e.stage === 'cleared' || e.stage === 'hit'))).toBe(true);
  }, 30000);

  it('do not stop the race: cars get round them and finish', () => {
    const r = race(18, 6, 4);
    const events = run(r, 600);
    expect(r.phase).toBe('finished');
    expect(r.cars.filter((c) => c.finished).length).toBeGreaterThanOrEqual(5);
    // With this many hazards, drivers avoid far more than they hit.
    const appeared = events.filter((e) => e.type === 'hazard' && e.stage === 'appeared').length;
    const hits = events.filter((e) => e.type === 'hazard' && e.stage === 'hit').length;
    expect(appeared).toBeGreaterThan(8);
    expect(hits).toBeLessThan(appeared * 6);
  }, 60000);

  it('oil takes grip away from a car driving through it', () => {
    const r = race(1, 1, 3);
    run(r, 20);
    const car = r.cars[0];
    // Put a pool of oil under the car.
    r.hazards.push({
      id: 999, kind: 'oil', s: car.loc.s, d: car.loc.d, x: car.state.x, y: car.state.y, radius: 4, solid: false, life: 5, drift: 0, tint: 0,
      view: { spec: car.spec, state: { ...car.state }, loc: { ...car.loc }, obstacle: true, soft: true },
    });
    let slid = 0;
    for (let i = 0; i < 120; i++) {
      // Keep the pool under the car while it corners.
      r.hazards[r.hazards.length - 1].x = car.state.x;
      r.hazards[r.hazards.length - 1].y = car.state.y;
      r.step();
      slid = Math.max(slid, car.state.slideFront + car.state.slideRear, Math.abs(car.state.vy));
    }
    expect(slid).toBeGreaterThan(0.3);
  });

  it('are part of the replay: the same seed gives the same hazards', () => {
    const play = (): string => {
      const r = race(8, 3, 2);
      const events = run(r, 400);
      return events.filter((e) => e.type === 'hazard').map((e) => (e.type === 'hazard' ? `${e.kind}${e.stage}${e.car}` : '')).join(',') + r.cars.map((c) => c.finishTime).join('|');
    };
    expect(play()).toBe(play());
  }, 60000);
});
