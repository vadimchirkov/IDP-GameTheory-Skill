/** Small explicit PRNG: deterministic across all kernel calls, never Math.random(). */
export class Rng {
  private state: number;
  private readonly rootSeed: number;

  constructor(seed: number) {
    this.rootSeed = (seed >>> 0) || 0x9e3779b9;
    this.state = this.rootSeed;
  }

  nextUint32(): number {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  unit(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }

  between([low, high]: readonly [number, number]): number {
    return low + (high - low) * this.unit();
  }

  pick<T>(values: readonly T[]): T {
    const value = values[Math.floor(this.unit() * values.length)];
    if (value === undefined) throw new Error("Cannot pick from an empty array");
    return value;
  }

  /** Stable child stream that does not depend on how much the parent already consumed. */
  fork(...parts: readonly SeedPart[]): Rng {
    return new Rng(deriveSeed(this.rootSeed, ...parts));
  }
}

/** A stream address: a raw number, or a string id hashed into one. */
export type SeedPart = number | string;

/** FNV-1a over a string id, so callers address streams by identity instead of array position. */
export function hash(value: string): number {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return result;
}

export function deriveSeed(root: number, ...parts: readonly SeedPart[]): number {
  let mixed = (root >>> 0) || 0x811c9dc5;
  for (const part of parts) {
    mixed ^= (typeof part === "string" ? hash(part) : part) >>> 0;
    mixed = Math.imul(mixed, 0x01000193) >>> 0;
  }
  return mixed;
}
