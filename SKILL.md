---
name: game-theory-scenarios
description: >
  Analyze an ongoing relationship or repeated strategic situation by running it
  through a game-theory (iterated prisoner's dilemma) simulator many times and
  drawing robust conclusions. Use when the user describes a situation with 2+
  parties who interact repeatedly — negotiations, partnerships, rivalries, team
  dynamics, alliances, deterrence, price wars — and wants to know what will
  happen, who prevails, whether cooperation holds, or what to do. Triggers:
  "run this through game theory", "simulate this situation", "what happens if",
  "model these players", "should I cooperate/defect", "war-game this".
---

# IPD (Game-Theory Scenarios) — scenario simulator

Turn a prose situation into a repeated-game model, Monte-Carlo it, and report
**only what survives the uncertainty**. The engine is `src/cli.ts` on the
[`teob-ts`](https://github.com/lambda-house/teob-ts) kernel — **Type-safe Event-sourcing Over Behaviours** (pure `Aggregate`/`Effect`/`Codec`/`Projection`, TEOB: DDD + Event Sourcing + CQRS + Actor) — (`src/kernel.ts` + `src/analysis.ts` + `src/rng.ts`, background in `GAME_THEORY.md` and `PROJECT_ARCHITECTURE.md`). Your job is the two ends the engine can't do: honest elicitation (stage 1) and honest interpretation (stage 3).

Plain version of what this does: someone describes a situation where 2–10 sides
keep dealing with each other (a rivalry, partnership, standoff, or coalition vs coalition). You guess the
stakes as ranges, run the situation hundreds of times with those guesses jiggled,
and report only the conclusions that hold up no matter how the guesses land.

## The discipline in one line

A payoff pulled from prose is a **guess**. Never report a single run. Sample the
uncertainty, and only trust a conclusion that holds across most plausible worlds.

## Stage 1 — Elicit the model (this is where it lives or dies)

Read the situation. Produce a JSON model (schema below). Rules that keep it real:

1. **Ordering before magnitude.** You can almost always tell, from the prose, the
   *rank* of outcomes for a party — depends on `game`: PD `T>R>P>S`,
   chicken `T>R>S>P`, stag hunt `R>T>P>S`. You almost never know exact numbers.
   So commit to the ordering; keep magnitudes as **wide ranges**. The simulator
   enforces `isValidPayoff(game)` and will reject an inconsistent model — good,
   that catches sloppy elicitation.
2. **Anchor every payoff to a real stake.** Fill `rationale` with one line per
   payoff tying it to something in the situation ("R ≈ keeping the deal alive,
   worth about a normal quarter"). If you can't justify it, widen the range.
3. **Dispositions as a SET, not a guess.** You rarely know a party is purely one
   type. List every plausible disposition for each player; the simulator samples
   among them, so "what if they're more vindictive than I think" is tested
   automatically. Available (22): `provocable` (TFT), `forgiving` (GTFT, forgives 25%),
   `pavlov` (WSLS), `grim` (never forgives), `exploitative` (probes, backs off only on 2×D),
   `trusting` (ALLC), `gradual` (Beaufils: n-th defection → n×D then 2×C), `erratic` (50/50),
   `prober` ([D,C,C] probe), `contrite` (forgives own noise-induced D), `detective` ([C,D,C,C]→TFT else ALLD),
   `zd_generous` (Stewart-Plotkin ZDGTFT-2, generous ZD χ=2, `p=[1,1/8,1,1/4]` — shares the surplus, never out-scores you), `zd_extort` (Press-Dyson extortion χ=3, `p=[9/13,0,7/13,0]` — keeps a 3× share of any surplus, never forgives mutual D),
   `colluder` (team: C vs teammate / TFT vs outsider), `adaptive` (Glynatsi: `p(C)=0.5+(pOppC-0.3)`), `southampton` (handshake `[D,D,C,C,D]`→C if kin else D), `alld` (ALLD), `allc` (ALLC alias), `tf2t` (Tit-for-Two-Tats), `semigrim` (Semi-Grim: C after CC, D after DD, else 50/50 — human baseline), `memory2` (Hilbe memory-2 table), `shaper` (retaliate hard, ease off once opponent is cooperative).
4. **Structure = horizon and noise, as ranges.**
   - `w` (0–0.9995, `assertRange` cap): probability the relationship continues each
     period. High w = long shadow of the future. Unknown end date → wide range.
     Horizon in rounds is `geometricHorizon(w)` capped at 2000 (`analysis.ts:31`).
   - `noise` (0–1, realistically 0–0.2): chance a move is misread as its opposite
     (a rep goes off-script, a message is misinterpreted). Real relationships are
     never 0.
   - `drift` (0–1, optional): how fast lean shifts after each observed move — after
     observed D lean `−=drift`, after C `+=drift`, clamped to `[-1,1]` (`kernel.ts:playMatch` order `strategy→lean→noise→drift`).
   - `eco` (optional): a **shared resource that the players' own behaviour depletes or restores**, shifting the game itself *continuously* as they play (fisheries, groundwater, soil, a shared brand, trust in an institution). Use it only when "the pie itself changes smoothly with how they act" is central to the story — otherwise skip it. Shape: `"eco": {"A1": {T,R,P,S ranges}, "game1": "prisoners_dilemma", "theta": [lo,hi], "epsilon": [lo,hi], "n0": [lo,hi]}`. `A0` is your normal `payoffs` (the healthy state); `A1` is the **depleted** game where even mutual restraint pays little; `theta` = how strongly cooperation replenishes the resource; `epsilon` = how fast the resource responds (0.05–0.3 typical); `n0` = how healthy it starts (0 healthy → 1 depleted). Requires a **shared** payoff table (not per-player). The report adds where the resource settles (`environment`) and `eco_theta/eco_epsilon/eco_n0` sensitivities. See `example_eco.json`. **Read it in Stage 3 as:** does restraint actually keep the commons alive, or does the resource slide to depleted no matter how well they behave?
   - `transitions` (optional): the **discrete** cousin of `eco` — the situation flips between *named regimes* depending on the last outcome, and it is hard to climb back once it tips (a cartel that holds price vs a price-war commodity market; peace vs an active feud; a healthy partnership vs a broken one). Use it when the story has clear **modes** rather than a smoothly draining resource. Shape: `"transitions": {"states": {"good": {T,R,P,S ranges}, "bad": {...}}, "start": "good", "next": {"CC": "good", "CD": "bad", "DD": "bad"}}`. Each state is a full payoff table (same game ordering); `next` says where each outcome sends the shared regime — `CC` = both cooperate, `DD` = both defect, `CD` = exactly one defects. Requires a **shared** payoff table and can't be combined with `eco`. The report adds `stateOccupancy` (share of time in each regime). See `example_transitions.json`. **Read it in Stage 3 as:** which regime does the relationship spend most of its time in, and how easily does one slip trap it in the bad one?
5. **Teams (fixed coalitions).** `players[].team?: string` — without it each player
   is its own team. `colluder` plays C vs teammate, TFT vs outsider (noise after).
   Winner is team with highest total score (`winPctTeam`), per-capita `winPctPerCapita` shown for different-size teams; `champion` is best individual (`winPct`).
6. **Values = initial lean.** `players[].values?: [-1,1]` — `-1` flips C→D with prob 1,
   `+1` flips D→C with prob 1, `0` neutral. Lean then drifts as above. Omit or `[0,0]` = bit-for-bit compatible (no extra `rng.unit()` call).
7. **Asymmetric stakes when sides differ.** If one party has far more to lose or
   less to gain (e.g. closing the strait self-harms Iran), give each player its own
   payoff table instead of one shared one — see the two `payoffs` forms below. Use
   shared payoffs only when both sides genuinely face the same stakes.
8. **Pick the game type — don't force everything into the prisoner's dilemma.** Ask
   what mutual escalation means in this situation:
   - Mutual defection is bad but survivable, and defecting is tempting → `"game":
     "prisoners_dilemma"` (default). Ordering `T>R>P>S`.
   - Mutual escalation is the **worst** outcome — a head-on crash both want to avoid
     (arms races, strikes, brinkmanship, a standoff nobody can win) → `"chicken"`.
     Ordering `T>R>S>P`. This is often the right frame for confrontations.
   - The whole thing is about **trusting each other to coordinate**, and mutual
     cooperation is clearly best (joint ventures, standards, alliances) →
     `"stag_hunt"`. Ordering `R>T>P>S`.
   The move mechanics and temperaments are identical across games — only the payoff
   ordering changes, so honor the chosen game's ordering when you set the ranges.
9. **Audit hidden players and internal factions (fractional player).** Before finalizing,
   ask three checks — this is cheap and catches 80% of flat-model errors without code changes:
   - **Latent player?** Is there a regulator/market/electorate that sets payoff but wasn't named? If yes, add as `{"name":"...","dispositions":["gradual"]}` with asymmetric payoffs (its `P` shifts others). Keep `visibility` low via `noise` wide.
   - **Split player?** Is a named side internally divided (hawks vs doves, siloviki vs economists)? Split into 2 sub-players with same `team:"X"` + `colluder` (`C` inside, `TFT` outside). Use `betrayalProb` for intra-split defection.
   - **Internal forces?** Does one person battle two drives (duty vs fear)? Widen `values` to `[-0.8,0.8]` + expand `dispositions` SET to `["provocable","grim","pavlov"]` so `rng.pick` samples the force each world. Single `lean` + `drift` already models planner/doer.

   Only if this SKILL-level split still leaves `maxWin<60%` or `coopStd>30%` after 600 worlds, propose formal `factions/forces/latent` extension (`DYNAMIC_MODELS.md:Q` + `ROADMAP.md:3.5`) — don't pre-optimize.

Put the first-listed disposition of each player as its *modal* (most-likely) type —
the regime map uses those.

### Schema

```json
{
  "situation": "one sentence",
  "game": "prisoners_dilemma | chicken | stag_hunt",
  "players": [
    {"name": "...", "team": "coalition-1", "dispositions": ["colluder","provocable"], "values": [-0.2,0.3], "note": "why"}
  ],
  "payoffs": {"T": [lo, hi], "R": [lo, hi], "P": [lo, hi], "S": [lo, hi]},
  "structure": {"w": [lo, hi], "noise": [lo, hi], "drift": [lo, hi]},
  "rationale": {"R": "...", "T": "...", "P": "...", "S": "...", "w": "...", "noise": "...", "drift": "..."}
}
```
`team` groups fixed coalitions (colluder + per-team `winPctTeam`/`winPctPerCapita`); `values` is initial lean `[-1,1]`; `drift` is lean shift per observed move. All three optional — classic JSON still works.

`game` is optional (defaults to `prisoners_dilemma`).

`payoffs` may instead be **per-player** (asymmetric stakes):

```json
"payoffs": {
  "Iran":      {"T": [4, 7], "R": [3, 4], "P": [1, 2], "S": [-2, 0]},
  "Coalition": {"T": [3, 5], "R": [3, 4], "P": [1, 2], "S": [-1, 1]}
}
```

Each player's table must satisfy its game's ordering (`domain.ts:isValidPayoff`):
`prisoners_dilemma` `T>R>P>S && 2R>T+S`, `chicken` `T>R>S>P`, `stag_hunt`
`R>T>P>S`; the simulator rejects any that don't. See `example_model.json` for a
filled-in (shared) case.

## Stage 2 — Run it

```bash
pnpm scenario example_model.json 600
# direct: npx tsx src/cli.ts example_model.json 600
# shim: ./scenario example_model.json 600
```

`Usage: pnpm scenario <model.json> [trials] [--seed N]` — `trials` optional
(default 600), 500–800 is plenty. `--seed 42` makes the run bit-for-bit
reproducible (same input → identical numbers); omit it for a fresh sample.
`--seed` is parsed anywhere in args, `trials` must be the first number after the
path.

**Output.** `src/cli.ts` prints two blocks: (1) `scenarioReport()` — `Team <t> leads in X% (per-capita: <t> Y%)` if teams present else `<player> leads…`, plus `Cooperation averages X% (± Y%). Most worth verifying: <coop pivot>; <winner pivot>.` — this is the Bottom line; (2) `JSON{winPct, winPctTeam, winPctPerCapita, cooperation:{mean,std}, sensitivity, sensitivityWin, sensitivityWinTarget}`.
There are **two** signed sensitivity lists: `sensitivity` = `corr(input, cooperation)`, `sensitivityWin` = `corr(input, top side wins)`, both sorted by magnitude with the sign kept (positive = the input *raises* the target). Inputs include `T,R,P,S,w,noise,drift` + `value_<player>` per-player. Use `sensitivityWin` when the user asks "who wins" — cooperation can be flat while a different input decides the outcome.

**Determinism.** `src/rng.ts:Rng` (xorshift) + `deriveSeed(root,generation,i,j,rep)`
— every match gets its own derived seed, so parallelisation stays reproducible.
Same `model+trials+seed` → identical `winPct/sensitivity`; `noise=0` + same seed
→ identical histories.

**Validation errors** (`domain.ts:assertScenario/isValidPayoff`):
- `A scenario needs at least two players` / `Every player needs a name and disposition` / `Unknown disposition`
- `w must be an ordered range within 0..0.9995`, `noise within 0..1`, `drift within 0..1`, `values for <name> within -1..1`
- `Payoff ranges cannot satisfy <game>` — after 300 samples no valid `T,R,P,S`; widen ranges or switch `game`
- `Missing payoffs for <name>` — asymmetric `payoffs` without entry for that player

**Best-play advice (prescriptive).** When the user asks "what should *I* do?", name
their side and add `--advise <Name>` *(planned — not yet in `src/cli.ts`; until
then call `analyzeScenario` per tactic directly or use the Python shim if still
present)*:

```bash
pnpm scenario example_model.json 600 --advise Coalition
```

It pins that side to each of its listed temperaments in turn, runs each against all
the uncertainty, and ranks them by how often that side comes out ahead. Report the
top one as the recommended play, in plain words. (List every tactic the user could
realistically adopt in that player's `dispositions` so there's something to choose
among.)

**Scope.** This skill covers only **scenario analysis** (Monte-Carlo in
`src/analysis.ts`). **Evolution lab** (`src/run.ts` `Run` aggregate,
`src/kernel.ts:tournament/evolve`, `src/projections.ts`, `pnpm demo`/`pnpm test`)
and **spatial lattice** (`src/spatial.ts`) — separate kernels, not invoked by the skill.

## Stage 2b — Confirm only the pivots (don't bug the user about everything)

The report ends with a **sensitivity** line. Whatever input tops it is the only
thing worth asking the user to pin down. Do NOT ask them to confirm every number —
ask about the one or two that actually swing the outcome, then narrow *those*
ranges and re-run. Numbers that don't move the conclusion stay wide; that's the
whole point.

## Build mode — let the runs improve the model

When you iterate on the same JSON, run with the build flag:

```bash
pnpm scenario example_model.json 600 --build   # or --suggest / --improve
./scenario example_model.json 600 --build
```

The CLI adds `buildTips` (from `src/feedback.ts`) and writes `example_model.report.json` + `example_model.tips.md` (gitignored). Tips point to the next edit:

- `maxWin <60%` → widen `dispositions` SET, add asymmetric payoffs or `team`+`colluder`
- `coop <35%` → lower `T` or add `forgiving`/`contrite`/`gradual`
- `top sensitivity = noise/w/drift/value_<player>` → narrow that one range next (Stage 2b)
- `3+ players without team and maxWin <55%` → add fixed coalition
- `coopStd >30% without values/drift` → add `values`+`drift`

In build mode, **apply one tip, re-run, check the delta** — the tips file is your changelog. Keep the loop tight: one hypothesis per run, green `pnpm test` each time.

## Stage 3 — Interpret honestly (no metrics in the verdict)

**Write for someone who has never heard of game theory — and has no patience for numbers.** The Bottom line is 2–3 concrete sentences about what will happen and what to do. No `%`, no `w/noise/corr/disposition/R/T/P/S`, no “plausible worlds”. Translate everything to plain actions and consequences. Metrics live only in the appendix (`report.json`), never in the verdict.

**Always lead with the script's Bottom line, but rewrite it to plain conclusions:**

- Bad: `Northwind leads in 47% vs Kestrel 53%, cooperation 66% ±31%, sensitivity noise 0.23`
- Good: `Пока никто не тянет одеяло на себя — сдержанная линия держится, если сигналы читаются верно. Любой сбой связи может сорвать её.`

**Template — 2–3 sentences, concrete, no numbers:**

1. **Кто и что делает:** “Скорее всего, система держит сдержанную координацию — бюджет не разгоняют, ЦБ плавно снижает, бизнес вкладывается.”
2. **Где ломается:** “Срыв — там, где сигнал могут неверно прочитать (топливный шок, дроны, закрытая статистика, неверное чтение ставки).”
3. **Что делать:** “Сейчас главное — чтобы сигналы Минфина, ЦБ и бизнеса читались одинаково; сужать именно этот зазор.”

**If the user wants detail, add an appendix after the verdict** (collapsed, not before). There you may show `winPct`/`cooperation`/`sensitivity` in plain words: not “Gov_Fiscal 48%”, but “Минфин чуть чаще оказывается в плюсе, но не доминирует — расклад легко качнётся”.

- **Who prevails:** concrete — “Пока никто не доминирует — расклад качнётся к той стороне, чьи сигналы прочтут верно.”
- **Whether cooperation holds:** concrete — “Дисциплина держится в большинстве случаев, но хрупка — сбой связи уводит в стагнацию с ростом цен.”
- **Regime boundary:** plain — “Пока стороны рассчитывают на долгую игру и сигналы не путаются, координация держится; как только ожидание укорачивается или путаница растёт — срывается в взаимный жёсткий курс.”
- **What to verify first:** one real question derived from top sensitivity, e.g. “Как часто топливный шок или закрытая статистика приводит к неверному чтению шага ЦБ/бюджета?”
- **State the limits:** same, but plain: fixed teams only, single lean not emotion, spatial/evolution separate kernels.

## What NOT to do

- Don't invent decimal-precise payoffs and present them as known.
- Don't report the winner without the robustness % (use `winPctTeam` total vs `winPctPerCapita` for teams).
- Don't hide a fragile result behind a confident sentence.
- Don't hack spatial/grid into the scenario JSON — `src/spatial.ts` is a separate kernel (lattice `imitate-best`/`fermi`), not Monte-Carlo params.
