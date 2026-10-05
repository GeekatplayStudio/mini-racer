import { wrapAngle } from '../sim/math';
import type { Race } from '../sim/race';
import { Snapshot, applySnapshot } from '../sim/snapshot';

/** Furthest a car is carried forward past the last word from the server, s. */
const MAX_AHEAD = 0.3;
/** How quickly a shown car closes on where the server says it should be, per second. */
const CORRECTION = 10;
/** Further off than this, m, the car is simply put in its place: a pit-lane reset, a reconnect. */
const SNAP_DISTANCE = 12;

interface Pose {
  x: number;
  y: number;
  heading: number;
}

interface Base extends Pose {
  /** Velocity in world axes, m/s. */
  wx: number;
  wy: number;
  yawRate: number;
}

/**
 * Keeps a local Race in step with the one a server runs. Snapshots arrive
 * about twenty times a second; between them each car is moved on along its
 * last known velocity and eased toward the newest report, so the picture is
 * smooth at any frame rate. The race is never stepped here.
 */
export class RaceMirror {
  private readonly shown: Pose[];
  private readonly base: Base[];
  private baseClock = 0;
  private baseTime = 0;
  /** Seconds on the local clock, advanced by the frame loop. */
  private local = 0;
  /** Local clock minus race clock, smoothed over the jitter of arrival times. */
  private offset: number | null = null;
  /** Snapshots applied so far. */
  count = 0;

  constructor(readonly race: Race) {
    this.shown = race.cars.map((c) => ({ x: c.state.x, y: c.state.y, heading: c.state.heading }));
    this.base = race.cars.map((c) => ({ x: c.state.x, y: c.state.y, heading: c.state.heading, wx: 0, wy: 0, yawRate: 0 }));
  }

  /** Takes a snapshot from the server. */
  apply(snap: Snapshot): void {
    const race = this.race;
    applySnapshot(race, snap);
    this.count++;
    this.baseClock = race.clock;
    this.baseTime = race.time;
    const sample = this.local - race.clock;
    if (this.offset === null || Math.abs(sample - this.offset) > 0.5) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.1;

    for (let i = 0; i < race.cars.length; i++) {
      const st = race.cars[i].state;
      const b = this.base[i];
      const cos = Math.cos(st.heading), sin = Math.sin(st.heading);
      b.x = st.x;
      b.y = st.y;
      b.heading = st.heading;
      b.wx = st.vx * cos - st.vy * sin;
      b.wy = st.vx * sin + st.vy * cos;
      b.yawRate = st.yawRate;
      // Until the next frame the car is drawn where it was.
      this.write(i);
    }
  }

  private write(i: number): void {
    const st = this.race.cars[i].state;
    const p = this.shown[i];
    st.x = p.x;
    st.y = p.y;
    st.heading = p.heading;
  }

  /** Moves the picture on by one frame. */
  advance(dt: number): void {
    const race = this.race;
    this.local += dt;
    if (this.offset === null) return;
    const raw = this.local - this.offset - this.baseClock;
    const ahead = Math.min(MAX_AHEAD, Math.max(0, raw));
    // Out of news: hold the cars rather than guess any further.
    const stalled = raw > MAX_AHEAD;
    const k = 1 - Math.exp(-dt * CORRECTION);

    for (let i = 0; i < race.cars.length; i++) {
      const b = this.base[i];
      const p = this.shown[i];
      const tx = b.x + b.wx * ahead;
      const ty = b.y + b.wy * ahead;
      const th = b.heading + b.yawRate * ahead;
      if (Math.hypot(tx - p.x, ty - p.y) > SNAP_DISTANCE) {
        p.x = tx;
        p.y = ty;
        p.heading = th;
      } else {
        if (!stalled) {
          p.x += b.wx * dt;
          p.y += b.wy * dt;
          p.heading += b.yawRate * dt;
        }
        p.x += (tx - p.x) * k;
        p.y += (ty - p.y) * k;
        p.heading += wrapAngle(th - p.heading) * k;
      }
      this.write(i);
    }

    // Animals keep wandering between reports.
    const track = race.track;
    for (const h of race.hazards) {
      if (!h.drift || stalled) continue;
      h.d += h.drift * dt;
      if (Math.abs(h.d) > track.halfWidth + 3) h.drift = -h.drift;
      [h.x, h.y] = track.pointAt(h.s, h.d);
    }

    if (race.phase !== 'finished') {
      race.clock = this.baseClock + ahead;
      if (race.phase === 'racing') race.time = this.baseTime + ahead;
    }
  }
}
