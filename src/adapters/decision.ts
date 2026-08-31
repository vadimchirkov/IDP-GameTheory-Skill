import { conditionWorlds, correlation, mean, runMonteCarlo, standardDeviation, weightedMean, weightedStandardDeviation } from "../monte-carlo.js";
import { hash, Rng } from "../rng.js";
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

export interface DecisionJointEffect {
  id: string;
  label: string;
  /** Both factor regimes must hold before the additional impacts apply. */
  when: readonly [
    { factorId: string; regime: "low" | "high" },
    { factorId: string; regime: "low" | "high" },
  ];
  impacts: readonly { optionId: string; additionalImpact: NumberRange }[];
  /** Plain-language reason why the combination is not already captured additively. */
  assumption: string;
}

export interface DecisionModel {
  schemaVersion: 1;
  adapter: "decision";
  situation: string;
  /** Human-readable decision horizon; descriptive only, never interpreted by the kernel. */
  timeframe?: string;
  question: string;
  objective: {
    label: string;
    unit?: string;
    direction: "maximize" | "minimize";
    target?: number;
  };
  factors: readonly DecisionFactor[];
  options: readonly DecisionOption[];
  /** Explicit non-additive mechanisms. Kept deliberately small and reviewable. */
  jointEffects?: readonly DecisionJointEffect[];
  assumptions: readonly string[];
}

export interface DecisionWorld {
  index: number;
  seed: number;
  factors: Record<string, number>;
  normalizedFactors: Record<string, number>;
  /** Sparse per-option contributions; an absent ID means the relation did not match this world. */
  jointEffects?: Record<string, Record<string, number>>;
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

export interface DecisionFailureBox {
  rules: readonly { factorId: string; side: "low" | "high"; threshold: number }[];
  alternativeOptionId: string;
  baseline: number;
  density: number;
  coverage: number;
  lift: number;
  support: number;
  failureCount: number;
}

export interface DecisionJointEffectSummary {
  activeWorlds: number;
  activationShare: number;
  winnerChanges: number;
  winnerChangeShare: number;
  activeWinnerChangeShare: number;
  bestOptionIdWhenActive: string;
  recommendedWithoutEffectId: string;
  recommendationChanged: boolean;
  /** Tests that separate the joint mechanism from either factor acting alone. */
  contrastPlan: readonly {
    changeFactorId: string;
    changeTo: "low" | "high";
    holdFactorId: string;
    holdAt: "low" | "high";
  }[];
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
  /** Holdout-validated two-factor region where another option meaningfully leads. */
  failureBox?: DecisionFailureBox;
  jointEffects?: Record<string, DecisionJointEffectSummary>;
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
  if (model.timeframe !== undefined && (!model.timeframe.trim() || model.timeframe.length > 240)) throw new Error("decision timeframe must be a non-empty string within 240 characters");
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
  if ((model.jointEffects?.length ?? 0) > 2) throw new Error("a decision supports at most two joint effects");
  const jointIds = new Set<string>();
  for (const joint of model.jointEffects ?? []) {
    if (!joint.id || jointIds.has(joint.id)) throw new Error("joint effect ids must be unique and non-empty");
    jointIds.add(joint.id);
    if (!joint.label.trim() || joint.label.length > 120) throw new Error(`${joint.id}.label must be a non-empty string within 120 characters`);
    if (!joint.assumption.trim() || joint.assumption.length > 320) throw new Error(`${joint.id}.assumption must be a non-empty string within 320 characters`);
    if (!Array.isArray(joint.when) || joint.when.length !== 2 || joint.when[0].factorId === joint.when[1].factorId) throw new Error(`${joint.id} needs exactly two distinct factor conditions`);
    for (const condition of joint.when) {
      if (!factorIds.has(condition.factorId)) throw new Error(`${joint.id} references unknown factor ${condition.factorId}`);
      if (condition.regime !== "low" && condition.regime !== "high") throw new Error(`${joint.id} has an invalid factor regime`);
    }
    if (!joint.impacts.length) throw new Error(`${joint.id} needs at least one option impact`);
    const impacted = new Set<string>();
    for (const impact of joint.impacts) {
      if (!optionIds.has(impact.optionId)) throw new Error(`${joint.id} references unknown option ${impact.optionId}`);
      if (impacted.has(impact.optionId)) throw new Error(`${joint.id} repeats option ${impact.optionId}`);
      impacted.add(impact.optionId);
      assertRange(impact.additionalImpact, `${joint.id}.${impact.optionId}.additionalImpact`);
      const span = additiveSpan(model.options.find((option) => option.id === impact.optionId)!);
      const largest = Math.max(Math.abs(impact.additionalImpact[0]), Math.abs(impact.additionalImpact[1]));
      if (largest > JOINT_IMPACT_LIMIT * span) throw new Error(`${joint.id}.${impact.optionId}.additionalImpact of ${largest} exceeds ${JOINT_IMPACT_LIMIT}x the option's additive span of ${span}; model such a dominant mechanism as its own option or factor`);
    }
  }
}

const sample = (range: NumberRange, rng: Rng): number => range[0] === range[1] ? range[0] : rng.between(range);
/**
 * A joint condition holds in the outer third of its factor range: "low" is the bottom third,
 * "high" the top third. Two independent uniform factors therefore combine in about 11% of worlds.
 * The value is part of the model contract — the AI is told what low/high mean when it sizes impacts.
 */
export const REGIME_BOUNDARY = 1 / 3;
/** Share of a factor's range each regime covers, and how often two of them coincide. Reports and the
 *  model-building prompt read these instead of restating "a third" as prose that would drift. */
export const REGIME_SHARE = (1 - REGIME_BOUNDARY) / 2;
export const JOINT_ACTIVATION_SHARE = REGIME_SHARE * REGIME_SHARE;
/**
 * A joint effect is a correction to an option's response, so it must stay smaller than the response
 * itself by a wide margin. Beyond this multiple the decision is driven by one asserted mechanism and
 * belongs in the model as its own option or factor, where it gets a range and a stress lens.
 */
export const JOINT_IMPACT_LIMIT = 3;
/** Full additive span of an option: baseline width plus each factor moving from low to high. */
const additiveSpan = (option: DecisionOption): number =>
  option.baseline[1] - option.baseline[0] + option.effects.reduce((sum, effect) => sum + 2 * Math.max(Math.abs(effect.impact[0]), Math.abs(effect.impact[1])), 0);
const oriented = (model: DecisionModel, value: number): number => model.objective.direction === "maximize" ? value : -value;
const quantile = (sorted: readonly number[], fraction: number): number => {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position), a = sorted[low]!, b = sorted[high]!;
  return a + (b - a) * (position - low);
};
const reachedTarget = (model: DecisionModel, value: number): boolean | undefined => model.objective.target === undefined
  ? undefined
  : model.objective.direction === "maximize" ? value >= model.objective.target : value <= model.objective.target;

/**
 * Smallest score difference worth acting on. Regret gaps are compared against the objective spread
 * the options actually cover, because scaling them by a regret that approaches zero makes every
 * rounding difference look decisive.
 */
const materialGap = (criterion: DecisionRun["recommendation"]["criterion"], objectiveScale: number): number =>
  criterion === "targetProbability" ? 0.05 : Math.max(Number.EPSILON, objectiveScale * 0.02);

/** P(X <= successes) for X ~ Binomial(trials, probability). */
const binomialCdf = (successes: number, trials: number, probability: number): number => {
  if (successes >= trials) return 1;
  if (successes < 0 || probability >= 1) return 0;
  if (probability <= 0) return 1;
  let logTerm = trials * Math.log1p(-probability), total = 0;
  for (let index = 0; index <= successes; index += 1) {
    total += Math.exp(logTerm);
    logTerm += Math.log((trials - index) / (index + 1)) + Math.log(probability) - Math.log1p(-probability);
  }
  return Math.min(1, total);
};

type FailureRule = DecisionFailureBox["rules"][number];
const matchesRule = (world: DecisionWorld, rule: FailureRule) => rule.side === "low"
  ? world.factors[rule.factorId]! <= rule.threshold
  : world.factors[rule.factorId]! >= rule.threshold;

/**
 * Quasi p-value (Bryant & Lempert 2010): relax one rule and test whether the worlds it was excluding
 * are meaningfully less likely to fail. A rule that survives relaxation is decoration — it narrows the
 * stated condition without carrying information, which reads as a discovered interaction.
 */
const ruleIsInformative = (
  worlds: readonly DecisionWorld[],
  rules: readonly [FailureRule, FailureRule],
  tested: FailureRule,
  fails: (world: DecisionWorld) => boolean,
): boolean => {
  const kept = rules.find((rule) => rule !== tested)!;
  const inside = worlds.filter((world) => rules.every((rule) => matchesRule(world, rule)));
  const added = worlds.filter((world) => matchesRule(world, kept) && !matchesRule(world, tested));
  if (!inside.length || !added.length) return false;
  const density = inside.filter(fails).length / inside.length;
  return binomialCdf(added.filter(fails).length, added.length, density) < 0.05;
};

function findFailureBox(
  model: DecisionModel,
  worlds: readonly DecisionWorld[],
  recommendedOptionId: string,
  criterion: DecisionRun["recommendation"]["criterion"],
  objectiveScale: number,
): DecisionFailureBox | undefined {
  if (model.factors.length < 2 || worlds.length < 100) return undefined;
  const train = worlds.filter((world) => world.index % 2 === 0);
  const holdout = worlds.filter((world) => world.index % 2 === 1);
  const rules = new Map(model.factors.map((factor) => {
    const values = train.map((world) => world.factors[factor.id]!).sort((a, b) => a - b);
    const candidates = ([0.2, 0.4, 0.6, 0.8] as const).flatMap((fraction) => {
      const threshold = quantile(values, fraction);
      return (["low", "high"] as const).map((side) => ({ factorId: factor.id, side, threshold }));
    });
    return [factor.id, candidates] as const;
  }));
  const minimumTrainSupport = Math.max(25, Math.floor(train.length * 0.05));
  let selected: { rules: [FailureRule, FailureRule]; alternativeOptionId: string; quality: number; lift: number; support: number } | undefined;

  for (const alternative of model.options) {
    if (alternative.id === recommendedOptionId) continue;
    const fails = (world: DecisionWorld) => oriented(model, world.results[alternative.id]!) > oriented(model, world.results[recommendedOptionId]!);
    const trainFailures = train.filter(fails).length;
    if (!trainFailures) continue;
    const baseline = trainFailures / train.length;
    for (let left = 0; left < model.factors.length - 1; left += 1) {
      for (let right = left + 1; right < model.factors.length; right += 1) {
        for (const a of rules.get(model.factors[left]!.id)!) for (const b of rules.get(model.factors[right]!.id)!) {
          const cohort = train.filter((world) => matchesRule(world, a) && matchesRule(world, b));
          if (cohort.length < minimumTrainSupport) continue;
          const failures = cohort.filter(fails).length;
          if (failures < 15) continue;
          const density = failures / cohort.length;
          const coverage = failures / trainFailures;
          const lift = density / baseline;
          const quality = density * coverage * coverage;
          if (!selected || quality > selected.quality || quality === selected.quality && (lift > selected.lift || lift === selected.lift && cohort.length > selected.support)) {
            selected = { rules: [a, b], alternativeOptionId: alternative.id, quality, lift, support: cohort.length };
          }
        }
      }
    }
  }
  if (!selected) return undefined;

  const fails = (world: DecisionWorld) => oriented(model, world.results[selected!.alternativeOptionId]!) > oriented(model, world.results[recommendedOptionId]!);
  const totalFailures = holdout.filter(fails).length;
  if (!totalFailures) return undefined;
  const cohort = holdout.filter((world) => selected!.rules.every((rule) => matchesRule(world, rule)));
  const failureCount = cohort.filter(fails).length;
  const baseline = totalFailures / holdout.length;
  const density = cohort.length ? failureCount / cohort.length : 0;
  const coverage = failureCount / totalFailures;
  const lift = baseline ? density / baseline : 0;
  if (cohort.length < 50 || failureCount < 30 || coverage < 0.2 || lift < 1.5 || density <= baseline) return undefined;
  if (!selected.rules.every((rule) => ruleIsInformative(holdout, selected!.rules, rule, fails))) return undefined;

  const scores = new Map(model.options.map((option) => [option.id, criterion === "targetProbability"
    ? cohort.filter((world) => reachedTarget(model, world.results[option.id]!)).length / cohort.length
    : mean(cohort.map((world) => world.regrets[option.id]!))]));
  const bestOptionId = [...model.options].sort((a, b) => criterion === "targetProbability" ? scores.get(b.id)! - scores.get(a.id)! : scores.get(a.id)! - scores.get(b.id)!)[0]!.id;
  if (bestOptionId !== selected.alternativeOptionId) return undefined;
  const bestScore = scores.get(bestOptionId)!;
  const recommendedScore = scores.get(recommendedOptionId)!;
  const gap = criterion === "targetProbability" ? bestScore - recommendedScore : recommendedScore - bestScore;
  if (gap < materialGap(criterion, objectiveScale)) return undefined;

  return { rules: selected.rules, alternativeOptionId: selected.alternativeOptionId, baseline, density, coverage, lift, support: cohort.length, failureCount };
}

function summarizeOptions(model: DecisionModel, worlds: readonly DecisionWorld[]): Record<string, DecisionOptionSummary> {
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
  return options;
}

function rankOptions(model: DecisionModel, options: Record<string, DecisionOptionSummary>, criterion: DecisionRun["recommendation"]["criterion"]): DecisionOption[] {
  return [...model.options].sort((left, right) => {
    const a = options[left.id]!, b = options[right.id]!;
    return criterion === "targetProbability"
      ? b.targetProbability! - a.targetProbability! || a.meanRegret - b.meanRegret || b.bestProbability - a.bestProbability
      : a.meanRegret - b.meanRegret || b.bestProbability - a.bestProbability || oriented(model, b.p50) - oriented(model, a.p50);
  });
}

/** The single definition of who wins a world and what the others give up by being chosen instead. */
function worldWithResults(model: DecisionModel, world: Omit<DecisionWorld, "results" | "regrets" | "bestOptionId">, results: Record<string, number>): DecisionWorld {
  const best = model.options.reduce((leader, option) => oriented(model, results[option.id]!) > oriented(model, results[leader.id]!) ? option : leader);
  const bestValue = oriented(model, results[best.id]!);
  return {
    ...world,
    results,
    bestOptionId: best.id,
    regrets: Object.fromEntries(model.options.map((option) => [option.id, bestValue - oriented(model, results[option.id]!) ])),
  };
}

const decisionCriterion = (model: DecisionModel) => model.objective.target === undefined ? "meanRegret" as const : "targetProbability" as const;

/**
 * Who leads and by how much. `close` is the guard against reading noise as a decision: a lead smaller
 * than the material gap means the run does not separate the options, however it happened to sort.
 */
function recommendFrom(model: DecisionModel, options: Record<string, DecisionOptionSummary>): { recommendedOptionId: string; recommendation: DecisionRun["recommendation"] } {
  const criterion = decisionCriterion(model);
  const ranked = rankOptions(model, options, criterion);
  const recommendedOptionId = ranked[0]!.id;
  const runnerUp = options[ranked[1]!.id]!;
  const winner = options[recommendedOptionId]!;
  const margin = criterion === "targetProbability"
    ? winner.targetProbability! - runnerUp.targetProbability!
    : runnerUp.meanRegret - winner.meanRegret;
  const objectiveScale = Math.max(...model.options.map((option) => options[option.id]!.p95)) - Math.min(...model.options.map((option) => options[option.id]!.p05));
  return { recommendedOptionId, recommendation: { criterion, margin, close: margin < materialGap(criterion, objectiveScale) } };
}

function summarizeDecision(model: DecisionModel, worlds: readonly DecisionWorld[]): Omit<DecisionRun, "worlds"> {
  const options = summarizeOptions(model, worlds);
  const criterion = decisionCriterion(model);
  const { recommendedOptionId, recommendation } = recommendFrom(model, options);
  const { margin, close } = recommendation;
  const objectiveScale = Math.max(...model.options.map((option) => options[option.id]!.p95)) - Math.min(...model.options.map((option) => options[option.id]!.p05));
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
      reversed: bestOptionId !== recommendedOptionId && reversalGap >= materialGap(criterion, objectiveScale),
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
  const failureBox = findFailureBox(model, worlds, recommendedOptionId, criterion, objectiveScale);
  const jointEffects = Object.fromEntries((model.jointEffects ?? []).map((joint) => {
    const active = worlds.filter((world) => world.jointEffects?.[joint.id]);
    const ablated = worlds.map((world) => {
      const contributions = world.jointEffects?.[joint.id];
      if (!contributions) return world;
      return worldWithResults(model, world, Object.fromEntries(model.options.map((option) => [option.id, world.results[option.id]! - (contributions[option.id] ?? 0)])));
    });
    const recommendedWithoutEffectId = rankOptions(model, summarizeOptions(model, ablated), criterion)[0]!.id;
    const winnerChanges = worlds.filter((world, index) => world.bestOptionId !== ablated[index]!.bestOptionId).length;
    // Two conditions leave exactly two useful tests: relax one while holding the other. One test cannot
    // tell the two single-factor explanations apart, so this pair is already the minimum contrast set.
    const contrastPlan = joint.when.map((changed, index) => {
      const held = joint.when[index === 0 ? 1 : 0]!;
      return { changeFactorId: changed.factorId, changeTo: changed.regime === "low" ? "high" as const : "low" as const, holdFactorId: held.factorId, holdAt: held.regime };
    });
    return [joint.id, {
      activeWorlds: active.length,
      activationShare: active.length / worlds.length,
      winnerChanges,
      winnerChangeShare: winnerChanges / worlds.length,
      activeWinnerChangeShare: active.length ? winnerChanges / active.length : 0,
      bestOptionIdWhenActive: rankOptions(model, active.length ? summarizeOptions(model, active) : options, criterion)[0]!.id,
      recommendedWithoutEffectId,
      recommendationChanged: recommendedWithoutEffectId !== recommendedOptionId,
      contrastPlan,
    } satisfies DecisionJointEffectSummary];
  }));
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
  return { options, recommendedOptionId, recommendation: { criterion, margin, close }, driver, stress, ...(failureBox ? { failureBox } : {}), ...(Object.keys(jointEffects).length ? { jointEffects } : {}), paths };
}

export function runDecision(model: DecisionModel, trials: number, seed: number): DecisionRun {
  assertDecisionModel(model);
  // Stream addresses and canonical order are properties of the model, so they are resolved once rather
  // than per world. Order still matters: two relations touching one option must add up the same way every
  // run, and float addition is not associative.
  const joints = [...(model.jointEffects ?? [])].sort((a, b) => a.id < b.id ? -1 : 1).map((joint) => ({
    joint,
    stream: hash(`joint:${joint.id}`),
    impacts: [...joint.impacts].sort((a, b) => a.optionId < b.optionId ? -1 : 1).map((impact) => ({ impact, stream: hash(impact.optionId) })),
  }));
  const worlds = runMonteCarlo(trials, seed, (rng, worldSeed, index): DecisionWorld => {
    const factors: Record<string, number> = {}, normalizedFactors: Record<string, number> = {};
    for (const factor of model.factors) {
      const value = sample(factor.range, rng), span = factor.range[1] - factor.range[0];
      factors[factor.id] = value;
      normalizedFactors[factor.id] = span === 0 ? 0 : ((value - factor.range[0]) / span) * 2 - 1;
    }
    const results: Record<string, number> = {};
    for (const option of model.options) {
      const optionRng = rng.fork(option.id);
      results[option.id] = sample(option.baseline, optionRng) + option.effects.reduce((sum, effect) => sum + normalizedFactors[effect.factorId]! * sample(effect.impact, optionRng), 0);
    }
    const jointEffects: Record<string, Record<string, number>> = {};
    for (const entry of joints) {
      const matches = entry.joint.when.every((condition) => condition.regime === "low"
        ? normalizedFactors[condition.factorId]! < -REGIME_BOUNDARY
        : normalizedFactors[condition.factorId]! > REGIME_BOUNDARY);
      if (!matches) continue;
      const contributions: Record<string, number> = {};
      for (const { impact, stream } of entry.impacts) {
        const contribution = sample(impact.additionalImpact, rng.fork(entry.stream, stream));
        contributions[impact.optionId] = contribution;
        results[impact.optionId] = results[impact.optionId]! + contribution;
      }
      jointEffects[entry.joint.id] = contributions;
    }
    return worldWithResults(model, { index, seed: worldSeed, factors, normalizedFactors, ...(joints.length ? { jointEffects } : {}), path: [] }, results);
  });
  return { worlds, ...summarizeDecision(model, worlds) };
}

export function restoreDecisionRun(model: DecisionModel, worlds: readonly DecisionWorld[]): DecisionRun {
  assertDecisionModel(model);
  if (!worlds.length) throw new Error("decision artifact has no worlds");
  return { worlds, ...summarizeDecision(model, worlds) };
}

/**
 * What actually happened, stated against the run's own model: either a shared factor came in at a
 * value, or one option was taken and produced an objective value. Exactly one of the two ids is set.
 */
export interface DecisionObservation {
  factorId?: string;
  optionId?: string;
  /** The observed number, in the factor's own units or in the objective's units. */
  value: number;
  /** Kernel width as a share of that quantity's own spread; smaller constrains harder. Default 0.15. */
  tolerance?: number;
}

export interface DecisionPosterior {
  effectiveSampleSize: number;
  /** Mean raw agreement across worlds — how well the evidence fits the model at all. */
  fit: number;
  options: Record<string, DecisionOptionSummary>;
  recommendedOptionId: string;
  /** Same margin rule as an unweighted run: `close` means the evidence does not separate the options. */
  recommendation: DecisionRun["recommendation"];
}

const DEFAULT_DECISION_TOLERANCE = 0.15;

export function assertDecisionObservation(model: DecisionModel, observation: DecisionObservation): void {
  const named = [observation.factorId, observation.optionId].filter((value) => value !== undefined);
  if (named.length !== 1) throw new Error("a decision observation names exactly one factor or one option");
  if (observation.factorId !== undefined && !model.factors.some((factor) => factor.id === observation.factorId)) throw new Error(`unknown factor ${observation.factorId}`);
  if (observation.optionId !== undefined && !model.options.some((option) => option.id === observation.optionId)) throw new Error(`unknown option ${observation.optionId}`);
  if (!Number.isFinite(observation.value)) throw new Error("a decision observation needs a finite value");
  if (observation.tolerance !== undefined && !(observation.tolerance > 0 && observation.tolerance <= 1)) throw new Error("tolerance must be within (0, 1]");
}

/** Weighted quantile over value/weight pairs sorted ascending; weights sum to 1. */
const weightedQuantile = (pairs: readonly { value: number; weight: number }[], fraction: number): number => {
  let cumulative = 0;
  for (const pair of pairs) {
    cumulative += pair.weight;
    if (cumulative >= fraction) return pair.value;
  }
  return pairs[pairs.length - 1]!.value;
};

function weightedOptionSummaries(model: DecisionModel, worlds: readonly DecisionWorld[], weights: readonly number[]): Record<string, DecisionOptionSummary> {
  const options: Record<string, DecisionOptionSummary> = {};
  for (const option of model.options) {
    const values = worlds.map((world) => world.results[option.id]!);
    const pairs = values.map((value, index) => ({ value, weight: weights[index]! })).sort((a, b) => a.value - b.value);
    const share = (predicate: (world: DecisionWorld) => boolean) => worlds.reduce((sum, world, index) => predicate(world) ? sum + weights[index]! : sum, 0);
    options[option.id] = {
      mean: weightedMean(values, weights),
      std: weightedStandardDeviation(values, weights),
      p05: weightedQuantile(pairs, 0.05), p50: weightedQuantile(pairs, 0.5), p95: weightedQuantile(pairs, 0.95),
      bestProbability: share((world) => world.bestOptionId === option.id),
      meanRegret: weightedMean(worlds.map((world) => world.regrets[option.id]!), weights),
      ...(model.objective.target === undefined ? {} : { targetProbability: share((world) => reachedTarget(model, world.results[option.id]!) === true) }),
    };
  }
  return options;
}

/**
 * Reweight a finished decision run to the worlds consistent with what happened, without re-simulating.
 * The forward model is the likelihood: each world's weight is its agreement with every observation, so
 * facts accumulate. Agreement is a Gaussian kernel scaled by the quantity's own spread, so evidence
 * never empties the posterior and `effectiveSampleSize` reports how much it actually narrowed things.
 */
export function fitDecisionPosterior(
  model: DecisionModel,
  worlds: readonly DecisionWorld[],
  observations: readonly DecisionObservation[],
): DecisionPosterior {
  assertDecisionModel(model);
  if (!worlds.length) throw new Error("no decision worlds to condition on");
  for (const observation of observations) assertDecisionObservation(model, observation);

  // Each quantity is compared on its own scale: a factor against its stated range, an option's outcome
  // against the spread the run actually produced. Degenerate spreads fall back to the observed size.
  const scaleFor = (observation: DecisionObservation): number => {
    const spread = observation.factorId !== undefined
      ? (() => { const range = model.factors.find((factor) => factor.id === observation.factorId)!.range; return range[1] - range[0]; })()
      : standardDeviation(worlds.map((world) => world.results[observation.optionId!]!));
    return spread > 0 ? spread : Math.max(Math.abs(observation.value), 1);
  };
  const scales = new Map(observations.map((observation) => [observation, scaleFor(observation)] as const));

  const { weights, effectiveSampleSize, fit } = conditionWorlds(worlds, observations, (world, observation) => {
    const seen = observation.factorId !== undefined ? world.factors[observation.factorId]! : world.results[observation.optionId!]!;
    const width = (observation.tolerance ?? DEFAULT_DECISION_TOLERANCE) * scales.get(observation)!;
    const distance = (seen - observation.value) / width;
    return Math.exp(-0.5 * distance * distance);
  });

  const options = weightedOptionSummaries(model, worlds, weights);
  return { effectiveSampleSize, fit, options, ...recommendFrom(model, options) };
}
