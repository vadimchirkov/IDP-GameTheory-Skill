# Case A-spatial — "Cooperation Lab" (a game, not just a sim)

Spatial variant of the evolution sandbox, designed to be **fun to play**: real-world
scenarios, policy levers you tune, interventions you make, and a plain-language
verdict on what happened. Same TEOB architecture (one entity + pure kernel).

---

## 1. What changes vs base Case A

| | Base A (well-mixed) | A-spatial |
|---|---|---|
| Who plays whom | round-robin, everyone | only your grid **neighbours** |
| State | `shares: Map[Strategy, Double]` | `grid: Array[Array[Strategy]]` (N×N) |
| Update rule | replicator / Moran | **imitate best neighbour** / Fermi |
| Headline result | strategy shares over time | **clusters** of cooperators surviving |
| The big idea | reciprocity (TFT) sustains coop | **structure alone** sustains coop — no memory needed (Nowak–May) |
| Visual | streamgraph | animated coloured lattice (mesmerising) |

The core scientific hook: on a grid, cooperators survive by **clustering** — a
defector only exploits its border, and below a temptation threshold `b`, cooperator
patches hold and grow. Cross the threshold and they dissolve. You *watch* the tipping
point.

---

## 2. Why it's a game, not a toy

A simulation you only watch gets boring in 30 seconds. Four ingredients make it a
game:

1. **Agency** — you intervene, not just observe.
2. **Goal** — there's a win condition and tension.
3. **Real cases** — you recognise your own life in it.
4. **Clear verdict** — the game tells you, in words, what happened and why.

---

## 3. Fun mechanics

- **Paint / seed (god mode):** click-drag to drop cooperator clusters or a defector
  "virus". Watch cause and effect ripple. The single most satisfying interaction.
- **Policy levers with real labels:** the abstract knobs get scenario names.
  - temptation `b` → "how much cheating pays" / "peak electricity price"
  - noise `ε` → "enforcement errors" / "misinformation"
  - neighbourhood size / topology → "how connected society is"
- **Event deck (roguelike shocks):** mid-run cards inject reality — recession
  (payoffs shift), plague (random defections), new law (noise drops), migration
  (inject a new strategy). Turns a run into a story with surprises.
- **Win conditions / puzzle levels:** e.g. "reach 80% cooperation in 50 generations
  placing only 20 cooperator seeds", or "you're a defector — infect the whole grid
  before gen 100". Limited interventions = real puzzle.
- **Verdict narration:** after a run, a plain-language readout — "defector clusters
  couldn't grow past their edge because each was surrounded by cooperators scoring
  higher together." Teaches the theory without a lecture.

---

## 4. Real-case scenarios (the "levels")

Same grid, reskinned. Each = a payoff mapping + a lever + a topology + a win goal.

| Scenario            | Cooperate → | Defect →      | Key lever              | What you watch                       |
|---------------------|-------------|---------------|------------------------|--------------------------------------|
| Recycling street    | recycle     | dump trash    | convenience of dumping | clean vs rotted blocks               |
| Vaccination         | vaccinate   | free-ride     | perceived shot risk    | outbreaks through unvaxxed clusters  |
| Overfishing         | keep quota  | overfish      | price of fish          | collapse waves (tragedy of commons)  |
| Price war (shops)   | fair price  | undercut      | margin pressure        | price-war fronts moving across a map |
| Arms race (nations) | disarm      | arm           | threat level + alliances (topology) | stable blocs vs escalation |
| Open source / team  | contribute  | free-ride     | effort cost + who-sees-whom | free-rider pockets            |
| **EV charging grid**| shed load off-peak | draw full power | peak price + feeder network (topology) | **blackout cascades** vs stable grid |

The **EV grid** scenario is the domain hook: charging stations on a feeder-network
graph; if too many defect on one feeder it trips (blackout = everyone gets `P`). You
test whether pricing/reciprocity stabilises the real product's grid. This is
A-spatial × Case D — a genuine R&D toy that also plays as a game.

---

## 5. The core fun loop

```
pick scenario → set policy levers → seed/paint interventions → RUN
     → watch clusters evolve → read the verdict → tweak → beat the level
```

Two shells over the same loop:
- **Sandbox:** free knobs, god-mode painting, no goal — mess around.
- **Campaign:** tutorialised real cases as levels with win conditions and limited
  interventions. Leaderboard: stabilise cooperation with the fewest moves.

---

## 6. Architecture (still one entity + kernel)

Unchanged philosophy from base A — event-source the experiment, not the dice rolls.

- **Kernel (pure):** holds the `grid`, plays each cell against neighbours, applies the
  update rule. Deterministic given `(scenario, seed)`. Fast.
- **`Run` aggregate (the one entity):** persists `RunStarted(scenario, seed, initialGrid)`
  and per-generation summaries `GenerationCompleted(gen, coopRate, clusterCount)`.
  **Player actions become commands → events:** `Painted(cells, strategy)`,
  `EventCardPlayed(card)`. So every playthrough is a durable, deterministic,
  **shareable replay** — a run is a story you can send to a friend, and a leaderboard
  score that can't be faked (replay verifies it).
- **Frame storage:** persist the initial grid + seed + intervention events; any frame
  is reconstructed by re-running the kernel to that generation (cheap). Persist grid
  diffs only if you want instant scrubbing without recompute.

Event-sourcing earns its keep here in a *game* way: **shareable, verifiable replays
and deterministic leaderboards**, for free from the journal.

---

## 7. UI (hero = the living lattice)

- **Center:** the animated N×N grid. Use the 4-colour scheme (stayed-C, stayed-D,
  just-turned-C, just-turned-D) — the green/amber frontier is what makes it beautiful,
  showing the wave of change, not just the state.
- **Top bar:** play/pause, generation, cooperation %, the temptation lever.
- **Left rail (campaign):** scenario cards + the level goal + moves remaining.
- **Bottom:** event-deck cards you can play; verdict panel after the run.
- **Interactions:** click-drag paint; hover a cell to see its score and neighbours.

---

## 8. Build sequence (on top of base A phases 0–5)

The base-A kernel already gives strategies + payoffs + self-checks. Add:

1. **Spatial kernel:** grid + neighbour play + imitate-best update. Gate: reproduce
   Nowak–May — single defector in a cooperator sea grows a symmetric pattern; random
   start at `b≈1.85` gives persistent dynamic clusters; high `b` wipes cooperators.
2. **Lattice UI:** the 4-colour animated grid + play/pause + `b` lever (the widget
   already prototyped).
3. **Paint / seed:** click-drag interventions → `Painted` events.
4. **Scenarios:** the reskin table (§4) — payoff + lever labels + verdict text per
   scenario. Data, not code.
5. **Campaign + win conditions:** level goals, move limits, verdict narration.
6. **Event deck + shareable replays:** shock cards; replay-by-link from the journal.
7. **Topology (optional):** swap the lattice for small-world / scale-free / a real
   feeder graph (unlocks the serious EV-grid scenario).

Ship steps 1–2 first (the living lattice is the whole magic); everything else is
polish and content on top.

---

## 9. Note on honesty

The scenarios are **illustrative analogies**, not calibrated models. Real vaccination
or grid dynamics need real data and validated payoffs. Keep a visible "toy model"
label in-game, and reserve the calibrated version for the EV-grid R&D use (Case D),
where you'd fit payoffs to actual feeder economics.
