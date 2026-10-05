import * as THREE from 'three';

type Colour = THREE.Color | number;

const UNIT_BOX = new THREE.BoxGeometry(1, 1, 1).toNonIndexed().getAttribute('position').array as Float32Array;
const DIGITS = [
  '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
  '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
];

/**
 * Collects flat-shaded, vertex-coloured triangles into one geometry, so a model
 * made of many small parts costs a single draw call.
 */
export class Mesher {
  private readonly pos: number[] = [];
  private readonly col: number[] = [];
  private readonly colour = new THREE.Color();
  private readonly local = new THREE.Matrix4();
  private readonly v = new THREE.Vector3();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private base: THREE.Matrix4 | null = null;

  get empty(): boolean {
    return this.pos.length === 0;
  }

  /** Everything added from now on is placed by this matrix; null for none. */
  transform(matrix: THREE.Matrix4 | null): this {
    this.base = matrix ? matrix.clone() : null;
    return this;
  }

  /** Places what follows beside a point: the same convention as Object3D position and y rotation. */
  place(x: number, y: number, z: number, ry = 0): this {
    this.base = new THREE.Matrix4().makeRotationY(ry).setPosition(x, y, z);
    return this;
  }

  private rgb(c: Colour): THREE.Color {
    return typeof c === 'number' ? this.colour.setHex(c) : c;
  }

  private put(p: THREE.Vector3, c: THREE.Color): void {
    const v = this.v.copy(p);
    if (this.base) v.applyMatrix4(this.base);
    this.pos.push(v.x, v.y, v.z);
    this.col.push(c.r, c.g, c.b);
  }

  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, colour: Colour): void {
    const k = this.rgb(colour);
    this.put(a, k);
    this.put(b, k);
    this.put(c, k);
  }

  /** Corners in order round the edge. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, colour: Colour): void {
    this.tri(a, b, c, colour);
    this.tri(a, c, d, colour);
  }

  /** Bakes any geometry in, moved by the given matrix. */
  geo(geometry: THREE.BufferGeometry, colour: Colour, matrix?: THREE.Matrix4): void {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const p = g.getAttribute('position');
    const k = this.rgb(colour);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      if (matrix) v.applyMatrix4(matrix);
      this.put(v, k);
    }
    if (g !== geometry) g.dispose();
    geometry.dispose();
  }

  /** A box by size and centre, turned by Euler angles (XYZ order) if given. */
  box(w: number, h: number, d: number, colour: Colour, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): void {
    const m = this.local.compose(this.s.set(x, y, z).clone(), this.q.setFromEuler(this.e.set(rx, ry, rz)), this.s.set(w, h, d));
    const k = this.rgb(colour);
    const v = new THREE.Vector3();
    for (let i = 0; i < UNIT_BOX.length; i += 3) {
      v.set(UNIT_BOX[i], UNIT_BOX[i + 1], UNIT_BOX[i + 2]).applyMatrix4(m);
      this.put(v, k);
    }
  }

  /** A cylinder or cone with its axis along x, y or z. */
  cyl(rTop: number, rBottom: number, len: number, seg: number, colour: Colour, x: number, y: number, z: number, axis: 'x' | 'y' | 'z' = 'y', open = false): void {
    const g = new THREE.CylinderGeometry(rTop, rBottom, len, seg, 1, open);
    if (axis === 'x') g.rotateZ(-Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    this.geo(g, colour, new THREE.Matrix4().makeTranslation(x, y, z));
  }

  /** A faceted ball, squashed by the given scales. */
  blob(r: number, detail: number, colour: Colour, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1): void {
    this.geo(new THREE.IcosahedronGeometry(r, detail), colour, new THREE.Matrix4().makeScale(sx, sy, sz).setPosition(x, y, z));
  }

  /** A straight bar of square section between two points. */
  bar(a: THREE.Vector3, b: THREE.Vector3, thick: number, colour: Colour): void {
    const len = a.distanceTo(b);
    if (len < 1e-6) return;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).divideScalar(len));
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(thick, len, thick));
    const k = this.rgb(colour);
    const v = new THREE.Vector3();
    for (let i = 0; i < UNIT_BOX.length; i += 3) {
      v.set(UNIT_BOX[i], UNIT_BOX[i + 1], UNIT_BOX[i + 2]).applyMatrix4(m);
      this.put(v, k);
    }
  }

  /**
   * Block digits, as painted on a number panel: `origin` is the bottom-left
   * corner, `right` and `up` are one cell of the 3x5 grid each digit sits in.
   */
  digits(text: string, origin: THREE.Vector3, right: THREE.Vector3, up: THREE.Vector3, colour: Colour): void {
    const at = (cx: number, cy: number): THREE.Vector3 => origin.clone().addScaledVector(right, cx).addScaledVector(up, cy);
    let x = 0;
    for (const ch of text) {
      const glyph = DIGITS[Number(ch)];
      if (glyph) {
        for (let row = 0; row < 5; row++) {
          for (let c = 0; c < 3; c++) {
            if (glyph[row * 3 + c] !== '1') continue;
            // Runs of lit cells along a row become one quad.
            let end = c;
            while (end < 2 && glyph[row * 3 + end + 1] === '1') end++;
            this.quad(at(x + c, 4 - row), at(x + end + 1, 4 - row), at(x + end + 1, 5 - row), at(x + c, 5 - row), colour);
            c = end;
          }
        }
      }
      x += 4;
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    return g;
  }
}

/** Width of a number in digit cells, for centring it. */
export function digitCells(text: string): number {
  return text.length * 4 - 1;
}

let sharedPaint: THREE.MeshLambertMaterial | null = null;

/** The one material every merged, vertex-coloured model can share. */
export function paintMaterial(): THREE.MeshLambertMaterial {
  sharedPaint ??= new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  return sharedPaint;
}
