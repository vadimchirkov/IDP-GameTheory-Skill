# Flumina

> Map the currents. Choose your course.

Flumina is a local decision-rehearsal workspace for choices whose outcome depends
on uncertain conditions. Describe the situation in ordinary language, compare the
actions available to you, and inspect where the recommendation holds or changes.

The AI turns prose and public evidence into an explicit model. A deterministic
TypeScript engine then evaluates every option in the same sampled worlds. You can
inspect the assumptions, rerun the calculation with the same seed, and see which
uncertainty deserves more attention before acting. The AI never supplies the
simulated outcome.

## The product

The primary workflow is deliberately short:

1. **Context** — describe the decision, options, goal, constraints, and unknowns.
   The assistant can research public facts and raises only questions that may change
   the model.
2. **Model** — review the objective, optional timeframe, 2–5 options, 1–8 shared
   uncertain factors, option effects, assumptions, and sources. Change the context
   and rebuild if the framing is wrong.
3. **Worlds** — run hundreds or thousands of reproducible paired worlds. Every
   option sees the same environment, so the comparison isolates the choice rather
   than the random draw.
4. **Decision River** — follow worlds from the main uncertainty boundary to the
   option that wins there and the resulting outcome. Use the stress lens to see
   when another option becomes preferable. When a two-factor failure region survives
   a train/holdout check, the report shows it as a conditional recommendation.

Each run reports:

- the recommended option and whether the lead is close;
- target probability when the model has a meaningful target;
- median and tail outcomes;
- how often each option is best in the same worlds;
- expected regret from choosing it when another option would have worked better;
- the factor and regime most capable of changing the recommendation;
- a two-factor failure region only when it passes the holdout quality gate.

Treat the sampled share of worlds as conditional evidence for the decision, never
as the true probability of the future.

## Two model modes

### Decision comparison

Use this for a decision maker choosing among mutually exclusive actions: launch or
wait, build or buy, choose a supplier, enter a market, allocate a scarce resource,
or select a policy. It is the default product mode.

A Decision model is a small response surface:

- one objective to maximize or minimize;
- shared external factors sampled once per world;
- a baseline outcome for each option;
- explicit effects describing how each factor changes each option.

This structure stays understandable enough to challenge. It does not infer
causality or hide an optimizer behind the recommendation.

### Strategic interaction

Use this when the result is driven by repeated mutual reactions: negotiations,
alliances, deterrence, standards, price wars, or management of a shared resource.
The C/D adapter models cooperation and defection over time with uncertain payoffs,
continuation, behavior, and noise.

The adapter preserves the project's deeper repeated-game capabilities, including
teams, reputation, punishment, exit, cheap talk, environmental feedback,
tournaments, population evolution, and spatial dynamics. These mechanics stay
inside the adapter; the shared engine has no game-theory concepts.

See [GAME_THEORY.md](GAME_THEORY.md) for the model boundary and supported
mechanisms.

## Quick start

Requirements: Node.js **22.19+** and pnpm.

```bash
pnpm install
pnpm app
```

Open <http://127.0.0.1:4317>. Flumina listens only on the local loopback interface.
The first launch creates `data/app.db`; completed runs create HTML and JSON artifacts
under `reports/tasks/`.

Open **Settings → Model and access** to add a provider API key and select a model.
Existing Pi authentication from `~/.pi/agent/auth.json` and provider environment
variables are discovered automatically.

| Variable | Purpose | Default |
|---|---|---|
| `PI_PROVIDER` | Pi provider ID | first authenticated provider |
| `PI_MODEL` | model ID | first available model |
| `PI_THINKING_LEVEL` | reasoning level | model-dependent |
| `PORT` | local HTTP port | `4317` |
| `APP_DB_PATH` | SQLite journal | `data/app.db` |
| `ANALYSIS_TIMEOUT_MS` | worker timeout | `300000` |

The web workflow needs an authenticated model to build and label a model. The
simulation engine and CLI need no API key once model JSON exists.

## Run a model from the CLI

```bash
pnpm scenario model.json 600 --seed 42
pnpm scenario model.json 600 --seed 42 --visual
```

The first command prints the model-specific summary. The second writes an
interactive report to `reports/visual.html`. Trials default to `600`; the default
seed is `42`.

A minimal Decision model looks like this:

```json
{
  "schemaVersion": 1,
  "adapter": "decision",
  "situation": "We must choose how to launch a new service.",
  "question": "Which launch plan gives us the best first-year contribution margin?",
  "objective": {
    "label": "First-year contribution margin",
    "unit": "EUR",
    "direction": "maximize",
    "target": 250000
  },
  "factors": [
    {
      "id": "demand",
      "label": "First-year demand",
      "range": [8000, 18000],
      "lowLabel": "Weak demand",
      "highLabel": "Strong demand"
    }
  ],
  "options": [
    {
      "id": "focused",
      "label": "Focused launch",
      "baseline": [180000, 240000],
      "effects": [{ "factorId": "demand", "impact": [90000, 150000] }]
    },
    {
      "id": "broad",
      "label": "Broad launch",
      "baseline": [130000, 260000],
      "effects": [{ "factorId": "demand", "impact": [150000, 260000] }]
    }
  ],
  "assumptions": [
    "The response surface excludes second-year retention and financing effects."
  ]
}
```

The factor value is shared by both options in each world. An effect is the change
from the factor midpoint to its high end; movement to the low end applies the
opposite sign.

Agents working from the repository can follow [SKILL.md](SKILL.md) to frame, run,
and interpret Decision and Strategic models consistently.

## Engine and adapters

```text
web application / CLI
          |
          +-- Decision adapter
          +-- repeated C/D adapters
          +-- stochastic-process adapter
          +-- Polymarket adapter
                       |
                       v
          paired-world Monte Carlo
          + optional topology sampling
                       |
                       v
              deterministic RNG
```

`src/monte-carlo.ts` owns deterministic world generation, summaries, and
conditioning. `src/topology.ts` owns optional nodes and uncertain interactions.
`src/simulation.ts` composes them for adapters that need both. Domain rules and
reporting remain in `src/adapters/` and their report modules.

The web product currently builds Decision and Strategic interaction models.
Stochastic-process and Polymarket models are CLI adapters. The Polymarket bridge can
record paper forecasts in an append-only ledger and later score them against market
resolution; it never places orders.

See [PROJECT_ARCHITECTURE.md](PROJECT_ARCHITECTURE.md) for the engine and adapter
boundaries.

## Why the AI and engine are separate

The Pi agent handles language work: framing the situation, collecting public
evidence, producing typed model output, and naming report branches. It cannot access
the filesystem, shell, or an unrestricted browser through the embedded workflow.

The engine validates and calculates the model without an LLM. A model, trial count,
and seed reproduce the same worlds. Runs execute in a worker thread; TEOB commands,
events, and SQLite persistence keep the workflow traceable and resumable.

## Validation

```bash
pnpm test
pnpm build
pnpm journal:verify
pnpm bench:engine
pnpm bench:live
pnpm cross:validate
```

The verification pack checks deterministic replay, model validation, decision
comparison, C/D mechanics, conditioning, and forecast scoring. Benchmark datasets
and reproduction notes are in [data/README.md](data/README.md).

The repeated-game benchmarks recover known behavioral signals and expose model-fit
limits. They do not validate a general ability to predict unseen conflicts,
sanctions, negotiations, or business decisions. New adapters need their own
holdouts and baselines.

## Development

Run the API and Vite in separate terminals:

```bash
pnpm app:server
pnpm app:dev
```

The Vite URL is normally <http://127.0.0.1:5173>; `/api` and `/reports` are proxied
to port `4317`.

| Path | Responsibility |
|---|---|
| `app/` | React workspace and UI contract |
| `src/adapters/decision.ts` | paired-world decision model and summaries |
| `src/adapters/repeated-game.ts` | repeated C/D model on the shared runner |
| `src/adapters/repeated-game-dynamics.ts` | C/D tournament, evolution, and spatial views |
| `src/monte-carlo.ts` | deterministic worlds, summaries, and conditioning |
| `src/topology.ts` | optional interaction topology |
| `src/scenario-agent.ts` | context, typed model construction, and labels |
| `src/task.ts` | event-sourced task lifecycle |
| `src/app-server.ts` | local API, SSE, workers, and reports |
| `src/decision-report.ts` | Decision River report |
| `src/worlds-report.ts` | Strategic interaction river report |
| `src/forecast.ts` | adapter-neutral forecast ledger and scoring contract |

## Current limits

- Decision models use one objective and an inspectable linear response surface.
- Failure boxes are limited to two factors and hidden unless holdout support,
  coverage, lift, and decision-margin gates all pass.
- Decision outcomes cannot yet reweight an existing run. C/D observations can.
- The web agent builds Decision and compact C/D models; other adapters start from
  JSON.
- Results remain conditional on supplied ranges, effects, and structural
  assumptions. Domain evidence still decides whether the model deserves trust.
