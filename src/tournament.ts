import { strategyIds, type PayoffRanges, type ScenarioModel, type StrategyId } from "./domain.js";
import { samplePayoff } from "./analysis.js";
import { playMatch, strategies } from "./kernel.js";
import { Rng } from "./rng.js";

const REPS = 5;

/**
 * Round-robin ranking of the dispositions this model actually names, played under the
 * model's own game, payoffs and noise — a ranking under a different payoff table would
 * not transfer to the scenario it is meant to advise on.
 */
export function runTournament(model: ScenarioModel, rounds = 200, seed = 42) {
  const rng = new Rng(seed);
  const shared = model.payoffs as Partial<PayoffRanges>;
  const ranges = shared.T !== undefined
    ? (model.payoffs as PayoffRanges)
    : Object.values(model.payoffs as Record<string, PayoffRanges>)[0];
  if (!ranges) throw new Error("Model has no payoff ranges");
  const payoff = samplePayoff(ranges, model.game ?? "prisoners_dilemma", rng);
  const noise = rng.between(model.structure.noise);
  const sigma = model.structure.sigma ? rng.between(model.structure.sigma) : undefined;

  const named = [...new Set(model.players.flatMap((p) => p.dispositions))] as StrategyId[];
  const pool = named.length ? named : [...strategyIds];
  if (pool.includes("loner") && sigma === undefined) throw new Error("loner is in the pool but structure.sigma is not set");
  const scores: Record<string, number> = Object.fromEntries(pool.map((id) => [id, 0]));
  const coop: Record<string, number> = Object.fromEntries(pool.map((id) => [id, 0]));
  for (let i = 0; i < pool.length; i += 1) {
    for (let j = i; j < pool.length; j += 1) {
      const a = pool[i]!; const b = pool[j]!;
      if (a === "loner" || b === "loner") {
        const optOut = sigma! * rounds; // both opt out to σ each round, no C/D game
        if (a === b) scores[a]! += optOut;
        else { scores[a]! += optOut; scores[b]! += optOut; }
        continue;
      }
      let sumA = 0; let sumB = 0; let sumC = 0;
      for (let rep = 0; rep < REPS; rep += 1) {
        const r = playMatch(strategies[a], strategies[b], payoff, payoff, rounds, noise, new Rng(rep * 100 + i * 10 + j));
        sumA += r.scoreA; sumB += r.scoreB; sumC += r.cooperation;
      }
      if (a === b) { scores[a]! += (sumA + sumB) / 2 / REPS; coop[a]! += sumC / REPS; }
      else { scores[a]! += sumA / REPS; scores[b]! += sumB / REPS; coop[a]! += sumC / REPS; coop[b]! += sumC / REPS; }
    }
  }
  const ranking = Object.entries(scores)
    .sort(([, a], [, b]) => b - a)
    .map(([id, score]) => ({ id, score, coop: (coop[id] ?? 0) / pool.length }));
  return { ranking, pool, rounds, payoff, noise };
}
