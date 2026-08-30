import assert from "node:assert/strict";
import { EntityId, replayAndVerify } from "@lambda-house/teob-ts/core";
import { Value } from "typebox/value";
import { createSingleRuntime } from "@lambda-house/teob-ts/inmem";
import { analyzeScenario, replayScenarioWorld } from "./adapters/repeated-game.js";
import { sequentialActionAdapter } from "./action-simulation.js";
import { runDecision, type DecisionModel } from "./adapters/decision.js";
import { generateDecisionReport } from "./decision-report.js";
import type { ScenarioModel } from "./domain.js";
import { conditionWorlds, runMonteCarlo } from "./monte-carlo.js";
import { runPolymarket, type PolymarketSpec } from "./adapters/polymarket.js";
import { Rng } from "./rng.js";
import { runStochasticProcess, type StochasticProcessSpec } from "./adapters/stochastic-process.js";
import { runSimulation } from "./simulation.js";
import { applyTaskEvent, isRunStale, taskAggregate, taskCategory, taskEventCodec, taskStateCodec, type TaskAnalysis, type TaskEvent, type TaskState } from "./task.js";
import { completeTopology, interactionsFor, sampleTopology } from "./topology.js";
import { generateWorldsVisual, injectWorldLabels, visibleWorldLabelNodes } from "./worlds-report.js";
import { contextReplyOutputSchema, normalizeStrategicDraft, strategicDraftSchema } from "./agent-contracts.js";
import { parseChatResponse, parseScenarioHints } from "./pi-agent.js";
import { relativeTime } from "../app/src/relative-time.js";
import { openPublicPage } from "./web-research.js";

const reservoirDecision: DecisionModel = {
  schemaVersion: 1, adapter: "decision", situation: "Three farms share a reservoir", timeframe: "next dry season", question: "How should withdrawals be managed?",
  objective: { label: "Shortage days", unit: "days", direction: "minimize", target: 8 },
  factors: [
    { id: "rain", label: "rainfall", range: [0, 100], lowLabel: "Dry season", highLabel: "Wet season" },
    { id: "demand", label: "water demand", range: [0, 100], lowLabel: "Low demand", highLabel: "High demand" },
  ],
  options: [
    { id: "current", label: "Keep current withdrawals", baseline: [12, 16], effects: [{ factorId: "rain", impact: [-7, -5] }, { factorId: "demand", impact: [5, 8] }] },
    { id: "limits", label: "Set withdrawal limits", baseline: [7, 10], effects: [{ factorId: "rain", impact: [-4, -3] }, { factorId: "demand", impact: [2, 4] }] },
    { id: "coordinate", label: "Coordinate withdrawals", baseline: [5, 8], effects: [{ factorId: "rain", impact: [-3, -2] }, { factorId: "demand", impact: [1, 3] }] },
  ],
  assumptions: ["The same rainfall and demand worlds are used for every option."],
};
const decisionRun = runDecision(reservoirDecision, 300, 41);
assert.deepEqual(decisionRun, runDecision(reservoirDecision, 300, 41), "decision runs replay exactly");
assert.equal(decisionRun.worlds.length, 300, "a decision run evaluates every sampled world");
assert.equal(decisionRun.recommendedOptionId, "coordinate", "paired worlds identify the robust reservoir option");
assert.equal(decisionRun.recommendation.criterion, "targetProbability", "a stated target drives the recommendation");
assert.ok(decisionRun.options.coordinate!.targetProbability! > decisionRun.options.current!.targetProbability!, "decision summaries compare target probability");
assert.ok(decisionRun.worlds.every((world) => world.path.length === 4), "every decision world has one four-stage river path");
assert.ok(decisionRun.stress.worldCount > 0 && decisionRun.stress.factorId, "decision runs identify a tested boundary cohort");
const reversalRun = runDecision({
  schemaVersion: 1, adapter: "decision", situation: "A choice changes with demand", question: "Which capacity plan?",
  objective: { label: "Value", direction: "maximize" },
  factors: [{ id: "demand", label: "Demand", range: [0, 100], lowLabel: "Low demand", highLabel: "High demand" }],
  options: [
    { id: "lean", label: "Lean plan", baseline: [10, 10], effects: [{ factorId: "demand", impact: [-20, -20] }] },
    { id: "scale", label: "Scale plan", baseline: [5, 5], effects: [{ factorId: "demand", impact: [10, 10] }] },
  ], assumptions: [],
}, 300, 9);
assert.equal(reversalRun.stress.reversed, true, "stress analysis finds a regime that reverses the overall choice");
assert.equal(reversalRun.failureBox, undefined, "one-factor reversals stay in the stress lens instead of duplicating a failure box");
const interactionModel: DecisionModel = {
  schemaVersion: 1, adapter: "decision", situation: "A capacity choice fails only under two pressures", question: "Which plan?",
  objective: { label: "Value", direction: "maximize" },
  factors: [
    { id: "demand", label: "Demand", range: [0, 100] },
    { id: "cost", label: "Input cost", range: [0, 100] },
  ],
  options: [
    { id: "robust", label: "Robust plan", baseline: [10, 10], effects: [] },
    { id: "growth", label: "Growth plan", baseline: [9, 9], effects: [{ factorId: "demand", impact: [1, 1] }, { factorId: "cost", impact: [1, 1] }] },
  ], assumptions: [],
};
const interactionRuns = [11, 37, 73].map((seed) => runDecision(interactionModel, 2000, seed));
const interactionRun = interactionRuns.at(-1)!;
assert.equal(interactionRun.stress.reversed, false, "one-factor stress misses a joint corner failure");
assert.ok(interactionRun.failureBox && interactionRun.failureBox.rules.length === 2 && interactionRun.failureBox.support >= 50 && interactionRun.failureBox.lift >= 1.5, "a two-factor failure region must pass the holdout quality gate");
assert.ok(interactionRuns.every((run) => run.failureBox?.rules.every((rule) => rule.side === "high") && run.failureBox.coverage >= 0.8), "failure-box direction and coverage remain stable across seeds");
assert.ok(generateDecisionReport(interactionModel, interactionRun).includes("Where the recommendation changes"), "the report explains a validated failure box without adding another result view");
const paddedModel: DecisionModel = {
  schemaVersion: 1, adapter: "decision", situation: "One driver, padded with an irrelevant factor", question: "Which plan?",
  objective: { label: "Value", direction: "maximize" },
  factors: [{ id: "demand", label: "Demand", range: [0, 100] }, { id: "unrelated", label: "Unrelated", range: [0, 100] }],
  options: [
    { id: "robust", label: "Robust plan", baseline: [10, 10], effects: [] },
    { id: "growth", label: "Growth plan", baseline: [9.4, 9.4], effects: [{ factorId: "demand", impact: [1, 1] }] },
  ], assumptions: [],
};
assert.ok([11, 37, 73].every((seed) => runDecision(paddedModel, 2000, seed).failureBox === undefined), "a one-factor vulnerability never borrows an uninformative second condition to look like an interaction");
const tiedModel: DecisionModel = {
  schemaVersion: 1, adapter: "decision", situation: "Two options that differ by a rounding error", question: "Which plan?",
  objective: { label: "Margin", unit: "EUR", direction: "maximize" },
  factors: [{ id: "demand", label: "Demand", range: [0, 100] }, { id: "cost", label: "Cost", range: [0, 100] }],
  options: [
    { id: "a", label: "Plan A", baseline: [200000, 200000], effects: [{ factorId: "demand", impact: [20000, 20000] }] },
    { id: "b", label: "Plan B", baseline: [199990, 199990], effects: [{ factorId: "demand", impact: [20000, 20000] }, { factorId: "cost", impact: [30, 30] }] },
  ], assumptions: [],
};
const tiedRuns = [11, 37, 73].map((seed) => runDecision(tiedModel, 2000, seed));
assert.ok(tiedRuns.every((run) => run.recommendation.close && !run.stress.reversed && !run.failureBox), "a lead far below the objective spread reads as a close call, not as a reversal or a failure region");
const decisionReport = generateDecisionReport(reservoirDecision, decisionRun);
assert.ok(decisionReport.includes("Decision River") && decisionReport.includes("Highest target chance"), "decision report names the recommendation criterion and explains the river");
assert.ok(decisionReport.includes('aria-label="Decision River zoom controls"') && decisionReport.includes("prefers-reduced-motion"), "decision report keeps controls accessible");
assert.ok(decisionReport.includes("Ribbon width = worlds, not value"), "the river states its visual encoding instead of implying utility");
assert.ok(decisionReport.includes('data-regime="all"') && decisionReport.includes('data-metric="best"'), "the report can recalculate option summaries for a stress cohort");

// Action adapters reuse the same Monte Carlo/topology runner: actions affect state,
// while topology changes the transition rule rather than the engine contract.
type Reservoir = { water: number; shortage: number };
const reservoirSpec = {
  schemaVersion: 1 as const, adapter: "reservoir-actions", situation: "shared reservoir",
  topology: { nodes: ["farm-a", "farm-b", "farm-c"], interactions: [{ id: "ab", participants: ["farm-a", "farm-b"], probability: [0, 1] as const }, { id: "bc", participants: ["farm-b", "farm-c"], probability: [0, 1] as const }] },
  model: { steps: 20, initial: [60, 90] as const, rain: [0, 8] as const, demand: [4, 10] as const },
};
const reservoir = sequentialActionAdapter<typeof reservoirSpec.model, Reservoir, number, { final: Reservoir; actionSteps: number }>({
  id: "reservoir-actions", validate: () => {}, steps: (model) => model.steps,
  actors: () => ["farm-a", "farm-b", "farm-c"],
  initialState: (model, rng) => ({ water: rng.between(model.initial), shortage: 0 }),
  chooseAction: (model, _actor, _state, _topology, rng) => model.demand[0] + rng.unit() * (model.demand[1] - model.demand[0]),
  transition: (model, state, actions, topology, rng) => {
    const use = Object.values(actions).reduce((sum, value) => sum + Number(value), 0);
    const coordination = topology.interactions.length ? 0.9 : 1.1;
    const water = Math.max(0, Math.min(100, state.water + rng.between(model.rain) - use * coordination));
    return { water, shortage: state.shortage + (water < 15 ? 1 : 0) };
  },
  observe: (_model, initial, final, history, topology) => ({
    inputs: { initial_water: initial.water, links: topology.interactions.length },
    metrics: { final_water: final.water, shortage_steps: final.shortage },
    path: [topology.interactions.length ? "connected" : "fragmented", final.water < 15 ? "shortage" : "survives"],
    payload: { final, actionSteps: history.length },
  }),
});
const reservoirRun = runSimulation(reservoirSpec, reservoir, 200, 17);
assert.ok(reservoirRun.metrics.final_water && reservoirRun.paths["connected → shortage"] !== undefined, "action adapter produces topology-dependent worlds");
assert.deepEqual(runSimulation(reservoirSpec, reservoir, 20, 17), runSimulation(reservoirSpec, reservoir, 20, 17), "action adapter remains deterministic for a fixed seed");

const scenario: ScenarioModel = {
  situation: "exploit check",
  players: [
    { name: "Shark", dispositions: ["exploitative"] },
    { name: "Mark", dispositions: ["trusting"] },
  ],
  payoffs: { T: [5, 5], R: [3, 3], P: [1, 1], S: [0, 0] },
  structure: { w: [0.9, 0.9], noise: [0, 0] },
};
assert.equal(Value.Check(contextReplyOutputSchema, { kind: "answer", message: "Проверю открытые источники.", suggestions: ["Show me the strongest source", "What remains uncertain?"], contextNote: null, title: "Проверка", researchQueries: [{ query: "public market data", field: "payoffs", purpose: "Ground market conditions" }], questions: [] }), true, "context turns can request bounded public research");
const strategicDraft = { timeframe: "the next 12 quarterly negotiations", game: "prisoners_dilemma" as const, players: [{ name: "A", dispositions: ["provocable" as const], note: "" }, { name: "B", dispositions: ["exploitative" as const], note: "" }], continuation: { min: 0.7, max: 0.9 }, noise: { min: 0, max: 0.05 }, payoffs: { T: { min: 5, max: 6 }, R: { min: 3, max: 4 }, P: { min: 1, max: 2 }, S: { min: 0, max: 1 } }, assumptions: ["The same incentives repeat."], questions: [], completionMessage: "Strategic model ready." };
assert.equal(Value.Check(strategicDraftSchema, strategicDraft), true, "the compact C/D builder contract is machine-validatable");
assert.doesNotThrow(() => analyzeScenario(normalizeStrategicDraft(strategicDraft, "Repeated supplier negotiation"), 2, 1), "the compact C/D draft normalizes into a runnable model");
await assert.rejects(() => openPublicPage("http://127.0.0.1/private"), /Private hosts/, "public research cannot reach loopback services");
assert.deepEqual(parseScenarioHints("1. Кто принимает решение?\n- Какой срок?\n• Что ограничивает выбор?"), ["Кто принимает решение?", "Какой срок?", "Что ограничивает выбор?"]);
assert.deepEqual(parseChatResponse("Main answer.\n<followups>What should we verify next?\nWhich assumption matters most?\nHow could the outcome change?</followups>"), { text: "Main answer.", suggestions: ["What should we verify next?", "Which assumption matters most?", "How could the outcome change?"] });
assert.equal(relativeTime("2026-08-24T10:00:00.000Z", Date.parse("2026-08-24T10:12:00.000Z")), "12m ago");
const analysis = analyzeScenario(scenario, 40, 7);
assert.equal(analysis.winPct.Shark, 100);
const riverNodes = visibleWorldLabelNodes(scenario, analysis);
for (let stage = 0; stage < 6; stage++) assert.equal(riverNodes.filter((node) => node.stage === stage).reduce((sum, node) => sum + node.count, 0), 40);
const labeledRiver = injectWorldLabels(generateWorldsVisual(scenario, 40, 7, analysis), { [riverNodes[0]!.id]: { short: "Начало проверки", detail: "Все проверяемые варианты начинаются здесь." } });
assert.ok(labeledRiver.includes('"short":"Начало проверки"'), "context labels are injected into the standalone report");
assert.ok(labeledRiver.includes("river:selection"), "embedded river reports selected worlds to the agent workspace");
assert.ok(labeledRiver.includes('id="zoom-in"') && labeledRiver.includes("addEventListener('wheel'"), "river reports expose mouse and button zoom controls");
const firstWorld = analysis.trials[0];
assert.ok(firstWorld);
const replayedWorld = replayScenarioWorld(scenario, 7, 0, firstWorld.digest.pivotalPair);
assert.deepEqual(replayedWorld.digest, analysis.trials[0]?.digest, "a river world replays independently from its recorded seed");
assert.equal(replayedWorld.trace?.matches.length, 1, "replay retains only the requested pivotal match trace");

const generic = runMonteCarlo(4, 9, (rng, worldSeed) => ({ worldSeed, value: rng.unit() }));
assert.deepEqual(generic, runMonteCarlo(4, 9, (rng, worldSeed) => ({ worldSeed, value: rng.unit() })), "generic Monte Carlo runs replay exactly");
const conditioned = conditionWorlds(generic, [generic[0]!.worldSeed], (world, observed) => world.worldSeed === observed ? 1 : 0.1);
assert.ok(conditioned.weights[0]! > conditioned.weights[1]! && conditioned.effectiveSampleSize < generic.length, "generic observations reweight worlds");
const complete = completeTopology(["A", "B", "C"]);
assert.equal(complete.interactions.length, 3, "complete topology creates every pair once");
assert.equal(interactionsFor(complete, "A").length, 2, "topology queries interactions by participant");
const sampled = sampleTopology({ nodes: ["A", "B"], interactions: [{ id: "A:B", participants: ["A", "B"], probability: [1, 1], weight: [2, 2] }] }, new Rng(1));
assert.equal(sampled.interactions[0]?.weight, 2, "topology samples uncertain interaction weights");
assert.throws(() => sampleTopology({ nodes: ["A", "B"], interactions: [{ id: "bad", participants: ["A", "missing"], probability: [0, 0] }] }, new Rng(1)), /unknown node/, "excluded interactions are still validated");
const uncertain = { id: "B:C", participants: ["B", "C"], probability: [0.5, 0.5] as const, weight: [0, 1] as const };
const withoutFixed = sampleTopology({ nodes: ["A", "B", "C"], interactions: [uncertain] }, new Rng(7));
const withFixed = sampleTopology({ nodes: ["A", "B", "C"], interactions: [{ id: "A:B", participants: ["A", "B"], probability: [1, 1], weight: [1, 1] }, uncertain] }, new Rng(7));
assert.deepEqual(withFixed.interactions.find((interaction) => interaction.id === uncertain.id), withoutFixed.interactions[0], "fixed interactions do not shift later random samples");
const processSpec: StochasticProcessSpec = {
  schemaVersion: 1,
  adapter: "stochastic-process",
  situation: "A shock spreads through two connected components",
  topology: { nodes: ["source", "target"], interactions: [{ id: "link", participants: ["source", "target"], probability: [0.5, 0.5], weight: [0.5, 1] }] },
  model: {
    horizon: [4, 8], bounds: [0, 100], interactionRate: [0.1, 0.3],
    nodes: [
      { id: "source", initial: [70, 90], drift: [-2, 0], volatility: [0, 2] },
      { id: "target", initial: [10, 30], drift: [0, 1], volatility: [0, 2] },
    ],
    shocks: [{ id: "outage", probability: [0.05, 0.2], delta: [-25, -10] }],
    metrics: [{ id: "health", kind: "mean" }, { id: "failures", kind: "below", threshold: 20 }],
  },
};
const processRun = runStochasticProcess(processSpec, 80, 123);
assert.deepEqual(processRun, runStochasticProcess(processSpec, 80, 123), "stochastic processes replay exactly from one seed");
assert.equal(processRun.worlds.length, 80, "the generic process produces one persisted world per trial");
assert.ok(processRun.worlds.some((world) => world.topology.interactions.length === 0) && processRun.worlds.some((world) => world.topology.interactions.length === 1), "uncertain topology is sampled inside every world");
assert.ok(processRun.metrics.health && processRun.sensitivity.health?.length, "generic metrics and sensitivity are summarized without game semantics");

const marketSpec: PolymarketSpec = {
  schemaVersion: 1, adapter: "polymarket", situation: "Compare one binary market position",
  topology: { nodes: ["market"], interactions: [] },
  model: {
    markets: [{ id: "main", marketPrice: [0.6, 0.6], trueProb: [0.6, 0.6] }],
    positions: [{ id: "no", side: "NO", size: [100, 100], entry: [0.35, 0.35] }, { id: "skip", side: "ABSTAIN", size: [0, 0] }],
    fee: [0, 0],
  },
};
const marketRun = runPolymarket(marketSpec, 20, 1);
assert.equal(marketRun.worlds[0]!.inputs["no.entry"], 0.35, "an explicit NO entry is interpreted as the NO price");
assert.throws(() => runPolymarket({ ...marketSpec, model: { ...marketSpec.model, markets: [...marketSpec.model.markets, { id: "second", marketPrice: [0.4, 0.4], trueProb: [0.5, 0.5] }] } }, 1, 1), /exactly one market/, "P0 rejects unsupported multi-market input");

// A scenario is one list of facts. `situation` facts define the model and move `revision`;
// `outcome` facts are evidence about a finished run and deliberately leave `revision` alone.
const state0: TaskState = { id: "legacy", status: "ready", title: "Legacy", situation: "", facts: [], openQuestions: [], messages: [], revision: 0, analyses: [] };
const legacyJournal: TaskEvent[] = [
  { tag: "TaskCreated", taskId: "legacy", title: "Legacy", brief: "A legacy brief", now: "2025-01-01T00:00:00Z" },
  { tag: "ContextAdded", text: "a legacy clarification", revision: 2, now: "2025-01-01T00:00:01Z" },
  { tag: "AgentProposalAccepted", model: scenario, revision: 3, now: "2025-01-01T00:00:02Z" },
  { tag: "ObservationRecorded", analysisId: "run-1", observation: { fact: "cooperation collapsed", observation: { cooperation: 0.1 }, now: "2025-01-01T00:00:03Z" }, now: "2025-01-01T00:00:03Z" },
];
const legacyReplay = legacyJournal.reduce(applyTaskEvent, state0);
assert.equal(replayAndVerify(taskAggregate, EntityId("legacy"), legacyJournal).violations.length, 0, "legacy journals satisfy the current aggregate invariants");
assert.equal(legacyReplay.facts.length, 2, "an old context/observation journal replays into facts");
assert.equal(legacyReplay.situation, "A legacy brief", "the old brief becomes the situation seed");
assert.equal(legacyReplay.facts.filter((fact) => fact.kind === "outcome").length, 1, "an old observation replays as an outcome fact");
assert.ok(legacyReplay.model, "an accepted legacy proposal still carries its model");

// A journal whose prose only ever lived inside the model still opens with an editable situation —
// without this the form is blank and the agent refuses to run ("Describe the situation first").
const modelOnlyJournal: TaskEvent[] = [
  { tag: "TaskCreated", taskId: "model-only", title: "Model only", now: "2025-01-01T00:00:00Z" },
  { tag: "ModelBuilt", model: scenario, revision: 1, now: "2025-01-01T00:00:01Z" },
];
const modelOnlyReplay = modelOnlyJournal.reduce(applyTaskEvent, { ...state0, id: "model-only" });
assert.equal(modelOnlyReplay.situation, scenario.situation, "a model-only journal recovers its situation from the model");

const removable = { id: "run-1", visualUrl: "/reports/tasks/run-1.html" } as TaskAnalysis;
assert.equal(applyTaskEvent({ ...state0, status: "completed", analyses: [removable] }, { tag: "AnalysisRemoved", analysisId: "run-1", now: "2025-01-01T00:00:04Z" }).analyses.length, 0, "a saved run can be removed");
assert.equal(applyTaskEvent(state0, { tag: "TaskDeleted", now: "2025-01-01T00:00:05Z" }).deleted, true, "a world can be deleted without rewriting its journal");

const task = createSingleRuntime(taskAggregate, taskEventCodec, taskStateCodec);
const tid = EntityId("task-check");
const taskState = async (): Promise<TaskState> => {
  const reply = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
  assert.ok(reply.ok && reply.value.reply?.tag === "State", "the task returns its state");
  return reply.ok && reply.value.reply?.tag === "State" ? reply.value.reply.state : (undefined as never);
};
await task.runtime.ask(tid, { tag: "CreateTask", taskId: "task-check", text: "Two suppliers meet every quarter", factId: "fact-1", now: "2026-01-01T00:00:00Z" }, taskCategory);
const created = await taskState();
assert.equal(created.revision, 1, "the situation seed sets the initial fingerprint");
assert.equal(created.situation, "Two suppliers meet every quarter", "the opening description is the situation seed");
await task.runtime.ask(tid, { tag: "AddMessage", message: { id: "message-1", role: "user", mode: "context", text: "They compete on price", createdAt: "2026-01-01T00:00:00Z" } }, taskCategory);
assert.equal((await taskState()).messages[0]?.text, "They compete on price", "agent conversation is persisted with the task");
const researchRevision = (await taskState()).revision;
await task.runtime.ask(tid, { tag: "RecordResearch", sources: [{ id: "source-1", title: "Public report", url: "https://example.com/report", excerpt: "Published conditions", query: "public report", field: "payoffs", purpose: "Ground conditions", fetchedAt: "2026-01-01T00:00:00Z" }], now: "2026-01-01T00:00:00Z" }, taskCategory);
const researched = await taskState();
assert.equal(researched.researchSources?.[0]?.title, "Public report", "public research provenance is persisted with the task");
assert.equal(researched.researchRevision, researchRevision, "public research is stamped with its context revision");
assert.equal(researched.revision, researchRevision, "recording sources alone does not stale a simulation");

const sit = createSingleRuntime(taskAggregate, taskEventCodec, taskStateCodec);
const sitId = EntityId("situation-edit");
await sit.runtime.ask(sitId, { tag: "CreateTask", taskId: "situation-edit", text: "Two suppliers meet every quarter", factId: "s0", now: "2026-01-01T00:00:00Z" }, taskCategory);
await sit.runtime.ask(sitId, { tag: "SetSituation", text: "Two suppliers meet every month", now: "2026-01-01T00:00:01Z" }, taskCategory);
const sitReply = await sit.runtime.ask(sitId, { tag: "GetTask" }, taskCategory);
assert.ok(sitReply.ok && sitReply.value.reply?.tag === "State");
if (sitReply.ok && sitReply.value.reply?.tag === "State") {
  assert.equal(sitReply.value.reply.state.situation, "Two suppliers meet every month", "the situation prose can be edited");
  assert.equal(sitReply.value.reply.state.revision, 2, "editing the situation moves the fingerprint");
}
await sit.runtime.shutdown();

// The model is the source of truth: setting it stores the model, its build provenance and bumps the fingerprint.
const buildMeta = { runId: "build-1", operation: "build-model", provider: "test", model: "builder", thinkingLevel: "low", promptVersion: "decision-v2", structuredOutput: "tool", attempts: 1, durationMs: 10, usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, cost: 0 } } as const;
await task.runtime.ask(tid, { tag: "SetModel", model: scenario, agentMeta: buildMeta, now: "2026-01-01T00:00:01Z" }, taskCategory);
const withModel = await taskState();
assert.ok(withModel.model, "SetModel stores the model");
assert.deepEqual(withModel.modelMeta, buildMeta, "the task preserves the exact AI run that built its model");
assert.equal(withModel.revision, 2, "setting the first model moves the fingerprint");
await task.runtime.ask(tid, { tag: "SetModel", model: scenario, now: "2026-01-01T00:00:02Z" }, taskCategory);
assert.equal((await taskState()).revision, 2, "re-persisting an identical model does not move the fingerprint");

// Editing the model on a fresh task bumps the fingerprint so runs go stale.
const edit = createSingleRuntime(taskAggregate, taskEventCodec, taskStateCodec);
const editId = EntityId("model-edit");
await edit.runtime.ask(editId, { tag: "CreateTask", taskId: "model-edit", text: "seed", factId: "e0", now: "2026-01-01T00:00:00Z" }, taskCategory);
await edit.runtime.ask(editId, { tag: "SetModel", model: scenario, now: "2026-01-01T00:00:01Z" }, taskCategory);
await edit.runtime.ask(editId, { tag: "SetModel", model: { ...scenario, structure: { ...scenario.structure, noise: [0, 0.1] as const } }, now: "2026-01-01T00:00:02Z" }, taskCategory);
const editReply = await edit.runtime.ask(editId, { tag: "GetTask" }, taskCategory);
assert.ok(editReply.ok && editReply.value.reply?.tag === "State" && editReply.value.reply.state.revision === 3, "editing the model moves the fingerprint");
await edit.runtime.shutdown();

// Outcome facts are evidence: they need a model to attach to, and they never move the fingerprint.
const beforeOutcome = (await taskState()).revision;
await task.runtime.ask(tid, { tag: "AddFact", factId: "fact-4", text: "Cooperation collapsed", kind: "outcome", source: "user", observation: { cooperation: 0.1 }, now: "2026-01-01T00:00:04Z" }, taskCategory);
await task.runtime.ask(tid, { tag: "AddFact", factId: "fact-5", text: "The leader came out ahead", kind: "outcome", source: "user", observation: { winner: "Northwind" }, now: "2026-01-01T00:00:05Z" }, taskCategory);
const withOutcomes = await taskState();
assert.equal(withOutcomes.revision, beforeOutcome, "outcome facts do not move the fingerprint");
assert.equal(withOutcomes.facts.filter((fact) => fact.kind === "outcome").length, 2, "outcome facts accumulate");
// A situation statement is no longer a fact — AddFact only accepts outcomes.
const situationRejected = await task.runtime.ask(tid, { tag: "AddFact", factId: "fact-sit", text: "Prices are public", kind: "situation", source: "user", now: "2026-01-01T00:00:06Z" }, taskCategory);
assert.ok(situationRejected.ok && situationRejected.value.reply?.tag === "Rejected", "situation statements are edited in the model, not filed as facts");

const missing = await task.runtime.ask(tid, { tag: "EditFact", factId: "gone", text: "x", now: "2026-01-01T00:00:09Z" }, taskCategory);
assert.ok(missing.ok && missing.value.reply?.tag === "Rejected", "editing a fact that no longer exists is rejected");

// Open questions never block: they can be answered as a fact, or dismissed outright.
await task.runtime.ask(tid, { tag: "SuggestQuestions", questions: [{ id: "q-1", prompt: "How long do they expect this to last?" }, { id: "q-2", prompt: "Who moves first?" }], now: "2026-01-01T00:00:10Z" }, taskCategory);
assert.equal((await taskState()).openQuestions.length, 2, "the agent can raise questions without answering them");
assert.equal((await taskState()).questionsRevision, (await taskState()).revision, "questions are stamped with their context revision");
await task.runtime.ask(tid, { tag: "DismissQuestion", questionId: "q-2", now: "2026-01-01T00:00:11Z" }, taskCategory);
assert.equal((await taskState()).openQuestions.length, 1, "a question can be dismissed");
await task.runtime.ask(tid, { tag: "StartModelBuild", buildId: "build-cancel", revision: (await taskState()).revision, modelMode: "strategic", now: "2026-01-01T00:00:11Z" }, taskCategory);
assert.equal((await taskState()).activeBuild?.modelMode, "strategic", "a strategic build keeps its mode across recovery");
await task.runtime.ask(tid, { tag: "CancelModelBuild", buildId: "build-cancel", now: "2026-01-01T00:00:11Z" }, taskCategory);
assert.equal((await taskState()).activeBuild, undefined, "a model build can be cancelled without leaving the task busy");

const runAgent = { provider: "test", model: "labeler", thinkingLevel: "medium" } as const;
const requestedRevision = (await taskState()).revision;
await task.runtime.ask(tid, { tag: "RequestAnalysis", trials: 10, seed: 42, agent: runAgent, now: "2026-01-01T00:00:12Z" }, taskCategory);
assert.deepEqual((await taskState()).activeAnalysis?.agent, runAgent, "a run keeps its selected labeling model across recovery");
// Building the model is the run's own first step, so it must be allowed while the run is in flight —
// blocking it deadlocks every run that starts from stale facts.
const buildDuringRun = await task.runtime.ask(tid, { tag: "SetModel", model: scenario, now: "2026-01-01T00:00:12Z" }, taskCategory);
assert.ok(buildDuringRun.ok && buildDuringRun.value.reply?.tag === "Accepted", "a run can build its model while running");
const secondRun = await task.runtime.ask(tid, { tag: "RequestAnalysis", trials: 10, seed: 44, now: "2026-01-01T00:00:12Z" }, taskCategory);
assert.ok(secondRun.ok && secondRun.value.reply?.tag === "Rejected", "a second run cannot start while one is in flight");
const calculatedAnalysis = {
  id: "run-check", revision: requestedRevision, trials: 10, seed: 42, report: "calculated",
  visualUrl: "/reports/tasks/run-check.html", completedAt: "2026-01-01T00:00:13Z",
} as TaskAnalysis;
await task.runtime.ask(tid, { tag: "RecordAnalysis", analysis: calculatedAnalysis }, taskCategory);
const labeling = await taskState();
assert.ok(labeling.status === "labeling" && labeling.analyses.length === 1, "a calculated river is saved before AI labeling finishes");
assert.equal(isRunStale(labeling, labeling.analyses[0]!), false, "a run computed from the current facts is not stale");
await task.runtime.ask(tid, { tag: "CompleteAnalysisLabels", analysisId: "run-check", worldLabels: { all: { short: "All worlds", detail: "Every calculated world." } }, now: "2026-01-01T00:00:14Z" }, taskCategory);
assert.equal((await taskState()).status, "completed", "labeling completes the run");

// Editing the model leaves the finished run standing, but marks it stale.
await task.runtime.ask(tid, { tag: "SetModel", model: { ...scenario, structure: { ...scenario.structure, noise: [0, 0.2] as const } }, now: "2026-01-01T00:00:15Z" }, taskCategory);
const staleRun = await taskState();
assert.ok(isRunStale(staleRun, staleRun.analyses[0]!), "editing the model makes the saved run stale");
assert.equal(staleRun.analyses.length, 1, "the stale run is kept, not erased");

await task.runtime.ask(tid, { tag: "RequestAnalysis", trials: 10, seed: 43, now: "2026-01-01T00:00:16Z" }, taskCategory);
await task.runtime.ask(tid, { tag: "CancelAnalysis", now: "2026-01-01T00:00:17Z" }, taskCategory);
const cancelled = await taskState();
assert.ok(cancelled.status === "completed" && !cancelled.activeAnalysis, "cancelling a new run keeps the previous completed river available");
await task.runtime.shutdown();

// A run needs a model; a fresh task has none until one is built.
const nm = createSingleRuntime(taskAggregate, taskEventCodec, taskStateCodec);
const nmId = EntityId("needs-model");
await nm.runtime.ask(nmId, { tag: "CreateTask", taskId: "needs-model", text: "seed", factId: "n0", now: "2026-01-01T00:00:00Z" }, taskCategory);
const noModel = await nm.runtime.ask(nmId, { tag: "RequestAnalysis", trials: 10, seed: 1, now: "2026-01-01T00:00:01Z" }, taskCategory);
assert.ok(noModel.ok && noModel.value.reply?.tag === "Rejected", "a run needs a model");
await nm.runtime.shutdown();

console.log("self-check OK");
