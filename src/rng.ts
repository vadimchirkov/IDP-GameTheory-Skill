/** Small explicit PRNG: deterministic across all kernel calls, never Math.random(). */
export class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
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
}

export function deriveSeed(root: number, ...parts: readonly number[]): number {
  let hash = (root >>> 0) || 0x811c9dc5;
  for (const part of parts) {
    hash ^= part >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
