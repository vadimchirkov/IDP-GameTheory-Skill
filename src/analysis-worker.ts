import { parentPort, workerData } from "node:worker_threads";
import { analyzeScenario, scenarioReport } from "./analysis.js";
import { KERNEL_VERSION } from "./kernel.js";
import { generateWorldsVisual, visibleWorldLabelNodes } from "./worlds-report.js";
import { generateSimulationReport } from "./generic-report.js";
import { isStochasticProcess, type SimulationModel } from "./model.js";
import { runStochasticProcess } from "./stochastic-process.js";

interface Work { model: SimulationModel; trials: number; seed: number }

try {
  const { model, trials, seed } = workerData as Work;
  if (isStochasticProcess(model)) {
    const result = runStochasticProcess(model, trials, seed);
    const primaryMetric = Object.keys(result.metrics)[0] ?? "";
    const primary = result.metrics[primaryMetric] ?? { mean: 0, std: 0 };
    parentPort?.postMessage({
      ok: true,
      html: generateSimulationReport(model, result),
      labelNodes: [],
      artifact: { schemaVersion: 2, spec: model, seed, worlds: result.worlds },
      summary: {
        trials, seed, kernelVersion: "monte-carlo-v1", adapter: model.adapter,
        report: `${trials} worlds simulated. ${primaryMetric || "Primary metric"}: ${primary.mean.toFixed(2)} (p05 ${result.metrics[primaryMetric]?.p05.toFixed(2) ?? "n/a"}, p95 ${result.metrics[primaryMetric]?.p95.toFixed(2) ?? "n/a"}).`,
        metrics: result.metrics, primaryMetric, paths: result.paths,
        winPct: {}, winPctTeam: {}, winPctPerCapita: {}, cooperation: { mean: primary.mean, std: primary.std },
        sensitivity: result.sensitivity[primaryMetric] ?? [], sensitivityWin: [], sensitivityWinTarget: "",
      },
    });
  } else {
  const result = analyzeScenario(model, trials, seed);
  parentPort?.postMessage({
    ok: true,
    html: generateWorldsVisual(model, trials, seed, result),
    labelNodes: visibleWorldLabelNodes(model, result),
    artifact: { schemaVersion: 1, kernelVersion: KERNEL_VERSION, model, seed, trials: result.trials },
    summary: {
      trials,
      seed,
      kernelVersion: KERNEL_VERSION,
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
  }
} catch (error) {
  parentPort?.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
