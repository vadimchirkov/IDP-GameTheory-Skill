import assert from "node:assert/strict";
import { CategoryId, EntityId, extractEvents, type EffectControl } from "@lambda-house/teob-ts/core";
import { objectCodec } from "@lambda-house/teob-ts/core";
import { Value } from "typebox/value";
import { createSingleRuntime } from "@lambda-house/teob-ts/inmem";
import { createInMemoryProjectionStore, runProjection } from "@lambda-house/teob-ts/projection";
import { analyzeScenario, replayScenarioWorld } from "./analysis.js";
import { normalizeShares, type RunConfig, type ScenarioModel } from "./domain.js";
import { KERNEL_VERSION, playMatch, stepGeneration, strategies } from "./kernel.js";
import { Rng } from "./rng.js";
import { runAggregate, runCategory, runEventCodec, type RunCommand, type RunReply, type RunState } from "./run.js";
import { runSummaryProjection, type RunSummaryView } from "./projections.js";
import { participantAggregate, participantCategory, participantEventCodec, participantStateCodec } from "./participant.js";
import { applyTaskEvent, isRunStale, taskAggregate, taskCategory, taskEventCodec, taskStateCodec, type TaskAnalysis, type TaskEvent, type TaskState } from "./task.js";
import { generateWorldsVisual, injectWorldLabels, visibleWorldLabelNodes } from "./worlds-report.js";
import { contextReplyOutputSchema, normalizeScenarioCoreDraft, normalizeScenarioDraft, researchPlanOutputSchema, scenarioDraftOutputSchema, understandingOutputSchema } from "./agent-contracts.js";
import { parseChatResponse, parseScenarioHints, parseStructuredJson } from "./pi-agent.js";
import { relativeTime } from "../app/src/relative-time.js";
import { openPublicPage } from "./web-research.js";

const payoff = { T: 5, R: 3, P: 1, S: 0 };
const config: RunConfig = {
  game: "prisoners_dilemma",
  payoff,
  rounds: 30,
  matchReps: 2,
  noise: 0,
  initialShares: { trusting: 0.5, exploitative: 0.5 },
  generations: 3,
  rule: "replicator",
  populationSize: 40,
  stepDelayMs: 1,
};

const match = playMatch(strategies.exploitative, strategies.trusting, payoff, payoff, 20, 0, new Rng(1));
assert.equal(match.scoreA, 100);
assert.equal(match.scoreB, 0);

const scenario: ScenarioModel = {
  situation: "exploit check",
  players: [
    { name: "Shark", dispositions: ["exploitative"] },
    { name: "Mark", dispositions: ["trusting"] },
  ],
  payoffs: { T: [5, 5], R: [3, 3], P: [1, 1], S: [0, 0] },
  structure: { w: [0.9, 0.9], noise: [0, 0] },
};
assert.equal(Value.Check(understandingOutputSchema, { title: "Supply standoff", questions: [{ prompt: "How long will it last?", field: "structure.w" }] }), true, "the understanding contract accepts a closed result");
assert.equal(Value.Check(understandingOutputSchema, { title: "Supply standoff", questions: [], extra: true }), false, "agent contracts reject extra fields");
assert.deepEqual(parseStructuredJson('```json\n{"title":"Supply standoff","questions":[]}\n```', understandingOutputSchema), { title: "Supply standoff", questions: [] }, "JSON fallback accepts a fenced provider response");
assert.throws(() => parseStructuredJson('{"title":"Supply standoff","questions":[],"extra":true}', understandingOutputSchema), /does not match/, "JSON fallback still enforces the canonical schema");
assert.equal(Value.Check(contextReplyOutputSchema, { kind: "answer", message: "Проверю открытые источники.", suggestions: ["Show me the strongest source", "What remains uncertain?"], contextNote: null, title: "Проверка", researchQueries: [{ query: "public market data", field: "payoffs", purpose: "Ground market conditions" }], questions: [] }), true, "context turns can request bounded public research");
assert.equal(Value.Check(researchPlanOutputSchema, { completionMessage: "Модель собрана; проверьте допущения.", queries: [], questions: [] }), true, "model builds carry a same-language completion message");
await assert.rejects(() => openPublicPage("http://127.0.0.1/private"), /Private hosts/, "public research cannot reach loopback services");
const agentDraft = {
  situation: "contract check",
  game: "prisoners_dilemma" as const,
  players: [
    { name: "A", dispositions: ["provocable" as const], team: null, values: null, betrayalProb: null, memory: null, note: "" },
    { name: "B", dispositions: ["exploitative" as const], team: null, values: null, betrayalProb: null, memory: null, note: "" },
  ],
  structure: { w: { min: 0.8, max: 0.9 }, noise: { min: 0, max: 0.05 }, drift: null, sigma: null, eco: null, transitions: null, reputation: null, punishment: null, cheapTalk: null },
  topology: null,
  rationale: [],
  payoffs: { T: { min: 5, max: 6 }, R: { min: 3, max: 4 }, P: { min: 1, max: 2 }, S: { min: 0, max: 1 } },
};
assert.equal(Value.Check(scenarioDraftOutputSchema, agentDraft), true, "full Pi model contract is machine-validatable");
assert.deepEqual(normalizeScenarioDraft(agentDraft).players.map((player) => player.name), ["A", "B"]);
const repairedPayoffs = normalizeScenarioCoreDraft({
  game: "prisoners_dilemma",
  players: [{ name: "Symbioen", dispositions: ["provocable"], note: "" }, { name: "CPO", dispositions: ["exploitative"], note: "" }],
  w: { min: 0.6, max: 0.8 }, noise: { min: 0.03, max: 0.12 }, rationale: [],
  payoffs: [
    { player: "Symbioen", payoffs: { T: { min: 1, max: 2 }, R: { min: 4, max: 5 }, P: { min: 2, max: 3 }, S: { min: 3, max: 4 } } },
    { player: "CPO", payoffs: { T: { min: 4, max: 6 }, R: { min: 2, max: 3 }, P: { min: 0, max: 1 }, S: { min: -3, max: -0.5 } } },
  ],
}, "charging reliability");
assert.doesNotThrow(() => analyzeScenario(repairedPayoffs, 2, 1), "invalid agent payoff ranges are normalized before simulation");
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
assert.ok(labeledRiver.includes("if(!drag.captured){wrap.setPointerCapture"), "river dragging captures the pointer only after movement, preserving branch clicks");
assert.ok(labeledRiver.includes("user-select:none;-webkit-user-select:none"), "river text stays inert while nodes and flows remain selectable");
assert.ok(labeledRiver.includes('id="river-stage"') && labeledRiver.includes("wrap.scrollTo({left:CANVAS_W*zoom/2"), "river reports center the graph inside a pannable stage");
assert.ok(labeledRiver.includes("group.classList.toggle('active',selectedNode)"), "selected nodes are highlighted on the node itself");
assert.ok(labeledRiver.includes("labelGuard.onclick=event=>event.stopPropagation()"), "node labels explain selection without selecting objects behind them");
assert.ok(labeledRiver.includes("nodeGap=50") && labeledRiver.includes("svg.append(labelLayer)"), "river labels stay beside their nodes and render above the flows");
const firstWorld = analysis.trials[0];
assert.ok(firstWorld);
const replayedWorld = replayScenarioWorld(scenario, 7, 0, firstWorld.digest.pivotalPair);
assert.deepEqual(replayedWorld.digest, analysis.trials[0]?.digest, "a river world replays independently from its recorded seed");
assert.equal(replayedWorld.trace?.matches.length, 1, "replay retains only the requested pivotal match trace");

const first = stepGeneration(config, normalizeShares({ exploitative: 0.5, trusting: 0.5 }), 0, 42);
assert.ok(first.shares.exploitative > first.shares.trusting);

const noOpContext: EffectControl<RunCommand, RunReply> = {
  entityId: EntityId("check"), categoryId: CategoryId("game-run"),
  async tellSelf() {}, async tell() {}, async ask() { return { ok: true, value: undefined }; },
  async scheduleOnce() {}, async schedulePeriodic() {}, async cancelTimer() {}, log() {}, async sync() {},
};
const initial = runAggregate.initial(EntityId("check"));
const startEffect = await runAggregate.decide(initial, { tag: "StartRun", config, seed: 42 }, noOpContext);
const startEvents = extractEvents(startEffect);
assert.deepEqual(startEvents.map((event) => event.tag), ["RunStarted"]);
// Provenance: the engine version is stamped from a single source (kernel) onto the event that fixes a run.
assert.equal((startEvents[0] as { kernelVersion?: string }).kernelVersion, KERNEL_VERSION, "RunStarted records the engine version that will reproduce it");
assert.ok(KERNEL_VERSION.length > 0, "engine version is non-empty");
const started = startEvents.reduce((state, event) => runAggregate.apply(state, event), initial);
const stepEffect = await runAggregate.decide(started, { tag: "StepGeneration", generation: 0 }, noOpContext);
const stepped = extractEvents(stepEffect).reduce((state, event) => runAggregate.apply(state, event), started);
assert.equal(stepped.generation, 1);

const { runtime, journal } = createSingleRuntime(runAggregate, runEventCodec, objectCodec<RunState>("RunState"));
await runtime.ask(EntityId("runtime-check"), { tag: "StartRun", config: { ...config, generations: 2 }, seed: 9 }, runCategory);
await new Promise((resolve) => setTimeout(resolve, 25));
const stateReply = await runtime.ask(EntityId("runtime-check"), { tag: "GetState" }, runCategory);
assert.ok(stateReply.ok && stateReply.value.reply?.tag === "State");
if (stateReply.ok && stateReply.value.reply?.tag === "State") assert.equal(stateReply.value.reply.state.status, "finished");
const projectionStore = createInMemoryProjectionStore();
runProjection(runSummaryProjection, journal, projectionStore, { eventCodec: runEventCodec });
assert.equal(projectionStore.get<RunSummaryView>("run-summary", "runtime-check")?.view.status, "finished");
await runtime.shutdown();

// Participant aggregate — event-sourced per-player worldview (Initialize → RequestMove → ReceiveOutcome → GetState).
const participant = createSingleRuntime(participantAggregate, participantEventCodec, participantStateCodec);
const pid = EntityId("A");
await participant.runtime.ask(pid, { tag: "Initialize", playerName: "A", dispositions: ["provocable"], lean: 0, drift: 0, seed: 7 }, participantCategory);
const moveReply = await participant.runtime.ask(pid, { tag: "RequestMove", round: 0, opponentId: "B" }, participantCategory);
assert.ok(moveReply.ok && moveReply.value.reply?.tag === "Move" && moveReply.value.reply.move === "C", "provocable opens with C");
await participant.runtime.ask(pid, { tag: "ReceiveOutcome", round: 0, opponentId: "B", myMove: "C", oppMove: "D", payoff: 0, w: 0.9 }, participantCategory);
const pState = await participant.runtime.ask(pid, { tag: "GetState" }, participantCategory);
assert.ok(pState.ok && pState.value.reply?.tag === "State", "participant returns its state");
if (pState.ok && pState.value.reply?.tag === "State") {
  const s = pState.value.reply.state;
  assert.deepEqual(s.historyOpp.B, ["D"], "opponent's defection is recorded in the journal");
  assert.equal(s.reputation.image.B, "B", "stern-judging marks a defector Bad");
}
await participant.runtime.shutdown();

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

// The model is the source of truth: setting it stores the model and bumps the fingerprint.
await task.runtime.ask(tid, { tag: "SetModel", model: scenario, now: "2026-01-01T00:00:01Z" }, taskCategory);
const withModel = await taskState();
assert.ok(withModel.model, "SetModel stores the model");
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
await task.runtime.ask(tid, { tag: "StartModelBuild", buildId: "build-cancel", revision: (await taskState()).revision, now: "2026-01-01T00:00:11Z" }, taskCategory);
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
