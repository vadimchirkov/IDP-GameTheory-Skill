/**
 * Likelihood-free conditioning (approximate Bayesian computation) over an existing river.
 *
 * `analyzeScenario` already draws hundreds of worlds and records each world's outcome and the
 * inputs that produced it (`result.trials`). This module adds the missing inference step: given
 * whatever actually happened, it *reweights* those worlds by how well each reproduces the
 * observation, turning equal-weight "possible worlds" into posterior-weighted ones. No new
 * simulation — the forward model is the likelihood.
 *
 * Weighting is soft (a Gaussian kernel on cooperation, a penalty — not zero — on a winner miss)
 * so an observation can never empty the posterior; the Kish effective sample size reports how much
 * the data actually narrowed things. The posterior over each player's disposition falls out for
 * free from `digest.strategies`, which already records the strategy each world dealt each player.
 */
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import type { ScenarioResult, Trial } from "./adapters/repeated-game.js";
import { conditionWorlds, weightedMean, weightedStandardDeviation } from "./monte-carlo.js";

export interface Observation {
  /** Observed overall cooperation level (0..1), matched softly against each world's cooperation. */
  cooperation?: number;
  /** Observed side that came out ahead — a player name, or a team name when the model uses teams. */
  winner?: string;
  /** How the pivotal pair opened, e.g. `mutual-coop`, `mutual-conflict`, `defects:Name`, `exit`. */
  opening?: string;
  /** Reaction to the first breach: `repair`, `retaliation`, `exploitation`, `escalation`, `trust-holds`, `exit`. */
  response?: string;
  /** Qualitative outcome: `cooperation`, `oscillation`, `fragile`, `conflict`, `exit`. */
  regime?: string;
  /** Observed cooperation rate (0..1) of specific named players — the fingerprint that identifies each player's disposition independently. */
  playerCooperation?: Record<string, number>;
  /** Std of every cooperation kernel (world- and player-level); smaller constrains harder. Default 0.15. */
  coopTolerance?: number;
}

export interface PosteriorResult {
  /** Per-world posterior weights aligned with `result.trials`, normalised to sum to 1. */
  weights: readonly number[];
  /** Kish effective sample size `1/Σwᵢ²`: how many worlds the observation effectively leaves. */
  effectiveSampleSize: number;
  /** Mean raw agreement across worlds (0..1) — how well the observation fits the model at all. */
  fit: number;
  /** Posterior win share per player (percent), reweighted by the observation. */
  winPct: Record<string, number>;
  /** Posterior win share per team (percent). */
  winPctTeam: Record<string, number>;
  /** Posterior cooperation (weighted mean ± std). */
  cooperation: { mean: number; std: number };
  /** Posterior over each player's disposition, from the surviving worlds (each row sums to ~1). */
  strategyPosterior: Record<string, Record<string, number>>;
}

/** A categorical miss is discouraged, not forbidden — keeps the posterior non-empty on a surprising outcome. */
const CATEGORICAL_MISS_PENALTY = 0.05;

/** How strongly one world agrees with one observation (1 = perfect, →0 = contradicted). */
function agreement(t: Trial, obs: Observation): number {
  const tol = obs.coopTolerance ?? 0.15;
  if (!(tol > 0)) throw new Error("coopTolerance must be positive");
  let w = 1;
  if (obs.cooperation !== undefined) {
    const d = (t.cooperation - obs.cooperation) / tol;
    w *= Math.exp(-0.5 * d * d);
  }
  if (obs.winner !== undefined) {
    const won = t.winners.includes(obs.winner) || t.teamWinners.includes(obs.winner);
    w *= won ? 1 : CATEGORICAL_MISS_PENALTY;
  }
  if (obs.opening !== undefined) w *= t.digest.opening === obs.opening ? 1 : CATEGORICAL_MISS_PENALTY;
  if (obs.response !== undefined) w *= t.digest.response === obs.response ? 1 : CATEGORICAL_MISS_PENALTY;
  if (obs.regime !== undefined) w *= t.digest.regime === obs.regime ? 1 : CATEGORICAL_MISS_PENALTY;
  if (obs.playerCooperation) {
    for (const [name, target] of Object.entries(obs.playerCooperation)) {
      const seen = t.playerCoop?.[name];
      if (seen === undefined) continue; // this world never had that player play a C/D match — can't disconfirm
      const d = (seen - target) / tol;
      w *= Math.exp(-0.5 * d * d);
    }
  }
  return w;
}

/**
 * Reweight the run to worlds consistent with the evidence. Pass several observations to accumulate
 * them: each world's weight is the product of its agreement with every observation, so facts combine
 * rather than replace one another. An empty list (or `{}`) leaves the run unchanged.
 */
export function fitPosterior(result: ScenarioResult, obs: Observation | readonly Observation[]): PosteriorResult {
  const trials = result.trials;
  const list = Array.isArray(obs) ? obs : [obs as Observation];
  const conditioned = conditionWorlds(trials, list, agreement);
  const { weights, effectiveSampleSize, fit } = conditioned;

  const winPct: Record<string, number> = Object.fromEntries(Object.keys(result.winPct).map((k) => [k, 0]));
  const winPctTeam: Record<string, number> = Object.fromEntries(Object.keys(result.winPctTeam).map((k) => [k, 0]));
  const strategyPosterior: Record<string, Record<string, number>> = {};
  trials.forEach((t, i) => {
    const w = weights[i]!;
    for (const name of t.winners) winPct[name] = (winPct[name] ?? 0) + w / t.winners.length;
    for (const team of t.teamWinners) winPctTeam[team] = (winPctTeam[team] ?? 0) + w / t.teamWinners.length;
    for (const [player, sid] of Object.entries(t.digest.strategies)) {
      const row = (strategyPosterior[player] ??= {});
      row[sid] = (row[sid] ?? 0) + w;
    }
  });
  const cooperation = trials.map((trial) => trial.cooperation);
  const cMean = weightedMean(cooperation, weights);

  return {
    weights,
    effectiveSampleSize,
    fit,
    winPct: Object.fromEntries(Object.entries(winPct).map(([k, v]) => [k, 100 * v])),
    winPctTeam: Object.fromEntries(Object.entries(winPctTeam).map(([k, v]) => [k, 100 * v])),
    cooperation: { mean: cMean, std: weightedStandardDeviation(cooperation, weights) },
    strategyPosterior,
  };
}

// ── self-check: model-agnostic invariants (run with `tsx src/abc.ts`) ──────────────
async function selfCheck(): Promise<void> {
  const { analyzeScenario } = await import("./adapters/repeated-game.js");

  // Two players whose dispositions make the winner genuinely vary world to world.
  const model = {
    situation: "abc self-check",
    game: "prisoners_dilemma" as const,
    players: [
      { name: "A", dispositions: ["alld", "allc"] as const },
      { name: "B", dispositions: ["allc", "alld"] as const },
    ],
    payoffs: { T: [5, 5], R: [3, 3], P: [1, 1], S: [0, 0] } as const,
    structure: { w: [0.9, 0.95] as const, noise: [0, 0.05] as const },
  };
  const result = analyzeScenario(model as never, 400, 42);

  // 1. Empty observation is the identity: posterior winPct equals the base winPct.
  const none = fitPosterior(result, {});
  for (const name of Object.keys(result.winPct)) {
    assert.ok(Math.abs(none.winPct[name]! - result.winPct[name]!) < 1e-9, `empty obs must not move winPct[${name}]`);
  }
  assert.ok(Math.abs(none.effectiveSampleSize - result.trials.length) < 1e-6, "empty obs → ESS = trials");

  // 1b. A one-element array equals a single observation; an empty array leaves the run unchanged.
  const arrOne = fitPosterior(result, [{ winner: "A" }]);
  assert.ok(Math.abs(arrOne.winPct.A! - fitPosterior(result, { winner: "A" }).winPct.A!) < 1e-9, "a one-element array equals a single observation");
  assert.ok(Math.abs(fitPosterior(result, []).effectiveSampleSize - result.trials.length) < 1e-6, "an empty observation array is the identity");

  // 2. Conditioning on "A won" can only raise A's win share, and must shrink the effective sample.
  const base = result.winPct.A!;
  const condA = fitPosterior(result, { winner: "A" });
  const twice = fitPosterior(result, [{ winner: "A" }, { winner: "A" }]);
  assert.ok(twice.winPct.A! >= condA.winPct.A! - 1e-9 && twice.effectiveSampleSize <= condA.effectiveSampleSize + 1e-9, "accumulating the same fact concentrates belief and never grows the effective sample");
  assert.ok(condA.winPct.A! >= base - 1e-9, "conditioning on A winning must not lower A's share");
  assert.ok(base > 0 && base < 100 ? condA.winPct.A! > base + 1e-6 : true, "with A neither always nor never winning, its share must strictly rise");
  assert.ok(condA.effectiveSampleSize < result.trials.length, "a real observation must reduce ESS");

  // 3. Cooperation conditioning moves the posterior in the observed direction.
  const high = fitPosterior(result, { cooperation: 1, coopTolerance: 0.1 });
  const low = fitPosterior(result, { cooperation: 0, coopTolerance: 0.1 });
  assert.ok(high.cooperation.mean > low.cooperation.mean, "coop=1 must yield higher posterior cooperation than coop=0");

  // 4. The strategy posterior is a distribution per player.
  for (const [player, row] of Object.entries(condA.strategyPosterior)) {
    const sum = Object.values(row).reduce((s, v) => s + v, 0);
    assert.ok(Math.abs(sum - 1) < 1e-6, `strategyPosterior[${player}] must sum to 1, got ${sum}`);
  }

  console.log("abc.ts self-check passed:",
    `base winPct[A]=${base.toFixed(1)} → conditioned=${condA.winPct.A!.toFixed(1)} (ESS ${condA.effectiveSampleSize.toFixed(0)}/${result.trials.length})`);
}

const isMain = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) selfCheck().catch((error) => { console.error(error); process.exit(1); });
