import { deriveSeed, Rng } from "./rng.js";

const WORLD_SEED_TAG = 0x776f726c;

/** Stable address of one world inside a Monte Carlo run. */
export function monteCarloWorldSeed(seed: number, index: number): number {
  if (!Number.isSafeInteger(seed)) throw new Error("seed must be a safe integer");
  if (!Number.isInteger(index) || index < 0) throw new Error("world index must be a non-negative integer");
  return deriveSeed(seed, WORLD_SEED_TAG, index);
}

export function simulateMonteCarloWorld<T>(
  seed: number,
  index: number,
  simulate: (rng: Rng, worldSeed: number, index: number) => T,
): T {
  const worldSeed = monteCarloWorldSeed(seed, index);
  return simulate(new Rng(worldSeed), worldSeed, index);
}

/** Game-agnostic deterministic Monte Carlo runner. */
export function runMonteCarlo<T>(
  trials: number,
  seed: number,
  simulate: (rng: Rng, worldSeed: number, index: number) => T,
): T[] {
  if (!Number.isInteger(trials) || trials < 1) throw new Error("trials must be a positive integer");
  return Array.from({ length: trials }, (_, index) => simulateMonteCarloWorld(seed, index, simulate));
}

export const mean = (values: readonly number[]): number => {
  if (values.length === 0) throw new Error("cannot summarize an empty sample");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export const standardDeviation = (values: readonly number[]): number => {
  const average = mean(values);
  return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
};

export function correlation(xs: readonly number[], ys: readonly number[]): number {
  if (xs.length === 0 || xs.length !== ys.length) throw new Error("correlation samples must have the same non-zero length");
  const mx = mean(xs);
  const my = mean(ys);
  const numerator = xs.reduce((sum, x, i) => sum + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, x) => sum + (x - mx) ** 2, 0)
    * ys.reduce((sum, y) => sum + (y - my) ** 2, 0),
  );
  return denominator === 0 ? 0 : numerator / denominator;
}

export interface WeightedWorlds<T> {
  worlds: readonly T[];
  weights: readonly number[];
  effectiveSampleSize: number;
  /** Mean unnormalised likelihood; useful as a coarse model-fit diagnostic. */
  fit: number;
}

/** Reweight existing worlds with a caller-defined likelihood. */
export function conditionWorlds<T, O>(
  worlds: readonly T[],
  observations: readonly O[],
  likelihood: (world: T, observation: O) => number,
): WeightedWorlds<T> {
  if (worlds.length === 0) throw new Error("no worlds to condition on");
  const raw = worlds.map((world) => observations.reduce((weight, observation) => {
    const next = likelihood(world, observation);
    if (!Number.isFinite(next) || next < 0) throw new Error("likelihood must be a non-negative finite number");
    return weight * next;
  }, 1));
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  if (!(total > 0)) throw new Error("observations reject every simulated world");
  const weights = raw.map((weight) => weight / total);
  return {
    worlds,
    weights,
    effectiveSampleSize: 1 / weights.reduce((sum, weight) => sum + weight * weight, 0),
    fit: total / worlds.length,
  };
}

export function weightedMean(values: readonly number[], weights: readonly number[]): number {
  if (values.length === 0 || values.length !== weights.length) throw new Error("values and weights must have the same non-zero length");
  return values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0);
}

export function weightedStandardDeviation(values: readonly number[], weights: readonly number[]): number {
  const average = weightedMean(values, weights);
  return Math.sqrt(values.reduce((sum, value, index) => sum + (weights[index] ?? 0) * (value - average) ** 2, 0));
}
