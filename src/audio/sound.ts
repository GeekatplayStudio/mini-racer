import type { EngineVoice } from '../game/engineVoice';
import type { CarState } from '../sim/car';
import { clamp } from '../sim/math';
import type { RaceCar, RaceEvent } from '../sim/race';
import { Surface } from '../sim/track';
import { EngineSynth, Placement } from './engineSynth';

const STORE_KEY = 'miniracer.muted';
/** Engines heard at once: the watched car and the nearest others. */
const VOICES = 6;
/** Beyond this distance, m, another car is not heard. */
const EARSHOT = 300;
const SPEED_OF_SOUND = 343;
/** Pass-bys are bent a little more than nature would, so they come through the other engines. */
const DOPPLER_BOOST = 1.5;

/** Where the sound is heard from, in race coordinates: position, velocity and the direction that is right on screen. */
export interface Ear {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rightX: number;
  rightY: number;
}

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Level, side, pitch bend and dullness of a car heard from the ear; written into `out`. */
export function placeCar(st: CarState, ear: Ear, out: Placement): Placement {
  const dx = st.x - ear.x, dy = st.y - ear.y;
  const d = Math.hypot(dx, dy);
  const ux = d > 0.5 ? dx / d : 0, uy = d > 0.5 ? dy / d : 0;
  const cosH = Math.cos(st.heading), sinH = Math.sin(st.heading);
  // Speed along the line between them: positive when the car is pulling away.
  const away = (st.vx * cosH - st.vy * sinH - ear.vx) * ux + (st.vx * sinH + st.vy * cosH - ear.vy) * uy;
  out.level = 0.9 / (1 + (d / 22) ** 1.6);
  out.pan = clamp(ux * ear.rightX + uy * ear.rightY, -1, 1) * 0.8 * Math.min(1, d / 6);
  out.doppler = clamp(SPEED_OF_SOUND / (SPEED_OF_SOUND + DOPPLER_BOOST * away), 0.7, 1.4);
  out.clarity = clamp(1.15 - d / 220, 0.15, 1);
  return out;
}

/**
 * All game sound, synthesised with Web Audio: no audio files are loaded.
 * Every car has its own engine note; the watched car is heard onboard and
 * the nearest others around it, placed left or right, dulled by distance and
 * bent in pitch as they pass. Tyre squeal and wind follow the watched car;
 * short effects mark lights, impacts, pit stops and results.
 */
export class Sound {
  muted = readMuted();

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engines: EngineSynth[] = [];
  private skidGain!: GainNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  private lastHit = 0;
  private readonly near: { id: number; d: number }[] = [];
  private readonly place: Placement = { level: 0, pan: 0, doppler: 1, clarity: 1 };
  /** The watched car's throttle last frame, for the pops and blow-off when it lifts. */
  private lastThrottle = 0;
  private lastFocus = -1;
  private lastLift = 0;

  /** Browsers only allow sound after a click or key press; call this from one. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);

    // One second of white noise, shared by squeal, wind and impacts.
    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    for (let i = 0; i < VOICES; i++) this.engines.push(new EngineSynth(ctx, this.master));

    this.skidGain = this.loop('bandpass', 1900, 3);
    this.windGain = this.loop('lowpass', 500, 0.5);
  }

  private loop(type: BiquadFilterType, frequency: number, q: number): GainNode {
    const ctx = this.ctx as AudioContext;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
    return gain;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    try {
      localStorage.setItem(STORE_KEY, muted ? '1' : '0');
    } catch {
      // Private windows may refuse storage; the setting then lasts for this visit.
    }
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.5, this.ctx.currentTime, 0.03);
  }

  /** Silences everything while the page is hidden; the frame loop that drives the engine note stops then. */
  setHidden(hidden: boolean): void {
    if (!this.ctx) return;
    if (hidden) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  /** Ids of the cars whose engines are playing, for tests and debugging. */
  get heard(): number[] {
    return this.engines.filter((e) => e.car >= 0).map((e) => e.car);
  }

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Stops the engines, tyres and wind: paused, between races, on the menus. */
  silence(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const engine of this.engines) if (engine.car >= 0) engine.release();
    this.skidGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    this.windGain.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    this.lastFocus = -1;
  }

  /**
   * Plays the race for one frame: the watched car onboard, the nearest others
   * from where they are. `voices` is indexed by car id.
   */
  hear(cars: readonly RaceCar[], voices: readonly EngineVoice[], focus: number, ear: Ear): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const me = cars[focus];
    if (!me || me.parked) {
      this.silence();
      return;
    }

    // The nearest other cars in earshot get the remaining voices.
    const near = this.near;
    near.length = 0;
    for (const car of cars) {
      if (car.id === focus || car.parked) continue;
      const d = Math.hypot(car.state.x - ear.x, car.state.y - ear.y);
      if (d < EARSHOT) near.push({ id: car.id, d });
    }
    near.sort((a, b) => a.d - b.d);
    if (near.length > VOICES - 1) near.length = VOICES - 1;
    const wanted = (id: number): boolean => id === focus || near.some((n) => n.id === id);
    for (const engine of this.engines) if (engine.car >= 0 && !wanted(engine.car)) engine.release();
    for (const id of [focus, ...near.map((n) => n.id)]) {
      if (this.engines.some((e) => e.car === id)) continue;
      this.engines.find((e) => e.car < 0)?.assign(id, voices[id]);
    }

    for (const engine of this.engines) {
      if (engine.car < 0) continue;
      const car = cars[engine.car];
      if (engine.car === focus) Object.assign(this.place, { level: 1, pan: 0, doppler: 1, clarity: 1 });
      else placeCar(car.state, ear, this.place);
      engine.update({ rpm: car.state.rpm, redline: car.spec.engine.redline, throttle: car.state.throttle }, this.place);
    }

    const t = ctx.currentTime;
    const st = me.state;
    const onRoad = me.surface === Surface.Asphalt || me.surface === Surface.Kerb;
    const speed = Math.hypot(st.vx, st.vy);
    const slide = Math.max(st.slideFront, st.slideRear);
    // Tarmac squeals; grass and gravel rumble through the wind channel instead.
    this.skidGain.gain.setTargetAtTime(onRoad ? Math.min(0.22, slide * 0.3) : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(0.2, speed / 400) + (onRoad ? 0 : Math.min(0.25, speed / 60)), t, 0.1);
    this.liftOff(me, voices[focus], t);
  }

  /** Off the throttle at high revs: a turbo blows off, an open exhaust pops and crackles. */
  private liftOff(me: RaceCar, voice: EngineVoice, t: number): void {
    const st = me.state;
    if (me.id !== this.lastFocus) {
      this.lastFocus = me.id;
      this.lastThrottle = st.throttle;
      return;
    }
    const lifted = this.lastThrottle > 0.75 && st.throttle < 0.2 && st.rpm > me.spec.engine.redline * 0.55;
    this.lastThrottle = st.throttle;
    if (!lifted || t - this.lastLift < 0.8) return;
    this.lastLift = t;
    if (voice.turbo > 0) this.burst(2600, 0.32, 0.07 * voice.turbo, 0, 'bandpass');
    if (voice.open > 0.35 && voice.turbo < 1) {
      const pops = 2 + Math.floor(Math.random() * 4 * voice.open);
      for (let i = 0; i < pops; i++) this.burst(700 + Math.random() * 900, 0.05, 0.12 * voice.open, 0.04 + Math.random() * 0.45);
    } else if (voice.open > 0.6) {
      this.burst(600, 0.06, 0.08 * voice.open, 0.08);
    }
  }

  /** A short tone. */
  beep(frequency: number, seconds: number, volume = 0.25, type: OscillatorType = 'square', delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = frequency;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  /** A burst of filtered noise: impacts, air guns, exhaust pops. */
  burst(frequency: number, seconds: number, volume: number, delay = 0, type: BiquadFilterType = 'lowpass'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, frequency * 0.2), t + seconds);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t, Math.random() * 0.5, seconds + 0.05);
  }

  click(): void {
    this.beep(1300, 0.04, 0.08);
  }

  crash(force: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.currentTime - this.lastHit < 0.12) return;
    this.lastHit = ctx.currentTime;
    const v = Math.min(0.7, 0.15 + force * 0.03);
    this.burst(900 + force * 60, 0.28, v);
    this.beep(70, 0.2, v * 0.8, 'sine');
  }

  /** Sounds for what just happened in the race, from the watched car's point of view. */
  events(events: readonly RaceEvent[], focusCar: number, playerCar: number): void {
    if (!this.ctx) return;
    const mine = (id: number): boolean => id === focusCar || id === playerCar;
    for (const ev of events) {
      switch (ev.type) {
        case 'lights':
          if (ev.count > 0) this.beep(440, 0.16, 0.22);
          break;
        case 'green':
          this.beep(880, 0.5, 0.25);
          break;
        case 'contact':
          if (mine(ev.a) || mine(ev.b)) this.crash(ev.force);
          break;
        case 'wall':
          if (mine(ev.car)) this.crash(ev.force);
          break;
        case 'hazard':
          if (ev.stage === 'hit' && mine(ev.car)) this.crash(8);
          else if (ev.stage === 'appeared') this.beep(620, 0.1, 0.1, 'triangle');
          break;
        case 'pit':
          if (mine(ev.car) && ev.stage === 'in') for (let i = 0; i < 4; i++) this.burst(3200, 0.22, 0.2, 0.6 + i * 0.45);
          break;
        case 'radio':
          if (ev.car === playerCar) this.beep(ev.obeyed ? 980 : 300, 0.07, 0.12, 'triangle');
          break;
        case 'retire':
          if (mine(ev.car)) this.beep(160, 0.6, 0.2, 'sawtooth');
          break;
        case 'lap':
          if (ev.fastest && ev.lap > 1) [660, 990].forEach((f, i) => this.beep(f, 0.12, 0.12, 'triangle', i * 0.1));
          break;
        case 'finish':
          if (ev.position === 1 || ev.car === playerCar) [523, 659, 784, 1047].forEach((f, i) => this.beep(f, 0.22, 0.16, 'square', i * 0.13));
          break;
      }
    }
  }
}
