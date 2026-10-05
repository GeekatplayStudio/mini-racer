import { describe, expect, it } from 'vitest';
import {
  DriverDef,
  SKILLS,
  SKILL_CAP_AT_CREATION,
  STARTING_POINTS,
  Skill,
  deriveProfile,
  generateDriver,
  pointsAllowed,
  pointsSpent,
} from '../src/sim/driver';
import { Rng } from '../src/sim/rng';

function driver(overrides: Partial<Record<Skill, number>> = {}, extra: Partial<DriverDef> = {}): DriverDef {
  const skills = {} as Record<Skill, number>;
  for (const s of SKILLS) skills[s] = overrides[s] ?? 8;
  return {
    id: 't', name: 'Test Driver', code: 'TST', nationality: 'GBR', skills,
    aggression: 0.5, risk: 0.5, weight: 72, racesCompleted: 0, ...extra,
  };
}

describe('Rng', () => {
  it('repeats exactly for the same seed and differs for another', () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const seqA = Array.from({ length: 20 }, () => a.next());
    const seqB = Array.from({ length: 20 }, () => b.next());
    const seqC = Array.from({ length: 20 }, () => c.next());
    expect(seqA).toEqual(seqB);
    expect(seqA).not.toEqual(seqC);
  });

  it('stays inside its ranges', () => {
    const r = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const u = r.next();
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThan(1);
      const k = r.int(3, 6);
      expect(k).toBeGreaterThanOrEqual(3);
      expect(k).toBeLessThanOrEqual(6);
      const x = r.range(-2, 5);
      expect(x).toBeGreaterThanOrEqual(-2);
      expect(x).toBeLessThan(5);
    }
  });

  it('gives forks their own streams', () => {
    const r = new Rng(9);
    expect(r.fork(1).next()).not.toBe(r.fork(2).next());
  });
});

describe('Driver points', () => {
  it('generates drivers who spend exactly 100 points within the cap', () => {
    const rng = new Rng(5);
    for (let i = 0; i < 50; i++) {
      const d = generateDriver(rng, i);
      expect(pointsSpent(d)).toBe(STARTING_POINTS);
      for (const s of SKILLS) {
        expect(d.skills[s]).toBeGreaterThanOrEqual(0);
        expect(d.skills[s]).toBeLessThanOrEqual(SKILL_CAP_AT_CREATION);
      }
      expect(d.code).toHaveLength(3);
    }
  });

  it('is deterministic for a seed', () => {
    expect(generateDriver(new Rng(11), 0)).toEqual(generateDriver(new Rng(11), 0));
  });

  it('earns one point per ten completed races', () => {
    expect(pointsAllowed(driver({}, { racesCompleted: 0 }))).toBe(100);
    expect(pointsAllowed(driver({}, { racesCompleted: 9 }))).toBe(100);
    expect(pointsAllowed(driver({}, { racesCompleted: 10 }))).toBe(101);
    expect(pointsAllowed(driver({}, { racesCompleted: 37 }))).toBe(103);
  });
});

describe('Driver profile', () => {
  const low = (s: Skill) => deriveProfile(driver({ [s]: 0 }));
  const high = (s: Skill) => deriveProfile(driver({ [s]: 20 }));

  it('reacts faster with more Reaction', () => {
    expect(high('reaction').reactionTime).toBeLessThan(low('reaction').reactionTime);
  });
  it('reads further ahead with more Anticipation', () => {
    expect(high('anticipation').lookahead).toBeGreaterThan(low('anticipation').lookahead);
  });
  it('uses more grip with more Cornering and Braking', () => {
    expect(high('cornering').cornerGrip).toBeGreaterThan(low('cornering').cornerGrip);
    expect(high('braking').brakeGrip).toBeGreaterThan(low('braking').brakeGrip);
  });
  it('varies less with more Consistency', () => {
    expect(high('consistency').paceNoise).toBeLessThan(low('consistency').paceNoise);
    expect(high('consistency').mistakeRate).toBeLessThan(low('consistency').mistakeRate);
  });
  it('tires more slowly with more Endurance', () => {
    expect(high('endurance').fatigueRate).toBeLessThan(low('endurance').fatigueRate);
  });
  it('feels pressure less with more Composure', () => {
    expect(high('composure').pressureSensitivity).toBeLessThan(low('composure').pressureSensitivity);
  });
  it('catches bigger slides with more Car control', () => {
    expect(high('carControl').catchAngle).toBeGreaterThan(low('carControl').catchAngle);
  });
  it('is kinder to tyres with more Mechanical sympathy', () => {
    expect(high('sympathy').wearFactor).toBeLessThan(low('sympathy').wearFactor);
  });

  it('follows closer and passes sooner when aggressive', () => {
    const calm = deriveProfile(driver({}, { aggression: 0.1 }));
    const fierce = deriveProfile(driver({}, { aggression: 0.9 }));
    expect(fierce.followGap).toBeLessThan(calm.followGap);
    expect(fierce.passThreshold).toBeLessThan(calm.passThreshold);
    expect(fierce.wearFactor).toBeGreaterThan(calm.wearFactor);
  });

  it('turns risk into mistakes when car control cannot support it', () => {
    const wild = deriveProfile(driver({ carControl: 0 }, { risk: 0.9 }));
    const skilled = deriveProfile(driver({ carControl: 20 }, { risk: 0.9 }));
    expect(wild.mistakeRate).toBeGreaterThan(skilled.mistakeRate * 1.5);
    expect(wild.cornerGrip).toBeGreaterThan(deriveProfile(driver({ carControl: 0 }, { risk: 0.1 })).cornerGrip);
  });

  it('carries the driver weight into the car and tires heavy drivers sooner', () => {
    const light = deriveProfile(driver({}, { weight: 58 }));
    const heavy = deriveProfile(driver({}, { weight: 90 }));
    expect(heavy.mass).toBe(90);
    expect(heavy.fatigueRate).toBeGreaterThan(light.fatigueRate);
  });
});
