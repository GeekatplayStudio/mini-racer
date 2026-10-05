import * as THREE from 'three';

const MAX_PUFFS = 800;
const MAX_SKIDS = 3500;

interface Puff {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  maxLife: number;
  size: number;
}

/** Chunky smoke and dust puffs: lit low-poly blobs that swell, then shrink away. */
export class Puffs {
  readonly mesh: THREE.InstancedMesh;
  private readonly puffs: Puff[] = [];
  private next = 0;
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor() {
    this.mesh = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ flatShading: true }),
      MAX_PUFFS,
    );
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < MAX_PUFFS; i++) {
      this.puffs.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1, size: 0 });
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
    this.update(0);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, hex: number): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX_PUFFS;
    const p = this.puffs[i];
    p.x = x; p.y = y; p.z = z;
    p.vx = vx; p.vy = vy; p.vz = vz;
    p.life = life;
    p.maxLife = life;
    p.size = size;
    this.mesh.setColorAt(i, this.color.setHex(hex));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const m = this.matrix;
    for (let i = 0; i < MAX_PUFFS; i++) {
      const p = this.puffs[i];
      let scale = 0;
      if (p.life > 0) {
        p.life -= dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const drag = Math.max(0, 1 - 2.5 * dt);
        p.vx *= drag;
        p.vz *= drag;
        const t = 1 - Math.max(0, p.life) / p.maxLife;
        // Quick swell, slow shrink.
        scale = p.size * (t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8) ;
      }
      m.makeScale(scale, scale * 0.8, scale);
      m.setPosition(p.x, p.y, p.z);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Tyre marks left on the surface: a ring buffer of dark quads. */
export class SkidMarks {
  readonly mesh: THREE.Mesh;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private next = 0;
  private used = 0;

  constructor() {
    this.positions = new Float32Array(MAX_SKIDS * 18);
    this.colors = new Float32Array(MAX_SKIDS * 24);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /** Adds a mark between two wheel positions. */
  add(x0: number, z0: number, x1: number, z1: number, width: number, alpha: number, shade: number): void {
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4) return;
    const px = (-dz / len) * width * 0.5, pz = (dx / len) * width * 0.5;
    const y = 0.046;
    const p = this.next * 18;
    const v = this.positions;
    const corners = [
      x0 - px, z0 - pz, x0 + px, z0 + pz, x1 - px, z1 - pz,
      x0 + px, z0 + pz, x1 + px, z1 + pz, x1 - px, z1 - pz,
    ];
    for (let k = 0; k < 6; k++) {
      v[p + k * 3] = corners[k * 2];
      v[p + k * 3 + 1] = y;
      v[p + k * 3 + 2] = corners[k * 2 + 1];
      const c = this.next * 24 + k * 4;
      this.colors[c] = shade;
      this.colors[c + 1] = shade;
      this.colors[c + 2] = shade;
      this.colors[c + 3] = alpha;
    }
    this.next = (this.next + 1) % MAX_SKIDS;
    this.used = Math.min(MAX_SKIDS, this.used + 1);
    const geo = this.mesh.geometry;
    geo.setDrawRange(0, this.used * 6);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
  }
}
