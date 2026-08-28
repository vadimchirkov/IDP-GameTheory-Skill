import type { Rng } from "./rng.js";
import type { SimulationAdapter, WorldSample } from "./simulation.js";
import type { Topology } from "./topology.js";

/** A single action taken by one actor during one simulation step. */
export type ActionMap<A> = Readonly<Record<string, A>>;

/**
 * Minimal adapter for sequential/action-based systems. The adapter owns domain
 * state and rules; the Monte Carlo runner still owns worlds, seeds and topology.
 */
export interface ActionSimulationAdapter<M, S, A, P> extends Omit<SimulationAdapter<M, P>, "simulate"> {
  steps(model: M): number;
  actors(model: M, topology: Topology): readonly string[];
  initialState(model: M, rng: Rng): S;
  chooseAction(model: M, actor: string, state: S, topology: Topology, rng: Rng): A;
  transition(model: M, state: S, actions: ActionMap<A>, topology: Topology, rng: Rng): S;
  observe(model: M, initial: S, final: S, history: readonly ActionMap<A>[], topology: Topology): Omit<WorldSample<P>, "payload"> & { payload: P };
}

/** Turn the action lifecycle into the ordinary SimulationAdapter contract. */
export function sequentialActionAdapter<M, S, A, P>(definition: ActionSimulationAdapter<M, S, A, P>): SimulationAdapter<M, P> {
  return {
    id: definition.id,
    validate: definition.validate,
    simulate(model, topology, rng) {
      const steps = definition.steps(model);
      if (!Number.isInteger(steps) || steps < 1) throw new Error("action simulation steps must be a positive integer");
      let state = definition.initialState(model, rng);
      const initial = state;
      const history: ActionMap<A>[] = [];
      const actors = definition.actors(model, topology);
      for (let step = 0; step < steps; step += 1) {
        const actions: Record<string, A> = {};
        for (const actor of actors) actions[actor] = definition.chooseAction(model, actor, state, topology, rng);
        history.push(actions);
        state = definition.transition(model, state, actions, topology, rng);
      }
      return definition.observe(model, initial, state, history, topology);
    },
  };
}
