import { CarSpec, CarState, Controls } from './car';
import { DriverDef, DriverProfile, deriveProfile } from './driver';
import { RacingLine, computeSpeedProfile } from './line';
import { AIR_DENSITY, clamp, mod, wrapAngle } from './math';
import { Rng } from './rng';
import { Track, TrackLocation } from './track';

/** Instructions from the pit wall and the pit-lane procedure, applied on top of the driver's own judgement. */
export interface Directive {
  /** Drive at this lateral offset instead of the racing line (pit lane). */
  laneD?: number;
  speedCap?: number;
  /** -1 save tyres and fuel, 0 standard, 1 push. */
  pace?: number;
  /** -1 hold position, 0 race normally, 1 attack. */
  stance?: number;
  /** Stand on the brakes. */
  halt?: boolean;
}

/** What a driver can see of a car on track, including their own. */
export interface CarView {
  spec: CarSpec;
  state: CarState;
  loc: TrackLocation;
  /** 2 while standing in a pit box, out of the way of the through lane. */
  pitPhase?: number;
  /** Something lying on the track rather than a competitor: always to be driven round. */
  obstacle?: boolean;
  /** An obstacle that can be driven through at a cost, such as oil. */
  soft?: boolean;
}

/**
 * Deterministic driver AI. Follows the racing line with pure-pursuit steering,
 * tracks a speed profile computed for its own car and skill, and deals with
 * traffic. All behaviour differences between drivers come from DriverProfile.
 */
export class DriverBrain {
  readonly profile: DriverProfile;
  /** 0 (fresh) to 1 (exhausted). */
  fatigue = 0;
  /** 0..1, how hard the driver is being pressed from behind. */
  pressure = 0;
  /** Seconds remaining of the current driving error, 0 when none. */
  mistakeTimer = 0;
  mistakes = 0;

  private readonly speed: Float64Array;
  private readonly rng: Rng;
  private passOffset = 0;
  private lapFactor = 1;
  private wander = 0;
  private wanderTarget = 0;
  private wanderTimer = 0;
  private inBrakeZone = false;
  private startDelay = -1;
  private stuckTimer = 0;
  private reverseTimer = 0;
  /** Seconds spent at a crawl with nothing official holding the car there. */
  private stalled = 0;
  /** Seconds left of getting going again after a stop: stopped cars are driven round, not waited for. */
  private recovering = 0;
  private readonly out: Controls = { steer: 0, throttle: 0, brake: 0, reverse: false };

  constructor(
    private readonly track: Track,
    private readonly line: RacingLine,
    spec: CarSpec,
    def: DriverDef,
    fuel: number,
    rng: Rng,
  ) {
    this.profile = deriveProfile(def);
    this.rng = rng;
    this.speed = computeSpeedProfile(track, line, spec, {
      mass: spec.mass + this.profile.mass + fuel,
      cornerGrip: this.profile.cornerGrip,
      brakeGrip: this.profile.brakeGrip,
    });
  }

  /** Target speed on the ideal line at a sample, before lap-to-lap variation. */
  targetSpeedAt(index: number): number {
    return this.speed[mod(index, this.track.n)];
  }

  onNewLap(): void {
    const noise = clamp(this.rng.normal(), -2, 2) * this.profile.paceNoise;
    this.lapFactor = 1 + noise;
  }

  /**
   * Decides steering, throttle and brake for this step.
   * @param sinceGreen seconds since the lights went out; negative before the start.
   */
  update(me: CarView, others: readonly CarView[], sinceGreen: number, dt: number, directive?: Directive): Controls {
    const out = this.out;
    out.reverse = false;
    const track = this.track;
    const st = me.state;
    const p = this.profile;
    const v = Math.hypot(st.vx, st.vy);

    if (sinceGreen < 0) {
      out.steer = 0;
      out.throttle = 0;
      out.brake = 1;
      return out;
    }
    if (this.startDelay < 0) {
      this.startDelay = p.reactionTime * (0.85 + 0.3 * this.rng.next());
      // Hold the grid lane off the line, then blend onto the racing line.
      this.passOffset = me.loc.d - this.line.offset[me.loc.index];
    }
    if (sinceGreen < this.startDelay) {
      out.steer = 0;
      out.throttle = 0;
      out.brake = 1;
      return out;
    }

    // A comfortable cockpit keeps the driver fresh for longer.
    const strain = clamp(1.15 - me.spec.comfort, 0.6, 1.2) * (0.5 + 0.5 * Math.min(1, v / 50));
    this.fatigue = Math.min(1, this.fatigue + p.fatigueRate * dt * strain);

    // Slow wander off the ideal line: less precise drivers drift further.
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderTimer = 2 + this.rng.next() * 3;
      this.wanderTarget = this.rng.normal() * p.lineNoise * (1 + this.fatigue);
    }
    this.wander += (this.wanderTarget - this.wander) * Math.min(1, dt * 0.8);

    const n = track.n;
    const idx = me.loc.index;
    const hw = track.halfWidth;
    const lineHere = this.line.offset[idx];

    // Stopped after a spin or a shunt, or boxed in by stopped cars: after a moment, get going again.
    const official = directive?.halt || directive?.laneD !== undefined;
    if (v < 2 && !official) this.stalled += dt;
    else if (v > 4 || official) this.stalled = 0;
    if (this.stalled > 2) {
      this.recovering = 5;
      this.stalled = 0;
    }
    if (this.recovering > 0) this.recovering = v > 12 ? 0 : this.recovering - dt;
    const recovering = this.recovering > 0;

    // --- Traffic ---------------------------------------------------------
    const stance = directive?.stance ?? 0;
    const pace = directive?.pace ?? 0;
    const passThreshold = p.passThreshold * (stance > 0 ? 0.35 : 1);
    const followGap = p.followGap * (stance > 0 ? 0.75 : 1);
    const lookDist = Math.max(22, v * p.lookahead);
    let speedCap = Infinity;
    let desiredPass = 0;
    let holdOffset = false;
    // Lateral band left free by cars alongside.
    let bandMin = -Infinity;
    let bandMax = Infinity;
    let blockerGap = Infinity;
    let blocker: CarView | null = null;
    let pressure = 0;
    const myTargetD = lineHere + this.passOffset;

    const inLane = directive?.laneD !== undefined;
    for (const other of others) {
      if (other === me) continue;
      // A car being serviced in its box is clear of the lane.
      if (other.pitPhase === 2) continue;
      let gap = other.loc.s - me.loc.s;
      if (gap > track.length / 2) gap -= track.length;
      else if (gap < -track.length / 2) gap += track.length;
      const clearLen = (me.spec.length + other.spec.length) / 2;
      const clearWid = (me.spec.width + other.spec.width) / 2;
      const lateral = other.loc.d - me.loc.d;
      // A car stopped on track is driven round like anything else lying there.
      const halted = !other.obstacle && Math.hypot(other.state.vx, other.state.vy) < 2.5;

      if (gap < 0 && gap > -14 && !other.obstacle) pressure = Math.max(pressure, 1 + gap / 14);

      // Alongside: leave them room, and do not blend back across them.
      if (Math.abs(gap) < clearLen + 2 && !inLane && !(recovering && halted)) {
        const need = clearWid + 0.45 + 0.35 * (1 - p.aggression);
        if (lateral > 0) bandMax = Math.min(bandMax, other.loc.d - need);
        else bandMin = Math.max(bandMin, other.loc.d + need);
        if (Math.abs(lateral) < clearWid + 2.5) holdOffset = true;
        // Overlapping their tail: back out of it.
        if (gap > 0 && Math.abs(lateral) < clearWid + 0.1) {
          speedCap = Math.min(speedCap, Math.hypot(other.state.vx, other.state.vy) - 1.5);
        }
      }

      if (gap > 0 && gap < lookDist * (other.obstacle ? 2.4 : 1)) {
        const inPath = Math.abs(other.loc.d - myTargetD) < clearWid + 0.35;
        const inFront = Math.abs(lateral) < clearWid + 0.2;
        if ((inPath || inFront) && gap < blockerGap) {
          blockerGap = gap;
          blocker = other;
        }
      }
    }
    this.pressure += (pressure - this.pressure) * Math.min(1, dt * 2);
    if (directive?.speedCap !== undefined) speedCap = Math.min(speedCap, directive.speedCap);

    if (blocker) {
      const bs = blocker.state;
      const vo = Math.hypot(bs.vx, bs.vy);
      const clearLen = (me.spec.length + blocker.spec.length) / 2;
      const clearWid = (me.spec.width + blocker.spec.width) / 2;
      const free = blockerGap - clearLen;
      const closing = v - vo;
      const myPace = this.speed[idx] * this.lapFactor;
      const reach = followGap + Math.max(0, closing) * 1.4;

      if (free < reach + 12) {
        // Only the bold try a move once the braking zone has started.
        const halted = blocker.obstacle || vo < 2.5;
        const wantsPass =
          halted ||
          (stance >= 0 &&
          (closing > passThreshold || myPace > vo + passThreshold + 1) &&
          (!this.inBrakeZone || p.aggression > 0.62));
        let passD: number | null = null;
        if (wantsPass) {
          const shift = clearWid + p.passMargin;
          const limit = hw - me.spec.width / 2 - 0.25;
          const candA = blocker.loc.d - shift;
          const candB = blocker.loc.d + shift;
          const okA = Math.abs(candA) <= limit && this.laneFree(me, others, blocker, candA);
          const okB = Math.abs(candB) <= limit && this.laneFree(me, others, blocker, candB);
          if (okA && okB) {
            // Prefer the inside of the next corner, otherwise the smaller move.
            const kAhead = track.curvature[(idx + Math.round(40 / track.ds)) % n];
            if (Math.abs(kAhead) > 1 / 200) passD = kAhead > 0 ? candB : candA;
            else passD = Math.abs(candA - me.loc.d) < Math.abs(candB - me.loc.d) ? candA : candB;
          } else if (okA) passD = candA;
          else if (okB) passD = candB;
          else if (recovering && halted) {
            // Stuck behind it with no clean way by: squeeze past where there is most road.
            passD = clamp(Math.abs(candA) < Math.abs(candB) ? candA : candB, -limit, limit);
          }
        }
        if (passD !== null) {
          desiredPass = passD - lineHere;
          holdOffset = false;
          // Until clear laterally, do not drive into the back of them.
          if (Math.abs(blocker.loc.d - me.loc.d) < clearWid + 0.15 && free < reach) {
            speedCap = Math.sqrt(vo * vo + 2 * 9 * Math.max(0, free - 2));
          }
        } else if (blocker.soft) {
          // No way round the oil: slow down and drive through it.
          speedCap = Math.min(speedCap, Math.max(16, v * 0.8));
        } else if (free < reach) {
          speedCap = Math.sqrt(vo * vo + 2 * 8 * Math.max(0, free - followGap * 0.45));
          desiredPass = this.passOffset;
        }
      }
    }

    if (!holdOffset) {
      const rate = (2.2 + 2 * p.aggression) * dt;
      this.passOffset += clamp(desiredPass - this.passOffset, -rate, rate);
    }

    // --- Steering: pure pursuit ------------------------------------------
    const cosH = Math.cos(st.heading);
    const sinH = Math.sin(st.heading);
    const lookAhead = clamp(4.5 + 0.3 * v, 6, 34);
    const aheadIdx = (idx + Math.round(lookAhead / track.ds)) % n;
    const edge = hw - me.spec.width / 2 - 0.15;
    const offRoad = Math.abs(me.loc.d) > hw + 0.8 && directive?.laneD === undefined;
    let targetD = clamp(this.line.offset[aheadIdx] + this.passOffset + this.wander, -edge, edge);
    if (bandMin > -Infinity || bandMax < Infinity) {
      const lo = Math.max(bandMin, -edge);
      const hi = Math.min(bandMax, edge);
      // Squeezed from both sides: hold station and lift.
      if (lo > hi) {
        targetD = clamp(me.loc.d, -edge, edge);
        speedCap = Math.min(speedCap, recovering ? Math.max(4, v - 0.5) : v - 0.5);
      } else {
        const clamped = clamp(targetD, lo, hi);
        if (clamped !== targetD) this.passOffset = clamped - this.line.offset[aheadIdx];
        targetD = clamped;
      }
    }
    // Pit lane: leave the racing line for the lane the pit wall has given.
    if (directive?.laneD !== undefined) {
      targetD = directive.laneD;
      this.passOffset = targetD - this.line.offset[aheadIdx];
    }
    const tx = track.x[aheadIdx] + track.nx[aheadIdx] * targetD;
    const ty = track.y[aheadIdx] + track.ny[aheadIdx] * targetD;
    const dx = tx - st.x;
    const dy = ty - st.y;
    const lx = dx * cosH + dy * sinH;
    const ly = -dx * sinH + dy * cosH;
    const dist = Math.max(1, Math.hypot(lx, ly));
    const headingError = wrapAngle(track.heading[idx] - st.heading);

    let steerAngle: number;
    let spun = false;
    if (lx < 0 || Math.abs(headingError) > 1.9) {
      // Facing the wrong way: turn round on the spot.
      spun = true;
      steerAngle = (ly >= 0 ? 1 : -1) * me.spec.maxSteer;
    } else {
      steerAngle = Math.atan2(2 * me.spec.wheelbase * ly, dist * dist);
      // Damp yaw the driver did not ask for; better car control reacts harder.
      const wantYaw = (v * 2 * ly) / (dist * dist);
      steerAngle += clamp((wantYaw - st.yawRate) * 0.06 * (0.4 + p.catchAngle * 3), -0.12, 0.12);
    }
    out.steer = clamp(steerAngle / me.spec.maxSteer, -1, 1);

    // Side by side, nobody is on the ideal line: leave a margin.
    const crowded = bandMin > -Infinity || bandMax < Infinity;

    // --- Speed -----------------------------------------------------------
    const paceIdx = (idx + Math.round((v * 0.06) / track.ds)) % n;
    const fatigueLoss = 1 - 0.035 * this.fatigue;
    const offLine = Math.abs(this.passOffset);
    // A damaged car has less downforce; a sensible driver backs off to suit.
    const scale =
      this.lapFactor * fatigueLoss * (1 - Math.min(0.16, 0.03 * offLine)) * (1 - 0.06 * st.damage) *
      (crowded ? 0.94 : 1) * (pace > 0 ? 1.006 : pace < 0 ? 0.985 : 1);
    let target = this.speed[paceIdx] * scale;
    const next = this.speed[(paceIdx + 1) % n] * scale;
    const feedForward = (next * next - target * target) / (2 * track.ds);

    // Each braking zone is a chance to get it wrong.
    const braking = this.inBrakeZone ? feedForward < -1 : feedForward < -6;
    if (braking && !this.inBrakeZone) {
      const chance =
        p.mistakeRate * (1 + 2 * this.fatigue) * (1 + 1.5 * this.pressure * p.pressureSensitivity) *
        (pace > 0 ? 1.8 : pace < 0 ? 0.5 : 1);
      if (this.rng.next() < chance) {
        this.mistakeTimer = 0.9 + this.rng.next() * 0.7;
        this.mistakes++;
      }
    }
    this.inBrakeZone = braking;
    if (this.mistakeTimer > 0) {
      this.mistakeTimer -= dt;
      target *= 1.05;
    }

    if (offRoad) target = Math.min(target, 24);
    // Well off the intended line: ease off until back on it.
    const lineError = Math.abs(me.loc.d - (lineHere + this.passOffset));
    if (lineError > 2.5) target *= clamp(1 - (lineError - 2.5) * 0.08, 0.6, 1);
    if (spun) target = Math.min(target, 9);
    // Getting going again: a crawl past whatever is stopped, letting the bodywork sort out a nudge.
    if (recovering && !official) speedCap = Math.max(speedCap, 4.5);
    // Held below the car's own pace by traffic or the pit wall: the plan for the corner ahead no longer applies.
    const capped = speedCap < target;
    target = Math.min(target, Math.max(0, speedCap));

    const slip = Math.abs(Math.atan2(st.vy, Math.max(4, Math.abs(st.vx))));
    const sliding = clamp((slip - p.catchAngle * 0.5) / 0.15, 0, 1);

    const planned = this.mistakeTimer > 0 || capped ? 0 : feedForward;
    const accel = planned + 1.8 * (target - v);
    if (target < 0.3 && capped) {
      // Coming to a stop on a mark.
      out.brake = v > 2 ? 0.6 : 0.35;
      out.throttle = 0;
    } else if (accel < -0.8 && v > target) {
      const mass = me.spec.mass + p.mass + st.fuel;
      const drag = 0.5 * AIR_DENSITY * me.spec.cdA * v * v;
      out.brake = clamp((-accel * mass - drag) / me.spec.brakeForce, 0, 1);
      out.throttle = 0;
    } else {
      out.brake = 0;
      out.throttle = clamp(0.3 + (target - v) * 0.8 + planned / 6, 0, 1) * (1 - 0.7 * sliding);
    }

    // Nose against a barrier or another car: back out, then carry on.
    if (this.reverseTimer > 0) {
      this.reverseTimer -= dt;
      out.reverse = true;
      out.steer = -out.steer;
      out.throttle = 0.8;
      out.brake = 0;
      if (this.reverseTimer <= 0) this.stuckTimer = -1.5;
    } else {
      if (v < 1.2 && out.throttle > 0.2) this.stuckTimer += dt;
      else this.stuckTimer = Math.min(0, this.stuckTimer + dt);
      if (this.stuckTimer > 1.2) this.reverseTimer = 1.7;
    }
    if (directive?.halt) {
      out.throttle = 0;
      out.brake = 1;
      out.reverse = false;
    }
    return out;
  }

  /** True when no third car occupies the lane at offset d next to the blocker. */
  private laneFree(me: CarView, others: readonly CarView[], blocker: CarView, d: number): boolean {
    const L = this.track.length;
    for (const o of others) {
      if (o === me || o === blocker) continue;
      let gap = o.loc.s - me.loc.s;
      if (gap > L / 2) gap -= L;
      else if (gap < -L / 2) gap += L;
      if (gap > -6 && gap < 28 && Math.abs(o.loc.d - d) < (me.spec.width + o.spec.width) / 2 + 0.3) {
        return false;
      }
    }
    return true;
  }
}
