import { describe, expect, it } from 'vitest';
import { placeCar } from '../src/audio/sound';
import type { Ear } from '../src/audio/sound';
import type { Placement } from '../src/audio/engineSynth';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { LIVERIES } from '../src/data/cars';
import { generateBuild } from '../src/game/build';
import { voiceForBuild, voiceForModel } from '../src/game/engineVoice';
import { createQuickRace } from '../src/game/raceSetup';
import { createCarState } from '../src/sim/car';
import { Rng } from '../src/sim/rng';

const spec = createQuickRace({ trackDef: BRANDS_HATCH_INDY, gridSize: 2, laps: 1, seed: 1, playerGrid: 0 }).race.cars[0].spec;
const place = (): Placement => ({ level: 0, pan: 0, doppler: 1, clarity: 1 });
/** Standing still, looking up the screen: right is +x. */
const still: Ear = { x: 0, y: 0, vx: 0, vy: 0, rightX: 1, rightY: 0 };

describe('Engine voices', () => {
  it('gives each engine layout its own character', () => {
    const v10 = voiceForModel('audi-r8-lms-gt3-evo2', 'a');
    const v8 = voiceForModel('mercedes-amg-gt3-evo', 'a');
    const flat8 = voiceForModel('mclaren-720s-gt3-evo', 'a');
    const six = voiceForModel('bmw-m4-gt3', 'a');
    expect([v10.cylinders, v8.cylinders, six.cylinders]).toEqual([10, 8, 6]);
    // A cross-plane V8 burbles, a flat-plane one does not; a V10 screams; turbos whistle.
    expect(v8.lump).toBeGreaterThan(flat8.lump + 0.4);
    expect(v10.rasp).toBeGreaterThan(v8.rasp + 0.4);
    expect(six.turbo).toBe(1);
    expect(v10.turbo).toBe(0);
    expect(v8.size).toBeGreaterThan(six.size);
  });

  it('sets two cars with the same engine slightly apart, the same car always the same', () => {
    const a = voiceForModel('audi-r8-lms-gt3-evo2', 'car-1');
    const b = voiceForModel('audi-r8-lms-gt3-evo2', 'car-2');
    expect(a.tune).not.toBe(b.tune);
    expect(Math.abs(a.tune - 1)).toBeLessThan(0.031);
    expect(voiceForModel('audi-r8-lms-gt3-evo2', 'car-1')).toEqual(a);
    // Across a grid the spread is wide enough to hear.
    const tunes = Array.from({ length: 10 }, (_, i) => voiceForModel('audi-r8-lms-gt3-evo2', `5/${i}`).tune);
    expect(Math.max(...tunes) - Math.min(...tunes)).toBeGreaterThan(0.03);
  });

  it('reads a built car: engine part and exhaust', () => {
    const rng = new Rng(3);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const build = generateBuild(rng, 1 + (i % 4), { ...LIVERIES[0] }, `b${i}`);
      const voice = voiceForBuild(build);
      seen.add(voice.label);
      expect(voice.open).toBeGreaterThanOrEqual(0.2);
      expect(voice.open).toBeLessThanOrEqual(0.9);
    }
    // The catalogue's engines between them cover several layouts.
    expect(seen.size).toBeGreaterThanOrEqual(4);
    const build = generateBuild(new Rng(9), 3, { ...LIVERIES[0] }, 'mine');
    const quiet = voiceForBuild({ ...build, parts: { ...build.parts, exhaust: { part: 'ex-steel', cond: 'new' } } });
    const loud = voiceForBuild({ ...build, parts: { ...build.parts, exhaust: { part: 'ex-inconel', cond: 'new' } } });
    expect(loud.open).toBeGreaterThan(quiet.open);
  });
});

describe('Where a car is heard from', () => {
  it('is louder and clearer close by', () => {
    const near = placeCar(createCarState(spec, 0, -10, 0), still, place());
    const far = placeCar(createCarState(spec, 0, -150, 0), still, place());
    expect(near.level).toBeGreaterThan(far.level * 5);
    expect(near.clarity).toBeGreaterThan(far.clarity);
  });

  it('sits on the side of the screen it is on', () => {
    expect(placeCar(createCarState(spec, 30, 0, 0), still, place()).pan).toBeGreaterThan(0.5);
    expect(placeCar(createCarState(spec, -30, 0, 0), still, place()).pan).toBeLessThan(-0.5);
    // Seen from the other way round, right and left swap.
    expect(placeCar(createCarState(spec, 30, 0, 0), { ...still, rightX: -1 }, place()).pan).toBeLessThan(-0.5);
  });

  it('rises in pitch coming in and drops going away', () => {
    // A car 40 m to the left, heading right at 60 m/s: toward the ear.
    const coming = createCarState(spec, -40, 0, 0);
    coming.vx = 60;
    const going = createCarState(spec, 40, 0, 0);
    going.vx = 60;
    expect(placeCar(coming, still, place()).doppler).toBeGreaterThan(1.15);
    expect(placeCar(going, still, place()).doppler).toBeLessThan(0.85);
    // Driving alongside at the same speed there is no bend.
    expect(placeCar(going, { ...still, vx: 60 }, place()).doppler).toBeCloseTo(1, 5);
  });
});
