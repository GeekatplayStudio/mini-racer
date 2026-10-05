import * as THREE from 'three';
import type { Puddle, Weather } from '../sim/race';
import type { Track } from '../sim/track';

const RAIN_STREAKS = 1400;
const SNOW_FLAKES = 1700;

/** Light and sky for each kind of weather. */
export interface WeatherLook {
  /** Sky seen from the cockpit. */
  sky: number;
  /** Behind the ground plane when looking down from above. */
  ground: number;
  sun: number;
  sunIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  /** Distance haze from the cockpit: near and far, metres; 0 for none. */
  fogNear: number;
  fogFar: number;
}

export const WEATHER_LOOKS: Record<Weather, WeatherLook> = {
  clear: { sky: 0x9fd0f4, ground: 0x3f8532, sun: 0xfff0d2, sunIntensity: 2.7, hemiSky: 0xcfe4ff, hemiGround: 0x5a7a40, hemiIntensity: 1.25, fogNear: 0, fogFar: 0 },
  rain: { sky: 0x8a96a8, ground: 0x34592e, sun: 0xd4dcea, sunIntensity: 1.35, hemiSky: 0xb4c2d6, hemiGround: 0x46583c, hemiIntensity: 1.35, fogNear: 90, fogFar: 700 },
  snow: { sky: 0xc2cad8, ground: 0xc8d0dc, sun: 0xeef2ff, sunIntensity: 2.0, hemiSky: 0xe0e8f6, hemiGround: 0x8a96a6, hemiIntensity: 1.35, fogNear: 120, fogFar: 900 },
};

/**
 * Rain streaks or snowflakes in a box that follows the camera, and the
 * puddles or slush lying on the track. One draw call for the falling
 * weather, two for all the patches on the ground.
 */
export class WeatherFx {
  readonly group = new THREE.Group();
  private readonly fall: THREE.LineSegments | THREE.Points | null = null;
  private readonly base: Float32Array;
  private readonly positions: Float32Array;
  private readonly count: number;
  private readonly pools: THREE.InstancedMesh | null = null;
  private readonly sheens: THREE.InstancedMesh | null = null;
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private time = 0;

  constructor(readonly weather: Weather, private readonly track: Track, puddles: readonly Puddle[]) {
    const snow = weather === 'snow';
    this.count = weather === 'clear' ? 0 : snow ? SNOW_FLAKES : RAIN_STREAKS;
    // Each particle's place in a unit box; the box is scaled and wrapped round the view.
    this.base = new Float32Array(this.count * 3);
    let seed = 12345;
    const next = (): number => {
      seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
      return seed / 4294967296;
    };
    for (let i = 0; i < this.base.length; i++) this.base[i] = next();
    this.positions = new Float32Array(this.count * (snow ? 3 : 6));
    if (this.count) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
      if (snow) {
        this.fall = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.95, depthWrite: false, fog: false }));
      } else {
        this.fall = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xc4d2e6, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
      }
      this.fall.frustumCulled = false;
      this.fall.renderOrder = 5;
      this.group.add(this.fall);
    }

    if (puddles.length) {
      const pool = new THREE.CircleGeometry(1, 12).rotateX(-Math.PI / 2);
      const sheen = new THREE.CircleGeometry(1, 7).rotateX(-Math.PI / 2);
      const water = !snow;
      this.pools = new THREE.InstancedMesh(pool, new THREE.MeshBasicMaterial({ color: water ? 0x1c2534 : 0xb8c0cc, transparent: true, opacity: water ? 0.62 : 0.85, depthWrite: false }), puddles.length);
      this.sheens = new THREE.InstancedMesh(sheen, new THREE.MeshBasicMaterial({ color: water ? 0x8ea8cc : 0xf2f6fc, transparent: true, opacity: water ? 0.4 : 0.7, depthWrite: false }), puddles.length);
      for (const m of [this.pools, this.sheens]) {
        m.renderOrder = 3;
        m.frustumCulled = false;
        this.group.add(m);
      }
      this.updatePuddles(puddles);
    }
  }

  /** Keeps the patches on the ground the size the race says they are. */
  updatePuddles(puddles: readonly Puddle[]): void {
    if (!this.pools || !this.sheens) return;
    const shimmer = 0.5 + 0.5 * Math.sin(this.time * 1.7);
    puddles.forEach((p, i) => {
      if (i >= this.pools!.count) return;
      // Long along the track, thinner across it.
      const heading = this.track.heading[this.track.indexAt(p.s)];
      this.quat.setFromAxisAngle(this.up, -heading + Math.sin(p.phase) * 0.25);
      this.matrix.compose(new THREE.Vector3(p.x, 0.047, p.y), this.quat, new THREE.Vector3(p.radius * 1.25, 1, p.radius * 0.8));
      this.pools!.setMatrixAt(i, this.matrix);
      const off = new THREE.Vector3(p.radius * 0.3, 0, -p.radius * 0.15).applyQuaternion(this.quat);
      const k = 0.36 + 0.06 * Math.sin(this.time * 1.3 + p.phase) * shimmer;
      this.matrix.compose(new THREE.Vector3(p.x + off.x, 0.049, p.y + off.z), this.quat, new THREE.Vector3(p.radius * 1.25 * k, 1, p.radius * 0.8 * k));
      this.sheens!.setMatrixAt(i, this.matrix);
    });
    this.pools.instanceMatrix.needsUpdate = true;
    this.sheens.instanceMatrix.needsUpdate = true;
  }

  /**
   * Moves the falling weather. `centre` is the middle of the ground in view,
   * `size` how much ground the view spans and `height` how far above it the
   * weather starts.
   */
  update(dt: number, centre: THREE.Vector3, size: number, height: number): void {
    this.time += dt;
    if (!this.fall) return;
    const snow = this.weather === 'snow';
    const b = this.base;
    const p = this.positions;
    // Fall speed scales with the box so it looks the same on screen from any height.
    const scale = size / 60;
    const fallRate = snow ? 0.06 : 0.8;
    const x0 = centre.x - size / 2, z0 = centre.z - size / 2;
    const streak = 2.6 * Math.min(scale, 2.5);
    for (let i = 0; i < this.count; i++) {
      const j = i * 3;
      b[j + 1] -= dt * fallRate * (0.8 + 0.4 * b[j]);
      if (b[j + 1] < 0) b[j + 1] += 1;
      let sx = b[j], sz = b[j + 2];
      if (snow) {
        // Flakes drift on the breeze and sway.
        sx += Math.sin(this.time * 0.8 + i) * 0.004 + this.time * 0.004;
        sz += Math.cos(this.time * 0.6 + i * 1.7) * 0.004;
      }
      // World-fixed lattice wrapped into the box, so the weather does not slide with the camera.
      const wx = x0 + modulo(sx * size - x0, size);
      const wz = z0 + modulo(sz * size - z0, size);
      const wy = b[j + 1] * height;
      if (snow) {
        p[j] = wx;
        p[j + 1] = wy;
        p[j + 2] = wz;
      } else {
        const k = i * 6;
        p[k] = wx;
        p[k + 1] = wy;
        p[k + 2] = wz;
        p[k + 3] = wx + streak * 0.18;
        p[k + 4] = wy + streak;
        p[k + 5] = wz + streak * 0.08;
      }
    }
    this.fall.geometry.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const mat = mesh.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

function modulo(a: number, n: number): number {
  return ((a % n) + n) % n;
}
