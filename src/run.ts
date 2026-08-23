import {
  CategoryId, codecWithUpcasts, EntityId, TimerId, andReply, andRun, categoryTypes, persist, reply,
  tagCodec, type Aggregate, type Effect, upcast,
} from "@lambda-house/teob-ts/core";
import { assertRunConfig, normalizeShares, type RunConfig, type Shares } from "./domain.js";
import { stepGeneration, type Generation } from "./kernel.js";

export const KERNEL_VERSION = "1";
export const runCategory = categoryTypes<RunCommand, RunReply>(CategoryId("game-run"));

export type RunStatus = "new" | "running" | "paused" | "finished";

export interface RunState {
  status: RunStatus;
  config?: RunConfig;
  seed?: number;
  generation: number;
  shares: Shares;
  last?: Generation;
}

export type RunCommand =
  | { tag: "StartRun"; config: RunConfig; seed: number }
  | { tag: "StepGeneration"; generation: number }
  | { tag: "Pause" }
  | { tag: "Resume" }
  | { tag: "GetState" };

export type RunEvent =
  | { tag: "RunStarted"; config: RunConfig; seed: number; kernelVersion: string }
  | { tag: "GenerationCompleted"; generation: number; result: Generation }
  | { tag: "RunPaused" }
  | { tag: "RunResumed" }
  | { tag: "RunFinished" };

export type RunReply =
  | { tag: "Accepted" }
  | { tag: "State"; state: RunState }
  | { tag: "Rejected"; reason: string };

const tickTimer = TimerId("next-generation");
const emptyShares = normalizeShares({ trusting: 1 });

function scheduleNext(state: RunState, ctx: { scheduleOnce(id: ReturnType<typeof TimerId>, command: RunCommand, delayMs: number): Promise<void> }): Promise<void> {
  return ctx.scheduleOnce(tickTimer, { tag: "StepGeneration", generation: state.generation }, state.config?.stepDelayMs ?? 0);
}

function reject(reason: string): Promise<Effect<RunEvent, RunReply>> {
  return Promise.resolve(reply({ tag: "Rejected", reason }));
}

export const runAggregate: Aggregate<RunCommand, RunReply, RunEvent, RunState> = {
  category: CategoryId("game-run"),
  initial: (_id: EntityId) => ({ status: "new", generation: 0, shares: emptyShares }),

  async decide(state, command, ctx) {
    switch (command.tag) {
      case "GetState":
        return reply({ tag: "State", state });
      case "StartRun": {
        if (state.status !== "new") return reject("Run already exists");
        try {
          assertRunConfig(command.config);
        } catch (error) {
          return reject(error instanceof Error ? error.message : "Invalid config");
        }
        const effect = andRun(
          persist<RunEvent, RunReply>({ tag: "RunStarted", config: command.config, seed: command.seed, kernelVersion: KERNEL_VERSION }),
          () => scheduleNext({ ...state, status: "running", config: command.config, seed: command.seed, shares: normalizeShares(command.config.initialShares) }, ctx),
        );
        return andReply(effect, { tag: "Accepted" });
      }
      case "StepGeneration": {
        if (state.status !== "running" || !state.config || state.seed === undefined) return reject("Run is not active");
        if (command.generation !== state.generation) return reject("Stale generation tick");
        const result = stepGeneration(state.config, state.shares, state.generation, state.seed);
        const nextGeneration = state.generation + 1;
        const completed: RunEvent = { tag: "GenerationCompleted", generation: nextGeneration, result };
        if (nextGeneration >= state.config.generations) {
          return andReply(persist<RunEvent, RunReply>(completed, { tag: "RunFinished" }), { tag: "Accepted" });
        }
        const effect = andRun(persist<RunEvent, RunReply>(completed), () => scheduleNext({ ...state, generation: nextGeneration, shares: result.shares }, ctx));
        return andReply(effect, { tag: "Accepted" });
      }
      case "Pause": {
        if (state.status !== "running") return reject("Only a running simulation can be paused");
        const effect = andRun(persist<RunEvent, RunReply>({ tag: "RunPaused" }), () => ctx.cancelTimer(tickTimer));
        return andReply(effect, { tag: "Accepted" });
      }
      case "Resume": {
        if (state.status !== "paused") return reject("Only a paused simulation can be resumed");
        const effect = andRun(persist<RunEvent, RunReply>({ tag: "RunResumed" }), () => scheduleNext({ ...state, status: "running" }, ctx));
        return andReply(effect, { tag: "Accepted" });
      }
    }
  },

  apply(state, event) {
    switch (event.tag) {
      case "RunStarted":
        return { status: "running", config: event.config, seed: event.seed, generation: 0, shares: normalizeShares(event.config.initialShares) };
      case "GenerationCompleted":
        return { ...state, generation: event.generation, shares: event.result.shares, last: event.result };
      case "RunPaused":
        return { ...state, status: "paused" };
      case "RunResumed":
        return { ...state, status: "running" };
      case "RunFinished":
        return { ...state, status: "finished" };
    }
  },

  async onRecoveryComplete(state, ctx) {
    if (state.status === "running") await scheduleNext(state, ctx);
  },

  snapshotEvery: 10,
};

const runEventBaseCodec = tagCodec<RunEvent>("RunStarted", "GenerationCompleted", "RunPaused", "RunResumed", "RunFinished");

export const runEventCodec = codecWithUpcasts(runEventBaseCodec, [
  // Phase 0: old journals lack sigma/kernelVersion/config defaults — upcast in place keeps them readable.
  upcast("RunStarted", "RunStarted", (old: unknown) => {
    const o = old as Record<string, unknown>;
    const cfg = (o.config ?? {}) as Record<string, unknown>;
    return {
      ...o,
      kernelVersion: (o.kernelVersion as string) ?? KERNEL_VERSION,
      config: {
        ...cfg,
        sigma: (cfg.sigma as number | undefined) ?? undefined,
        stepDelayMs: (cfg.stepDelayMs as number | undefined) ?? 0,
      },
    };
  }),
]);
