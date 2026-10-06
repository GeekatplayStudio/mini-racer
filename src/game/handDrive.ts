import type { CarSpec, CarState, Controls } from '../sim/car';
import { GRAVITY, clamp } from '../sim/math';

/** Which driving keys are held down. */
export interface DriveKeys {
  left: boolean;
  right: boolean;
  /** Accelerate. */
  up: boolean;
  /** Brake, or reverse once stopped. */
  down: boolean;
}

/** How fast the keys move the controls, per second. */
const STEER_IN = 4.5;
const STEER_OUT = 7;
const PEDAL_IN = 7;
const PEDAL_OUT = 12;
/** Share of the slide the steering catches by itself. */
const CATCH = 0.7;
/** Below this forward speed, m/s, holding brake engages reverse. */
const REVERSE_BELOW = 0.8;

/**
 * Turns on/off keys into smooth car controls. Keys cannot be held halfway, so
 * this limits the steering to what the tyres can use at the current speed and
 * catches a sliding rear, the way a driver would with a wheel.
 */
export class HandDriver {
  readonly controls: Controls = { steer: 0, throttle: 0, brake: 0, reverse: false };
  private steer = 0;
  private throttle = 0;
  private brake = 0;
  private reversing = false;

  reset(): void {
    this.steer = this.throttle = this.brake = 0;
    this.reversing = false;
    Object.assign(this.controls, { steer: 0, throttle: 0, brake: 0, reverse: false });
  }

  update(keys: DriveKeys, spec: CarSpec, st: CarState, dt: number): Controls {
    const turn = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    const rate = turn === 0 || Math.sign(turn) !== Math.sign(this.steer) ? STEER_OUT : STEER_IN;
    this.steer = approach(this.steer, turn, rate * dt);

    // Reverse once stopped with the brake held; drive on again with the throttle.
    if (keys.down && !keys.up && st.vx < REVERSE_BELOW) this.reversing = true;
    else if (keys.up || st.vx > REVERSE_BELOW) this.reversing = false;
    const go = this.reversing ? keys.down : keys.up && st.vx > -0.5;
    const stop = this.reversing ? keys.up : keys.down || (keys.up && st.vx <= -0.5);
    this.throttle = approach(this.throttle, go ? 1 : 0, (go ? PEDAL_IN : PEDAL_OUT) * dt);
    this.brake = approach(this.brake, stop ? 1 : 0, (stop ? PEDAL_IN : PEDAL_OUT) * dt);

    // The most lock the front tyres can use at this speed: the grip-limited turn plus the slip angle at peak grip.
    const v = Math.max(Math.abs(st.vx), 1);
    const peakSlip = Math.tan(Math.PI / (2 * spec.tyre.c)) / spec.tyre.b;
    const usable = 0.62 * peakSlip + (spec.wheelbase * spec.tyre.muFront * GRAVITY) / (v * v);
    let angle = this.steer * Math.min(spec.maxSteer, usable);
    // Point the front wheels where the car is going when the rear steps out.
    if (st.vx > 3 && !this.reversing) angle += CATCH * Math.atan2(st.vy, st.vx);

    const c = this.controls;
    c.steer = clamp(angle / spec.maxSteer, -1, 1);
    c.throttle = this.throttle;
    c.brake = this.brake;
    c.reverse = this.reversing;
    return c;
  }
}

function approach(value: number, target: number, step: number): number {
  return value < target ? Math.min(target, value + step) : Math.max(target, value - step);
}
