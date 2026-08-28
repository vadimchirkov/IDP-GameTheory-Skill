import { assertScenario, type ScenarioModel } from "./domain.js";
import { assertStochasticProcess, type StochasticProcessSpec } from "./stochastic-process.js";

export type SimulationModel = ScenarioModel | StochasticProcessSpec;

export function isStochasticProcess(model: SimulationModel | unknown): model is StochasticProcessSpec {
  return !!model && typeof model === "object" && (model as { adapter?: unknown }).adapter === "stochastic-process";
}

export function assertSimulationModel(model: SimulationModel): void {
  if (isStochasticProcess(model)) assertStochasticProcess(model.model, model.topology);
  else assertScenario(model);
}

export function simulationSituation(model: SimulationModel): string {
  return model.situation;
}
