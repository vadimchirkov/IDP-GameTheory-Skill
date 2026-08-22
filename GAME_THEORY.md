# Game Theory Implemented in Code

> Exhaustive mapping from game-theoretic concepts to live implementation in `src/`. Every rule cites its source file and line. Companion to `PROJECT_ARCHITECTURE.md` (TEOB side). Domain references: `src/domain.ts`, `src/kernel.ts`, `src/analysis.ts`, `src/spatial.ts`, `src/evolution.ts`, `src/tournament.ts`, `src/predictive.ts`, `src/rng.ts`, `src/feedback.ts`, `src/cli.ts`.

---

## 1. The Game Kernel: IPD Variants

### 1.1 Normal form (`src/domain.ts:2-22`)

```ts
type Move = "C"|"D"
type GameType = "prisoners_dilemma"|"chicken"|"stag_hunt"|"snowdrift"|"public_goods"|"trust"
Payoff {T,R,P,S}  // payoff[(my,opp)] in src/domain.ts:73
```

| Game | `isValidPayoff` (`src/domain.ts:64`) | Story |
|---|---|---|
| `prisoners_dilemma` (default) | `T>R>P>S && 2R>T+S` | Mutual D bad but survivable; exploit tempts. Classic cartel/price-war. |
| `chicken` | `T>R>S>P` | Mutual D = crash (worst). Brinkmanship, arms race. |
| `stag_hunt` | `R>T>P>S` | Mutual C is best — coordination/trust game. |
| `snowdrift` | `T>R>S>P` | Like Chicken but S vs P swapped; free-rider still survives. |
| `public_goods` | `R>P && T>S` | N-player goods game relaxed ordering. |
| `trust` | `T>R>P` | Trust/investment game stub. |

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

---

## 2. Strategies (`src/kernel.ts:88`)

Signature (`src/kernel.ts:7`):
```ts
type Strategy = (mine: readonly Move[], theirs: readonly Move[], rng: Rng) => Move
```

Pure function of histories + RNG — no hidden state, deterministic given `(histories, derivedSeed)`. 23 temperaments (`src/domain.ts:39`):

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
| `zd_generous` | `zdGenerousStrategy()` (`src/kernel.ts:36`) `chi=0.5, phi=0.15` | Stewart-Plotkin 2013 ZDGTFT-2 | Enforces `s_X-R=χ(s_Y-R)` generous |
| `zd_extort` | `zdExtortStrategy()` (`src/kernel.ts:45`) `chi=2.0` | Press-Dyson 2012 Extortion | Enforces `s_X-P=χ(s_Y-P)` |
| `colluder` | raw TFT but wrapped via `effectiveStrategy` (`src/analysis.ts:43`) | Fixed coalition | `sameTeam ? C : TFT` (noise after) |
| `adaptive` | `pOppC = theirs.filter(C)/len`, `target=0.5+(pOppC-0.3)` clamped | Glynatsi 2024 adaptive_rate | Calibrates to population `p(C)` |
| `southampton` | handshake `[D,D,C,C,D]` first 5 then `C` if kin else `D` (`src/kernel.ts:130`) | Southampton 2004 | Master/slave collective |
| `alld` | `D` | ALLD | Defect baseline |
| `allc` | `C` | ALLC alias | Coop baseline |
| `tf2t` | `D` only if `theirs[-2:]==[D,D]` | Tit-for-Two-Tats | Tolerates single noise |
| `semigrim` | `CC→C, DD→D, else 50/50` | Semi-Grim — human baseline | Stochastic |
| `memory2` | `makeMemoryN(probs,2)` Hilbe table (`src/kernel.ts:68`) | Memory-2 (Hilbe 2017) | 16-entry window `CC|CC` etc. |
| `lola` | retaliate 0.8/0.2 + shaping `±0.3` by `coopRate>0.6` (`src/kernel.ts:77`) | LOLA stub (Foerster 2018) | Opponent-learning awareness approx. |
| `llm_agent` | `theirs.at(-1)??C` | LLM agent placeholder | Swapped for `teob-ai` in future branch |

Factory helpers (`src/kernel.ts:13,27,163`):
* `makeMemoryOne(pCC,pCD,pDC,pDD)` — memory-1 cube `[0,1]^4`
* `makeMemoryN(probs,n)` — window `mine[-n+k]+theirs[-n+k]` joined by `|`
* `zdGenerous/zdExtort` clamp via `clamp(x)=max(0,min(1,x))` (`src/kernel.ts:11`) then `makeMemoryOne(p1..p4)`. (Note: repo uses a simplified ZD parameterization; canonical formulas differ per Press-Dyson — flagged for future alignment.)

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

Independent ranking pool for SKILL advice: `runTournament(model, rounds=200)` (`src/tournament.ts:9`) — every disposition vs every disposition, 5 reps, payoff `T=5 R=3 P=1 S=0`, `noise=0`.

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
  Stub fixation: `estimateFixation(mutant,resident,trials,N)` (`src/evolution.ts:19`) — random walk placeholder (not yet payoff-derived drift).

`stepGeneration(config, shares, generation, seed)` (`src/kernel.ts:283`) = `tournament→evolve` one generation. `Run` aggregate calls this inside `decide` (`src/run.ts:77`).

`runEvolution(model, generations, seed)` (`src/evolution.ts:6`) — CLI `--evolve` helper: builds synthetic `RunConfig` (`payoff T=4 R=3 P=1 S=0, rounds=50, noise=0.02, replicator, pop 100`) from scenario's disposition pool, runs `stepGeneration` loop, returns `trajectory: Generation[]` + `fixation` (final shares).

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

Validation: `assertScenario` (`src/domain.ts:85`): ≥2 players, non-empty name/dispositions, known disposition, `values∈[-1,1]`, `betrayalProb∈[0,1]`, `handshakeSpoof` int, `w∈[0,0.9995]`, `noise/drift∈[0,1]`; `isValidPayoff` checked post-sampling (below).

### 4.2 One trial (`src/analysis.ts:64`)

```
assertScenario
w=noise=drift = rng.between(structure.*)
rounds = geometricHorizon(w) // or spatial gens
payoffByName = samplePayoff(rangesFor(name), game) until isValidPayoff (≤300 attempts) or throw "Payoff ranges cannot satisfy <game>" // src/analysis.ts:27
strategyByName = rng.pick(player.dispositions)
leanByName = rng.between(values) or 0
if topology: spatialTrial → cooperation + per-player scores ∝ coop
else: round-robin pairwise playMatch(effectiveStrategy(aTeam,bTeam), effectiveStrategy(...), payoffA,payoffB, rounds, noise, rng, leanA,leanB, drift) → summed scores + cooperation per match → team aggregation
inputs = {T,R,P,S,w,noise,drift, value_<name>...} // averaged payoffs + per-player lean for sensitivity
```

`rounds` is geometrically sampled so the same `model` explores short vs long shadows; cap 2000 ensures `2R>T+S` signal not swamped.

### 4.3 Aggregated result (`src/analysis.ts:152`)

```ts
analyzeScenario(model, trials=600, seed=42) // seed=42 default in src/cli.ts:19
  rng = new Rng(seed)
  runs = Array(trials).map(()=>oneTrial(model,rng))
  winPct[player] = 100 * Σ 1/|winners| per trial
  winPctTeam[team] similarly, perCapita analogously
  cooperation {mean, std} over runs
  sensitivity = |corr(input, cooperation)| per input in [T,R,P,S,w,noise,drift] + value_* sorted desc // src/analysis.ts:135,175
```

Leadership threshold: `winPct ≥60%` to claim robust lead, else `"No team/side has a robust lead"` (`src/analysis.ts:184`). Reported in `scenarioReport()` (`src/analysis.ts:179`): team line with `per-capita` parenthetical if teams present, else player line.

CLI (`src/cli.ts:12`): `pnpm scenario model.json [trials] [--seed N] [--build] [--evolve N] [--heatmap] [--tournament]`. Two-block output: human `scenarioReport` + JSON `{winPct,winPctTeam,winPctPerCapita,cooperation,sensitivity}`. `--seed 42` deterministic; omit for fresh sample.

---

## 5. Spatial / Network Reciprocity (`src/spatial.ts`)

`Grid = Move[][]` (`src/spatial.ts:5`). Topology (`src/domain.ts:36`) currently lightweight (`src/analysis.ts:49`): lattice default (`size` default 10), `small_world` injects random rewires with `prob 0.1`, `scale_free` seeds hubs (`size/3`). Full generators (grid_2d periodic, Watts-Strogatz, Barabási-Albert) are a planned swap-in (`node_modules/@lambda-house/teob-ts` layer is pure functions — no TEOB change needed).

Neighborhood: 4 von Neumann with periodic wrap (`neighbours` `src/spatial.ts:12` → `[[r-1,c],[r+1,c],[r,c-1],[r,c+1]] % size`).

Scoring (`src/spatial.ts:16`): `totalScore(r,c) = Σ score(payoff, me, neighbor)` over 4 neighbors.

Update rules (`src/spatial.ts:26`):
* **`imitate-best`**: each cell copies move of highest-scoring among `neighbors ∪ {self}`.
* **`fermi`** (`src/spatial.ts:39`): pick random neighbor `j`, adopt with `prob = 1/(1+exp((myScore-otherScore)/K))`, `K` default `0.1` (temperature; `K→0` greedy, `K→∞` random).

`stepSpatial` computes all scores synchronously, then writes `next` grid (`src/spatial.ts:26`). Metrics: `coopRate = #C / N²` (`src/spatial.ts:46`), `clusterCount` = BFS over `C` cells via same neighbor graph (`src/spatial.ts:50`).

Integration (`src/analysis.ts:49`): `gens = max(10, round(horizon/2))`, random initial `C/D`, optional topology injection, `noise` random flips per generation, kernel steps with `fermi`; returned `cooperation` = average `coopRate` over gens, per-player scores synthetic `high coop → high score` placeholder (proper bijective mapping when `model.topology` is primary; currently illustrative).

Planned game events for the interactive lattice: `RunStarted(initialGrid)`, `GenerationCompleted{coopRate,clusterCount}`, `Painted(cells,strategy)`, `EventCardPlayed(card)` — shareable deterministic replays.

---

## 6. Coalitions (Fixed Teams)

Spec (`PROJECT_ARCHITECTURE §5`, `SKILL.md:61`, `src/analysis.ts:115`):

* Opt-in: `player.team?: string` (no team = singleton).
* `colluder` disposition (`src/kernel.ts:123` raw `TFT`): wrapper `effectiveStrategy` (`src/analysis.ts:43`) → `sameTeam ? always C : TFT`. Noise still applies after, so intent `C` may flip to `D`.
* Winner metrics: total `teamScores[team] = Σ scores[member]` (`src/analysis.ts:115`) vs `perCapita = total / size` (`src/analysis.ts:118`). `winPctTeam` (total) + `winPctPerCapita`. Total favors larger blocs (more internal pairs); report must show both.
* Caveat: do not sum scores with incomparable asymmetric payoff scales without normalization (flagged, not yet auto-normalized).

Future (in `src/domain.ts:24` fields, not yet wired): `betrayalProb?: [0,1]` and `handshakeSpoof?: number` for dynamic-coalition MVP — colluder betrays team with prob after `k` rounds; handshake-spoofing to impersonate kin. Schema validated (`src/domain.ts:94`), kernel hook pending.

---

## 7. Memory, ZD, and Extended Strategies

* **Memory-1** cube: any `makeMemoryOne(pCC,pCD,pDC,pDD)` (`src/kernel.ts:13`). `P(C | last (my,opp))`.
* **Memory-2** (`src/kernel.ts:68`): `memory2` via `makeMemoryN` Hilbe table over `2^(2*2)=16` windows `CC|CC … DD|DD`. Helper generic `makeMemoryN` (`src/kernel.ts:27`) works for any `n`.
* **Generous ZD** (`src/kernel.ts:36`) and **Extort ZD** (`src/kernel.ts:45`) both as memory-1 vectors. Simplified params in repo: `chi`, `phi`, `R=3 S=0 T=5 P=1`. A TODO is to align `p2/p3/p4` with canonical Press-Dyson / Stewart-Plotkin formulas when introducing the `GameGym` sweep.
* **`memory` per-player** (`src/domain.ts:26` `memory?: Record<string,number>`) — extension point for arbitrary `window→p(C)` maps, not yet consumed beyond `memory2`.
* **`llmModel?` / `llm_agent`** (`src/domain.ts:27`, `src/kernel.ts:160`) — placeholder for `teob-ai agentFlowAggregate` when swapping a registry entry for an LLM prompt loop.

---

## 8. Predictive Benchmarks (`src/predictive.ts`, `src/verify-pack.ts`)

TEOB-agnostic evaluation of move prediction (`C/D` sequence):

| Function (`src/predictive.ts:7`) | Formula |
|---|---|
| `accuracy` | `#pred==actual / n` |
| `f1` (C-positive) | `2PR/(P+R)` with `P=TP/(TP+FP)`, `R=TP/(TP+FN)` |
| `balancedAccuracy` | `(sens+spec)/2` — fixes class-imbalance inflation |
| `macroF1` | `(F1_C + F1_D)/2` — symmetric |
| `confusionTransitions` | Per-transition accuracy: `c2c/d2d` (retention) vs `c2d/d2c` (transition), plus aggregates `retentionAcc`/`transitionAcc` |
| `predictiveReport` | Collects all above + `f1C/f1D` |
| `ece` | Expected Calibration Error, `bins=5`, `Σ bn/n * |conf-acc|` |
| `klDivergence` | Smoothed histogram KL, Laplace `0.5` |
| `crossConditionSweep` | `w∈[0.5…0.99]` vs `coop` for `TFT vs GTFT` at `noise=0.05` |
| `payoffRatioSweep` | `I` (temptation via `R`) vs `coop` for `TFT vs TFT` |

Honesty gates (`src/verify-pack.ts:157`): synthetic `TIES` 358y trace shows `ALL-D` 69.3% → TFT 91.1% accuracy is illusory; `balancedAccuracy ~50%`, `macroF1` low, `retentionAcc >> transitionAcc` (inertia). Regression (`src/verify-pack.ts:4-122`): tournament benchmarks, replicator ESS, noise spiral, payoff validity per game, snowdrift, predictive metrics.

Cross-validation (`src/cross_validate.ts:9`): `TFT vs ALLD → TFT loses (scoreA=199 in 200r)`, `ALLC vs ALLD 1000:0`, `TFT vs TFT 600:600`, `GTFT coop > TFT coop` at 5% noise — within 5% of `axelrod-python`.

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

All validated against `isValidPayoff(game)` (`src/domain.ts:64`).

---

## 12. What the Code Covers (and What It Doesn’t)

**Covers:** 2–10 players round-robin; 6 payoff orderings; 23 temperaments (incl. ZD, memory-2, adaptive, Southampton collective); asymmetric payoffs; fixed `team/colluder`; `values∈[-1,1]`+`drift` with correct `strategy→lean→noise→drift` order and per-player `value_*` sensitivity; spatial `imitate-best`/`Fermi` lattice; deterministic `deriveSeed`; 600-world Monte Carlo → `winPct/winPctTeam/winPctPerCapita/cooperation±std/sensitivity`; `winPct≥60` robustness bar; build tips; heatmap/trajectory reporting; evolution `replicator/Moran` (tournament+stepGeneration); benchmark backtests.

**Does not** (explicit limits, `README.md:177`): dynamic mid-game betrayal/handshake spoofing (fields exist, kernel hook pending), single lean not emotion/cheap talk, spatial vs well-mixed are exclusive kernels, LLM/memory-n>2 limited to stubs, no Shapley/core coalition solving, saint-sacrifice `master/slave` tradeoffs only schematic.

---

## 13. File Index

```
src/domain.ts        payoff types + GameType + ScenarioModel/RunConfig + isValidPayoff + assertScenario
src/rng.ts           Rng(xorshift) + deriveSeed
src/kernel.ts        Strategy, makeMemoryOne/N, zdGenerous/Extort, gradualPure, strategies[23], playMatch, tournament, evolve, stepGeneration
src/analysis.ts      payoffRangesFor, samplePayoff, geometricHorizon, effectiveStrategy(team), spatialTrial, oneTrial, analyzeScenario, scenarioReport
src/spatial.ts       Grid, neighbours(wrap), totalScore, stepSpatial(imitate-best|fermi), coopRate, clusterCount
src/evolution.ts     runEvolution, estimateFixation
src/tournament.ts    runTournament ranking
src/predictive.ts    accuracy/f1/balancedAccuracy/macroF1/confusionTransitions/ece/kl/sweeps
src/verify-pack.ts   deterministic gates (tournament/ESS/noise/predictive/stability)
src/feedback.ts      buildSuggestions
src/cli.ts           pnpm scenario entry (--seed/--build/--evolve/--heatmap/--tournament)
src/projections.ts   (TEOB side, read companion)
src/run.ts           (TEOB side, write companion)
```

