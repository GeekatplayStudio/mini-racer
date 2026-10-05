import { mod, wrapAngle } from './math';

/** Static description of a circuit. Pure data, so new tracks need no code. */
export interface TrackDef {
  id: string;
  /** Real circuit the layout follows. */
  name: string;
  /** Unlicensed look-alike name for public builds. */
  publicName: string;
  country: string;
  lengthM: number;
  widthM: number;
  /** 1 (easy) to 5 (hard); drives entry fee and prize pool. */
  difficulty: number;
  defaultLaps: number;
  /**
   * Closed centre-line control points in driving order, x to the right and y
   * down as seen from above. Units are arbitrary; the layout is scaled to lengthM.
   */
  points: readonly (readonly [number, number])[];
  /** Side of the start straight the pit lane is on: 1 toward the normal, 0 away. Default 1. */
  pitSide?: 0 | 1;
}

export enum Surface {
  Asphalt = 0,
  Kerb = 1,
  Grass = 2,
  Gravel = 3,
}

export interface SurfaceProps {
  grip: number;
  /** Extra rolling drag as a fraction of the car's weight. */
  drag: number;
  /** Multiplier on tyre wear from cornering and braking. */
  wear: number;
  /** Tread scrubbed away per second at 30 m/s, on top of normal wear. */
  abrasion: number;
  /** Mud and grit carried back onto the track, 0..1. */
  dirt: number;
}

export const SURFACES: readonly SurfaceProps[] = [
  { grip: 1.0, drag: 0, wear: 1, abrasion: 0, dirt: 0 },
  { grip: 0.93, drag: 0.004, wear: 1.35, abrasion: 0.00004, dirt: 0 },
  { grip: 0.48, drag: 0.07, wear: 2.5, abrasion: 0.0006, dirt: 0.7 },
  // Deep enough to stop a car, shallow enough that it can drive out.
  { grip: 0.45, drag: 0.2, wear: 4, abrasion: 0.0018, dirt: 1 },
];

export const KERB_WIDTH = 1.3;
/** Boxes along the pit lane; one per car on the largest grid. */
export const PIT_BOXES = 12;
export const SAMPLE_SPACING = 2;

const CORNER_KAPPA = 1 / 120;
const GRAVEL_KAPPA = 1 / 90;

export interface TrackLocation {
  /** Nearest sample index. */
  index: number;
  /** Distance along the lap, 0..length. */
  s: number;
  /** Signed lateral offset from the centre line, positive toward the normal. */
  d: number;
}

/**
 * Runtime track: the centre line resampled at even spacing with per-sample
 * tangent, normal, curvature and run-off layout. Side 1 is the side the normal
 * points to (positive d), side 0 is the opposite side.
 */
export class Track {
  readonly def: TrackDef;
  readonly n: number;
  readonly ds: number;
  readonly length: number;
  readonly halfWidth: number;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly tx: Float64Array;
  readonly ty: Float64Array;
  readonly nx: Float64Array;
  readonly ny: Float64Array;
  readonly heading: Float64Array;
  /** Signed curvature in 1/m; positive turns toward the normal. */
  readonly curvature: Float64Array;
  /** Per side: 1 where a kerb borders the track. */
  readonly kerb: readonly [Uint8Array, Uint8Array];
  /** Per side: 1 where the run-off is a gravel trap. */
  readonly gravel: readonly [Uint8Array, Uint8Array];
  /** Per side: distance from the centre line to the barrier. */
  readonly wall: readonly [Float32Array, Float32Array];
  /** Pit lane beside the start straight: where it starts and ends along the lap and how far out it runs. */
  readonly pit: { side: 0 | 1; sIn: number; sOut: number; offset: number; width: number };
  /** How far beyond the through lane a car stands in its box. */
  readonly pitBoxInset = 4;
  private readonly cells = new Map<number, number[]>();

  constructor(def: TrackDef) {
    this.def = def;
    this.length = def.lengthM;
    this.halfWidth = def.widthM / 2;
    const n = Math.round(def.lengthM / SAMPLE_SPACING);
    this.n = n;
    this.ds = def.lengthM / n;

    const [px, py] = resampleClosedSpline(def.points, def.lengthM, n);
    this.x = px;
    this.y = py;
    this.tx = new Float64Array(n);
    this.ty = new Float64Array(n);
    this.nx = new Float64Array(n);
    this.ny = new Float64Array(n);
    this.heading = new Float64Array(n);
    this.curvature = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const a = mod(i - 1, n);
      const b = (i + 1) % n;
      const dx = px[b] - px[a];
      const dy = py[b] - py[a];
      const len = Math.hypot(dx, dy);
      this.tx[i] = dx / len;
      this.ty[i] = dy / len;
      this.nx[i] = -this.ty[i];
      this.ny[i] = this.tx[i];
      this.heading[i] = Math.atan2(dy, dx);
    }
    const raw = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = mod(i - 1, n);
      const b = (i + 1) % n;
      raw[i] = wrapAngle(this.heading[b] - this.heading[a]) / (2 * this.ds);
    }
    this.curvature.set(smoothClosed(raw, 2, 2));

    this.kerb = [new Uint8Array(n), new Uint8Array(n)];
    this.gravel = [new Uint8Array(n), new Uint8Array(n)];
    this.wall = [new Float32Array(n), new Float32Array(n)];
    this.layoutRunoff();
    this.pit = { side: def.pitSide ?? 1, sIn: this.length - 230, sOut: 120, offset: this.halfWidth + 4.2, width: 7.2 };
    // The pit side of the start straight is wider: a through lane and a row of boxes inside the wall.
    const pitWall = this.wall[this.pit.side];
    for (let i = 0; i < n; i++) {
      const s = i * this.ds;
      const into = Math.min(mod(s - (this.pit.sIn - 60), this.length), mod(this.pit.sOut + 60 - s, this.length));
      if (mod(s - (this.pit.sIn - 60), this.length) < 230 + 120 + 120) pitWall[i] += 10 * Math.min(1, into / 50);
    }
    for (let i = 0; i < n; i++) {
      const key = cellKey(px[i], py[i]);
      const list = this.cells.get(key);
      if (list) list.push(i);
      else this.cells.set(key, [i]);
    }
  }

  /** True between pit entry and pit exit. */
  inPitZone(s: number): boolean {
    return s >= this.pit.sIn || s <= this.pit.sOut;
  }

  /** Lap distance of the pit box for a car number. */
  pitBox(id: number): number {
    return this.length - 172 + (id % PIT_BOXES) * 11;
  }

  /**
   * Nearest sample to a point, or -1 when the point is more than about 120 m
   * from any part of the track. Fast enough to call thousands of times.
   */
  nearest(px: number, py: number): number {
    const cx = Math.floor(px / CELL), cy = Math.floor(py / CELL);
    let best = -1;
    let bestD2 = Infinity;
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const list = this.cells.get((cx + ox) * 73856093 + (cy + oy) * 19349663);
        if (!list) continue;
        for (const i of list) {
          const d2 = (px - this.x[i]) ** 2 + (py - this.y[i]) ** 2;
          if (d2 < bestD2) {
            bestD2 = d2;
            best = i;
          }
        }
      }
    }
    return best;
  }

  private layoutRunoff(): void {
    const { n, curvature: k, ds } = this;
    const exitSamples = Math.round(34 / ds);
    const entrySamples = Math.round(14 / ds);
    const gravelBefore = Math.round(20 / ds);
    const gravelAfter = Math.round(56 / ds);

    for (let i = 0; i < n; i++) {
      const ki = k[i];
      if (Math.abs(ki) > CORNER_KAPPA) {
        const inside = ki > 0 ? 1 : 0;
        this.kerb[inside][i] = 1;
        // Exit and entry kerbs sit on the outside, just beyond the corner.
        const outside = 1 - inside;
        for (let j = 1; j <= exitSamples; j++) {
          const m = (i + j) % n;
          if (Math.abs(k[m]) < CORNER_KAPPA) this.kerb[outside][m] = 1;
        }
        for (let j = 1; j <= entrySamples; j++) {
          const m = mod(i - j, n);
          if (Math.abs(k[m]) < CORNER_KAPPA) this.kerb[outside][m] = 1;
        }
      }
      if (Math.abs(ki) > GRAVEL_KAPPA) {
        const outside = ki > 0 ? 0 : 1;
        for (let j = -gravelBefore; j <= gravelAfter; j++) this.gravel[outside][mod(i + j, n)] = 1;
      }
    }

    for (let side = 0; side < 2; side++) {
      const rawWall = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        rawWall[i] = this.halfWidth + (this.gravel[side][i] ? 21 : 9);
      }
      this.wall[side].set(smoothClosed(rawWall, 8, 3));
    }
  }

  /**
   * Finds where a world position sits relative to the track. Pass the previous
   * index as a hint for a cheap local search; pass -1 for a full search.
   */
  locate(px: number, py: number, hint: number): TrackLocation {
    const { n, x, y } = this;
    let best = 0;
    let bestD2 = Infinity;
    if (hint < 0) {
      for (let i = 0; i < n; i++) {
        const d2 = (px - x[i]) ** 2 + (py - y[i]) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    } else {
      for (let o = -14; o <= 14; o++) {
        const i = mod(hint + o, n);
        const d2 = (px - x[i]) ** 2 + (py - y[i]) ** 2;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = i;
        }
      }
    }
    const rx = px - x[best];
    const ry = py - y[best];
    const along = rx * this.tx[best] + ry * this.ty[best];
    const d = rx * this.nx[best] + ry * this.ny[best];
    return { index: best, s: mod(best * this.ds + along, this.length), d };
  }

  indexAt(s: number): number {
    return mod(Math.round(s / this.ds), this.n);
  }

  /** World position at lap distance s and lateral offset d. */
  pointAt(s: number, d: number): [number, number] {
    const f = mod(s, this.length) / this.ds;
    const i = Math.floor(f) % this.n;
    const j = (i + 1) % this.n;
    const t = f - Math.floor(f);
    const cx = this.x[i] + (this.x[j] - this.x[i]) * t;
    const cy = this.y[i] + (this.y[j] - this.y[i]) * t;
    const nx = this.nx[i] + (this.nx[j] - this.nx[i]) * t;
    const ny = this.ny[i] + (this.ny[j] - this.ny[i]) * t;
    return [cx + nx * d, cy + ny * d];
  }

  surfaceAt(index: number, d: number): Surface {
    const ad = Math.abs(d);
    if (ad <= this.halfWidth) return Surface.Asphalt;
    const side = d >= 0 ? 1 : 0;
    if (side === this.pit.side && ad <= this.pit.offset + this.pit.width && this.inPitZone(index * this.ds)) return Surface.Asphalt;
    if (ad <= this.halfWidth + KERB_WIDTH && this.kerb[side][index]) return Surface.Kerb;
    if (this.gravel[side][index] && ad > this.halfWidth + 2.5) return Surface.Gravel;
    return Surface.Grass;
  }

  /** Start-grid slot for a 0-based grid position: staggered pairs behind the line. */
  gridSlot(position: number): { s: number; d: number } {
    return {
      s: this.length - 10 - position * 8,
      d: (position % 2 === 0 ? -1 : 1) * this.halfWidth * 0.45,
    };
  }
}

const CELL = 120;
function cellKey(x: number, y: number): number {
  return Math.floor(x / CELL) * 73856093 + Math.floor(y / CELL) * 19349663;
}

/** Moving-average smoothing on a closed loop. */
export function smoothClosed(values: Float64Array, radius: number, passes: number): Float64Array {
  const n = values.length;
  let src = values;
  for (let p = 0; p < passes; p++) {
    const dst = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let o = -radius; o <= radius; o++) sum += src[mod(i + o, n)];
      dst[i] = sum / (2 * radius + 1);
    }
    src = dst;
  }
  return src;
}

/**
 * Fits a closed centripetal Catmull-Rom spline through the control points,
 * scales it to the target length and resamples it at even arc-length spacing.
 */
function resampleClosedSpline(
  points: readonly (readonly [number, number])[],
  targetLength: number,
  n: number,
): [Float64Array, Float64Array] {
  const count = points.length;
  const perSegment = 48;
  const dense: number[] = [];
  for (let i = 0; i < count; i++) {
    const p0 = points[mod(i - 1, count)];
    const p1 = points[i];
    const p2 = points[(i + 1) % count];
    const p3 = points[(i + 2) % count];
    for (let j = 0; j < perSegment; j++) {
      const [x, y] = centripetal(p0, p1, p2, p3, j / perSegment);
      dense.push(x, y);
    }
  }
  const m = dense.length / 2;
  const cum = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    const j = (i + 1) % m;
    cum[i + 1] = cum[i] + Math.hypot(dense[j * 2] - dense[i * 2], dense[j * 2 + 1] - dense[i * 2 + 1]);
  }
  const scale = targetLength / cum[m];
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const target = ((i * targetLength) / n) / scale;
    while (seg < m - 1 && cum[seg + 1] < target) seg++;
    const t = (target - cum[seg]) / (cum[seg + 1] - cum[seg]);
    const j = (seg + 1) % m;
    xs[i] = (dense[seg * 2] + (dense[j * 2] - dense[seg * 2]) * t) * scale;
    ys[i] = (dense[seg * 2 + 1] + (dense[j * 2 + 1] - dense[seg * 2 + 1]) * t) * scale;
  }
  // Centre the layout on the origin.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i]);
    maxX = Math.max(maxX, xs[i]);
    minY = Math.min(minY, ys[i]);
    maxY = Math.max(maxY, ys[i]);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < n; i++) {
    xs[i] -= cx;
    ys[i] -= cy;
  }
  return [xs, ys];
}

type Pt = readonly [number, number];

function centripetal(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): [number, number] {
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const a1 = mix(p0, p1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
  const a2 = mix(p1, p2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
  const a3 = mix(p2, p3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
  const b1 = mix(a1, a2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
  const b2 = mix(a2, a3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
  return mix(b1, b2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
}

function knot(a: Pt, b: Pt): number {
  return Math.max(1e-6, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
}

function mix(a: Pt, b: Pt, wa: number, wb: number): [number, number] {
  return [a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb];
}
