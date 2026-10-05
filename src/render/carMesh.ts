import * as THREE from 'three';
import type { BodyStyle, CarModel, Livery } from '../data/cars';

/** A drawable car: nose toward +x, y up. */
export interface CarVisual {
  root: THREE.Group;
  /** Tilts with acceleration for body roll and pitch. */
  chassis: THREE.Group;
  frontWheels: THREE.Object3D[];
  wheels: THREE.Object3D[];
  brakeLights: THREE.MeshBasicMaterial;
  /** Damage dressing per zone (front, rear, left, right): [scuffed, crumpled]. Hidden until hit. */
  dents: THREE.Object3D[][];
}

const GLASS = 0x1a2a3c;
const DARK = 0x16171d;
const GROUND_CLEARANCE = 0.14;

interface Station {
  /** 0 at the nose, 1 at the tail. */
  f: number;
  /** Half width as a fraction of the car's half width. */
  w: number;
  shoulder: number;
  roof: number;
  /** Roof half width as a fraction of the car's half width. */
  roofW: number;
}

function stationsFor(b: BodyStyle): Station[] {
  const flat = (f: number, w: number, h: number): Station => ({ f, w, shoulder: h, roof: h + 0.05, roofW: w * 0.72 });
  const screenTop = b.cabinStart + 0.13;
  const roofEnd = b.fastback ? b.cabinEnd - 0.2 : b.cabinEnd - 0.1;
  const rear = 1 + b.rearFlare;
  return [
    flat(0, 0.74, b.noseHeight * 0.72),
    flat(0.05, 0.93, b.noseHeight),
    flat(0.17, 1, b.hoodHeight * 0.93),
    flat(b.cabinStart, 1, b.hoodHeight),
    { f: screenTop, w: 1, shoulder: b.hoodHeight + 0.04, roof: b.roofHeight, roofW: b.roofWidth },
    { f: Math.max(screenTop + 0.05, roofEnd), w: rear, shoulder: b.deckHeight, roof: b.roofHeight - 0.02, roofW: b.roofWidth },
    flat(b.cabinEnd, rear, b.deckHeight),
    flat(0.94, rear, b.deckHeight - 0.02),
    flat(1, 0.9, b.deckHeight * 0.9),
  ];
}

/** Lofts the body shell through the stations, flat shaded with per-face colours. */
export function buildShell(
  dims: { length: number; width: number },
  body: BodyStyle,
  livery: Livery,
  glassColor = GLASS,
): THREE.BufferGeometry {
  const { length, width } = dims;
  const half = width / 2;
  const stations = stationsFor(body);
  const base = new THREE.Color(livery.base);
  const accent = new THREE.Color(livery.accent);
  const glass = new THREE.Color(glassColor);
  const dark = new THREE.Color(DARK);
  const sill = base.clone().multiplyScalar(0.72);
  const stripe = 0.2;

  // Cross-section ring, left to right over the top: 8 points.
  const ring = (s: Station): THREE.Vector3[] => {
    const x = length / 2 - s.f * length;
    const w = s.w * half;
    const rw = s.roofW * half;
    const sw = Math.min(stripe * half, rw * 0.6);
    return [
      new THREE.Vector3(x, GROUND_CLEARANCE, -w * 0.94),
      new THREE.Vector3(x, s.shoulder, -w),
      new THREE.Vector3(x, s.roof, -rw),
      new THREE.Vector3(x, s.roof + 0.015, -sw),
      new THREE.Vector3(x, s.roof + 0.015, sw),
      new THREE.Vector3(x, s.roof, rw),
      new THREE.Vector3(x, s.shoulder, w),
      new THREE.Vector3(x, GROUND_CLEARANCE, w * 0.94),
    ];
  };

  const pos: number[] = [];
  const col: number[] = [];
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, color: THREE.Color): void => {
    pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    for (let i = 0; i < 3; i++) col.push(color.r, color.g, color.b);
  };
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, color: THREE.Color): void => {
    tri(a, b, c, color);
    tri(a, c, d, color);
  };

  const rings = stations.map(ring);
  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i], b = stations[i + 1];
    const ra = rings[i], rb = rings[i + 1];
    const cabinA = a.roof - a.shoulder > 0.2;
    const cabinB = b.roof - b.shoulder > 0.2;
    const greenhouse = cabinA || cabinB;
    const sloped = Math.abs(a.roof - b.roof) > 0.2;
    for (let e = 0; e < 7; e++) {
      let color = base;
      if (e === 0 || e === 6) color = base;
      else if (e === 1 || e === 5) color = greenhouse ? glass : base;
      else if (sloped) color = glass;
      else if (e === 3) color = accent;
      quad(ra[e], rb[e], rb[e + 1], ra[e + 1], color);
    }
    // Lower side panel shaded slightly to read as a separate surface.
    quad(ra[7], rb[7], rb[0], ra[0], dark);
  }
  // Close the nose and tail.
  for (const [r, color] of [[rings[0], base], [rings[rings.length - 1], sill]] as const) {
    for (let e = 1; e < 7; e++) tri(r[0], r[e], r[e + 1], color);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function part(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

export function buildCarVisual(model: CarModel, livery: Livery, rimColor = 0xb8bcc8): CarVisual {
  const { spec, body } = model;
  const L = spec.length, W = spec.width;
  const root = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(chassis);

  const paint = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const shell = new THREE.Mesh(buildShell(spec, body, livery), paint);
  shell.castShadow = true;
  chassis.add(shell);

  const darkMat = new THREE.MeshLambertMaterial({ color: DARK, flatShading: true });
  const accentMat = new THREE.MeshLambertMaterial({ color: livery.accent, flatShading: true });
  const baseMat = new THREE.MeshLambertMaterial({ color: livery.base, flatShading: true });

  // Front splitter and rear diffuser.
  chassis.add(part(new THREE.BoxGeometry(0.5, 0.06, W * 0.96), darkMat, L / 2 - 0.1, GROUND_CLEARANCE, 0));
  chassis.add(part(new THREE.BoxGeometry(0.45, 0.2, W * 0.8), darkMat, -L / 2 + 0.1, GROUND_CLEARANCE + 0.1, 0));

  // Rear wing: plane, end plates and swan-neck mounts.
  const wingX = -L / 2 + 0.22;
  const wingW = W * 0.94;
  chassis.add(part(new THREE.BoxGeometry(0.46, 0.05, wingW), accentMat, wingX, body.wingHeight, 0));
  for (const s of [-1, 1]) {
    chassis.add(part(new THREE.BoxGeometry(0.56, 0.3, 0.05), baseMat, wingX, body.wingHeight - 0.08, (s * wingW) / 2));
    chassis.add(part(new THREE.BoxGeometry(0.08, body.wingHeight - body.deckHeight, 0.06), darkMat, wingX + 0.12, (body.wingHeight + body.deckHeight) / 2, s * W * 0.22));
    // Mirrors.
    chassis.add(part(new THREE.BoxGeometry(0.14, 0.1, 0.2), baseMat, L / 2 - (body.cabinStart + 0.06) * L, body.hoodHeight + 0.14, s * (W / 2 + 0.06)));
  }

  // Lights.
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff2b8 });
  const brakeLights = new THREE.MeshBasicMaterial({ color: 0x5a0c10 });
  for (const s of [-1, 1]) {
    chassis.add(part(new THREE.BoxGeometry(0.1, 0.1, 0.36), headMat, L / 2 - 0.2, body.noseHeight + 0.02, s * W * 0.34));
    chassis.add(part(new THREE.BoxGeometry(0.08, 0.1, 0.5), brakeLights, -L / 2 - 0.01, body.deckHeight * 0.78, s * W * 0.3));
  }

  // Wheels.
  const tyreGeo = new THREE.CylinderGeometry(spec.wheelRadius, spec.wheelRadius, 0.32, 10);
  tyreGeo.rotateX(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(spec.wheelRadius * 0.6, spec.wheelRadius * 0.6, 0.34, 6);
  rimGeo.rotateX(Math.PI / 2);
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1b1c22, flatShading: true });
  const rimMat = new THREE.MeshLambertMaterial({ color: rimColor, flatShading: true });
  const a = spec.wheelbase * (1 - spec.frontWeight);
  // Body centre and centre of mass are treated as coincident; axles sit around it.
  const frontX = Math.min(L / 2 - 0.75, a);
  const rearX = frontX - spec.wheelbase;
  const wheels: THREE.Object3D[] = [];
  const frontWheels: THREE.Object3D[] = [];
  for (const [x, front] of [[frontX, true], [rearX, false]] as const) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Group();
      const tyre = new THREE.Mesh(tyreGeo, tyreMat);
      tyre.castShadow = true;
      wheel.add(tyre, new THREE.Mesh(rimGeo, rimMat));
      wheel.position.set(x, spec.wheelRadius, s * (W / 2 - 0.13));
      root.add(wheel);
      wheels.push(wheel);
      if (front) frontWheels.push(wheel);
    }
  }

  // Damage dressing: scraped paint first, then bent and hanging panels.
  const scuffMat = new THREE.MeshLambertMaterial({ color: 0x24252b, flatShading: true });
  const bareMat = new THREE.MeshLambertMaterial({ color: 0x8a8d96, flatShading: true });
  const dents: THREE.Object3D[][] = [];
  const dress = (build: (light: THREE.Group, heavy: THREE.Group) => void): void => {
    const light = new THREE.Group(), heavy = new THREE.Group();
    build(light, heavy);
    light.visible = false;
    heavy.visible = false;
    chassis.add(light, heavy);
    dents.push([light, heavy]);
  };
  const bit = (g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void => {
    const m = part(new THREE.BoxGeometry(w, h, d), mat, x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
  };
  const nose = L / 2, tail = -L / 2;
  dress((light, heavy) => {
    bit(light, scuffMat, 0.14, 0.2, W * 0.5, nose - 0.04, body.noseHeight * 0.7, W * 0.12, 0, 0.12);
    bit(light, bareMat, 0.1, 0.08, W * 0.22, nose - 0.02, body.noseHeight * 0.9, -W * 0.24);
    bit(heavy, baseMat, 0.9, 0.05, W * 0.62, nose - 0.75, body.hoodHeight + 0.14, 0.05, 0, 0, -0.32);
    bit(heavy, scuffMat, 0.3, 0.26, W * 0.8, nose - 0.02, body.noseHeight * 0.6, 0, 0, -0.1);
    bit(heavy, darkMat, 0.5, 0.05, W * 0.5, nose + 0.08, 0.07, -W * 0.2, 0, 0.5, 0.12);
  });
  dress((light, heavy) => {
    bit(light, scuffMat, 0.12, 0.22, W * 0.5, tail + 0.02, body.deckHeight * 0.6, -W * 0.14, 0, -0.1);
    bit(heavy, scuffMat, 0.3, 0.3, W * 0.84, tail + 0.04, body.deckHeight * 0.55, 0, 0, 0.08);
    bit(heavy, darkMat, 0.4, 0.14, W * 0.6, tail - 0.1, 0.12, W * 0.16, 0, -0.45, -0.18);
    bit(heavy, bareMat, 0.3, 0.04, W * 0.4, wingX, body.wingHeight + 0.05, W * 0.3, 0.3, 0.2);
  });
  for (const s of [1, -1]) {
    dress((light, heavy) => {
      const z = s * (W / 2 + 0.01);
      bit(light, scuffMat, L * 0.34, 0.16, 0.05, 0.2, body.hoodHeight * 0.62, z);
      bit(light, bareMat, L * 0.16, 0.05, 0.05, -0.5, body.hoodHeight * 0.45, z);
      bit(heavy, scuffMat, L * 0.52, 0.34, 0.07, -0.05, body.hoodHeight * 0.58, z, 0, s * 0.03);
      bit(heavy, baseMat, 0.7, 0.3, 0.05, 0.75, body.hoodHeight * 0.6, z + s * 0.08, 0, s * 0.2);
    });
  }

  return { root, chassis, frontWheels, wheels, brakeLights, dents };
}
