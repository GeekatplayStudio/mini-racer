import * as THREE from 'three';
import { Mesher, paintMaterial } from './mesher';

/** What the figure needs of a driver's chosen look; colours are CSS hex strings. */
export interface FigureLook {
  skin: string;
  hair: string;
  suit: string;
  helmet: string;
  female: boolean;
  /** Index into the hair styles: shaved, crop, short, side part, quiff, curly, medium, long, ponytail, bun, mohawk. */
  hairStyle: number;
  /** None, team cap, backwards cap, headset, beanie. */
  hat: number;
  /** None, glasses, sunglasses, aviators. */
  glasses: number;
}

/** A driver standing in race overalls, facing +z, helmet held at the right hip. One merged mesh. */
export function buildDriverFigure(look: FigureLook): THREE.Mesh {
  const m = new Mesher();
  const C = (c: string | number): THREE.Color => new THREE.Color(c);
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const skin = C(look.skin);
  const skinDark = skin.clone().multiplyScalar(0.8);
  const hair = C(look.hair);
  const stubble = hair.clone().lerp(skin, 0.55);
  const suit = C(look.suit);
  const suitDark = suit.clone().multiplyScalar(0.62);
  const trim = C(0xf4f4f0);
  // A sponsor colour that stands out on the suit.
  const sponsor = C(suit.getHSL({ h: 0, s: 0, l: 0 }).l > 0.55 ? 0x1f6fe0 : 0xf2c21a);
  const glove = C(0x22242c);
  const boot = C(0x1a1b22);
  const slim = look.female ? 0.88 : 1;

  // Boots with white soles, legs with a stripe down the outside and knee pads.
  for (const s of [-1, 1]) {
    const x = s * 0.1;
    m.box(0.12, 0.08, 0.27, boot, x, 0.055, 0.03);
    m.box(0.125, 0.025, 0.275, trim, x, 0.0125, 0.03);
    m.box(0.13, 0.035, 0.1, suitDark, x, 0.11, -0.01);
    m.box(0.13, 0.4, 0.15, suit, x, 0.33, 0);
    m.box(0.15 * slim + 0.01, 0.42, 0.17, suit, x, 0.72, 0);
    m.box(0.012, 0.8, 0.06, trim, s * (0.1 + 0.075 * slim + 0.012), 0.53, 0);
    m.box(0.1, 0.09, 0.012, suitDark, x, 0.52, 0.081);
  }
  // Hips and belt.
  m.box(0.38, 0.12, 0.21, suit, 0, 0.94, 0);
  m.box(0.385, 0.055, 0.215, 0x22242c, 0, 0.98, 0);
  m.box(0.06, 0.04, 0.012, 0xc8ccd6, 0, 0.98, 0.11);
  // Torso: waist, chest and shoulders, with panels and patches like a real suit.
  m.box(0.36 * slim, 0.18, 0.2, suit, 0, 1.09, 0);
  m.box(0.44 * slim, 0.28, 0.23, suit, 0, 1.3, 0);
  m.box(0.5 * slim, 0.08, 0.22, suit, 0, 1.42, 0);
  for (const s of [-1, 1]) {
    m.box(0.012, 0.4, 0.16, suitDark, s * 0.222 * slim, 1.25, 0);
    m.box(0.13, 0.02, 0.2, trim, s * 0.18 * slim, 1.465, 0);
  }
  m.box(0.445 * slim, 0.045, 0.235, trim, 0, 1.22, 0);
  m.box(0.1, 0.06, 0.012, sponsor, 0.1 * slim, 1.36, 0.118);
  m.box(0.08, 0.035, 0.012, trim, -0.1 * slim, 1.37, 0.118);
  m.box(0.16, 0.05, 0.012, sponsor, 0, 1.1, 0.102);
  m.box(0.012, 0.18, 0.012, 0x8a8f9c, 0, 1.33, 0.118);
  // Collar and neck.
  m.cyl(0.08, 0.085, 0.06, 8, trim, 0, 1.48, 0);
  m.cyl(0.052, 0.055, 0.08, 6, skin, 0, 1.54, 0);

  // Left arm hangs by the side, gloved hand with a thumb.
  const lx = -0.27 * slim;
  m.bar(V(lx, 1.43, 0), V(lx - 0.03, 1.13, 0.01), 0.115, suit);
  m.bar(V(lx - 0.03, 1.13, 0.01), V(lx - 0.035, 0.86, 0.04), 0.1, suit);
  m.box(0.105, 0.03, 0.11, trim, lx - 0.035, 0.87, 0.04);
  m.box(0.08, 0.11, 0.06, glove, lx - 0.035, 0.79, 0.045);
  m.box(0.03, 0.05, 0.03, glove, lx - 0.005, 0.8, 0.075);
  // Right arm curls round the helmet at the hip.
  const rx = 0.27 * slim;
  const hx = rx + 0.1, hy = 0.95, hz = 0.18;
  m.bar(V(rx, 1.43, 0), V(rx + 0.03, 1.15, 0), 0.115, suit);
  m.bar(V(rx + 0.03, 1.15, 0), V(hx + 0.02, 1.1, hz + 0.02), 0.1, suit);
  m.box(0.1, 0.06, 0.12, glove, hx + 0.02, 1.1, hz + 0.08);
  m.blob(0.155, 1, C(look.helmet), hx, hy, hz, 1, 0.95, 1.08);
  m.box(0.04, 0.02, 0.32, trim, hx, hy + 0.145, hz - 0.01);
  m.box(0.22, 0.075, 0.05, 0x16202e, hx, hy + 0.01, hz + 0.15);
  m.box(0.06, 0.02, 0.052, 0x5a7aa8, hx + 0.05, hy + 0.03, hz + 0.152);
  m.box(0.16, 0.05, 0.05, 0x22242c, hx, hy - 0.09, hz + 0.13);

  // Head: crown and a narrower jaw, ears, eyes, brows, nose and mouth.
  m.box(0.2, 0.16, 0.22, skin, 0, 1.75, 0);
  m.box(0.17 * (look.female ? 0.94 : 1), 0.09, 0.2, skin, 0, 1.63, 0.005);
  for (const s of [-1, 1]) {
    m.box(0.025, 0.06, 0.045, skinDark, s * 0.108, 1.71, -0.01);
    m.box(0.045, 0.026, 0.006, 0xf4f4f0, s * 0.048, 1.725, 0.111);
    m.box(0.02, 0.024, 0.006, 0x2a2420, s * 0.045, 1.725, 0.114);
    m.box(0.055, 0.013, 0.008, hair, s * 0.05, 1.764, 0.112);
  }
  m.box(0.03, 0.05, 0.03, skinDark, 0, 1.69, 0.118);
  m.box(0.065, 0.013, 0.006, look.female ? 0xb04a50 : 0x7a4038, 0, 1.635, 0.106);

  // Hair: the top is hidden under a cap or beanie, the back and sides still show.
  const capped = look.hat === 1 || look.hat === 2 || look.hat === 4;
  const h = look.hairStyle;
  if (h === 0 || h === 10) m.box(0.205, 0.02, 0.225, stubble, 0, 1.835, 0);
  if (h > 0 && !capped) {
    if (h === 10) {
      m.box(0.05, 0.09, 0.25, hair, 0, 1.87, -0.005);
    } else {
      const crop = h === 1 ? 0.035 : 0.06;
      m.box(0.215, crop, 0.235, hair, 0, 1.82 + crop / 2, -0.005);
      if (h === 2) m.box(0.2, 0.03, 0.04, hair, 0, 1.815, 0.1);
      if (h === 3) m.box(0.13, 0.05, 0.05, hair, -0.04, 1.83, 0.1, 0, 0, 0.12);
      if (h === 4) m.box(0.15, 0.08, 0.11, hair, 0, 1.88, 0.06, -0.3, 0, 0);
      if (h === 5) for (const [x, z] of [[-0.06, 0.05], [0.06, 0.05], [0, -0.03], [-0.07, -0.07], [0.07, -0.07]]) m.blob(0.06, 0, hair, x, 1.86, z);
    }
  }
  if (h > 0 && h !== 10) {
    const drop = h === 7 ? 0.36 : h === 6 ? 0.2 : 0.12;
    m.box(0.215, drop, 0.045, hair, 0, 1.83 - drop / 2, -0.115);
    const side = Math.min(drop, 0.16);
    for (const s of [-1, 1]) m.box(0.02, side, 0.13, hair, s * 0.108, 1.83 - side / 2, -0.04);
    if (h === 7) m.box(0.26, 0.12, 0.08, hair, 0, 1.52, -0.11);
    if (h === 8) {
      m.bar(V(0, 1.78, -0.13), V(0, 1.5, -0.19), 0.06, hair);
      m.box(0.07, 0.03, 0.07, suit, 0, 1.76, -0.14);
    }
    if (h === 9) m.blob(0.07, 0, hair, 0, 1.84, -0.14);
  }
  if (look.hat === 1 || look.hat === 2) {
    m.box(0.225, 0.08, 0.24, suit, 0, 1.87, 0);
    m.box(0.04, 0.03, 0.04, trim, 0, 1.92, 0);
    m.box(0.2, 0.02, 0.13, suitDark, 0, 1.835, look.hat === 1 ? 0.17 : -0.17);
    m.box(0.07, 0.04, 0.012, trim, 0, 1.87, look.hat === 1 ? 0.121 : -0.121);
  } else if (look.hat === 4) {
    m.box(0.225, 0.1, 0.24, suit, 0, 1.87, 0);
    m.box(0.23, 0.035, 0.245, trim, 0, 1.83, 0);
    m.blob(0.035, 0, trim, 0, 1.935, 0);
  } else if (look.hat === 3) {
    m.box(0.24, 0.025, 0.04, 0x16171d, 0, 1.86, 0);
    for (const s of [-1, 1]) m.box(0.04, 0.09, 0.08, 0x16171d, s * 0.12, 1.72, 0);
    m.bar(V(-0.13, 1.7, 0.02), V(-0.06, 1.64, 0.13), 0.014, 0x16171d);
  }
  if (look.glasses > 0) {
    const frame = look.glasses === 3 ? 0xc8a030 : 0x22242c;
    const lens = look.glasses === 1 ? 0x9fc4e0 : 0x101014;
    const big = look.glasses === 3 ? 1.2 : 1;
    m.box(0.21, 0.012, 0.01, frame, 0, 1.738, 0.12);
    for (const s of [-1, 1]) m.box(0.056 * big, 0.04 * big, 0.008, lens, s * 0.048, 1.722, 0.121);
  }

  const mesh = new THREE.Mesh(m.build(), paintMaterial());
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}
