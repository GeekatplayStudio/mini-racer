import { CarView, Directive, DriverBrain } from './brain';
import { CarEnvironment, CarSpec, CarState, Controls, createCarState, stepCar } from './car';
import { DriverDef, skillLevel } from './driver';
import { RacingLine, computeRacingLine } from './line';
import { clamp, mod } from './math';
import { Rng } from './rng';
import { SURFACES, Surface, Track, TrackLocation } from './track';

/** Fixed simulation step. Rendering never changes it, so races are reproducible. */
export const SIM_DT = 1 / 240;

export type PitMode = 'auto' | 'manual';

export interface EntrantDef {
  driver: DriverDef;
  spec: CarSpec;
  /** Seconds the car's jacks and wheel nuts save at each stop. */
  pitSaving?: number;
  /** Who decides when to stop: the driver (auto) or the pit wall (manual). Default auto. */
  pitMode?: PitMode;
}

export interface RaceOptions {
  /** Multiplier on tyre wear and fuel use, to bring pit stops into short races. Default 1. */
  wearScale?: number;
  /** Most road hazards on the track at once; 0 turns them off. */
  hazards?: number;
}

export type HazardKind = 'oil' | 'wreck' | 'animal' | 'tyre' | 'debris';

/** Something on the track that should not be there. */
export interface Hazard {
  id: number;
  kind: HazardKind;
  s: number;
  d: number;
  x: number;
  y: number;
  radius: number;
  /** Solid hazards are hit; oil is driven through. */
  solid: boolean;
  /** Seconds until the marshals clear it. */
  life: number;
  /** Sideways speed, m/s; animals wander. */
  drift: number;
  /** Colour seed for the picture. */
  tint: number;
  /** How drivers perceive it. */
  view: CarView;
}

const HAZARD_KINDS: readonly { kind: HazardKind; radius: number; solid: boolean; weight: number }[] = [
  { kind: 'oil', radius: 2.6, solid: false, weight: 3 },
  { kind: 'tyre', radius: 0.5, solid: true, weight: 3 },
  { kind: 'debris', radius: 0.6, solid: true, weight: 3 },
  { kind: 'animal', radius: 0.6, solid: true, weight: 2 },
  { kind: 'wreck', radius: 1.5, solid: true, weight: 1.5 },
];

/** Where a car has been hit: nose, tail, left side, right side. */
export type DamageZone = 'front' | 'rear' | 'left' | 'right';
export const DAMAGE_ZONES: readonly DamageZone[] = ['front', 'rear', 'left', 'right'];

/** Orders the pit wall can give a driver. */
export type Command = 'push' | 'standard' | 'save' | 'attack' | 'race' | 'hold' | 'box' | 'stayout';

export enum PitPhase {
  None = 0,
  Inbound = 1,
  Stopped = 2,
  Outbound = 3,
}

export interface RaceCar {
  /** Index in the entry list, which is also the grid order. */
  id: number;
  driver: DriverDef;
  spec: CarSpec;
  state: CarState;
  loc: TrackLocation;
  brain: DriverBrain;
  controls: Controls;
  surface: Surface;
  /** Times the start line has been crossed; the first crossing starts lap 1. */
  crossings: number;
  /** Total distance raced, m; negative on the grid. */
  progress: number;
  lapStart: number;
  lastLap: number;
  bestLap: number;
  finished: boolean;
  finishTime: number;
  /** 1-based race position. */
  position: number;
  contacts: number;
  /** Out of the race: no fuel, a failed tyre. */
  retired: boolean;
  retireReason: '' | 'fuel' | 'tyres';
  /** Retired and moved behind the barrier by the marshals. */
  parked: boolean;
  pitMode: PitMode;
  /** A stop has been called for the next time past the pit entry. */
  pitRequested: boolean;
  pitPhase: PitPhase;
  pitTimer: number;
  pitStops: number;
  pitSaving: number;
  /** Fuel burned over the last complete lap, kg; 0 until one is done. */
  fuelPerLap: number;
  /** -1 save, 0 standard, 1 push. */
  pace: number;
  /** -1 hold position, 0 race, 1 attack. */
  stance: number;
  /** Bodywork damage by zone (front, rear, left, right), 0..1; what the picture shows. */
  dents: number[];
  /** Grass and gravel on the tyres after a trip off the track, 0..1. */
  dirt: number;
}

export type RaceEvent =
  | { type: 'lights'; count: number }
  | { type: 'green' }
  | { type: 'lap'; car: number; lap: number; time: number; best: boolean; fastest: boolean }
  | { type: 'overtake'; car: number; passed: number; position: number }
  | { type: 'contact'; a: number; b: number; force: number }
  | { type: 'wall'; car: number; force: number }
  | { type: 'finish'; car: number; position: number }
  | { type: 'pit'; car: number; stage: 'called' | 'in' | 'out' | 'cancelled'; seconds: number }
  | { type: 'retire'; car: number; reason: 'fuel' | 'tyres' }
  | { type: 'radio'; car: number; command: Command; obeyed: boolean }
  | { type: 'hazard'; kind: HazardKind; stage: 'appeared' | 'cleared' | 'hit'; car: number }
  | { type: 'damage'; car: number; zone: DamageZone; level: 1 | 2 }
  | { type: 'end' };

export type RacePhase = 'countdown' | 'racing' | 'finished';

const LIGHT_INTERVAL = 1;
const FIRST_LIGHT = 1.5;
/** Speed limit in the pit lane, m/s (60 km/h). */
const PIT_LIMIT = 60 / 3.6;

interface Pending {
  at: number;
  car: number;
  command: Command;
}

/**
 * A complete race: cars, drivers, rules and timing. It depends only on its
 * constructor inputs and the commands given to it, so the same
 * inputs always give the same race.
 */
export class Race {
  readonly track: Track;
  readonly line: RacingLine;
  readonly cars: RaceCar[];
  readonly laps: number;
  readonly seed: number;
  readonly wearScale: number;
  readonly maxHazards: number;
  /** Hazards on the track now. */
  hazards: Hazard[] = [];
  private seen: CarView[] = [];
  private hazardTimer = 12;
  private hazardId = 0;
  /** Cars in current race order. */
  readonly order: RaceCar[];
  phase: RacePhase = 'countdown';
  /** Seconds since the simulation began, including the start procedure. */
  clock = 0;
  /** Seconds since the lights went out. */
  time = 0;
  lights = 0;
  fastestLap = Infinity;
  fastestLapCar = -1;
  steps = 0;
  /** Events since the last drain; consumers read and clear this. */
  events: RaceEvent[] = [];

  private readonly greenAt: number;
  private readonly rng: Rng;
  private readonly pending: Pending[] = [];
  private readonly lapFuel: number[];
  /** Most line crossings each car has made; backing over the line and across again is not a lap. */
  private readonly lapsCounted: number[];
  private readonly directives: Directive[];
  private leaderFinished = false;
  private finishers = 0;
  private endTimer = 0;

  constructor(
    track: Track,
    entrants: readonly EntrantDef[],
    laps: number,
    seed: number,
    line?: RacingLine,
    options: RaceOptions = {},
  ) {
    this.track = track;
    this.laps = laps;
    this.seed = seed;
    this.wearScale = options.wearScale ?? 1;
    this.maxHazards = Math.max(0, Math.floor(options.hazards ?? 0));
    this.line = line ?? computeRacingLine(track);
    const rng = new Rng(seed);
    this.greenAt = FIRST_LIGHT + 5 * LIGHT_INTERVAL + rng.range(0.4, 1.6);
    this.rng = rng.fork(9001);

    this.cars = entrants.map((e, i) => {
      const slot = track.gridSlot(i);
      const [x, y] = track.pointAt(slot.s, slot.d);
      const index = track.indexAt(slot.s);
      const state = createCarState(e.spec, x, y, track.heading[index]);
      const loc = track.locate(x, y, index);
      return {
        id: i,
        driver: e.driver,
        spec: e.spec,
        state,
        loc,
        brain: new DriverBrain(track, this.line, e.spec, e.driver, state.fuel, rng.fork(i + 1)),
        controls: { steer: 0, throttle: 0, brake: 1, reverse: false },
        surface: Surface.Asphalt,
        crossings: 0,
        progress: slot.s - track.length,
        lapStart: 0,
        lastLap: 0,
        bestLap: Infinity,
        finished: false,
        finishTime: 0,
        position: i + 1,
        contacts: 0,
        retired: false,
        retireReason: '',
        parked: false,
        pitMode: e.pitMode ?? 'auto',
        pitRequested: false,
        pitPhase: PitPhase.None,
        pitTimer: 0,
        pitStops: 0,
        pitSaving: e.pitSaving ?? 0,
        fuelPerLap: 0,
        pace: 0,
        stance: 0,
        dents: [0, 0, 0, 0],
        dirt: 0,
      };
    });
    this.order = [...this.cars];
    this.lapFuel = this.cars.map((c) => c.state.fuel);
    this.lapsCounted = this.cars.map(() => 0);
    this.directives = this.cars.map(() => ({}));
    this.seen = [...this.cars];
  }

  /** Completed laps for a car. */
  lapsDone(car: RaceCar): number {
    return Math.max(0, car.crossings - 1);
  }

  /**
   * Radio call from the pit wall. The driver takes a moment to react, longer
   * with less discipline, and a hot-headed one may ignore an order to hold.
   */
  command(carId: number, command: Command): void {
    const car = this.cars[carId];
    if (!car || car.finished || car.retired) return;
    const discipline = Math.min(1, skillLevel(car.driver, 'discipline'));
    this.pending.push({ at: this.clock + 0.8 + (1 - discipline) * 5, car: carId, command });
  }

  private obey(p: Pending): void {
    const car = this.cars[p.car];
    if (car.finished || car.retired) return;
    const discipline = Math.min(1, skillLevel(car.driver, 'discipline'));
    let obeyed = true;
    if ((p.command === 'hold' || p.command === 'save') && discipline < 0.35 && car.driver.aggression > 0.6) {
      obeyed = this.rng.next() < 0.35 + discipline;
    }
    if (obeyed) {
      switch (p.command) {
        case 'push': car.pace = 1; break;
        case 'standard': car.pace = 0; break;
        case 'save': car.pace = -1; break;
        case 'attack': car.stance = 1; break;
        case 'race': car.stance = 0; break;
        case 'hold': car.stance = -1; break;
        case 'box':
          if (car.pitPhase === PitPhase.None) car.pitRequested = true;
          break;
        case 'stayout':
          if (car.pitPhase === PitPhase.None) car.pitRequested = false;
          break;
      }
    }
    this.events.push({ type: 'radio', car: car.id, command: p.command, obeyed });
  }

  step(): void {
    const dt = SIM_DT;
    this.steps++;
    this.clock += dt;

    if (this.phase === 'countdown') {
      const lights = clamp(Math.floor((this.clock - FIRST_LIGHT) / LIGHT_INTERVAL) + 1, 0, 5);
      if (lights !== this.lights) {
        this.lights = lights;
        this.events.push({ type: 'lights', count: lights });
      }
      if (this.clock >= this.greenAt) {
        this.phase = 'racing';
        this.lights = 0;
        this.events.push({ type: 'green' });
      }
    } else {
      this.time += dt;
    }
    const sinceGreen = this.phase === 'countdown' ? -1 : this.time;

    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at <= this.clock) this.obey(this.pending.splice(i, 1)[0]);
    }

    if (this.maxHazards > 0 && this.phase === 'racing') this.updateHazards(dt);

    for (const car of this.cars) {
      if (car.parked) continue;
      const directive = this.direct(car, dt);
      const ctl = car.brain.update(car, this.seen, sinceGreen, dt, directive);
      if (car.finished) this.coolDown(car, ctl);
      car.controls = ctl;
    }

    const env: CarEnvironment = { gripFront: 1, gripRear: 1, drag: 0 };
    for (const car of this.cars) {
      if (car.parked) continue;
      const st = car.state;
      const track = this.track;
      const i = car.loc.index;
      // Each axle sees the surface under it.
      const rel = st.heading - track.heading[i];
      const lateralPerMetre = Math.sin(rel);
      const half = car.spec.wheelbase / 2;
      const front = SURFACES[track.surfaceAt(i, car.loc.d + lateralPerMetre * half)];
      const rear = SURFACES[track.surfaceAt(i, car.loc.d - lateralPerMetre * half)];
      car.surface = track.surfaceAt(i, car.loc.d);
      // Grass and gravel stick to the tyres for a while after the car rejoins.
      const dirtHere = Math.max(front.dirt, rear.dirt);
      car.dirt = dirtHere > car.dirt ? dirtHere : Math.max(0, car.dirt - dt * 0.3);
      // A tyre worn through has let go.
      let blown = st.tyreWear >= 1 ? 0.45 : 1;
      for (const h of this.hazards) {
        // Oil on the racing surface.
        if (!h.solid && (st.x - h.x) ** 2 + (st.y - h.y) ** 2 < (h.radius + 0.9) ** 2) blown *= 0.42;
      }
      const dirty = 1 - 0.07 * car.dirt;
      env.gripFront = front.grip * blown * dirty;
      env.gripRear = rear.grip * blown * dirty;
      env.drag = (front.drag + rear.drag) / 2 + (blown < 1 ? 0.08 : 0);

      const wearBefore = st.tyreWear;
      const fuelBefore = st.fuel;
      stepCar(car.spec, st, car.controls, env, car.brain.profile.mass, dt);
      const paceWear = car.pace > 0 ? 1.2 : car.pace < 0 ? 0.8 : 1;
      // Off the track the tyres are scrubbed and cut; bent suspension wears them a little faster too.
      const ground = (front.wear + rear.wear) / 2;
      const speed = Math.hypot(st.vx, st.vy);
      const abrasion = ((front.abrasion + rear.abrasion) / 2) * Math.min(1.5, speed / 30) * dt;
      const wearScale = car.brain.profile.wearFactor * this.wearScale;
      st.tyreWear = Math.min(
        1,
        wearBefore + ((st.tyreWear - wearBefore) * paceWear * ground * (1 + 0.5 * st.damage) + abrasion) * wearScale,
      );
      st.fuel = Math.max(0, fuelBefore - (fuelBefore - st.fuel) * this.wearScale * (car.pace < 0 ? 0.9 : 1));

      if (!car.retired && !car.finished && this.phase === 'racing') {
        const inLane = car.pitPhase !== PitPhase.None;
        if (st.tyreWear >= 1 && !inLane) this.retire(car, 'tyres');
        else if (st.fuel <= 0 && speed < 3 && car.pitPhase !== PitPhase.Stopped) this.retire(car, 'fuel');
      }
      if (car.retired && Math.hypot(st.vx, st.vy) < 0.5) {
        car.pitTimer += dt;
        // Marshals clear the car away.
        if (car.pitTimer > 4) {
          car.parked = true;
          // Out of everyone's way: other drivers no longer see it.
          st.x += 1e6;
          car.loc = { index: car.loc.index, s: car.loc.s, d: 1e6 };
        }
      }
    }

    this.collideCars();
    if (this.hazards.length) this.collideHazards();

    for (const car of this.cars) {
      if (car.parked) continue;
      const prevS = car.loc.s;
      car.loc = this.track.locate(car.state.x, car.state.y, car.loc.index);
      this.collideWall(car);
      this.trackLaps(car, prevS);
    }

    this.updateOrder();

    if (this.phase === 'racing') {
      const out = this.cars.reduce((n, c) => n + (c.finished || c.retired ? 1 : 0), 0);
      if (this.leaderFinished) this.endTimer += dt;
      // The others get the time of a slow lap to reach the flag.
      const grace = Math.max(90, Number.isFinite(this.fastestLap) ? this.fastestLap * 1.4 : 0);
      if (out === this.cars.length || this.endTimer > grace) {
        this.phase = 'finished';
        this.events.push({ type: 'end' });
      }
    }
  }

  /** Hazards come and go at random, away from the pits and never right in front of a car. */
  private updateHazards(dt: number): void {
    const track = this.track;
    const L = track.length;
    let changed = false;
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.life -= dt;
      if (h.drift) {
        // Animals cross back and forth.
        h.d += h.drift * dt;
        if (Math.abs(h.d) > track.halfWidth + 3) h.drift = -h.drift;
        [h.x, h.y] = track.pointAt(h.s, h.d);
        h.view.loc.d = h.d;
        h.view.state.x = h.x;
        h.view.state.y = h.y;
      }
      if (h.life <= 0) {
        this.hazards.splice(i, 1);
        this.events.push({ type: 'hazard', kind: h.kind, stage: 'cleared', car: -1 });
        changed = true;
      }
    }
    this.hazardTimer -= dt;
    if (this.hazardTimer <= 0 && this.hazards.length < this.maxHazards) {
      this.hazardTimer = this.rng.range(8, 26) / Math.sqrt(this.maxHazards);
      const s = this.rng.range(track.pit.sOut + 200, track.pit.sIn - 200);
      // Not where a car is about to arrive.
      const clear = this.cars.every((c) => c.parked || mod(s - c.loc.s, L) > 220 || mod(s - c.loc.s, L) > L - 30);
      if (clear && s > 0 && s < L) {
        let roll = this.rng.next() * HAZARD_KINDS.reduce((sum, k) => sum + k.weight, 0);
        let def = HAZARD_KINDS[0];
        for (const k of HAZARD_KINDS) {
          roll -= k.weight;
          if (roll <= 0) {
            def = k;
            break;
          }
        }
        const d = this.rng.range(-1, 1) * (track.halfWidth - 1.6);
        const [x, y] = track.pointAt(s, d);
        const size = def.radius * 2;
        const hazard: Hazard = {
          id: ++this.hazardId, kind: def.kind, s, d, x, y, radius: def.radius, solid: def.solid,
          life: this.rng.range(35, 90), drift: def.kind === 'animal' ? this.rng.range(0.8, 2.2) * (this.rng.next() < 0.5 ? -1 : 1) : 0,
          tint: this.rng.int(0, 7),
          view: {
            spec: { length: size, width: size } as CarSpec,
            state: { x, y, vx: 0, vy: 0, heading: 0 } as CarState,
            loc: { index: track.indexAt(s), s, d },
            obstacle: true,
            soft: !def.solid,
          },
        };
        this.hazards.push(hazard);
        this.events.push({ type: 'hazard', kind: def.kind, stage: 'appeared', car: -1 });
        changed = true;
      } else {
        this.hazardTimer = 1.5;
      }
    }
    if (changed) this.seen = [...this.cars, ...this.hazards.map((h) => h.view)];
  }

  /** Cars that reach a solid hazard hit it: small things are knocked away, a wreck stays put. */
  private collideHazards(): void {
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      if (!h.solid) continue;
      for (const car of this.cars) {
        if (car.parked) continue;
        const st = car.state;
        if ((st.x - h.x) ** 2 + (st.y - h.y) ** 2 > (car.spec.length / 2 + h.radius + 0.5) ** 2) continue;
        const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
        const r = car.spec.width / 2;
        let hit = false;
        for (const end of [-1, 1]) {
          const o = (car.spec.length / 2 - r) * end;
          const dx = st.x + cosH * o - h.x, dy = st.y + sinH * o - h.y;
          const dist = Math.hypot(dx, dy);
          const overlap = r + h.radius - dist;
          if (overlap <= 0 || dist < 1e-6) continue;
          const nx = dx / dist, ny = dy / dist;
          st.x += nx * overlap;
          st.y += ny * overlap;
          let wx = st.vx * cosH - st.vy * sinH, wy = st.vx * sinH + st.vy * cosH;
          const into = -(wx * nx + wy * ny);
          if (into > 0) {
            // A wreck stops the car dead in that direction; loose items only slow it.
            const solidity = h.kind === 'wreck' ? 1.15 : 0.35;
            wx += nx * into * solidity;
            wy += ny * into * solidity;
            st.vx = wx * cosH + wy * sinH;
            st.vy = -wx * sinH + wy * cosH;
            st.yawRate += clamp((cosH * o * ny - sinH * o * nx) * into * 0.05, -0.8, 0.8);
            const wreck = h.kind === 'wreck';
            this.hurt(car, cosH * o - nx * r, sinH * o - ny * r, clamp(into * (wreck ? 0.006 : 0.0025), 0, wreck ? 0.12 : 0.05));
            hit = true;
          }
        }
        if (hit) {
          this.events.push({ type: 'hazard', kind: h.kind, stage: 'hit', car: car.id });
          if (h.kind !== 'wreck') {
            this.hazards.splice(i, 1);
            this.seen = [...this.cars, ...this.hazards.map((x) => x.view)];
            break;
          }
        }
      }
    }
  }

  private retire(car: RaceCar, reason: 'fuel' | 'tyres'): void {
    car.retired = true;
    car.retireReason = reason;
    car.pitTimer = 0;
    car.pitRequested = false;
    this.events.push({ type: 'retire', car: car.id, reason });
  }

  /** Laps of fuel left at the car's current rate of use. */
  fuelLapsLeft(car: RaceCar): number {
    const perLap = car.fuelPerLap > 0 ? car.fuelPerLap : 0.75 * this.wearScale * (this.track.length / 1944);
    return car.state.fuel / perLap;
  }

  /** Time a stop takes: jacks up, four tyres, fuel in. */
  serviceTime(car: RaceCar): number {
    const fuel = Math.max(0, car.spec.startFuel - car.state.fuel);
    return 3 + Math.max(6, 22 - car.pitSaving) + fuel * 0.2;
  }

  /** Pit-lane procedure and standing orders for one car. */
  private direct(car: RaceCar, dt: number): Directive {
    const d = this.directives[car.id];
    d.laneD = undefined;
    d.speedCap = undefined;
    d.halt = false;
    d.pace = car.pace;
    d.stance = car.stance;
    if (car.retired) {
      d.halt = true;
      d.speedCap = 0;
      return d;
    }
    if (car.finished || this.phase !== 'racing') return d;

    const track = this.track;
    const pit = track.pit;
    const L = track.length;
    const s = car.loc.s;
    const st = car.state;
    const speed = Math.hypot(st.vx, st.vy);
    const lapsLeft = this.laps - this.lapsDone(car);

    // The driver calls their own stop when the car needs it.
    if (car.pitMode === 'auto' && !car.pitRequested && car.pitPhase === PitPhase.None && lapsLeft > 1) {
      if (st.tyreWear > 0.8 || this.fuelLapsLeft(car) < 1.7) {
        car.pitRequested = true;
        this.events.push({ type: 'pit', car: car.id, stage: 'called', seconds: 0 });
      }
    }

    const side = pit.side === 1 ? 1 : -1;
    const lane = side * pit.offset;
    const toEntry = mod(pit.sIn - s, L);
    if (car.pitPhase === PitPhase.None && car.pitRequested && toEntry < 160 && toEntry > 5 && lapsLeft > 0) {
      car.pitPhase = PitPhase.Inbound;
    }

    if (car.pitPhase === PitPhase.Inbound) {
      const past = mod(s - pit.sIn, L);
      const inside = past < L / 2;
      d.pace = 0;
      d.stance = -1;
      if (!inside) {
        // Slow for the pit entry line.
        d.speedCap = Math.sqrt(PIT_LIMIT * PIT_LIMIT + 2 * 7 * Math.max(0, toEntry - 4));
      } else {
        const toBox = mod(track.pitBox(car.id) - s, L);
        const overshot = toBox > L / 2;
        // Along the through lane, then across into the car's own box.
        const intoBox = overshot ? 1 : clamp((26 - toBox) / 18, 0, 1);
        d.laneD = lane * Math.min(1, (past + 18) / 50) + side * track.pitBoxInset * intoBox;
        d.speedCap = Math.min(PIT_LIMIT, overshot ? 0 : Math.sqrt(2 * 3.5 * Math.max(0, toBox - 0.6)));
        if ((toBox < 1.6 || overshot) && speed < 0.6) {
          car.pitPhase = PitPhase.Stopped;
          car.pitTimer = this.serviceTime(car);
          this.events.push({ type: 'pit', car: car.id, stage: 'in', seconds: car.pitTimer });
        }
      }
    } else if (car.pitPhase === PitPhase.Stopped) {
      d.laneD = lane + side * track.pitBoxInset;
      d.halt = true;
      d.speedCap = 0;
      car.pitTimer -= dt;
      if (car.pitTimer <= 0) {
        st.tyreWear = 0;
        st.fuel = Math.min(car.spec.fuelCapacity, Math.max(st.fuel, car.spec.startFuel));
        st.damage = Math.max(0, st.damage - 0.3);
        // New nose and wing, panels taped up.
        car.dents = car.dents.map((d) => Math.max(0, d - 0.6));
        car.pitStops++;
        car.pitRequested = false;
        car.pitPhase = PitPhase.Outbound;
        this.lapFuel[car.id] = st.fuel;
        this.events.push({ type: 'pit', car: car.id, stage: 'out', seconds: 0 });
      }
    } else if (car.pitPhase === PitPhase.Outbound) {
      const toExit = mod(pit.sOut - s, L);
      if (toExit > L / 2 || toExit < 2) {
        car.pitPhase = PitPhase.None;
      } else {
        // Hold the lane to the exit, then blend back onto the track.
        const fromBox = mod(s - track.pitBox(car.id), L);
        d.laneD = lane * Math.min(1, toExit / 45) + side * track.pitBoxInset * clamp(1 - fromBox / 16, 0, 1);
        d.speedCap = toExit > 12 ? PIT_LIMIT : undefined;
        d.stance = -1;
      }
    }
    return d;
  }

  /** After the flag: slow down and keep following the line. */
  private coolDown(car: RaceCar, ctl: Controls): void {
    const v = Math.hypot(car.state.vx, car.state.vy);
    if (v > 22) {
      ctl.throttle = 0;
      ctl.brake = Math.max(ctl.brake, 0.3);
    } else {
      ctl.throttle = Math.min(ctl.throttle, 0.25);
    }
  }

  private trackLaps(car: RaceCar, prevS: number): void {
    const L = this.track.length;
    const s = car.loc.s;
    if (car.finished || car.retired) return;
    if (prevS > L * 0.75 && s < L * 0.25) {
      car.crossings++;
      if (car.crossings <= this.lapsCounted[car.id]) {
        car.progress = (car.crossings - 1) * L + s;
        return;
      }
      this.lapsCounted[car.id] = car.crossings;
      if (car.crossings >= 2) {
        const lapTime = this.time - car.lapStart;
        car.lastLap = lapTime;
        const best = lapTime < car.bestLap;
        if (best) car.bestLap = lapTime;
        const fastest = lapTime < this.fastestLap;
        if (fastest) {
          this.fastestLap = lapTime;
          this.fastestLapCar = car.id;
        }
        // A lap with a stop in it says nothing about fuel use.
        const burned = this.lapFuel[car.id] - car.state.fuel;
        if (burned > 0) car.fuelPerLap = burned;
        this.events.push({ type: 'lap', car: car.id, lap: car.crossings - 1, time: lapTime, best, fastest });
      }
      this.lapFuel[car.id] = car.state.fuel;
      car.lapStart = this.time;
      car.brain.onNewLap();
      const done = car.crossings - 1;
      if (done >= this.laps || (this.leaderFinished && done >= 1)) {
        car.finished = true;
        car.finishTime = this.time;
        this.leaderFinished = true;
        this.finishers++;
        this.events.push({ type: 'finish', car: car.id, position: this.finishers });
      }
    } else if (prevS < L * 0.25 && s > L * 0.75) {
      car.crossings--;
    }
    car.progress = (car.crossings - 1) * L + s;
  }

  private updateOrder(): void {
    // Insertion sort: the order barely changes between steps.
    const order = this.order;
    for (let i = 1; i < order.length; i++) {
      const car = order[i];
      let j = i - 1;
      while (j >= 0 && this.ahead(car, order[j])) {
        order[j + 1] = order[j];
        j--;
      }
      order[j + 1] = car;
    }
    for (let i = 0; i < order.length; i++) {
      const car = order[i];
      const pos = i + 1;
      if (pos < car.position && this.phase === 'racing' && !car.finished && this.time > 3) {
        this.events.push({ type: 'overtake', car: car.id, passed: order[i + 1].id, position: pos });
      }
      car.position = pos;
    }
  }

  private ahead(a: RaceCar, b: RaceCar): boolean {
    if (a.finished !== b.finished) return a.finished;
    if (a.finished) return a.finishTime < b.finishTime;
    return a.progress > b.progress + 0.01;
  }

  /** Car-to-car contact: two circles per car, equal and opposite impulses. */
  private collideCars(): void {
    const cars = this.cars;
    for (let i = 0; i < cars.length; i++) {
      if (cars[i].parked) continue;
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        if (b.parked) continue;
        const dx = b.state.x - a.state.x;
        const dy = b.state.y - a.state.y;
        const reach = (a.spec.length + b.spec.length) / 2 + 0.5;
        if (dx * dx + dy * dy > reach * reach) continue;
        for (let ca = -1; ca <= 1; ca += 2) {
          for (let cb = -1; cb <= 1; cb += 2) {
            this.collideCircles(a, ca, b, cb);
          }
        }
      }
    }
  }

  private collideCircles(a: RaceCar, ca: number, b: RaceCar, cb: number): void {
    const sa = a.state;
    const sb = b.state;
    const ra = a.spec.width / 2;
    const rb = b.spec.width / 2;
    const oa = (a.spec.length / 2 - ra) * ca;
    const ob = (b.spec.length / 2 - rb) * cb;
    const cosA = Math.cos(sa.heading), sinA = Math.sin(sa.heading);
    const cosB = Math.cos(sb.heading), sinB = Math.sin(sb.heading);
    const ax = sa.x + cosA * oa, ay = sa.y + sinA * oa;
    const bx = sb.x + cosB * ob, by = sb.y + sinB * ob;
    const dx = bx - ax, dy = by - ay;
    const dist = Math.hypot(dx, dy);
    const overlap = ra + rb - dist;
    if (overlap <= 0 || dist < 1e-6) return;
    const nx = dx / dist, ny = dy / dist;

    sa.x -= nx * overlap * 0.5;
    sa.y -= ny * overlap * 0.5;
    sb.x += nx * overlap * 0.5;
    sb.y += ny * overlap * 0.5;

    // World velocities of the two centres of mass.
    const avx = sa.vx * cosA - sa.vy * sinA, avy = sa.vx * sinA + sa.vy * cosA;
    const bvx = sb.vx * cosB - sb.vy * sinB, bvy = sb.vx * sinB + sb.vy * cosB;
    const approach = (avx - bvx) * nx + (avy - bvy) * ny;
    if (approach <= 0) return;

    const impulse = approach * 0.62; // per unit mass, restitution about 0.25
    const navx = avx - nx * impulse, navy = avy - ny * impulse;
    const nbvx = bvx + nx * impulse, nbvy = bvy + ny * impulse;
    sa.vx = navx * cosA + navy * sinA;
    sa.vy = -navx * sinA + navy * cosA;
    sb.vx = nbvx * cosB + nbvy * sinB;
    sb.vy = -nbvx * sinB + nbvy * cosB;

    // Off-centre hits turn the cars.
    const spin = 0.22;
    sa.yawRate += clamp(-(cosA * oa * ny - sinA * oa * nx) * impulse * spin, -1.2, 1.2);
    sb.yawRate += clamp((cosB * ob * ny - sinB * ob * nx) * impulse * spin, -1.2, 1.2);

    if (approach > 1.5) {
      // Each car is marked where they touched.
      const dmg = clamp((approach - 2) * 0.0025, 0, 0.05);
      this.hurt(a, cosA * oa + nx * ra, sinA * oa + ny * ra, dmg);
      this.hurt(b, cosB * ob - nx * rb, sinB * ob - ny * rb, dmg);
      a.contacts++;
      b.contacts++;
      this.events.push({ type: 'contact', a: a.id, b: b.id, force: approach });
    }
  }

  private collideWall(car: RaceCar): void {
    const track = this.track;
    const i = car.loc.index;
    const side = car.loc.d >= 0 ? 1 : 0;
    const limit = track.wall[side][i] - car.spec.width / 2 - 0.3;
    const over = Math.abs(car.loc.d) - limit;
    if (over <= 0) return;
    const st = car.state;
    const sign = side === 1 ? 1 : -1;
    const nx = track.nx[i] * sign, ny = track.ny[i] * sign;
    st.x -= nx * over;
    st.y -= ny * over;
    car.loc.d -= sign * over;

    const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
    let wx = st.vx * cosH - st.vy * sinH;
    let wy = st.vx * sinH + st.vy * cosH;
    const into = wx * nx + wy * ny;
    if (into <= 0) return;
    // Remove the speed into the wall, bounce a little, scrub along it.
    wx -= nx * into * 1.2;
    wy -= ny * into * 1.2;
    const scrub = 1 - clamp(into * 0.02, 0.01, 0.5);
    wx *= scrub;
    wy *= scrub;
    st.vx = wx * cosH + wy * sinH;
    st.vy = -wx * sinH + wy * cosH;
    st.yawRate *= 0.6;
    if (into > 2) {
      // The side that met the wall: the end nearer to it takes most of it.
      const ends = [-1, 1].map((e) => (cosH * nx + sinH * ny) * e);
      const end = (ends[1] > ends[0] ? 1 : -1) * (car.spec.length / 2 - car.spec.width / 2) * Math.min(1, Math.abs(ends[1]) * 1.6);
      this.hurt(car, cosH * end + nx * car.spec.width / 2, sinH * end + ny * car.spec.width / 2, clamp((into - 2.5) * 0.0045, 0, 0.1));
      this.events.push({ type: 'wall', car: car.id, force: into });
    }
  }

  /**
   * Damage from an impact at (px, py), world metres from the car's centre.
   * The car keeps going: a little slower for it, and it shows.
   */
  private hurt(car: RaceCar, px: number, py: number, amount: number): void {
    if (amount <= 0) return;
    const st = car.state;
    st.damage = Math.min(1, st.damage + amount);
    const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
    const along = (px * cosH + py * sinH) / (car.spec.length / 2);
    const across = (-px * sinH + py * cosH) / (car.spec.width / 2);
    const zone = Math.abs(along) > Math.abs(across) * 0.8 ? (along > 0 ? 0 : 1) : across > 0 ? 2 : 3;
    const before = car.dents[zone];
    const after = Math.min(1, before + amount * 6);
    car.dents[zone] = after;
    const level = after >= 0.7 && before < 0.7 ? 2 : after >= 0.35 && before < 0.35 ? 1 : 0;
    if (level) this.events.push({ type: 'damage', car: car.id, zone: DAMAGE_ZONES[zone], level });
  }
}
