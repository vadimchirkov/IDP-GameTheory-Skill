# Game-Theory Scenarios — a Claude skill

Describe a situation where two sides keep dealing with each other — a rivalry, a
partnership, a price war, a standoff — and this skill runs it through a game-theory
simulator hundreds of times and tells you, in plain language:

- who is likely to come out ahead (and how sure we can be),
- whether cooperation holds or falls apart,
- what makes it fall apart,
- and the one real-world fact worth checking first.

It never reports a single lucky run. It jiggles every guess and keeps only the
conclusions that survive.

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

**Requirements:** Node 20+, pnpm. Engine is `teob-ts` (`src/`). Check with `node --version && pnpm --version`.

---

## How to use it

Just describe your situation to Claude in plain words. The skill triggers on things
like *"run this through game theory"*, *"war-game this"*, *"what happens if"*,
*"who wins"*, *"should I cooperate or not"*. Example:

> Two suppliers have an unspoken deal not to undercut each other. One is under
> pressure to grow. Run this through game theory — what happens?

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
| `example_model.json` | Worked example: two startups with a fragile pact |
| `reference_axelrod.md` | Background: the game-theory methods and code it's built on |
| `src/` | `teob-ts` engine: `kernel.ts`, `analysis.ts`, `rng.ts`, `run.ts`, `spatial.ts` |
| `README.md` | This file |

---

## What it covers

- Three game types: prisoner's dilemma, chicken/brinkmanship, and stag hunt
- 16 temperaments: TFT/GTFT/WSLS/grim/exploitative/ALLC/gradual/erratic/prober/contrite/detective/ZD-generous/ZD-extort/colluder/adaptive/southampton, per-side stakes, teams (`team`+`colluder` → `winPctTeam` total vs `winPctPerCapita`), values/drift (`values`+`drift`), spatial lattice (`src/spatial.ts` imitate-best/Fermi)
- Reproducible runs (`--seed`), sensitivity includes `drift` + `value_<player>`

## Development (teob-ts)

```bash
pnpm install
pnpm build && pnpm test   # self-check OK
pnpm demo                 # evolution demo
pnpm scenario example_model.json 600 --seed 42
```

Docs: `PROJECT_ARCHITECTURE.md` (вертикаль teob-ts, фазы), `RESEARCH_SYNTHESIS.md` (роадмап), `case_A_*` (evolution/spatial), `more-things.md` (исследования).

## The one honest limitation

Spatial/lattice (`src/spatial.ts`) is a separate kernel (grid `imitate-best`/`fermi`, `b/c>k`), not part of Monte-Carlo scenario analysis. Best-play `--advise` is planned (use `analyzeScenario` API directly).
