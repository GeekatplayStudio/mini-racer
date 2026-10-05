import * as THREE from 'three';
import type { BodyStyle, CarModel, Livery } from '../data/cars';
import { Mesher, digitCells, paintMaterial } from './mesher';

/** A drawable car: nose toward +x, y up. */
export interface CarVisual {
  root: THREE.Group;
  /** Tilts with acceleration for body roll and pitch. */
  chassis: THREE.Group;
  frontWheels: THREE.Object3D[];
  wheels: THREE.Object3D[];
  /** The part of each wheel that turns with the road, in the order of `wheels`. */
  rims: THREE.Object3D[];
  brakeLights: THREE.MeshBasicMaterial;
  /** Damage dressing per zone (front, rear, left, right): [scuffed, crumpled]. Hidden until hit. */
  dents: THREE.Object3D[][];
}

const GLASS = 0x1a2a3c;
const DARK = 0x16171d;
const CARBON = 0x24262e;
const GROUND_CLEARANCE = 0.14;
/** How far the top edge of the flank is cut back to the deck. */
const CHAMFER = 0.07;
const TYRE_WIDTH = 0.32;

/** Where the wheels sit along the car and how big an opening they need. */
export interface Axles {
  front: number;
  rear: number;
  wheelRadius: number;
}

export function axlesOf(length: number, wheelbase: number, frontWeight: number, wheelRadius: number): Axles {
  // Body centre and centre of mass are treated as coincident; axles sit around it.
  const front = Math.min(length / 2 - 0.75, wheelbase * (1 - frontWeight));
  return { front, rear: front - wheelbase, wheelRadius };
}

interface Station {
  /** 0 at the nose, 1 at the tail. */
  f: number;
  /** Half width as a fraction of the car's half width. */
  w: number;
  shoulder: number;
  roof: number;
  /** Roof half width as a fraction of the car's half width. */
  roofW: number;
  /** The panels from here to the next station: side glass, and glass over the top. */
  greenhouse: boolean;
  sloped: boolean;
}

/** The body's outline along its length, with the heights and widths in between. */
export interface BodyShape {
  length: number;
  half: number;
  stations: Station[];
  /** Section at any point along the car, 0 nose to 1 tail. */
  at(f: number): Station;
  /** A point on the flank at height y; side is -1 or 1, `out` lifts it off the panel. */
  flank(f: number, y: number, side: number, out?: number): THREE.Vector3;
  /** A point on top of the car at lateral position z (metres), lifted by `up`. */
  top(f: number, z: number, up?: number): THREE.Vector3;
}

function baseStations(b: BodyStyle): Station[] {
  const flat = (f: number, w: number, h: number): Station => ({ f, w, shoulder: h, roof: h + 0.05, roofW: w * 0.72, greenhouse: false, sloped: false });
  const cabin = (f: number, w: number, shoulder: number, roof: number): Station => ({ f, w, shoulder, roof, roofW: b.roofWidth, greenhouse: false, sloped: false });
  const screenTop = b.cabinStart + 0.13;
  const roofEnd = b.fastback ? b.cabinEnd - 0.2 : b.cabinEnd - 0.1;
  const rear = 1 + b.rearFlare;
  const list = [
    flat(0, 0.74, b.noseHeight * 0.72),
    flat(0.05, 0.93, b.noseHeight),
    flat(0.17, 1, b.hoodHeight * 0.93),
    flat(b.cabinStart, 1, b.hoodHeight),
    cabin(screenTop, 1, b.hoodHeight + 0.04, b.roofHeight),
    cabin(Math.max(screenTop + 0.05, roofEnd), rear, b.deckHeight, b.roofHeight - 0.02),
    flat(b.cabinEnd, rear, b.deckHeight),
    flat(0.94, rear, b.deckHeight - 0.02),
    flat(1, 0.9, b.deckHeight * 0.9),
  ];
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], c = list[i + 1];
    a.greenhouse = a.roof - a.shoulder > 0.2 || c.roof - c.shoulder > 0.2;
    a.sloped = Math.abs(a.roof - c.roof) > 0.2;
  }
  return list;
}

function sectionAt(list: readonly Station[], f: number): Station {
  let i = 0;
  while (i < list.length - 2 && list[i + 1].f <= f) i++;
  const a = list[i], c = list[i + 1];
  const t = THREE.MathUtils.clamp((f - a.f) / Math.max(1e-6, c.f - a.f), 0, 1);
  const mix = (x: number, y: number): number => x + (y - x) * t;
  return { f, w: mix(a.w, c.w), shoulder: mix(a.shoulder, c.shoulder), roof: mix(a.roof, c.roof), roofW: mix(a.roofW, c.roofW), greenhouse: a.greenhouse, sloped: a.sloped };
}

/** Works out the body's sections, with the wings swelling over each wheel. */
export function bodyShape(dims: { length: number; width: number }, body: BodyStyle, axles?: Axles): BodyShape {
  const { length, width } = dims;
  const half = width / 2;
  const base = baseStations(body);
  const stations = [...base];
  if (axles) {
    const peak = axles.wheelRadius * 2 + 0.1;
    const span = (axles.wheelRadius + 0.12) / length;
    for (const x of [axles.front, axles.rear]) {
      const fa = (length / 2 - x) / length;
      // Wing tops rise over the tyre and the arch stands a little proud of the flank.
      for (const [df, lift, flare] of [[-span, 0.08, 0.012], [0, 0, 0.034], [span, 0.08, 0.012]]) {
        const f = fa + df;
        if (f < 0.07 || f > 0.985) continue;
        const s = sectionAt(base, f);
        s.shoulder = Math.max(s.shoulder, Math.min(peak - lift, s.roof + 0.14));
        s.w += flare;
        const near = stations.findIndex((o) => Math.abs(o.f - f) < 0.012);
        if (near >= 0) {
          stations[near].shoulder = Math.max(stations[near].shoulder, s.shoulder);
          stations[near].w = Math.max(stations[near].w, s.w);
        } else {
          stations.push(s);
        }
      }
    }
    stations.sort((a, c) => a.f - c.f);
  }
  const at = (f: number): Station => sectionAt(stations, f);
  const xOf = (f: number): number => length / 2 - f * length;
  return {
    length,
    half,
    stations,
    at,
    flank(f, y, side, out = 0) {
      const s = at(f);
      const topY = s.shoulder - CHAMFER;
      const t = THREE.MathUtils.clamp((y - GROUND_CLEARANCE) / Math.max(0.01, topY - GROUND_CLEARANCE), 0, 1);
      return new THREE.Vector3(xOf(f), y, side * (s.w * half * (0.94 + 0.06 * t) + out));
    },
    top(f, z, up = 0) {
      const s = at(f);
      const rw = s.roofW * half;
      const sw = Math.min(0.2 * half, rw * 0.6);
      const az = Math.abs(z);
      // Crown, then the fall to the roof edge, then down to the deck edge.
      let y = s.roof + 0.015;
      if (az > sw) y = az < rw ? s.roof + 0.015 * (1 - (az - sw) / Math.max(1e-6, rw - sw)) : s.roof + (s.shoulder - s.roof) * Math.min(1, (az - rw) / Math.max(1e-6, s.w * half * 0.9 - rw));
      return new THREE.Vector3(xOf(f), y + up, z);
    },
  };
}

/** Section outline, left to right over the top: 10 points. */
function ring(shape: BodyShape, s: Station): THREE.Vector3[] {
  const x = shape.length / 2 - s.f * shape.length;
  const w = s.w * shape.half;
  const rw = s.roofW * shape.half;
  const sw = Math.min(0.2 * shape.half, rw * 0.6);
  const edge = Math.max(rw, w * 0.9);
  return [
    new THREE.Vector3(x, GROUND_CLEARANCE, -w * 0.94),
    new THREE.Vector3(x, s.shoulder - CHAMFER, -w),
    new THREE.Vector3(x, s.shoulder, -edge),
    new THREE.Vector3(x, s.roof, -rw),
    new THREE.Vector3(x, s.roof + 0.015, -sw),
    new THREE.Vector3(x, s.roof + 0.015, sw),
    new THREE.Vector3(x, s.roof, rw),
    new THREE.Vector3(x, s.shoulder, edge),
    new THREE.Vector3(x, s.shoulder - CHAMFER, w),
    new THREE.Vector3(x, GROUND_CLEARANCE, w * 0.94),
  ];
}

/**
 * Lofts the body shell through the sections with per-face colours: paint into
 * one mesher, glazing into another. Wheel arches are cut out of the flanks.
 */
export function buildShell(shape: BodyShape, livery: Livery, paint: Mesher, glazing: Mesher, axles?: Axles, glassColor = GLASS): void {
  const stations = shape.stations;
  const base = new THREE.Color(livery.base);
  const accent = new THREE.Color(livery.accent);
  const glass = new THREE.Color(glassColor);
  const dark = new THREE.Color(DARK);
  const sill = base.clone().multiplyScalar(0.72);
  const deck = base.clone().multiplyScalar(0.93);
  const lip = new THREE.Color(CARBON);
  const archR = axles ? axles.wheelRadius + 0.075 : 0;

  const rings = stations.map((s) => ring(shape, s));
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i];
    const ra = rings[i], rb = rings[i + 1];
    for (let e = 1; e < 8; e++) {
      let color = base;
      let target = paint;
      if (e === 1 || e === 7) color = deck;
      else if (e === 2 || e === 6) {
        if (a.greenhouse) {
          color = glass;
          target = glazing;
        }
      } else if (a.sloped) {
        color = glass;
        target = glazing;
      } else if (e === 4) color = accent;
      target.quad(ra[e], rb[e], rb[e + 1], ra[e + 1], color);
    }
    // Underside.
    paint.quad(ra[9], rb[9], rb[0], ra[0], dark);

    // Flanks, in strips so the wheel arches can be cut out of them.
    for (const [bottom, top, side] of [[0, 1, -1], [9, 8, 1]] as const) {
      const x0 = ra[bottom].x, x1 = rb[bottom].x;
      const cuts = [0, 1];
      const steps = Math.max(1, Math.ceil(Math.abs(x1 - x0) / 0.1));
      for (let k = 1; k < steps; k++) cuts.push(k / steps);
      if (axles) {
        for (const ax of [axles.front, axles.rear]) {
          for (const edge of [ax - archR, ax + archR]) {
            const t = (edge - x0) / (x1 - x0);
            if (t > 0.001 && t < 0.999) cuts.push(t);
          }
        }
      }
      cuts.sort((p, q) => p - q);
      for (let k = 0; k < cuts.length - 1; k++) {
        const t0 = cuts[k], t1 = cuts[k + 1];
        if (t1 - t0 < 1e-5) continue;
        const mid = x0 + (x1 - x0) * (t0 + t1) / 2;
        const axle = axles ? [axles.front, axles.rear].find((ax) => Math.abs(mid - ax) < archR) : undefined;
        const corner = (t: number): [THREE.Vector3, THREE.Vector3] => {
          const lo = ra[bottom].clone().lerp(rb[bottom], t);
          const hi = ra[top].clone().lerp(rb[top], t);
          if (axle === undefined || !axles) return [lo, hi];
          const dx = lo.x - axle;
          const cut = axles.wheelRadius + Math.sqrt(Math.max(0, archR * archR - dx * dx));
          const u = THREE.MathUtils.clamp((cut - lo.y) / Math.max(0.01, hi.y - lo.y), 0, 0.93);
          return [lo.lerp(hi, u), hi];
        };
        const [lo0, hi0] = corner(t0);
        const [lo1, hi1] = corner(t1);
        paint.quad(lo0, hi0, hi1, lo1, base);
        if (axle !== undefined) {
          // The arch lip stands proud of the panel.
          const out = new THREE.Vector3(0, 0, side * 0.05);
          const up = new THREE.Vector3(0, 0.035, 0);
          paint.quad(lo0, lo0.clone().add(out), lo1.clone().add(out), lo1, lip);
          paint.quad(lo0.clone().add(out), lo0.clone().add(out).add(up), lo1.clone().add(out).add(up), lo1.clone().add(out), lip);
        }
      }
    }
  }
  // Close the nose and tail.
  for (const [r, color] of [[rings[0], base], [rings[rings.length - 1], sill]] as const) {
    for (let e = 1; e < 9; e++) paint.tri(r[0], r[e], r[e + 1], color);
  }

  // Sun strip across the top of the windscreen.
  const screen = stations.findIndex((s) => s.sloped);
  if (screen >= 0) {
    const ra = rings[screen], rb = rings[screen + 1];
    const lift = new THREE.Vector3(0.01, 0.012, 0);
    const p = (k: number, t: number): THREE.Vector3 => ra[k].clone().lerp(rb[k], t).add(lift);
    for (let k = 3; k < 6; k++) paint.quad(p(k, 0.7), p(k, 1), p(k + 1, 1), p(k + 1, 0.7), accent);
  }
}

/** Light clusters differ from car to car: 0 slim bars, 1 paired lamps, 2 upright blades. */
function lightStyle(body: BodyStyle): number {
  return Math.round(body.noseHeight * 100 + body.roofHeight * 100 + body.cabinStart * 100) % 3;
}

/** Head and tail lamps as two small geometries, so each can glow in its own colour. */
export function buildLights(dims: { length: number; width: number }, body: BodyStyle): { head: THREE.BufferGeometry; tail: THREE.BufferGeometry } {
  const L = dims.length, W = dims.width;
  const head = new Mesher();
  const tail = new Mesher();
  const style = lightStyle(body);
  const white = 0xffffff;
  const hx = L / 2 - 0.2, hy = body.noseHeight + 0.02;
  const tx = -L / 2 - 0.012, ty = body.deckHeight * 0.76;
  for (const s of [-1, 1]) {
    if (style === 0) {
      head.box(0.12, 0.07, 0.44, white, hx, hy, s * W * 0.33, 0, s * 0.18, 0);
      head.box(0.05, 0.04, 0.2, white, L / 2 - 0.03, body.noseHeight * 0.42, s * W * 0.3);
    } else if (style === 1) {
      head.box(0.13, 0.1, 0.16, white, hx, hy, s * W * 0.38);
      head.box(0.13, 0.1, 0.16, white, hx + 0.03, hy, s * W * 0.27);
    } else {
      head.box(0.3, 0.07, 0.12, white, hx - 0.08, hy + 0.01, s * W * 0.39, 0, s * 0.12, 0);
      head.box(0.06, 0.05, 0.3, white, L / 2 - 0.05, body.noseHeight * 0.55, s * W * 0.26);
    }
    if (body.fastback) {
      tail.box(0.07, 0.07, W * 0.3, white, tx, ty, s * W * 0.27);
    } else if (style === 1) {
      tail.box(0.07, 0.12, 0.14, white, tx, ty, s * W * 0.36);
      tail.box(0.07, 0.12, 0.14, white, tx, ty, s * W * 0.25);
    } else {
      tail.box(0.07, 0.2, 0.1, white, tx, ty - 0.02, s * W * 0.38);
      tail.box(0.07, 0.06, 0.3, white, tx, ty + 0.05, s * W * 0.25);
    }
  }
  // A full-width light bar joins the lamps on a fastback.
  if (body.fastback) tail.box(0.06, 0.03, W * 0.3, white, tx, ty, 0);
  return { head: head.build(), tail: tail.build() };
}

export interface DressOptions {
  /** Splitter, diffuser, wing and bonnet vents; the garage fits its own. */
  aero: boolean;
  /** Dark floor and a driver at the wheel, for a car with nothing inside it. */
  crew: boolean;
  /** Mirrors on the doors. */
  mirrors: boolean;
}

/** Everything fixed to the shell that is not the shell: trim, numbers, aero and the driver. */
export function dressBody(m: Mesher, shape: BodyShape, body: BodyStyle, livery: Livery, axles: Axles, o: DressOptions): void {
  const L = shape.length, half = shape.half, W = half * 2;
  const xOf = (f: number): number => L / 2 - f * L;
  const fOf = (x: number): number => (L / 2 - x) / L;
  const base = new THREE.Color(livery.base);
  const accent = new THREE.Color(livery.accent);
  const seam = base.clone().multiplyScalar(0.4);
  const white = new THREE.Color(0xf4f4f0);
  const ink = new THREE.Color(0x16171d);
  const number = String(livery.number);
  const archR = axles.wheelRadius + 0.075;
  const frontEngined = body.cabinStart > 0.35;

  // Sills and a stripe along the flank between the wheels.
  const fDoor0 = fOf(axles.front - archR - 0.06), fDoor1 = fOf(axles.rear + archR + 0.06);
  for (const s of [-1, 1]) {
    const band = (y0: number, y1: number, colour: THREE.Color, out: number): void => {
      const steps = 4;
      for (let k = 0; k < steps; k++) {
        const fa = fDoor0 + ((fDoor1 - fDoor0) * k) / steps, fb = fDoor0 + ((fDoor1 - fDoor0) * (k + 1)) / steps;
        m.quad(shape.flank(fa, y0, s, out), shape.flank(fa, y1, s, out), shape.flank(fb, y1, s, out), shape.flank(fb, y0, s, out), colour);
      }
    };
    band(GROUND_CLEARANCE + 0.1, GROUND_CLEARANCE + 0.17, accent, 0.007);
    m.box((fDoor1 - fDoor0) * L, 0.075, 0.07, CARBON, (xOf(fDoor0) + xOf(fDoor1)) / 2, GROUND_CLEARANCE + 0.03, s * (half * 0.96 + 0.02));

    // Door shut lines.
    const doorFront = Math.max(body.cabinStart + 0.035, fDoor0 + 0.02);
    const doorBack = Math.min(body.cabinEnd - 0.07, fDoor1 - 0.015);
    for (const f of [doorFront, doorBack]) {
      const top = shape.at(f).shoulder - CHAMFER - 0.02;
      m.quad(shape.flank(f - 0.003, GROUND_CLEARANCE + 0.2, s, 0.006), shape.flank(f - 0.003, top, s, 0.006), shape.flank(f + 0.003, top, s, 0.006), shape.flank(f + 0.003, GROUND_CLEARANCE + 0.2, s, 0.006), seam);
    }

    // Number roundel on the door.
    const fMid = (doorFront + doorBack) / 2;
    const sideTop = shape.at(fMid).shoulder - CHAMFER;
    const cy = GROUND_CLEARANCE + (sideTop - GROUND_CLEARANCE) * 0.6;
    const r = Math.min(0.25, (sideTop - GROUND_CLEARANCE) * 0.36, ((doorBack - doorFront) * L) / 2 - 0.05);
    if (r > 0.1) {
      const centre = shape.flank(fMid, cy, s, 0.008);
      const rim: THREE.Vector3[] = [];
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
        rim.push(shape.flank(fMid - (Math.cos(a) * r) / L, cy + Math.sin(a) * r, s, 0.008));
      }
      for (let k = 0; k < 8; k++) m.tri(centre, rim[k], rim[(k + 1) % 8], white);
      const cell = (r * 1.25) / Math.max(5, digitCells(number));
      // Read from outside the car: left to right is tail to nose on one side, nose to tail on the other.
      const right = new THREE.Vector3(s * cell, 0, 0);
      const up = shape.flank(fMid, cy + 1, s).sub(shape.flank(fMid, cy, s)).normalize().multiplyScalar(cell);
      const origin = shape.flank(fMid, cy, s, 0.014).addScaledVector(right, -digitCells(number) / 2).addScaledVector(up, -2.5);
      m.digits(number, origin, right, up, ink);
    }

    if (o.mirrors) {
      const mx = xOf(body.cabinStart + 0.06), my = body.hoodHeight + 0.15;
      m.box(0.06, 0.04, 0.16, CARBON, mx, my - 0.03, s * (half - 0.02));
      m.box(0.13, 0.1, 0.2, base, mx, my, s * (half + 0.07));
      m.box(0.02, 0.07, 0.16, 0x9fb4c8, mx - 0.07, my, s * (half + 0.07));
    }
  }

  // Number panel on the longest flat part of the top: roof, bonnet or engine cover.
  const screenTop = body.cabinStart + 0.13;
  const roofEnd = Math.max(screenTop + 0.05, body.fastback ? body.cabinEnd - 0.2 : body.cabinEnd - 0.1);
  const spots: [number, number][] = [[screenTop + 0.01, roofEnd - 0.01], [0.19, body.cabinStart - 0.03], [body.cabinEnd + 0.02, 0.9]];
  let spot = spots[0];
  if ((spot[1] - spot[0]) * L < 0.62) spot = spots.reduce((best, c) => (c[1] - c[0] > best[1] - best[0] ? c : best), spot);
  {
    const cells = digitCells(number);
    const len = Math.min(0.8, (spot[1] - spot[0]) * L);
    const fMid = (spot[0] + spot[1]) / 2;
    const cell = Math.min(len / 7, (shape.at(fMid).roofW * half * 1.5) / (cells + 2));
    const dz = ((cells + 2) * cell) / 2, df = (3.5 * cell) / L;
    const p = (f: number, z: number, up: number): THREE.Vector3 => shape.top(f, 0, up).setZ(z);
    m.quad(p(fMid - df, -dz, 0.014), p(fMid - df, dz, 0.014), p(fMid + df, dz, 0.014), p(fMid + df, -dz, 0.014), white);
    // Read from behind the car: the top of each digit points at the nose.
    const lo = p(fMid + (2.5 * cell) / L, 0, 0.024), hi = p(fMid - (2.5 * cell) / L, 0, 0.024);
    const up = hi.clone().sub(lo).divideScalar(5);
    m.digits(number, lo.clone().add(new THREE.Vector3(0, 0, (-cells * cell) / 2)), new THREE.Vector3(0, 0, cell), up, ink);
  }

  // Tow eyes and the grille.
  m.box(0.1, 0.05, 0.06, 0xd8232a, L / 2 + 0.03, GROUND_CLEARANCE + 0.1, half * 0.42);
  m.box(0.1, 0.05, 0.06, 0xd8232a, -L / 2 - 0.03, GROUND_CLEARANCE + 0.2, -half * 0.5);
  m.box(0.05, body.noseHeight * 0.3, W * 0.4, DARK, L / 2 - 0.005, GROUND_CLEARANCE + body.noseHeight * 0.26, 0);
  for (const s of [-1, 1]) m.box(0.05, body.noseHeight * 0.2, W * 0.1, DARK, L / 2 - 0.03, GROUND_CLEARANCE + body.noseHeight * 0.22, s * W * 0.3);
  // Rear number plate recess and exhaust tips.
  m.box(0.03, 0.12, 0.42, DARK, -L / 2 - 0.004, body.deckHeight * 0.5, 0);
  const pipes = frontEngined ? [-0.46, -0.3, 0.3, 0.46] : [-0.1, 0.1];
  for (const z of pipes) {
    m.cyl(0.055, 0.055, 0.16, 7, 0xb8bcc8, -L / 2 - 0.02, GROUND_CLEARANCE + (frontEngined ? 0.16 : 0.3), z * half, 'x', true);
  }

  if (o.aero) {
    // Splitter with end fences, and dive planes on the corners.
    m.box(0.5, 0.05, W * 0.96, DARK, L / 2 - 0.1, GROUND_CLEARANCE - 0.01, 0);
    for (const s of [-1, 1]) {
      m.box(0.34, 0.11, 0.03, accent, L / 2 - 0.02, GROUND_CLEARANCE + 0.04, s * W * 0.475);
      m.box(0.3, 0.02, 0.16, CARBON, L / 2 - 0.3, body.noseHeight * 0.62, s * (half * 0.9 + 0.05), 0, 0, 0.3);
    }
    // Diffuser with strakes.
    m.box(0.45, 0.2, W * 0.8, DARK, -L / 2 + 0.1, GROUND_CLEARANCE + 0.1, 0);
    for (const z of [-0.33, -0.12, 0.12, 0.33]) m.box(0.5, 0.17, 0.03, 0x3a3e4c, -L / 2 + 0.06, GROUND_CLEARANCE + 0.075, z * W);

    // Rear wing: plane with a gurney, end plates and swan-neck mounts.
    const wingX = -L / 2 + 0.22;
    const wingW = W * 0.94;
    m.box(0.46, 0.05, wingW, accent, wingX, body.wingHeight, 0, 0, 0, -0.07);
    m.box(0.04, 0.06, wingW, DARK, wingX - 0.23, body.wingHeight + 0.04, 0);
    for (const s of [-1, 1]) {
      m.box(0.58, 0.32, 0.05, base, wingX, body.wingHeight - 0.07, (s * wingW) / 2);
      m.box(0.3, 0.05, 0.055, accent, wingX + 0.04, body.wingHeight - 0.15, (s * wingW) / 2);
      const z = s * W * 0.22;
      m.bar(new THREE.Vector3(wingX + 0.34, body.deckHeight, z), new THREE.Vector3(wingX + 0.22, body.wingHeight + 0.12, z), 0.06, DARK);
      m.bar(new THREE.Vector3(wingX + 0.22, body.wingHeight + 0.12, z), new THREE.Vector3(wingX + 0.02, body.wingHeight + 0.03, z), 0.06, DARK);
    }

    // Louvres over the engine: on the bonnet, or on the cover behind the cabin.
    const [v0, v1] = frontEngined ? [0.2, body.cabinStart - 0.05] : [body.cabinEnd + 0.04, 0.9];
    const slats = Math.min(4, Math.max(2, Math.floor(((v1 - v0) * L) / 0.16)));
    for (let k = 0; k < slats; k++) {
      const f = v0 + ((v1 - v0) * (k + 0.5)) / slats;
      const s0 = shape.at(f);
      const z = s0.roofW * half * (frontEngined ? 0.78 : 0.8);
      for (const s of [-1, 1]) {
        const c = shape.top(f, s * z, 0.012);
        m.box(0.07, 0.02, half * 0.26, DARK, c.x, c.y, c.z);
      }
    }
    // Roof scoop feeding a mid-mounted engine.
    if (!frontEngined) {
      const f = roofEnd - 0.02;
      const c = shape.top(f, 0, 0.05);
      m.box(0.42, 0.1, 0.3, base, c.x - 0.05, c.y, 0);
      m.box(0.03, 0.07, 0.24, DARK, c.x + 0.165, c.y, 0);
    }
  }

  if (o.crew) {
    const x0 = xOf(body.cabinStart), x1 = xOf(body.cabinEnd);
    const tubY = body.hoodHeight - 0.02;
    // Floor of the cabin and whatever would otherwise show through the arches.
    m.box(L * 0.9, 0.34, W - 0.72, 0x0e0f14, 0, GROUND_CLEARANCE + 0.18, 0);
    m.box(x0 - x1 - 0.1, 0.06, W * 0.84, CARBON, (x0 + x1) / 2, tubY, 0);
    m.box(0.16, 0.12, W * 0.74, 0x101116, x0 - 0.12, tubY + 0.08, 0);
    // Roll hoop behind the seats.
    const hoopX = xOf(roofEnd) + 0.12, hoopY = body.roofHeight - 0.1, hoopZ = body.roofWidth * half * 0.8;
    for (const s of [-1, 1]) m.bar(new THREE.Vector3(hoopX, tubY, s * hoopZ * 1.1), new THREE.Vector3(hoopX, hoopY, s * hoopZ), 0.05, 0x5a606c);
    m.bar(new THREE.Vector3(hoopX, hoopY, -hoopZ), new THREE.Vector3(hoopX, hoopY, hoopZ), 0.05, 0x5a606c);
    // The driver: seat, shoulders, helmet and visor.
    const seatX = Math.min(xOf(screenTop) - 0.3, hoopX + 0.5), seatZ = -W * 0.18;
    const headY = Math.min(body.roofHeight - 0.2, tubY + 0.42);
    m.box(0.12, headY - tubY + 0.1, 0.4, 0x16171d, seatX - 0.2, (headY + tubY) / 2, seatZ);
    m.box(0.22, 0.2, 0.42, 0x2a2d38, seatX - 0.04, tubY + 0.12, seatZ);
    m.blob(0.15, 1, accent, seatX, headY, seatZ);
    m.box(0.1, 0.07, 0.24, 0x0c0e14, seatX + 0.1, headY + 0.01, seatZ);
    m.box(0.3, 0.035, 0.035, base, seatX + 0.02, headY + 0.13, seatZ);
    // Steering wheel.
    m.box(0.03, 0.2, 0.26, 0x16171d, seatX + 0.42, tubY + 0.16, seatZ);
  }
}

interface CarGeometry {
  body: THREE.BufferGeometry;
  glass: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  tail: THREE.BufferGeometry;
  dents: THREE.BufferGeometry[][];
  axles: Axles;
}

const geometryCache = new Map<string, CarGeometry>();
const rimMaterials = new Map<number, THREE.MeshLambertMaterial>();
let wheelParts: { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } | null = null;
let glassMaterial: THREE.MeshLambertMaterial | null = null;
let headMaterial: THREE.MeshBasicMaterial | null = null;

/** Tyre with a brake disc and caliper behind the spokes, and the rim itself; shared by every car. */
function wheelGeometry(radius: number): { tyre: THREE.BufferGeometry; rim: THREE.BufferGeometry } {
  if (wheelParts) return wheelParts;
  const tyre = new Mesher();
  tyre.cyl(radius, radius, TYRE_WIDTH, 12, 0x1b1c22, 0, 0, 0, 'z');
  // Sidewall step, so the tyre does not read as a plain disc.
  for (const s of [-1, 1]) tyre.cyl(radius * 0.8, radius * 0.94, 0.03, 12, 0x2c2e38, 0, 0, s * (TYRE_WIDTH / 2 + 0.01), 'z', true);
  tyre.cyl(radius * 0.52, radius * 0.52, TYRE_WIDTH - 0.08, 10, 0x8a8f9c, 0, 0, 0, 'z');
  tyre.cyl(radius * 0.67, radius * 0.67, TYRE_WIDTH - 0.02, 10, 0x0e0f14, 0, 0, 0, 'z', true);
  for (const s of [-1, 1]) tyre.box(0.16, 0.1, 0.05, 0xd8232a, -radius * 0.34, radius * 0.3, s * (TYRE_WIDTH / 2 - 0.05), 0, 0, 0.75);
  const rim = new Mesher();
  for (const s of [-1, 1]) {
    const z = s * (TYRE_WIDTH / 2 - 0.005);
    rim.cyl(radius * 0.7, radius * 0.62, 0.03, 10, 0xffffff, 0, 0, z, 'z', true);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      rim.box(radius * 0.62, 0.05, 0.03, 0xffffff, Math.cos(a) * radius * 0.33, Math.sin(a) * radius * 0.33, z, 0, 0, a);
    }
    rim.cyl(radius * 0.17, radius * 0.17, 0.05, 6, 0xb0b0b0, 0, 0, z, 'z');
  }
  wheelParts = { tyre: tyre.build(), rim: rim.build() };
  return wheelParts;
}

function carGeometry(model: CarModel, livery: Livery): CarGeometry {
  const { spec, body } = model;
  const key = `${spec.length}|${spec.width}|${spec.wheelbase}|${spec.frontWeight}|${spec.wheelRadius}|${JSON.stringify(body)}|${livery.base}|${livery.accent}|${livery.number}`;
  const cached = geometryCache.get(key);
  if (cached) return cached;

  const L = spec.length, W = spec.width;
  const axles = axlesOf(L, spec.wheelbase, spec.frontWeight, spec.wheelRadius);
  const shape = bodyShape(spec, body, axles);
  const paint = new Mesher();
  const glazing = new Mesher();
  buildShell(shape, livery, paint, glazing, axles);
  dressBody(paint, shape, body, livery, axles, { aero: true, crew: true, mirrors: true });
  const lights = buildLights(spec, body);

  // Damage dressing: scraped paint first, then bent and hanging panels.
  const scuff = 0x24252b, bare = 0x8a8d96;
  const dents: THREE.BufferGeometry[][] = [];
  const dress = (build: (light: Mesher, heavy: Mesher) => void): void => {
    const light = new Mesher(), heavy = new Mesher();
    build(light, heavy);
    dents.push([light.build(), heavy.build()]);
  };
  const nose = L / 2, tail = -L / 2;
  const wingX = -L / 2 + 0.22;
  dress((light, heavy) => {
    light.box(0.14, 0.2, W * 0.5, scuff, nose - 0.04, body.noseHeight * 0.7, W * 0.12, 0, 0.12, 0);
    light.box(0.1, 0.08, W * 0.22, bare, nose - 0.02, body.noseHeight * 0.9, -W * 0.24);
    heavy.box(0.9, 0.05, W * 0.62, livery.base, nose - 0.75, body.hoodHeight + 0.14, 0.05, 0, 0, -0.32);
    heavy.box(0.3, 0.26, W * 0.8, scuff, nose - 0.02, body.noseHeight * 0.6, 0, 0, -0.1, 0);
    heavy.box(0.5, 0.05, W * 0.5, DARK, nose + 0.08, 0.07, -W * 0.2, 0, 0.5, 0.12);
  });
  dress((light, heavy) => {
    light.box(0.12, 0.22, W * 0.5, scuff, tail + 0.02, body.deckHeight * 0.6, -W * 0.14, 0, -0.1, 0);
    heavy.box(0.3, 0.3, W * 0.84, scuff, tail + 0.04, body.deckHeight * 0.55, 0, 0, 0.08, 0);
    heavy.box(0.4, 0.14, W * 0.6, DARK, tail - 0.1, 0.12, W * 0.16, 0, -0.45, -0.18);
    heavy.box(0.3, 0.04, W * 0.4, bare, wingX, body.wingHeight + 0.05, W * 0.3, 0.3, 0.2, 0);
  });
  for (const s of [1, -1]) {
    dress((light, heavy) => {
      const z = s * (W / 2 + 0.03);
      light.box(L * 0.3, 0.16, 0.05, scuff, 0.2, body.hoodHeight * 0.62, z);
      light.box(L * 0.16, 0.05, 0.05, bare, -0.5, body.hoodHeight * 0.45, z);
      heavy.box(L * 0.34, 0.32, 0.07, scuff, -0.05, body.hoodHeight * 0.58, z, 0, s * 0.03, 0);
      heavy.box(0.7, 0.3, 0.05, livery.base, 0.75, body.hoodHeight * 0.6, z + s * 0.08, 0, s * 0.2, 0);
    });
  }

  const made = { body: paint.build(), glass: glazing.build(), head: lights.head, tail: lights.tail, dents, axles };
  geometryCache.set(key, made);
  return made;
}

/** Tinted, see-through glazing shared by every race car. */
export function glassMaterialFor(color = GLASS, opacity = 0.62): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ color, flatShading: true, side: THREE.DoubleSide, transparent: true, opacity });
}

export function buildCarVisual(model: CarModel, livery: Livery, rimColor = 0xb8bcc8): CarVisual {
  const { spec } = model;
  const W = spec.width;
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const geo = carGeometry(model, livery);
  const paint = paintMaterial();
  const shell = new THREE.Mesh(geo.body, paint);
  shell.castShadow = true;
  chassis.add(shell);
  glassMaterial ??= glassMaterialFor();
  chassis.add(new THREE.Mesh(geo.glass, glassMaterial));

  // Lights.
  headMaterial ??= new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  const brakeLights = new THREE.MeshBasicMaterial({ color: 0x5a0c10 });
  chassis.add(new THREE.Mesh(geo.head, headMaterial), new THREE.Mesh(geo.tail, brakeLights));

  // Wheels.
  const parts = wheelGeometry(spec.wheelRadius);
  let rimMat = rimMaterials.get(rimColor);
  if (!rimMat) {
    rimMat = new THREE.MeshLambertMaterial({ color: rimColor, vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    rimMaterials.set(rimColor, rimMat);
  }
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  const rims: THREE.Object3D[] = [];
  for (const [x, front] of [[geo.axles.front, true], [geo.axles.rear, false]] as const) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Group();
      const turning = new THREE.Group();
      const tyre = new THREE.Mesh(parts.tyre, paint);
      tyre.castShadow = true;
      turning.add(new THREE.Mesh(parts.rim, rimMat));
      wheel.add(tyre, turning);
      // Rear wheels sit out under the wider rear arches.
      const flare = front ? 0 : model.body.rearFlare * (W / 2);
      wheel.position.set(x, spec.wheelRadius, s * (W / 2 + flare - TYRE_WIDTH / 2 + 0.005));
      root.add(wheel);
      wheels.push(wheel);
      rims.push(turning);
      if (front) frontWheels.push(wheel);
    }
  }

  const dents = geo.dents.map((levels) =>
    levels.map((g) => {
      const mesh = new THREE.Mesh(g, paint);
      mesh.castShadow = true;
      mesh.visible = false;
      chassis.add(mesh);
      return mesh as THREE.Object3D;
    }),
  );

  return { root, chassis, frontWheels, wheels, rims, brakeLights, dents };
}
