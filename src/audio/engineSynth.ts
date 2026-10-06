import type { EngineVoice } from '../game/engineVoice';

/** Where a car is heard from: how loud, which side, how its pitch is bent and dulled. */
export interface Placement {
  /** 0 (silent) to 1 (the car being watched). */
  level: number;
  /** -1 (left) to 1 (right). */
  pan: number;
  /** Pitch ratio from the car's motion toward or away from the listener. */
  doppler: number;
  /** 1 close by, toward 0 far away: distance takes the top off the sound. */
  clarity: number;
}

/** What the engine is doing. */
export interface EngineState {
  rpm: number;
  redline: number;
  throttle: number;
}

const SMOOTH = 0.03;

/**
 * One car's engine note. The pitch is the real firing frequency (cylinders
 * times revs); the layout sets the mix around it: a crank-speed growl and a
 * cam-speed wobble for uneven engines, a doubled edge for screaming ones, a
 * whistle for turbos. Built on any audio context, so it renders offline too.
 */
export class EngineSynth {
  /** The car this voice belongs to; -1 when free. */
  car = -1;

  private readonly fire: OscillatorNode;
  private readonly body: OscillatorNode;
  private readonly crank: OscillatorNode;
  private readonly edge: OscillatorNode;
  private readonly wobble: OscillatorNode;
  private readonly whistle: OscillatorNode;
  private readonly bodyGain: GainNode;
  private readonly crankGain: GainNode;
  private readonly edgeGain: GainNode;
  private readonly wobbleGain: GainNode;
  private readonly whistleGain: GainNode;
  private readonly shaper: WaveShaperNode;
  private readonly filter: BiquadFilterNode;
  private readonly amp: GainNode;
  private readonly out: GainNode;
  private readonly panner: StereoPannerNode;
  private voice: EngineVoice | null = null;
  private fresh = true;

  constructor(private readonly ctx: BaseAudioContext, destination: AudioNode) {
    const osc = (type: OscillatorType): OscillatorNode => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = 50;
      return o;
    };
    const gain = (value: number): GainNode => {
      const g = ctx.createGain();
      g.gain.value = value;
      return g;
    };
    this.fire = osc('sawtooth');
    this.body = osc('triangle');
    this.crank = osc('square');
    this.edge = osc('square');
    this.wobble = osc('sine');
    this.whistle = osc('sine');
    this.bodyGain = gain(0.6);
    this.crankGain = gain(0);
    this.edgeGain = gain(0);
    this.wobbleGain = gain(0);
    this.whistleGain = gain(0);
    const mix = gain(0.5);
    this.shaper = ctx.createWaveShaper();
    this.shaper.oversample = '2x';
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.amp = gain(1);
    this.out = gain(0);
    this.panner = ctx.createStereoPanner();

    this.fire.connect(mix);
    this.body.connect(this.bodyGain).connect(mix);
    this.crank.connect(this.crankGain).connect(mix);
    this.edge.connect(this.edgeGain).connect(mix);
    mix.connect(this.shaper).connect(this.filter).connect(this.amp).connect(this.out);
    // The cam-speed wobble rides on the volume: lumpy engines throb, even ones hum.
    this.wobble.connect(this.wobbleGain).connect(this.amp.gain);
    this.whistle.connect(this.whistleGain).connect(this.out);
    this.out.connect(this.panner).connect(destination);
    for (const o of [this.fire, this.body, this.crank, this.edge, this.wobble, this.whistle]) o.start();
  }

  /** Gives this voice to a car with the given engine; the next update jumps straight to its note. */
  assign(car: number, voice: EngineVoice): void {
    this.car = car;
    if (voice !== this.voice) {
      this.voice = voice;
      this.shaper.curve = driveCurve(1 + 9 * voice.rasp * (0.4 + 0.6 * voice.open));
    }
    this.fresh = true;
  }

  /** Fades the voice out and frees it. */
  release(): void {
    this.car = -1;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
  }

  update(engine: EngineState, at: Placement): void {
    const v = this.voice;
    if (!v) return;
    const t = this.ctx.currentTime;
    const rev = Math.max(0, Math.min(1, engine.rpm / engine.redline));
    const crankHz = (engine.rpm / 60) * v.tune * at.doppler;
    const fireHz = (crankHz * v.cylinders) / 2;
    const thr = engine.throttle;
    const set = (param: AudioParam, value: number, smooth = SMOOTH): void => {
      if (this.fresh) param.setValueAtTime(value, t);
      else param.setTargetAtTime(value, t, smooth);
    };

    set(this.fire.frequency, fireHz);
    set(this.body.frequency, fireHz / 2);
    set(this.crank.frequency, crankHz);
    set(this.edge.frequency, fireHz * 2);
    set(this.wobble.frequency, crankHz / 2);
    // Big engines carry more of the low notes; uneven ones growl at crank speed, mostly at low revs.
    set(this.bodyGain.gain, 0.35 + 0.5 * v.size);
    set(this.crankGain.gain, v.lump * (0.25 + 0.35 * v.size) * (1 - 0.5 * rev));
    set(this.edgeGain.gain, v.rasp * (0.1 + 0.35 * rev) * (0.5 + 0.5 * thr));
    set(this.wobbleGain.gain, v.lump * 0.45 * (1 - 0.6 * rev));

    // The note opens up with the throttle; an open exhaust is brighter, turbines and distance muffle it.
    const bright = 0.4 * v.rasp + 0.6 * v.open;
    const cutoff = (260 + 1300 * rev + thr * (700 + 2200 * bright)) * (1 - 0.3 * v.turbo) * (0.3 + 0.7 * at.clarity);
    set(this.filter.frequency, cutoff, 0.05);
    set(this.filter.Q, 0.8 + 3 * v.rasp, 0.1);

    const loud = (0.35 + 0.45 * thr + 0.2 * rev) * (0.75 + 0.5 * v.open) * (1 - 0.15 * v.turbo);
    // The volume always eases in, so a voice handed to a new car does not click.
    this.out.gain.setTargetAtTime(0.3 * at.level * loud, t, 0.05);
    set(this.panner.pan, at.pan, 0.05);

    // Turbo whistle rises with boost, which comes with revs under load.
    const boost = v.turbo * thr * rev * rev;
    set(this.whistle.frequency, (2400 + 4200 * rev) * at.doppler);
    set(this.whistleGain.gain, 0.05 * boost * at.level * at.clarity, 0.08);
    this.fresh = false;
  }

  dispose(): void {
    for (const o of [this.fire, this.body, this.crank, this.edge, this.wobble, this.whistle]) o.stop();
    this.panner.disconnect();
  }
}

/** Soft clipping: more drive gives a rawer, buzzier note. */
function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}
