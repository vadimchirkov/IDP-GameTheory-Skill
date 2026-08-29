import { assertScenario, type ScenarioModel } from "./domain.js";
import { assertDecisionModel, type DecisionModel } from "./decision.js";
import { assertStochasticProcess, type StochasticProcessSpec } from "./stochastic-process.js";
import { assertPolymarket, type PolymarketSpec } from "./polymarket.js";

export type SimulationModel = DecisionModel | ScenarioModel | StochasticProcessSpec | PolymarketSpec;

export function isDecisionModel(model: SimulationModel | unknown): model is DecisionModel {
  return !!model && typeof model === "object" && (model as { adapter?: unknown }).adapter === "decision";
}

export function isStochasticProcess(model: SimulationModel | unknown): model is StochasticProcessSpec {
  return !!model && typeof model === "object" && (model as { adapter?: unknown }).adapter === "stochastic-process";
}

export function isPolymarket(model: SimulationModel | unknown): model is PolymarketSpec {
  return !!model && typeof model === "object" && (model as { adapter?: unknown }).adapter === "polymarket";
}

export function assertSimulationModel(model: SimulationModel): void {
  if (isDecisionModel(model)) assertDecisionModel(model);
  else if (isStochasticProcess(model)) assertStochasticProcess(model.model, model.topology);
  else if (isPolymarket(model)) assertPolymarket(model.model, model.topology);
  else assertScenario(model);
}

export function simulationSituation(model: SimulationModel): string {
  return model.situation;
}
