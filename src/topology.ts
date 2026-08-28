import { Rng } from "./rng.js";

export type NumberRange = readonly [number, number];

export interface Interaction {
  id: string;
  participants: readonly string[];
  weight: number;
}

export interface Topology {
  nodes: readonly string[];
  interactions: readonly Interaction[];
}

export interface InteractionPrior {
  id: string;
  participants: readonly string[];
  probability?: NumberRange;
  weight?: NumberRange;
}

export interface TopologyPrior {
  nodes: readonly string[];
  interactions: readonly InteractionPrior[];
}

function range(value: NumberRange | undefined, fallback: NumberRange, label: string): NumberRange {
  const resolved = value ?? fallback;
  if (!Number.isFinite(resolved[0]) || !Number.isFinite(resolved[1]) || resolved[0] > resolved[1]) {
    throw new Error(`${label} must be an ordered finite range`);
  }
  return resolved;
}

export function assertTopology(topology: Topology): void {
  const nodes = new Set(topology.nodes);
  if (nodes.size !== topology.nodes.length || nodes.has("")) throw new Error("topology nodes must be unique non-empty ids");
  const ids = new Set<string>();
  for (const interaction of topology.interactions) {
    if (!interaction.id || ids.has(interaction.id)) throw new Error("interaction ids must be unique and non-empty");
    ids.add(interaction.id);
    if (interaction.participants.length < 2 || new Set(interaction.participants).size !== interaction.participants.length) {
      throw new Error(`interaction ${interaction.id} needs at least two distinct participants`);
    }
    if (interaction.participants.some((participant) => !nodes.has(participant))) throw new Error(`interaction ${interaction.id} references an unknown node`);
    if (!Number.isFinite(interaction.weight) || interaction.weight < 0) throw new Error(`interaction ${interaction.id} weight must be non-negative and finite`);
  }
}

/** Complete pair topology in stable input order; the current C/D game uses this as its compatibility topology. */
export function completeTopology(nodes: readonly string[]): Topology {
  const interactions: Interaction[] = [];
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      interactions.push({ id: `pair:${left}:${right}`, participants: [nodes[left]!, nodes[right]!], weight: 1 });
    }
  }
  const topology = { nodes: [...nodes], interactions };
  assertTopology(topology);
  return topology;
}

/** Sample uncertain links and weights without imposing game semantics on them. */
export function sampleTopology(prior: TopologyPrior, rng: Rng): Topology {
  const interactions = prior.interactions.flatMap((interaction) => {
    const probability = range(interaction.probability, [1, 1], `${interaction.id}.probability`);
    if (probability[0] < 0 || probability[1] > 1) throw new Error(`${interaction.id}.probability must stay within 0..1`);
    if (rng.unit() >= rng.between(probability)) return [];
    const weight = range(interaction.weight, [1, 1], `${interaction.id}.weight`);
    if (weight[0] < 0) throw new Error(`${interaction.id}.weight must be non-negative`);
    return [{ id: interaction.id, participants: [...interaction.participants], weight: rng.between(weight) }];
  });
  const topology = { nodes: [...prior.nodes], interactions };
  assertTopology(topology);
  return topology;
}

export function interactionsFor(topology: Topology, node: string): readonly Interaction[] {
  if (!topology.nodes.includes(node)) throw new Error(`unknown topology node ${node}`);
  return topology.interactions.filter((interaction) => interaction.participants.includes(node));
}
