import { correlation, mean, runMonteCarlo, standardDeviation } from "../monte-carlo.js";
import { deriveSeed, Rng } from "../rng.js";
import type { NumberRange } from "../topology.js";

export interface DecisionFactor {
  id: string;
  label: string;
  range: NumberRange;
  lowLabel?: string;
  highLabel?: string;
}

export interface DecisionEffect {
  factorId: string;
  /** Change in the objective when the factor moves from its midpoint to its high end. */
  impact: NumberRange;
}

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
  /** Objective value when every factor is at its midpoint. */
  baseline: NumberRange;
  effects: readonly DecisionEffect[];
}

export interface DecisionModel {
  schemaVersion: 1;
  adapter: "decision";
  situation: string;
  question: string;
  objective: {
    label: string;
    unit?: string;
    direction: "maximize" | "minimize";
    target?: number;
  };
  factors: readonly DecisionFactor[];
  options: readonly DecisionOption[];
  assumptions: readonly string[];
}

export interface DecisionWorld {
  index: number;
  seed: number;
  factors: Record<string, number>;
  normalizedFactors: Record<string, number>;
  results: Record<string, number>;
  regrets: Record<string, number>;
  bestOptionId: string;
  path: readonly string[];
}

export interface DecisionOptionSummary {
  mean: number;
  std: number;
  p05: number;
  p50: number;
  p95: number;
  bestProbability: number;
  meanRegret: number;
  targetProbability?: number;
}

export interface DecisionRun {
  worlds: readonly DecisionWorld[];
  options: Record<string, DecisionOptionSummary>;
  recommendedOptionId: string;
  recommendation: {
    criterion: "targetProbability" | "meanRegret";
    margin: number;
    close: boolean;
  };
  driver: { factorId: string; correlation: number };
  stress: {
    factorId: string;
    regime: "low" | "high";
    threshold: number;
    criterion: "targetProbability" | "meanRegret";
    bestOptionId: string;
    bestScore: number;
    recommendedScore: number;
    reversed: boolean;
    worldCount: number;
  };
  paths: Record<string, number>;
}

export interface DecisionArtifact {
  schemaVersion: 3;
  model: DecisionModel;
  seed: number;
  worlds: readonly DecisionWorld[];
}

const assertRange = (value: NumberRange, label: string): void => {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || value[0] > value[1]) {
    throw new Error(`${label} must be an ordered finite range`);
  }
};

export function assertDecisionModel(model: DecisionModel): void {
  if (model.schemaVersion !== 1 || model.adapter !== "decision") throw new Error("unsupported decision model");
  if (!model.situation.trim() || !model.question.trim()) throw new Error("decision situation and question are required");
  if (!model.objective.label.trim()) throw new Error("decision objective is required");
  if (model.objective.target !== undefined && !Number.isFinite(model.objective.target)) throw new Error("objective target must be finite");
  if (model.options.length < 2 || model.options.length > 5) throw new Error("a decision needs 2..5 options");
  if (model.factors.length < 1 || model.factors.length > 8) throw new Error("a decision needs 1..8 uncertain factors");
  const factorIds = new Set<string>();
  for (const factor of model.factors) {
    if (!factor.id || factorIds.has(factor.id) || !factor.label.trim()) throw new Error("factor ids and labels must be unique and non-empty");
    factorIds.add(factor.id);
    assertRange(factor.range, `${factor.id}.range`);
    if (factor.range[0] === factor.range[1]) throw new Error(`${factor.id}.range must contain uncertainty`);
  }
  const optionIds = new Set<string>();
  for (const option of model.options) {
    if (!option.id || optionIds.has(option.id) || !option.label.trim()) throw new Error("option ids and labels must be unique and non-empty");
    optionIds.add(option.id);
    assertRange(option.baseline, `${option.id}.baseline`);
    const effects = new Set<string>();
    for (const effect of option.effects) {
      if (!factorIds.has(effect.factorId)) throw new Error(`${option.id} references unknown factor ${effect.factorId}`);
      if (effects.has(effect.factorId)) throw new Error(`${option.id} repeats factor ${effect.factorId}`);
      effects.add(effect.factorId);
      assertRange(effect.impact, `${option.id}.${effect.factorId}.impact`);
    }
  }
}

const hash = (value: string): number => {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return result;
};
const sample = (range: NumberRange, rng: Rng): number => range[0] === range[1] ? range[0] : rng.between(range);
const oriented = (model: DecisionModel, value: number): number => model.objective.direction === "maximize" ? value : -value;
const quantile = (sorted: readonly number[], fraction: number): number => {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position), a = sorted[low]!, b = sorted[high]!;
  return a + (b - a) * (position - low);
};
const reachedTarget = (model: DecisionModel, value: number): boolean | undefined => model.objective.target === undefined
  ? undefined
  : model.objective.direction === "maximize" ? value >= model.objective.target : value <= model.objective.target;

function summarizeDecision(model: DecisionModel, worlds: readonly DecisionWorld[]): Omit<DecisionRun, "worlds"> {
  const options: Record<string, DecisionOptionSummary> = {};
  for (const option of model.options) {
    const values = worlds.map((world) => world.results[option.id]!);
    const sorted = [...values].sort((a, b) => a - b);
    const targetHits = model.objective.target === undefined ? undefined : values.filter((value) => reachedTarget(model, value)).length / worlds.length;
    options[option.id] = {
      mean: mean(values), std: standardDeviation(values), p05: quantile(sorted, 0.05), p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95),
      bestProbability: worlds.filter((world) => world.bestOptionId === option.id).length / worlds.length,
      meanRegret: mean(worlds.map((world) => world.regrets[option.id]!)),
      ...(targetHits !== undefined ? { targetProbability: targetHits } : {}),
    };
  }
  const criterion = model.objective.target === undefined ? "meanRegret" as const : "targetProbability" as const;
  const ranked = [...model.options].sort((left, right) => {
    const a = options[left.id]!, b = options[right.id]!;
    return criterion === "targetProbability"
      ? b.targetProbability! - a.targetProbability! || a.meanRegret - b.meanRegret || b.bestProbability - a.bestProbability
      : a.meanRegret - b.meanRegret || b.bestProbability - a.bestProbability || oriented(model, b.p50) - oriented(model, a.p50);
  });
  const recommendedOptionId = ranked[0]!.id;
  const runnerUp = options[ranked[1]!.id]!;
  const winner = options[recommendedOptionId]!;
  const margin = criterion === "targetProbability"
    ? winner.targetProbability! - runnerUp.targetProbability!
    : runnerUp.meanRegret - winner.meanRegret;
  const close = criterion === "targetProbability"
    ? margin < 0.05
    : margin <= Math.max(1e-9, Math.abs(winner.meanRegret) * 0.05);
  const advantage = worlds.map((world) => {
    const chosen = oriented(model, world.results[recommendedOptionId]!);
    const alternative = Math.max(...model.options.filter((option) => option.id !== recommendedOptionId).map((option) => oriented(model, world.results[option.id]!)));
    return chosen - alternative;
  });
  const drivers = model.factors.map((factor) => ({ factorId: factor.id, correlation: correlation(worlds.map((world) => world.normalizedFactors[factor.id]!), advantage) }));
  const stressCandidates = model.factors.flatMap((factor) => (["low", "high"] as const).flatMap((regime) => {
    const cohort = worlds.filter((world) => regime === "low" ? world.normalizedFactors[factor.id]! < -1 / 3 : world.normalizedFactors[factor.id]! > 1 / 3);
    if (!cohort.length) return [];
    const scores = new Map(model.options.map((option) => [option.id, criterion === "targetProbability"
      ? cohort.filter((world) => reachedTarget(model, world.results[option.id]!)).length / cohort.length
      : mean(cohort.map((world) => world.regrets[option.id]!))]));
    const bestOptionId = [...model.options].sort((a, b) => criterion === "targetProbability" ? scores.get(b.id)! - scores.get(a.id)! : scores.get(a.id)! - scores.get(b.id)!)[0]!.id;
    const bestScore = scores.get(bestOptionId)!;
    const recommendedScore = scores.get(recommendedOptionId)!;
    const reversalGap = criterion === "targetProbability" ? bestScore - recommendedScore : recommendedScore - bestScore;
    const span = factor.range[1] - factor.range[0];
    return {
      factorId: factor.id, regime,
      threshold: factor.range[0] + span * (regime === "low" ? 1 / 3 : 2 / 3),
      criterion, bestOptionId,
      bestScore, recommendedScore,
      reversed: bestOptionId !== recommendedOptionId && reversalGap >= (criterion === "targetProbability" ? 0.05 : Math.max(1e-9, Math.abs(bestScore) * 0.05)),
      worldCount: cohort.length,
    };
  }));
  const fallbackDriver = [...drivers].sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))[0]!;
  const fallbackFactor = model.factors.find((factor) => factor.id === fallbackDriver.factorId)!;
  const stress = stressCandidates.sort((a, b) => Number(b.reversed) - Number(a.reversed) || (criterion === "targetProbability" ? a.recommendedScore - b.recommendedScore : b.recommendedScore - a.recommendedScore))[0] ?? {
    factorId: fallbackDriver.factorId, regime: "high" as const, threshold: (fallbackFactor.range[0] + fallbackFactor.range[1]) / 2,
    criterion, bestOptionId: recommendedOptionId,
    bestScore: criterion === "targetProbability" ? options[recommendedOptionId]!.targetProbability! : options[recommendedOptionId]!.meanRegret,
    recommendedScore: criterion === "targetProbability" ? options[recommendedOptionId]!.targetProbability! : options[recommendedOptionId]!.meanRegret,
    reversed: false, worldCount: worlds.length,
  };
  const driver = drivers.find((candidate) => candidate.factorId === stress.factorId)!;
  const factor = model.factors.find((candidate) => candidate.id === driver.factorId)!;
  const optionLabels = new Map(model.options.map((option) => [option.id, option.label]));
  const paths: Record<string, number> = {};
  for (const world of worlds) {
    const normalized = world.normalizedFactors[driver.factorId]!;
    const regime = normalized < -1 / 3 ? factor.lowLabel ?? `Low ${factor.label}` : normalized > 1 / 3 ? factor.highLabel ?? `High ${factor.label}` : `Typical ${factor.label}`;
    const value = world.results[world.bestOptionId]!;
    const target = reachedTarget(model, value);
    const outcome = target === undefined ? (oriented(model, value) >= oriented(model, options[world.bestOptionId]!.p50) ? "Stronger outcome" : "Weaker outcome") : target ? "Goal reached" : "Goal missed";
    world.path = ["All plausible worlds", regime, optionLabels.get(world.bestOptionId)!, outcome];
    const key = world.path.join(" → ");
    paths[key] = (paths[key] ?? 0) + 1;
  }
  return { options, recommendedOptionId, recommendation: { criterion, margin, close }, driver, stress, paths };
}

export function runDecision(model: DecisionModel, trials: number, seed: number): DecisionRun {
  assertDecisionModel(model);
  const worlds = runMonteCarlo(trials, seed, (rng, worldSeed, index): DecisionWorld => {
    const factors: Record<string, number> = {}, normalizedFactors: Record<string, number> = {};
    for (const factor of model.factors) {
      const value = sample(factor.range, rng), span = factor.range[1] - factor.range[0];
      factors[factor.id] = value;
      normalizedFactors[factor.id] = span === 0 ? 0 : ((value - factor.range[0]) / span) * 2 - 1;
    }
    const results: Record<string, number> = {};
    for (const option of model.options) {
      const optionRng = new Rng(deriveSeed(worldSeed, hash(option.id)));
      results[option.id] = sample(option.baseline, optionRng) + option.effects.reduce((sum, effect) => sum + normalizedFactors[effect.factorId]! * sample(effect.impact, optionRng), 0);
    }
    const best = [...model.options].sort((a, b) => oriented(model, results[b.id]!) - oriented(model, results[a.id]!))[0]!;
    const bestValue = oriented(model, results[best.id]!);
    return {
      index, seed: worldSeed, factors, normalizedFactors, results, bestOptionId: best.id,
      regrets: Object.fromEntries(model.options.map((option) => [option.id, bestValue - oriented(model, results[option.id]!) ])),
      path: [],
    };
  });
  return { worlds, ...summarizeDecision(model, worlds) };
}

export function restoreDecisionRun(model: DecisionModel, worlds: readonly DecisionWorld[]): DecisionRun {
  assertDecisionModel(model);
  if (!worlds.length) throw new Error("decision artifact has no worlds");
  return { worlds, ...summarizeDecision(model, worlds) };
}
