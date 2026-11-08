/**
 * A small seeded random source (mulberry32). The same seed always gives the same sequence, so the
 * same `--seed` builds the same business and the same manifest. Never use Math.random in the seed.
 */
export class Rng {
  private state: number;
  private readonly origin: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed) || seed < 0)
      throw new Error('The seed must be a whole number.');
    this.origin = seed >>> 0 || 0x9e3779b9;
    this.state = this.origin;
  }

  /** A float in [0, 1). */
  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** A whole number from min to max, both included. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(items: readonly T[]): T {
    if (!items.length) throw new Error('Cannot pick from an empty list.');
    return items[Math.floor(this.next() * items.length)]!;
  }

  /** Picks by weight; weights need not add up to 1. */
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((sum, [, w]) => sum + w, 0);
    let roll = this.next() * total;
    for (const [item, w] of items) {
      roll -= w;
      if (roll < 0) return item;
    }
    return items[items.length - 1]![0];
  }

  /** Roughly normal, by summing uniforms; good enough for drift and noise. */
  normal(mean = 0, sd = 1): number {
    let sum = 0;
    for (let i = 0; i < 6; i++) sum += this.next();
    return mean + (sum - 3) * sd * Math.SQRT2;
  }

  /**
   * An independent stream for one module, so adding rows in one module never shifts another. It
   * depends only on the original seed and the label, never on how much this stream was used.
   */
  fork(label: string): Rng {
    let h = this.origin ^ 0x811c9dc5;
    for (let i = 0; i < label.length; i++) h = Math.imul(h ^ label.charCodeAt(i), 0x01000193);
    return new Rng(h >>> 0);
  }
}
