import * as THREE from 'three';
import { SLOTS, SlotId } from '../data/parts';
import type { CarBuild } from '../game/build';
import { Rng } from '../sim/rng';
import { disposeTree, photoOf } from './dispose';
import { GarageCar, buildGarageCar } from './garageCar';
import { FigureLook, buildDriverFigure } from './driverFigure';
import { PixelPipeline } from './pixelPipeline';

/** Rows of the low-resolution frame; finer than the race so parts stay readable. */
const TARGET_ROWS = 1080;
/** Far enough that the whole car fits in the gap between the side panels. */
const HOME_DISTANCE = 12.5;
const INTERNAL = new Set<SlotId>(SLOTS.filter((s) => s.internal).map((s) => s.id));

function floorTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const rng = new Rng(5);
  ctx.fillStyle = '#3d4150';
  ctx.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 700; i++) {
    ctx.fillStyle = rng.pick(['#434758', '#383c4a', '#40444f']);
    ctx.fillRect(rng.int(0, 63), rng.int(0, 63), rng.int(1, 2), 1);
  }
  ctx.fillStyle = '#2c2f3b';
  ctx.fillRect(0, 0, 64, 1);
  ctx.fillRect(0, 0, 1, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(12, 12);
  return tex;
}

function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, flatShading: true }));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** The workshop the car sits in: painted bay, walls, tool chests, tyre stacks. */
function buildRoom(): THREE.Group {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshLambertMaterial({ map: floorTexture() }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  g.add(floor);

  // Bay markings.
  const paint = (w: number, d: number, color: number, x: number, z: number): void => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ color }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.005, z);
    m.receiveShadow = true;
    g.add(m);
  };
  paint(7.4, 0.1, 0xf2c21a, 0, -2.2);
  paint(7.4, 0.1, 0xf2c21a, 0, 2.2);
  paint(0.1, 4.5, 0xf2c21a, -3.7, 0);
  paint(0.1, 4.5, 0xf2c21a, 3.7, 0);

  // Walls with a team stripe.
  const wall = 0x565b70;
  g.add(box(24, 6, 0.3, wall, 0, 3, -7));
  g.add(box(0.3, 6, 24, wall, -9, 3, 0));
  g.add(box(0.3, 6, 24, wall, 9, 3, 0));
  g.add(box(24, 0.5, 0.34, 0xd8232a, 0, 2.4, -7));
  g.add(box(24, 0.12, 0.34, 0xf4f4f0, 0, 2.05, -7));
  g.add(box(0.34, 0.5, 24, 0xd8232a, -9, 2.4, 0));
  g.add(box(0.34, 0.5, 24, 0xd8232a, 9, 2.4, 0));
  g.add(box(24, 0.4, 0.4, 0x2a2d38, 0, 0.2, -6.9));

  // Tool chests.
  for (const [x, c] of [[-6.4, 0xd8232a], [-4.9, 0xd8232a], [5.2, 0x2a6fd6]] as const) {
    g.add(box(1.3, 1.0, 0.6, c, x, 0.5, -6.3));
    for (let i = 0; i < 4; i++) g.add(box(1.2, 0.03, 0.02, 0xc8ccd6, x, 0.2 + i * 0.22, -5.99));
    g.add(box(1.34, 0.06, 0.64, 0x22242c, x, 1.03, -6.3));
  }
  // Workbench with a vice and a shelf above it.
  g.add(box(3, 0.1, 0.8, 0x9a6a30, 1.6, 0.95, -6.3));
  g.add(box(0.1, 0.9, 0.7, 0x3a3e4c, 0.2, 0.45, -6.3));
  g.add(box(0.1, 0.9, 0.7, 0x3a3e4c, 3.0, 0.45, -6.3));
  g.add(box(0.3, 0.25, 0.25, 0x2a6fd6, 2.6, 1.12, -6.3));
  g.add(box(3, 0.08, 0.4, 0x3a3e4c, 1.6, 3.2, -6.7));
  for (let i = 0; i < 6; i++) g.add(box(0.3, 0.36, 0.3, [0xf2c21a, 0xd8232a, 0x22a860, 0x2a6fd6, 0xf4f4f0, 0xf07a1c][i], 0.4 + i * 0.48, 3.42, -6.7));

  // Tyre stacks.
  const tyreGeo = new THREE.CylinderGeometry(0.345, 0.345, 0.3, 14);
  const tyreMat = new THREE.MeshLambertMaterial({ color: 0x1b1c22, flatShading: true });
  for (const [x, z, n] of [[-7.6, -4.6, 4], [-7.6, -3.6, 3], [7.4, -5.2, 4], [7.5, -4.2, 2], [6.6, -5.6, 3]] as const) {
    for (let i = 0; i < n; i++) {
      const t = new THREE.Mesh(tyreGeo, tyreMat);
      t.position.set(x, 0.15 + i * 0.31, z);
      t.castShadow = true;
      g.add(t);
    }
  }
  // Fuel churn and jack.
  g.add(box(0.5, 0.9, 0.5, 0xf2c21a, -7.8, 0.45, -1.6));
  g.add(box(1.1, 0.16, 0.36, 0xd8232a, 6.6, 0.1, -1.4));
  // Overhead light bars.
  for (const z of [-3, 1]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(9, 0.1, 0.3), new THREE.MeshBasicMaterial({ color: 0xfff6dc }));
    bar.position.set(0, 5.9, z);
    g.add(bar);
  }
  return g;
}

/**
 * The 3D garage: orbit, zoom and pan around the car, focus on a slot, and
 * lift the body to see the parts underneath.
 */
export class GarageView {
  /** Slowly turns the car when the player is not dragging. */
  autoRotate = false;
  /** False while something else is on the shared canvas, such as a race. */
  interactive = true;

  private readonly pipeline: PixelPipeline;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(34, 16 / 9, 0.3, 80);
  private readonly holder = new THREE.Group();
  private car: GarageCar | null = null;
  private carKey = '';
  private driverKey = '';
  private readonly driverHolder = new THREE.Group();
  private focusSlot: SlotId | null = null;
  private explodeWanted = 0;
  private explode = 0;
  private time = 0;

  private azimuth = 0.75;
  private elevation = 0.42;
  private distance = HOME_DISTANCE;
  private readonly target = new THREE.Vector3(0, 0.6, 0);
  private readonly goal = { azimuth: 0.75, elevation: 0.42, distance: HOME_DISTANCE, target: new THREE.Vector3(0, 0.6, 0) };
  private viewShiftY = 0;
  /** Horizontal shift of the view, as a fraction of its width, to clear UI panels. */
  private viewShift = 0;
  private drag: { mode: 'orbit' | 'pan'; x: number; y: number } | null = null;
  private readonly listeners: [string, EventListener][] = [];

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly canvas: HTMLCanvasElement) {
    this.pipeline = new PixelPipeline(renderer);
    this.pipeline.edgeDepth = 0.05;
    this.pipeline.edgeSlope = 0.02;
    this.pipeline.outline = 0.45;
    this.pipeline.levels = 40;
    this.pipeline.dither = 0.7;

    this.scene.background = new THREE.Color(0x1c1f2c);
    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x3a3e50, 1.5));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
    key.position.set(5, 9, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.bias = -0.0008;
    key.shadow.normalBias = 0.02;
    const sc = key.shadow.camera;
    sc.left = -6;
    sc.right = 6;
    sc.top = 6;
    sc.bottom = -6;
    sc.near = 1;
    sc.far = 30;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ab8ff, 0.9);
    rim.position.set(-6, 4, -5);
    this.scene.add(rim);
    this.scene.add(buildRoom(), this.holder, this.driverHolder);
    this.bindInput();
  }

  private on(target: EventTarget, type: string, fn: EventListener, opts?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, opts);
    this.listeners.push([type, fn]);
  }

  private bindInput(): void {
    const c = this.canvas;
    this.on(c, 'pointerdown', ((e: PointerEvent) => {
      if (!this.interactive) return;
      this.drag = { mode: e.button === 2 || e.button === 1 || e.shiftKey ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
    }) as EventListener);
    this.on(c, 'pointermove', ((e: PointerEvent) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.mode === 'orbit') this.orbit(-dx * 0.008, dy * 0.006);
      else this.pan(dx, dy);
    }) as EventListener);
    const end = ((e: PointerEvent) => {
      this.drag = null;
      if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
    }) as EventListener;
    this.on(c, 'pointerup', end);
    this.on(c, 'pointercancel', end);
    this.on(c, 'wheel', ((e: WheelEvent) => {
      if (!this.interactive) return;
      e.preventDefault();
      this.zoom(e.deltaY > 0 ? 1.12 : 1 / 1.12);
    }) as EventListener, { passive: false });
    this.on(c, 'contextmenu', ((e: Event) => e.preventDefault()) as EventListener);
  }

  orbit(dAzimuth: number, dElevation: number): void {
    this.goal.azimuth += dAzimuth;
    this.goal.elevation = THREE.MathUtils.clamp(this.goal.elevation + dElevation, 0.06, 1.45);
  }

  zoom(factor: number): void {
    this.goal.distance = THREE.MathUtils.clamp(this.goal.distance * factor, 1.6, 15);
  }

  pan(dxPixels: number, dyPixels: number): void {
    const scale = this.goal.distance * 0.0016;
    const right = new THREE.Vector3(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    this.goal.target.addScaledVector(right, -dxPixels * scale);
    this.goal.target.y = THREE.MathUtils.clamp(this.goal.target.y + dyPixels * scale, 0, 2.6);
    this.goal.target.x = THREE.MathUtils.clamp(this.goal.target.x, -4, 4);
    this.goal.target.z = THREE.MathUtils.clamp(this.goal.target.z, -3, 3);
  }

  resetView(): void {
    this.goal.azimuth = 0.75;
    this.goal.elevation = 0.42;
    this.goal.distance = HOME_DISTANCE;
    this.goal.target.set(0, 0.6, 0);
  }

  /** Shifts the picture sideways so the car is centred in the space the UI leaves free. */
  setViewShift(fraction: number, fractionY = 0): void {
    this.viewShift = fraction;
    this.viewShiftY = fractionY;
  }

  /** Shows a build, or an empty bay for null. Keeps the camera where it is. */
  setCar(build: CarBuild | null): void {
    // Previews call this on every hover: rebuild only when something changed.
    const key = build ? JSON.stringify(build) : '';
    if (key === this.carKey && (this.car !== null) === (build !== null)) return;
    this.carKey = key;
    disposeTree(this.holder);
    this.holder.clear();
    this.car = build ? buildGarageCar(build) : null;
    if (this.car) {
      this.holder.add(this.car.root);
      this.car.setExplode(this.explode);
      this.car.setHighlight(this.focusSlot);
    }
  }

  /**
   * Stands a driver beside the car for a team photo, or removes them for null.
   * Colours are CSS hex strings from the driver's chosen look.
   */
  setDriver(look: FigureLook | null): void {
    const key = look ? JSON.stringify(look) : '';
    if (key === this.driverKey) return;
    this.driverKey = key;
    disposeTree(this.driverHolder);
    this.driverHolder.clear();
    if (!look) return;
    const g = buildDriverFigure(look);
    g.position.set(1.0, 0, 1.75);
    g.rotation.y = 0.5;
    this.driverHolder.add(g);
  }

  /** Draws the current frame and returns it as a JPEG data URL. */
  capture(): string {
    this.render();
    return photoOf(this.renderer.domElement);
  }

  /** Frames the car and the driver beside it. */
  photoPose(): void {
    this.goal.azimuth = 0.62;
    this.goal.elevation = 0.2;
    this.goal.distance = 8.6;
    this.goal.target.set(0.2, 0.75, 0.5);
    this.explodeWanted = 0;
  }

  /** Points the camera at a slot and lifts the body if the part is underneath. */
  setFocus(slot: SlotId | null): void {
    this.focusSlot = slot;
    this.car?.setHighlight(slot);
    if (!slot || !this.car) {
      this.explodeWanted = 0;
      return;
    }
    this.explodeWanted = INTERNAL.has(slot) ? 1 : 0;
    if (slot === 'discs' || slot === 'calipers' || slot === 'pads' || slot === 'ducts') this.explodeWanted = 1;
    const f = this.car.focusOf(slot);
    this.goal.target.copy(f.point);
    this.goal.distance = f.distance * 1.5 + 2.2;
    // Look from the side the part is on, and from above for parts on the floor.
    if (Math.abs(f.point.z) > 0.6) this.turnTo(f.point.z < 0 ? Math.PI - 0.75 : 0.75);
    if (INTERNAL.has(slot)) this.goal.elevation = Math.max(this.goal.elevation, 0.62);
  }

  /** Turns to an azimuth by the shortest way round. */
  private turnTo(azimuth: number): void {
    const turn = Math.PI * 2;
    let delta = (azimuth - this.goal.azimuth) % turn;
    if (delta > Math.PI) delta -= turn;
    else if (delta < -Math.PI) delta += turn;
    this.goal.azimuth += delta;
  }

  setExploded(on: boolean): void {
    this.explodeWanted = on ? 1 : 0;
  }

  get exploded(): boolean {
    return this.explodeWanted > 0.5;
  }

  resize(cssWidth: number, cssHeight: number): void {
    const scale = Math.max(1, Math.round(cssHeight / TARGET_ROWS));
    const w = Math.max(160, Math.round(cssWidth / scale));
    const h = Math.max(90, Math.round(cssHeight / scale));
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number): void {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 7);
    if (this.autoRotate && !this.drag) this.goal.azimuth += dt * 0.25;
    this.azimuth += (this.goal.azimuth - this.azimuth) * k;
    this.elevation += (this.goal.elevation - this.elevation) * k;
    this.distance += (this.goal.distance - this.distance) * k;
    this.target.lerp(this.goal.target, k);
    this.explode += (this.explodeWanted - this.explode) * (1 - Math.exp(-dt * 6));
    this.car?.setExplode(this.explode);
    this.car?.tick(this.time);

    const lift = this.explode * 0.5;
    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
    this.camera.position.set(
      this.target.x + Math.sin(this.azimuth) * ce * this.distance,
      this.target.y + lift + se * this.distance,
      this.target.z + Math.cos(this.azimuth) * ce * this.distance,
    );
    // Stay inside the room.
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -8.4, 8.4);
    this.camera.position.z = Math.max(this.camera.position.z, -6.2);
    this.camera.position.y = Math.max(this.camera.position.y, 0.25);
    this.camera.lookAt(this.target.x, this.target.y + lift, this.target.z);
    if (this.viewShift || this.viewShiftY) {
      const w = this.camera.aspect * 1000, h = 1000;
      this.camera.setViewOffset(w, h, -this.viewShift * w, this.viewShiftY * h, w, h);
    } else if (this.camera.view) {
      this.camera.clearViewOffset();
    }
  }

  render(): void {
    this.pipeline.render(this.scene, this.camera);
  }

  dispose(): void {
    for (const [type, fn] of this.listeners) this.canvas.removeEventListener(type, fn);
    this.pipeline.dispose();
  }
}
