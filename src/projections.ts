import { projection } from "@lambda-house/teob-ts/projection";
import type { Generation } from "./kernel.js";
import type { RunEvent, RunStatus } from "./run.js";

export interface RunSummaryView {
  status: RunStatus;
  generation: number;
  last?: Generation;
}

export const runSummaryProjection = projection<RunEvent, RunSummaryView>({
  projectionId: "run-summary",
  category: "game-run",
  initialState: () => ({ status: "new", generation: 0 }),
  evolve: (view, event) => {
    switch (event.tag) {
      case "RunStarted": return { status: "running", generation: 0 };
      case "GenerationCompleted": return { ...view, generation: event.generation, last: event.result };
      case "RunPaused": return { ...view, status: "paused" };
      case "RunResumed": return { ...view, status: "running" };
      case "RunFinished": return { ...view, status: "finished" };
    }
  },
});

export interface StrategyPoint {
  generation: number;
  shares: Generation["shares"];
  cooperationRate: number;
}

export const strategySeriesProjection = projection<RunEvent, StrategyPoint[]>({
  projectionId: "strategy-series",
  category: "game-run",
  initialState: () => [],
  evolve: (view, event) => event.tag === "GenerationCompleted"
    ? [...view, { generation: event.generation, shares: event.result.shares, cooperationRate: event.result.cooperationRate }]
    : view,
});
