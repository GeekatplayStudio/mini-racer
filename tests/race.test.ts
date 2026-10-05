import { describe, expect, it } from 'vitest';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { RaceSession, createQuickRace } from '../src/game/raceSetup';
import { SKILLS, Skill } from '../src/sim/driver';
import { Race, RaceEvent } from '../src/sim/race';
import { GT3_CARS } from '../src/data/cars';
import { Track } from '../src/sim/track';

function quick(seed: number, gridSize = 6, laps = 2): RaceSession {
  return createQuickRace({ trackDef: BRANDS_HATCH_INDY, gridSize, laps, seed, playerGrid: 0 });
}

function run(race: Race, maxSeconds = 400): RaceEvent[] {
  const events: RaceEvent[] = [];
  const limit = maxSeconds * 240;
  while (race.phase !== 'finished' && race.steps < limit) {
    race.step();
    events.push(...race.events);
    race.events.length = 0;
  }
  return events;
}

function fingerprint(race: Race): string {
  return race.cars
    .map((c) => [c.state.x, c.state.y, c.state.heading, c.state.vx, c.finishTime, c.bestLap, c.state.tyreWear].join(','))
    .join('|');
}

describe('Race integration', () => {
  const session = quick(31, 8, 3);
  const events = run(session.race);
  const { race } = session;

  it('runs the start procedure: five lights, then green', () => {
    const lights = events.filter((e) => e.type === 'lights').map((e) => (e.type === 'lights' ? e.count : 0));
    expect(lights).toEqual([1, 2, 3, 4, 5]);
    const firstGreen = events.findIndex((e) => e.type === 'green');
    const lastLight = events.map((e) => e.type).lastIndexOf('lights');
    expect(firstGreen).toBeGreaterThan(lastLight);
  });

  it('finishes with every car classified', () => {
    expect(race.phase).toBe('finished');
    expect(race.cars.every((c) => c.finished)).toBe(true);
    expect(race.order.map((c) => c.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(race.order.map((c) => c.id)).size).toBe(8);
  });

  it('classifies cars in finishing-time order and the winner completes the full distance', () => {
    for (let i = 1; i < race.order.length; i++) {
      expect(race.order[i].finishTime).toBeGreaterThanOrEqual(race.order[i - 1].finishTime);
    }
    expect(race.lapsDone(race.order[0])).toBe(3);
  });

  it('laps at real GT3 pace', () => {
    expect(race.fastestLap).toBeGreaterThan(41);
    expect(race.fastestLap).toBeLessThan(47);
    expect(race.cars[race.fastestLapCar].bestLap).toBe(race.fastestLap);
  });

  it('keeps every car inside the barriers', () => {
    for (const c of race.cars) {
      const side = c.loc.d >= 0 ? 1 : 0;
      expect(Math.abs(c.loc.d)).toBeLessThanOrEqual(race.track.wall[side][c.loc.index]);
    }
  });

  it('uses fuel and tyres over the race', () => {
    for (const c of race.cars) {
      expect(c.state.fuel).toBeLessThan(c.spec.fuelCapacity * 0.35);
      expect(c.state.tyreWear).toBeGreaterThan(0.01);
      expect(c.state.tyreWear).toBeLessThan(0.5);
    }
  });

  it('keeps the player car on the grid when asked for a slot beyond it', () => {
    const small = createQuickRace({ trackDef: BRANDS_HATCH_INDY, gridSize: 4, laps: 1, seed: 1, playerGrid: 9 });
    expect(small.playerCar).toBe(3);
    expect(small.entries.filter((e) => e.isPlayer)).toHaveLength(1);
    expect(small.race.cars[small.playerCar]).toBeDefined();
  });

  it('gives unique timing codes to the grid', () => {
    expect(new Set(session.entries.map((e) => e.driver.code)).size).toBe(8);
  });
});

describe('Determinism', () => {
  it('replays identically from the same seed', () => {
    const a = quick(77);
    const b = quick(77);
    run(a.race);
    run(b.race);
    expect(a.race.steps).toBe(b.race.steps);
    expect(fingerprint(a.race)).toBe(fingerprint(b.race));
  });

  it('differs for a different seed', () => {
    const a = quick(77);
    const b = quick(78);
    run(a.race);
    run(b.race);
    expect(fingerprint(a.race)).not.toBe(fingerprint(b.race));
  });
});

describe('Driver skill decides pace', () => {
  const soloLap = (level: number): number => {
    const skills = {} as Record<Skill, number>;
    for (const s of SKILLS) skills[s] = level;
    const race = new Race(
      new Track(BRANDS_HATCH_INDY),
      [{ spec: GT3_CARS[3].spec, driver: { id: 'd', name: 'D', code: 'DDD', nationality: 'GBR', skills, aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0 } }],
      2,
      5,
    );
    run(race);
    return race.cars[0].bestLap;
  };

  it('a strong driver laps faster than a weak one in the same car', () => {
    const strong = soloLap(16);
    const weak = soloLap(2);
    expect(Number.isFinite(strong)).toBe(true);
    expect(Number.isFinite(weak)).toBe(true);
    expect(strong).toBeLessThan(weak - 0.5);
  });
});
