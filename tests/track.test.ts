import { describe, expect, it } from 'vitest';
import { BRANDS_HATCH_INDY } from '../src/data/tracks';
import { computeRacingLine } from '../src/sim/line';
import { Surface, Track } from '../src/sim/track';

const track = new Track(BRANDS_HATCH_INDY);

describe('Track', () => {
  it('is resampled to the declared length at even spacing', () => {
    let total = 0;
    for (let i = 0; i < track.n; i++) {
      const j = (i + 1) % track.n;
      const step = Math.hypot(track.x[j] - track.x[i], track.y[j] - track.y[i]);
      expect(step).toBeGreaterThan(track.ds * 0.9);
      expect(step).toBeLessThan(track.ds * 1.1);
      total += step;
    }
    expect(total).toBeGreaterThan(BRANDS_HATCH_INDY.lengthM * 0.99);
    expect(total).toBeLessThan(BRANDS_HATCH_INDY.lengthM * 1.01);
  });

  it('turns through one full circle over a lap', () => {
    let turned = 0;
    for (let i = 0; i < track.n; i++) turned += track.curvature[i] * track.ds;
    expect(Math.abs(turned)).toBeCloseTo(Math.PI * 2, 1);
  });

  it('has no corner tighter than a hairpin', () => {
    let tightest = Infinity;
    for (let i = 0; i < track.n; i++) tightest = Math.min(tightest, 1 / Math.abs(track.curvature[i]));
    expect(tightest).toBeGreaterThan(15);
  });

  it('locates a point back to the distance and offset it was built from', () => {
    for (const [s, d] of [[100, 2.5], [640, -4], [1500, 0], [1930, 5]] as const) {
      const [x, y] = track.pointAt(s, d);
      const loc = track.locate(x, y, -1);
      expect(loc.s).toBeCloseTo(s, 0);
      expect(loc.d).toBeCloseTo(d, 1);
    }
  });

  it('finds the same place with a nearby hint as with a full search', () => {
    const [x, y] = track.pointAt(803, 1);
    const full = track.locate(x, y, -1);
    const hinted = track.locate(x, y, full.index - 8);
    expect(hinted.index).toBe(full.index);
  });

  it('classifies surfaces by distance from the centre line', () => {
    expect(track.surfaceAt(10, 0)).toBe(Surface.Asphalt);
    expect(track.surfaceAt(10, track.halfWidth - 0.1)).toBe(Surface.Asphalt);
    const kerbIndex = track.kerb[1].indexOf(1);
    expect(kerbIndex).toBeGreaterThanOrEqual(0);
    expect(track.surfaceAt(kerbIndex, track.halfWidth + 0.5)).toBe(Surface.Kerb);
    const gravelIndex = track.gravel[0].indexOf(1);
    expect(track.surfaceAt(gravelIndex, -(track.halfWidth + 6))).toBe(Surface.Gravel);
    const plain = Array.from({ length: track.n }, (_, i) => i).find((i) => !track.gravel[1][i] && !track.kerb[1][i] && !track.inPitZone(i * track.ds));
    expect(track.surfaceAt(plain ?? 0, track.halfWidth + 4)).toBe(Surface.Grass);
    // The pit lane beside the start straight is tarmac, on the pit side only.
    const sign = track.pit.side === 1 ? 1 : -1;
    expect(track.surfaceAt(2, sign * track.pit.offset)).toBe(Surface.Asphalt);
    expect(track.surfaceAt(2, -sign * track.pit.offset)).toBe(Surface.Grass);
  });

  it('keeps barriers outside the track on both sides', () => {
    for (let i = 0; i < track.n; i++) {
      expect(track.wall[0][i]).toBeGreaterThan(track.halfWidth + 5);
      expect(track.wall[1][i]).toBeGreaterThan(track.halfWidth + 5);
    }
  });

  it('staggers grid slots behind the start line', () => {
    const a = track.gridSlot(0);
    const b = track.gridSlot(1);
    expect(a.s).toBeLessThan(track.length);
    expect(b.s).toBeLessThan(a.s);
    expect(Math.sign(a.d)).not.toBe(Math.sign(b.d));
  });
});

describe('Racing line', () => {
  const line = computeRacingLine(track);

  it('stays inside the track limits', () => {
    for (let i = 0; i < track.n; i++) expect(Math.abs(line.offset[i])).toBeLessThanOrEqual(track.halfWidth - 1.4);
  });

  it('is straighter than the centre line, overall and at the tightest point', () => {
    let centre = 0, ideal = 0, centreMax = 0, idealMax = 0;
    for (let i = 0; i < track.n; i++) {
      centre += track.curvature[i] ** 2;
      ideal += line.curvature[i] ** 2;
      centreMax = Math.max(centreMax, Math.abs(track.curvature[i]));
      idealMax = Math.max(idealMax, Math.abs(line.curvature[i]));
    }
    expect(ideal).toBeLessThan(centre * 0.96);
    expect(idealMax).toBeLessThan(centreMax);
  });

  it('uses the inside of the tightest corner', () => {
    let apex = 0;
    for (let i = 0; i < track.n; i++) if (Math.abs(track.curvature[i]) > Math.abs(track.curvature[apex])) apex = i;
    expect(Math.sign(line.offset[apex])).toBe(Math.sign(track.curvature[apex]));
    expect(Math.abs(line.offset[apex])).toBeGreaterThan(track.halfWidth * 0.5);
  });
});
