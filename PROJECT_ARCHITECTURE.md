# Universal Monte Carlo architecture
The old `Run` and `Participant` aggregates, heatmap UI, build-hints path, and duplicate
predictive helpers were disconnected from the shipping workflow and remain removed.
Tournament, population evolution, and spatial play are useful C/D capabilities, so
they live in a domain adapter rather than in the universal engine.
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
`src/adapters/stochastic-process.ts` is the first concrete adapter and a template for
queues, markets, cascades, reliability models, or agent-based systems.

## Compatibility model

`src/adapters/repeated-game.ts` is not the universal engine. It is the existing repeated C/D
scenario model implemented as one client of the core. It constructs a complete
pair topology, supplies the world callback, and reduces its domain-specific trials
into winners, cooperation, sensitivity, replay data, and the river artifact.

`src/adapters/repeated-game-dynamics.ts` adds three optional views over the same C/D
kernel: disposition tournaments, replicator/Moran population evolution, and spatial
lattice updates. These modes keep their domain types and algorithms inside the adapter;
the generic Monte Carlo, topology, and simulation modules do not depend on them.

`src/abc.ts` keeps its domain-specific observation vocabulary but delegates generic
world conditioning and weighted summaries to `src/monte-carlo.ts`.

## Application boundary

The React application, Pi modelling agent, TEOB `Task` aggregate, SQLite journal,
worker, and HTML river are product infrastructure. They orchestrate and present the
compatibility model; they are not dependencies of the reusable core.

Forecast evaluation is a separate boundary above adapters. `src/forecast.ts` knows
only categorical outcomes, probabilities, optional baseline probabilities, and an
optional decision value for each outcome. Adapter-specific bridges translate live
data into this contract; `src/adapters/polymarket-live.ts` is the first one. The append-only
ledger and scorer therefore do not need branches for every future adapter.

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

## Boundaries kept out

The old `Run` and `Participant` aggregates, spatial heatmap UI, build-hints path, and
duplicate predictive helpers stay removed. The dynamics adapter exposes pure,
deterministic functions; persistence and presentation can be added when a product
workflow actually needs them. New game types should start as a simulation callback
and add abstractions only after two real implementations need the same behavior.
