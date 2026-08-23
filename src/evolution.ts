import { normalizeShares, type Payoff, type PayoffRanges, type RunConfig, type ScenarioModel, type StrategyId } from "./domain.js";
import { samplePayoff } from "./analysis.js";
import { stepGeneration, type Generation } from "./kernel.js";
import { Rng } from "./rng.js";

/** Mid-range point of the model's own payoff ranges, so evolution plays the scenario's game. */
function representativePayoff(model: ScenarioModel, rng: Rng): Payoff {
  const shared = model.payoffs as Partial<PayoffRanges>;
  const ranges = shared.T !== undefined
    ? (model.payoffs as PayoffRanges)
    : Object.values(model.payoffs as Record<string, PayoffRanges>)[0];
  if (!ranges) throw new Error("Model has no payoff ranges");
  return samplePayoff(ranges, model.game ?? "prisoners_dilemma", rng);
}

export function runEvolution(model: ScenarioModel, generations = 500, seed = 42): { trajectory: Generation[]; fixation: Record<string, number>; config: RunConfig } {
  const rng = new Rng(seed);
  const ids = [...new Set(model.players.flatMap((p) => p.dispositions))] as StrategyId[];
  const initialShares = normalizeShares(Object.fromEntries(ids.map((id) => [id, 1 / ids.length])));
  const config: RunConfig = {
    game: model.game ?? "prisoners_dilemma",
    payoff: representativePayoff(model, rng),
    rounds: 50,
    matchReps: 5,
    noise: rng.between(model.structure.noise),
    initialShares,
    generations,
    rule: "replicator",
    populationSize: 100,
    stepDelayMs: 0,
    ...(model.structure.sigma ? { sigma: rng.between(model.structure.sigma) } : {}),
    ...(model.structure.punishment ? { punishment: { beta: rng.between(model.structure.punishment.beta), gamma: rng.between(model.structure.punishment.gamma), pool: !!model.structure.punishment.pool } } : {}),
  };
  let shares = initialShares;
  const trajectory: Generation[] = [];
  for (let g = 0; g < generations; g += 1) {
    const gen = stepGeneration(config, shares, g, seed + g);
    trajectory.push(gen);
    shares = gen.shares;
  }
  return { trajectory, fixation: Object.fromEntries(ids.map((id) => [id, shares[id]])), config };
}
