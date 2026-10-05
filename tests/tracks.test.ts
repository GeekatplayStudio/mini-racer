import { describe, expect, it } from 'vitest';
import { GT3_CARS } from '../src/data/cars';
import { TRACKS } from '../src/data/tracks';
import { prepareTrack } from '../src/game/trackCache';
import { generateDriver } from '../src/sim/driver';
import { EntrantDef, Race } from '../src/sim/race';
import { Rng } from '../src/sim/rng';
import { Surface, Track, TrackDef } from '../src/sim/track';

/**
 * Fastest lap of a six-car, two-lap race, in seconds; the sim runs a few per cent slower than real cars. Real GT3 race laps for reference: Brands Indy
 * about 45, Red Bull Ring 89, Interlagos 93, Monza 107, Spa 139, Silverstone 121, Barcelona 105,
 * Nurburgring GP 115, Hungaroring 105, Hockenheim 99, Brands GP 84.5, Albert Park 119.5, Bahrain 124.
 */
const LAP_WINDOW: Record<string, readonly [number, number]> = {
  'brands-hatch-indy': [41, 46],
  'red-bull-ring': [89, 99],
  interlagos: [94, 104],
  monza: [105, 116],
  spa: [137, 151],
  silverstone: [123, 136],
  barcelona: [109, 120],
  'nurburgring-gp': [117, 129],
  hungaroring: [106, 117],
  hockenheim: [102, 112],
  'brands-hatch-gp': [86, 95],
  'albert-park': [118, 131],
  sakhir: [118, 131],
};

/** Words from real circuit names that a public name must not use. */
const REAL_NAMES = [
  'Brands', 'Hatch', 'Monza', 'Red Bull', 'Spielberg', 'Interlagos', 'Pace', 'Spa', 'Francorchamps', 'Silverstone',
  'Catalunya', 'Barcelona', 'Montmelo', 'Nurburgring', 'Nürburgring', 'Hungaroring', 'Hockenheim', 'Albert Park',
  'Bahrain', 'Sakhir', 'Zandvoort', 'Suzuka', 'Imola', 'Laguna Seca', 'Bathurst', 'Panorama', 'Monaco',
];

const cases = TRACKS.map((t) => [t.publicName, t] as const);

function field(count: number): EntrantDef[] {
  const rng = new Rng(4);
  return Array.from({ length: count }, (_, i) => ({
    driver: generateDriver(rng, i),
    spec: GT3_CARS[i % GT3_CARS.length].spec,
    pitSaving: 12,
    pitMode: 'auto' as const,
  }));
}

/** How far a barrier of one part of the lap reaches into the walled corridor of another part; negative means they cross. */
function wallClearance(t: Track): number {
  let margin = Infinity;
  for (let i = 0; i < t.n; i += 2) {
    for (let side = 0; side < 2; side++) {
      const sign = side === 1 ? 1 : -1;
      const wx = t.x[i] + t.nx[i] * sign * t.wall[side][i];
      const wy = t.y[i] + t.ny[i] * sign * t.wall[side][i];
      for (let j = 0; j < t.n; j += 2) {
        const gap = Math.min(Math.abs(i - j), t.n - Math.abs(i - j));
        if (gap < 60) continue;
        const rx = wx - t.x[j], ry = wy - t.y[j];
        const d = Math.hypot(rx, ry);
        if (d > 60) continue;
        const sj = rx * t.nx[j] + ry * t.ny[j] >= 0 ? 1 : 0;
        margin = Math.min(margin, d - t.wall[sj][j]);
      }
    }
  }
  return margin;
}

describe('Circuit catalogue', () => {
  it('has unique ids, a lap window for every circuit and invented public names', () => {
    expect(new Set(TRACKS.map((t) => t.id)).size).toBe(TRACKS.length);
    expect(TRACKS.length).toBeGreaterThanOrEqual(12);
    for (const t of TRACKS) {
      expect(LAP_WINDOW[t.id], t.id).toBeDefined();
      for (const real of REAL_NAMES) expect(t.publicName.toLowerCase(), `${t.id}: ${t.publicName}`).not.toContain(real.toLowerCase());
      expect(t.difficulty).toBeGreaterThanOrEqual(1);
      expect(t.difficulty).toBeLessThanOrEqual(5);
      // Races run for roughly 12 to 25 km at the default distance.
      expect(t.defaultLaps * t.lengthM).toBeGreaterThan(11000);
      expect(t.defaultLaps * t.lengthM).toBeLessThan(26000);
    }
  });
});

describe.each(cases)('%s', (_name, def: TrackDef) => {
  const { track: t, line } = prepareTrack(def);

  it('is a closed loop of the declared length that turns once', () => {
    let total = 0;
    for (let i = 0; i < t.n; i++) {
      const j = (i + 1) % t.n;
      const step = Math.hypot(t.x[j] - t.x[i], t.y[j] - t.y[i]);
      expect(step).toBeLessThan(t.ds * 1.1);
      total += step;
    }
    expect(Math.abs(total - def.lengthM)).toBeLessThan(def.lengthM * 0.01);
    let turned = 0;
    for (let i = 0; i < t.n; i++) turned += t.curvature[i] * t.ds;
    expect(Math.abs(turned)).toBeCloseTo(Math.PI * 2, 1);
  });

  it('never runs over itself: no hairpin tighter than 15 m, parts of the lap and their barriers kept apart', () => {
    for (let i = 0; i < t.n; i++) expect(1 / Math.abs(t.curvature[i])).toBeGreaterThan(15);
    let closest = Infinity;
    for (let i = 0; i < t.n; i += 2) {
      for (let j = i + 80; j < t.n; j += 2) {
        if (t.n - j + i < 80) continue;
        closest = Math.min(closest, Math.hypot(t.x[i] - t.x[j], t.y[i] - t.y[j]));
      }
    }
    expect(closest).toBeGreaterThan(44);
    expect(wallClearance(t)).toBeGreaterThan(0);
  });

  it('has a grid and pit lane on a straight', () => {
    for (let i = 0; i < t.n; i++) {
      const s = i * t.ds;
      if (s > t.length - 180 || s < 60) expect(1 / Math.abs(t.curvature[i])).toBeGreaterThan(120);
    }
    for (let id = 0; id < 10; id++) expect(t.inPitZone(t.pitBox(id))).toBe(true);
    expect(t.gridSlot(9).s).toBeGreaterThan(t.pit.sIn - 60);
    const sign = t.pit.side === 1 ? 1 : -1;
    expect(t.surfaceAt(t.indexAt(t.pitBox(4)), sign * (t.pit.offset + t.pitBoxInset))).toBe(Surface.Asphalt);
  });

  it('has a racing line inside the track limits that is straighter than the centre line', () => {
    let centre = 0, ideal = 0;
    for (let i = 0; i < t.n; i++) {
      expect(Number.isFinite(line.offset[i])).toBe(true);
      expect(Math.abs(line.offset[i])).toBeLessThanOrEqual(t.halfWidth - 1.4);
      centre += t.curvature[i] ** 2;
      ideal += line.curvature[i] ** 2;
    }
    expect(ideal).toBeLessThan(centre * 0.96);
  });

  it('can be raced to the flag by a full field at a plausible pace', () => {
    const race = new Race(t, field(6), 2, 7, line, { hazards: 0 });
    const end = 2 * 400 * 240;
    while (race.phase !== 'finished' && race.steps < end) {
      race.step();
      race.events.length = 0;
    }
    expect(race.phase).toBe('finished');
    expect(race.cars.every((c) => c.finished && !c.retired)).toBe(true);
    const [lo, hi] = LAP_WINDOW[def.id];
    expect(race.fastestLap).toBeGreaterThan(lo);
    expect(race.fastestLap).toBeLessThan(hi);
  }, 60000);
});
