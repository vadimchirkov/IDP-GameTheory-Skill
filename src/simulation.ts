import { correlation, mean, runMonteCarlo, standardDeviation } from "./monte-carlo.js";
import type { Rng } from "./rng.js";
import { sampleTopology, type Topology, type TopologyPrior } from "./topology.js";

export interface SimulationSpec<M = unknown> {
  schemaVersion: 1;
  adapter: string;
  situation: string;
  model: M;
  topology: TopologyPrior;
}

export interface WorldSample<P = unknown> {
  inputs: Record<string, number>;
  metrics: Record<string, number>;
  path: readonly string[];
  payload: P;
}

export interface SimulatedWorld<P = unknown> extends WorldSample<P> {
  index: number;
  seed: number;
  topology: Topology;
}

export interface SimulationAdapter<M, P = unknown> {
  id: string;
  validate(model: M, topology: TopologyPrior): void;
  simulate(model: M, topology: Topology, rng: Rng): WorldSample<P>;
}

export interface MetricSummary {
  mean: number;
  std: number;
  min: number;
  max: number;
  p05: number;
  p50: number;
  p95: number;
}

export interface SimulationRun<P = unknown> {
  worlds: readonly SimulatedWorld<P>[];
  metrics: Record<string, MetricSummary>;
  paths: Record<string, number>;
  sensitivity: Record<string, readonly { input: string; correlation: number }[]>;
}

export interface SimulationArtifact<M = unknown, P = unknown> {
  schemaVersion: 2;
  spec: SimulationSpec<M>;
  seed: number;
  worlds: readonly SimulatedWorld<P>[];
}

const quantile = (sorted: readonly number[], fraction: number): number => {
  const position = (sorted.length - 1) * fraction;
  const low = Math.floor(position), high = Math.ceil(position);
  const a = sorted[low]!, b = sorted[high]!;
  return a + (b - a) * (position - low);
};

export function summarizeWorlds<P>(worlds: readonly SimulatedWorld<P>[]): Omit<SimulationRun<P>, "worlds"> {
  if (!worlds.length) throw new Error("cannot summarize an empty simulation");
  const metricIds = [...new Set(worlds.flatMap((world) => Object.keys(world.metrics)))];
  const inputIds = [...new Set(worlds.flatMap((world) => Object.keys(world.inputs)))];
  const metrics: Record<string, MetricSummary> = {};
  const sensitivity: SimulationRun<P>["sensitivity"] = {};
  for (const id of metricIds) {
    const values = worlds.map((world) => world.metrics[id] ?? 0);
    const sorted = [...values].sort((a, b) => a - b);
    metrics[id] = {
      mean: mean(values), std: standardDeviation(values), min: sorted[0]!, max: sorted.at(-1)!,
      p05: quantile(sorted, 0.05), p50: quantile(sorted, 0.5), p95: quantile(sorted, 0.95),
    };
    sensitivity[id] = inputIds.map((input) => ({
      input,
      correlation: correlation(worlds.map((world) => world.inputs[input] ?? 0), values),
    })).sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));
  }
  const paths: Record<string, number> = {};
  for (const world of worlds) {
    const key = world.path.join(" → ");
    paths[key] = (paths[key] ?? 0) + 1;
  }
  return { metrics, paths, sensitivity };
}

export function runSimulation<M, P>(
  spec: SimulationSpec<M>,
  adapter: SimulationAdapter<M, P>,
  trials: number,
  seed: number,
): SimulationRun<P> {
  if (spec.adapter !== adapter.id) throw new Error(`adapter ${adapter.id} cannot run ${spec.adapter}`);
  adapter.validate(spec.model, spec.topology);
  const worlds = runMonteCarlo(trials, seed, (rng, worldSeed, index) => {
    const topology = sampleTopology(spec.topology, rng);
    const sample = adapter.simulate(spec.model, topology, rng);
    for (const [id, value] of [...Object.entries(sample.inputs), ...Object.entries(sample.metrics)]) {
      if (!Number.isFinite(value)) throw new Error(`world ${index} produced non-finite ${id}`);
    }
    return { ...sample, index, seed: worldSeed, topology };
  });
  return { worlds, ...summarizeWorlds(worlds) };
}
