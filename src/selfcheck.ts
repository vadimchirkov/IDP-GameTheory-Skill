import assert from "node:assert/strict";
import { CategoryId, EntityId, extractEvents, type EffectControl } from "@lambda-house/teob-ts/core";
import { objectCodec } from "@lambda-house/teob-ts/core";
import { createSingleRuntime } from "@lambda-house/teob-ts/inmem";
import { createInMemoryProjectionStore, runProjection } from "@lambda-house/teob-ts/projection";
import { analyzeScenario } from "./analysis.js";
import { normalizeShares, type RunConfig, type ScenarioModel } from "./domain.js";
import { playMatch, stepGeneration, strategies } from "./kernel.js";
import { Rng } from "./rng.js";
import { runAggregate, runCategory, runEventCodec, type RunCommand, type RunReply, type RunState } from "./run.js";
import { runSummaryProjection, type RunSummaryView } from "./projections.js";

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
const analysis = analyzeScenario(scenario, 40, 7);
assert.equal(analysis.winPct.Shark, 100);

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

console.log("self-check OK");
