/**
 * Seeded pseudo-random generator (mulberry32). Every random decision in the
 * simulation goes through one of these so a race replays exactly from its seed.
 */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }

  int(lo: number, hiInclusive: number): number {
    return lo + Math.floor(this.next() * (hiInclusive - lo + 1));
  }

  /** Approximately standard normal (sum of uniforms), bounded to about +-3. */
  normal(): number {
    return (this.next() + this.next() + this.next() + this.next() - 2) * 1.7320508;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  /** Derives an independent stream, so adding a consumer does not shift others. */
  fork(salt: number): Rng {
    return new Rng((Math.imul(this.state ^ salt, 0x9e3779b1) + salt) >>> 0);
  }
}
