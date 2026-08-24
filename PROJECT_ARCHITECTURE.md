# Flumina Architecture: TEOB and the Simulation Runtime

> The single source of truth for how Flumina uses **Type-safe Event-sourcing Over Behaviours** (`@lambda-house/teob-ts@0.2.2`). Pair with `GAME_THEORY.md` for the game mechanics. References point to live source: `src/domain.ts`, `src/kernel.ts`, `src/rng.ts`, `src/analysis.ts`, `src/run.ts`, `src/projections.ts`, `src/spatial.ts`, `src/cli.ts`, and the upstream package `node_modules/@lambda-house/teob-ts/README.md`.

---

## 1. What TEOB Means Here

TEOB = **Type-safe Event-sourcing Over Behaviours** — DDD + Event Sourcing + CQRS + Actor + pure FP fused into one model (`node_modules/@lambda-house/teob-ts/README.md:4`):

| Pillar | How it appears in this repo |
|---|---|
| **Domain-Driven Design** | Aggregates are consistency boundaries with domain language (`Run`, `SimulationRun`/`Participant` planned). No ORM. |
| **Event Sourcing** | Current state is never stored directly; it is derived by replaying `RunEvent[]` from a journal. Every mutation is an immutable fact. |
| **CQRS** | Write = `decide` → `Effect`; read = `apply` + `Projection`. Separate scaling/optimization. |
| **Actor Model** | Each `Run` entity has a mailbox, processes one `Command` at a time, no shared mutable state. |
| **Pure FP / Effect ADT** | `decide` is `async (State, Command, EffectControl) => Effect<RunEvent,RunReply>` — returns a *description* (`persist`/`reply`/`andReply`/`andRun`/`scheduleOnce`/`cancelTimer`). Runtime interprets it. `apply` is synchronous pure `(State, Event) => State`. |

The upstream README summarizes the contract (`node_modules/@lambda-house/teob-ts/README.md:20`): four things define an entity — `initial`, `decide`, `apply`, `Codec`. Business logic imports neither HTTP nor DB.

```
Command → decide(state, command) → Effect → Runtime → Journal → apply → State
```

Swap runtime (`inmem` ↔ `sqlite` ↔ `postgres`) without changing `decide/apply` (`node_modules/@lambda-house/teob-ts/README.md:70`).

---

## 2. Package Inventory (`@lambda-house/teob-ts@0.2.2`)

Declared in `package.json:16` (`@lambda-house/teob-ts: 0.2.2`). Exports (`node_modules/@lambda-house/teob-ts/package.json:22`):

| Subpath | Module | Role in this repo |
|---|---|---|
| `.` | root | re-export |
| `./core` | `teob-core` | `Aggregate`, `Effect` (`persist/reply/andReply/andRun`), `EffectControl`, `CategoryId/EntityId/TimerId`, `tagCodec/objectCodec/codecWithUpcasts/upcast`, `AggregateTestKit`, `ReadModel` — **used** |
| `./inmem` | `teob-inmem` | `createSingleRuntime` / `createInMemoryRuntime` — **current runtime** for tests/demo (`src/selfcheck.ts:4`, `src/run.ts:88`) |
| `./sqlite` | `teob-sqlite` | `createSqliteRuntime({path})` WAL + snapshots — **used** by the app server for the `Task` journal (`src/app-server.ts:31`, `data/app.db`). CLI/self-check still use `inmem`. |
| `./postgres` | `teob-postgres` | `LISTEN/NOTIFY` production journal — **planned after sqlite** |
| `./projection` | `teob-projection` | `projection()`, `createInMemoryProjectionStore`, `runProjection`, `rebuildProjection` — **used** (`src/projections.ts:1`) |
| `./http` | `teob-http` | `aggregateRoutes/allAggregateRoutes`, `openApiSchema(describeAggregate(...))`, ETag/If-Match — **not used**: the app server hand-rolls `node:http` (`src/app-server.ts:3`) + SSE and enforces optimistic concurrency inside the aggregate (`baseRevision` guards) instead of ETag/If-Match |
| `./quickstart` | `teob-quickstart` | `quickstart({aggregates:[runAggregate]})` zero-config demo — **planned** |
| `./service` | `teob-service` | layered startup/shutdown, health checks — **planned** |
| `./saga` | `teob-saga` | `saga/statefulSaga`, `runSaga`, cross-entity choreography — **only if needed** (agent-mode orchestration) |
| `./telemetry` | `teob-telemetry` | `withTelemetry/withJournalTelemetry` OpenTelemetry — **on measured need** |
| `./testing` | `teob-testing` | `createAggregateTestKit`, `extractEvents` — **used** (`src/selfcheck.ts:2`) |
| `./ai` | `teob-ai` | `agentFlowAggregate`, `ToolPermission`, `createKnowledgeBackedMemoryService` — **only for future LLM branch** |
| `./petrinet` | `teob-petrinet` | flow-based state machines — **not needed for current scope** |

Dependency layering (`node_modules/@lambda-house/teob-ts/README.md:72`): `core` ← `inmem|sqlite|postgres` ← `projection|saga|http|quickstart|service|telemetry` ← `ai|petrinet`.

---

## 3. Two Execution Modes

`PROJECT_ARCHITECTURE §3` defines a hard split:

### 3.1 Batch / evolution — fast mathematical mode (implemented)

* Pure TypeScript kernel `src/kernel.ts` + `src/analysis.ts` receives all inputs + explicit `Rng`, writes **no** per-move events, deterministic for a given seed.
* Single `Run` aggregate stores only experiment-level facts (`RunStarted`, `GenerationCompleted*`, `RunFinished`, `RunPaused/Resumed`). ~200 events per run, not 200M.
* Used for Monte Carlo scenario analysis (`pnpm scenario model.json 600`), tournament, replicator/Moran evolution, spatial sweeps.

### 3.2 Agent simulation — detailed participant mode (Participant aggregate built; coordinator not wired)

```
SimulationRun(runId)              Participant(runId:playerId)
─────────────────────             ────────────────────────────
fixes config + round              state: temperament, lean, history
opens/closes round                command: RequestMove, ReceiveOutcome
persists RoundOpened/Resolved     events: MoveChosen, OutcomeRecorded
broadcasts after commit           apply: updates private worldview
```

`SimulationRun` coordinates: `RoundOpened` → `ctx.ask(Participant, RequestMove)` → collect `MoveSubmitted` → `persist(RoundResolved)` → `ctx.tell(Participant, ReceiveOutcome)`. Requires `ctx.ask/tell`, `ReplyDeferred` (`createDeferredReply`), `teob-ai:agentFlowAggregate`, `teob-saga statefulSaga`. Justified only for 2–10 human/LLM participants where per-move explainability matters. Not mixed into batch Monte Carlo — that would be slow without scientific value.

**Current status.** The `Participant` aggregate itself is implemented (`src/participant.ts`: `Initialize/RequestMove/ReceiveOutcome/Gossip`, per-player event-sourced worldview) and exercised only by `src/selfcheck.ts:120` driving it externally via `runtime.ask`. The `SimulationRun` coordinator does **not** exist yet — `participant.decide` never calls `ctx.ask/tell` (the `ctx` argument is unused), so participants cannot play a match against each other; an external driver must sequence every move. The file also carries `// @ts-nocheck` (`src/participant.ts:9`) and a history cap (`slice(-20)` in `apply`, `src/participant.ts:243,254`). The cap replays deterministically (so it does not break TEOB replay) but truncates the state to the last 20 moves, silently changing the semantics of the long-memory strategies (`grim`, `detective`, `southampton`, `prober`) so a participant-mode match would diverge from the canonical `src/kernel.ts` result. So it is a design spike, not a wireable mode.

### 3.3 App workflow — the shipping orchestration mode (implemented)

The web application runs a **third** mode not covered by the batch/agent split above: the `Task` aggregate (`src/task.ts`) is the only aggregate the app server registers (`src/app-server.ts:31`). It event-sources the scenario lifecycle — `draft → ready → running → labeling → completed` — over a `teob-sqlite` journal, delegates the actual Monte Carlo to `src/analysis.ts` in a worker thread (off the TEOB hot path), and records only experiment-level facts (`AnalysisRequested/Calculated/LabelsCompleted/Completed/Failed`). Game theory here sits *inside* the aggregate's payload (`ScenarioModel`, validated by `assertScenario` before `persist`), never as per-move events. `Run` and `Participant` are not registered by the app server.

---

## 4. Aggregates: `Task` (shipping), `Run`, `Participant`

Three aggregates exist. The app server registers only **`Task`** (`src/task.ts`, §3.3) — the scenario-workflow entity that is the product's real TEOB surface. **`Run`** (`src/run.ts`, this section) is the evolutionary/generational loop, exercised via `src/selfcheck.ts` (and available to a future `--evolve`/dashboard path) but not registered by the app. **`Participant`** (`src/participant.ts`, §3.2) is a per-player spike, self-check only. The detailed contract below documents `Run`; `Task`'s commands/events are typed in `src/task.ts` and its projections in `src/task-projections.ts`.

### 4.0 `Run` (`src/run.ts`)

### 4.1 Type contract

```ts
// src/run.ts:13-34
RunState  { status: "new"|"running"|"paused"|"finished", config?: RunConfig, seed?: number, generation: number, shares: Shares, last?: Generation }
RunCommand = {tag:"StartRun",config,seed} | {tag:"StepGeneration",generation} | {tag:"Pause"} | {tag:"Resume"} | {tag:"GetState"}
RunEvent   = {tag:"RunStarted",config,seed,kernelVersion} | {tag:"GenerationCompleted",generation,result} | {tag:"RunPaused"} | {tag:"RunResumed"} | {tag:"RunFinished"}
RunReply   = {tag:"Accepted"} | {tag:"State",state} | {tag:"Rejected",reason}
runCategory = categoryTypes<RunCommand,RunReply>(CategoryId("game-run"))
KERNEL_VERSION = "1"
tickTimer = TimerId("next-generation")
snapshotEvery: 10 // src/run.ts:117 — 10, not 25 (eco cycles >500 gens)
```

### 4.2 Lifecycle

| Command | Preconditions | Effect chain | Events persisted |
|---|---|---|---|
| `StartRun` | `status==="new"` else `Rejected("Run already exists")` | `andRun(persist(RunStarted{config,seed,kernelVersion}), () => scheduleNext(...))` + `andReply(Accepted)` | `RunStarted` |
| `StepGeneration(g)` | `status==="running" && g===state.generation` else stale/active Reject | Kernel: `result=stepGeneration(config,shares,g,seed)` → if `g+1>=generations` then `andReply(persist(GenerationCompleted, RunFinished), Accepted)` else `andRun(persist(GenerationCompleted), () => scheduleNext(...))` + `andReply` | `GenerationCompleted` (+ `RunFinished` at end) |
| `Pause` | `running` else Reject | `andRun(persist(RunPaused), () => cancelTimer(tickTimer))` + `andReply` | `RunPaused` |
| `Resume` | `paused` else Reject | `andRun(persist(RunResumed), () => scheduleNext(...))` + `andReply` | `RunResumed` |
| `GetState` | always | `reply(State{state})` — no persistence | — |

`scheduleNext` (`src/run.ts:44`): `ctx.scheduleOnce(tickTimer, {tag:"StepGeneration", generation: state.generation}, config.stepDelayMs ?? 0)`.

`onRecoveryComplete` (`src/run.ts:113`): if `status==="running"` then `scheduleNext` — re-arms timer after crash/replay because timers are **not persisted** (`node_modules/@lambda-house/teob-ts/README.md` lifecycle; `core.md: Timers — No persistence`).

`apply` (`src/run.ts:98`): pure, total:
* `RunStarted` → `{status:"running", config, seed, generation:0, shares: normalizeShares(initialShares)}`
* `GenerationCompleted` → `{...state, generation, shares: result.shares, last: result}`
* `RunPaused` → `{...state, status:"paused"}`
* `RunResumed` → `{...state, status:"running"}`
* `RunFinished` → `{...state, status:"finished"}`

Immutability rule (`PROJECT_ARCHITECTURE §2`): `RunStarted` fixes complete `config+seed+kernelVersion`; retroactive payoff/team/lean/noise edits are forbidden — new `runId` + new journal. Comparing scenarios = projection over several journals.

### 4.3 Codecs and journal

```ts
// src/run.ts:118
runEventCodec = tagCodec<RunEvent>("RunStarted","GenerationCompleted","RunPaused","RunResumed","RunFinished")
stateCodec    = objectCodec<RunState>("RunState") // used in src/selfcheck.ts:60
```

Current runtime: `createSingleRuntime(runAggregate, runEventCodec, stateCodec)` (`src/selfcheck.ts:60`). Each `EntityId` = one independent run journal. Snapshots every 10 events (`src/run.ts:117`) for fast replay (eco/transition cycles >500 gens).

Upcasting for schema evolution (`node_modules/@lambda-house/teob-ts/README.md:551`) is **shipped**, not just planned: `runEventCodec = codecWithUpcasts(runEventBaseCodec, [...])` (`src/run.ts:122`) backfills `kernelVersion` and `config.sigma/stepDelayMs` on old `RunStarted` events so pre-`sigma` journals still replay. `Participant` ships the same pattern (`src/participant.ts:282`, backfills `norm`). The next `config` fields (`team/colluder`, `values/drift`) extend this same upcast list rather than breaking old journals.

### 4.4 Determinism inside decide

`decide` is `async` but the kernel called inside it is pure and seeded:

```ts
// src/kernel.ts:222 + src/run.ts:77
new Rng(deriveSeed(rootSeed, generation, i, j, rep))
```

`deriveSeed` (`src/rng.ts:33`): `hash = FNV-1a(root) ^ part * 0x01000193`. Each match gets its own sub-RNG, so parallelization stays bit-for-bit reproducible and global `Math.random` is banned (`src/rng.ts:1` comment).

---

## 5. Projections (CQRS Read Side) — `src/projections.ts`

Built on `teob-projection` (`node_modules/@lambda-house/teob-ts/README.md:339`):

```ts
// src/projections.ts:11
runSummaryProjection = projection<RunEvent, RunSummaryView>({
  projectionId: "run-summary", category: "game-run",
  initialState: ()=>({status:"new", generation:0}),
  evolve: (view,event)=> { RunStarted→running/0; GenerationCompleted→{generation,last}; RunPaused→paused; ... }
})
strategySeriesProjection = projection<RunEvent, StrategyPoint[]>({
  projectionId: "strategy-series",
  evolve: (view,event)=> event.tag==="GenerationCompleted" ? [...view, {generation, shares, cooperationRate}] : view
})
```

Runtime wiring (`src/selfcheck.ts:66`):
```ts
store = createInMemoryProjectionStore()
runProjection(runSummaryProjection, journal, store, {eventCodec: runEventCodec})
store.get<RunSummaryView>("run-summary", entityId)
```

Properties: resumable (only new events on next run), rebuildable via `rebuildProjection()`. Future stores: `createSqliteProjectionStore(db)` (`node_modules/@lambda-house/teob-ts/README.md:388`). No SQL in handlers — `evolve` is pure. Free views: `strategyShares` chart, `leaderboard`, `cooperationRate` time series, SSE live view + Delta export from the same events.

The app server uses the same mechanism on the `Task` journal: `taskSummaryProjection` (list view) and `taskDetailProjection` (`src/task-projections.ts`) are rebuilt into an `createInMemoryProjectionStore()` on each mutation (`src/app-server.ts:41`) and pushed to the browser over SSE. Read models are in-memory even though the write journal is `sqlite` — projections are cheap to replay from the event stream on restart.

---

## 6. Runtime Envelope (current vs planned)

| Concern | Current | Next | Why now / later |
|---|---|---|---|
| **Journal** | app server: `teob-sqlite` (`createSqliteRuntime({path:"data/app.db"})`, `src/app-server.ts:31`); CLI/self-check: `teob-inmem` (`createSingleRuntime`) | `teob-postgres` (LISTEN/NOTIFY) | `inmem` for headless Monte Carlo; `sqlite` already backs the app so tasks survive reboot; `postgres` only for multi-node sharing |
| **Testing** | `createAggregateTestKit` + `extractEvents` (`src/selfcheck.ts:1`), `teob-core` invariants, `verify-pack.ts` | `fast-check` property-based + `verifyEntity/verifyAll` (`core.md: Invariants`) | Pure `decide/apply` already testable without runtime |
| **HTTP** | hand-rolled `node:http` + SSE (`src/app-server.ts`) driving `Task` via `runtime.ask`; CLI (`src/cli.ts`) for headless runs | optionally `teob-http` `aggregateRoutes` (ETag/If-Match, OpenAPI) + `teob-quickstart` | the app needs SSE live updates + report serving that `teob-http` does not cover; concurrency is enforced by `baseRevision` guards in the aggregate, not ETags |
| **Saga** | none | `teob-saga` `statefulSaga` only for cross-aggregate orchestration (SimulationRun↔Participant) | Single `Run` aggregate has no cross-entity choreography |
| **AI** | none — the `llm_agent` stub was removed rather than shipped as a fake strategy | `teob-ai` `agentFlowAggregate` + `ToolPermission.Confirm` | LLM moves justify per-agent entities + `ReplyDeferred` |
| **Telemetry** | none | `teob-telemetry` `withTelemetry/withJournalTelemetry` | On measured CPU/IO limits |

The swap is literal (`node_modules/@lambda-house/teob-ts/README.md:70`):
```ts
// before
createSingleRuntime(runAggregate, eventCodec, stateCodec)
// after — no decide/apply change
createSqliteRuntime({path:"./data/journal.db"}, [registration(runAggregate, eventCodec, stateCodec)])
createPostgresRuntime({...}, [registration(...)])
```

---

## 7. CLI and Monte Carlo Loop (`src/cli.ts`, `src/analysis.ts`)

TEOB is **not** on the hot path of the 600-world loop:

```
prose (SKILL.md elicitation) → ScenarioModel JSON → cli.ts → analysis.ts:analyzeScenario(model,trials,seed)
  → for each trial: oneTrial() { samplePayoff, sample w/noise/drift/lean, geometricHorizon, playMatch(round-robin, effectiveStrategy(team)) }
  → aggregate winPct/winPctTeam/winPctPerCapita/cooperation/sensitivity
  → cli prints scenarioReport() + JSON + optional buildTips + *.report.json/*.tips.md
```

Only `Run` evolution (`--evolve`) goes through the aggregate. `scenario` subcommand is plain functions for speed. Flags: `--seed N` (deterministic), `--build` (`feedback.ts:buildSuggestions`), `--evolve N`, `--heatmap`, `--tournament`.

---

## 8. Spatial Kernel Separation (`src/spatial.ts`)

Spatial lattice (`createGrid`, `stepSpatial(rule="imitate-best"|"fermi", K)`, `coopRate`, `clusterCount`) is a **separate kernel** (`src/spatial.ts:1`). Used either via `model.topology` inside `analysis.ts:49` (Monte Carlo per-trial averaged lattice) or via the evolution sandbox game loop. When spatial is used, `model.topology` changes the kernel interface; well-mixed tournament and lattice are mutually exclusive per run (chosen in `RunConfig` / `ScenarioModel.topology`). Events for the game variant: `RunStarted(initialGrid)` + per-gen `GenerationCompleted{coopRate,clusterCount}` + intervention `Painted/EventCardPlayed` (shareable replays — `case_A_spatial_game.md §6`).

---

## 9. Testing and Verification Contract

| Gate | Command | What it proves |
|---|---|---|
| Self-check | `pnpm test` (`package.json:6` → `tsx src/selfcheck.ts && tsx src/verify-pack.ts`) | Kernel math + TEOB inmem lifecycle + timer step + projection all green, bit-for-bit replay |
| Cross-validate | `pnpm cross:validate` (`src/cross_validate.ts` + `scripts/cross_validate.py`) | 6 strategies vs Axelrod-Python within 5% on `winPct/cooperation` at `T=5 R=3 P=1 S=0`, 200 rounds ×20 reps |
| Determinism | `pnpm scenario example_model.json 600 --seed 42` twice | Identical `winPct/sensitivity`; missing/zero `values/drift` perform no extra `rng.unit()` calls so legacy seeds do not drift |
| Evolutionary invariants | `verify-pack.ts` (§2.x, §3.x, §4.y) | Replicator ESS, noise spiral, TFT vs ALLD, balanced accuracy vs retention/transition traps, payoff validity per game type |

Pure-function tests use `createAggregateTestKit` (`node_modules/@lambda-house/teob-ts/README.md:292`) — no DB/Docker, ms runtime:

```ts
const kit = createAggregateTestKit(runAggregate)
const {newState, result} = await kit.runAndApply(state, {tag:"StartRun", config, seed})
expect(result.events).toEqual([{tag:"RunStarted",...}])
```

---

## 10. Evolution Plan Aligned to TEOB Layers (`PROJECT_ARCHITECTURE §7`)

1. **Lock `teob-core`** — kernel + Generate/Contrite/Detective/ZD etc. + `AggregateTestKit` + invariants (done; `src/kernel.ts:88`, `src/verify-pack.ts`).
2. **Fixed teams `team/colluder`** — domain-only (`domain.ts:team`, `kernel.ts: effectiveStrategy` wrapper), no new TEOB primitives, requires `codecWithUpcasts` for old journals (done in analysis; upcast pending for `Run` config).
3. **`values`+`drift`** — isolated PR, `deriveSeed` isolation so `[0,0]` does not shift RNG (done in `src/kernel.ts:171`).
4. **Persistence `sqlite→postgres`** — replace `createSingleRuntime` with `createSqliteRuntime`/`createPostgresRuntime` — zero `decide/apply` change.
5. **HTTP/UI** — `aggregateRoutes/quickstart` + SSE live from `Run` events; `teob-projection` already covers read models, add `teob-saga` only if cross-aggregate needed.
6. **Agent-mode `SimulationRun+Participant`** — when single-conflict explainability is needed; justifies `ctx.ask/tell`, `ReplyDeferred`, `teob-ai`.
7. **Observability/scale** — `withTelemetry`, worker threads after profiling.

Each step is a strict superset of the previous, with green `pnpm test`.

---

## 11. File Map

```
src/domain.ts        — payoff validation, ScenarioModel/RunConfig, strategyIds[23], normalizeShares
src/rng.ts           — xorshift Rng + deriveSeed (determinism contract)
src/kernel.ts        — Strategy, playMatch(lean→noise→drift), tournament, evolve, stepGeneration
src/analysis.ts      — oneTrial/analyzeScenario/scenarioReport (batch Monte Carlo, team+perCapita, sensitivity)
src/run.ts           — Run aggregate (evolution loop), EffectControl timers, codecs, snapshots
src/projections.ts   — runSummary + strategySeries (teob-projection)
src/task.ts          — Task aggregate (scenario workflow; the aggregate the app registers)
src/task-projections.ts — taskSummary + taskDetail read models (teob-projection)
src/participant.ts   — Participant aggregate (per-player spike, self-check only; @ts-nocheck)
src/app-server.ts    — node:http + SSE server, createSqliteRuntime(Task), worker-thread analysis
src/spatial.ts       — lattice grid, imitate-best/fermi, coopRate/clusterCount (separate kernel)
src/cli.ts           — scenario/evolve/heatmap/tournament entry, --seed/--build determinism
src/feedback.ts      — buildSuggestions from winPct/cooperation/sensitivity
src/selfcheck.ts     — createSingleRuntime + projection verification
src/verify-pack.ts   — deterministic gates (tournament/ESS/noise/predictive metrics)
src/predictive.ts    — accuracy/balancedAccuracy/macroF1/retention-vs-transition/ECE/KL
src/evolution.ts     — replicator trajectory + Moran stub
src/tournament.ts    — ranking pool for SKILL advice
node_modules/@lambda-house/teob-ts/{README.md, docs/core.md, docs/inmem.md, docs/postgres.md}
```

---

## 12. What NOT to Do (enforced by this architecture)

* Do not persist per-move `MovePlayed` events in batch mode — it turns a seconds-long loop into hours.
* Do not store strategy state globally (`gradual._state`, `contrite_tft._intent`) — breaks purity of `apply` and `deriveSeed` determinism; use `(my,opp,rng)` history or closure with `reset()`.
* Do not mix hypotheses `team` + `values/drift` in one PR — attribution impossible.
* Do not add `teob-postgres/http/telemetry/ai/petrinet` before the corresponding product need — `sqlite` + `quickstart` cover demos; `ai/petrinet` only for LLM branches.
