import { assertScenario, type ScenarioModel } from "./domain.js";
import { assertDecisionModel, type DecisionModel } from "./adapters/decision.js";

/** Decision comparison is the product default; a ScenarioModel is the repeated C/D interaction. */
export type SimulationModel = DecisionModel | ScenarioModel;

export function isDecisionModel(model: SimulationModel | unknown): model is DecisionModel {
  return !!model && typeof model === "object" && (model as { adapter?: unknown }).adapter === "decision";
}

export function assertSimulationModel(model: SimulationModel): void {
  if (isDecisionModel(model)) assertDecisionModel(model);
  else assertScenario(model);
}
