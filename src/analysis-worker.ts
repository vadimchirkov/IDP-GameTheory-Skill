import { parentPort, workerData } from "node:worker_threads";
import { analyzeScenario, scenarioReport } from "./adapters/repeated-game.js";
import { KERNEL_VERSION } from "./kernel.js";
import { visibleWorldLabelNodes } from "./worlds-report.js";
import { runDecision } from "./adapters/decision.js";
import { isDecisionModel, type SimulationModel } from "./model.js";

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
      labelNodes: [],
      artifact: { schemaVersion: 3, model, seed, worlds: result.worlds },
      summary: {
        trials, seed, kernelVersion: "decision-v1", adapter: model.adapter,
        report: `${recommendedLabel} ${result.recommendation.close ? "leads a close result" : "leads"} by ${recommendationReason}.`,
        paths: result.paths,
        decision: { recommendedOptionId: result.recommendedOptionId, recommendedOptionLabel: recommendedLabel, options: result.options, recommendation: result.recommendation, driver: result.driver, stress: result.stress, ...(result.failureBox ? { failureBox: result.failureBox } : {}), ...(result.jointEffects ? { jointEffects: result.jointEffects } : {}) },
        winPct: Object.fromEntries(model.options.map((option) => [option.label, result.options[option.id]!.bestProbability * 100])),
        winPctTeam: {}, winPctPerCapita: {}, cooperation: { mean: recommended.p50, std: recommended.std },
        sensitivity: [{ input: result.driver.factorId, correlation: result.driver.correlation }], sensitivityWin: [], sensitivityWinTarget: result.recommendedOptionId,
      },
    });
  } else {
    const result = analyzeScenario(model, trials, seed);
    parentPort?.postMessage({
      ok: true,
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
