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

### The game in 30 seconds (IPD)

**2–10 sides** meet again and again. Each pair plays each round: each picks **C** (cooperate — hold price, keep pact, swerve) or **D** (defect — undercut, poach, hold firm). Payoffs per round (pairwise):

- `R` — both C (the deal holds)
- `T` — you D, they C (you steal the upside)
- `P` — both D (mutual grind)
- `S` — you C, they D (you get suckered)

Different games = different orders: Prisoner's Dilemma `T>R>P>S` (tempting, survivable mutual defect), Chicken `T>R>S>P` (mutual defect = crash, worst), Stag Hunt `R>T>P>S` (mutual C is best). The *shadow of the future* `w` is the chance you meet again; `noise` is misread chance; `drift` shifts lean after each observed move; `team` + `colluder` models fixed coalitions (round-robin pairwise). Temperaments (16: TFT/GTFT/WSLS/Grim/Adaptive/ZD/Southampton…) are rules for “what to do given history”. Engine replays the story 600 times with all ranges jiggled — only a conclusion that wins in most worlds is reported.

**IPD features:** 3 games • 16 temperaments • asymmetric per-side payoffs • fixed teams (`winPctTeam` total vs `winPctPerCapita`) • lean `values∈[-1,1]` + `drift` • spatial lattice (`imitate-best`/`Fermi`, `b/c>k`) • deterministic `Rng`/`deriveSeed` (`--seed`).

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
| `reference_axelrod.md` | Background: the game-theory methods and code it's built on |
| `src/` | [`teob-ts`](https://github.com/lambda-house/teob-ts) — Type-safe Event-sourcing Over Behaviours: `kernel.ts`, `analysis.ts`, `rng.ts`, `run.ts` (Aggregate), `spatial.ts` |
| `README.md` | This file |

---

## What it covers

- **N-player IPD (2–10):** round-robin pairwise, 3 games, 16 temperaments, `--seed` deterministic, 600 worlds jiggle → `winPct`/`winPctTeam`/`cooperation`/`sensitivity`
- **Asymmetric stakes:** per-player `payoffs` (own `T/R/P/S` ranges)
- **Coalitions:** `team` + `colluder` (C vs kin / TFT vs outsider → `winPctTeam` total vs `winPctPerCapita`)
- **Lean & drift:** `values∈[-1,1]` + `drift` (order `strategy→lean→noise→drift`, CLT-clamped)
- **Spatial lattice:** `src/spatial.ts` `imitate-best`/`Fermi` (`b/c>k`), separate kernel
- **Build feedback:** `--build` → `buildTips` + `*.report.json`/`*.tips.md` to improve the model next run

## Development ([teob-ts](https://github.com/lambda-house/teob-ts) — Type-safe Event-sourcing Over Behaviours)

Pure `Aggregate` (`decide`→`Effect`→`apply`), `Codec`, `Journal` (inmem/sqlite/postgres), `Projection`/`Saga` — business logic is pure `(State, Command)→Effect`, runtime handles persistence/recovery.

```bash
pnpm install
pnpm build && pnpm test   # self-check OK
pnpm demo                 # evolution demo
pnpm scenario example_model.json 600 --seed 42
```

## The one honest limitation

Fixed teams only (`team` + `colluder`): no mid-game betrayal, no handshake spoofing, no dynamic coalitions. `values`/`drift` is a single lean per player, not emotion or cheap talk. Spatial lattice (`src/spatial.ts` `imitate-best`/`fermi`, `b/c>k`) and evolution lab (`src/run.ts`) run on separate kernels — not mixed into the scenario Monte-Carlo. No LLM or memory-n>2 in default runs. If your situation hinges on those, the skill will flag it rather than fake it.
