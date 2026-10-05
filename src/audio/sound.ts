import type { CarSpec, CarState } from '../sim/car';
import type { RaceEvent } from '../sim/race';

const STORE_KEY = 'miniracer.muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(STORE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * All game sound, synthesised with Web Audio: no audio files are loaded.
 * The engine note, tyre squeal and wind follow the car being watched; short
 * effects mark lights, impacts, pit stops and results.
 */
export class Sound {
  muted = readMuted();

  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineGain!: GainNode;
  private engineFilter!: BiquadFilterNode;
  private engineA!: OscillatorNode;
  private engineB!: OscillatorNode;
  private skidGain!: GainNode;
  private windGain!: GainNode;
  private noise!: AudioBuffer;
  private lastHit = 0;

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

    // Engine: two detuned voices through a filter that opens with the throttle.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 600;
    this.engineA = ctx.createOscillator();
    this.engineA.type = 'sawtooth';
    this.engineB = ctx.createOscillator();
    this.engineB.type = 'square';
    const sub = ctx.createGain();
    sub.gain.value = 0.45;
    this.engineA.connect(this.engineFilter);
    this.engineB.connect(sub).connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain).connect(this.master);
    this.engineA.start();
    this.engineB.start();

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

  toggle(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Follows the watched car each frame. Pass null when no car should be heard. */
  follow(spec: CarSpec | null, st: CarState | null, onRoad = true): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (!spec || !st) {
      this.engineGain.gain.setTargetAtTime(0, t, 0.08);
      this.skidGain.gain.setTargetAtTime(0, t, 0.08);
      this.windGain.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    const rev = Math.max(0, Math.min(1, st.rpm / spec.engine.redline));
    const base = 38 + rev * 150;
    this.engineA.frequency.setTargetAtTime(base, t, 0.03);
    this.engineB.frequency.setTargetAtTime(base * 0.502, t, 0.03);
    this.engineFilter.frequency.setTargetAtTime(350 + rev * 1400 + st.throttle * 1500, t, 0.05);
    this.engineGain.gain.setTargetAtTime(0.1 + 0.16 * st.throttle + 0.06 * rev, t, 0.05);
    const speed = Math.hypot(st.vx, st.vy);
    const slide = Math.max(st.slideFront, st.slideRear);
    // Tarmac squeals; grass and gravel rumble through the wind channel instead.
    this.skidGain.gain.setTargetAtTime(onRoad ? Math.min(0.22, slide * 0.3) : 0, t, 0.05);
    this.windGain.gain.setTargetAtTime(Math.min(0.2, speed / 400) + (onRoad ? 0 : Math.min(0.25, speed / 60)), t, 0.1);
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

  /** A burst of filtered noise: impacts, air guns. */
  burst(frequency: number, seconds: number, volume: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
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
