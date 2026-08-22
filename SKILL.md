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

# Game-theory scenario simulator

Turn a prose situation into a repeated-game model, Monte-Carlo it, and report
**only what survives the uncertainty**. The engine is `src/cli.ts` on the
`teob-ts` kernel (`src/kernel.ts` + `src/analysis.ts` + `src/rng.ts`,
background in `reference_axelrod.md`). Your job is the two ends
the engine can't do: honest elicitation (stage 1) and honest interpretation
(stage 3).

Plain version of what this does: someone describes a situation where two sides
keep dealing with each other (a rivalry, a partnership, a standoff). You guess the
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
   automatically. Available (16): `provocable` (TFT), `forgiving` (GTFT, forgives 25%),
   `pavlov` (WSLS), `grim` (never forgives), `exploitative` (probes, backs off only on 2×D),
   `trusting` (ALLC), `gradual` (Beaufils: n-th defection → n×D then 2×C), `erratic` (50/50),
   `prober` ([D,C,C] probe), `contrite` (forgives own noise-induced D), `detective` ([C,D,C,C]→TFT else ALLD),
   `zd_generous` (Stewart-Plotkin generous ZD χ=0.5, `p=[0.85,0.55,1,0.45]`), `zd_extort` (extortion χ=2),
   `colluder` (team: C vs teammate / TFT vs outsider), `adaptive` (Glynatsi: `p(C)=0.5+(pOppC-0.3)`), `southampton` (handshake `[D,D,C,C,D]`→C if kin else D).
4. **Structure = horizon and noise, as ranges.**
   - `w` (0–0.9995, `assertRange` cap): probability the relationship continues each
     period. High w = long shadow of the future. Unknown end date → wide range.
     Horizon in rounds is `geometricHorizon(w)` capped at 2000 (`analysis.ts:31`).
   - `noise` (0–1, realistically 0–0.2): chance a move is misread as its opposite
     (a rep goes off-script, a message is misinterpreted). Real relationships are
     never 0.
   - `drift` (0–1, optional): how fast lean shifts after each observed move — after
     observed D lean `−=drift`, after C `+=drift`, clamped to `[-1,1]` (`kernel.ts:playMatch` order `strategy→lean→noise→drift`).
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

**Output.** `src/cli.ts` prints two blocks: (1) `scenarioReport()` — `Team <t> leads in X% (per-capita: <t> Y%)` if teams present else `<player> leads…`, plus `Cooperation averages X% (± Y%). Most worth verifying: <input>.` — this is the Bottom line; (2) `JSON{winPct, winPctTeam, winPctPerCapita, cooperation:{mean,std}, sensitivity:[{input,correlation}]}` —
sensitivity is `|corr(input, cooperation)|` sorted descending, inputs include `T,R,P,S,w,noise,drift` + `value_<player>` per-player.

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

**Scope.** This skill covers only **анализ сценария** (Monte-Carlo in
`src/analysis.ts`). **Лаборатория эволюции** (`src/run.ts` `Run` aggregate,
`src/kernel.ts:tournament/evolve`, `src/projections.ts`, `pnpm demo`/`pnpm test`)
— separate product, not invoked by the skill.

## Stage 2b — Confirm only the pivots (don't bug the user about everything)

The report ends with a **sensitivity** line. Whatever input tops it is the only
thing worth asking the user to pin down. Do NOT ask them to confirm every number —
ask about the one or two that actually swing the outcome, then narrow *those*
ranges and re-run. Numbers that don't move the conclusion stay wide; that's the
whole point.

## Stage 3 — Interpret honestly

**Write for someone who has never heard of game theory.** No jargon in the
verdict: not "w", "noise", "corr", "disposition" — say "how long both sides expect
this to keep going", "chance of a misread", "what the answer hinges on". Translate
every number into a plain sentence. If you must name a technical term, define it in
the same breath. Keep the honest caveats — just say them plainly.

**Always lead with the "Bottom line" the script prints — a 2–3 sentence plain-words
verdict.** That short summary IS the answer for most users; give it first, verbatim
or lightly polished, before any detail. Then, only if the user wants more, add the
breakdown below. Never bury the conclusion under tables.

Report, in plain language:

- **Who prevails, with the %.** "Wins 76% of plausible worlds", not "wins". If it's
  50/50, say the outcome is genuinely undetermined.
- **Whether cooperation is robust or fragile.** The mean±std and the flag tell you.
  Fragile means the answer flips on small changes — say so.
- **The regime boundary — the most useful output.** Read the w×noise grid for the
  cliff: "cooperation holds while both expect the relationship to outlast ~N
  interactions and misreads stay under ~X%; past that it collapses to a price war."
  This phase transition is more actionable than any point prediction.
- **What to verify first.** Restate the top sensitivity as a real-world question
  ("go find out how likely each side is to misread the other's moves").
- **State the limits.** Round-robin pairwise; fixed teams via `team`+`colluder` are now supported (`winPctTeam` total vs `winPctPerCapita` for different-size blocs, `champion` = best individual). If `colluder` not used, coalitions are still pairwise — flag it (see `reference_axelrod.md` §9). Spatial/lattice (`src/spatial.ts` grid `imitate-best`/`fermi`, `b/c>k`) is a separate kernel, not Monte-Carlo. Payoffs can be asymmetric per player, so use that rather than apologizing for shared stakes.

## What NOT to do

- Don't invent decimal-precise payoffs and present them as known.
- Don't report the winner without the robustness % (use `winPctTeam` total vs `winPctPerCapita` for teams).
- Don't hide a fragile result behind a confident sentence.
- Don't hack spatial/grid into the scenario JSON — `src/spatial.ts` is a separate kernel (lattice `imitate-best`/`fermi`), not Monte-Carlo params.
