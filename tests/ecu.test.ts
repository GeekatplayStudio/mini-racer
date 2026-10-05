import { describe, expect, it } from 'vitest';
import { LIVERIES } from '../src/data/cars';
import { RESERVED_NAMES, alias, escapeRegExp } from '../src/data/naming';
import { PARTS, SLOTS, getPart } from '../src/data/parts';
import { BRANDS_HATCH_INDY, TRACKS } from '../src/data/tracks';
import { CarBuild, chassisName, completionKit, deriveCar, generateBuild, partPrice } from '../src/game/build';
import {
  ECU_POINTS,
  EngineHardware,
  bestAdvance,
  evaluateEcu,
  knockLimit,
  rpmAtPoint,
  safeMap,
  sanitizeMap,
  sanitizeSetup,
  tunedMap,
} from '../src/game/ecu';
import { DYNO_FEE, buyCar, dynoSession, fitKit, fitPart, newProfile } from '../src/game/profile';
import { prepareTrack } from '../src/game/trackCache';
import { Rng } from '../src/sim/rng';

const NA: EngineHardware = { redline: 9000, turbo: false, revCeiling: 9000, knockBonus: 0, boostMax: 0, tcBest: 0.9, absBest: 0.9 };
const TURBO: EngineHardware = { redline: 7000, turbo: true, revCeiling: 7000, knockBonus: 0, boostMax: 1.3, tcBest: 0.9, absBest: 0.9 };
const peak = (hw: EngineHardware, map = safeMap(hw)): number => Math.max(...evaluateEcu(hw, map).factor);

describe('Engine computer model', () => {
  it('covers the rev range in eight columns up to the redline', () => {
    expect(rpmAtPoint(9000, 0)).toBe(2700);
    expect(rpmAtPoint(9000, ECU_POINTS - 1)).toBe(9000);
  });

  it('the safe map never knocks, runs rich and costs a little power', () => {
    for (const hw of [NA, TURBO]) {
      const r = evaluateEcu(hw, safeMap(hw));
      expect(r.knockOver.every((k) => k === 0)).toBe(true);
      expect(r.warnings).toEqual([]);
      expect(r.reliability).toBe(1);
      expect(Math.max(...r.factor)).toBeLessThan(1);
      expect(Math.max(...r.factor)).toBeGreaterThan(0.9);
      expect(r.fuelUse).toBeGreaterThan(1);
    }
  });

  it('advancing the ignition toward best torque adds power, past knock it loses power and engine life', () => {
    const map = safeMap(NA);
    const better = { ...map, ign: map.ign.map((_, i) => Math.min(bestAdvance(NA, i), knockLimit(NA, i, map.lambda[i], 0))) };
    expect(peak(NA, better)).toBeGreaterThan(peak(NA, map));
    const knocking = { ...map, ign: map.ign.map((_, i) => knockLimit(NA, i, map.lambda[i], 0) + 6) };
    const r = evaluateEcu(NA, knocking);
    expect(r.knockOver.every((k) => k > 5)).toBe(true);
    expect(Math.max(...r.factor)).toBeLessThan(peak(NA, better));
    expect(r.reliability).toBeLessThan(0.75);
    expect(r.warnings.join(' ')).toMatch(/knock/i);
  });

  it('best power is at lambda 0.88; lean saves fuel but overheats', () => {
    const at = (lambda: number) => evaluateEcu(NA, { ...safeMap(NA), lambda: new Array(ECU_POINTS).fill(lambda) });
    expect(Math.max(...at(0.88).factor)).toBeGreaterThan(Math.max(...at(0.8).factor));
    expect(Math.max(...at(0.88).factor)).toBeGreaterThan(Math.max(...at(1.0).factor));
    expect(at(1.0).fuelUse).toBeLessThan(at(0.88).fuelUse);
    expect(at(0.8).fuelUse).toBeGreaterThan(at(0.88).fuelUse);
    expect(at(1.0).reliability).toBeLessThan(1);
    expect(at(1.0).warnings.join(' ')).toMatch(/lean/i);
  });

  it('a richer mixture moves the knock limit out; boost pulls it in', () => {
    expect(knockLimit(TURBO, 5, 0.8, 1.0)).toBeGreaterThan(knockLimit(TURBO, 5, 0.9, 1.0));
    expect(knockLimit(TURBO, 5, 0.88, 1.3)).toBeLessThan(knockLimit(TURBO, 5, 0.88, 1.0));
    expect(knockLimit({ ...TURBO, knockBonus: 2 }, 5, 0.88, 1.0)).toBeCloseTo(knockLimit(TURBO, 5, 0.88, 1.0) + 2);
  });

  it('more boost makes more torque until the turbos run out of breath', () => {
    const at = (boost: number) => evaluateEcu(TURBO, { ...safeMap(TURBO), ign: new Array(ECU_POINTS).fill(0), boost: new Array(ECU_POINTS).fill(boost) });
    const gain = (a: number, b: number): number => at(b).factor[6] - at(a).factor[6];
    expect(gain(0.9, 1.2)).toBeGreaterThan(0.05);
    // Past the 1.3 bar the turbos hold, the same step gives far less.
    expect(gain(1.4, 1.7)).toBeLessThan(gain(0.9, 1.2) * 0.4);
    expect(at(1.7).reliability).toBeLessThan(at(1.2).reliability);
    expect(at(1.7).warnings.join(' ')).toMatch(/out of breath/i);
    // Boost does nothing on an engine without turbos.
    const na = safeMap(NA);
    expect(evaluateEcu(NA, { ...na, boost: new Array(ECU_POINTS).fill(1.5) }).factor).toEqual(evaluateEcu(NA, na).factor);
  });

  it('revving past the safe ceiling costs engine life', () => {
    const map = safeMap(NA);
    expect(evaluateEcu(NA, { ...map, revLimit: 9000 }).reliability).toBe(1);
    const over = evaluateEcu(NA, { ...map, revLimit: 9400 });
    expect(over.reliability).toBeLessThan(0.97);
    expect(over.warnings.join(' ')).toMatch(/rev limit/i);
  });

  it('aid switches trade help against grip held in reserve', () => {
    const low = evaluateEcu(NA, { ...safeMap(NA), tc: 1, abs: 1 });
    const high = evaluateEcu(NA, { ...safeMap(NA), tc: 12, abs: 12 });
    expect(high.tcAssist).toBeGreaterThan(low.tcAssist);
    expect(high.tcMargin).toBeGreaterThan(low.tcMargin);
    expect(high.absAssist).toBeGreaterThan(low.absAssist);
    expect(high.tcAssist).toBeCloseTo(0.9);
    // Even the best switch position cannot beat the hardware.
    expect(evaluateEcu({ ...NA, tcBest: 0.55 }, { ...safeMap(NA), tc: 12 }).tcAssist).toBeCloseTo(0.55);
  });

  it('a tuned map beats the safe map without knocking', () => {
    for (const hw of [NA, TURBO]) {
      const r = evaluateEcu(hw, tunedMap(hw, 1));
      expect(Math.max(...r.factor)).toBeGreaterThan(peak(hw));
      expect(r.knockOver.every((k) => k === 0)).toBe(true);
    }
  });

  it('repairs broken or out-of-range saved maps', () => {
    const bad = { ign: [99, NaN], lambda: [0.2], boost: [9], revLimit: 99999, tc: 40, abs: -3, launchRpm: 1, pitLimit: 500 } as never;
    const m = sanitizeMap(TURBO, bad);
    expect(m.ign).toHaveLength(ECU_POINTS);
    expect(m.ign[0]).toBe(45);
    expect(m.ign[1]).toBe(safeMap(TURBO).ign[1]);
    expect(m.lambda[0]).toBe(0.75);
    expect(m.boost[0]).toBe(2);
    expect(m.revLimit).toBe(7400);
    expect(m.tc).toBe(12);
    expect(m.abs).toBe(1);
    expect(m.pitLimit).toBe(100);
    expect(sanitizeMap(NA, undefined)).toEqual(safeMap(NA));
    expect(sanitizeSetup({ wing: 99, brakeBias: -99, fuel: 1, balance: 2.4 }, 80)).toEqual({ wing: 5, brakeBias: -5, fuel: 8, balance: 2 });
  });
});

describe('Engine map on the car', () => {
  const ref = prepareTrack(BRANDS_HATCH_INDY);
  const build = generateBuild(new Rng(21), 3, LIVERIES[0], 'x');

  it('a better map makes the same car faster; a knocking map hurts reliability', () => {
    const safe = deriveCar({ ...build, ecu: undefined }, ref);
    const hw = safe.hardware!;
    const tuned = deriveCar({ ...build, ecu: tunedMap(hw, 0.5) }, ref);
    expect(tuned.stats!.powerHp).toBeGreaterThan(safe.stats!.powerHp);
    expect(tuned.stats!.lapTime).toBeLessThan(safe.stats!.lapTime);
    const wild = tunedMap(hw, 0.5);
    wild.ign = wild.ign.map((v) => v + 8);
    const knocking = deriveCar({ ...build, ecu: wild }, ref);
    expect(knocking.stats!.reliability).toBeLessThan(tuned.stats!.reliability - 0.05);
    expect(knocking.notes.join(' ')).toMatch(/knock/i);
    expect(knocking.legal).toBe(true);
  });

  it('rev limit sets the redline the simulation uses; lean maps burn less fuel', () => {
    const hw = deriveCar(build, ref).hardware!;
    const low = deriveCar({ ...build, ecu: { ...safeMap(hw), revLimit: hw.redline - 500 } }, ref);
    expect(low.spec!.engine.redline).toBe(hw.redline - 500);
    expect(low.stats!.topSpeedKmh).toBeLessThan(deriveCar({ ...build, ecu: { ...safeMap(hw), revLimit: hw.redline } }, ref).stats!.topSpeedKmh);
    const lean = deriveCar({ ...build, ecu: { ...safeMap(hw), lambda: new Array(ECU_POINTS).fill(0.92) } }, ref);
    expect(lean.spec!.fuelUse).toBeLessThan(deriveCar({ ...build, ecu: undefined }, ref).spec!.fuelUse);
  });

  it('a dyno session costs money and leaves a faster, safe map', () => {
    const p = newProfile();
    p.cars.push(JSON.parse(JSON.stringify({ ...build, ecu: undefined })) as CarBuild);
    const car = p.cars[0];
    const before = deriveCar(car, ref).stats!.powerHp;
    expect(dynoSession(p, car).ok).toBe(true);
    expect(p.money).toBe(300000 - DYNO_FEE);
    const after = deriveCar(car, ref);
    expect(after.stats!.powerHp).toBeGreaterThan(before);
    expect(after.ecuResult!.knockOver.every((k) => k === 0)).toBe(true);
    p.money = 10;
    expect(dynoSession(p, car).ok).toBe(false);
  });
});

describe('Completion kit', () => {
  it('fills every empty slot with the cheapest fitting part and makes the car legal', () => {
    const p = newProfile();
    buyCar(p, getPart('ch-bmw-m4')!, 'worn', '');
    const car = p.cars[0];
    fitPart(p, car, getPart('ty-pirelli')!, 'new');
    const kit = completionKit(car, 'worn');
    expect(kit.parts.some((x) => x.slot === 'tyres')).toBe(false);
    expect(kit.parts.some((x) => x.slot === 'turbo')).toBe(true);
    expect(kit.cost).toBe(kit.parts.reduce((sum, x) => sum + partPrice(x, 'worn'), 0));
    const money = p.money;
    expect(fitKit(p, car, 'worn').ok).toBe(true);
    expect(p.money).toBe(money - kit.cost);
    expect(deriveCar(car).legal).toBe(true);
    expect(car.parts.tyres).toEqual({ part: 'ty-pirelli', cond: 'new' });
    expect(fitKit(p, car, 'worn').ok).toBe(false);
  });

  it('is refused when the player cannot pay for all of it', () => {
    const p = newProfile();
    buyCar(p, getPart('ch-bmw-m4')!, 'worn', '');
    p.money = 5000;
    expect(fitKit(p, p.cars[0], 'new').ok).toBe(false);
    expect(p.money).toBe(5000);
    expect(Object.keys(p.cars[0].parts)).toEqual(['chassis']);
  });
});

describe('Sound-alike names', () => {
  const shown = (text: string): string => alias(text);

  it('never shows a real maker, car or product name for any part', () => {
    for (const p of PARTS) {
      const label = `${shown(p.maker)} | ${shown(p.name)}`;
      for (const real of RESERVED_NAMES) expect(new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(real)}(?![A-Za-z0-9])`).test(label), `${p.id}: "${label}" contains "${real}"`).toBe(false);
    }
  });

  it('renames every maker that is a real company', () => {
    const generic = new Set(['OEM', 'None', 'Homologated Evo kit']);
    for (const p of PARTS) {
      if (generic.has(p.maker)) continue;
      expect(shown(p.maker), p.id).not.toBe(p.maker);
    }
  });

  it('names cars and circuits with their sound-alike names', () => {
    const car: CarBuild = { id: 'x', name: 'x', parts: { chassis: { part: 'ch-porsche-992', cond: 'new' } }, livery: LIVERIES[0] };
    expect(chassisName(car)).toBe('Porscha Motorsport 919 GT3 R (929)');
    for (const t of TRACKS) {
      expect(t.publicName.length).toBeGreaterThan(3);
      expect(t.publicName).not.toBe(t.name);
    }
    expect(SLOTS.length).toBeGreaterThan(0);
  });
});
