import { CarSpec, maxDriveForce } from './car';
import { AIR_DENSITY, GRAVITY, clamp, mod, wrapAngle } from './math';
import { Track, smoothClosed } from './track';

/** The ideal racing line: a lateral offset from the centre line per track sample. */
export interface RacingLine {
  offset: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /** Signed curvature of the line itself, 1/m. */
  curvature: Float64Array;
}

/**
 * Finds a minimum-curvature line inside the track limits by relaxing lateral
 * offsets (gradient descent on the summed squared second difference).
 */
export function computeRacingLine(track: Track, edgeMargin = 1.5): RacingLine {
  // Coarse to fine: long sweeps settle at wide spacing, detail at close spacing.
  let offset: Float64Array = new Float64Array(track.n);
  for (const [stride, iterations] of [[16, 4000], [8, 8000], [4, 10000], [2, 4000]] as const) {
    offset = relaxOffsets(track, offset, stride, iterations, track.halfWidth - edgeMargin);
  }
  return lineFromOffsets(track, smoothClosed(offset, 3, 2));
}

function relaxOffsets(
  track: Track,
  start: Float64Array,
  stride: number,
  iterations: number,
  maxOff: number,
): Float64Array {
  const n = track.n;
  const m = Math.floor(n / stride);
  const idx = new Int32Array(m);
  for (let j = 0; j < m; j++) idx[j] = Math.round((j * n) / m) % n;

  const o = new Float64Array(m);
  for (let j = 0; j < m; j++) o[j] = start[idx[j]];
  const px = new Float64Array(m);
  const py = new Float64Array(m);
  const cx = new Float64Array(m);
  const cy = new Float64Array(m);
  const rate = 0.009;
  const nominal = track.length / m;

  for (let it = 0; it < iterations; it++) {
    for (let j = 0; j < m; j++) {
      const i = idx[j];
      px[j] = track.x[i] + track.nx[i] * o[j];
      py[j] = track.y[i] + track.ny[i] * o[j];
    }
    for (let j = 0; j < m; j++) {
      const a = mod(j - 1, m);
      const b = (j + 1) % m;
      // Weight by 1/spacing^3 so the sum is curvature squared per metre of
      // path. Without it, bunching points on the inside of a corner looks
      // cheaper than it is and the line hugs the apex kerb all the way round.
      const len = (Math.hypot(px[j] - px[a], py[j] - py[a]) + Math.hypot(px[b] - px[j], py[b] - py[j])) / 2;
      const w = clamp((nominal / len) ** 3, 0.25, 3);
      cx[j] = (px[a] - 2 * px[j] + px[b]) * w;
      cy[j] = (py[a] - 2 * py[j] + py[b]) * w;
    }
    for (let j = 0; j < m; j++) {
      const a = mod(j - 1, m);
      const b = (j + 1) % m;
      const i = idx[j];
      const gx = cx[a] - 2 * cx[j] + cx[b];
      const gy = cy[a] - 2 * cy[j] + cy[b];
      const grad = 2 * (gx * track.nx[i] + gy * track.ny[i]);
      o[j] = clamp(o[j] - rate * grad, -maxOff, maxOff);
    }
  }

  // Back to full resolution.
  const full = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const f = (i * m) / n;
    const j = Math.floor(f) % m;
    const t = f - Math.floor(f);
    full[i] = o[j] + (o[(j + 1) % m] - o[j]) * t;
  }
  return full;
}

export function lineFromOffsets(track: Track, offset: Float64Array): RacingLine {
  const n = track.n;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = track.x[i] + track.nx[i] * offset[i];
    y[i] = track.y[i] + track.ny[i] * offset[i];
  }
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = mod(i - 2, n);
    const b = (i + 2) % n;
    const h1 = Math.atan2(y[i] - y[a], x[i] - x[a]);
    const h2 = Math.atan2(y[b] - y[i], x[b] - x[i]);
    const dist = (Math.hypot(x[i] - x[a], y[i] - y[a]) + Math.hypot(x[b] - x[i], y[b] - y[i])) / 2;
    raw[i] = wrapAngle(h2 - h1) / dist;
  }
  return { offset, x, y, curvature: smoothClosed(raw, 2, 2) };
}

export interface PaceInputs {
  /** Car plus driver plus fuel, kg. */
  mass: number;
  /** Fractions of available grip the driver uses. */
  cornerGrip: number;
  brakeGrip: number;
}

/**
 * Target speed at every sample of the line for one car and driver: corner
 * limits from grip and downforce, then a backward pass for braking distance
 * and a forward pass for available acceleration.
 */
export function computeSpeedProfile(
  track: Track,
  line: RacingLine,
  spec: CarSpec,
  pace: PaceInputs,
): Float64Array {
  const n = track.n;
  const ds = track.ds;
  const m = pace.mass;
  const mu = (spec.tyre.muFront * spec.frontWeight + spec.tyre.muRear * (1 - spec.frontWeight)) * 0.94;
  const aeroPerV2 = (0.5 * AIR_DENSITY * spec.clA) / m;
  const dragPerV2 = (0.5 * AIR_DENSITY * spec.cdA) / m;
  const vMax = 105;

  const latLimit = (v: number): number => pace.cornerGrip * mu * (GRAVITY + aeroPerV2 * v * v);

  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const k = Math.abs(line.curvature[i]);
    const denom = k - pace.cornerGrip * mu * aeroPerV2;
    v[i] = denom > 1e-5 ? Math.min(vMax, Math.sqrt((pace.cornerGrip * mu * GRAVITY) / denom)) : vMax;
  }

  // Backward: never arrive faster than the brakes can shed before the next sample.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = v[(i + 1) % n];
      const total = pace.brakeGrip * mu * (GRAVITY + aeroPerV2 * next * next);
      // Trail braking is kept well inside the friction circle: the unloaded
      // rear axle cannot hold much cornering force under heavy braking.
      const lat = Math.min(total, (next * next * Math.abs(line.curvature[i])) / 0.9);
      const brakeCap = Math.min(spec.brakeForce / m, total - lat);
      const decel = brakeCap + dragPerV2 * next * next;
      v[i] = Math.min(v[i], Math.sqrt(next * next + 2 * decel * ds));
    }
  }

  // Forward: limited by engine, rear traction and what cornering leaves over.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const cur = v[i];
      const lat = cur * cur * Math.abs(line.curvature[i]);
      const u = Math.min(1, lat / latLimit(cur));
      const rearLoad = GRAVITY * (1 - spec.frontWeight) + aeroPerV2 * cur * cur * (1 - spec.aeroBalance) + 1.2;
      const traction = spec.tyre.muRear * rearLoad * Math.sqrt(1 - u * u) * 0.92;
      const drive = Math.min(maxDriveForce(spec, cur) / m, traction);
      const accel = drive - dragPerV2 * cur * cur - 0.012 * GRAVITY;
      const j = (i + 1) % n;
      if (accel > 0) v[j] = Math.min(v[j], Math.sqrt(cur * cur + 2 * accel * ds));
      else v[j] = Math.min(v[j], cur);
    }
  }
  return v;
}
