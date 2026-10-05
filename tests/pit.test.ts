import { describe, expect, it } from 'vitest';
import { GT3_CARS, LIVERIES } from '../src/data/cars';
import { SLOTS } from '../src/data/parts';
import { BRANDS_HATCH_INDY, TRACKS } from '../src/data/tracks';
import { autoBuild, deriveCar, generateBuild, partPrice, slotApplies } from '../src/game/build';
import { getPart } from '../src/data/parts';
import {
  MAX_PHOTOS,
  addPhoto,
  applyAutoBuild,
  buyCar,
  charge,
  fitPart,
  newProfile,
  payEntry,
  recordRace,
  upgradeProfile,
} from '../src/game/profile';
import { createPlayerRace } from '../src/game/raceSetup';
import { prepareTrack } from '../src/game/trackCache';
import { SKILLS, Skill, generateDriver } from '../src/sim/driver';
import { Command, EntrantDef, PitPhase, Race, RaceEvent } from '../src/sim/race';
import { Rng } from '../src/sim/rng';
import { Track } from '../src/sim/track';

const brands = prepareTrack(BRANDS_HATCH_INDY);

function field(count: number, manual: number[] = []): EntrantDef[] {
  const rng = new Rng(4);
  return Array.from({ length: count }, (_, i) => ({
    driver: generateDriver(rng, i),
    spec: GT3_CARS[i % GT3_CARS.length].spec,
    pitSaving: 12,
    pitMode: manual.includes(i) ? ('manual' as const) : ('auto' as const),
  }));
}

function run(race: Race, seconds: number, each?: (race: Race) => void): RaceEvent[] {
  const events: RaceEvent[] = [];
  const end = race.steps + seconds * 240;
  while (race.phase !== 'finished' && race.steps < end) {
    race.step();
    events.push(...race.events);
    race.events.length = 0;
    each?.(race);
  }
  return events;
}

describe('Circuits', () => {
  it.each(TRACKS.map((t) => [t.publicName, t] as const))('%s is a sound closed circuit', (_name, def) => {
    const t = new Track(def);
    expect(def.publicName).not.toBe(def.name);
    // No corner tighter than a hairpin and no two parts of the lap close enough for their barriers to meet.
    let tightest = Infinity;
    for (let i = 0; i < t.n; i++) tightest = Math.min(tightest, 1 / Math.abs(t.curvature[i]));
    expect(tightest).toBeGreaterThan(15);
    let closest = Infinity;
    for (let i = 0; i < t.n; i += 4) {
      for (let j = i + 80; j < t.n; j += 4) {
        if (t.n - j + i < 80) continue;
        closest = Math.min(closest, Math.hypot(t.x[i] - t.x[j], t.y[i] - t.y[j]));
      }
    }
    expect(closest).toBeGreaterThan(44);
    // The start straight is straight enough for a grid and a pit lane.
    for (let i = 0; i < t.n; i++) {
      const s = i * t.ds;
      if (s > t.length - 180 || s < 60) expect(1 / Math.abs(t.curvature[i])).toBeGreaterThan(120);
    }
    expect(t.inPitZone(t.pitBox(0))).toBe(true);
    expect(t.inPitZone(t.pitBox(9))).toBe(true);
  });

  it.each(TRACKS.map((t) => [t.publicName, t] as const))('%s can be raced to the flag', (_name, def) => {
    const { track, line } = prepareTrack(def);
    const race = new Race(track, field(4), 1, 7, line);
    run(race, 400);
    expect(race.phase).toBe('finished');
    expect(race.cars.every((c) => c.finished)).toBe(true);
    // Average speed in the range of a GT car on a road circuit.
    const kmh = (def.lengthM / race.fastestLap) * 3.6;
    expect(kmh).toBeGreaterThan(130);
    expect(kmh).toBeLessThan(260);
  }, 30000);

  it('finds the nearest part of the track quickly, and says when there is none', () => {
    const t = brands.track;
    const [x, y] = t.pointAt(700, 3);
    const i = t.nearest(x, y);
    expect(Math.abs(i * t.ds - 700)).toBeLessThan(3);
    expect(t.nearest(9000, 9000)).toBe(-1);
  });
});

describe('Pit stops', () => {
  it('a driver left to decide stops for tyres and fuel and rejoins', () => {
    const race = new Race(brands.track, field(3), 10, 7, brands.line, { wearScale: 12 });
    const seen = new Set<PitPhase>();
    let fastestInLane = 0;
    const events = run(race, 900, (r) => {
      const c = r.cars[0];
      seen.add(c.pitPhase);
      if (c.pitPhase !== PitPhase.None && r.track.inPitZone(c.loc.s) && Math.abs(c.loc.d) > r.track.halfWidth + 2) {
        fastestInLane = Math.max(fastestInLane, Math.hypot(c.state.vx, c.state.vy));
      }
    });
    const pits = events.filter((e) => e.type === 'pit' && e.car === 0);
    expect(pits.some((e) => e.type === 'pit' && e.stage === 'called')).toBe(true);
    const stop = pits.find((e) => e.type === 'pit' && e.stage === 'in');
    expect(stop && stop.type === 'pit' ? stop.seconds : 0).toBeGreaterThan(10);
    expect(pits.some((e) => e.type === 'pit' && e.stage === 'out')).toBe(true);
    expect([...seen].sort()).toEqual([PitPhase.None, PitPhase.Inbound, PitPhase.Stopped, PitPhase.Outbound]);
    expect(race.cars[0].pitStops).toBeGreaterThanOrEqual(1);
    // The limiter holds in the lane (60 km/h with a little overshoot on entry).
    expect(fastestInLane).toBeLessThan(21);
    expect(race.phase).toBe('finished');
    expect(race.cars.every((c) => c.finished && !c.retired)).toBe(true);
  }, 60000);

  it('service resets tyres and refuels to the starting load; quicker kit means a shorter stop', () => {
    const race = new Race(brands.track, field(1), 8, 7, brands.line, { wearScale: 12 });
    let checked = false;
    run(race, 700, (r) => {
      const c = r.cars[0];
      if (!checked && c.pitStops === 1) {
        checked = true;
        expect(c.state.tyreWear).toBeLessThan(0.02);
        expect(c.state.fuel).toBeGreaterThan(c.spec.startFuel - 0.5);
      }
    });
    expect(checked).toBe(true);
    const slow = { ...race.cars[0], pitSaving: 0 };
    const quick = { ...race.cars[0], pitSaving: 18 };
    expect(race.serviceTime(quick)).toBeLessThan(race.serviceTime(slow) - 10);
  }, 60000);

  it('with stops left to the pit wall, a car that is never called in runs dry and stops for good', () => {
    const race = new Race(brands.track, field(3, [2]), 12, 7, brands.line, { wearScale: 12 });
    const events = run(race, 1200);
    const car = race.cars[2];
    expect(car.pitStops).toBe(0);
    expect(car.retired).toBe(true);
    expect(['fuel', 'tyres']).toContain(car.retireReason);
    expect(car.finished).toBe(false);
    expect(car.parked).toBe(true);
    expect(events.some((e) => e.type === 'retire' && e.car === 2)).toBe(true);
    // The others finish, and the race does not wait for the retired car.
    expect(race.phase).toBe('finished');
    expect(race.cars[0].finished && race.cars[1].finished).toBe(true);
    expect(race.order[race.order.length - 1].id).toBe(2);
  }, 60000);

  it('a call to box from the pit wall brings the car in', () => {
    const race = new Race(brands.track, field(2, [1]), 6, 7, brands.line, { wearScale: 1 });
    run(race, 30);
    race.command(1, 'box');
    const events = run(race, 120);
    expect(events.some((e) => e.type === 'radio' && e.car === 1 && e.command === 'box')).toBe(true);
    expect(events.some((e) => e.type === 'pit' && e.car === 1 && e.stage === 'in')).toBe(true);
    expect(race.cars[1].pitStops).toBe(1);
    expect(race.cars[0].pitStops).toBe(0);
  }, 60000);

  it('wear scale speeds up tyre and fuel use', () => {
    const use = (scale: number): { wear: number; fuel: number } => {
      const race = new Race(brands.track, field(1), 3, 7, brands.line, { wearScale: scale });
      const start = race.cars[0].state.fuel;
      run(race, 70);
      return { wear: race.cars[0].state.tyreWear, fuel: start - race.cars[0].state.fuel };
    };
    const real = use(1), fast = use(4);
    expect(fast.wear).toBeGreaterThan(real.wear * 3);
    expect(fast.fuel).toBeGreaterThan(real.fuel * 3);
  });
});

describe('Pit-wall orders', () => {
  const order = (command: Command, seconds = 20): Race => {
    const race = new Race(brands.track, field(2), 6, 7, brands.line);
    run(race, 12);
    race.command(0, command);
    run(race, seconds);
    return race;
  };

  it('set the driver pace and stance after a short delay', () => {
    expect(order('push').cars[0].pace).toBe(1);
    expect(order('save').cars[0].pace).toBe(-1);
    expect(order('attack').cars[0].stance).toBe(1);
    expect(order('hold').cars[0].stance).toBe(-1);
    const race = new Race(brands.track, field(2), 6, 7, brands.line);
    run(race, 12);
    race.command(0, 'push');
    run(race, 0.3);
    expect(race.cars[0].pace).toBe(0);
  });

  it('pushing is quicker over a lap than saving, and harder on the tyres', () => {
    const lap = (command: Command): { time: number; wear: number } => {
      const race = new Race(brands.track, field(1), 3, 7, brands.line);
      race.command(0, command);
      run(race, 400);
      return { time: race.cars[0].bestLap, wear: race.cars[0].state.tyreWear };
    };
    const push = lap('push'), save = lap('save');
    expect(push.time).toBeLessThan(save.time);
    expect(push.wear).toBeGreaterThan(save.wear);
  }, 30000);

  it('are part of the replay: the same commands give the same race', () => {
    const play = (): string => {
      const race = new Race(brands.track, field(3), 2, 7, brands.line);
      run(race, 15);
      race.command(1, 'push');
      race.command(2, 'hold');
      run(race, 400);
      return race.cars.map((c) => `${c.finishTime}:${c.state.x}`).join('|');
    };
    expect(play()).toBe(play());
  }, 30000);
});

describe('Auto build', () => {
  const ref = brands;
  const shell = (id: string) => ({ id: 'a', name: 'a', parts: { chassis: { part: id, cond: 'new' as const } }, livery: LIVERIES[0] });

  it('returns a legal car within budget that beats the cheapest build', () => {
    const base = shell('ch-audi-r8');
    const result = autoBuild(base, 180000, ref);
    expect(result).not.toBeNull();
    if (!result) return;
    expect(result.cost).toBeLessThanOrEqual(180000);
    const d = deriveCar(result.build, ref);
    expect(d.legal).toBe(true);
    let cost = 0;
    for (const s of SLOTS) {
      if (s.id === 'chassis' || !slotApplies(result.build, s)) continue;
      const f = result.build.parts[s.id]!;
      cost += partPrice(getPart(f.part)!, f.cond);
    }
    expect(cost).toBe(result.cost);
    const cheap = autoBuild(base, 60000, ref);
    expect(cheap).not.toBeNull();
    expect(d.stats!.lapTime).toBeLessThan(deriveCar(cheap!.build, ref).stats!.lapTime - 1);
  }, 60000);

  it('makes a better car with more money, and refuses a budget too small for any car', () => {
    const base = shell('ch-bmw-m4');
    const small = deriveCar(autoBuild(base, 90000, ref)!.build, ref).stats!;
    const large = deriveCar(autoBuild(base, 400000, ref)!.build, ref).stats!;
    expect(large.rating).toBeGreaterThan(small.rating + 10);
    expect(autoBuild(base, 5000, ref)).toBeNull();
  }, 60000);

  it('spends the team budget, trades in the old parts and keeps a reserve', () => {
    const p = newProfile();
    buyCar(p, getPart('ch-audi-r8')!, 'used', '');
    const car = p.cars[0];
    fitPart(p, car, getPart('ty-pirelli')!, 'new');
    const before = p.money;
    expect(applyAutoBuild(p, car, ref, 20000).ok).toBe(true);
    expect(p.money).toBeGreaterThanOrEqual(20000 - 1);
    expect(p.money).toBeLessThan(before);
    expect(deriveCar(car, ref).legal).toBe(true);
    expect(car.parts.chassis).toEqual({ part: 'ch-audi-r8', cond: 'used' });
  }, 60000);
});

describe('Test mode, history and photos', () => {
  it('in test mode nothing costs money', () => {
    const p = newProfile();
    p.admin = true;
    p.money = 0;
    expect(charge(p, 1e9)).toBe(true);
    expect(buyCar(p, getPart('ch-ferrari-296')!, 'new', '').ok).toBe(true);
    expect(fitPart(p, p.cars[0], getPart('en-ferrari-f163')!, 'new').ok).toBe(true);
    expect(payEntry(p, BRANDS_HATCH_INDY)).toEqual({ paid: 0, wildcard: false });
    expect(p.money).toBe(0);
    expect(applyAutoBuild(p, p.cars[0], brands, 0).ok).toBe(true);
    expect(deriveCar(p.cars[0], brands).stats!.rating).toBeGreaterThan(85);
  }, 60000);

  it('outside test mode a purchase needs the money', () => {
    const p = newProfile();
    p.money = 100;
    expect(charge(p, 101)).toBe(false);
    expect(p.money).toBe(100);
    expect(charge(p, 40)).toBe(true);
    expect(p.money).toBe(60);
  });

  it('keeps the newest photos and a capped history, and repairs old saves', () => {
    const p = newProfile();
    for (let i = 0; i < MAX_PHOTOS + 4; i++) addPhoto(p, 'team', `data:${i}`, `shot ${i}`);
    expect(p.photos).toHaveLength(MAX_PHOTOS);
    expect(p.photos[0].caption).toBe(`shot ${MAX_PHOTOS + 3}`);
    recordRace(p, { date: 1, trackId: 'x', practice: false, position: 2, grid: 5, entries: 10, laps: 6, lapsDone: 6, bestLap: 44, raceTime: 270, pitStops: 0, fee: 5500, prize: 15100, car: 'c', driver: 'd', driverId: 'i', retired: '' });
    expect(p.history[0].position).toBe(2);
    const old = JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
    delete old.history;
    delete old.photos;
    delete old.prefs;
    delete old.admin;
    const fixed = upgradeProfile(old as never);
    expect(fixed.history).toEqual([]);
    expect(fixed.photos).toEqual([]);
    expect(fixed.admin).toBe(false);
    expect(fixed.prefs.trackId).toBe('brands-hatch-indy');
  });
});

describe('Race options', () => {
  const skills = {} as Record<Skill, number>;
  SKILLS.forEach((s, i) => (skills[s] = i < 4 ? 9 : 8));
  const driver = { id: 'p', name: 'Pat Player', code: 'PLA', nationality: 'GBR', skills, aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0 };
  const car = generateBuild(new Rng(3), 3, LIVERIES[0], 'mine');

  it('practice can be alone or with traffic, and never counts', () => {
    const alone = createPlayerRace({ trackDef: TRACKS[1], car, driver, gridSize: 6, laps: 2, seed: 1, practice: true });
    const busy = createPlayerRace({ trackDef: TRACKS[1], car, driver, gridSize: 6, laps: 2, seed: 1, practice: true, traffic: true });
    expect(alone!.entries).toHaveLength(1);
    expect(busy!.entries).toHaveLength(6);
    expect(busy!.counts).toBe(false);
    expect(busy!.trackDef.id).toBe(TRACKS[1].id);
  });

  it('gives the player the chosen pit mode and opponents their own judgement', () => {
    const s = createPlayerRace({ trackDef: BRANDS_HATCH_INDY, car, driver, gridSize: 5, laps: 2, seed: 1, practice: false, pitMode: 'manual', wearScale: 6 })!;
    expect(s.race.wearScale).toBe(6);
    s.race.cars.forEach((c, i) => expect(c.pitMode).toBe(i === s.playerCar ? 'manual' : 'auto'));
    expect(s.playerGrid).toBe(s.playerCar + 1);
    expect(s.race.cars[s.playerCar].pitSaving).toBe(deriveCar(car, brands).stats!.pitSaving);
  });
});
