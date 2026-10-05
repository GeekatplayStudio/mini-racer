import * as THREE from 'three';
import type { RaceSession } from '../game/raceSetup';
import { clamp } from '../sim/math';
import type { Hazard, RaceCar } from '../sim/race';
import { LIVERIES } from '../data/cars';
import { Surface } from '../sim/track';
import { CarVisual, buildCarVisual } from './carMesh';
import { Puffs, SkidMarks } from './effects';
import { PixelPipeline } from './pixelPipeline';
import { TrackScene, buildTrackScene } from './trackScene';
import { WEATHER_LOOKS, WeatherFx, WeatherLook } from './weather';

export type CameraMode = 'chase' | 'pov' | 'overview';

/** Target height of the low-resolution frame, in pixels. */
const TARGET_ROWS = 540;

interface CarFx {
  wheelX: number[];
  wheelZ: number[];
  marking: boolean[];
  emit: number;
  smoke: number;
  spray: number;
}

/** Draws a race session: owns the 3D scene, camera and pixel pipeline. */
export class RaceView {
  cameraMode: CameraMode = 'chase';
  focusCar: number;

  private readonly pipeline: PixelPipeline;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(28, 16 / 9, 10, 2400);
  private readonly sun: THREE.DirectionalLight;
  private readonly trackScene: TrackScene;
  private readonly visuals: CarVisual[];
  private readonly fx: CarFx[];
  private readonly puffs = new Puffs();
  private readonly skids = new SkidMarks();
  private readonly focus = new THREE.Vector3();
  private camHeight = 70;
  private readonly bounds: { cx: number; cz: number; w: number; h: number };
  private snapped = false;
  private readonly hazardMeshes = new Map<number, THREE.Object3D>();
  private hazardSmoke = 0;
  private readonly look: WeatherLook;
  private readonly weather: WeatherFx;
  /** Ground the camera can see: middle, span and how high the weather starts. */
  private readonly view = { centre: new THREE.Vector3(), size: 80, height: 60 };

  constructor(private readonly renderer: THREE.WebGLRenderer, private readonly session: RaceSession) {
    this.focusCar = session.playerCar;
    this.pipeline = new PixelPipeline(this.renderer);

    const look = WEATHER_LOOKS[session.race.weather];
    this.look = look;
    this.scene.background = new THREE.Color(look.ground);
    this.scene.add(new THREE.HemisphereLight(look.hemiSky, look.hemiGround, look.hemiIntensity));
    this.sun = new THREE.DirectionalLight(look.sun, look.sunIntensity);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    const { track, race, entries } = session;
    this.trackScene = buildTrackScene(track, race.line, race.weather);
    this.scene.add(this.trackScene.group);
    this.weather = new WeatherFx(race.weather, track, race.puddles);
    this.scene.add(this.weather.group);
    this.scene.add(this.skids.mesh, this.puffs.mesh);
    this.puffs.mesh.castShadow = false;

    this.visuals = entries.map((e) => {
      const visual = buildCarVisual(e.model, e.livery, e.rimColor);
      this.scene.add(visual.root);
      return visual;
    });
    this.fx = entries.map(() => ({ wheelX: [0, 0, 0, 0], wheelZ: [0, 0, 0, 0], marking: [false, false, false, false], emit: 0, smoke: 0, spray: 0 }));

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < track.n; i++) {
      minX = Math.min(minX, track.x[i]);
      maxX = Math.max(maxX, track.x[i]);
      minZ = Math.min(minZ, track.y[i]);
      maxZ = Math.max(maxZ, track.y[i]);
    }
    this.bounds = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, w: maxX - minX + 110, h: maxZ - minZ + 110 };
  }

  /** Call when the canvas's displayed size changes. */
  resize(cssWidth: number, cssHeight: number): void {
    const scale = Math.max(1, Math.round(cssHeight / TARGET_ROWS));
    const w = Math.max(160, Math.round(cssWidth / scale));
    const h = Math.max(90, Math.round(cssHeight / scale));
    this.renderer.setSize(w, h, false);
    this.pipeline.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Draws the current frame and returns it as a JPEG data URL, for the finish-line photo. */
  capture(): string {
    this.render();
    return this.renderer.domElement.toDataURL('image/jpeg', 0.82);
  }

  dispose(): void {
    this.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
    });
    this.weather.dispose();
    this.pipeline.dispose();
  }

  /** Cuts straight to a camera on a car, with no pan from the last shot. */
  cut(mode: CameraMode, car: number): void {
    this.cameraMode = mode;
    this.focusCar = car;
    this.snapped = false;
  }

  cycleCamera(): void {
    this.cameraMode = this.cameraMode === 'chase' ? 'pov' : this.cameraMode === 'pov' ? 'overview' : 'chase';
    this.snapped = false;
  }

  /** Syncs the scene with the race and advances visual effects by dt seconds. */
  update(dt: number): void {
    const race = this.session.race;
    race.cars.forEach((car, i) => this.updateCar(car, this.visuals[i], this.fx[i], dt));
    this.syncHazards(dt);
    this.puffs.update(dt);

    this.trackScene.startLights.forEach((mat, i) => {
      mat.color.setHex(race.phase === 'countdown' && i < race.lights ? 0xff2a20 : 0x3a1418);
    });

    this.updateCamera(dt);
    this.weather.updatePuddles(race.puddles);
    this.weather.update(dt, this.view.centre, this.view.size, this.view.height);
  }

  render(): void {
    this.pipeline.render(this.scene, this.camera);
  }

  /** Adds and removes hazard models to match the race. */
  private syncHazards(dt: number): void {
    const hazards = this.session.race.hazards;
    for (const [id, mesh] of this.hazardMeshes) {
      if (!hazards.some((h) => h.id === id)) {
        this.scene.remove(mesh);
        this.hazardMeshes.delete(id);
      }
    }
    this.hazardSmoke += dt;
    const smoke = this.hazardSmoke > 0.12;
    if (smoke) this.hazardSmoke = 0;
    for (const h of hazards) {
      let mesh = this.hazardMeshes.get(h.id);
      if (!mesh) {
        mesh = buildHazard(h, this.session.track.heading[this.session.track.indexAt(h.s)]);
        this.hazardMeshes.set(h.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(h.x, 0, h.y);
      if (h.kind === 'animal') mesh.rotation.y = -this.session.track.heading[this.session.track.indexAt(h.s)] + (h.drift > 0 ? -Math.PI / 2 : Math.PI / 2);
      if (h.kind === 'wreck' && smoke) {
        this.puffs.emit(h.x + (Math.random() - 0.5), 0.9, h.y + (Math.random() - 0.5), (Math.random() - 0.5) * 0.8, 2.2 + Math.random(), (Math.random() - 0.5) * 0.8, 0.7 + Math.random() * 0.8, 1.6, 0x3a3a40);
      }
    }
  }

  private updateCar(car: RaceCar, visual: CarVisual, fx: CarFx, dt: number): void {
    const st = car.state;
    // In the driver's-eye view the player's own bodywork would fill the screen.
    visual.root.visible = !car.parked && !(this.cameraMode === 'pov' && car.id === this.focusCar);
    if (car.parked) return;
    visual.root.position.set(st.x, 0, st.y);
    visual.root.rotation.y = -st.heading;
    visual.chassis.rotation.x = clamp(-st.ay * 0.0032, -0.06, 0.06);
    visual.chassis.rotation.z = clamp(st.ax * 0.0022, -0.035, 0.035);
    for (const wheel of visual.frontWheels) wheel.rotation.y = -st.steerAngle;
    for (const rim of visual.rims) rim.rotation.z -= (st.vx / car.spec.wheelRadius) * dt;
    visual.brakeLights.color.setHex(st.brake > 0.05 ? 0xff3028 : 0x5a0c10);
    car.dents.forEach((level, zone) => {
      visual.dents[zone][0].visible = level >= 0.35;
      visual.dents[zone][1].visible = level >= 0.7;
    });

    const speed = Math.hypot(st.vx, st.vy);
    const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
    const onRoad = car.surface === Surface.Asphalt || car.surface === Surface.Kerb;

    visual.wheels.forEach((wheel, w) => {
      const lx = wheel.position.x, lz = wheel.position.z;
      const wx = st.x + lx * cosH - lz * sinH;
      const wz = st.y + lx * sinH + lz * cosH;
      const slide = w < 2 ? st.slideFront : st.slideRear;
      const marking = speed > 4 && (onRoad ? slide > 0.2 : true);
      if (marking && fx.marking[w]) {
        const moved = Math.hypot(wx - fx.wheelX[w], wz - fx.wheelZ[w]);
        if (moved > 0.6 && moved < 6) {
          if (onRoad) this.skids.add(fx.wheelX[w], fx.wheelZ[w], wx, wz, 0.3, 0.28 + 0.4 * slide, 0.04);
          else if (car.surface === Surface.Grass) this.skids.add(fx.wheelX[w], fx.wheelZ[w], wx, wz, 0.34, 0.5, 0.16);
          else this.skids.add(fx.wheelX[w], fx.wheelZ[w], wx, wz, 0.4, 0.45, 0.42);
          fx.wheelX[w] = wx;
          fx.wheelZ[w] = wz;
        } else if (moved >= 6) {
          fx.wheelX[w] = wx;
          fx.wheelZ[w] = wz;
        }
      } else {
        fx.wheelX[w] = wx;
        fx.wheelZ[w] = wz;
      }
      fx.marking[w] = marking;
    });

    // Smoke on tarmac, dust and stones off it.
    const slide = Math.max(st.slideRear, st.slideFront * 0.7);
    let rate = 0;
    let color = 0xe6e6ea;
    let size = 0.9;
    if (onRoad) {
      if (slide > 0.3 && speed > 6) rate = 26 * slide;
    } else if (speed > 3) {
      rate = Math.min(40, 6 + speed * 0.9);
      color = car.surface === Surface.Gravel ? 0xd8c8a0 : 0x8f8a52;
      size = car.surface === Surface.Gravel ? 1.5 : 1.0;
    }
    // A badly knocked-about car trails smoke from under the bonnet.
    if (st.damage > 0.45) {
      fx.smoke += (4 + 14 * st.damage) * dt;
      while (fx.smoke >= 1) {
        fx.smoke -= 1;
        const nx = st.x + cosH * car.spec.length * 0.3, nz = st.y + sinH * car.spec.length * 0.3;
        this.puffs.emit(nx + (Math.random() - 0.5) * 0.5, 0.9, nz + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5), 1.6 + Math.random(), (Math.random() - 0.5), 0.5 + st.damage * 0.8, 0.9, st.damage > 0.8 ? 0x2c2c32 : 0x9a9aa2);
      }
    }
    // Spray thrown up by the tyres on a wet or snowy track, more through standing water.
    const race = this.session.race;
    if (race.weather !== 'clear' && onRoad && speed > 10) {
      let splash = 1;
      for (const p of race.puddles) {
        if ((st.x - p.x) ** 2 + (st.y - p.y) ** 2 < (p.radius + 0.6) ** 2) splash = 3;
      }
      const snow = race.weather === 'snow';
      fx.spray += speed * (0.25 + 0.5 * race.wetness) * (snow ? 0.7 : 1) * splash * dt;
      const vwx = st.vx * cosH - st.vy * sinH, vwz = st.vx * sinH + st.vy * cosH;
      while (fx.spray >= 1) {
        fx.spray -= 1;
        const w = 2 + Math.floor(Math.random() * 2);
        const wheel = visual.wheels[w].position;
        const wx = st.x + (wheel.x - 0.4) * cosH - wheel.z * sinH;
        const wz = st.y + (wheel.x - 0.4) * sinH + wheel.z * cosH;
        this.puffs.emit(
          wx + (Math.random() - 0.5) * 0.6, 0.2, wz + (Math.random() - 0.5) * 0.6,
          vwx * 0.35 + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 1.2 * splash, vwz * 0.35 + (Math.random() - 0.5) * 3,
          (0.22 + Math.random() * 0.26) * (splash > 1 ? 1.6 : 1), 0.3 + Math.random() * 0.25, snow ? 0xf4f7fc : 0xd8e2ee,
        );
      }
    }
    fx.emit += rate * dt;
    while (fx.emit >= 1) {
      fx.emit -= 1;
      const w = 2 + Math.floor(Math.random() * 2);
      const wheel = visual.wheels[w].position;
      const wx = st.x + wheel.x * cosH - wheel.z * sinH;
      const wz = st.y + wheel.x * sinH + wheel.z * cosH;
      const vwx = st.vx * cosH - st.vy * sinH, vwz = st.vx * sinH + st.vy * cosH;
      this.puffs.emit(
        wx + (Math.random() - 0.5) * 0.6, 0.4, wz + (Math.random() - 0.5) * 0.6,
        vwx * 0.25 + (Math.random() - 0.5) * 2, 1.2 + Math.random() * 1.5, vwz * 0.25 + (Math.random() - 0.5) * 2,
        size * (0.7 + Math.random() * 0.7), 0.5 + Math.random() * 0.6, color,
      );
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    let shadowHalf = 130;
    let target: THREE.Vector3;
    let height: number;

    const sky = this.cameraMode === 'pov';
    (this.scene.background as THREE.Color).setHex(sky ? this.look.sky : this.look.ground);
    // Haze in the distance from the cockpit only; from above it would grey the whole picture.
    const fog = sky && this.look.fogFar > 0;
    if (fog && !this.scene.fog) this.scene.fog = new THREE.Fog(this.look.sky, this.look.fogNear, this.look.fogFar);
    else if (!fog && this.scene.fog) this.scene.fog = null;
    if (sky) {
      // Driver's eye: seated left of centre, looking down the road and a little into the corner.
      const st = this.session.race.cars[this.focusCar].state;
      const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
      const seat = -0.36, ahead = 0.25;
      const ex = st.x + ahead * cosH - seat * sinH, ez = st.y + ahead * sinH + seat * cosH;
      const look = st.heading + st.steerAngle * 0.5;
      cam.near = 0.4;
      cam.far = 2400;
      cam.fov = 64;
      cam.updateProjectionMatrix();
      cam.position.set(ex, 1.08 - st.ax * 0.004, ez);
      cam.up.set(Math.sin(st.ay * 0.004) * -sinH, 1, Math.sin(st.ay * 0.004) * cosH);
      cam.lookAt(ex + Math.cos(look) * 30, 0.9, ez + Math.sin(look) * 30);
      this.focus.set(st.x, 0, st.y);
      this.snapped = false;
      this.view.centre.set(ex + Math.cos(look) * 26, 0, ez + Math.sin(look) * 26);
      this.view.size = 64;
      this.view.height = 16;
      this.aimShadows(110);
      return;
    }
    if (cam.fov !== 28) {
      cam.near = 10;
      cam.fov = 28;
      cam.up.set(0, 1, 0);
      cam.updateProjectionMatrix();
    }
    if (this.cameraMode === 'overview') {
      const b = this.bounds;
      const vFov = THREE.MathUtils.degToRad(cam.fov);
      const fitH = b.h / (2 * Math.tan(vFov / 2));
      const fitW = b.w / (2 * Math.tan(vFov / 2) * cam.aspect);
      height = Math.max(fitH, fitW) * 1.22;
      target = new THREE.Vector3(b.cx, 0, b.cz);
      shadowHalf = Math.max(b.w, b.h) * 0.62;
      this.focus.copy(target);
      this.camHeight = height;
    } else {
      const st = this.session.race.cars[this.focusCar].state;
      const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
      const speed = Math.hypot(st.vx, st.vy);
      const lead = 0.55;
      target = new THREE.Vector3(
        st.x + (st.vx * cosH - st.vy * sinH) * lead,
        0,
        st.y + (st.vx * sinH + st.vy * cosH) * lead,
      );
      height = 62 + speed * 0.5;
      if (!this.snapped) {
        this.focus.copy(target);
        this.camHeight = height;
        this.snapped = true;
      } else {
        this.focus.lerp(target, 1 - Math.exp(-dt * 3.2));
        this.camHeight += (height - this.camHeight) * (1 - Math.exp(-dt * 1.4));
      }
    }

    const tilt = this.cameraMode === 'overview' ? 0.32 : 0.58;
    cam.position.set(this.focus.x, this.camHeight, this.focus.z + this.camHeight * tilt);
    cam.lookAt(this.focus);

    this.view.centre.copy(this.focus);
    this.view.size = this.cameraMode === 'overview' ? Math.max(this.bounds.w, this.bounds.h) : this.camHeight * 1.15;
    this.view.height = this.camHeight * 0.8;
    this.aimShadows(shadowHalf);
  }

  /** Keeps the shadow map centred on what the camera sees, snapped to its texels. */
  private aimShadows(shadowHalf: number): void {
    const texel = (shadowHalf * 2) / this.sun.shadow.mapSize.x;
    const sx = Math.round(this.focus.x / texel) * texel;
    const sz = Math.round(this.focus.z / texel) * texel;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx - 150, 260, sz - 110);
    const sc = this.sun.shadow.camera;
    if (sc.right !== shadowHalf) {
      sc.left = -shadowHalf;
      sc.right = shadowHalf;
      sc.top = shadowHalf;
      sc.bottom = -shadowHalf;
      sc.near = 50;
      sc.far = 700;
      sc.updateProjectionMatrix();
    }
  }
}

function hazardBox(parent: THREE.Object3D, color: number, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color, flatShading: true }));
  m.position.set(x, y, z);
  m.rotation.y = ry;
  m.castShadow = true;
  parent.add(m);
  return m;
}

/** A low-poly model for something that should not be on the track. */
function buildHazard(h: Hazard, heading: number): THREE.Object3D {
  const g = new THREE.Group();
  const turn = -heading + h.tint * 0.7;
  if (h.kind === 'oil') {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(h.radius, 9), new THREE.MeshBasicMaterial({ color: 0x0e0c16, transparent: true, opacity: 0.88, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.05;
    pool.scale.set(1, 0.72, 1);
    const sheen = new THREE.Mesh(new THREE.CircleGeometry(h.radius * 0.45, 7), new THREE.MeshBasicMaterial({ color: 0x5a4a8a, transparent: true, opacity: 0.55, depthWrite: false }));
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.set(h.radius * 0.2, 0.055, -h.radius * 0.1);
    g.add(pool, sheen);
    g.rotation.y = turn;
  } else if (h.kind === 'tyre') {
    const tyre = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 12), new THREE.MeshLambertMaterial({ color: 0x1b1c22, flatShading: true }));
    tyre.position.y = 0.15;
    tyre.castShadow = true;
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.31, 8), new THREE.MeshLambertMaterial({ color: 0xb8bcc8, flatShading: true }));
    rim.position.y = 0.15;
    g.add(tyre, rim);
  } else if (h.kind === 'debris') {
    const paint = LIVERIES[h.tint % LIVERIES.length].base;
    hazardBox(g, 0x1c1d24, 0.9, 0.06, 0.5, 0, 0.05, 0, 0.5);
    hazardBox(g, paint, 0.5, 0.12, 0.3, 0.3, 0.08, 0.35, 1.2);
    hazardBox(g, paint, 0.35, 0.1, 0.25, -0.35, 0.07, -0.2, 2.1);
    hazardBox(g, 0xb8bcc8, 0.2, 0.08, 0.2, 0.1, 0.06, -0.4, 0.3);
    g.rotation.y = turn;
  } else if (h.kind === 'animal') {
    // A deer, or with a low tint a fox: body, neck, head and four legs.
    const fox = h.tint < 3;
    const coat = fox ? 0xc8642a : 0x8a6238;
    const k = fox ? 0.55 : 1;
    hazardBox(g, coat, 1.0 * k, 0.4 * k, 0.36 * k, 0, 0.75 * k, 0);
    hazardBox(g, coat, 0.2 * k, 0.5 * k, 0.2 * k, 0.5 * k, 1.05 * k, 0);
    hazardBox(g, coat, 0.36 * k, 0.2 * k, 0.2 * k, 0.66 * k, 1.3 * k, 0);
    hazardBox(g, 0xf0e8d8, 0.14 * k, 0.16 * k, 0.16 * k, -0.56 * k, 0.86 * k, 0);
    for (const [x, z] of [[0.36, 0.12], [0.36, -0.12], [-0.36, 0.12], [-0.36, -0.12]]) hazardBox(g, fox ? 0x2a1c14 : coat, 0.09 * k, 0.56 * k, 0.09 * k, x * k, 0.28 * k, z * k);
    if (!fox) for (const z of [0.07, -0.07]) hazardBox(g, 0xd8c8a0, 0.05, 0.3, 0.05, 0.62, 1.52, z);
  } else {
    // A crashed car: crumpled shell on its wheels, bonnet up, one wheel off.
    const paint = LIVERIES[h.tint % LIVERIES.length];
    hazardBox(g, paint.base, 2.9, 0.62, 1.9, 0, 0.5, 0);
    hazardBox(g, 0x1a2a3c, 1.4, 0.42, 1.6, -0.2, 0.98, 0);
    hazardBox(g, paint.accent, 1.0, 0.06, 1.7, 1.0, 1.02, 0).rotation.z = 0.6;
    hazardBox(g, 0x16171d, 0.5, 0.3, 1.8, 1.55, 0.4, 0).rotation.y = 0.25;
    for (const [x, z] of [[1.0, 0.95], [-1.0, 0.95], [-1.0, -0.95]]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10), new THREE.MeshLambertMaterial({ color: 0x1b1c22, flatShading: true }));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(x, 0.34, z);
      wheel.castShadow = true;
      g.add(wheel);
    }
    const loose = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.3, 10), new THREE.MeshLambertMaterial({ color: 0x1b1c22, flatShading: true }));
    loose.position.set(1.7, 0.15, -1.6);
    loose.castShadow = true;
    g.add(loose);
    g.rotation.y = turn;
  }
  return g;
}
