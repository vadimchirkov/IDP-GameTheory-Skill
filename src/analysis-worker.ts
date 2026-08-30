import { parentPort, workerData } from "node:worker_threads";
import { analyzeScenario, scenarioReport } from "./adapters/repeated-game.js";
import { KERNEL_VERSION } from "./kernel.js";
import { generateWorldsVisual, visibleWorldLabelNodes } from "./worlds-report.js";
import { generateSimulationReport } from "./generic-report.js";
import { generateDecisionReport } from "./decision-report.js";
import { runDecision } from "./adapters/decision.js";
import { isDecisionModel, isPolymarket, isStochasticProcess, type SimulationModel } from "./model.js";
import { runStochasticProcess } from "./adapters/stochastic-process.js";
import { runPolymarket } from "./adapters/polymarket.js";

interface Work { model: SimulationModel; trials: number; seed: number }

try {
  const { model, trials, seed } = workerData as Work;
  if (isDecisionModel(model)) {
    const result = runDecision(model, trials, seed);
    const recommended = result.options[result.recommendedOptionId]!;
    const recommendedLabel = model.options.find((option) => option.id === result.recommendedOptionId)?.label ?? result.recommendedOptionId;
    const recommendationReason = result.recommendation.criterion === "targetProbability"
      ? `${Math.round(recommended.targetProbability! * 100)}% target chance`
      : `${recommended.meanRegret.toFixed(2)} average regret`;
    parentPort?.postMessage({
      ok: true,
      html: generateDecisionReport(model, result),
      labelNodes: [],
      artifact: { schemaVersion: 3, model, seed, worlds: result.worlds },
      summary: {
        trials, seed, kernelVersion: "decision-v1", adapter: model.adapter,
        report: `${recommendedLabel} ${result.recommendation.close ? "leads a close result" : "leads"} by ${recommendationReason}.`,
        paths: result.paths,
        decision: { recommendedOptionId: result.recommendedOptionId, recommendedOptionLabel: recommendedLabel, options: result.options, recommendation: result.recommendation, driver: result.driver, stress: result.stress, ...(result.failureBox ? { failureBox: result.failureBox } : {}) },
        winPct: Object.fromEntries(model.options.map((option) => [option.label, result.options[option.id]!.bestProbability * 100])),
        winPctTeam: {}, winPctPerCapita: {}, cooperation: { mean: recommended.p50, std: recommended.std },
        sensitivity: [{ input: result.driver.factorId, correlation: result.driver.correlation }], sensitivityWin: [], sensitivityWinTarget: result.recommendedOptionId,
      },
    });
  } else if (isStochasticProcess(model)) {
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
  } else if (isPolymarket(model)) {
    const result = runPolymarket(model, trials, seed);
    const primaryMetric = "ev.best";
    const primary = result.metrics[primaryMetric] ?? { mean: 0, std: 0, p05: 0, p95: 0 } as any;
    const bestPos = [...model.model.positions].sort((a,b)=>{
      const av = result.metrics[`pnl.${a.id}`]?.mean ?? 0;
      const bv = result.metrics[`pnl.${b.id}`]?.mean ?? 0;
      return bv-av;
    })[0];
    parentPort?.postMessage({
      ok: true,
      html: generateSimulationReport(model, result),
      labelNodes: [],
      artifact: { schemaVersion: 2, spec: model, seed, worlds: result.worlds },
      summary: {
        trials, seed, kernelVersion: "polymarket-v1", adapter: model.adapter,
        report: `${trials} worlds. Best position ${bestPos?.label ?? bestPos?.id ?? "n/a"} ev ${(result.metrics[`pnl.${bestPos?.id}`]?.mean ?? 0).toFixed(2)} (roi ${((result.metrics[`roi.${bestPos?.id}`]?.mean ?? 0)*100).toFixed(1)}%). Best-any ev ${primary.mean.toFixed(2)} p05 ${primary.p05.toFixed(2)} p95 ${primary.p95.toFixed(2)}.`,
        metrics: result.metrics, primaryMetric, paths: result.paths,
        winPct: Object.fromEntries(model.model.positions.map(p=>[p.label ?? p.id, (result.worlds.filter(w=> (w.payload as any).bestPositionId===p.id).length/trials)*100])),
        winPctTeam: {}, winPctPerCapita: {}, cooperation: { mean: primary.mean, std: primary.std },
        sensitivity: result.sensitivity[primaryMetric] ?? [], sensitivityWin: [], sensitivityWinTarget: bestPos?.id ?? "",
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
