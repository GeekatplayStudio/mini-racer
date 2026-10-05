import { Race, RaceEvent, SIM_DT } from '../src/sim/race';
import { Snapshot, encodeSnapshot } from '../src/sim/snapshot';

/** Milliseconds between simulation ticks. Every second tick sends a snapshot: 20 a second. */
const TICK_MS = 25;
const SNAPSHOT_EVERY = 2;
/** Every so many snapshots carries the slow-changing values too. */
const FULL_EVERY = 5;
/** Longest stretch of simulation one tick may catch up on, s. */
const MAX_CATCH_UP = 0.25;
/** Wall-clock time one tick may spend stepping, ms; the rest of the server must stay responsive. */
const TICK_BUDGET_MS = 15;
/** A race still going after this long is stopped, ms. */
const MAX_RACE_MS = 3 * 3600e3;

/** Events that say nothing the slow values need to follow. */
const MINOR = new Set<RaceEvent['type']>(['contact', 'wall', 'overtake', 'lights']);

export interface RaceRunHooks {
  snapshot(snap: Snapshot): void;
  /** The flag has fallen for everyone; called once, before the snapshot that says so. */
  finished(): void;
  /** The run is over and will send nothing more. `failed` when it had to be stopped. */
  closed(failed: boolean): void;
}

/** Steps one race in real time and reports its state at a steady rate. */
export class RaceRun {
  /** The next snapshot must be a full one, e.g. because someone just (re)joined. */
  needFull = true;
  private timer: ReturnType<typeof setInterval> | null = null;
  private last = 0;
  private started = 0;
  private accumulator = 0;
  private ticks = 0;
  private snapshots = 0;
  private pending: RaceEvent[] = [];
  private finishedAt = 0;

  /**
   * @param simSpeed simulated seconds per real second; 1 in play, more only in tests.
   * @param cooldownMs how long the cars roll on after the finish before the run closes.
   */
  constructor(readonly race: Race, private readonly hooks: RaceRunHooks, private readonly simSpeed = 1, private readonly cooldownMs = 20000) {}

  start(): void {
    this.last = this.started = performance.now();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  private tick(): void {
    try {
      this.advance();
    } catch (err) {
      console.error('Race stopped by an error:', err);
      this.stop();
      this.hooks.closed(true);
    }
  }

  private advance(): void {
    const race = this.race;
    const now = performance.now();
    this.accumulator += Math.min(MAX_CATCH_UP, (now - this.last) / 1000) * this.simSpeed;
    this.last = now;

    let steps = 0;
    let flagged = false;
    while (this.accumulator >= SIM_DT) {
      race.step();
      this.accumulator -= SIM_DT;
      if (race.events.length) {
        this.pending.push(...race.events);
        race.events.length = 0;
      }
      if (race.phase === 'finished' && !this.finishedAt) {
        this.finishedAt = now;
        flagged = true;
        break;
      }
      // Fallen behind: drop the backlog rather than run faster than real time later.
      if ((++steps & 15) === 0 && performance.now() - now > TICK_BUDGET_MS) {
        this.accumulator = 0;
        break;
      }
    }

    if (flagged) this.hooks.finished();
    if (flagged || this.ticks++ % SNAPSHOT_EVERY === 0) {
      const full = flagged || this.needFull || this.snapshots % FULL_EVERY === 0 || this.pending.some((e) => !MINOR.has(e.type));
      this.needFull = false;
      this.snapshots++;
      this.hooks.snapshot(encodeSnapshot(race, full, this.pending));
      this.pending = [];
    }

    if (this.finishedAt && now - this.finishedAt > this.cooldownMs) {
      this.stop();
      this.hooks.closed(false);
    } else if (!this.finishedAt && now - this.started > MAX_RACE_MS) {
      this.stop();
      this.hooks.closed(true);
    }
  }
}
