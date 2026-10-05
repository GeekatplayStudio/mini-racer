import { describe, expect, it } from 'vitest';
import { Part, getPart } from '../src/data/parts';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { MAX_CARS, buildResale, partPrice, resaleValue } from '../src/game/build';
import {
  MAX_DRIVERS,
  MemoryStore,
  STARTING_MONEY,
  addSkillPoint,
  blankDriver,
  buyCar,
  entryFee,
  fireDriver,
  fitPart,
  hireDriver,
  newProfile,
  payEntry,
  pointsAvailable,
  prizeMoney,
  removePart,
  sellCar,
  settleRace,
  skillCap,
  validateNewDriver,
} from '../src/game/profile';
import { DriverDef, SKILLS } from '../src/sim/driver';

const part = (id: string): Part => getPart(id)!;
const look = { sex: 0, skin: 0, hair: 1, hairColor: 0, beard: 0, helmet: 0, suit: 0, age: 1, face: 0, eyes: 0, glasses: 0, hat: 0 };

function draft(name = 'Jo Driver'): DriverDef {
  const d = blankDriver();
  d.name = name;
  // 12 skills: four at 9 and eight at 8 is exactly 100.
  SKILLS.forEach((s, i) => (d.skills[s] = i < 4 ? 9 : 8));
  return d;
}

describe('Buying and fitting', () => {
  it('starts with money and an empty garage', () => {
    const p = newProfile();
    expect(p.money).toBe(STARTING_MONEY);
    expect(p.cars).toEqual([]);
    expect(p.drivers).toEqual([]);
  });

  it('buying a chassis takes its price and opens a car', () => {
    const p = newProfile();
    expect(buyCar(p, part('ch-audi-r8'), 'used', 'My R8').ok).toBe(true);
    expect(p.money).toBe(STARTING_MONEY - partPrice(part('ch-audi-r8'), 'used'));
    expect(p.cars).toHaveLength(1);
    expect(p.cars[0].name).toBe('My R8');
    expect(p.cars[0].parts.chassis).toEqual({ part: 'ch-audi-r8', cond: 'used' });
    expect(p.selectedCar).toBe(p.cars[0].id);
  });

  it('refuses what the player cannot afford and leaves the balance alone', () => {
    const p = newProfile();
    p.money = 1000;
    const r = buyCar(p, part('ch-audi-r8'), 'new', '');
    expect(r.ok).toBe(false);
    expect(p.money).toBe(1000);
    expect(p.cars).toHaveLength(0);
  });

  it('holds five cars at most', () => {
    const p = newProfile();
    p.money = 10_000_000;
    for (let i = 0; i < MAX_CARS; i++) expect(buyCar(p, part('ch-audi-r8'), 'worn', '').ok).toBe(true);
    expect(buyCar(p, part('ch-audi-r8'), 'worn', '').ok).toBe(false);
    expect(p.cars).toHaveLength(MAX_CARS);
  });

  it('fitting charges the price and swapping credits the trade-in', () => {
    const p = newProfile();
    buyCar(p, part('ch-porsche-992'), 'worn', '');
    const car = p.cars[0];
    const before = p.money;
    expect(fitPart(p, car, part('ty-toyo'), 'new').ok).toBe(true);
    expect(p.money).toBe(before - 1750);
    const mid = p.money;
    expect(fitPart(p, car, part('ty-pirelli'), 'new').ok).toBe(true);
    expect(p.money).toBe(mid - 2650 + resaleValue({ part: 'ty-toyo', cond: 'new' }));
    expect(car.parts.tyres).toEqual({ part: 'ty-pirelli', cond: 'new' });
  });

  it('will not fit an incompatible part or one the player cannot pay for', () => {
    const p = newProfile();
    buyCar(p, part('ch-porsche-992'), 'worn', '');
    const car = p.cars[0];
    const money = p.money;
    expect(fitPart(p, car, part('en-ferrari-f163'), 'new').ok).toBe(false);
    p.money = 500;
    expect(fitPart(p, car, part('en-porsche-42'), 'new').ok).toBe(false);
    expect(car.parts.engine).toBeUndefined();
    expect(p.money).toBe(500);
    p.money = money;
  });

  it('removing a part pays its resale value; the chassis stays', () => {
    const p = newProfile();
    buyCar(p, part('ch-porsche-992'), 'worn', '');
    const car = p.cars[0];
    fitPart(p, car, part('wg-voltex'), 'used');
    const before = p.money;
    expect(removePart(p, car, 'wing').ok).toBe(true);
    expect(p.money).toBe(before + resaleValue({ part: 'wg-voltex', cond: 'used' }));
    expect(car.parts.wing).toBeUndefined();
    expect(removePart(p, car, 'wing').ok).toBe(false);
    expect(removePart(p, car, 'chassis').ok).toBe(false);
  });

  it('changing chassis sells the engine that no longer fits', () => {
    const p = newProfile();
    buyCar(p, part('ch-porsche-992'), 'worn', '');
    const car = p.cars[0];
    fitPart(p, car, part('en-porsche-40'), 'worn');
    fitPart(p, car, part('ty-toyo'), 'new');
    expect(fitPart(p, car, part('ch-bmw-m4'), 'worn').ok).toBe(true);
    expect(car.parts.engine).toBeUndefined();
    expect(car.parts.tyres).toBeDefined();
    expect(car.parts.chassis?.part).toBe('ch-bmw-m4');
  });

  it('selling a car returns its resale value and frees the bay', () => {
    const p = newProfile();
    buyCar(p, part('ch-porsche-992'), 'new', '');
    fitPart(p, p.cars[0], part('ty-toyo'), 'new');
    const value = buildResale(p.cars[0]);
    const before = p.money;
    expect(sellCar(p, p.cars[0].id).ok).toBe(true);
    expect(p.money).toBe(before + value);
    expect(p.cars).toHaveLength(0);
    expect(p.selectedCar).toBeNull();
    expect(p.money).toBeLessThan(STARTING_MONEY);
  });
});

describe('Driver rules', () => {
  it('requires a name and exactly 100 points, at most 20 per skill', () => {
    const d = draft();
    expect(validateNewDriver(d).ok).toBe(true);
    expect(validateNewDriver({ ...d, name: ' ' }).ok).toBe(false);
    expect(validateNewDriver({ ...d, skills: { ...d.skills, reaction: 8 } }).ok).toBe(false);
    expect(validateNewDriver({ ...d, skills: { ...d.skills, reaction: 10 } }).ok).toBe(false);
    expect(validateNewDriver({ ...d, skills: { ...d.skills, reaction: 21, braking: 0, anticipation: 6 } }).ok).toBe(false);
  });

  it('signs a driver with a timing code and locks a copy of the skills', () => {
    const p = newProfile();
    const d = draft('Maria Del Rio');
    expect(hireDriver(p, d, look).ok).toBe(true);
    expect(p.drivers[0].def.code).toBe('RIO');
    expect(p.selectedDriver).toBe(d.id);
    d.skills.reaction = 0;
    expect(p.drivers[0].def.skills.reaction).toBe(9);
  });

  it('holds three drivers at most; firing frees a seat', () => {
    const p = newProfile();
    for (let i = 0; i < MAX_DRIVERS; i++) expect(hireDriver(p, draft(`Driver ${i}`), look).ok).toBe(true);
    expect(hireDriver(p, draft('One Too Many'), look).ok).toBe(false);
    expect(fireDriver(p, p.drivers[0].def.id).ok).toBe(true);
    expect(p.drivers).toHaveLength(MAX_DRIVERS - 1);
    expect(hireDriver(p, draft('Replacement'), look).ok).toBe(true);
    expect(fireDriver(p, 'nobody').ok).toBe(false);
  });

  it('gives no points to spend until ten races are done, then one that can only be added', () => {
    const p = newProfile();
    hireDriver(p, draft(), look);
    const def = p.drivers[0].def;
    expect(pointsAvailable(def)).toBe(0);
    expect(addSkillPoint(def, 'braking').ok).toBe(false);
    def.racesCompleted = 10;
    expect(pointsAvailable(def)).toBe(1);
    expect(skillCap(def)).toBe(21);
    expect(addSkillPoint(def, 'braking').ok).toBe(true);
    expect(def.skills.braking).toBe(10);
    expect(pointsAvailable(def)).toBe(0);
    expect(addSkillPoint(def, 'braking').ok).toBe(false);
  });

  it('caps a skill at 20 plus earned points', () => {
    const d = draft();
    d.skills = { ...d.skills, reaction: 20, anticipation: 0, carControl: 7 };
    const p = newProfile();
    expect(hireDriver(p, d, look).ok).toBe(true);
    const def = p.drivers[0].def;
    def.racesCompleted = 20;
    expect(addSkillPoint(def, 'reaction').ok).toBe(true);
    expect(addSkillPoint(def, 'reaction').ok).toBe(true);
    expect(def.skills.reaction).toBe(22);
    expect(addSkillPoint(def, 'reaction').ok).toBe(false);
  });
});

describe('Economy', () => {
  const track = BRANDS_HATCH_INDY;

  it('pays more for better positions, and the win covers the fee many times', () => {
    for (let pos = 1; pos < 12; pos++) expect(prizeMoney(track, pos)).toBeGreaterThanOrEqual(prizeMoney(track, pos + 1));
    expect(prizeMoney(track, 1)).toBeGreaterThan(entryFee(track) * 3);
    expect(prizeMoney(track, 10)).toBeGreaterThan(0);
  });

  it('pays more at harder tracks', () => {
    const hard = { ...track, difficulty: 5 };
    expect(prizeMoney(hard, 1)).toBeGreaterThan(prizeMoney(track, 1));
    expect(entryFee(hard)).toBeGreaterThan(entryFee(track));
  });

  it('takes the entry fee, or lets a broke team in free', () => {
    const p = newProfile();
    expect(payEntry(p, track)).toEqual({ paid: entryFee(track), wildcard: false });
    expect(p.money).toBe(STARTING_MONEY - entryFee(track));
    p.money = 10;
    expect(payEntry(p, track)).toEqual({ paid: 0, wildcard: true });
    expect(p.money).toBe(10);
  });

  it('banks the prize, the win and the driver experience', () => {
    const p = newProfile();
    hireDriver(p, draft(), look);
    const id = p.drivers[0].def.id;
    const before = p.money;
    expect(settleRace(p, id, track, 1)).toBe(prizeMoney(track, 1));
    expect(p.money).toBe(before + prizeMoney(track, 1));
    expect(p.races).toBe(1);
    expect(p.wins).toBe(1);
    expect(p.drivers[0].def.racesCompleted).toBe(1);
    settleRace(p, id, track, 6);
    expect(p.wins).toBe(1);
    expect(p.races).toBe(2);
  });
});

describe('Saving', () => {
  it('round-trips the whole profile through a store', () => {
    const store = new MemoryStore();
    expect(store.load()).toBeNull();
    const p = newProfile();
    buyCar(p, part('ch-audi-r8'), 'used', 'Saved');
    fitPart(p, p.cars[0], part('ty-pirelli'), 'new');
    hireDriver(p, draft(), look);
    store.save(p);
    const loaded = store.load();
    expect(loaded).toEqual(p);
    expect(loaded).not.toBe(p);
  });
});
