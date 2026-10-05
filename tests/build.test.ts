import { describe, expect, it } from 'vitest';
import { LIVERIES } from '../src/data/cars';
import { PARTS, Part, SLOTS, getPart, partsForSlot } from '../src/data/parts';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import {
  CONDITIONS,
  CarBuild,
  Condition,
  RESALE,
  buildResale,
  deriveCar,
  generateBuild,
  incompatibility,
  orphanedBy,
  partPrice,
  resaleValue,
  slotApplies,
  swapCost,
} from '../src/game/build';
import { createPlayerRace } from '../src/game/raceSetup';
import { prepareTrack } from '../src/game/trackCache';
import { SKILLS, Skill } from '../src/sim/driver';
import { Rng } from '../src/sim/rng';

const ref = prepareTrack(BRANDS_HATCH_INDY);
const part = (id: string): Part => {
  const p = getPart(id);
  if (!p) throw new Error(`missing part ${id}`);
  return p;
};

/** A complete build on one chassis, choosing each slot by a rule. */
function complete(chassisId: string, choose: (options: Part[]) => Part, cond: Condition = 'new'): CarBuild {
  const b: CarBuild = { id: 't', name: 't', parts: { chassis: { part: chassisId, cond } }, livery: { ...LIVERIES[0] } };
  // Engine first: it decides whether the forced-induction slots exist.
  const order = [...SLOTS].sort((x, y) => Number(y.id === 'engine') - Number(x.id === 'engine'));
  for (const s of order) {
    if (s.id === 'chassis' || !slotApplies(b, s)) continue;
    const options = PARTS.filter((p) => p.slot === s.id && !incompatibility(b, p));
    b.parts[s.id] = { part: choose(options).id, cond };
  }
  return b;
}
const applicable = (b: CarBuild) => SLOTS.filter((s) => slotApplies(b, s));
const cheapest = (o: Part[]): Part => [...o].sort((a, b) => a.price - b.price)[0];
const best = (o: Part[]): Part => [...o].sort((a, b) => b.tier - a.tier || b.price - a.price)[0];
const withPart = (b: CarBuild, id: string, cond: Condition = 'new'): CarBuild => {
  const p = part(id);
  return { ...b, parts: { ...b.parts, [p.slot]: { part: id, cond } } };
};
const stats = (b: CarBuild) => {
  const d = deriveCar(b, ref);
  if (!d.stats || !d.spec) throw new Error('build has no stats');
  return { ...d.stats, spec: d.spec };
};

describe('Parts catalog', () => {
  it('holds at least 300 parts in at least 60 slots, with unique ids', () => {
    expect(PARTS.length).toBeGreaterThanOrEqual(300);
    expect(SLOTS.length).toBeGreaterThanOrEqual(60);
    expect(new Set(SLOTS.map((s) => s.id)).size).toBe(SLOTS.length);
    for (const p of PARTS) expect(SLOTS.some((s) => s.id === p.slot), p.id).toBe(true);
    expect(new Set(PARTS.map((p) => p.id)).size).toBe(PARTS.length);
  });

  it('offers a choice in every slot', () => {
    for (const s of SLOTS) expect(partsForSlot(s.id).length, s.id).toBeGreaterThanOrEqual(3);
  });

  it('gives every part a maker, a sane price, mass, tier and reliability', () => {
    for (const p of PARTS) {
      expect(p.name.length, p.id).toBeGreaterThan(2);
      expect(p.maker.length, p.id).toBeGreaterThan(1);
      expect(p.price, p.id).toBeGreaterThanOrEqual(0);
      expect(p.price, p.id).toBeLessThan(200000);
      expect(p.mass, p.id).toBeGreaterThanOrEqual(0);
      expect(p.tier, p.id).toBeGreaterThanOrEqual(1);
      expect(p.tier, p.id).toBeLessThanOrEqual(4);
      expect(p.rel, p.id).toBeGreaterThan(0.9);
      expect(p.rel, p.id).toBeLessThanOrEqual(1);
    }
  });

  it('has an engine and a gearbox for every chassis', () => {
    for (const ch of partsForSlot('chassis')) {
      const b: CarBuild = { id: 't', name: 't', parts: { chassis: { part: ch.id, cond: 'new' } }, livery: LIVERIES[0] };
      expect(partsForSlot('engine').filter((p) => !incompatibility(b, p)).length, ch.id).toBeGreaterThanOrEqual(2);
      expect(partsForSlot('gearbox').filter((p) => !incompatibility(b, p)).length, ch.id).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('Pricing', () => {
  const brembo = part('bc-brembo');
  it('prices condition below new', () => {
    expect(partPrice(brembo, 'new')).toBe(brembo.price);
    expect(partPrice(brembo, 'used')).toBeLessThan(partPrice(brembo, 'new'));
    expect(partPrice(brembo, 'worn')).toBeLessThan(partPrice(brembo, 'used'));
  });

  it('pays back less than the purchase price, so swapping is never free money', () => {
    for (const cond of ['new', 'used', 'worn'] as const) {
      const value = resaleValue({ part: brembo.id, cond });
      expect(value).toBeLessThan(partPrice(brembo, cond));
      expect(value).toBeCloseTo(partPrice(brembo, cond) * RESALE, -1);
    }
    expect(resaleValue(undefined)).toBe(0);
  });

  it('nets the trade-in against the new part', () => {
    const b = complete('ch-porsche-992', cheapest);
    const old = b.parts.calipers;
    expect(swapCost(b, brembo, 'new')).toBe(brembo.price - resaleValue(old));
    // Buying the part already fitted still costs the resale loss.
    expect(swapCost(withPart(b, 'bc-brembo'), brembo, 'new')).toBeGreaterThan(0);
  });

  it('values a car at the sum of its parts and resells it for less', () => {
    const b = complete('ch-audi-r8', best);
    const d = deriveCar(b, ref);
    let sum = 0;
    for (const s of applicable(b)) sum += partPrice(part(b.parts[s.id]!.part), 'new');
    expect(d.value).toBe(sum);
    expect(buildResale(b)).toBeLessThan(d.value);
    expect(buildResale(b)).toBeGreaterThan(d.value * 0.5);
  });
});

describe('Compatibility and legality', () => {
  it('rejects an engine from another maker and a gearbox for the wrong layout', () => {
    const b = complete('ch-porsche-992', cheapest);
    expect(incompatibility(b, part('en-bmw-p58'))).toMatch(/engine bay/i);
    expect(incompatibility(b, part('en-porsche-42'))).toBeNull();
    expect(incompatibility(b, part('gb-samsonas'))).toMatch(/rear-engined/i);
    expect(incompatibility(complete('ch-bmw-m4', cheapest), part('gb-samsonas'))).toBeNull();
  });

  it('needs a chassis before anything else', () => {
    const empty: CarBuild = { id: 't', name: 't', parts: {}, livery: LIVERIES[0] };
    expect(incompatibility(empty, part('ty-pirelli'))).toMatch(/chassis/i);
    expect(incompatibility(empty, part('ch-bmw-m4'))).toBeNull();
  });

  it('is legal only when every slot is filled', () => {
    const b = complete('ch-ferrari-296', cheapest);
    expect(deriveCar(b, ref).legal).toBe(true);
    const rest = { ...b.parts };
    delete rest.wing;
    const d = deriveCar({ ...b, parts: rest }, ref);
    expect(d.legal).toBe(false);
    expect(d.missing).toEqual(['wing']);
    expect(d.spec).not.toBeNull();
  });

  it('has no performance figures until engine, gearbox and tyres are fitted', () => {
    const b: CarBuild = { id: 't', name: 't', parts: { chassis: { part: 'ch-bmw-m4', cond: 'new' } }, livery: LIVERIES[0] };
    const d = deriveCar(b, ref);
    expect(d.spec).toBeNull();
    expect(d.stats).toBeNull();
    expect(d.massKg).toBe(part('ch-bmw-m4').mass);
    // No engine yet, so the turbo and intercooler slots do not exist.
    expect(d.missing.length).toBe(SLOTS.filter((s) => !s.turboOnly).length - 1);
  });

  it('flags the parts a chassis change would orphan', () => {
    const b = complete('ch-porsche-992', cheapest);
    expect(orphanedBy(b, part('ch-bmw-m4'))).toContain('engine');
    expect(orphanedBy(b, part('ch-porsche-992'))).toEqual([]);
  });
});

describe('Parts change the car the way they should', () => {
  const base = complete('ch-porsche-992', cheapest);
  const s0 = stats(base);

  it('sums part masses into the car mass', () => {
    let sum = 0;
    for (const s of applicable(base)) sum += part(base.parts[s.id]!.part).mass;
    expect(s0.massKg).toBeCloseTo(sum, 6);
    expect(s0.spec.mass).toBeCloseTo(sum, 6);
  });

  it('a bigger engine adds power, top-end pull and lap time', () => {
    // The standard fuel system cannot feed the bigger engine, so it goes in too.
    const fed = withPart(withPart(base, 'ij-id1700'), 'fp-radium');
    const s = stats(withPart(fed, 'en-porsche-42'));
    expect(s.powerHp).toBeGreaterThan(stats(fed).powerHp + 40);
    expect(s.accel).toBeLessThan(s0.accel);
    expect(s.lapTime).toBeLessThan(s0.lapTime);
  });

  it('intake, exhaust and ECU each add power', () => {
    for (const id of ['in-bmc', 'ex-inconel', 'ecu-bosch74']) {
      expect(stats(withPart(base, id)).powerHp, id).toBeGreaterThan(s0.powerHp);
    }
  });

  it('a bigger wing adds downforce and drag, and cornering grip', () => {
    const s = stats(withPart(base, 'wg-apr-gt1000'));
    expect(s.downforceKg).toBeGreaterThan(s0.downforceKg + 50);
    expect(s.dragCdA).toBeGreaterThan(s0.dragCdA);
    expect(s.gripG).toBeGreaterThan(s0.gripG);
    expect(s.spec.clA).toBeGreaterThan(s0.spec.clA);
  });

  it('a splitter moves the aero balance forward, within the stability limit', () => {
    const s = stats(withPart(base, 'spl-evo'));
    expect(s.aeroFront).toBeGreaterThan(s0.aeroFront);
    expect(s.spec.aeroBalance).toBeLessThan(s.spec.frontWeight);
  });

  it('softer tyres grip more and wear faster', () => {
    const soft = stats(withPart(base, 'ty-michelin-s7'));
    const hard = stats(withPart(base, 'ty-michelin-s9'));
    expect(soft.gripG).toBeGreaterThan(hard.gripG);
    expect(soft.lapTime).toBeLessThan(hard.lapTime);
    expect(soft.spec.tyre.wearRate).toBeGreaterThan(hard.spec.tyre.wearRate);
  });

  it('better brakes shorten the stopping distance', () => {
    let b = withPart(base, 'bc-brembo');
    b = withPart(b, 'bp-pagid-rst');
    b = withPart(b, 'bd-brembo');
    expect(stats(b).braking).toBeLessThan(s0.braking);
  });

  it('better dampers add grip and save the tyres', () => {
    const s = stats(withPart(base, 'dm-multimatic'));
    expect(s.gripG).toBeGreaterThan(s0.gripG);
    expect(s.spec.tyre.wearRate).toBeLessThan(s0.spec.tyre.wearRate);
  });

  it('gearbox and shift system set the shift time', () => {
    const quick = stats(withPart(withPart(base, 'gb-xtrac'), 'sh-megaline'));
    const slow = stats(withPart(withPart(base, 'gb-sadev'), 'sh-lever'));
    expect(quick.shiftMs).toBeLessThan(slow.shiftMs * 0.5);
    expect(quick.spec.drivelineEfficiency).toBeGreaterThan(slow.spec.drivelineEfficiency);
  });

  it('better ECU and ABS hardware give better driver aids, with a floor for a skilled foot', () => {
    expect(stats(withPart(base, 'ecu-bosch74')).spec.tractionControl).toBeGreaterThan(stats(withPart(base, 'ecu-ecumaster')).spec.tractionControl);
    const none = stats(withPart(base, 'abs-none'));
    const m5 = stats(withPart(base, 'abs-m5'));
    expect(none.spec.abs).toBeCloseTo(0.4);
    expect(m5.spec.abs).toBeGreaterThan(none.spec.abs);
    expect(none.braking).toBeGreaterThan(m5.braking);
  });

  it('engine internals raise the safe rev ceiling', () => {
    const d0 = deriveCar(base, ref);
    const d1 = deriveCar(withPart(withPart(base, 'ro-pankl'), 'vt-works'), ref);
    expect(d1.hardware!.revCeiling).toBeGreaterThan(d0.hardware!.revCeiling + 500);
  });

  it('a small fuel system caps the power of a strong engine', () => {
    const strong = withPart(complete('ch-porsche-992', best), 'ij-stock');
    const d = deriveCar(strong, ref);
    expect(d.stats!.powerHp).toBeLessThan(330 * 1.341 + 5);
    expect(d.notes.join(' ')).toMatch(/fuel system limits power/i);
    expect(deriveCar(complete('ch-porsche-992', best), ref).stats!.powerHp).toBeGreaterThan(d.stats!.powerHp + 40);
  });

  it('a shorter final drive trades top speed for acceleration', () => {
    const short = stats(withPart(base, 'fd-xshort'));
    const long = stats(withPart(base, 'fd-xlong'));
    expect(long.topSpeedKmh).toBeGreaterThan(short.topSpeedKmh + 15);
    expect(short.spec.finalDrive).toBeGreaterThan(long.spec.finalDrive);
  });

  it('turbo parts exist only on turbocharged engines', () => {
    const na = complete('ch-porsche-992', cheapest);
    const turbo = complete('ch-bmw-m4', cheapest);
    expect(na.parts.turbo).toBeUndefined();
    expect(turbo.parts.turbo).toBeDefined();
    expect(incompatibility(na, part('tu-g25'))).toMatch(/turbocharged/i);
    expect(incompatibility(turbo, part('tu-g25'))).toBeNull();
    expect(deriveCar(na, ref).legal).toBe(true);
    // Swapping in a naturally aspirated engine orphans the turbo hardware.
    const amg = complete('ch-amg-gt3', (o) => o.find((p) => p.id === 'en-amg-m178') ?? cheapest(o));
    expect(amg.parts.turbo).toBeDefined();
    expect(orphanedBy(amg, part('en-amg-m159')).sort()).toEqual(['intercooler', 'turbo']);
  });

  it('set-up changes the car: wing angle, brake balance, fuel load', () => {
    const d = deriveCar(base, ref);
    const fuelCap = d.spec!.fuelCapacity;
    const steep = stats({ ...base, setup: { wing: 5, brakeBias: 0, fuel: 30, balance: 0 } });
    const flat = stats({ ...base, setup: { wing: -5, brakeBias: 0, fuel: 30, balance: 0 } });
    expect(steep.downforceKg).toBeGreaterThan(flat.downforceKg);
    expect(steep.topSpeedKmh).toBeLessThanOrEqual(flat.topSpeedKmh);
    expect(stats({ ...base, setup: { wing: 0, brakeBias: 4, fuel: 30, balance: 0 } }).spec.brakeBias).toBeGreaterThan(d.spec!.brakeBias);
    const heavy = stats({ ...base, setup: { wing: 0, brakeBias: 0, fuel: fuelCap, balance: 0 } });
    const light = stats({ ...base, setup: { wing: 0, brakeBias: 0, fuel: 10, balance: 0 } });
    expect(heavy.lapTime).toBeGreaterThan(light.lapTime);
    expect(heavy.fuelLaps).toBeGreaterThan(light.fuelLaps);
    expect(stats({ ...base, setup: { wing: 0, brakeBias: 0, fuel: 9999, balance: 0 } }).spec.startFuel).toBe(fuelCap);
  });

  it('gives an overall rating that rises with the build', () => {
    const low = stats(complete('ch-audi-r8', cheapest, 'worn'));
    const high = stats(complete('ch-audi-r8', best));
    expect(low.rating).toBeGreaterThanOrEqual(0);
    expect(high.rating).toBeLessThanOrEqual(100);
    expect(high.rating).toBeGreaterThan(low.rating + 40);
    expect(high.fuelPerLap).toBeGreaterThan(0.3);
    expect(high.tyreLaps).toBeGreaterThan(20);
  });

  it('fuel cell sets capacity; seat and wheel add comfort; lighter parts cut mass', () => {
    expect(stats(withPart(base, 'fc-atl-ft35')).fuelKg).toBe(90);
    expect(stats(withPart(base, 'se-recaro')).comfort).toBeGreaterThan(s0.comfort);
    expect(stats(withPart(base, 'wh-bbs')).massKg).toBeLessThan(s0.massKg);
  });

  it('worn parts cost performance and reliability', () => {
    const fresh = stats(complete('ch-amg-gt3', best, 'new'));
    const worn = stats(complete('ch-amg-gt3', best, 'worn'));
    expect(worn.powerHp).toBeLessThan(fresh.powerHp);
    expect(worn.gripG).toBeLessThan(fresh.gripG);
    expect(worn.reliability).toBeLessThan(fresh.reliability);
    expect(worn.lapTime).toBeGreaterThan(fresh.lapTime);
    expect(worn.spec.startTyreWear).toBe(CONDITIONS.worn.tyreWear);
  });

  it('the best build is clearly quicker than the cheapest, both at believable GT pace', () => {
    for (const ch of partsForSlot('chassis')) {
      const slow = stats(complete(ch.id, cheapest));
      const fast = stats(complete(ch.id, best));
      expect(fast.lapTime, ch.id).toBeLessThan(slow.lapTime - 2);
      expect(fast.lapTime, ch.id).toBeGreaterThan(39.5);
      expect(slow.lapTime, ch.id).toBeLessThan(50);
      expect(fast.massKg, ch.id).toBeGreaterThan(1180);
      expect(slow.massKg, ch.id).toBeLessThan(1400);
      expect(fast.powerHp, ch.id).toBeLessThan(640);
      expect(slow.powerHp, ch.id).toBeGreaterThan(350);
      expect(fast.topSpeedKmh, ch.id).toBeGreaterThan(240);
    }
  });
});

describe('Generated opponents', () => {
  it('are always complete and legal', () => {
    const rng = new Rng(3);
    for (let i = 0; i < 40; i++) {
      const d = deriveCar(generateBuild(rng, 1 + (i % 4), LIVERIES[i % LIVERIES.length], `ai-${i}`), ref);
      expect(d.legal, `build ${i}: ${d.issues.join(';')} ${d.missing.join(',')}`).toBe(true);
    }
  });

  it('get quicker and dearer with level', () => {
    const avg = (level: number): { lap: number; value: number } => {
      const rng = new Rng(11);
      let lap = 0, value = 0;
      for (let i = 0; i < 30; i++) {
        const d = deriveCar(generateBuild(rng, level, LIVERIES[0], 'x'), ref);
        lap += d.stats!.lapTime;
        value += d.value;
      }
      return { lap: lap / 30, value: value / 30 };
    };
    const low = avg(1.2), high = avg(3.8);
    expect(high.lap).toBeLessThan(low.lap - 1);
    expect(high.value).toBeGreaterThan(low.value);
  });

  it('are the same for the same seed', () => {
    expect(generateBuild(new Rng(5), 2.5, LIVERIES[1], 'a')).toEqual(generateBuild(new Rng(5), 2.5, LIVERIES[1], 'a'));
  });
});

describe('Player race', () => {
  const skills = {} as Record<Skill, number>;
  SKILLS.forEach((s, i) => (skills[s] = i < 4 ? 9 : 8));
  const driver = { id: 'p', name: 'Pat Player', code: 'PLA', nationality: 'GBR', skills, aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0 };
  const car = complete('ch-mclaren-720s', best);

  it('runs a full race between the player build and catalog-built opponents', () => {
    const s = createPlayerRace({ trackDef: BRANDS_HATCH_INDY, car, driver, gridSize: 8, laps: 2, seed: 99, practice: false });
    expect(s).not.toBeNull();
    if (!s) return;
    expect(s.entries).toHaveLength(8);
    expect(s.entries.filter((e) => e.isPlayer)).toHaveLength(1);
    expect(s.entries[s.playerCar].driver.id).toBe('p');
    expect(new Set(s.entries.map((e) => e.driver.code)).size).toBe(8);
    while (s.race.phase !== 'finished' && s.race.steps < 240 * 300) s.race.step();
    expect(s.race.phase).toBe('finished');
    expect(s.race.cars.every((c) => c.finished)).toBe(true);
    expect(s.race.fastestLap).toBeGreaterThan(39);
    expect(s.race.fastestLap).toBeLessThan(49);
    expect(s.counts).toBe(true);
  });

  it('puts the best car near the front of the grid and the worst near the back', () => {
    const front = createPlayerRace({ trackDef: BRANDS_HATCH_INDY, car, driver, gridSize: 10, laps: 1, seed: 4, practice: false });
    const back = createPlayerRace({ trackDef: BRANDS_HATCH_INDY, car: complete('ch-mclaren-720s', cheapest, 'worn'), driver, gridSize: 10, laps: 1, seed: 4, practice: false });
    expect(front!.playerCar).toBeLessThanOrEqual(2);
    expect(back!.playerCar).toBeGreaterThanOrEqual(7);
  });

  it('practice puts the player alone on track and does not count', () => {
    const s = createPlayerRace({ trackDef: BRANDS_HATCH_INDY, car, driver, gridSize: 10, laps: 3, seed: 1, practice: true });
    expect(s!.entries).toHaveLength(1);
    expect(s!.counts).toBe(false);
  });

  it('refuses a car that cannot run', () => {
    const shellOnly: CarBuild = { id: 't', name: 't', parts: { chassis: { part: 'ch-bmw-m4', cond: 'new' } }, livery: LIVERIES[0] };
    expect(createPlayerRace({ trackDef: BRANDS_HATCH_INDY, car: shellOnly, driver, gridSize: 4, laps: 1, seed: 1, practice: false })).toBeNull();
  });
});
