# Universal Monte Carlo architecture
The old `Run` and `Participant` aggregates, tournament/evolution layers, lattice
sandbox, heatmap generator, build-hints path, and duplicate predictive helpers were
experimental or disconnected from the shipping workflow. They were removed instead
of being generalized. New game types should start as a simulation callback and add
abstractions only after two real implementations need the same behavior.
The reusable engine is deliberately smaller than the Flumina application around it.
It has two independent modules and no knowledge of games, players, actions, payoffs,
or equilibrium concepts.

## Core

`src/monte-carlo.ts` owns deterministic world generation:

- a root seed and world index produce a stable world seed;
- a caller-provided callback samples and simulates one world;
- runs are arrays of caller-defined world values;
- numeric summaries are generic helpers;
- observations reweight existing worlds through a caller-provided likelihood.

The callback is the extension point. A public-goods game, queue, market, epidemic,
workflow, or reliability model can use the same runner without implementing an
engine interface or inheriting from framework classes.

`src/topology.ts` owns interaction structure:

- nodes are opaque string ids;
- an interaction connects two or more nodes and has an id and weight;
- interactions may therefore represent edges or hyperedges;
- a topology prior can independently sample whether an interaction exists and its
  weight;
- the module contains no graph algorithms or game rules.

`src/simulation.ts` composes the two primitives. A `SimulationSpec` supplies a
domain model and topology prior; a `SimulationAdapter` simulates one sampled
world; the runner returns worlds, metric distributions, paths, and sensitivity.
`src/stochastic-process.ts` is the first concrete adapter and a template for
queues, markets, cascades, reliability models, or agent-based systems.

## Compatibility model

`src/analysis.ts` is not the universal engine. It is the existing repeated C/D
scenario model implemented as one client of the core. It constructs a complete
pair topology, supplies the world callback, and reduces its domain-specific trials
into winners, cooperation, sensitivity, replay data, and the river artifact.

`src/abc.ts` keeps its domain-specific observation vocabulary but delegates generic
world conditioning and weighted summaries to `src/monte-carlo.ts`.

## Application boundary

The React application, Pi modelling agent, TEOB `Task` aggregate, SQLite journal,
worker, and HTML river are product infrastructure. They orchestrate and present the
compatibility model; they are not dependencies of the reusable core.

```text
application / CLI
       |
       v
C/D compatibility model ---- future simulation callbacks
       |                              |
       +--------------+---------------+
                      v
          Monte Carlo + topology core
                      |
                      v
              deterministic RNG
```

## Removed boundaries

The old `Run` and `Participant` aggregates, tournament/evolution layers, lattice
sandbox, heatmap generator, build-hints path, and duplicate predictive helpers were
experimental or disconnected from the shipping workflow. They were removed instead
of being generalized. New game types should start as a simulation callback and add
abstractions only after two real implementations need the same behavior.
