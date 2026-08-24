import { parentPort, workerData } from "node:worker_threads";
import { analyzeScenario, scenarioReport } from "./analysis.js";
import type { ScenarioModel } from "./domain.js";
import { generateWorldsVisual, visibleWorldLabelNodes } from "./worlds-report.js";

interface Work { model: ScenarioModel; trials: number; seed: number }

try {
  const { model, trials, seed } = workerData as Work;
  const result = analyzeScenario(model, trials, seed);
  parentPort?.postMessage({
    ok: true,
    html: generateWorldsVisual(model, trials, seed, result),
    labelNodes: visibleWorldLabelNodes(model, result),
    artifact: { schemaVersion: 1, model, seed, trials: result.trials },
    summary: {
      trials,
      seed,
      report: scenarioReport(result),
      winPct: result.winPct,
      winPctTeam: result.winPctTeam,
      winPctPerCapita: result.winPctPerCapita,
      cooperation: result.cooperation,
      sensitivity: result.sensitivity,
      sensitivityWin: result.sensitivityWin,
      sensitivityWinTarget: result.sensitivityWinTarget,
    },
  });
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
