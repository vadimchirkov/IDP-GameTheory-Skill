import {
  score, strategyIds, type Move, type Payoff, type PayoffRanges, type ScenarioModel, type StrategyId,
} from "../domain.js";
import { playMatch, strategies } from "../kernel.js";
import { deriveSeed, Rng } from "../rng.js";
import { samplePayoff } from "./repeated-game.js";

export type StrategyShares = Record<StrategyId, number>;
export type EvolutionRule = "replicator" | "moran";

export interface EvolutionGeneration {
  shares: StrategyShares;
  meanScores: StrategyShares;
  cooperationRate: number;
}

export interface EvolutionConfig {
  game: NonNullable<ScenarioModel["game"]>;
  payoff: Payoff;
  rounds: number;
  matchReps: number;
  noise: number;
  initialShares: StrategyShares;
  generations: number;
  rule: EvolutionRule;
  populationSize: number;
  stepDelayMs: number;
  sigma?: number;
  punishment?: { beta: number; gamma: number; pool: boolean };
}

function modelRanges(model: ScenarioModel): PayoffRanges {
  const shared = model.payoffs as Partial<PayoffRanges>;
  const ranges = shared.T !== undefined
    ? model.payoffs as PayoffRanges
    : Object.values(model.payoffs as Record<string, PayoffRanges>)[0];
  if (!ranges) throw new Error("Model has no payoff ranges");
  return ranges;
}

function activeStrategies(model: ScenarioModel): StrategyId[] {
  const ids = [...new Set(model.players.flatMap((player) => player.dispositions))];
  return ids.length ? ids : [...strategyIds];
}

function normalizeShares(input: Partial<StrategyShares>): StrategyShares {
  const total = Object.values(input).reduce((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("shares must have a positive total");
  return Object.fromEntries(strategyIds.map((id) => [id, (input[id] ?? 0) / total])) as StrategyShares;
}

function sampledMechanisms(model: ScenarioModel, rng: Rng) {
  return {
    sigma: model.structure.sigma ? rng.between(model.structure.sigma) : undefined,
    punishment: model.structure.punishment ? {
      beta: rng.between(model.structure.punishment.beta),
      gamma: rng.between(model.structure.punishment.gamma),
      pool: !!model.structure.punishment.pool,
    } : undefined,
  };
}

/** Rank the dispositions named by a scenario under that scenario's own incentives. */
export function runTournament(model: ScenarioModel, rounds = 200, seed = 42) {
  if (!Number.isInteger(rounds) || rounds < 1) throw new Error("rounds must be a positive integer");
  const rng = new Rng(seed);
  const payoff = samplePayoff(modelRanges(model), model.game ?? "prisoners_dilemma", rng);
  const noise = rng.between(model.structure.noise);
  const { sigma, punishment: punish } = sampledMechanisms(model, rng);
  const pool = activeStrategies(model);
  if (pool.includes("loner") && sigma === undefined) throw new Error("loner is in the pool but structure.sigma is not set");
  if (pool.includes("punisher") && punish === undefined) throw new Error("punisher is in the pool but structure.punishment is not set");

  const scores: Record<string, number> = Object.fromEntries(pool.map((id) => [id, 0]));
  const cooperation: Record<string, number> = Object.fromEntries(pool.map((id) => [id, 0]));
  const reps = 5;
  for (let i = 0; i < pool.length; i += 1) for (let j = i; j < pool.length; j += 1) {
    const a = pool[i]!; const b = pool[j]!;
    if (a === "loner" || b === "loner") {
      const optOut = sigma! * rounds;
      if (a === b) scores[a]! += optOut;
      else { scores[a]! += optOut; scores[b]! += optOut; }
      continue;
    }
    const punishment = punish && (a === "punisher" || b === "punisher") ? {
      ...punish, aPunishes: a === "punisher", bPunishes: b === "punisher",
    } : undefined;
    let sumA = 0; let sumB = 0; let sumC = 0;
    for (let rep = 0; rep < reps; rep += 1) {
      const result = playMatch(strategies[a], strategies[b], payoff, payoff, rounds, noise, new Rng(deriveSeed(seed, i, j, rep)), { punishment });
      sumA += result.scoreA; sumB += result.scoreB; sumC += result.cooperation;
    }
    if (a === b) { scores[a]! += (sumA + sumB) / (2 * reps); cooperation[a]! += sumC / reps; }
    else { scores[a]! += sumA / reps; scores[b]! += sumB / reps; cooperation[a]! += sumC / reps; cooperation[b]! += sumC / reps; }
  }
  const ranking = Object.entries(scores).sort(([, a], [, b]) => b - a)
    .map(([id, value]) => ({ id: id as StrategyId, score: value, coop: (cooperation[id] ?? 0) / pool.length }));
  return { ranking, pool, rounds, payoff, noise };
}

function generation(config: EvolutionConfig, shares: StrategyShares, index: number, seed: number): EvolutionGeneration {
  const active = strategyIds.filter((id) => shares[id] > 0);
  if (active.includes("loner") && config.sigma === undefined) throw new Error("loner has a share but sigma is not set");
  if (active.includes("punisher") && config.punishment === undefined) throw new Error("punisher has a share but punishment is not set");
  const fitness = Object.fromEntries(strategyIds.map((id) => [id, 0])) as StrategyShares;
  let cooperation = 0; let cooperativeMatches = 0;
  for (let i = 0; i < active.length; i += 1) for (let j = i; j < active.length; j += 1) {
    const a = active[i]!; const b = active[j]!;
    for (let rep = 0; rep < config.matchReps; rep += 1) {
      if (a === "loner" || b === "loner") {
        const value = config.sigma! * config.rounds;
        if (a === b) fitness[a] += value; else { fitness[a] += value; fitness[b] += value; }
        continue;
      }
      const p = config.punishment;
      const punishment = p && (a === "punisher" || b === "punisher") ? { ...p, aPunishes: a === "punisher", bPunishes: b === "punisher" } : undefined;
      const result = playMatch(strategies[a], strategies[b], config.payoff, config.payoff, config.rounds, config.noise, new Rng(deriveSeed(seed, index, i, j, rep)), { punishment });
      if (a === b) fitness[a] += (result.scoreA + result.scoreB) / 2;
      else { fitness[a] += result.scoreA; fitness[b] += result.scoreB; }
      cooperation += result.cooperation; cooperativeMatches += 1;
    }
  }
  const divisor = Math.max(1, active.length * config.matchReps);
  for (const id of strategyIds) fitness[id] /= divisor;
  const meanFitness = strategyIds.reduce((sum, id) => sum + shares[id] * fitness[id], 0);
  let next: StrategyShares;
  if (config.rule === "replicator") {
    const scale = Math.max(1, ...strategyIds.map((id) => Math.abs(fitness[id] - meanFitness)));
    next = normalizeShares(Object.fromEntries(strategyIds.map((id) => [id, shares[id] * (1 + 0.5 * (fitness[id] - meanFitness) / scale)])));
  } else {
    const minimum = Math.min(...active.map((id) => fitness[id]));
    const parentWeights = normalizeShares(Object.fromEntries(active.map((id) => [id, shares[id] * (fitness[id] - minimum + 1e-9)])));
    const pick = (weights: StrategyShares, rng: Rng) => {
      let cursor = rng.unit();
      for (const id of strategyIds) { cursor -= weights[id]; if (cursor <= 0) return id; }
      return active.at(-1)!;
    };
    const rng = new Rng(deriveSeed(seed, index, 0xfeed));
    const parent = pick(parentWeights, rng); const victim = pick(shares, rng);
    next = parent === victim ? shares : normalizeShares({ ...shares, [parent]: shares[parent] + 1 / config.populationSize, [victim]: Math.max(0, shares[victim] - 1 / config.populationSize) });
  }
  return { shares: next, meanScores: fitness, cooperationRate: cooperation / Math.max(1, cooperativeMatches) };
}

/** Follow how the scenario's named dispositions spread under repeated selection. */
export function runEvolution(model: ScenarioModel, generations = 500, seed = 42, rule: EvolutionRule = "replicator") {
  if (!Number.isInteger(generations) || generations < 1) throw new Error("generations must be a positive integer");
  const rng = new Rng(seed);
  const ids = activeStrategies(model);
  const mechanisms = sampledMechanisms(model, rng);
  const initialShares = normalizeShares(Object.fromEntries(ids.map((id) => [id, 1 / ids.length])));
  const config: EvolutionConfig = {
    game: model.game ?? "prisoners_dilemma",
    payoff: samplePayoff(modelRanges(model), model.game ?? "prisoners_dilemma", rng),
    rounds: 50, matchReps: 5, noise: rng.between(model.structure.noise), initialShares,
    generations, rule, populationSize: 100, stepDelayMs: 0,
    ...(mechanisms.sigma !== undefined ? { sigma: mechanisms.sigma } : {}),
    ...(mechanisms.punishment ? { punishment: mechanisms.punishment } : {}),
  };
  const trajectory: EvolutionGeneration[] = [];
  let shares = initialShares;
  for (let index = 0; index < generations; index += 1) {
    const result = generation(config, shares, index, seed);
    trajectory.push(result); shares = result.shares;
  }
  return { trajectory, fixation: Object.fromEntries(ids.map((id) => [id, shares[id]])), config };
}

export type SpatialGrid = Move[][];
export type SpatialUpdateRule = "imitate-best" | "fermi";

// Adapter-local compatibility names used by the former standalone C/D modules.
export type Shares = StrategyShares;
export type Generation = EvolutionGeneration;
export type RunConfig = EvolutionConfig;
export type Grid = SpatialGrid;
export type UpdateRule = SpatialUpdateRule;

export function createSpatialGrid(size: number, fill: Move | ((row: number, column: number) => Move)): SpatialGrid {
  if (!Number.isInteger(size) || size < 1) throw new Error("size must be a positive integer");
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => typeof fill === "function" ? fill(row, column) : fill));
}

function neighbours(row: number, column: number, size: number): [number, number][] {
  return [[row - 1, column], [row + 1, column], [row, column - 1], [row, column + 1]]
    .map(([r, c]) => [((r! + size) % size), ((c! + size) % size)]);
}

function spatialScore(grid: SpatialGrid, row: number, column: number, payoff: Payoff): number {
  const mine = grid[row]?.[column] ?? "C";
  return neighbours(row, column, grid.length).reduce((sum, [r, c]) => sum + score(payoff, mine, grid[r]?.[c] ?? "C"), 0);
}

export function stepSpatial(grid: SpatialGrid, payoff: Payoff, rule: SpatialUpdateRule, rng: Rng, temperature = 0.1): SpatialGrid {
  const size = grid.length;
  if (!size || grid.some((row) => row.length !== size)) throw new Error("grid must be a non-empty square");
  if (!(temperature > 0)) throw new Error("temperature must be positive");
  const scores = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => spatialScore(grid, row, column, payoff)));
  const next = grid.map((row) => [...row]);
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
    const nearby = neighbours(row, column, size);
    if (rule === "imitate-best") {
      const [bestRow, bestColumn] = [...nearby, [row, column] as [number, number]].reduce((best, candidate) =>
        scores[candidate[0]]![candidate[1]]! > scores[best[0]]![best[1]]! ? candidate : best);
      next[row]![column] = grid[bestRow]![bestColumn]!;
    } else {
      const [otherRow, otherColumn] = rng.pick(nearby);
      const probability = 1 / (1 + Math.exp((scores[row]![column]! - scores[otherRow]![otherColumn]!) / temperature));
      if (rng.unit() < probability) next[row]![column] = grid[otherRow]![otherColumn]!;
    }
  }
  return next;
}

export function spatialCooperation(grid: SpatialGrid): number {
  const cells = grid.flat();
  if (!cells.length) throw new Error("grid must not be empty");
  return cells.filter((move) => move === "C").length / cells.length;
}

export function cooperationClusters(grid: SpatialGrid): number {
  const size = grid.length;
  if (!size || grid.some((row) => row.length !== size)) throw new Error("grid must be a non-empty square");
  const visited = Array.from({ length: size }, () => Array(size).fill(false));
  let clusters = 0;
  for (let row = 0; row < size; row += 1) for (let column = 0; column < size; column += 1) {
    if (visited[row]![column] || grid[row]![column] !== "C") continue;
    clusters += 1; visited[row]![column] = true;
    const queue: [number, number][] = [[row, column]];
    for (let i = 0; i < queue.length; i += 1) for (const [r, c] of neighbours(queue[i]![0], queue[i]![1], size)) {
      if (!visited[r]![c] && grid[r]![c] === "C") { visited[r]![c] = true; queue.push([r, c]); }
    }
  }
  return clusters;
}

export const createGrid = createSpatialGrid;
export const coopRate = spatialCooperation;
export const clusterCount = cooperationClusters;
