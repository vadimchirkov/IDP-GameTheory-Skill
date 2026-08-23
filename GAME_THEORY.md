# Game Theory Implemented in Code

> Exhaustive mapping from game-theoretic concepts to live implementation in `src/`. Every rule cites its source file and line. Companion to `PROJECT_ARCHITECTURE.md` (TEOB side). Domain references: `src/domain.ts`, `src/kernel.ts`, `src/analysis.ts`, `src/spatial.ts`, `src/evolution.ts`, `src/tournament.ts`, `src/predictive.ts`, `src/rng.ts`, `src/feedback.ts`, `src/cli.ts`.

---

## 1. The Game Kernel: IPD Variants

### 1.1 Normal form (`src/domain.ts:2-22`)

```ts
type Move = "C"|"D"
type GameType = "prisoners_dilemma"|"chicken"|"stag_hunt"|"snowdrift"
Payoff {T,R,P,S}  // payoff[(my,opp)] in src/domain.ts:score
```

**The scope rule:** this engine plays *symmetric 2×2 simultaneous* games. The game type **is** the payoff ordering — nothing else in the kernel branches on it (`game` appears only inside `isValidPayoff`). Anything that is not 2×2 simultaneous does not belong in this enum.

| Game | `isValidPayoff` (`src/domain.ts:isValidPayoff`) | Story |
|---|---|---|
| `prisoners_dilemma` (default) | `T>R>P>S && 2R>T+S` | Mutual D bad but survivable; exploit tempts. Classic cartel/price-war. |
| `chicken` | `T>R>S>P` | Mutual D = crash (worst). Brinkmanship, arms race. |
| `stag_hunt` | `R>T>P>S` | Mutual C is best — coordination/trust game. |
| `snowdrift` | `T>R>S>P` — **alias of `chicken`** | Snowdrift/Hawk-Dove *is* Chicken: same ordering, same predicate. Kept as a naming convenience, verified identical in `verify-pack.ts:4.z`. |

**Deliberately absent.** `public_goods` and `trust` were removed: both were 2-player relaxations of the PD predicate with no matching mechanics anywhere in the kernel. A real public-goods game is N-player group play (contribution pot × multiplier, split among the group) and a real trust game is sequential with a continuous investment — neither is expressible in a symmetric 2×2 simultaneous match, so labelling them was an overclaim. Adding them means adding a group-play match loop, not a validation branch (see `ROADMAP.md`).

`2R>T+S` (`src/domain.ts:70`) prevents alternating `C/D, D/C` from beating steady `R` — the defining PD tension.

`score(payoff,my,theirs)` (`src/domain.ts:73`): `CC→R`, `CD→S`, `DC→T`, `DD→P`. Symmetric by default; asymmetric per-player tables when `payoffs: Record<string,PayoffRanges>` (`src/analysis.ts:18`).

### 1.2 Iterated form and horizon

Repeated play via `playMatch()` (`src/kernel.ts:171`). Horizon is sampled **per trial** (`src/analysis.ts:35`):

```ts
function geometricHorizon(w, rng){ let r=1; while(r<2000 && rng.unit()<w) r++; return r; } // src/analysis.ts:35
```

`w∈[0,0.9995]` (`src/domain.ts:97` `assertRange`) = per-round continuation probability ("shadow of the future"). `w≈0.99` → ~100 rounds expected. Cap 2000 avoids blowup. Where verbal horizon is irrelevant, fixed `rounds` in `RunConfig` (`src/domain.ts:54`).

### 1.3 Noise

`noise∈[0,1]` realistically `0..0.2` (`SKILL.md`). Applied **after** lean (`src/kernel.ts:201`): `if(rng.unit()<noise) move=flip(move)` per player per round. Models misread/mis-execution. Verification (`src/verify-pack.ts:45`): TFT/TFT at `noise=0.05` cooperation collapses `<0.7`; GTFT recovers above it.

### 1.4 Lean (`values`) and drift

`ScenarioPlayer.values?: Range` (`src/domain.ts:23`) — initial `lean∈[-1,1]` sampled via `rng.between(values)` (`src/analysis.ts:73`), absent → `0`.

Applied in `playMatch` (`src/kernel.ts:193`):
* `lean<0`: `C→D` with prob `-lean`
* `lean>0`: `D→C` with prob `lean`
* `lean==0`: no `rng.unit()` call — critical to keep legacy `seed=42` bit-for-bit identical (`src/kernel.ts:192` guard).

`drift∈[0,1]` per-`structure.drift` (`src/domain.ts:35`) sampled per trial (`src/analysis.ts:69`), `0` if absent. Update per round after scoring (`src/kernel.ts:208`):
```
leanA += (moveB==="D" ? -drift : +drift), clamped to [-1,1]
leanB += (moveA==="D" ? -drift : +drift)
```
On observed `D` lean goes down (more cynical), on `C` up. Order is strict: `strategy→lean→noise→history→drift` (`src/kernel.ts:190` comments + `SKILL.md`).

Sensitivity reports `value_<player>` per-player (`src/analysis.ts:125,166`) — average lean hides opposite leans that cancel.

### 1.5 Eco-evolutionary feedback (`structure.eco`, Weitz et al. 2016)

Optional. Couples a latent environment `n ∈ [0,1]` to how much a pair cooperates, so the game a match plays **drifts within the match** — the mechanism behind Weitz's "oscillating tragedy of the commons" (`DYNAMIC_MODELS.md:K.1`).

```
Π(n) = (1-n)·A0 + n·A1                 A0 = model.payoffs (healthy, n=0), A1 = eco.A1 (depleted, n=1)
dn/dt = ε·n(1-n)·[θ·c − (1−c)]         c = this round's cooperation fraction ∈ {0, 0.5, 1}
```

`EcoConfig` (`src/domain.ts`): `{ A1: PayoffRanges, game1?: GameType (default PD), theta: Range, epsilon: Range, n0: Range }`.

Per round (`src/kernel.ts:playMatch`, `eco` param): both sides score under the interpolated `Π(n) = lerp(A0, A1, n)`, then `n` updates via `ecoStep`. **Sub-stepping** (`steps = ceil(ε/0.05)`) bounds the Euler error when `ε>0.05`; `n` is clamped to `[0.01, 0.99]` each sub-step (`ROADMAP.md:1A` risk fix). Since linear interpolation preserves every ordering inequality, sampling A0 and A1 valid **once** makes every intermediate `Π(n)` a legitimate 2×2 matrix — no mid-match re-validation, even when A0 and A1 have different orderings and `Π(n)` crosses a boundary.

**Scope of the MVP:** eco requires a **shared** A0 (not per-player payoffs); each pairwise match runs its own environment starting at `n0` (exact Weitz for the 2-player case, a per-pair approximation for `>2` players). `oneTrial` samples `A1/θ/ε/n0` once per trial and threads an `EcoState` into every match; `analyzeScenario` reports `environment: {mean, std}` (final `n`, `→0` healthy / `→1` depleted) and adds `eco_theta/eco_epsilon/eco_n0` to both sensitivity lists.

Verification (`src/verify-pack.ts:6.1–6.2`): mutual C drives `n` up and mutual D down (coupling sign); the clamp holds under a violent `ε=0.9, θ=50`; a cooperating pair under a low-`R1` A1 scores **less** than under the static game (the tragedy — cooperation degrades its own future reward); non-eco matches emit no `envFinal` (legacy path bit-for-bit intact); schema rejects per-player payoffs + eco and unknown eco fields. Example: `example_eco.json` (two fishing fleets; the stock settles depleted `n≈0.71` even at ~68% cooperation).

### 1.6 Game transitions (`structure.transitions`, Su et al. 2019)

Optional. The **discrete** counterpart of eco: instead of a continuous resource, a match carries a discrete **game state**, and the round's outcome jumps it to the next state (`DYNAMIC_MODELS.md:I.1`). A cooperating pair can hold a rich game alive; a single defection tips the shared game into a poor one that takes sustained cooperation to climb back out of.

```
G^{t+1} = next[ outcome(a_t, b_t) ]      outcome ∈ {CC (both C), DD (both D), CD (exactly one D)}
Π_t = states[G^t]                        both sides score under the current state's matrix
```

`TransitionConfig` (`src/domain.ts`): `{ states: Record<name, PayoffRanges>, start: name, next: {CC, CD, DD: name} }`. The outcome key is the **edge's symmetric view** (`CD` = exactly one defected — resolves the `CD`/`DC` perspective ambiguity), matching Su's `Q: Record<CC|CD|DD, State>`.

Per round (`src/kernel.ts:playMatch`, `transition` param): both sides score under `states[cur]`, the round's outcome sets `cur = next[outcome]`, and per-state occupancy is tallied. Every state matrix is validated against the model's `game`, so all states share one ordering (Su's donation-game `b1` vs `b2`; cross-ordering PD↔Chicken of `I.4` is a future extension).

**Scope of the MVP:** transitions require a **shared** payoff table and are mutually exclusive with `eco` (schema-enforced — both encode a dynamic game). `oneTrial` samples every state matrix once per trial; each match opens at `start` (exact Su per-edge for 2 players). `analyzeScenario` reports `stateOccupancy` (mean fraction of rounds in each state). The pairwise engine faithfully reproduces the **effective-game synergy** — sustained cooperation reaching a richer game — but **not** the graph threshold `ρ_C>ρ_D ⇔ b1/c > k − ξ(k)·Δb/c`, which is a structured-population result requiring the spatial branch (not claimed).

Verification (`src/verify-pack.ts:7.1–7.2`): cooperators hold the rich state (occupancy ≈1) while defectors sink to the poor one; occupancy is a normalised distribution; sustained cooperation via transitions scores **more** than being locked in the poor game and **exactly** as much as being handed the rich game (Su synergy); non-transition matches emit no `stateOccupancy` (legacy path intact); schema rejects per-player payoffs, unknown/missing outcomes, undefined start/destination states, and eco+transitions together. Example: `example_transitions.json` (a cartel; the market sits "fat" ~63% of the time, tied to ~68% cooperation).

### 1.7 Voluntary participation — the `loner` opt-out (`structure.sigma`, Szabó & Hauert 2002)

`loner` (`M`) is a third option beside C and D: **refuse to play** and collect a guaranteed `σ`. It is resolved at the **match level**, not the move level — a loner has no C/D move function (its registry entry throws). Whenever either side of a pairwise match is a loner, both collect `σ` per round and no C/D game is played; the match is an abstention, excluded from the cooperation average. `σ` is `structure.sigma: Range`, sampled per trial; a `loner` disposition without `structure.sigma` is a schema error.

**Heterogeneous multi-game perception (Perc et al. 2014, `J.1`) is *already* expressible** and was deliberately **not** given its own knob: per-player `payoffs` let each side face a different `S` (`S=−Θ` → PD/fear, `S=+Θ` → Snowdrift/greed). Perc's headline result — heterogeneity *raising* cooperation — is a **structured-population** effect that provably **vanishes in a well-mixed population** (Perc §J.1); this engine is well-mixed round-robin, so a dedicated `multigame` knob would falsely imply the lattice amplification. That belongs to the topology phase (`ROADMAP.md` Phase 2), not here.

**Cyclic dominance, honestly scoped.** With `P < σ < R` the three types form a rock-paper-scissors: D exploits C, L (opt-out) beats D by dodging the mutual-defection grind, and C beats L because `σ < R`. This engine reproduces the **cyclic-dominance invasion structure** (`verify-pack.ts:8.1`: pairwise `D>C`, `L>D`, `C>L`) but **not** Hauert's closed-orbit coexistence cycle from an interior mix — that needs *abundance-weighted* replicator fitness, and `tournament` uses uniform round-robin fitness (a pre-existing kernel simplification, not changed here). Not claimed.

As a **scenario** option, `loner` is a walk-away / BATNA: a side that might opt out locks in `σ` instead of risking `S`. `oneTrial` awards `σ·rounds` to both sides of any loner match; `analyzeScenario` threads `sigma` into the sensitivity inputs. Verification (`src/verify-pack.ts:8.1–8.2`): cyclic dominance; a loner is never zeroed by an exploiter; a `loner` share with no `σ` throws; both-opt-out scenarios tie; the option to walk away never lowers a side's win rate; schema rejects a loner disposition without `sigma`. Example: `example_loner.json` (a freelancer/client with an outside option — giving both a walk-away depresses realised cooperation to ~27%).

---

## 2. Strategies (`src/kernel.ts:88`)

Signature (`src/kernel.ts:7`):
```ts
type Strategy = (mine: readonly Move[], theirs: readonly Move[], rng: Rng) => Move
```

Pure function of histories + RNG — no hidden state, deterministic given `(histories, derivedSeed)`. 22 temperaments (`src/domain.ts:strategyIds`) — this is the one authoritative count; README and `SKILL.md` quote the same list:

| Id | Code (`src/kernel.ts:88-161`) | Theory | Behaviour |
|---|---|---|---|
| `provocable` | `theirs.at(-1) ?? C` | TFT — Axelrod 1980 winner | Nice, provocable, forgiving, clear |
| `forgiving` | GTFT: on `D` forgive w/0.25 | Nowak & Sigmund Generous TFT | Cures noise spiral (`verify-pack.ts:45`) |
| `pavlov` | WSLS: if `opp[-1]==C` stay else flip | Nowak & Sigmund 1993 Pavlov | Win-Stay Lose-Shift |
| `grim` | `theirs.includes(D)?D:C` | Grim Trigger | Never forgives |
| `exploitative` | always `D` unless `D,D` then `C` | Probe/Exploiter | Backs off only on 2×D |
| `trusting` | `C` | ALLC | Baseline naive |
| `gradual` | `gradualPure` (`src/kernel.ts:54`) counts `defections`, punishes `n×D` then `2×C` calm | Beaufils et al. 1996 Gradual | Winner of noisy tournaments, no global `_state` — computed from `theirs` + phase accounting |
| `erratic` | `rng<0.5?C:D` | Random 50/50 | Noise control |
| `prober` | opening `[D,C,C]` then `theirs[1]==C&&theirs[2]==C?D:TFT` | Prober | Tests softness |
| `contrite` | if `lastMine==D&&lastTheirs==D&&mine[-2]==C` then `C` else TFT | Contrite TFT (Sugden) | Forgives own noise-induced D |
| `detective` | opening `[C,D,C,C]` then `theirs[0:4].includes(D)?TFT: D` | Detective | Exploits naive ALLC |
| `zd_generous` | `zdStrategy(ZD_BASELINE, 2, "R")` → `p=(1, 1/8, 1, 1/4)` | Stewart-Plotkin 2013 ZDGTFT-2 | Enforces `s_X-R=χ(s_Y-R)`, `χ=2`. `p1=1`: never defects after mutual C |
| `zd_extort` | `zdStrategy(ZD_BASELINE, 3, "P")` → `p=(9/13, 0, 7/13, 0)` | Press-Dyson 2012 Extortion | Enforces `s_X-P=χ(s_Y-P)`, `χ=3`. `p4=0`: never forgives mutual D |
| `colluder` | raw TFT but wrapped via `effectiveStrategy` (`src/analysis.ts:43`) | Fixed coalition | `sameTeam ? C : TFT` (noise after) |
| `adaptive` | `pOppC = theirs.filter(C)/len`, `target=0.5+(pOppC-0.3)` clamped | Glynatsi 2024 adaptive_rate | Calibrates to population `p(C)` |
| `southampton` | handshake `[D,D,C,C,D]` first 5 then `C` if kin else `D` (`src/kernel.ts:130`) | Southampton 2004 | Master/slave collective |
| `alld` | `D` | ALLD | Defect baseline |
| `allc` | `C` | ALLC alias | Coop baseline |
| `tf2t` | `D` only if `theirs[-2:]==[D,D]` | Tit-for-Two-Tats | Tolerates single noise |
| `semigrim` | `CC→C, DD→D, else 50/50` | Semi-Grim — human baseline | Stochastic |
| `memory2` | `makeMemoryN(probs,2)` Hilbe table (`src/kernel.ts:68`) | Memory-2 (Hilbe 2017) | 16-entry window `CC|CC` etc. |
| `shaper` | retaliate 0.8/0.2 + shaping `±0.3` by `coopRate>0.6` | Hand-tuned heuristic, **not** LOLA | Punishes the last D, eases off once the opponent is already cooperative |
| `loner` | opts out → both get `σ` (`structure.sigma`); no move fn, match-level | Voluntary participation (Szabó-Hauert 2002) | Walk-away / BATNA; needs `structure.sigma`, abstention excluded from cooperation |

Factory helpers (`src/kernel.ts`):
* `makeMemoryOne(pCC,pCD,pDC,pDD)` — memory-1 cube `[0,1]^4`
* `makeMemoryN(probs,n)` — window `mine[-n+k]+theirs[-n+k]` joined by `|`
* `zdVector(payoff, chi, anchor)` / `zdStrategy(...)` — canonical zero-determinant construction:

  ```
  p̃ = (p1-1, p2-1, p3, p4) = φ · [ (S_self − k) − χ (S_opp − k) ]
  S_self = (R,S,T,P),  S_opp = (R,T,S,P),  k = P (extortion) | R (generosity)
  φ = largest value keeping p1..p4 inside [0,1]
  ```

  This enforces `s_self − k = χ (s_opp − k)` on long-run averages **against any opponent**, which is the defining ZD property and is what `verify-pack.ts:5.3` actually measures (40k rounds vs ALLC/ALLD/Random/TFT/Pavlov). At `T,R,P,S = 5,3,1,0`, `χ=2`, `k=R` the construction reproduces Stewart & Plotkin's ZDGTFT-2 vector `(1, 1/8, 1, 1/4)` exactly.

  **Limit:** a ZD vector is exact only for the payoff table it was built from. The two registry entries are calibrated to `ZD_BASELINE = {T:5,R:3,P:1,S:0}`; under a scenario's own sampled payoffs they remain sensible memory-1 strategies but no longer enforce the relation exactly. Strategies receive no payoff argument (`Strategy = (mine, theirs, rng) => Move`), so making them payoff-exact means widening that signature.

Selection: per-player `dispositions: StrategyId[]` is a **set**, not a point estimate — `oneTrial` samples `rng.pick(dispositions)` (`src/analysis.ts:72`). First entry is modal for regime map (`SKILL.md`).

---

## 3. Tournament and Evolution (`src/kernel.ts:222`, `src/evolution.ts:6`)

### 3.1 Round-robin tournament

```ts
tournament(config, generation, rootSeed) // src/kernel.ts:222
  active = ids with share>0
  for i<=j over active, rep in 0..matchReps-1:
    playMatch(strategies[left],strategies[right], payoff,payoff, rounds, noise, new Rng(deriveSeed(rootSeed,generation,i,j,rep)))
    if left===right: score[left]+= (scoreA+scoreB)/2 else score[left]+=scoreA, score[right]+=scoreB
  fitness[id] = score[id] / divisor (divisor = active.length * matchReps) // src/kernel.ts:248
  cooperation = avg over matches
```

Self-play included. Determinism via `deriveSeed` per match, so parallelization stays reproducible.

Independent ranking pool for SKILL advice: `runTournament(model, rounds=200, seed=42)` (`src/tournament.ts`) — every named disposition vs every other, 5 reps, under the **model's own** game, sampled payoff and noise (previously hardcoded `T=5 R=3 P=1 S=0, noise=0`, so the ranking did not transfer to the scenario it advised on). The resolved `payoff`/`noise` are returned alongside `ranking`.

### 3.2 Evolution dynamics

* **Replicator** (continuous shares, deterministic) (`src/kernel.ts:262`):
  ```
  meanFitness = Σ shares[id]*fitness[id]
  scale = max(1, max|fitness-mean|)
  next[id] ∝ shares[id] * (1 + 0.5*(fitness[id]-mean)/scale)   // dampened Euler step dt=0.5
  normalizeShares(next)
  ```
  Verified: TFT resists 1% ALLD invasion over 20 gens (`src/verify-pack.ts:33`).

* **Moran** (finite `populationSize`, stochastic) (`src/kernel.ts:268`):
  ```
  parentWeights[id] ∝ shares[id]*(fitness[id]-min+ε)
  parent = weightedPick(parentWeights, rng)
  victim = weightedPick(shares, rng)
  shares[parent]+=1/N, shares[victim]-=1/N
  ```
  One birth-death event per `evolve` call, so a "generation" here is `1/N` of a full Moran generation. Fixation probabilities are **not** provided — the former `estimateFixation` was an unseeded random walk returning `≈1/N` regardless of payoff and has been deleted rather than left to look like a result.

`stepGeneration(config, shares, generation, seed)` (`src/kernel.ts:283`) = `tournament→evolve` one generation. `Run` aggregate calls this inside `decide` (`src/run.ts:77`).

`runEvolution(model, generations, seed)` (`src/evolution.ts`) — CLI `--evolve` helper. Builds a `RunConfig` from **the model's own** `game`, sampled payoff ranges and `noise` (it used to hardcode a PD table `T=4 R=3 P=1 S=0` and `noise=0.02`, so a chicken or stag-hunt scenario silently evolved under prisoner's-dilemma incentives). Fixed: `rounds=50, matchReps=5, replicator, pop 100`. Returns `trajectory: Generation[]`, `fixation` (final shares) and the resolved `config` so the payoff actually used is auditable — asserted in `verify-pack.ts:5.x`.

---

## 4. Scenario Analysis (Monte Carlo over Uncertainty)

The honest-inference discipline (`SKILL.md:28`): never report a single run; jiggle every guess, keep only conclusions that survive.

### 4.1 Scenario model (`src/domain.ts:30` / `SKILL.md:88`)

```json
{
  "situation": "one sentence",
  "game": "prisoners_dilemma|chicken|stag_hunt|snowdrift|...",
  "players": [{"name":"A","team":"coalition-1","dispositions":["colluder","provocable"],"values":[-0.2,0.3]}],
  "payoffs": {"T":[lo,hi],"R":[lo,hi],"P":[lo,hi],"S":[lo,hi]}  // or Record<string,PayoffRanges> per-player
  "structure": {"w":[lo,hi],"noise":[lo,hi],"drift":[lo,hi]},
  "topology": {"type":"lattice|small_world|scale_free","size":10,"K":0.1} // optional spatial switch
}
```

* Wide ranges — prose gives ordering, not magnitudes (`SKILL.md:38`).
* Per-player `payoffs` when stakes asymmetric (e.g., Iran vs coalition).
* `team` groups fixed coalitions; `colluder` plays `C` intra-team, `TFT` inter-team (`src/analysis.ts:43`). Winner = team with highest **total** score (`winPctTeam`), plus per-capita `winPctPerCapita` for different-size teams (`src/analysis.ts:118`), plus `champion` individual.
* `values`/`drift` optional; absent → bit-for-bit compat (`src/kernel.ts:192`).

Validation: `assertScenario` (`src/domain.ts:assertScenario`): rejects **unknown top-level and per-player fields** (a mistyped `value`/`betrayalprob` used to be silently ignored, so the intended lean never applied); ≥2 players, non-empty name/dispositions, known disposition, `values∈[-1,1]`, `betrayalProb∈[0,1]`; a `memory` table must be complete and well-formed (`assertMemoryTable`: every key a `CC/CD/DC/DD` window of one shared width, all `4^width` windows present, each `p∈[0,1]`); `w∈[0,0.9995]`, `noise/drift∈[0,1]`; `isValidPayoff` checked post-sampling (below).

### 4.2 One trial (`src/analysis.ts:oneTrial`)

```
assertScenario
w=noise=drift = rng.between(structure.*)
rounds = geometricHorizon(w)
payoffByName = samplePayoff(rangesFor(name), game) until isValidPayoff (≤300 attempts) or throw "Payoff ranges cannot satisfy <game>"
strategyByName = rng.pick(player.dispositions)
leanByName = rng.between(values) or 0
round-robin pairwise playMatch(effectiveStrategy(a, aId, teamOf(b)), effectiveStrategy(b, bId, teamOf(a)), payoffA,payoffB, rounds, noise, rng, leanA,leanB, drift)
  → summed raw scores → normaliseScore per player → team aggregation
inputs = {T,R,P,S,w,noise,drift, value_<name>...}   // averaged payoffs + per-player lean for sensitivity
```

`rounds` is geometrically sampled so the same `model` explores short vs long shadows; cap `MAX_ROUNDS=10_000` (5× the longest mean horizon `w=0.9995` can ask for) keeps geometric-tail truncation under ~1% — the old cap of 2000 truncated ~37% of trials at `w=0.9995`.

**Score normalisation (`normaliseScore`).** Raw points are not comparable across players with different payoff tables — a side denominated 100× larger would "win" every trial by construction. Each player's summed score is mapped onto the share of its own attainable range (`0` = suckered every round, `1` = exploited every round) *before* winner selection and team aggregation. Symmetric payoffs divide everyone by the same constant, so classic single-table rankings are unchanged; only mixed-scale asymmetric models are affected (`verify-pack.ts:4.zc`).

### 4.3 Aggregated result (`src/analysis.ts:analyzeScenario`)

```ts
analyzeScenario(model, trials=600, seed=42) // seed=42 default in src/cli.ts
  rng = new Rng(seed)
  runs = Array(trials).map(()=>oneTrial(model,rng))
  winPct[player] = 100 * Σ 1/|winners| per trial
  winPctTeam[team] similarly, perCapita analogously
  cooperation {mean, std} over runs
  sensitivity     = signed corr(input, cooperation), sorted by |corr|          // what moves cooperation
  sensitivityWin  = signed corr(input, top side wins), sorted by |corr|        // what moves the outcome
  sensitivityWinTarget = the top team (if teams) else top player
```

**Two sensitivity lists, both signed.** `sensitivity` used to take `|corr|` against cooperation only — but the skill's headline question is "who wins", and an input can leave cooperation flat while swinging the winner. So there are now two ranked lists (`sensitivity` for cooperation, `sensitivityWin` for the leading side's odds), and correlations keep their **sign** so the report can say whether an input *raises* or *lowers* the target rather than just "matters".

Leadership threshold: `winPct ≥60%` to claim robust lead, else `"No team/side has a robust lead"`. `scenarioReport()`: team line with `per-capita` parenthetical if teams present else player line, then the two pivots in plain words (`noise (lowers cooperation); w (raises Kestrel winning)`).

CLI (`src/cli.ts`): `pnpm scenario model.json [trials] [--seed N] [--build] [--evolve N] [--heatmap] [--tournament] [--visual]`. Two-block output: human `scenarioReport` + JSON `{winPct,winPctTeam,winPctPerCapita,cooperation,sensitivity,sensitivityWin,sensitivityWinTarget}`. `--seed 42` deterministic; omit for fresh sample.

---

## 5. Spatial / Network Reciprocity (`src/spatial.ts`)

`Grid = Move[][]` (`src/spatial.ts:5`). Topology (`src/domain.ts:36`) currently lightweight (`src/analysis.ts:49`): lattice default (`size` default 10), `small_world` injects random rewires with `prob 0.1`, `scale_free` seeds hubs (`size/3`). Full generators (grid_2d periodic, Watts-Strogatz, Barabási-Albert) are a planned swap-in (`node_modules/@lambda-house/teob-ts` layer is pure functions — no TEOB change needed).

Neighborhood: 4 von Neumann with periodic wrap (`neighbours` `src/spatial.ts:12` → `[[r-1,c],[r+1,c],[r,c-1],[r,c+1]] % size`).

Scoring (`src/spatial.ts:16`): `totalScore(r,c) = Σ score(payoff, me, neighbor)` over 4 neighbors.

Update rules (`src/spatial.ts:26`):
* **`imitate-best`**: each cell copies move of highest-scoring among `neighbors ∪ {self}`.
* **`fermi`** (`src/spatial.ts:39`): pick random neighbor `j`, adopt with `prob = 1/(1+exp((myScore-otherScore)/K))`, `K` default `0.1` (temperature; `K→0` greedy, `K→∞` random).

`stepSpatial` computes all scores synchronously, then writes `next` grid (`src/spatial.ts:26`). Metrics: `coopRate = #C / N²` (`src/spatial.ts:46`), `clusterCount` = BFS over `C` cells via same neighbor graph (`src/spatial.ts:50`).

**Where the lattice is (and isn't) used.** The lattice is a *separate kernel* from scenario analysis. It drives the `--visual` sandbox (`src/report.ts`) and can back an evolution game loop, but it does **not** feed `analyzeScenario`. The old `spatialTrial` path handed every player the same global cooperation number as a "score", so `winPct` came out a flat tie and `winPctTeam` reduced to team size — a confident wrong answer. That path is removed: `model.topology` no longer changes scenario winners (well-mixed round-robin always), and `src/cli.ts` prints a note saying so when a model carries `topology`. Wiring per-player lattice scores properly means mapping players → grid clusters, a real spatial branch (`ROADMAP.md`), not a placeholder.

Planned game events for the interactive lattice: `RunStarted(initialGrid)`, `GenerationCompleted{coopRate,clusterCount}`, `Painted(cells,strategy)`, `EventCardPlayed(card)` — shareable deterministic replays.

---

## 6. Coalitions (Fixed Teams)

Spec (`src/analysis.ts:effectiveStrategy`):

* Opt-in: `player.team?: string` (no team = singleton).
* `colluder` disposition: wrapper `effectiveStrategy(player, pickedId, oppTeam)` → same team ? `C` (or defect with `betrayalProb`) : `TFT`. Noise still applies after, so intent `C` may flip to `D`. The wrapper now composes with a custom `memory` table too — a colluder still plays TFT against outsiders even when its own base rule is a memory table (`verify-pack.ts:4.zd`), which the previous `a.memory ? … : …` branch broke.
* Winner metrics: total `teamScores[team] = Σ normalisedScores[member]` vs `perCapita = total / size`. `winPctTeam` (total) + `winPctPerCapita`. Total favours larger blocs (more members); report must show both.
* Scores are normalised per player (§4.2) *before* summing, so asymmetric payoff scales no longer decide the team winner by denomination alone.

`betrayalProb?: [0,1]` — intra-team defection probability — **is wired** (`effectiveStrategy`). The former forward-compat fields `handshakeSpoof` and `llmModel` are removed from the schema; `assertScenario` rejects them (and any other unknown key) rather than accepting them silently.

---

## 7. Memory, ZD, and Extended Strategies

* **Memory-1** cube: any `makeMemoryOne(pCC,pCD,pDC,pDD)`. `P(C | last (my,opp))`.
* **Memory-2**: `memory2` via `makeMemoryN` Hilbe table over `2^(2·2)=16` windows `CC|CC … DD|DD`. Generic `makeMemoryN` works for any `n`.
* **ZD** (`zdVector`/`zdStrategy`): canonical Press-Dyson construction, calibrated to `ZD_BASELINE={T:5,R:3,P:1,S:0}` — details and formula in §2 factory helpers. Verified by property (`s_self−k=χ(s_opp−k)` vs any opponent), not just by finiteness.
* **`memory` per-player** (`player.memory?: Record<string,number>`) — **wired**: a complete, validated `window→p(C)` table overrides the picked disposition via `memoryN` (`baseStrategy`), for any window width. Malformed tables are rejected at `assertScenario`.

---

## 8. Predictive Benchmarks (`src/predictive.ts`, `src/verify-pack.ts`, `src/bench-engine.ts` vs `scripts/live-bench.mjs`)

Two levels — do not conflate:

**A. Strategy move-level (A-level, `scripts/live-bench.mjs`, K=3 `prev→actual`)** — sanity that IPD has signal. Functions (`src/predictive.ts:7`):

| Function | Formula | Used for |
|---|---:|---|
| `accuracy` | `#pred==actual / n` | naive baseline |
| `f1` (C-positive) | `2PR/(P+R)` | — |
| `balancedAccuracy` | `(sens+spec)/2` | fixes 81% ALL-C inflation on MID |
| `macroF1` | `(F1_C+F1_D)/2` | symmetric |
| `confusionTransitions` | `c2c/d2d` retention vs `c2d/d2c` transition, `retentionAcc/transitionAcc` | inertia trap |
| `predictiveReport` | above + `f1C/f1D` | one call |
| `ece` | `Σ bn/n*|conf-acc|` bins=5 | calibration (strategy) |
| `klDivergence` | Laplace 0.5 | hist distance |

Honesty gate (`verify-pack.ts:4.z`): TIES 358y `ALL-D 69.3% → TFT 91.1%` is illusory: `balAcc ~50%, macroF1 low, retentionAcc>>transitionAcc`. Same for MID 81% ALL-C. Cross-val (`src/cross_validate.ts`) vs `axelrod-python`: `TFT vs ALLD TFT 199`, `ALLC vs ALLD 0:1000`, `TFT vs TFT 600:600, coop 1`, `GTFT coop> TFT` at 5% noise — within 5%.

**B. Engine scenario-level (B-level, `src/bench-engine.ts`, holdout) — the real ask** — engine's `winPct/100` as probabilistic forecast (Brier `Σ(p-o)²/n`, ECE `Σ bn/n*|conf-acc|`) + `cooperation.mean` vs observed rate (MAE). Baseline coin `p=0.5 → Brier 0.25` and hist-mean:

- **Synthetic 300 models (300 trials, 1 holdout):** Brier **0.23** vs 0.25 lift 0.02, ECE **0.05** calibrated, coop MAE **0.24**, winner acc **~58%** (normal — distribution, not point).
- **DF2011 6 treatments (δ,R vary):** naive TFT-only MAE **54.7pp** → elicited wide-SET (SKILL) **31.9pp** → hist-mean **25.9pp** / coin **28.3pp**. Elicited beats naive but still loses to hist-mean — needs `values/drift` or asymmetric payoffs to span 8→94% (honest misfit).
- **MID/TIES generic PD 88%:** MID 81% err **6pp** ok; TIES 54% err **33pp** > coin (4pp) — generic not sanction-aware (expected). Elicited per-context Chicken/asymmetric would be needed.

The move-level bench (`live-bench`) does not prove engine forecasts — it proves inertia predicts next year. Engine bench (`bench-engine`) proves calibration and where elicitation matters.

---

## 9. RNG and Determinism (`src/rng.ts`)

* `Rng` (`src/rng.ts:2`) — 32-bit xorshift (`state ^= state<<13; ^= >>17; ^= <<5`), `unit()=next/2^32`, `between([lo,hi])`, `pick(arr)`.
* `deriveSeed(root, ...parts)` (`src/rng.ts:33`) — FNV-1a mix, so `rootSeed=42` → per-match `new Rng(deriveSeed(root,generation,i,j,rep))` (`src/kernel.ts:236`). Parallel-safe.
* Banning `Math.random` ensures `--seed` reproducibility (`src/verify-pack.ts` deterministic gates). Lean zero-skip (`src/kernel.ts:193`) preserves legacy seed streams.

---

## 10. Feedback Loop (`src/feedback.ts`)

`buildSuggestions(model, result)` (`src/feedback.ts:4`):

| Signal | Tip |
|---|---|
| `maxWin<60` | widen `dispositions`, asymmetric payoffs, or add `team+colluder` |
| `coop<0.35` | lower `T`, or add `forgiving/contrite/gradual` |
| `coop>0.8 && std<0.15` | widen `noise/drift/values` to stress-test |
| `top sensitivity r>0.25` | narrow that input (noise→misread freq, w→horizon, drift→lean shift, `value_X`→cynicism/hope, payoff→range) |
| `>2 players && !team && maxWin<55` | add `team:"coalition-1"+colluder` |
| `!values && std>0.3` | add `values+drift` |
| `PD && coop>0.7 && top==T` | consider `chicken`/`stag_hunt` |

Invoked via `pnpm scenario model.json 600 --build` (`src/cli.ts:8`), writes `*.report.json` + `*.tips.md` (`src/cli.ts:51`).

---

## 11. Example Models (`example_*.json`)

| File | Situation | Game | Key knobs |
|---|---|---|---|
| `example_model.json` | Two startups, data-sharing pact | PD `T[4,6] R[3,4] P[1,2] S[-1,1]` | `w[0.6,0.97] noise[0,0.15]`, `Northwind{provocable,forgiving,exploitative}` vs `Kestrel{provocable,grim}` |
| `example_chicken.json` | Brinkmanship/standoff | Chicken `T>R>S>P` | Mutual D worst → swerve premium |
| `example_stag_hunt.json` | Joint venture / standard | Stag `R>T>P>S` | Mutual C best → trust |
| `example_team.json` | 2 colluders vs 2 solos | PD + `team` | `colluder` intra-C / inter-TFT, `winPctTeam` vs `perCapita` |
| `example_drift.json` | Forgiving vs prober with lean | PD + `values`/`drift` | `values[-1,1]` `drift[0..]` lean walk |
| `example_eco.json` | Two fishing fleets, shared stock | PD + `structure.eco` | Weitz `Π(n)`, `A1` depleted, `θ/ε/n0`; stock settles depleted despite cooperation |
| `example_transitions.json` | Fragile cartel: fat vs lean market | PD + `structure.transitions` | Su states `fat/lean`, `next` per outcome; market sits "fat" ~63% tied to cooperation |

All validated against `isValidPayoff(game)` (`src/domain.ts:isValidPayoff`).

---

## 12. What the Code Covers (and What It Doesn’t)

**Covers:** 2–10 players round-robin; 3 distinct payoff orderings (PD / Chicken≡Snowdrift / Stag Hunt); 22 temperaments (incl. canonical ZD, memory-2, per-player memory-n tables, adaptive, Southampton collective); asymmetric payoffs with per-player score normalisation; fixed `team/colluder` with `betrayalProb`; `values∈[-1,1]`+`drift` with correct `strategy→lean→noise→drift` order and per-player `value_*` sensitivity; **eco-evolutionary feedback** (`structure.eco`, Weitz `Π(n)` with sub-stepped Euler + clamp) reporting where the shared environment settles; **game transitions** (`structure.transitions`, Su discrete states driven by round outcome) reporting per-state occupancy; deterministic `deriveSeed`; 600-world Monte Carlo → `winPct/winPctTeam/winPctPerCapita/cooperation±std/environment/stateOccupancy` + two signed sensitivity lists (cooperation and winner); `winPct≥60` robustness bar; build tips; `--visual` lattice sandbox + heatmap; evolution `replicator/Moran` and a disposition ranking, both under the model's own game; benchmark backtests.

**Does not:** N-player group games (public goods) or sequential games (trust) — the enum is symmetric-2×2 only; cheap talk / signalling; emotion beyond a single scalar lean; spatial per-player scoring (the lattice is a separate sandbox, not fed into scenario winners); memory-n>2 as named registry entries (available via per-player `memory` tables instead); Shapley/core coalition solving; LLM-driven agents. Removed rather than left as misleading stubs: `public_goods`/`trust` games, the perpetual-`1/N` fixation estimator, the `lola`/`llm_agent` "strategies", and the `handshakeSpoof`/`llmModel` schema fields.

---

## 13. File Index

```
src/domain.ts        payoff types + GameType + ScenarioModel/RunConfig + isValidPayoff + assertScenario
src/rng.ts           Rng(xorshift) + deriveSeed
src/kernel.ts        Strategy, makeMemoryOne/N, zdVector/zdStrategy, gradualPure, strategies[22], playMatch, tournament, evolve, stepGeneration
src/analysis.ts      payoffRangesFor, samplePayoff, geometricHorizon, normaliseScore, effectiveStrategy, oneTrial, analyzeScenario, scenarioReport
src/spatial.ts       Grid, neighbours(wrap), totalScore, stepSpatial(imitate-best|fermi), coopRate, clusterCount (lattice sandbox)
src/evolution.ts     runEvolution (uses model's own game/payoff/noise)
src/tournament.ts    runTournament ranking (uses model's own game/payoff/noise)
src/predictive.ts    accuracy/f1/balancedAccuracy/macroF1/confusionTransitions/ece/kl/sweeps
src/verify-pack.ts   deterministic gates (tournament/ESS/noise/ZD-property/schema/normalisation/predictive)
src/feedback.ts      buildSuggestions
src/cli.ts           pnpm scenario entry (--seed/--build/--evolve/--heatmap/--tournament/--visual)
src/projections.ts   (TEOB side, read companion)
src/run.ts           (TEOB side, write companion)
```

