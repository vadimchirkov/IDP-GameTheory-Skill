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
  // Phase 0: extend with optional stateHash/nHash for eco/transitions without shifting legacy seed=42.
  // If the last two parts are both 0, they are dropped — legacy 4-part path stays bit-identical (verify-pack 2.1).
  let effective: readonly number[] = parts;
  if (effective.length >= 6 && effective[effective.length - 1] === 0 && effective[effective.length - 2] === 0) {
    effective = effective.slice(0, -2);
  } else if (effective.length === 6 && effective[4] === 0 && effective[5] === 0) {
    effective = effective.slice(0, 4);
  }
  // Also handle the generic 2-zero suffix case (future eco nHash/stateHash == 0 → no extra entropy)
  if (effective.length > 4 && effective[effective.length - 1] === 0 && effective[effective.length - 2] === 0) {
    // only strip if stripping keeps at least the original 4 match coords (g,i,j,rep)
    const stripped = effective.slice(0, -2);
    if (stripped.length >= 4) effective = stripped;
  }
  let hash = (root >>> 0) || 0x811c9dc5;
  for (const part of effective) {
    hash ^= part >>> 0;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}
