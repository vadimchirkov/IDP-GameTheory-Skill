import assert from "node:assert/strict";
import { CategoryId, EntityId, extractEvents, type EffectControl } from "@lambda-house/teob-ts/core";
import { objectCodec } from "@lambda-house/teob-ts/core";
import { Value } from "typebox/value";
import { createSingleRuntime } from "@lambda-house/teob-ts/inmem";
import { createInMemoryProjectionStore, runProjection } from "@lambda-house/teob-ts/projection";
import { analyzeScenario, replayScenarioWorld } from "./analysis.js";
import { normalizeShares, type RunConfig, type ScenarioModel } from "./domain.js";
import { playMatch, stepGeneration, strategies } from "./kernel.js";
import { Rng } from "./rng.js";
import { runAggregate, runCategory, runEventCodec, type RunCommand, type RunReply, type RunState } from "./run.js";
import { runSummaryProjection, type RunSummaryView } from "./projections.js";
import { participantAggregate, participantCategory, participantEventCodec, participantStateCodec } from "./participant.js";
import { applyTaskEvent, taskAggregate, taskCategory, taskEventCodec, taskStateCodec, type TaskAnalysis, type TaskState } from "./task.js";
import { generateWorldsVisual, injectWorldLabels, visibleWorldLabelNodes } from "./worlds-report.js";
import { normalizeScenarioDraft, proposalOutputSchema, scenarioDraftOutputSchema } from "./agent-contracts.js";
import { parseChatResponse, parseScenarioHints } from "./pi-agent.js";
import { describeScenarioChange } from "./scenario-agent.js";
import { relativeTime } from "../app/src/relative-time.js";

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
assert.equal(Value.Check(proposalOutputSchema, { title: "Проверка", explanation: "Понято", decisions: [], sourceIds: [] }), true, "agent understanding contract accepts a closed result");
assert.equal(Value.Check(proposalOutputSchema, { title: "Проверка", explanation: "Понято", decisions: [], sourceIds: [], extra: true }), false, "agent contracts reject extra fields");
const agentDraft = {
  mode: "shared" as const,
  shared: {
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
  },
  asymmetric: null,
};
assert.equal(Value.Check(scenarioDraftOutputSchema, agentDraft), true, "full Pi model contract is machine-validatable");
assert.deepEqual(normalizeScenarioDraft(agentDraft).players.map((player) => player.name), ["A", "B"]);
assert.deepEqual(parseScenarioHints("1. Кто принимает решение?\n- Какой срок?\n• Что ограничивает выбор?"), ["Кто принимает решение?", "Какой срок?", "Что ограничивает выбор?"]);
assert.deepEqual(parseChatResponse("Main answer.\n<followups>What should we verify next?\nWhich assumption matters most?\nHow could the outcome change?</followups>"), { text: "Main answer.", suggestions: ["What should we verify next?", "Which assumption matters most?", "How could the outcome change?"] });
assert.equal(relativeTime("2026-08-24T10:00:00.000Z", Date.parse("2026-08-24T10:12:00.000Z")), "12m ago");
const analysis = analyzeScenario(scenario, 40, 7);
assert.match(describeScenarioChange(scenario, { ...scenario, players: [...scenario.players, { name: "Observer", dispositions: ["trusting"] }] }), /Added Observer/, "agent model revisions expose participant additions before approval");
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

// ScenarioTask owns editable intent: revision guards prevent a late UI/agent response from overwriting newer work.
const legacyTask: TaskState = { id: "legacy", status: "ready", title: "Legacy", brief: "Legacy", context: [], revision: 1, model: scenario, analyses: [] };
assert.ok(applyTaskEvent(legacyTask, { tag: "ContextAdded", text: "old journal event", revision: 2, now: "2025-01-01T00:00:00Z" }).model, "legacy context events retain their historical model");
const removable = { id: "run-1", visualUrl: "/reports/tasks/run-1.html" } as TaskAnalysis;
assert.equal(applyTaskEvent({ ...legacyTask, status: "completed", analyses: [removable] }, { tag: "AnalysisRemoved", analysisId: "run-1", now: "2025-01-01T00:00:01Z" }).analyses.length, 0, "a saved run can be removed");
assert.equal(applyTaskEvent(legacyTask, { tag: "TaskDeleted", now: "2025-01-01T00:00:02Z" }).deleted, true, "a world can be deleted without rewriting its journal");
const task = createSingleRuntime(taskAggregate, taskEventCodec, taskStateCodec);
const tid = EntityId("task-check");
await task.runtime.ask(tid, { tag: "CreateTask", taskId: "task-check", brief: "Check task workflow", now: "2026-01-01T00:00:00Z" }, taskCategory);
await task.runtime.ask(tid, { tag: "EditBrief", brief: "Updated task workflow", baseRevision: 0, now: "2026-01-01T00:00:00Z" }, taskCategory);
const briefEdited = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
assert.equal(briefEdited.ok && briefEdited.value.reply?.tag === "State" ? briefEdited.value.reply.state.brief : undefined, "Updated task workflow", "the situation text is editable");
const saved = await task.runtime.ask(tid, { tag: "ReplaceModel", model: scenario, baseRevision: 1, now: "2026-01-01T00:00:01Z" }, taskCategory);
assert.ok(saved.ok && saved.value.reply?.tag === "Accepted" && saved.value.reply.revision === 2);
const stale = await task.runtime.ask(tid, { tag: "AddContext", text: "late update", baseRevision: 0, now: "2026-01-01T00:00:02Z" }, taskCategory);
assert.ok(stale.ok && stale.value.reply?.tag === "Rejected" && stale.value.reply.revision === 2, "stale edits are rejected before persistence");
await task.runtime.ask(tid, { tag: "AddContext", text: "first detail", baseRevision: 2, now: "2026-01-01T00:00:03Z" }, taskCategory);
const clarified = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
assert.ok(clarified.ok && clarified.value.reply?.tag === "State" && !clarified.value.reply.state.model, "adding a clarification invalidates the old model");
await task.runtime.ask(tid, { tag: "EditContext", index: 0, text: "updated detail", baseRevision: 3, now: "2026-01-01T00:00:04Z" }, taskCategory);
const edited = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
assert.ok(edited.ok && edited.value.reply?.tag === "State" && edited.value.reply.state.context[0] === "updated detail" && !edited.value.reply.state.model, "editing a clarification invalidates the old model");
await task.runtime.ask(tid, { tag: "ReplaceModel", model: scenario, baseRevision: 4, now: "2026-01-01T00:00:05Z" }, taskCategory);
const runAgent = { provider: "test", model: "labeler", thinkingLevel: "medium" } as const;
await task.runtime.ask(tid, { tag: "RequestAnalysis", trials: 10, seed: 42, agent: runAgent, baseRevision: 5, now: "2026-01-01T00:00:06Z" }, taskCategory);
const requested = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
assert.deepEqual(requested.ok && requested.value.reply?.tag === "State" ? requested.value.reply.state.activeAnalysis?.agent : undefined, runAgent, "a run keeps its selected labeling model across recovery");
const calculatedAnalysis = {
  id: "run-check", revision: 5, trials: 10, seed: 42, report: "calculated",
  visualUrl: "/reports/tasks/run-check.html", completedAt: "2026-01-01T00:00:07Z",
} as TaskAnalysis;
await task.runtime.ask(tid, { tag: "RecordAnalysis", analysis: calculatedAnalysis }, taskCategory);
const labeling = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
assert.ok(labeling.ok && labeling.value.reply?.tag === "State" && labeling.value.reply.state.status === "labeling" && labeling.value.reply.state.analyses.length === 1, "a calculated river is saved before AI labeling finishes");
await task.runtime.ask(tid, { tag: "CompleteAnalysisLabels", analysisId: "run-check", worldLabels: { all: { short: "Все миры", detail: "Все рассчитанные миры." } }, now: "2026-01-01T00:00:08Z" }, taskCategory);
await task.runtime.ask(tid, { tag: "RequestAnalysis", trials: 10, seed: 43, baseRevision: 5, now: "2026-01-01T00:00:09Z" }, taskCategory);
await task.runtime.ask(tid, { tag: "CancelAnalysis", baseRevision: 5, now: "2026-01-01T00:00:10Z" }, taskCategory);
const cancelled = await task.runtime.ask(tid, { tag: "GetTask" }, taskCategory);
assert.ok(cancelled.ok && cancelled.value.reply?.tag === "State" && cancelled.value.reply.state.status === "completed" && !cancelled.value.reply.state.activeAnalysis, "cancelling a new run keeps the previous completed river available");
await task.runtime.shutdown();

console.log("self-check OK");
