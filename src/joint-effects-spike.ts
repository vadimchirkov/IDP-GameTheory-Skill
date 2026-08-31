import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { Value } from "typebox/value";
import { decisionDraftSchema, normalizeDecisionDraft, type DecisionDraft } from "./agent-contracts.js";
import { runDecision, type DecisionJointEffect, type DecisionModel } from "./adapters/decision.js";
import { generateDecisionReport } from "./decision-report.js";

const model = JSON.parse(await readFile(new URL("../example_joint_effect.json", import.meta.url), "utf8")) as DecisionModel;
const { jointEffects: _jointEffects, ...additiveModel } = model;
const seeds = [11, 37, 73];

const additiveRuns = seeds.map((seed) => runDecision(additiveModel, 600, seed));
const jointRuns = seeds.map((seed) => runDecision(model, 600, seed));

const range = ([min, max]: readonly [number, number]) => ({ min, max });
const draft: DecisionDraft = {
  timeframe: model.timeframe ?? null,
  question: model.question,
  objective: { ...model.objective, unit: model.objective.unit ?? null, target: model.objective.target ?? null },
  factors: model.factors.map((factor) => ({ ...factor, range: range(factor.range), lowLabel: factor.lowLabel ?? `Low ${factor.label}`, highLabel: factor.highLabel ?? `High ${factor.label}` })),
  options: model.options.map((option) => ({ ...option, description: option.description ?? option.label, baseline: range(option.baseline), effects: option.effects.map((effect) => ({ ...effect, impact: range(effect.impact) })) })),
  jointEffects: model.jointEffects!.map((joint) => ({ ...joint, when: [...joint.when], impacts: joint.impacts.map((impact) => ({ ...impact, additionalImpact: range(impact.additionalImpact) })) })),
  assumptions: [...model.assumptions],
  questions: [],
  completionMessage: "The launch options are ready for a paired-world comparison.",
};
assert.equal(Value.Check(decisionDraftSchema, draft), true, "the AI output contract accepts one bounded joint effect");
assert.equal(normalizeDecisionDraft(draft, model.situation).jointEffects?.[0]?.id, "demand-capacity-mismatch", "the AI draft normalizes into the executable relation");

assert.ok(additiveRuns.every((run) => run.recommendedOptionId === "broad"), "the additive baseline must prefer the broad launch");
assert.ok(jointRuns.every((run) => run.recommendedOptionId === "focused"), "the explicit joint mechanism must materially change the recommendation");
assert.ok(jointRuns.every((run) => {
  const summary = run.jointEffects?.["demand-capacity-mismatch"];
  return summary?.recommendedWithoutEffectId === "broad"
    && summary.bestOptionIdWhenActive === "focused"
    && summary.recommendationChanged
    && summary.activeWinnerChangeShare === 1;
}), "ablation must attribute the recommendation change to the accepted mechanism");
assert.deepEqual(jointRuns[0]!.jointEffects!["demand-capacity-mismatch"]!.contrastPlan, [
  { changeFactorId: "demand", changeTo: "low", holdFactorId: "capacity", holdAt: "low" },
  { changeFactorId: "capacity", changeTo: "high", holdFactorId: "demand", holdAt: "high" },
], "the main Decision run must return the minimum contrast portfolio, not leave it in the benchmark");

const buffer: DecisionJointEffect = {
  id: "focused-buffer",
  label: "Focus preserves spare capacity",
  when: [{ factorId: "demand", regime: "low" }, { factorId: "capacity", regime: "high" }],
  impacts: [{ optionId: "focused", additionalImpact: [1, 3] }],
  assumption: "A narrow range can redirect spare supplier capacity to service quality when demand is low.",
};
const primary = model.jointEffects![0]!;
const ordered = runDecision({ ...model, jointEffects: [primary, buffer] }, 600, 73);
const reordered = runDecision({ ...model, jointEffects: [buffer, primary] }, 600, 73);
assert.deepEqual(ordered.worlds, reordered.worlds, "relation order must not change sampled worlds or contributions");
assert.throws(() => runDecision({ ...model, jointEffects: [{ ...primary, when: [primary.when[0], primary.when[0]] }] }, 1, 1), /two distinct factor conditions/, "duplicate joint conditions are rejected before simulation");
assert.throws(() => runDecision({ ...model, jointEffects: [{ ...primary, impacts: [{ optionId: "broad", additionalImpact: [-4000, -4000] }] }] }, 1, 1), /exceeds 3x the option's additive span/, "a mechanism that dwarfs the option's own response is rejected, not silently allowed to decide the comparison");

const html = generateDecisionReport(model, jointRuns[0]!);
assert.ok(html.includes("When would we choose differently?") && html.includes("rests on an assumption you accepted") && html.includes("Broad launch wins instead"), "the report leads with the decision consequence of the assumption, not with its statistics");
assert.ok(html.includes("The run executes this assumption; it cannot confirm it.") && html.includes("tell this mechanism apart"), "activation, ablation and the contrast plan stay available one disclosure away");

// A failure box names factors and sides, never thresholds. An accepted assumption that happens to name
// the same two must not suppress a holdout-validated region found at its own boundaries.
const overlapping = generateDecisionReport(model, {
  ...jointRuns[0]!,
  failureBox: {
    rules: [{ factorId: "demand", side: "high", threshold: 55 }, { factorId: "capacity", side: "low", threshold: 48 }],
    alternativeOptionId: "broad", baseline: 0.2, density: 0.62, coverage: 0.44, lift: 3.1, support: 120, failureCount: 74,
  },
});
assert.ok(overlapping.includes("Choose Broad launch instead when Demand ≥ 55.0") && overlapping.includes("3.1× the overall rate"), "an overlapping joint assumption must not hide the validated region or its evidence");
if (process.argv.includes("--visual")) {
  await mkdir("reports", { recursive: true });
  await writeFile("reports/joint-effects-spike.html", html, "utf8");
}

const summaries = jointRuns.map((run) => run.jointEffects![primary.id]!);
const activation = summaries.reduce((sum, value) => sum + value.activationShare, 0) / summaries.length;
const winnerChange = summaries.reduce((sum, value) => sum + value.winnerChangeShare, 0) / summaries.length;
console.log("joint-effects spike OK", JSON.stringify({
  seeds,
  worldsPerRun: 600,
  additiveRecommendation: additiveRuns[0]!.recommendedOptionId,
  jointRecommendation: jointRuns[0]!.recommendedOptionId,
  averageActivationPct: Number((activation * 100).toFixed(1)),
  averageWinnerChangePct: Number((winnerChange * 100).toFixed(1)),
  ablatedRecommendation: summaries[0]!.recommendedWithoutEffectId,
  ...(process.argv.includes("--visual") ? { report: "reports/joint-effects-spike.html" } : {}),
}));
