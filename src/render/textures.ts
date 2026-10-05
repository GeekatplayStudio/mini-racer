import * as THREE from 'three';
import { Rng } from '../sim/rng';

/** Small hand-rolled pixel-art textures, generated once at start-up. */

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is not available');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, repeat = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function speckle(
  ctx: CanvasRenderingContext2D,
  rng: Rng,
  w: number,
  h: number,
  colors: readonly string[],
  density: number,
  maxSize = 1,
): void {
  const count = Math.floor(w * h * density);
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rng.pick(colors);
    const s = rng.int(1, maxSize);
    ctx.fillRect(rng.int(0, w - 1), rng.int(0, h - 1), s, s);
  }
}

/** Mown grass: two-tone stripes with tufts. One tile covers two stripes. */
export function grassTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const rng = new Rng(11);
  ctx.fillStyle = '#4c9a3a';
  ctx.fillRect(0, 0, 128, 64);
  ctx.fillStyle = '#448e36';
  ctx.fillRect(0, 64, 128, 64);
  speckle(ctx, rng, 128, 128, ['#58a842', '#3f8532', '#4f9f3d', '#3a7c30'], 0.22, 2);
  speckle(ctx, rng, 128, 128, ['#6dbb4c', '#35722d'], 0.035, 1);
  return finish(canvas);
}

export function asphaltTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const rng = new Rng(23);
  ctx.fillStyle = '#4a4d57';
  ctx.fillRect(0, 0, 128, 128);
  speckle(ctx, rng, 128, 128, ['#52555f', '#44474f', '#4e515a', '#404249'], 0.5, 2);
  speckle(ctx, rng, 128, 128, ['#5e616b', '#393b42'], 0.05, 1);
  // Faint surface seams along the direction of travel.
  ctx.fillStyle = 'rgba(30,31,36,0.18)';
  ctx.fillRect(63, 0, 1, 128);
  return finish(canvas);
}

export function gravelTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const rng = new Rng(37);
  ctx.fillStyle = '#c9b68c';
  ctx.fillRect(0, 0, 64, 64);
  speckle(ctx, rng, 64, 64, ['#d6c59e', '#b9a67c', '#c2ae84', '#ddcfaa', '#a8956d'], 0.75, 1);
  return finish(canvas);
}

export function paddockTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const rng = new Rng(41);
  ctx.fillStyle = '#6b6e78';
  ctx.fillRect(0, 0, 64, 64);
  speckle(ctx, rng, 64, 64, ['#737680', '#64676f', '#6f727c'], 0.5, 2);
  return finish(canvas);
}

/** Rows of spectators: bright dots on dark terracing. */
export function crowdTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 32);
  const rng = new Rng(53);
  const shirts = ['#e04848', '#f0d040', '#4a8ae0', '#f4f4f0', '#48b060', '#e88a30', '#b060d0', '#30c0c8', '#d8d8e0'];
  for (let row = 0; row < 8; row++) {
    ctx.fillStyle = row % 2 === 0 ? '#3a3f52' : '#31364a';
    ctx.fillRect(0, row * 4, 128, 4);
    for (let x = rng.int(0, 1); x < 128; x += rng.int(2, 3)) {
      if (rng.next() < 0.12) continue;
      ctx.fillStyle = rng.pick(shirts);
      ctx.fillRect(x, row * 4 + 1, 2, 2);
      ctx.fillStyle = rng.next() < 0.5 ? '#f0c8a0' : '#b88860';
      ctx.fillRect(x, row * 4, 1, 1);
    }
  }
  return finish(canvas);
}

/** Pit building front: garage doors under a windowed upper floor. */
export function pitBuildingTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(32, 32);
  ctx.fillStyle = '#e4e6ec';
  ctx.fillRect(0, 0, 32, 32);
  ctx.fillStyle = '#c23a3a';
  ctx.fillRect(0, 0, 32, 3);
  ctx.fillStyle = '#5a82b8';
  ctx.fillRect(3, 6, 26, 6);
  ctx.fillStyle = '#89b0de';
  ctx.fillRect(3, 6, 26, 2);
  ctx.fillStyle = '#2a2d38';
  ctx.fillRect(4, 16, 24, 16);
  ctx.fillStyle = '#3a3e4c';
  for (let y = 18; y < 32; y += 3) ctx.fillRect(4, y, 24, 1);
  return finish(canvas);
}

export function checkerTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(8, 2);
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 2; y++) {
      ctx.fillStyle = (x + y) % 2 === 0 ? '#f4f4f0' : '#1a1a22';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const tex = finish(canvas);
  tex.minFilter = THREE.NearestFilter;
  return tex;
}
