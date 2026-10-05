import * as THREE from 'three';
import { Part, PartLook, SlotId, getPart } from '../data/parts';
import type { CarBuild } from '../game/build';
import { axlesOf, bodyShape, buildLights, buildShell, dressBody } from './carMesh';
import { Mesher } from './mesher';

/** The detailed, part-by-part car shown in the garage. Nose toward +x, y up. */
export interface GarageCar {
  root: THREE.Group;
  /** Lifts the body and spreads the wheels to show what is underneath, 0..1. */
  setExplode(t: number): void;
  /** Marks one slot's parts; pass null to clear. */
  setHighlight(slot: SlotId | null): void;
  /** Call every frame to animate the highlight. */
  tick(time: number): void;
  /** Where the camera should look for a slot, in car space, and from how far. */
  focusOf(slot: SlotId): { point: THREE.Vector3; distance: number };
  length: number;
}

const FLOOR_Y = 0.15;
const WHEEL_R = 0.345;
const ENGINE_ACCENT: Record<string, number> = {
  porsche: 0xc8ccd6, bmw: 0x2a6fd6, mercedes: 0x8a8f9c, ferrari: 0xd8232a,
  vag: 0xd8232a, mclaren: 0xf07a1c, aston: 0x1f8a5a,
};

class Builder {
  readonly bySlot = new Map<SlotId, THREE.MeshLambertMaterial[]>();
  private readonly cache = new Map<string, THREE.MeshLambertMaterial>();

  /** One material per slot and colour, so a slot can be lit up on its own. */
  mat(slot: SlotId, color: number): THREE.MeshLambertMaterial {
    const key = `${slot}:${color}`;
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, flatShading: true });
      this.cache.set(key, m);
      const list = this.bySlot.get(slot) ?? [];
      list.push(m);
      this.bySlot.set(slot, list);
    }
    return m;
  }

  box(parent: THREE.Object3D, slot: SlotId, color: number, w: number, h: number, d: number, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.mat(slot, color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** Cylinder with its axis along x, y or z. */
  cyl(parent: THREE.Object3D, slot: SlotId, color: number, r: number, len: number, axis: 'x' | 'y' | 'z', x: number, y: number, z: number, seg = 10, r2 = r): THREE.Mesh {
    const geo = new THREE.CylinderGeometry(r2, r, len, seg);
    if (axis === 'x') geo.rotateZ(Math.PI / 2);
    else if (axis === 'z') geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, this.mat(slot, color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }

  /** A tube between two points. */
  tube(parent: THREE.Object3D, slot: SlotId, color: number, r: number, a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh {
    const len = a.distanceTo(b);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), this.mat(slot, color));
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  }
}

const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export function buildGarageCar(build: CarBuild): GarageCar | null {
  const partOf = (slot: SlotId): Part | undefined => {
    const f = build.parts[slot];
    return f ? getPart(f.part) : undefined;
  };
  const lookOf = (slot: SlotId): PartLook | undefined => partOf(slot)?.look;
  const chassisPart = partOf('chassis');
  const ch = chassisPart?.chassis;
  if (!chassisPart || !ch) return null;

  const b = new Builder();
  const root = new THREE.Group();
  const shell = new THREE.Group();
  const floor = new THREE.Group();
  root.add(floor, shell);

  const L = ch.length, W = ch.width, body = ch.body;
  const frontX = Math.min(L / 2 - 0.75, ch.wheelbase * (1 - ch.frontWeight));
  const rearX = frontX - ch.wheelbase;
  const cabinX0 = L / 2 - body.cabinStart * L;
  const cabinX1 = L / 2 - body.cabinEnd * L;
  const cabinMid = (cabinX0 + cabinX1) / 2;
  const seatX = cabinMid - 0.05;
  const seatZ = -W * 0.2;

  // --- Body shell and aero (these lift together) ---------------------------
  const windows = lookOf('windows');
  const shellMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  const list = b.bySlot.get('chassis') ?? [];
  list.push(shellMat);
  b.bySlot.set('chassis', list);
  // The shell, its trim and its numbers are one mesh, so the whole body lifts and fades together.
  const axles = axlesOf(L, ch.wheelbase, ch.frontWeight, WHEEL_R);
  const shape = bodyShape({ length: L, width: W }, body, axles);
  const paint = new Mesher();
  buildShell(shape, build.livery, paint, paint, axles, windows?.c ?? 0x2a3040);
  dressBody(paint, shape, body, build.livery, axles, { aero: false, crew: false, mirrors: true });
  const shellMesh = new THREE.Mesh(paint.build(), shellMat);
  shellMesh.castShadow = true;
  shell.add(shellMesh);
  const lights = buildLights({ length: L, width: W }, body);
  shell.add(new THREE.Mesh(lights.head, new THREE.MeshBasicMaterial({ color: 0xfff2b8 })), new THREE.Mesh(lights.tail, new THREE.MeshBasicMaterial({ color: 0xc81820 })));

  const splitter = lookOf('splitter');
  if (splitter) {
    const reach = splitter.style === 0 ? 0.22 : 0.42;
    b.box(shell, 'splitter', splitter.c ?? 0x22242c, reach + 0.3, 0.035, W * 0.98, L / 2 + reach / 2 - 0.15, FLOOR_Y - 0.02, 0);
    if ((splitter.style ?? 0) >= 1) {
      for (const s of [-1, 1]) b.tube(shell, 'splitter', 0xb4bac6, 0.012, V(L / 2 + reach - 0.06, FLOOR_Y, s * W * 0.3), V(L / 2 - 0.05, body.noseHeight * 0.8, s * W * 0.3));
    }
  }
  const canards = lookOf('canards');
  if (canards && (canards.style ?? 0) > 0) {
    {
      for (const s of [-1, 1]) {
        for (let up = 0; up < (canards.style ?? 1); up++) {
          const plane = b.box(shell, 'canards', canards.c ?? 0x15161b, 0.42, 0.02, 0.2, L / 2 - 0.32, body.noseHeight * (0.45 + up * 0.32), s * (W / 2 + 0.02));
          plane.rotation.z = 0.28;
        }
      }
    }
  }

  const wing = lookOf('wing');
  const wingX = -L / 2 + 0.2;
  if (wing) {
    const style = wing.style ?? 0;
    const wingW = W * (style === 0 ? 0.86 : 0.96);
    const y = body.wingHeight + (style === 1 ? 0.04 : 0);
    const main = b.box(shell, 'wing', wing.c ?? 0x15161b, 0.42, 0.045, wingW, wingX, y, 0);
    main.rotation.z = -0.1;
    if (style === 2) {
      const flap = b.box(shell, 'wing', build.livery.accent, 0.2, 0.035, wingW, wingX - 0.24, y + 0.12, 0);
      flap.rotation.z = -0.5;
    }
    for (const s of [-1, 1]) {
      b.box(shell, 'wing', build.livery.accent, 0.56, style === 2 ? 0.42 : 0.3, 0.04, wingX - 0.02, y + (style === 2 ? 0.02 : -0.06), (s * wingW) / 2);
      const z = s * W * 0.22;
      if (style === 1) {
        // Swan neck: the pylon reaches over and holds the wing from above.
        b.tube(shell, 'wing', 0x2a2d38, 0.03, V(wingX + 0.42, body.deckHeight, z), V(wingX + 0.3, y + 0.22, z));
        b.tube(shell, 'wing', 0x2a2d38, 0.03, V(wingX + 0.3, y + 0.22, z), V(wingX + 0.02, y + 0.04, z));
      } else {
        b.box(shell, 'wing', 0x2a2d38, 0.1, y - body.deckHeight, 0.045, wingX + 0.08, (y + body.deckHeight) / 2, z);
      }
    }
  }

  // --- Floor pan, cage and diffuser (stay on the ground) -------------------
  b.box(floor, 'chassis', 0x2a2d38, L * 0.92, 0.05, W * 0.86, 0, FLOOR_Y, 0);
  const cageY = body.roofHeight - 0.12;
  const cz = W * 0.36;
  const cage = lookOf('cage')?.c ?? 0x5a606c;
  for (const s of [-1, 1]) {
    b.tube(floor, 'cage', cage, 0.028, V(cabinX1 + 0.25, FLOOR_Y, s * cz), V(cabinX1 + 0.3, cageY, s * cz * 0.86));
    b.tube(floor, 'cage', cage, 0.028, V(cabinX1 + 0.3, cageY, s * cz * 0.86), V(cabinX0 - 0.55, cageY - 0.04, s * cz * 0.84));
    b.tube(floor, 'cage', cage, 0.028, V(cabinX0 - 0.55, cageY - 0.04, s * cz * 0.84), V(cabinX0 - 0.05, FLOOR_Y, s * cz));
    b.tube(floor, 'cage', cage, 0.022, V(cabinX1 + 0.26, 0.42, s * cz), V(cabinX0 - 0.12, 0.34, s * cz));
    b.tube(floor, 'cage', cage, 0.022, V(cabinX1 + 0.26, 0.62, s * cz), V(cabinX0 - 0.2, 0.3, s * cz));
    b.tube(floor, 'cage', cage, 0.022, V(cabinX1 + 0.3, cageY, s * cz * 0.86), V(rearX + 0.1, 0.5, s * cz * 0.8));
  }
  b.tube(floor, 'cage', cage, 0.028, V(cabinX1 + 0.3, cageY, -cz * 0.86), V(cabinX1 + 0.3, cageY, cz * 0.86));
  b.tube(floor, 'cage', cage, 0.028, V(cabinX0 - 0.55, cageY - 0.04, -cz * 0.84), V(cabinX0 - 0.55, cageY - 0.04, cz * 0.84));
  b.tube(floor, 'cage', cage, 0.022, V(cabinX1 + 0.27, FLOOR_Y, -cz), V(cabinX1 + 0.3, cageY, cz * 0.86));

  const diffuser = lookOf('diffuser');
  if (diffuser) {
    const ramp = b.box(floor, 'diffuser', diffuser.c ?? 0x22242c, 0.8, 0.03, W * 0.8, -L / 2 + 0.36, FLOOR_Y + 0.08, 0);
    ramp.rotation.z = -0.2;
    const strakes = diffuser.style ?? 0;
    for (let i = 0; i < strakes; i++) {
      const z = strakes === 1 ? 0 : ((i / (strakes - 1)) * 2 - 1) * W * 0.36;
      const fin = b.box(floor, 'diffuser', diffuser.c ?? 0x22242c, 0.76, 0.16, 0.02, -L / 2 + 0.36, FLOOR_Y + 0.02, z);
      fin.rotation.z = -0.2;
    }
  }

  // --- Engine bay ----------------------------------------------------------
  const engine = partOf('engine');
  const engineX = ch.layout === 'front' ? frontX - 0.55 : ch.layout === 'mid' ? rearX + 0.85 : rearX - 0.5;
  const gearboxX = ch.layout === 'rear' ? rearX + 0.3 : ch.layout === 'mid' ? rearX + 0.05 : rearX + 0.1;
  let engineTop = 0.6;
  let engineLen = 0.7;
  if (engine) {
    const style = engine.look.style ?? 2;
    const block = engine.look.c ?? 0xb0b4c0;
    const cover = ENGINE_ACCENT[engine.fits?.[0] ?? ''] ?? 0x8a8f9c;
    const y0 = FLOOR_Y + 0.05;
    if (style === 0) {
      // Flat-six: low and wide.
      engineLen = 0.62;
      b.box(floor, 'engine', block, engineLen, 0.26, 0.42, engineX, y0 + 0.13, 0);
      for (const s of [-1, 1]) {
        b.box(floor, 'engine', cover, engineLen * 0.92, 0.2, 0.24, engineX, y0 + 0.13, s * 0.33);
        for (let i = 0; i < 3; i++) b.cyl(floor, 'engine', 0x2a2d38, 0.03, 0.12, 'y', engineX - 0.2 + i * 0.2, y0 + 0.3, s * 0.3, 6);
      }
      b.box(floor, 'engine', 0x2a2d38, engineLen * 0.7, 0.1, 0.3, engineX, y0 + 0.38, 0);
      engineTop = y0 + 0.44;
    } else if (style === 1) {
      // Straight-six: long, tall and narrow.
      engineLen = 0.86;
      b.box(floor, 'engine', block, engineLen, 0.42, 0.26, engineX, y0 + 0.21, 0);
      b.box(floor, 'engine', cover, engineLen * 0.96, 0.1, 0.22, engineX, y0 + 0.47, 0);
      for (let i = 0; i < 6; i++) b.cyl(floor, 'engine', 0x2a2d38, 0.025, 0.06, 'y', engineX - 0.36 + i * 0.144, y0 + 0.55, 0, 6);
      engineTop = y0 + 0.56;
    } else {
      // Vee engines: two banks leaning out from the crankcase.
      const cylinders = style === 3 ? 3 : style === 4 ? 5 : 4;
      const lean = style === 3 ? 1.05 : 0.78;
      engineLen = 0.2 + cylinders * 0.125;
      b.box(floor, 'engine', block, engineLen, 0.24, 0.3, engineX, y0 + 0.12, 0);
      for (const s of [-1, 1]) {
        const bank = b.box(floor, 'engine', block, engineLen * 0.94, 0.3, 0.17, engineX, y0 + 0.3, s * 0.17);
        bank.rotation.x = s * lean;
        const head = b.box(floor, 'engine', cover, engineLen * 0.96, 0.07, 0.19, engineX, y0 + 0.3 + Math.cos(lean) * 0.17, s * (0.17 + Math.sin(lean) * 0.17));
        head.rotation.x = s * lean;
      }
      b.box(floor, 'engine', 0x2a2d38, engineLen * 0.72, 0.09, 0.16, engineX, y0 + 0.44, 0);
      engineTop = y0 + 0.5;
    }
    const turbo = lookOf('turbo');
    if (engine.fx.turbo && turbo) {
      for (const s of [-1, 1]) {
        b.cyl(floor, 'turbo', turbo.c ?? 0x9a6a30, 0.09, 0.09, 'x', engineX - engineLen / 2 - 0.02, y0 + 0.2, s * 0.28, 10);
        b.cyl(floor, 'turbo', 0x8a8f9c, 0.075, 0.07, 'x', engineX - engineLen / 2 - 0.1, y0 + 0.2, s * 0.28, 10);
      }
    }
  }

  const intake = lookOf('intake');
  if (intake) {
    b.box(floor, 'intake', intake.c ?? 0x2a2d38, engineLen * 0.5, 0.12, 0.34, engineX + 0.04, engineTop + 0.07, 0);
    b.cyl(floor, 'intake', intake.c2 ?? intake.c ?? 0x2a2d38, 0.07, 0.24, 'x', engineX + engineLen * 0.25 + 0.14, engineTop + 0.07, 0, 8);
  }

  const exhaust = lookOf('exhaust');
  if (exhaust) {
    const c = exhaust.c ?? 0x9aa0ac;
    const endX = -L / 2 + 0.12;
    for (const s of [-1, 1]) {
      b.tube(floor, 'exhaust', c, 0.045, V(engineX - engineLen * 0.3, FLOOR_Y + 0.14, s * 0.42), V(Math.min(engineX - engineLen / 2 - 0.25, rearX + 0.6), FLOOR_Y + 0.1, s * 0.5));
      b.tube(floor, 'exhaust', c, 0.045, V(Math.min(engineX - engineLen / 2 - 0.25, rearX + 0.6), FLOOR_Y + 0.1, s * 0.5), V(endX + 0.5, FLOOR_Y + 0.12, s * 0.3));
      b.cyl(floor, 'exhaust', c, 0.06, 0.5, 'x', endX + 0.25, FLOOR_Y + 0.12, s * 0.3, 8);
    }
  }

  const cooling = lookOf('cooling');
  if (cooling) {
    const rx = L / 2 - 0.5;
    const rad = b.box(floor, 'cooling', cooling.c ?? 0x8a8f9c, 0.07, 0.36, W * 0.56, rx, FLOOR_Y + 0.26, 0);
    rad.rotation.z = 0.35;
    for (const s of [-1, 1]) b.box(floor, 'cooling', cooling.c2 ?? 0x2a2d38, 0.09, 0.38, 0.06, rx, FLOOR_Y + 0.26, s * W * 0.29).rotation.z = 0.35;
  }

  const fuel = partOf('fuelcell');
  const fuelX = ch.layout === 'front' ? rearX + 0.75 : cabinX1 + 0.12;
  if (fuel) {
    const size = 0.55 + ((fuel.fx.fuelKg ?? 60) - 60) / 100;
    b.box(floor, 'fuelcell', fuel.look.c ?? 0x22242c, 0.42, 0.3, size, fuelX, FLOOR_Y + 0.2, 0);
    b.cyl(floor, 'fuelcell', fuel.look.c2 ?? 0xb4bac6, 0.05, 0.08, 'y', fuelX, FLOOR_Y + 0.39, size * 0.25, 8);
  }

  const ecu = lookOf('ecu');
  if (ecu) {
    b.box(floor, 'ecu', ecu.c ?? 0x8a8f9c, 0.24, 0.06, 0.18, cabinMid + 0.35, FLOOR_Y + 0.07, W * 0.24);
    b.box(floor, 'ecu', ecu.c2 ?? 0x2a2d38, 0.05, 0.05, 0.14, cabinMid + 0.49, FLOOR_Y + 0.07, W * 0.24);
  }

  const intercooler = lookOf('intercooler');
  if (intercooler && engine?.fx.turbo) {
    b.box(floor, 'intercooler', intercooler.c ?? 0x8a8f9c, 0.1, 0.2, W * 0.4, L / 2 - 0.72, FLOOR_Y + 0.2, 0);
    b.box(floor, 'intercooler', intercooler.c2 ?? 0x3a3e4c, 0.12, 0.06, W * 0.42, L / 2 - 0.72, FLOOR_Y + 0.33, 0);
  }
  const oil = lookOf('oil');
  if (oil && oil.style === 1) {
    b.cyl(floor, 'oil', oil.c ?? 0x8a8f9c, 0.085, 0.42, 'y', engineX + engineLen / 2 + 0.16, FLOOR_Y + 0.26, -0.3, 10);
    b.cyl(floor, 'oil', 0x22242c, 0.03, 0.05, 'y', engineX + engineLen / 2 + 0.16, FLOOR_Y + 0.49, -0.3, 8);
  }
  const arb = lookOf('arb');
  if (arb) {
    for (const x of [frontX + 0.3, rearX - 0.3]) {
      b.tube(floor, 'arb', arb.c ?? 0x3a3e4c, 0.016, V(x, FLOOR_Y + 0.12, -W * 0.3), V(x, FLOOR_Y + 0.12, W * 0.3));
      for (const s of [-1, 1]) b.tube(floor, 'arb', arb.c ?? 0x3a3e4c, 0.016, V(x, FLOOR_Y + 0.12, s * W * 0.3), V(x - Math.sign(x) * 0.24, FLOOR_Y + 0.16, s * W * 0.34));
    }
  }
  const louvers = lookOf('louvers');
  if (louvers && (louvers.style ?? 0) > 0) {
    const hoodX = L / 2 - body.cabinStart * L * 0.55;
    for (let i = 0; i < 4; i++) {
      for (const s of [-1, 1]) b.box(shell, 'louvers', louvers.c ?? 0x22242c, 0.05, 0.02, 0.34, hoodX + i * 0.1, body.hoodHeight + 0.045, s * W * 0.2);
    }
    if (louvers.style === 2) {
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) b.box(shell, 'louvers', louvers.c ?? 0x22242c, 0.05, 0.02, 0.2, frontX - 0.1 + i * 0.1, body.hoodHeight * 0.93 + 0.03, s * W * 0.4);
    }
  }

  // --- Drivetrain ----------------------------------------------------------
  const gearbox = lookOf('gearbox');
  const gbDir = ch.layout === 'rear' ? 1 : -1;
  if (gearbox) {
    b.box(floor, 'gearbox', gearbox.c ?? 0x8a8f9c, 0.46, 0.3, 0.3, gearboxX, FLOOR_Y + 0.2, 0);
    b.cyl(floor, 'gearbox', gearbox.c ?? 0x8a8f9c, 0.11, 0.3, 'x', gearboxX + gbDir * 0.36, FLOOR_Y + 0.2, 0, 8, 0.15);
    b.box(floor, 'gearbox', gearbox.c2 ?? 0x5a606c, 0.2, 0.04, 0.32, gearboxX, FLOOR_Y + 0.37, 0);
  }
  const clutch = lookOf('clutch');
  if (clutch) {
    const cx = ch.layout === 'front' ? engineX - engineLen / 2 - 0.05 : (engineX + gearboxX) / 2 - (ch.layout === 'rear' ? 0.1 : -0.12);
    b.cyl(floor, 'clutch', clutch.c ?? 0x8a8f9c, 0.13, 0.06, 'x', cx, FLOOR_Y + 0.2, 0, 14);
    b.cyl(floor, 'clutch', clutch.c2 ?? 0x2a2d38, 0.07, 0.08, 'x', cx, FLOOR_Y + 0.2, 0, 10);
    if (ch.layout === 'front') b.tube(floor, 'clutch', 0x6a6f7c, 0.03, V(cx, FLOOR_Y + 0.2, 0), V(gearboxX + 0.5, FLOOR_Y + 0.2, 0));
  }
  const shift = lookOf('shift');
  if (shift) {
    b.cyl(floor, 'shift', shift.c ?? 0x8a8f9c, 0.04, 0.2, 'x', gearboxX, FLOOR_Y + 0.42, 0.1, 8);
    b.box(floor, 'shift', shift.c2 ?? shift.c ?? 0x8a8f9c, 0.07, 0.07, 0.07, gearboxX + 0.13, FLOOR_Y + 0.42, 0.1);
  }
  const diff = lookOf('diff');
  if (diff) {
    const sphere = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 0), b.mat('diff', diff.c ?? 0x8a8f9c));
    sphere.position.set(rearX, FLOOR_Y + 0.2, 0);
    sphere.castShadow = true;
    floor.add(sphere);
  }
  const shafts = lookOf('driveshafts');
  if (shafts) {
    for (const s of [-1, 1]) {
      b.tube(floor, 'driveshafts', shafts.c ?? 0x6a6f7c, 0.028, V(rearX, FLOOR_Y + 0.2, s * 0.12), V(rearX, WHEEL_R, s * (W / 2 - 0.3)));
      b.cyl(floor, 'driveshafts', 0x22242c, 0.05, 0.09, 'z', rearX, FLOOR_Y + 0.21, s * 0.18, 8);
    }
  }

  // --- Cockpit ---------------------------------------------------------------
  const seat = lookOf('seat');
  if (seat) {
    const c = seat.c ?? 0x22242c;
    b.box(floor, 'seat', c, 0.5, 0.1, 0.46, seatX, FLOOR_Y + 0.12, seatZ);
    const back = b.box(floor, 'seat', c, 0.1, 0.72, 0.46, seatX - 0.3, FLOOR_Y + 0.5, seatZ);
    back.rotation.z = 0.22;
    for (const s of [-1, 1]) {
      b.box(floor, 'seat', c, 0.46, 0.2, 0.05, seatX - 0.02, FLOOR_Y + 0.24, seatZ + s * 0.24);
      b.box(floor, 'seat', c, 0.2, 0.2, 0.05, seatX - 0.28, FLOOR_Y + 0.86, seatZ + s * 0.2).rotation.z = 0.22;
    }
    b.box(floor, 'seat', seat.c2 ?? 0xd8232a, 0.03, 0.4, 0.3, seatX - 0.24, FLOOR_Y + 0.46, seatZ).rotation.z = 0.22;
  }
  const harness = lookOf('harness');
  if (harness) {
    const c = harness.c ?? 0xd8232a;
    for (const s of [-1, 1]) b.box(floor, 'harness', c, 0.025, 0.56, 0.06, seatX - 0.21, FLOOR_Y + 0.5, seatZ + s * 0.1).rotation.z = 0.22;
    b.box(floor, 'harness', c, 0.06, 0.025, 0.44, seatX - 0.02, FLOOR_Y + 0.2, seatZ);
    b.box(floor, 'harness', 0xc8ccd6, 0.07, 0.03, 0.07, seatX - 0.02, FLOOR_Y + 0.21, seatZ);
  }
  const steering = lookOf('steering');
  const wheelX = seatX + 0.52;
  if (steering) {
    const y = FLOOR_Y + 0.62;
    b.tube(floor, 'steering', 0x5a606c, 0.022, V(wheelX, y, seatZ), V(wheelX + 0.5, y - 0.14, seatZ));
    const style = steering.style ?? 0;
    if (style === 0) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 6, 14), b.mat('steering', steering.c ?? 0x22242c));
      rim.rotation.y = Math.PI / 2;
      rim.position.set(wheelX, y, seatZ);
      floor.add(rim);
      b.box(floor, 'steering', steering.c2 ?? 0x8a8f9c, 0.02, 0.05, 0.3, wheelX, y, seatZ);
    } else {
      b.box(floor, 'steering', steering.c ?? 0x15161b, 0.035, style === 2 ? 0.2 : 0.16, 0.3, wheelX, y, seatZ);
      for (const s of [-1, 1]) b.box(floor, 'steering', steering.c ?? 0x15161b, 0.04, 0.2, 0.05, wheelX, y - 0.02, seatZ + s * 0.15);
      b.box(floor, 'steering', steering.c2 ?? 0xd8232a, 0.012, style === 2 ? 0.1 : 0.04, style === 2 ? 0.16 : 0.2, wheelX - 0.022, y + 0.02, seatZ);
    }
  }
  const logger = lookOf('logger');
  if (logger) {
    b.box(floor, 'logger', logger.c ?? 0x15161b, 0.05, 0.13, 0.24, wheelX + 0.22, FLOOR_Y + 0.74, seatZ);
    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.09, 0.2), new THREE.MeshBasicMaterial({ color: logger.c2 ?? 0x22a860 }));
    screen.position.set(wheelX + 0.19, FLOOR_Y + 0.74, seatZ);
    floor.add(screen);
  }
  const pedals = lookOf('pedals');
  if (pedals) {
    const px = wheelX + 0.62;
    b.box(floor, 'pedals', pedals.c ?? 0x8a8f9c, 0.3, 0.03, 0.34, px, FLOOR_Y + 0.05, seatZ);
    for (let i = -1; i <= 1; i++) b.box(floor, 'pedals', 0xc8ccd6, 0.03, 0.2, 0.06, px + 0.04, FLOOR_Y + 0.16, seatZ + i * 0.11).rotation.z = -0.4;
    for (const s of [-1, 1]) b.cyl(floor, 'pedals', pedals.c ?? 0x8a8f9c, 0.025, 0.14, 'x', px + 0.2, FLOOR_Y + 0.14, seatZ + s * 0.06, 6);
  }
  const fire = lookOf('fire');
  if (fire) {
    b.cyl(floor, 'fire', fire.c ?? 0xd8232a, 0.07, 0.36, 'x', cabinMid + 0.05, FLOOR_Y + 0.1, W * 0.2, 10);
    b.cyl(floor, 'fire', fire.c2 ?? 0xb4bac6, 0.03, 0.06, 'x', cabinMid + 0.26, FLOOR_Y + 0.1, W * 0.2, 8);
  }
  const battery = lookOf('battery');
  if (battery) {
    b.box(floor, 'battery', battery.c ?? 0x22242c, 0.2, 0.16, 0.14, cabinMid - 0.4, FLOOR_Y + 0.11, W * 0.26);
    for (const s of [-1, 1]) b.cyl(floor, 'battery', 0xc8a030, 0.015, 0.03, 'y', cabinMid - 0.4 + s * 0.06, FLOOR_Y + 0.2, W * 0.26, 6);
  }
  const loom = lookOf('loom');
  if (loom) {
    const c = loom.c ?? 0x3a3e4c;
    b.tube(floor, 'loom', c, 0.014, V(L / 2 - 0.7, FLOOR_Y + 0.05, W * 0.33), V(-L / 2 + 0.7, FLOOR_Y + 0.05, W * 0.33));
    b.tube(floor, 'loom', c, 0.012, V(cabinMid + 0.35, FLOOR_Y + 0.05, W * 0.33), V(cabinMid + 0.35, FLOOR_Y + 0.07, W * 0.24));
    for (const x of [L / 2 - 0.8, cabinMid, -L / 2 + 0.9]) b.box(floor, 'loom', loom.c2 ?? 0xc8ccd6, 0.06, 0.035, 0.035, x, FLOOR_Y + 0.05, W * 0.33);
  }
  const abs = partOf('abs');
  if (abs && (abs.fx.abs ?? 0) > 0) {
    b.box(floor, 'abs', abs.look.c ?? 0x8a8f9c, 0.14, 0.12, 0.12, frontX - 0.05, FLOOR_Y + 0.12, W * 0.26);
    b.box(floor, 'abs', abs.look.c2 ?? 0x2a2d38, 0.08, 0.06, 0.1, frontX - 0.05, FLOOR_Y + 0.21, W * 0.26);
  }
  const jacks = lookOf('airjacks');
  if (jacks && (jacks.style ?? 0) > 0) {
    const spots = jacks.style === 4
      ? [[frontX - 0.5, 0.42], [frontX - 0.5, -0.42], [rearX + 0.55, 0.42], [rearX + 0.55, -0.42]]
      : [[frontX - 0.5, 0], [rearX + 0.55, 0.42], [rearX + 0.55, -0.42]];
    for (const [x, z] of spots) {
      b.cyl(floor, 'airjacks', jacks.c ?? 0xb4bac6, 0.04, 0.34, 'y', x, FLOOR_Y + 0.15, z * W * 0.5, 8);
      b.cyl(floor, 'airjacks', 0x5a606c, 0.055, 0.03, 'y', x, FLOOR_Y - 0.03, z * W * 0.5, 8);
    }
  }

  // --- Corners: wheels, tyres, brakes, dampers, springs --------------------
  const wheels: THREE.Group[] = [];
  const wheelSide: number[] = [];
  const wheelLook = lookOf('wheels');
  const tyreLook = lookOf('tyres');
  const discLook = lookOf('discs');
  const caliperLook = lookOf('calipers');
  const padLook = lookOf('pads');
  const damperLook = lookOf('dampers');
  const springLook = lookOf('springs');
  for (const x of [frontX, rearX]) {
    for (const s of [-1, 1]) {
      const corner = new THREE.Group();
      const hubZ = s * (W / 2 - 0.16);
      corner.position.set(x, WHEEL_R, hubZ);
      root.add(corner);
      wheels.push(corner);
      wheelSide.push(s);

      if (tyreLook) {
        const tyre = b.cyl(corner, 'tyres', 0x1b1c22, WHEEL_R, 0.31, 'z', 0, 0, 0, 18);
        tyre.receiveShadow = true;
        const mark = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R * 0.84, 0.012, 4, 20), b.mat('tyres', tyreLook.c ?? 0xe8e8ee));
        mark.position.z = s * 0.158;
        corner.add(mark);
      }
      if (wheelLook) {
        const c = wheelLook.c ?? 0xb8bcc8;
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(WHEEL_R * 0.68, WHEEL_R * 0.68, 0.3, 16, 1, true), b.mat('wheels', c));
        barrel.geometry.rotateX(Math.PI / 2);
        (barrel.material as THREE.Material).side = THREE.DoubleSide;
        corner.add(barrel);
        const spokes = wheelLook.style ?? 6;
        for (let i = 0; i < spokes; i++) {
          const spoke = new THREE.Mesh(new THREE.BoxGeometry(WHEEL_R * 0.66, spokes > 8 ? 0.022 : 0.04, 0.03), b.mat('wheels', c));
          const a = (i / spokes) * Math.PI * 2;
          spoke.position.set(Math.cos(a) * WHEEL_R * 0.34, Math.sin(a) * WHEEL_R * 0.34, s * 0.13);
          spoke.rotation.z = a;
          corner.add(spoke);
        }
        b.cyl(corner, 'wheels', 0x2a2d38, 0.05, 0.05, 'z', 0, 0, s * 0.15, 6);
      }
      if (discLook) {
        b.cyl(corner, 'discs', discLook.c ?? 0x9aa0ac, discLook.style === 0 ? 0.18 : 0.2, 0.034, 'z', 0, 0, -s * 0.02, 16);
        b.cyl(corner, 'discs', 0x3a3e4c, 0.09, 0.05, 'z', 0, 0, -s * 0.02, 10);
      }
      if (caliperLook) {
        const cal = b.box(corner, 'calipers', caliperLook.c ?? 0xd8232a, 0.2, 0.09, 0.1, (x === frontX ? -1 : 1) * 0.14, 0.11, -s * 0.02);
        cal.rotation.z = (x === frontX ? 1 : -1) * 0.9;
      }
      if (padLook) {
        b.box(corner, 'pads', padLook.c ?? 0xf2c21a, 0.08, 0.03, 0.105, (x === frontX ? -1 : 1) * 0.105, 0.085, -s * 0.02).rotation.z = (x === frontX ? 1 : -1) * 0.9;
      }
      // Coil-over from the upright up to the body.
      const low = V(x - 0.02, WHEEL_R + 0.02, hubZ - s * 0.24);
      const high = V(x - 0.06, 0.74, hubZ - s * 0.42);
      if (damperLook) {
        b.tube(floor, 'dampers', damperLook.c ?? 0xf2c21a, 0.03, low, high);
        b.tube(floor, 'dampers', 0xc8ccd6, 0.014, low.clone().lerp(high, -0.35), low);
        b.cyl(floor, 'dampers', damperLook.c ?? 0xf2c21a, 0.03, 0.14, 'y', high.x - 0.1, high.y - 0.05, high.z, 8);
      }
      if (springLook) {
        const dir = high.clone().sub(low).normalize();
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
        for (let i = 0; i < 5; i++) {
          const coil = new THREE.Mesh(new THREE.TorusGeometry(0.052, 0.011, 4, 10), b.mat('springs', springLook.c ?? 0xd8232a));
          coil.position.copy(low).lerp(high, 0.32 + i * 0.14);
          coil.quaternion.copy(q);
          floor.add(coil);
        }
      }
      // Wishbones, part of the rolling shell.
      b.tube(floor, 'chassis', 0x3a3e4c, 0.016, V(x + 0.22, FLOOR_Y + 0.08, s * 0.32), V(x, WHEEL_R - 0.1, hubZ - s * 0.2));
      b.tube(floor, 'chassis', 0x3a3e4c, 0.016, V(x - 0.22, FLOOR_Y + 0.08, s * 0.32), V(x, WHEEL_R - 0.1, hubZ - s * 0.2));
    }
  }

  const baseZ = wheels.map((w) => w.position.z);
  const highlightColor = new THREE.Color();
  let highlighted: THREE.MeshLambertMaterial[] = [];

  const focus: Partial<Record<SlotId, [number, number, number, number]>> = {
    chassis: [0, 0.6, 0, 7.4], windows: [cabinMid, 1.0, 0, 5.4],
    seat: [seatX, 0.6, seatZ, 3.6], harness: [seatX, 0.6, seatZ, 3.2], fire: [cabinMid, 0.3, W * 0.2, 3.2], airjacks: [0, 0.3, 0, 6],
    splitter: [L / 2, 0.3, 0, 4], wing: [wingX, body.wingHeight, 0, 4.2], diffuser: [-L / 2 + 0.3, 0.25, 0, 4],
    engine: [engineX, 0.5, 0, 3.4], intake: [engineX, 0.7, 0, 3], exhaust: [(engineX - L / 2) / 2, 0.3, 0, 4], ecu: [cabinMid + 0.35, 0.3, W * 0.24, 2.8],
    cooling: [L / 2 - 0.5, 0.4, 0, 3.4], fuelcell: [fuelX, 0.4, 0, 3.2],
    clutch: [(engineX + gearboxX) / 2, 0.35, 0, 3], gearbox: [gearboxX, 0.4, 0, 3.2], shift: [gearboxX, 0.5, 0.1, 2.8], diff: [rearX, 0.35, 0, 3], driveshafts: [rearX, 0.35, 0, 3.6],
    dampers: [frontX, 0.55, -W / 2 + 0.4, 3.2], springs: [frontX, 0.55, -W / 2 + 0.4, 3], steering: [wheelX, 0.8, seatZ, 2.8],
    discs: [frontX, WHEEL_R, -W / 2, 2.8], pads: [frontX, WHEEL_R, -W / 2, 2.6], calipers: [frontX, WHEEL_R, -W / 2, 2.6], abs: [frontX, 0.3, W * 0.26, 3], pedals: [wheelX + 0.6, 0.3, seatZ, 2.8],
    wheels: [frontX, WHEEL_R, -W / 2, 3.2], tyres: [frontX, WHEEL_R, -W / 2, 3.4],
    logger: [wheelX + 0.2, 0.9, seatZ, 2.6], loom: [0, 0.2, W * 0.33, 5], battery: [cabinMid - 0.4, 0.3, W * 0.26, 2.8],
  };

  const engineSlots: SlotId[] = ['pistons', 'rods', 'crank', 'valvetrain', 'oil', 'flywheel', 'throttle', 'injectors', 'ignition', 'turbo', 'oilcooler'];
  for (const s of engineSlots) focus[s] = focus.engine;
  focus.intercooler = focus.cooling;
  focus.fuelpump = focus.fuelcell;
  focus.finaldrive = focus.diff;
  focus.cage = [cabinMid, 0.7, 0, 5];
  focus.cooldriver = focus.seat;
  focus.radio = focus.seat;
  focus.mirrors = focus.windows;
  focus.lights = [L / 2, 0.5, 0, 4];
  focus.canards = focus.splitter;
  focus.louvers = [L / 2 - 0.8, 0.8, 0, 4];
  for (const s of ['arb', 'arms', 'uprights', 'rack'] as const) focus[s] = focus.dampers;
  for (const s of ['lines', 'ducts', 'nuts'] as const) focus[s] = focus.discs;
  for (const s of ['pdm', 'sensors'] as const) focus[s] = focus.ecu;

  return {
    root,
    length: L,
    setExplode(t: number): void {
      shell.position.y = t * 1.35;
      // The lifted body fades to a ghost so it never hides what is underneath.
      const ghost = t > 0.02;
      shellMat.transparent = ghost;
      shellMat.opacity = 1 - 0.8 * t;
      shellMat.depthWrite = !ghost;
      shellMesh.castShadow = !ghost;
      wheels.forEach((w, i) => {
        w.position.z = baseZ[i] + wheelSide[i] * t * 0.6;
      });
    },
    setHighlight(slot: SlotId | null): void {
      for (const m of highlighted) m.emissive.setHex(0);
      highlighted = slot ? (b.bySlot.get(slot) ?? []) : [];
    },
    tick(time: number): void {
      const pulse = 0.1 + 0.1 * (0.5 + 0.5 * Math.sin(time * 5));
      highlightColor.setRGB(pulse, pulse * 0.85, pulse * 0.25);
      for (const m of highlighted) m.emissive.copy(highlightColor);
    },
    focusOf(slot: SlotId) {
      const f = focus[slot] ?? [0, 0.6, 0, 7];
      return { point: V(f[0], f[1], f[2]), distance: f[3] };
    },
  };
}
