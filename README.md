# IPD (Game-Theory Scenarios) — a Claude skill

Describe a situation where **2–10 sides** keep dealing with each other — a rivalry,
partnership, price war, standoff, or **coalition vs coalition** — and this skill runs it
through a game-theory simulator hundreds of times and tells you, in plain language:

- who is likely to come out ahead (and how sure we can be),
- whether cooperation holds or falls apart,
- what makes it fall apart,
- and the one real-world fact worth checking first.

It never reports a single lucky run. It jiggles every guess and keeps only the
conclusions that survive.

> **The classic story — [Prisoner's dilemma on Wikipedia](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma):** *Two members of a gang are arrested and held in solitary with no contact. Police lack evidence for the main charge — both face 1 year on a lesser count — and offer each a Faustian bargain: testify against the partner → go free while the other gets 3 years; if both testify → 2 years each; if both stay silent → 1 year each.* → `T = free, R = 1y, P = 2y, S = 3y` (`T>R>P>S`, `2R>T+S` prevents alternating C/D from beating steady `R`).
>
> The same 2×2 table shows up everywhere — price wars and cartels, climate pacts and overfishing, doping in sports, trench warfare and arms races, bacteria and academic co-authorship — only the stakes change.

<details>
<summary><strong>Learn more — Wikipedia</strong></summary>

| Topic | Start here |
|-------|------------|
| 📖 Prisoner's dilemma | [Article](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma) • [Iterated](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma#The_iterated_prisoner%27s_dilemma) |
| 🐔 Chicken • 🦌 Stag hunt | [Chicken (game)](https://en.wikipedia.org/wiki/Chicken_(game)) • [Stag hunt](https://en.wikipedia.org/wiki/Stag_hunt) |
| 🏆 Axelrod & TFT | [Tournament & 4 traits](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma#Axelrod's_tournament_and_successful_strategy_conditions) • [Tit for tat](https://en.wikipedia.org/wiki/Tit_for_tat) |
| 🎲 Zero-determinant | [ZD strategies](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma#Zero-determinant_strategies) |
| 🌍 Real life | [Economics](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma#Economics) • [International politics](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma#International_politics) • [Biology](https://en.wikipedia.org/wiki/Prisoner%27s_dilemma#Biology) |

</details>

### What you can do with it

- **A handshake between founders:** “we don’t poach each other’s people” — will it hold when one of you needs to grow fast, or does the upside to defect quietly win?
- **Two shops on the same street:** keep prices steady together or undercut to steal the client — who blinks first when you meet again next month?
- **A partnership where you do the extra work:** keep being generous or get firm? Test if being forgiving invites free-riding or keeps trust alive.
- **A team with a pact vs solo players:** two colleagues cover for each other while two others play solo — does loyalty beat hustle, or does it get exploited?
- **A subsidy, cartel or shared standard:** will everyone play along, or will a single misread (“they cheated!”) unravel it?
- **A tense standoff:** both can escalate, but if both do — everyone loses. How to avoid the crash without looking weak?
- **When a rumor or delay gets misread:** a late reply, a fuel price spike, a closed stat — will one mistake spiral into mutual distrust?

**When to use it:** if your story keeps repeating — “we meet again next quarter / next round” — it fits.

**What you get in 60 seconds:** you describe it in 2 sentences, Claude returns a plain 2–3 sentence verdict — who likely comes out ahead, whether cooperation holds, what makes it break, and the single real-world fact to check first. No tables, no metrics in the verdict — those are in the appendix.

**Prompts that trigger it:** `run this through game theory` · `war-game this` · `what happens if` · `who wins` · `should I cooperate`

### The game in 30 seconds (IPD)

**2–10 sides** meet again and again. Each pair plays each round: each picks **C** (cooperate — hold price, keep pact, swerve) or **D** (defect — undercut, poach, hold firm). Payoffs per round (pairwise):

- `R` — both C (the deal holds)
- `T` — you D, they C (you steal the upside)
- `P` — both D (mutual grind)
- `S` — you C, they D (you get suckered)

Different games = different orders: Prisoner's Dilemma `T>R>P>S` (tempting, survivable mutual defect), Chicken `T>R>S>P` (mutual defect = crash, worst), Stag Hunt `R>T>P>S` (mutual C is best). The *shadow of the future* `w` is the chance you meet again; `noise` is misread chance; `drift` shifts lean after each observed move; `team` + `colluder` models fixed coalitions (round-robin pairwise). Temperaments (22: TFT/GTFT/WSLS/Grim/ALLD/ALLC/TF2T/Adaptive/ZD/Southampton…) are rules for “what to do given history”.

Engine runs **600 sessions/worlds by default** (`pnpm scenario model.json 600` — 2nd arg; 500–800 is plenty, `--seed 42` makes it reproducible). Each session draws a fresh `T/R/P/S`, `w/noise/drift/values`, `dispositions` and plays every pair round-robin (`w` → geometric horizon, cap 10000). Only a conclusion that wins in most sessions is reported.

**IPD features:** 3 game orderings (PD / Chicken≡Snowdrift / Stag Hunt) • 22 temperaments • asymmetric per-side payoffs with score normalisation • fixed teams (`winPctTeam` total vs `winPctPerCapita`) • lean `values∈[-1,1]` + `drift` • eco-feedback (`structure.eco`, Weitz shared-resource `Π(n)`) • game transitions (`structure.transitions`, Su regime-switching) • two signed sensitivity lists (cooperation & winner) • `--visual` lattice sandbox • deterministic `Rng`/`deriveSeed` (`--seed`).

---

## Install

A skill is just a folder in `.claude/skills/`. The simplest way is a one-line
clone straight into that folder.

**For everything you do** (available in every project):
```bash
git clone https://github.com/vadimchirkov/game-theory-scenarios.git ~/.claude/skills/game-theory-scenarios
```

**For one project only:**
```bash
git clone https://github.com/vadimchirkov/game-theory-scenarios.git .claude/skills/game-theory-scenarios
```

That's it. Restart Claude Code and the skill is live.

**Update later:**
```bash
git -C ~/.claude/skills/game-theory-scenarios pull
```

No git? Download the ZIP from the GitHub page ("Code → Download ZIP") and unzip
the folder into `~/.claude/skills/`.

**Requirements:** Node 20+, pnpm. Engine is [`teob-ts`](https://github.com/lambda-house/teob-ts) — **Type-safe Event-sourcing Over Behaviours** (pure `Aggregate`/`Effect`/`Projection`, TEOB: DDD + Event Sourcing + CQRS + Actor) (`src/`). Check with `node --version && pnpm --version`.

---

## How to use it

Just describe your situation to Claude in plain words — **2 to 10 sides, with or without coalitions**. The skill triggers on things like *"run this through game theory"*, *"war-game this"*, *"what happens if"*, *"who wins"*, *"should I cooperate or not"*. Example:

> Two suppliers have an unspoken deal not to undercut each other. One is under
> pressure to grow. Run this through game theory — what happens?
> — or — Four firms: two incumbents in a pact vs two entrants — who holds the market?

Claude will build the model, run it, and give you a plain-language read-out.

### Run it yourself (optional)

You don't need to, but you can drive the engine directly:

```bash
pnpm scenario example_model.json 600     # 600 = number of simulated worlds
# or: npx tsx src/cli.ts example_model.json 600
# or: ./scenario example_model.json 600
```

Copy `example_model.json`, edit the players, their possible temperaments, and the
stakes, then run.

### Check it works

```bash
pnpm test        # prints "self-check OK"
pnpm demo        # plain-words demo run
```

---

## What's in the folder

| File | What it is |
|------|-----------|
| `SKILL.md` | Instructions Claude follows (how to model and interpret honestly) |
| `scenario` | Shim to `src/cli.ts` (`./scenario example_model.json 600`) |
| `example_model.json` | Fragile pact — Prisoner's Dilemma (default) |
| `example_chicken.json` | Brinkmanship — Chicken (mutual escalation is worst) |
| `example_stag_hunt.json` | Coordination — Stag Hunt (mutual C is best) |
| `example_team.json` | Fixed coalition — 2 colluders vs 2 solos (total vs per-capita) |
| `example_drift.json` | Lean & drift — forgiving vs prober with `values`/`drift` |
| `GAME_THEORY.md` | Game-theory methods and their code mapping (`kernel.ts`, `analysis.ts`, `spatial.ts`, `predictive.ts`) |
| `PROJECT_ARCHITECTURE.md` | TEOB architecture: Aggregate/Effect/Codec/Journal/Projection, runtime envelope, determinism |
| `src/` | [`teob-ts`](https://github.com/lambda-house/teob-ts) — Type-safe Event-sourcing Over Behaviours: `kernel.ts`, `analysis.ts`, `rng.ts`, `run.ts` (Aggregate), `spatial.ts` |
| `README.md` | This file |

---

## What it covers

- **N-player IPD (2–10):** round-robin pairwise, 3 games, 19 temperaments, `--seed` deterministic, 600 worlds jiggle → `winPct`/`winPctTeam`/`cooperation`/`sensitivity`
- **Asymmetric stakes:** per-player `payoffs` (own `T/R/P/S` ranges)
- **Coalitions:** `team` + `colluder` (C vs kin / TFT vs outsider → `winPctTeam` total vs `winPctPerCapita`)
- **Lean & drift:** `values∈[-1,1]` + `drift` (order `strategy→lean→noise→drift`, CLT-clamped)
- **Spatial lattice:** `src/spatial.ts` `imitate-best`/`Fermi` (`b/c>k`), separate kernel
- **Build feedback:** `--build` → `buildTips` + `*.report.json`/`*.tips.md` to improve the model next run

## Benchmarks — engine predictive power (holdout, stakes from files)

`pnpm bench:engine` — `cooperation` vs held-out rate.

| Dataset | Observed | hist | zero | coin | Engine → vs SOTA |
|---------|----------|------|------|------|------------------|
| **Synthetic** 300×300 | — | — | — | **0.25** | Brier **0.23** (ECE **0.05**) — beats coin |
| **DF2011** 6 treatments | 8–94% | **25.9pp** | **57.2pp** | **28.3pp** | 38–61% → **21.6pp** — beats hist, SOTA Nay 86% (we 82-87%) |
| **dilemmaRL** 5 deltas | 19–49% | **10.8pp** | **59.6pp** | **9.6pp** | 44–62% → **13.5pp** — near hist, SOTA 86% / R²≈0.7 |
| **MID** dyad-year | 77.6% | — | **22.4pp** | **27.6pp** | **84.3% → 6.7pp** — beats zero, SOTA VIEWS 56→49 |
| **TIES** / China | 54.4 / 30.7% | — | **45.6 / 69.3pp** | **4.4 / 19.3pp** | **56.5% → 2.1pp** / **25.8pp** — beats zero, SOTA AUC ~0.65 |

*Headers — Dataset / n: live data; Observed: held-out cooperation rate; hist / zero / coin: MAE of baselines (hist = mean of past, zero = always `C` 100%, coin = 50%; Brier for Synthetic); Engine: predicted `cooperation` → MAE and vs SOTA (best published baseline on same data).*

*Run: `pnpm bench:engine` + `pnpm cross:validate` vs Axelrod-Python <5%. Data `data/raw/` (`data/README.md`).*

## Development ([teob-ts](https://github.com/lambda-house/teob-ts) — Type-safe Event-sourcing Over Behaviours)

Pure `Aggregate` (`decide`→`Effect`→`apply`), `Codec`, `Journal` (inmem/sqlite/postgres), `Projection`/`Saga` — business logic is pure `(State, Command)→Effect`, runtime handles persistence/recovery.

```bash
pnpm install
pnpm build && pnpm test   # self-check OK
pnpm demo                 # evolution demo
pnpm scenario example_model.json 600 --seed 42
```

## The one honest limitation

Fixed teams (`team` + `colluder`, with optional `betrayalProb` for intra-team defection): no full dynamic coalitions. `values`/`drift` is a single lean per player, not emotion or cheap talk. The spatial lattice (`src/spatial.ts` `imitate-best`/`fermi`) is a separate sandbox for the `--visual` view — it does not decide scenario winners. Only symmetric 2×2 games (Prisoner's Dilemma / Chicken≡Snowdrift / Stag Hunt) — no N-player public-goods or sequential trust games, no LLM agents. If your situation hinges on those, the skill will flag it rather than fake it.
