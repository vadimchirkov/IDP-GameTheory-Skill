# Case A — Evolutionary Strategy Sandbox (TEOB build spec, v2)

A "digital petri dish" where IPD strategies play, score, reproduce, and die out.
Built on TEOB, but with the event-sourcing kept **only where it earns its keep**.

> **v2 change (important):** the simulation is a **pure in-memory kernel**, not a
> swarm of aggregates. There is **one** durable entity — `Run` — that drives the
> kernel and persists experiment-level facts. See §2 for why.

---

## 1. Goal (one paragraph)

Simulate the **evolution of cooperation**: a population of prisoner's-dilemma
strategies plays round-robin matches, accumulates scores, and reproduces in
proportion to success while the weak die out. The operator tunes conditions (noise,
horizon, starting mix, payoff matrix), starts a run, and watches which behaviors
survive — live, reproducibly, with a durable, forkable experiment record.

**Success =** operator starts a run from the generic UI, watches strategy shares
shift live, can reproduce any run exactly from `(config, seed)`, and export results
for offline analysis.

---

## 2. Architecture: one entity, one kernel

### 2.1 Why not an aggregate per player/match

Naive count: population 100 → ~5000 matches/generation × 200 rounds × 200
generations = **~200M rounds per run**. Persisting a `MovePlayed` event per round,
or routing each move through cross-entity `ask`, makes a simulation that a tight loop
finishes in seconds take hours. **The durable journal — TEOB's strength — becomes a
millstone at per-move granularity.** And bit-for-bit reproducibility comes from
`(config, seed)`, *not* from replaying persisted moves — so per-move persistence buys
nothing you can't get by re-running the kernel.

Rule of thumb: **event-source the experiment, not the dice rolls.**

### 2.2 The split

```
┌─────────────────────────────────────────────┐
│  Kernel  (pure Scala, no framework, no I/O)  │  ← where correctness + speed live
│  simulateMatch · tournamentMatrix · evolve   │
└───────────────────▲─────────────────────────┘
                    │ called inside decide()
┌───────────────────┴─────────────────────────┐
│  Run  (the ONE TEOB aggregate)               │  ← where durability + UI live
│  persists: RunStarted, GenerationCompleted,  │
│            RunFinished                        │
└──────────────────────────────────────────────┘
```

- **Kernel** = plain functions, fully deterministic given a seeded `Random`. No
  persistence, no messaging. Runs thousands of matches per millisecond. This is where
  the game theory lives and where the self-checks run (§8, Phase 0).
- **Run** = the single long-lived entity. It uses exactly the TEOB features that pay
  off — durable events (→ free SSE live view + Delta export + ReadModel projections),
  timers (→ live generation-by-generation stepping), commands (→ interactive control).
  One entity, not thousands: cheap.

Entity-per-agent is the *right* model for B/C/D (LLM agents, humans, charging
stations — genuinely concurrent, durable, high-latency actors). It is the *wrong*
model for A. Keep it in your pocket, don't use it here.

---

## 3. The kernel (pure functions)

```
type Strategy = (myHist, oppHist, rng) => Move      // rng threaded in — REQUIRED
                                                    // for GTFT/memory-1/ZD/noise
simulateMatch(a: Strategy, b: Strategy, cfg, rng) -> (scoreA, scoreB)
  · loops `rounds` (or discounted horizon w)
  · applies noise ε (flip move via rng) inside the loop — noise is a kernel param
  · returns totals

tournamentMatrix(strategies, cfg, rng) -> Map[(StratId, StratId), (meanA, meanB)]
  · every pair incl. self-play, averaged over `matchReps` (stochastic strategies
    need repetitions or the matrix is noisy)

evolve(shares|population, matrix, rule, rng) -> next shares|population
  · rule = Moran   (finite population of individuals; one birth ∝ fitness + one death)
  · rule = Replicator (continuous shares; x_i += dt·x_i·(f_i − φ))
  · both consume the SAME payoff matrix — compute it once per generation
```

**Determinism contract (non-negotiable for reproducibility):**
- Global RNG is banned. `Random` is threaded through every function.
- If matches run in parallel, derive each match's sub-seed deterministically from
  `(runSeed, generation, matchIndex)`. Never share one RNG across parallel matches.

**Strategy registry:** `Map[StrategyId, Strategy]` — TFT, ALLD, ALLC, Grim, Pavlov,
GTFT, TF2T, memory-1 vectors, ZD. Adding a strategy = one registry entry.

---

## 4. The `Run` aggregate (the only entity)

Standard TEOB Command/Event/State/Reply.

- **State:** `config`, `seed`, `generation`, `shares: Map[StrategyId, Double]` (or the
  concrete population for Moran), `status: Running | Done`, rolling `cooperationRate`.
- **Commands:**
  - `StartRun(config, seed)` — seed `shares` from `config.initialMix`.
  - `StepGeneration` — self-tick: call `tournamentMatrix` then `evolve`, persist the
    result. Reschedule until `generation == generations`, then `RunFinished`.
  - `Pause` / `Resume` — cancel / reschedule the tick timer.
  - `GetState → Reply(shares, generation, status)`.
- **Events:**
  - `RunStarted(config, seed)`
  - `GenerationCompleted(generation, shares, meanScores, cooperationRate)`
  - `RunFinished(finalShares, winner?)`
- **`decide`:** on `StepGeneration`, run the kernel for one generation inside the
  handler, emit `GenerationCompleted`, `scheduleOnce(StepGeneration)` if not done.
- **Timers:** `scheduleOnce` between generations lets the operator watch evolution
  unfold live instead of blocking; `Pause` cancels the timer.

That's the whole write side. **~200 events per run** (one per generation), not 200M.

---

## 5. Config (all in `StartRun`)

| Knob            | Meaning                              | Default        |
|-----------------|--------------------------------------|----------------|
| `payoff`        | (T, R, P, S)                         | (5, 3, 1, 0)   |
| `rounds`        | rounds per match (or `w` discount)   | 200            |
| `matchReps`     | repetitions per pair (avg out noise) | 5              |
| `noise` (ε)     | move-flip probability                | 0.0            |
| `initialMix`    | starting strategy → share            | equal split    |
| `populationSize`| roster size (Moran; held constant)   | 100            |
| `generations`   | evolution steps                      | 200            |
| `rule`          | `moran` \| `replicator`              | replicator     |
| `runType`       | `ecological` \| `fixation`           | ecological     |
| `seed`          | RNG seed (reproducibility)           | fixed          |

- **`ecological` run:** fixed-size population evolving over generations → a
  *trajectory* of shares (the headline chart, shows the ALLD→TFT→GTFT cycle).
- **`fixation` run:** start `populationSize−1` residents + 1 mutant, `evolve` (Moran)
  until monomorphic, repeat many times → a *probability* the mutant takes over
  (compare to neutral `1/N`). Different output, same kernel. Add in Phase 5.

Always sweep `noise`, `rounds`, `initialMix`, and `rule` before trusting a
conclusion (see the "critical look" section of the methods doc).

---

## 6. Read side (projections & UI)

Free, because generation summaries are persisted events:

- **ReadModel projections** from the `Run` event stream:
  - `strategyShares` — % per strategy per generation (headline chart).
  - `leaderboard` — mean score per strategy.
  - `cooperationRate` — fraction of C over time (is the world getting nicer?).
- **Live UI:** built-in schema-driven backoffice + SSE `/api/system/stream`. Operator
  dispatches `StartRun` from the generic command form, watches shares shift live.
  Zero per-aggregate frontend code.
- **Offline analysis:** `DeltaExporter` → Delta Lake → pandas/Spark for sweeps,
  statistics, fixation estimates.

---

## 7. Why event-sourcing earns its keep (honest version)

Not "every move is auditable" (that's the expensive illusion). The real wins:

- **Operable experiment record:** each run is a compact stream of generation events —
  durable, queryable, forkable from any generation to test a counterfactual.
- **Reproducibility from `(config, seed)`:** re-run the kernel to reconstruct *any*
  detail, including individual matches, without storing them.
- **Free live view + offline dataset from one journal:** the same events feed the SSE
  dashboard and the Delta table — no second pipeline.

If you didn't need live operability + a durable, shareable record, you wouldn't need
TEOB for A at all — a plain script would do. That operability *is* the reason to
build A on TEOB.

---

## 8. Development sequence (simple → complex)

Each phase ships something usable and is a strict superset of the prior. Correctness
is nailed in pure code (Phase 0–1) before any framework complexity enters.

### Phase 0 — Kernel: one match, correct payoffs *(no framework)*
`simulateMatch` + strategy registry (TFT, ALLD, ALLC, Grim, Pavlov, GTFT, TF2T).
Plain Scala + tests. **Gate (self-check):** TFT vs ALLC ≈ 3/round; ALLD vs ALLC =
5/round; TFT vs ALLD → 99 over 100 rounds. Nothing proceeds until these pass.

### Phase 1 — Kernel: tournament + evolution *(no framework)*
`tournamentMatrix` (all pairs incl. self-play, `matchReps` averaging) → `evolve`
(replicator first — deterministic, easiest to verify; then Moran). Output a
shares-over-time array. **Gate:** reproduce the known qualitative cycle (defectors
rise, then TFT-likes dominate); replicator is deterministic given `seed`.

### Phase 2 — Wrap in the `Run` aggregate *(InMemory runtime)*
`StartRun` / `StepGeneration` / `GetState`; events `RunStarted` /
`GenerationCompleted` / `RunFinished`. Kernel called inside `decide`. **Gate:**
dispatching `StartRun` then polling `GetState` yields the same trajectory as Phase 1.

### Phase 3 — Live stepping + dashboard
`scheduleOnce`-driven auto-stepping + `Pause`/`Resume`; `strategyShares` /
`cooperationRate` ReadModel projections; SSE live chart in the built-in UI. **Gate:**
operator starts a run in the browser and watches shares move.

### Phase 4 — Noise + parameter honesty
Add `noise ε` to the kernel loop and `matchReps`. **Gate:** at ε=0.05, TFT sags and
GTFT/TF2T/Pavlov rise — the forgiveness effect. Confirms the noise knob works.

### Phase 5 — Persistence, Delta export, fixation mode
Swap InMemory → Postgres journal; `DeltaExporter` → Delta; validate a pandas plot of
shares over time. Add `runType = fixation`. **Gate:** a killed-and-replayed run
reproduces; fixation probability of a neutral mutant ≈ `1/N`.

### Phase 6 — Branch point (pick a successor case)
The kernel's `Strategy` registry and payoff function are the seams:
- **Case B (LLM agents):** replace a registry entry with a `teob-ai` agent (now the
  per-agent latency justifies making agents real entities — different architecture).
- **Spatial:** replace round-robin with a graph; players play only neighbors.
- **Case D (energy):** replace the payoff matrix with charging/grid economics.

**Ship Phase 0 first.** Everything above is worthless if the payoffs are wrong.

---

## 9. Out of scope for A

- LLM-agent strategies → Case B.
- Spatial/network topology → spatial variant.
- Human players / product UI → Case C.
- EV-charging domain mapping → Case D.

Keep A generic and small: it is the engine the others bolt onto.
