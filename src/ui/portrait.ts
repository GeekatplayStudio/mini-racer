import type { DriverLook } from '../game/profile';

/** Preset appearance options. Each DriverLook field indexes one of these lists. */
export const LOOK_OPTIONS = {
  sex: ['Male', 'Female'],
  age: ['Rookie', 'Prime', 'Veteran'],
  face: ['Oval', 'Square', 'Narrow', 'Round'],
  skin: ['#fbe0c8', '#f6d3b4', '#e8b88e', '#d39a6a', '#b97c4e', '#8f5a38', '#6a4128', '#4a2c1c'],
  eyes: ['#3a2a1c', '#2a6fd6', '#2f8a4a', '#8a6a30', '#6a7078'],
  hair: ['Shaved', 'Crop', 'Short', 'Side part', 'Quiff', 'Curly', 'Medium', 'Long', 'Ponytail', 'Bun', 'Mohawk'],
  hairColor: ['#14100e', '#3a2416', '#6a4020', '#a8702c', '#d8b060', '#f0e0a0', '#b03a1e', '#c8c8cc', '#3a6ad8', '#d848a0'],
  beard: ['None', 'Stubble', 'Moustache', 'Goatee', 'Full', 'Long'],
  glasses: ['None', 'Glasses', 'Sunglasses', 'Aviators'],
  hat: ['None', 'Team cap', 'Backwards cap', 'Headset', 'Beanie'],
  suit: ['#d8232a', '#1f6fe0', '#f2c21a', '#1fa85a', '#f4f4f0', '#22242c', '#f07a1c', '#8a35d6', '#10b6d8', '#e84a8a'],
  helmet: ['#f4f4f0', '#d8232a', '#1f6fe0', '#f2c21a', '#22242c', '#1fa85a', '#f07a1c', '#e84a8a', '#10b6d8', '#8a35d6'],
} as const;

export type LookKey = keyof typeof LOOK_OPTIONS;

export const LOOK_KEYS: readonly LookKey[] = ['sex', 'age', 'face', 'skin', 'eyes', 'hair', 'hairColor', 'beard', 'glasses', 'hat', 'suit', 'helmet'];

export const LOOK_LABELS: Record<LookKey, string> = {
  sex: 'Sex', age: 'Age', face: 'Face', skin: 'Skin', eyes: 'Eyes', hair: 'Hair', hairColor: 'Hair colour',
  beard: 'Facial hair', glasses: 'Eyewear', hat: 'Headwear', suit: 'Race suit', helmet: 'Helmet',
};

export const SWATCH_KEYS: ReadonlySet<LookKey> = new Set<LookKey>(['skin', 'eyes', 'hairColor', 'suit', 'helmet']);

export function defaultLook(): DriverLook {
  return { sex: 0, skin: 2, hair: 2, hairColor: 1, beard: 0, helmet: 1, suit: 0, age: 1, face: 0, eyes: 0, glasses: 0, hat: 0 };
}

/** Value of a look field, tolerant of saves made before the field existed. */
export function lookValue(look: DriverLook, key: LookKey): number {
  const v = (look as unknown as Record<string, number | undefined>)[key] ?? 0;
  return Math.min(LOOK_OPTIONS[key].length - 1, Math.max(0, v));
}

export function lookColor(look: DriverLook, key: 'skin' | 'eyes' | 'hairColor' | 'suit' | 'helmet'): string {
  return LOOK_OPTIONS[key][lookValue(look, key)];
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

/** Draws a 48x48 pixel-art portrait: shaded face, hair, eyewear, headwear, race suit and helmet. */
export function drawPortrait(canvas: HTMLCanvasElement, look: DriverLook): void {
  canvas.width = canvas.height = 48;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const px = (color: string, x: number, y: number, w = 1, h = 1): void => {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  };
  const v = (k: LookKey): number => lookValue(look, k);
  const skin = lookColor(look, 'skin');
  const lit = shade(skin, 1.1);
  const dark = shade(skin, 0.8);
  const deep = shade(skin, 0.64);
  const veteran = v('age') === 2;
  const hair = veteran && v('hairColor') < 7 ? '#b8b8be' : lookColor(look, 'hairColor');
  const hairDark = shade(hair.startsWith('#') ? hair : '#b8b8be', 0.7);
  const suit = lookColor(look, 'suit');
  const helmet = lookColor(look, 'helmet');
  const female = v('sex') === 1;
  const face = v('face');

  // Backdrop: pit garage with a light band.
  px('#263a62', 0, 0, 48, 48);
  px('#2f4878', 0, 0, 48, 14);
  px('#1e2e50', 0, 34, 48, 14);
  for (let x = 2; x < 48; x += 9) px('#35508a', x, 3, 5, 1);

  // Shoulders, collar and suit detail.
  px(suit, 6, 38, 36, 10);
  px(shade(suit, 1.18), 6, 38, 36, 2);
  px(shade(suit, 0.72), 6, 46, 36, 2);
  px(suit, 12, 35, 24, 3);
  px('#f4f4f0', 19, 35, 10, 3);
  px('#22242c', 22, 36, 4, 2);
  px('#f4f4f0', 9, 41, 6, 3);
  px('#22242c', 31, 41, 8, 2);
  px(shade(suit, 0.72), 23, 40, 2, 8);

  // Neck.
  px(dark, 19, 30, 10, 6);
  px(deep, 19, 30, 10, 2);

  // Head shape.
  const wide = face === 1 || face === 3 ? 20 : face === 2 ? 16 : 18;
  const x0 = 24 - wide / 2;
  const top = female ? 10 : 9;
  px(skin, x0, top, wide, 19);
  px(skin, x0 + 1, top + 19, wide - 2, 2);
  if (face === 1) px(skin, x0, top + 19, wide, 1);
  else if (face === 2) px(skin, x0 + 3, top + 21, wide - 6, 2);
  else px(skin, x0 + 2, top + 21, wide - 4, 1);
  if (face === 3) px(skin, x0 - 1, top + 6, wide + 2, 9);
  // Light from the left, shadow on the right and under the jaw.
  px(lit, x0 + 1, top + 2, 2, 12);
  px(dark, x0 + wide - 2, top + 3, 2, 15);
  px(dark, x0 + 2, top + 20, wide - 4, 1);
  // Ears.
  px(dark, x0 - 2, top + 8, 2, 5);
  px(dark, x0 + wide, top + 8, 2, 5);
  px(deep, x0 - 1, top + 10, 1, 2);

  // Hair.
  const h = v('hair');
  const hx = x0 - 1, hw = wide + 2;
  if (h === 0) {
    px(shade(skin, 0.9), x0 + 1, top, wide - 2, 1);
  } else {
    px(hair, hx + 1, top - 2, hw - 2, 4);
    px(hair, hx, top, 2, 6);
    px(hair, hx + hw - 2, top, 2, 6);
    px(hairDark, hx + 1, top + 1, hw - 2, 1);
  }
  if (h === 2 || h === 3) px(hair, hx + 2, top - 3, hw - 4, 1);
  if (h === 3) {
    px(hair, hx + 2, top + 2, 9, 2);
    px(hairDark, hx + 10, top + 1, 1, 3);
  }
  if (h === 4) {
    px(hair, hx + 4, top - 5, hw - 8, 3);
    px(hair, hx + 3, top - 3, hw - 5, 2);
  }
  if (h === 5) {
    for (let x = hx; x < hx + hw; x += 3) px(hair, x, top - 4 + ((x / 3) % 2 === 0 ? 0 : 1), 3, 4);
    px(hair, hx - 1, top + 1, 2, 7);
    px(hair, hx + hw - 1, top + 1, 2, 7);
  }
  if (h >= 6 && h <= 8) {
    px(hair, hx, top, 3, 11);
    px(hair, hx + hw - 3, top, 3, 11);
    px(hair, hx + 3, top + 2, 6, 1);
  }
  if (h === 7) {
    px(hair, hx - 1, top + 4, 3, 24);
    px(hair, hx + hw - 2, top + 4, 3, 24);
    px(hairDark, hx - 1, top + 22, 3, 6);
  }
  if (h === 8) {
    px(hair, hx + hw - 1, top + 2, 4, 4);
    px(hair, hx + hw + 1, top + 5, 3, 14);
  }
  if (h === 9) {
    px(hair, 21, top - 6, 7, 5);
    px(hairDark, 21, top - 2, 7, 1);
  }
  if (h === 10) {
    px(shade(skin, 0.9), x0 + 1, top, wide - 2, 1);
    px(hair, 21, top - 6, 6, 8);
    px(hairDark, 21, top + 1, 6, 1);
  }

  // Brows and eyes.
  const eyeY = top + 9;
  const lx = x0 + 3, rx = x0 + wide - 8;
  px(hairDark, lx, eyeY - 3, 5, 1);
  px(hairDark, rx, eyeY - 3, 5, 1);
  if (!female) {
    px(hairDark, lx, eyeY - 4, 4, 1);
    px(hairDark, rx + 1, eyeY - 4, 4, 1);
  }
  for (const ex of [lx, rx]) {
    px('#f8f8f4', ex, eyeY, 5, 3);
    px(lookColor(look, 'eyes'), ex + 2, eyeY, 2, 3);
    px('#0c0a0a', ex + 2, eyeY + 1, 1, 1);
    px('#ffffff', ex + 3, eyeY, 1, 1);
    px(deep, ex, eyeY - 1, 5, 1);
    if (female) px('#0c0a0a', ex === lx ? ex - 1 : ex + 5, eyeY, 1, 1);
  }
  if (veteran) {
    px(dark, lx, eyeY + 4, 4, 1);
    px(dark, rx + 1, eyeY + 4, 4, 1);
    px(dark, x0 + 3, top + 4, wide - 6, 1);
  }
  if (v('age') === 0) {
    px(shade(skin, 1.06), lx - 1, eyeY + 5, 3, 2);
    px('#e8a090', lx, eyeY + 6, 2, 1);
    px('#e8a090', rx + 3, eyeY + 6, 2, 1);
  }

  // Nose and mouth.
  px(dark, 23, eyeY + 2, 2, 5);
  px(deep, 22, eyeY + 7, 4, 1);
  px(lit, 22, eyeY + 3, 1, 3);
  const mouthY = top + 18;
  px(female ? '#c8485a' : deep, 20, mouthY, 8, 1);
  px(female ? '#e06878' : dark, 21, mouthY + 1, 6, 1);

  // Facial hair.
  const b = v('beard');
  if (b === 1) {
    for (let y = 0; y < 5; y++) for (let x = x0 + 1 + (y % 2); x < x0 + wide - 1; x += 2) px(shade(skin, 0.7), x, top + 16 + y, 1, 1);
  }
  if (b === 2 || b === 3 || b === 4 || b === 5) px(hair, 19, mouthY - 2, 10, 2);
  if (b === 3) {
    px(hair, 20, mouthY + 2, 8, 3);
    px(skin, 21, mouthY, 6, 2);
  }
  if (b === 4 || b === 5) {
    px(hair, x0, top + 13, 3, 8);
    px(hair, x0 + wide - 3, top + 13, 3, 8);
    px(hair, x0 + 1, top + 19, wide - 2, 4);
    px(female ? '#c8485a' : deep, 21, mouthY, 6, 1);
  }
  if (b === 5) {
    px(hair, x0 + 3, top + 23, wide - 6, 5);
    px(hairDark, x0 + 5, top + 27, wide - 10, 2);
  }

  // Eyewear.
  const g = v('glasses');
  if (g === 1) {
    for (const ex of [lx - 1, rx - 1]) {
      px('#16171d', ex, eyeY - 1, 7, 1);
      px('#16171d', ex, eyeY + 3, 7, 1);
      px('#16171d', ex, eyeY - 1, 1, 5);
      px('#16171d', ex + 6, eyeY - 1, 1, 5);
    }
    px('#16171d', lx + 6, eyeY, rx - lx - 7, 1);
  } else if (g >= 2) {
    const lens = g === 2 ? '#16171d' : '#3a3020';
    for (const ex of [lx - 1, rx - 1]) {
      px(lens, ex, eyeY - 1, 7, g === 3 ? 5 : 4);
      px(g === 2 ? '#5a82b8' : '#c8a030', ex + 1, eyeY, 2, 1);
    }
    px(lens, lx + 6, eyeY, rx - lx - 7, 1);
    px(lens, x0 - 1, eyeY, 2, 1);
    px(lens, x0 + wide - 1, eyeY, 2, 1);
  }

  // Headwear.
  const hat = v('hat');
  if (hat === 1 || hat === 2) {
    px(suit, hx, top - 4, hw, 6);
    px(shade(suit, 1.2), hx + 1, top - 4, hw - 2, 1);
    px('#f4f4f0', 21, top - 2, 6, 3);
    if (hat === 1) px(shade(suit, 0.7), hx - 2, top + 2, hw + 2, 2);
    else px(shade(suit, 0.7), hx + 2, top + 1, hw - 4, 1);
  } else if (hat === 3) {
    px('#16171d', hx, top - 3, hw, 2);
    px('#16171d', hx - 2, top + 6, 3, 8);
    px('#16171d', hx + hw - 1, top + 6, 3, 8);
    px('#3a3e4c', hx - 1, top + 8, 1, 4);
    px('#16171d', hx - 1, top + 14, 2, 4);
    px('#16171d', hx + 1, top + 17, 6, 1);
    px('#d8232a', hx + 6, top + 16, 2, 2);
  } else if (hat === 4) {
    px(shade(suit, 0.85), hx, top - 4, hw, 8);
    px(suit, hx, top + 2, hw, 2);
    px(shade(suit, 1.2), hx + 2, top - 5, hw - 4, 1);
  }

  // Helmet held at the shoulder.
  px(helmet, 35, 26, 12, 12);
  px(helmet, 37, 24, 8, 2);
  px(shade(helmet, 1.2), 37, 25, 5, 1);
  px(shade(helmet, 0.68), 35, 36, 12, 2);
  px('#16202e', 35, 29, 9, 5);
  px('#5a82b8', 35, 29, 6, 1);
  px(suit, 43, 26, 2, 10);
}

/** Head-and-shoulders crop of the portrait, 32x32, for small frames such as the race radio. */
export function drawFace(canvas: HTMLCanvasElement, look: DriverLook): void {
  const full = document.createElement('canvas');
  drawPortrait(full, look);
  canvas.width = canvas.height = 32;
  canvas.getContext('2d')?.drawImage(full, 8, 3, 32, 32, 0, 0, 32, 32);
}

/** Row of the mouth in the 32-pixel face crop, so a talking overlay can sit on it. */
export function faceMouthRow(look: DriverLook): number {
  return (lookValue(look, 'sex') === 1 ? 10 : 9) + 18 - 3;
}

/**
 * A look for a driver who has none of their own, such as an opponent. The same
 * key always gives the same face.
 */
export function lookFor(key: string): DriverLook {
  // FNV-1a over the key, then a small generator for one value per field.
  let state = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) state = Math.imul(state ^ key.charCodeAt(i), 0x01000193);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const any = (k: LookKey): number => Math.floor(next() * LOOK_OPTIONS[k].length);
  const sex = next() < 0.3 ? 1 : 0;
  // Natural hair colours mostly; the last two are dyes.
  const hairColor = next() < 0.9 ? Math.floor(next() * 8) : 8 + Math.floor(next() * 2);
  return {
    sex,
    age: any('age'),
    face: any('face'),
    skin: any('skin'),
    eyes: any('eyes'),
    hair: sex === 1 ? 5 + Math.floor(next() * 5) : any('hair'),
    hairColor,
    beard: sex === 1 || next() < 0.45 ? 0 : 1 + Math.floor(next() * 5),
    glasses: next() < 0.7 ? 0 : 1 + Math.floor(next() * 3),
    hat: next() < 0.6 ? 0 : 1 + Math.floor(next() * 4),
    suit: any('suit'),
    helmet: any('helmet'),
  };
}
