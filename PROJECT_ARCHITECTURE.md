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

## Domain adapters

`src/adapters/decision.ts` is the primary product adapter. It evaluates every option
in the same sampled environment and reduces the resulting worlds into robustness,
target probability, regret, reversal sensitivity, and paths for the Decision River.

`src/adapters/repeated-game.ts` is not the universal engine. It is the existing repeated C/D
scenario model implemented as one client of the core. It constructs a complete
pair topology, supplies the world callback, and reduces its domain-specific trials
into winners, cooperation, sensitivity, replay data, and the river artifact.

`src/adapters/repeated-game-dynamics.ts` adds three optional views over the same C/D
kernel: disposition tournaments, replicator/Moran population evolution, and spatial
lattice updates. These modes keep their domain types and algorithms inside the adapter;
the generic Monte Carlo, topology, and simulation modules do not depend on them.

Both product adapters reweight a finished run from observed outcomes, and both delegate the
generic step — `conditionWorlds` and the weighted summaries in `src/monte-carlo.ts`. Only the
likelihood is domain code: `src/abc.ts` scores a world against cooperation, winner and regime;
`fitDecisionPosterior` in `src/adapters/decision.ts` scores it against an observed factor value or
option result. Neither re-simulates.

## Application boundary

The React application, Pi modelling agent, TEOB `Task` aggregate, SQLite journal,
worker, and HTML rivers are product infrastructure. They orchestrate and present
Decision and C/D models; they are not dependencies of the reusable core.

A run persists its model, seed and worlds as a JSON artifact. Reports are rendered
from that artifact when they are requested, so there is no generated page to keep in
sync with the journal.

```text
application / CLI
       |
       +-- Decision adapter -----------+--> Monte Carlo primitives
       +-- repeated C/D adapters ------+           |
                                                   +-- topology where needed
                                                   |
                                                   v
                                           deterministic RNG
```

## Boundaries kept out

The old `Run` and `Participant` aggregates, spatial heatmap UI, build-hints path,
duplicate predictive helpers, the library barrel, the speculative action-adapter
layer, and the Polymarket/forecast surface stay removed. Forecast scoring is a
separate product and no longer lives here. The dynamics adapter exposes pure,
deterministic functions; persistence and presentation can be added when a product
workflow actually needs them. New game types should start as a simulation callback
and add abstractions only after two real implementations need the same behavior.
