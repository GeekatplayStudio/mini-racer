import * as THREE from 'three';
import { RacingLine } from '../sim/line';
import type { Weather } from '../sim/race';
import { Rng } from '../sim/rng';
import { KERB_WIDTH, PIT_BOXES, Track } from '../sim/track';
import { Mesher, paintMaterial } from './mesher';
import {
  asphaltTexture,
  checkerTexture,
  crowdTexture,
  grassTexture,
  gravelTexture,
  paddockTexture,
  pitBuildingTexture,
  snowGrassTexture,
} from './textures';

export interface TrackScene {
  group: THREE.Group;
  /** Materials of the five start lights, first to last. */
  startLights: THREE.MeshBasicMaterial[];
}

const UP = 1;

class StripBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly colors: number[] = [];

  quad(
    a: THREE.Vector3Tuple,
    b: THREE.Vector3Tuple,
    c: THREE.Vector3Tuple,
    d: THREE.Vector3Tuple,
    color?: THREE.Color,
    alpha = 1,
    uv?: readonly [number, number, number, number, number, number, number, number],
  ): void {
    // Two triangles: a-b-c and b-d-c.
    this.positions.push(...a, ...b, ...c, ...b, ...d, ...c);
    for (let i = 0; i < 6; i++) this.normals.push(0, UP, 0);
    if (color) for (let i = 0; i < 6; i++) this.colors.push(color.r, color.g, color.b, alpha);
    if (uv) {
      this.uvs.push(uv[0], uv[1], uv[2], uv[3], uv[4], uv[5], uv[2], uv[3], uv[6], uv[7], uv[4], uv[5]);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    if (this.uvs.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (this.colors.length) g.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 4));
    return g;
  }
}

function at(track: Track, i: number, d: number, y: number): THREE.Vector3Tuple {
  return [track.x[i] + track.nx[i] * d, y, track.y[i] + track.ny[i] * d];
}

interface RibbonOptions {
  d0: (i: number) => number;
  d1: (i: number) => number;
  y: number;
  include?: (i: number) => boolean;
  color?: (i: number) => THREE.Color;
  alpha?: (i: number) => number;
  /** World metres per texture repeat; omit for untextured ribbons. */
  uvScale?: number;
}

/** A flat band following the track between two lateral offsets. */
function ribbon(track: Track, o: RibbonOptions): THREE.BufferGeometry {
  const sb = new StripBuilder();
  const n = track.n;
  for (let i = 0; i < n; i++) {
    if (o.include && !o.include(i)) continue;
    const j = (i + 1) % n;
    const a0 = o.d0(i), a1 = o.d1(i), b0 = o.d0(j), b1 = o.d1(j);
    const lo0 = Math.min(a0, a1), hi0 = Math.max(a0, a1);
    const lo1 = Math.min(b0, b1), hi1 = Math.max(b0, b1);
    let uv: [number, number, number, number, number, number, number, number] | undefined;
    if (o.uvScale) {
      const s0 = (i * track.ds) / o.uvScale;
      const s1 = ((i + 1) * track.ds) / o.uvScale;
      uv = [lo0 / o.uvScale, s0, hi0 / o.uvScale, s0, lo1 / o.uvScale, s1, hi1 / o.uvScale, s1];
    }
    sb.quad(
      at(track, i, lo0, o.y),
      at(track, i, hi0, o.y),
      at(track, j, lo1, o.y),
      at(track, j, hi1, o.y),
      o.color?.(i),
      o.alpha?.(i) ?? 1,
      uv,
    );
  }
  return sb.build();
}

function lambert(params: THREE.MeshLambertMaterialParameters): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial(params);
}

/** Flat-shaded, double-sided material for props built without caring about winding. */
function propMaterial(params: THREE.MeshLambertMaterialParameters = {}): THREE.MeshLambertMaterial {
  return new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide, ...params });
}

function box(
  w: number, h: number, d: number, color: number, x: number, y: number, z: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert({ color }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Puts an object beside the track: local x runs along it, local z points away from it. */
function placeBeside(obj: THREE.Object3D, track: Track, s: number, side: number, dist: number): void {
  const [x, z] = track.pointAt(s, side === 1 ? dist : -dist);
  obj.position.set(x, 0, z);
  obj.rotation.y = -track.heading[track.indexAt(s)] + (side === 0 ? Math.PI : 0);
}

export function buildTrackScene(track: Track, line: RacingLine, weather: Weather = 'clear'): TrackScene {
  const group = new THREE.Group();
  const hw = track.halfWidth;
  const n = track.n;
  const white = new THREE.Color(0xf2f2ec);
  const red = new THREE.Color(0xd63a34);

  // Ground.
  const snow = weather === 'snow';
  const rain = weather === 'rain';
  const grassTex = snow ? snowGrassTexture() : grassTexture();
  let reach = 0;
  for (let i = 0; i < n; i++) reach = Math.max(reach, Math.abs(track.x[i]), Math.abs(track.y[i]));
  const groundSize = Math.ceil((reach * 2 + 900) / 16) * 16;
  grassTex.repeat.set(groundSize / 16, groundSize / 16);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize), lambert({ map: grassTex, color: rain ? 0xbcc8bc : 0xffffff }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Gravel traps.
  const gravelMat = lambert({ map: gravelTexture(), color: snow ? 0xeef2f8 : rain ? 0xb4b0a8 : 0xffffff, emissive: snow ? 0x3a4048 : 0x000000 });
  for (let side = 0; side < 2; side++) {
    const sign = side === 1 ? 1 : -1;
    const mesh = new THREE.Mesh(
      ribbon(track, {
        d0: () => sign * (hw + 2.5),
        d1: (i) => sign * (track.wall[side][i] - 0.4),
        y: 0.012,
        include: (i) => track.gravel[side][i] === 1 && track.gravel[side][(i + 1) % n] === 1,
        uvScale: 8,
      }),
      gravelMat,
    );
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Asphalt.
  const road = new THREE.Mesh(
    ribbon(track, { d0: () => -hw - 0.35, d1: () => hw + 0.35, y: 0.024, uvScale: 16 }),
    // Wet tarmac is darker and cooler.
    lambert({ map: asphaltTexture(), color: rain ? 0x8e96a4 : snow ? 0xc0c6d2 : 0xffffff }),
  );
  road.receiveShadow = true;
  group.add(road);

  if (snow) {
    // A thin layer settles where the cars do not run; the racing line stays dark.
    for (const sign of [-1, 1]) {
      const dust = new THREE.Mesh(
        ribbon(track, {
          d0: (i) => (sign < 0 ? -hw - 0.3 : line.offset[i] + 2.4),
          d1: (i) => (sign < 0 ? line.offset[i] - 2.4 : hw + 0.3),
          y: 0.031,
          include: (i) => (sign < 0 ? line.offset[i] - 2.4 > -hw : line.offset[i] + 2.4 < hw),
          color: () => new THREE.Color(0xeef2f8),
          alpha: () => 0.3,
        }),
        new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
      );
      group.add(dust);
    }
  }

  // Rubbered-in racing line, darkest through the corners.
  const rubber = new THREE.Mesh(
    ribbon(track, {
      d0: (i) => line.offset[i] - 1.5,
      d1: (i) => line.offset[i] + 1.5,
      y: 0.034,
      color: () => new THREE.Color(0x101014),
      alpha: (i) => 0.1 + Math.min(0.26, Math.abs(line.curvature[i]) * 22),
    }),
    new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }),
  );
  group.add(rubber);

  // White edge lines.
  for (const sign of [-1, 1]) {
    const edge = new THREE.Mesh(
      ribbon(track, { d0: () => sign * (hw - 0.28), d1: () => sign * (hw - 0.06), y: 0.04, color: () => white }),
      lambert({ vertexColors: true }),
    );
    edge.receiveShadow = true;
    group.add(edge);
  }

  // Red and white kerbs.
  for (let side = 0; side < 2; side++) {
    const sign = side === 1 ? 1 : -1;
    const kerb = new THREE.Mesh(
      ribbon(track, {
        d0: () => sign * hw,
        d1: () => sign * (hw + KERB_WIDTH),
        y: 0.05,
        include: (i) => track.kerb[side][i] === 1,
        color: (i) => (i % 2 === 0 ? red : white),
      }),
      lambert({ vertexColors: true }),
    );
    kerb.receiveShadow = true;
    group.add(kerb);
  }

  group.add(buildPitLane(track));
  group.add(buildStartLine(track));
  group.add(buildBarriers(track));

  const { gantry, lights } = buildStartGantry(track);
  group.add(gantry);

  const keepOut: { x: number; z: number; r: number }[] = [];
  group.add(buildPits(track, keepOut));
  group.add(buildGrandstands(track, keepOut));
  group.add(buildAdBoards(track));
  group.add(buildMarshalPosts(track));
  group.add(buildTrees(track, keepOut, snow));

  return { group, startLights: lights };
}

/** Through lane and numbered boxes on the pit side of the start straight. */
function buildPitLane(track: Track): THREE.Group {
  const g = new THREE.Group();
  const pit = track.pit;
  const sign = pit.side === 1 ? 1 : -1;
  const hw = track.halfWidth;
  const L = track.length;
  const inZone = (i: number): boolean => {
    const s = i * track.ds;
    return s >= pit.sIn - 24 || s <= pit.sOut + 24;
  };
  const tex = paddockTexture();
  const lane = new THREE.Mesh(
    ribbon(track, { d0: () => sign * (hw + 0.3), d1: (i) => sign * (track.wall[pit.side][i] - 0.5), y: 0.02, include: inZone, uvScale: 8 }),
    lambert({ map: tex }),
  );
  lane.receiveShadow = true;
  g.add(lane);
  const white = new THREE.Color(0xf2f2ec);
  const yellow = new THREE.Color(0xf0c020);
  const mark = (d0: number, d1: number, color: THREE.Color, from: number, to: number): void => {
    const mesh = new THREE.Mesh(
      ribbon(track, { d0: () => sign * d0, d1: () => sign * d1, y: 0.036, color: () => color, include: (i) => {
        const s = i * track.ds;
        return s >= from || s <= to;
      } }),
      lambert({ vertexColors: true }),
    );
    mesh.receiveShadow = true;
    g.add(mesh);
  };
  mark(hw + 2.1, hw + 2.3, white, pit.sIn + 30, pit.sOut - 30);
  mark(pit.offset + 2.2, pit.offset + 2.4, yellow, L - 190, 20);
  // Box brackets.
  const sb = new StripBuilder();
  for (let k = 0; k < PIT_BOXES; k++) {
    const s = track.pitBox(k);
    const d0 = pit.offset + 2.5, d1 = pit.offset + 6.2;
    const p = (ss: number, d: number): THREE.Vector3Tuple => {
      const [x, z] = track.pointAt(ss, sign * d);
      return [x, 0.037, z];
    };
    for (const e of [-3.2, 3.0]) sb.quad(p(s + e, d0), p(s + e, d1), p(s + e + 0.2, d0), p(s + e + 0.2, d1), white);
  }
  const boxes = new THREE.Mesh(sb.build(), lambert({ vertexColors: true, side: THREE.DoubleSide }));
  boxes.receiveShadow = true;
  g.add(boxes);
  return g;
}

function buildStartLine(track: Track): THREE.Group {
  const g = new THREE.Group();
  const hw = track.halfWidth;
  const tex = checkerTexture();
  tex.repeat.set((hw * 2) / 8, 1);
  const lineMesh = new THREE.Mesh(new THREE.PlaneGeometry(hw * 2, 2), lambert({ map: tex }));
  lineMesh.rotation.x = -Math.PI / 2;
  const holder = new THREE.Group();
  holder.add(lineMesh);
  holder.position.set(track.x[0], 0.045, track.y[0]);
  // The strip's long side lies across the track.
  holder.rotation.y = -track.heading[0] + Math.PI / 2;
  g.add(holder);

  // Grid slots: a bracket in front of each starting position.
  const sb = new StripBuilder();
  const white = new THREE.Color(0xf2f2ec);
  for (let g0 = 0; g0 < 20; g0++) {
    const slot = track.gridSlot(g0);
    const front = slot.s + 2.7;
    const y = 0.042;
    const p = (s: number, d: number): THREE.Vector3Tuple => {
      const [x, z] = track.pointAt(s, d);
      return [x, y, z];
    };
    sb.quad(p(front, slot.d - 1.4), p(front, slot.d + 1.4), p(front + 0.3, slot.d - 1.4), p(front + 0.3, slot.d + 1.4), white);
    for (const edge of [-1.4, 1.2]) {
      sb.quad(p(front - 1.8, slot.d + edge), p(front - 1.8, slot.d + edge + 0.2), p(front, slot.d + edge), p(front, slot.d + edge + 0.2), white);
    }
  }
  const slots = new THREE.Mesh(sb.build(), lambert({ vertexColors: true, side: THREE.DoubleSide }));
  slots.receiveShadow = true;
  g.add(slots);
  return g;
}

/** Barriers: tyre walls behind gravel traps, steel guard rail elsewhere. */
function buildBarriers(track: Track): THREE.Mesh {
  const sb = new StripBuilder();
  const n = track.n;
  const tyreFace = new THREE.Color(0x22242c);
  const tyreTops = [new THREE.Color(0xf2f2ec), new THREE.Color(0xd63a34)];
  const railFace = new THREE.Color(0x9aa2b0);
  const railTop = new THREE.Color(0xd4d8e0);
  const sponsor = [0x2a6fd6, 0xf0c020, 0xd63a34, 0x22a860, 0xf2f2ec].map((c) => new THREE.Color(c));
  const height = 1.05;
  const thick = 0.8;

  for (let side = 0; side < 2; side++) {
    const sign = side === 1 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const block = Math.floor(i / 3);
      const tyre = track.gravel[side][i] === 1;
      let face = tyre ? tyreFace : railFace;
      const top = tyre ? tyreTops[block % 2] : railTop;
      if (!tyre && block % 7 === 3) face = sponsor[(block + side) % sponsor.length];
      const dIn0 = sign * track.wall[side][i];
      const dIn1 = sign * track.wall[side][j];
      const dOut0 = dIn0 + sign * thick;
      const dOut1 = dIn1 + sign * thick;
      sb.quad(at(track, i, dIn0, 0), at(track, i, dIn0, height), at(track, j, dIn1, 0), at(track, j, dIn1, height), face);
      sb.quad(at(track, i, dIn0, height), at(track, i, dOut0, height), at(track, j, dIn1, height), at(track, j, dOut1, height), top);
      sb.quad(at(track, i, dOut0, 0), at(track, i, dOut0, height), at(track, j, dOut1, 0), at(track, j, dOut1, height), face);
    }
  }
  const geo = sb.build();
  geo.deleteAttribute('normal');
  const mesh = new THREE.Mesh(geo, propMaterial({ vertexColors: true }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function buildStartGantry(track: Track): { gantry: THREE.Group; lights: THREE.MeshBasicMaterial[] } {
  const gantry = new THREE.Group();
  const span = track.halfWidth * 2 + 5;
  const dark = 0x2a2d38;
  gantry.add(box(0.6, 7, 0.6, dark, 0, 3.5, -span / 2));
  gantry.add(box(0.6, 7, 0.6, dark, 0, 3.5, span / 2));
  gantry.add(box(0.9, 0.9, span + 0.6, dark, 0, 7, 0));
  gantry.add(box(1.7, 1.5, 10.4, 0x16171d, 0, 7.5, 0));
  const lights: THREE.MeshBasicMaterial[] = [];
  for (let i = 0; i < 5; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x3a1418 });
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 1.3), mat);
    lamp.position.set(0, 7.9, (i - 2) * 1.9);
    gantry.add(lamp);
    lights.push(mat);
  }
  const s = 8;
  const [x, z] = track.pointAt(s, 0);
  gantry.position.set(x, 0, z);
  gantry.rotation.y = -track.heading[track.indexAt(s)];
  return { gantry, lights };
}

function buildPits(track: Track, keepOut: { x: number; z: number; r: number }[]): THREE.Group {
  const g = new THREE.Group();
  const side = track.pit.side;
  const length = 120;
  const sMid = track.length - 40;
  const wall = track.wall[side][track.indexAt(sMid)];
  const holder = new THREE.Group();
  placeBeside(holder, track, sMid, side, wall + 1.2);
  // The holder's x axis runs along the straight; z points into the infield.

  const apronTex = paddockTexture();
  apronTex.repeat.set(length / 8, 6);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(length + 30, 48), lambert({ map: apronTex }));
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(0, 0.015, 24);
  apron.receiveShadow = true;
  holder.add(apron);


  // Garage block with a windowed front.
  const depth = 11;
  const height = 6;
  const frontTex = pitBuildingTexture();
  frontTex.repeat.set(length / 6, 1);
  const building = new THREE.Mesh(new THREE.BoxGeometry(length, height, depth), [
    lambert({ color: 0xd8dae2 }),
    lambert({ color: 0xd8dae2 }),
    lambert({ color: 0xc4c8d2 }),
    lambert({ color: 0x808490 }),
    lambert({ map: frontTex }),
    lambert({ map: frontTex }),
  ]);
  building.position.set(0, height / 2, 9 + depth / 2);
  building.castShadow = true;
  building.receiveShadow = true;
  holder.add(building);
  // Roof detail: trim, skylights and plant.
  holder.add(box(length + 0.6, 0.5, 0.8, 0xc23a3a, 0, height + 0.25, 9.2));
  holder.add(box(length + 0.6, 0.5, 0.8, 0xc23a3a, 0, height + 0.25, 8.8 + depth));
  for (let x = -length / 2 + 6; x < length / 2 - 4; x += 12) {
    holder.add(box(5, 0.35, 2.2, 0x6f9fd8, x, height + 0.18, 9 + depth / 2));
    holder.add(box(1.6, 0.9, 1.6, 0x9096a4, x + 6, height + 0.45, 9 + depth - 2.5));
  }
  // Race control tower at the start-line end.
  holder.add(box(9, 11, 9, 0xe8eaf0, length / 2 + 6.5, 5.5, 9 + depth / 2));
  holder.add(box(9.6, 2.4, 9.6, 0x4a78b4, length / 2 + 6.5, 9, 9 + depth / 2));
  holder.add(box(10.4, 0.5, 10.4, 0xc23a3a, length / 2 + 6.5, 11.25, 9 + depth / 2));

  // Paddock behind the garages: team transporters and awnings.
  const rng = new Rng(97);
  const truckColors = [0xd8232a, 0x1f6fe0, 0xf2c21a, 0xf4f4f0, 0x1fa85a, 0x22242c, 0xf07a1c, 0x8a35d6];
  for (let k = 0; k < 9; k++) {
    const x = -length / 2 + 8 + k * 13 + rng.range(-1, 1);
    const color = truckColors[k % truckColors.length];
    holder.add(box(3, 3.6, 13, color, x, 1.8, 31 + rng.range(-1, 1)));
    holder.add(box(2.8, 2.8, 2.6, 0xe8eaf0, x, 1.4, 39.5));
    holder.add(box(6, 0.3, 7, 0xf4f4f0, x + 4.8, 2.9, 28));
  }

  g.add(holder);
  holder.updateMatrixWorld(true);
  const centre = new THREE.Vector3(0, 0, 26).applyMatrix4(holder.matrixWorld);
  for (let k = -3; k <= 3; k++) {
    const p = new THREE.Vector3(k * 22, 0, 24).applyMatrix4(holder.matrixWorld);
    keepOut.push({ x: p.x, z: p.z, r: 34 });
  }
  keepOut.push({ x: centre.x, z: centre.z, r: 40 });
  return g;
}

function buildGrandstands(track: Track, keepOut: { x: number; z: number; r: number }[]): THREE.Group {
  const g = new THREE.Group();
  const crowd = crowdTexture();
  const L = track.length;
  // [lap distance, side, length, roof colour]
  const main = track.pit.side === 1 ? 0 : 1;
  const stands: [number, number, number, number][] = [
    [L - 95, main, 70, 0x2a5fb8],
    [L - 15, main, 70, 0xc23a3a],
    [70, main, 60, 0x2a5fb8],
  ];
  // The best seats are on the outside of the slowest corners.
  const peaks: number[] = [];
  const order = Array.from({ length: track.n }, (_, i) => i).sort((a, b) => Math.abs(track.curvature[b]) - Math.abs(track.curvature[a]));
  for (const i of order) {
    if (peaks.length >= 4) break;
    const s = i * track.ds;
    if (s > L - 320 || s < 200) continue;
    if (peaks.some((p) => Math.min(Math.abs(p - s), L - Math.abs(p - s)) < 260)) continue;
    peaks.push(s);
    stands.push([s, track.curvature[i] > 0 ? 0 : 1, 46, peaks.length % 2 ? 0xf0c020 : 0xc23a3a]);
  }
  for (const [s, side, length, roofColor] of stands) {
    const wall = track.wall[side][track.indexAt(s)];
    // Leave the stand out if another part of the circuit runs behind it.
    const [bx, bz] = track.pointAt(s, (side === 1 ? 1 : -1) * (wall + 20));
    const near = track.nearest(bx, bz);
    if (near >= 0 && Math.hypot(bx - track.x[near], bz - track.y[near]) < wall + 12) continue;
    const stand = buildStand(length, crowd, roofColor);
    placeBeside(stand, track, s, side, wall + 5);
    g.add(stand);
    stand.updateMatrixWorld(true);
    for (let k = -1; k <= 1; k++) {
      const p = new THREE.Vector3((k * length) / 3, 0, 8).applyMatrix4(stand.matrixWorld);
      keepOut.push({ x: p.x, z: p.z, r: 17 });
    }
  }
  return g;
}

/** A terraced stand; local z = 0 is the front rail, rising toward +z. */
function buildStand(length: number, crowd: THREE.Texture, roofColor: number): THREE.Group {
  const g = new THREE.Group();
  const depth = 11;
  const rise = 6.5;
  const tex = crowd.clone();
  tex.needsUpdate = true;
  tex.repeat.set(length / 16, 1);

  // Sloping terrace with the crowd on it.
  const terrace = new THREE.BufferGeometry();
  const x0 = -length / 2, x1 = length / 2;
  terrace.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [x0, 1.2, 0, x1, 1.2, 0, x0, rise, depth, x1, 1.2, 0, x1, rise, depth, x0, rise, depth],
      3,
    ),
  );
  terrace.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1], 2));
  const terraceMesh = new THREE.Mesh(terrace, propMaterial({ map: tex }));
  terraceMesh.receiveShadow = true;
  g.add(terraceMesh);

  g.add(box(length, 1.2, 0.4, 0xe8eaf0, 0, 0.6, -0.1));
  g.add(box(length, rise + 3.5, 0.5, 0x8a909e, 0, (rise + 3.5) / 2, depth + 0.25));
  g.add(box(0.5, rise, depth, 0x8a909e, x0, rise / 2, depth / 2));
  g.add(box(0.5, rise, depth, 0x8a909e, x1, rise / 2, depth / 2));
  // Roof over the back rows only, so the crowd stays visible from above.
  g.add(box(length + 2, 0.4, 5.5, roofColor, 0, rise + 3.6, depth - 2.2));
  g.add(box(length + 2, 0.45, 0.7, 0xf2f2ec, 0, rise + 3.62, depth - 5.2));
  for (let x = x0 + 2; x <= x1 - 1; x += 9) g.add(box(0.3, 3.4, 0.3, 0x5a6070, x, rise + 1.2, depth - 4.6));
  // Flags along the back of the roof.
  const flags = new Mesher();
  const colors = [0xd8232a, 0xf2c21a, 0x1f6fe0, 0xf4f4f0, 0x1fa85a];
  let k = 0;
  for (let x = x0 + 3; x <= x1 - 2; x += Math.max(8, length / 6), k++) {
    flags.box(0.12, 3.2, 0.12, 0xc8ccd6, x, rise + 5.2, depth + 0.2);
    flags.box(1.6, 0.9, 0.05, colors[(k + Math.round(length)) % colors.length], x + 0.86, rise + 6.25, depth + 0.2, 0, 0.25, 0);
  }
  const flagMesh = new THREE.Mesh(flags.build(), paintMaterial());
  flagMesh.castShadow = true;
  g.add(flagMesh);
  return g;
}

function buildAdBoards(track: Track): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(131);
  const colors = [0x2a6fd6, 0xf0c020, 0xd63a34, 0x22a860, 0xf2f2ec, 0xf07a1c, 0x8a35d6, 0x18b4d0];
  const n = track.n;
  const spacing = Math.round(46 / track.ds);
  for (let i = spacing; i < n; i += spacing) {
    if (Math.abs(track.curvature[i]) > 1 / 160) continue;
    for (let side = 0; side < 2; side++) {
      if (track.gravel[side][i] || rng.next() < 0.35) continue;
      const holder = new THREE.Group();
      placeBeside(holder, track, i * track.ds, side, track.wall[side][i] + 2.2);
      const base = rng.pick(colors);
      holder.add(box(10, 1.7, 0.3, base, 0, 1.35, 0));
      holder.add(box(3.2, 0.8, 0.36, base === 0xf2f2ec ? 0x22242c : 0xf2f2ec, rng.range(-2.5, 2.5), 1.4, 0));
      holder.add(box(0.25, 0.6, 0.25, 0x5a6070, -4, 0.3, 0.2));
      holder.add(box(0.25, 0.6, 0.25, 0x5a6070, 4, 0.3, 0.2));
      g.add(holder);
    }
  }
  return g;
}

/**
 * Marshal posts on the outside of each gravel trap: a hut, a flag board and a
 * tyre stack, all in one mesh. Left out wherever another part of the circuit is close.
 */
function buildMarshalPosts(track: Track): THREE.Mesh {
  const m = new Mesher();
  const n = track.n;
  const tyre = 0x1b1c22;
  for (let side = 0; side < 2; side++) {
    const sign = side === 1 ? 1 : -1;
    for (let i = 0; i < n; i++) {
      // The middle of each run of gravel.
      if (!track.gravel[side][i] || track.gravel[side][(i + n - 1) % n]) continue;
      let len = 0;
      while (len < n && track.gravel[side][(i + len) % n]) len++;
      const mid = (i + Math.floor(len / 2)) % n;
      const s = mid * track.ds;
      if (track.inPitZone(s)) continue;
      const dist = track.wall[side][mid] + 3.5;
      const [x, z] = track.pointAt(s, sign * dist);
      const near = track.nearest(x, z);
      if (near >= 0 && Math.hypot(x - track.x[near], z - track.y[near]) < track.halfWidth + 12) continue;
      // Local x along the track, z away from it.
      m.place(x, 0, z, -track.heading[mid] + (side === 0 ? Math.PI : 0));
      m.box(2.2, 2.1, 1.8, 0xe8eaf0, 0, 1.05, 1.0);
      m.box(2.5, 0.2, 2.1, 0xf07a1c, 0, 2.2, 1.0);
      m.box(1.6, 0.5, 0.05, 0x2a3a50, 0, 1.45, 0.08);
      m.box(0.08, 3.2, 0.08, 0xc8ccd6, 1.35, 1.6, 0.2);
      m.box(0.9, 0.6, 0.04, 0xf2c21a, 1.82, 2.85, 0.2);
      m.box(0.9, 0.6, 0.04, 0x1fa85a, 1.82, 2.2, 0.2);
      for (let k = 0; k < 3; k++) m.cyl(0.32, 0.32, 0.26, 8, k === 2 ? 0xf4f4f0 : tyre, -1.6, 0.13 + k * 0.27, 0.4);
    }
  }
  m.transform(null);
  const mesh = new THREE.Mesh(m.build(), paintMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Smooth value noise in 0..1, for clumping trees into woods. */
function makeNoise(seed: number): (x: number, y: number) => number {
  const hash = (ix: number, iy: number): number => {
    let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ seed;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function buildTrees(track: Track, keepOut: readonly { x: number; z: number; r: number }[], snow = false): THREE.Group {
  const g = new THREE.Group();
  const rng = new Rng(211);
  const noise = makeNoise(77);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.n; i++) {
    minX = Math.min(minX, track.x[i]);
    maxX = Math.max(maxX, track.x[i]);
    minZ = Math.min(minZ, track.y[i]);
    maxZ = Math.max(maxZ, track.y[i]);
  }
  const margin = 190;
  const trees: { x: number; z: number; size: number; pine: boolean }[] = [];
  let attempts = 0;
  const area = (maxX - minX + margin * 2) * (maxZ - minZ + margin * 2);
  const wanted = Math.min(7000, Math.round(area / 330));
  while (trees.length < wanted && attempts++ < wanted * 24) {
    const x = rng.range(minX - margin, maxX + margin);
    const z = rng.range(minZ - margin, maxZ + margin);
    const wood = noise(x / 70, z / 70) * 0.7 + noise(x / 23, z / 23) * 0.3;
    if (wood < 0.46 && rng.next() > 0.05) continue;
    const near = track.nearest(x, z);
    if (near >= 0) {
      const d = (x - track.x[near]) * track.nx[near] + (z - track.y[near]) * track.ny[near];
      const along = (x - track.x[near]) * track.tx[near] + (z - track.y[near]) * track.ty[near];
      if (Math.hypot(d, along) < track.wall[d >= 0 ? 1 : 0][near] + 6) continue;
    }
    if (keepOut.some((k) => (x - k.x) ** 2 + (z - k.z) ** 2 < k.r * k.r)) continue;
    trees.push({ x, z, size: rng.range(0.75, 1.5), pine: noise(x / 120 + 9, z / 120) > 0.56 });
  }

  const trunkGeo = new THREE.CylinderGeometry(0.28, 0.4, 1, 5);
  const blobGeo = new THREE.IcosahedronGeometry(1, 0);
  const coneGeo = new THREE.ConeGeometry(1, 1, 6);
  // Snow on the leaves: everything lifts toward white.
  const leafMat = lambert({ flatShading: true, emissive: snow ? 0x5a626e : 0x000000 });
  const trunks = new THREE.InstancedMesh(trunkGeo, lambert({ color: 0x6a4a30, flatShading: true }), trees.length);
  const pines = trees.filter((t) => t.pine);
  const broad = trees.filter((t) => !t.pine);
  const blobs = new THREE.InstancedMesh(blobGeo, leafMat, broad.length * 2);
  const cones = new THREE.InstancedMesh(coneGeo, leafMat, pines.length * 2);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const color = new THREE.Color();
  const broadGreens = [0x3f8f3a, 0x4a9e40, 0x357c34, 0x58a846, 0x6aa83c];
  const pineGreens = [0x2a6a48, 0x245c40, 0x30754e];

  trees.forEach((t, i) => {
    const h = (t.pine ? 2.6 : 2.2) * t.size;
    m.compose(new THREE.Vector3(t.x, h / 2, t.z), q, new THREE.Vector3(t.size, h, t.size));
    trunks.setMatrixAt(i, m);
  });
  broad.forEach((t, i) => {
    const r = 2.5 * t.size;
    q.setFromEuler(new THREE.Euler(0, rng.range(0, Math.PI * 2), 0));
    m.compose(new THREE.Vector3(t.x, 2 * t.size + r * 0.7, t.z), q, new THREE.Vector3(r, r * 0.85, r));
    blobs.setMatrixAt(i * 2, m);
    color.setHex(rng.pick(broadGreens));
    blobs.setColorAt(i * 2, color);
    const r2 = r * 0.62;
    m.compose(
      new THREE.Vector3(t.x + rng.range(-0.9, 0.9) * t.size, 2 * t.size + r * 1.45, t.z + rng.range(-0.9, 0.9) * t.size),
      q,
      new THREE.Vector3(r2, r2 * 0.85, r2),
    );
    blobs.setMatrixAt(i * 2 + 1, m);
    color.offsetHSL(0, 0, 0.05);
    blobs.setColorAt(i * 2 + 1, color);
  });
  q.identity();
  pines.forEach((t, i) => {
    const r = 2.1 * t.size;
    const h = 5 * t.size;
    m.compose(new THREE.Vector3(t.x, 1.6 * t.size + h / 2, t.z), q, new THREE.Vector3(r, h, r));
    cones.setMatrixAt(i * 2, m);
    color.setHex(rng.pick(pineGreens));
    cones.setColorAt(i * 2, color);
    m.compose(new THREE.Vector3(t.x, 1.6 * t.size + h * 0.95, t.z), q, new THREE.Vector3(r * 0.68, h * 0.7, r * 0.68));
    cones.setMatrixAt(i * 2 + 1, m);
    color.offsetHSL(0, 0, 0.04);
    cones.setColorAt(i * 2 + 1, color);
  });

  for (const mesh of [trunks, blobs, cones]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    g.add(mesh);
  }
  return g;
}
