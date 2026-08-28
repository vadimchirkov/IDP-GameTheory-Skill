import type { Rng } from "./rng.js";
import { runSimulation, type SimulationAdapter, type SimulationSpec, type WorldSample } from "./simulation.js";
import { assertTopologyPrior, type NumberRange, type Topology, type TopologyPrior } from "./topology.js";

export interface ProcessNode {
  id: string;
  label?: string;
  initial: NumberRange;
  drift?: NumberRange;
  volatility?: NumberRange;
}

export interface ProcessShock {
  id: string;
  probability: NumberRange;
  delta: NumberRange;
  nodes?: readonly string[];
}

export interface ProcessMetric {
  id: string;
  kind: "mean" | "sum" | "min" | "max" | "above" | "below";
  threshold?: number;
}

export interface StochasticProcessModel {
  horizon: NumberRange;
  bounds: NumberRange;
  nodes: readonly ProcessNode[];
  interactionRate?: NumberRange;
  shocks?: readonly ProcessShock[];
  metrics?: readonly ProcessMetric[];
}

export interface ProcessWorld {
  steps: number;
  initial: Record<string, number>;
  final: Record<string, number>;
}

export type StochasticProcessSpec = SimulationSpec<StochasticProcessModel> & { adapter: "stochastic-process" };

const assertRange = (value: NumberRange, label: string): void => {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || value[0] > value[1]) {
    throw new Error(`${label} must be an ordered finite range`);
  }
};

export function assertStochasticProcess(model: StochasticProcessModel, topology: TopologyPrior): void {
  assertTopologyPrior(topology);
  assertRange(model.horizon, "horizon");
  if (!Number.isInteger(model.horizon[0]) || !Number.isInteger(model.horizon[1]) || model.horizon[0] < 1) throw new Error("horizon must contain positive integers");
  assertRange(model.bounds, "bounds");
  if (!model.nodes.length) throw new Error("a stochastic process needs at least one node");
  const ids = new Set<string>();
  for (const node of model.nodes) {
    if (!node.id || ids.has(node.id)) throw new Error("process node ids must be unique and non-empty");
    ids.add(node.id);
    assertRange(node.initial, `${node.id}.initial`);
    if (node.initial[0] < model.bounds[0] || node.initial[1] > model.bounds[1]) throw new Error(`${node.id}.initial must stay within bounds`);
    if (node.drift) assertRange(node.drift, `${node.id}.drift`);
    if (node.volatility) {
      assertRange(node.volatility, `${node.id}.volatility`);
      if (node.volatility[0] < 0) throw new Error(`${node.id}.volatility must be non-negative`);
    }
  }
  if (topology.nodes.length !== ids.size || topology.nodes.some((id) => !ids.has(id))) throw new Error("process and topology must contain the same nodes");
  if (model.interactionRate) {
    assertRange(model.interactionRate, "interactionRate");
    if (model.interactionRate[0] < 0 || model.interactionRate[1] > 1) throw new Error("interactionRate must stay within 0..1");
  }
  const shockIds = new Set<string>();
  for (const shock of model.shocks ?? []) {
    if (!shock.id || shockIds.has(shock.id)) throw new Error("shock ids must be unique and non-empty");
    shockIds.add(shock.id);
    assertRange(shock.probability, `${shock.id}.probability`);
    if (shock.probability[0] < 0 || shock.probability[1] > 1) throw new Error(`${shock.id}.probability must stay within 0..1`);
    assertRange(shock.delta, `${shock.id}.delta`);
    if (shock.nodes?.some((id) => !ids.has(id))) throw new Error(`${shock.id} references an unknown node`);
  }
  const metricIds = new Set<string>();
  for (const metric of model.metrics ?? []) {
    if (!metric.id || metricIds.has(metric.id)) throw new Error("metric ids must be unique and non-empty");
    metricIds.add(metric.id);
    if ((metric.kind === "above" || metric.kind === "below") && !Number.isFinite(metric.threshold)) throw new Error(`${metric.id} needs a finite threshold`);
  }
}

const sample = (range: NumberRange | undefined, fallback: number, rng: Rng): number => range ? (range[0] === range[1] ? range[0] : rng.between(range)) : fallback;
const clamp = (value: number, bounds: NumberRange): number => Math.max(bounds[0], Math.min(bounds[1], value));
const aggregate = (values: readonly number[], metric: ProcessMetric): number => {
  if (metric.kind === "sum") return values.reduce((sum, value) => sum + value, 0);
  if (metric.kind === "min") return Math.min(...values);
  if (metric.kind === "max") return Math.max(...values);
  if (metric.kind === "above") return values.filter((value) => value > metric.threshold!).length;
  if (metric.kind === "below") return values.filter((value) => value < metric.threshold!).length;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};
const band = (value: number, bounds: NumberRange): string => {
  const share = bounds[1] === bounds[0] ? 0.5 : (value - bounds[0]) / (bounds[1] - bounds[0]);
  return share < 1 / 3 ? "low" : share > 2 / 3 ? "high" : "middle";
};

export const stochasticProcessAdapter: SimulationAdapter<StochasticProcessModel, ProcessWorld> = {
  id: "stochastic-process",
  validate: assertStochasticProcess,
  simulate(model, topology, rng): WorldSample<ProcessWorld> {
    const steps = Math.floor(sample([model.horizon[0], model.horizon[1] + 1], model.horizon[0], rng));
    const interactionRate = sample(model.interactionRate, 0, rng);
    const drift = Object.fromEntries(model.nodes.map((node) => [node.id, sample(node.drift, 0, rng)]));
    const volatility = Object.fromEntries(model.nodes.map((node) => [node.id, sample(node.volatility, 0, rng)]));
    const shockProbability = Object.fromEntries((model.shocks ?? []).map((shock) => [shock.id, sample(shock.probability, 0, rng)]));
    const state = Object.fromEntries(model.nodes.map((node) => [node.id, sample(node.initial, 0, rng)]));
    const initial = { ...state };
    let midpoint = { ...state };
    for (let step = 0; step < steps; step += 1) {
      const delta = Object.fromEntries(model.nodes.map((node) => [node.id, drift[node.id]! + (rng.unit() * 2 - 1) * volatility[node.id]!]));
      if (interactionRate > 0) for (const interaction of topology.interactions) {
        const average = interaction.participants.reduce((sum, id) => sum + state[id]!, 0) / interaction.participants.length;
        for (const id of interaction.participants) delta[id] = (delta[id] ?? 0) + (average - state[id]!) * interactionRate * interaction.weight;
      }
      for (const shock of model.shocks ?? []) for (const id of shock.nodes ?? topology.nodes) {
        if (rng.unit() < shockProbability[shock.id]!) delta[id] = (delta[id] ?? 0) + sample(shock.delta, 0, rng);
      }
      for (const id of topology.nodes) state[id] = clamp(state[id]! + (delta[id] ?? 0), model.bounds);
      if (step + 1 === Math.ceil(steps / 2)) midpoint = { ...state };
    }
    const values = Object.values(state);
    const definitions = model.metrics?.length ? model.metrics : [{ id: "final_mean", kind: "mean" as const }, { id: "final_min", kind: "min" as const }, { id: "final_max", kind: "max" as const }];
    const metrics = Object.fromEntries(definitions.map((metric) => [metric.id, aggregate(values, metric)]));
    const average = (snapshot: Record<string, number>) => Object.values(snapshot).reduce((sum, value) => sum + value, 0) / Object.keys(snapshot).length;
    const inputs: Record<string, number> = { steps, interactionRate };
    for (const node of model.nodes) { inputs[`initial.${node.id}`] = initial[node.id]!; inputs[`drift.${node.id}`] = drift[node.id]!; inputs[`volatility.${node.id}`] = volatility[node.id]!; }
    for (const shock of model.shocks ?? []) inputs[`shock.${shock.id}`] = shockProbability[shock.id]!;
    return {
      inputs, metrics,
      path: [`start:${band(average(initial), model.bounds)}`, `middle:${band(average(midpoint), model.bounds)}`, `end:${band(average(state), model.bounds)}`],
      payload: { steps, initial, final: state },
    };
  },
};

export function runStochasticProcess(spec: StochasticProcessSpec, trials: number, seed: number) {
  return runSimulation(spec, stochasticProcessAdapter, trials, seed);
}
