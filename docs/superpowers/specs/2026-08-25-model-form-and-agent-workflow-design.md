# Redesign: the model is the object you edit; facts become outcome-only

**Date:** 2026-08-25
**Status:** Proposed
**Scope:** How a scenario is built and edited, and how the workspace is laid out. Touches the task
aggregate (`src/task.ts`), the agent flow (`src/scenario-agent.ts`, `src/app-server.ts`), and the
workspace UI (`app/src/workspace.tsx`, `app/src/facts.tsx`). Does **not** change the simulation
engine (`kernel.ts`, `analysis.ts`, `abc.ts`) or the reweight machinery (`fitPosterior`,
`RunPosteriorCard`).

This supersedes the input-surface half of
[2026-08-24-facts-model-flow-redesign-design.md](2026-08-24-facts-model-flow-redesign-design.md):
that redesign hid the model behind one list of facts; this one brings the model forward as the
primary editable object and keeps only the outcome half of the facts idea.

---

## 1. Problem

The facts redesign collapsed four concepts into one list, but it created a new tangle:

- Two ways to add a fact behave differently — the `+ Add` box always files `situation`
  (`app-server.ts` defaults `kind ?? "situation"`), while the chat classifies via `routeMessage`.
  The placeholder promises "what the situation is, **or what already happened**" but the field
  cannot file an outcome.
- The **model** — the thing that actually drives the simulation — is hidden read-only inside a
  `<details>` in a settings dialog. A game-theory tool wants its model inspectable and editable.
- Situation-facts are free prose that the agent must re-derive into a typed model on every Run;
  the user never sees or steers the structured object they are really building.
- Research is wired as a per-question button on every recommendation, conflating "the agent guessed"
  with "the agent should look this up".

The core question a user cannot answer simply: *"what am I building, and where do I change it?"*

## 2. Goal

Make the **model the first-class editable object**, and reduce facts to the one thing they are
genuinely good at: evidence about what already happened.

> You build one thing — a model of the situation — as a grouped form the agent helps you fill.
> You press Run to simulate it into a river of worlds. Separately, you can tell the agent what
> actually happened; that reweights the current river without rebuilding the model.

Success criteria:

1. The model is visible and editable as a form, in its own space, not a buried JSON blob.
2. There is exactly one place a situation detail lives: a model field.
3. There is exactly one way a "what happened" fact is added: through the agent, in the river view.
4. Building a model is a guided agent workflow; exploring the river is a different one.
5. Research is removed from the UI path (returns later as a step inside model-building).

Non-goals: the engine, the river visualization, benchmarking, endogenous coalitions, a full
memory-table or spatial-topology editor (both stay in the raw-JSON escape hatch this round).

---

## 3. Concepts and data model

Two user-facing concepts: **Model** (the situation) and **Outcome facts** (what already happened).

| Concept | Is | Lives in | Moves staleness? |
|---|---|---|---|
| **Model** | A typed `ScenarioModel` — the editable primary object | `TaskState.model` | Yes — editing it bumps `revision` |
| **Outcome fact** | Evidence that reweights a finished run | `TaskState.facts` (kind `outcome` only) | No — leaves `revision` alone |

`situation` facts are **gone**. The model is now the source of truth, not a projection of facts.

### 3.1 Aggregate changes (`src/task.ts`)

The aggregate already has the write path: `SetModel` → `ModelBuilt` (`task.ts:306`), and outcome
handling via `AddFact(kind:"outcome")`. This redesign mostly **removes** the situation-fact
machinery rather than adding much.

- **Keep:** `SetModel`/`ModelBuilt`, `AddFact`/`EditFact`/`RemoveFact` (outcome only now),
  `SetTitle`, all `Analysis*` commands/events, `SuggestQuestions`/`DismissQuestion`, and every
  legacy replay branch in `applyTaskEvent`.
- **Remove:** the `situation` branch of `AddFact`, `SetFactKind` (there is only one kind left),
  and the `revisionAfter(kind)` helper — `revision` now bumps on model writes, not fact writes.
- **Simplify staleness:** with the model as source of truth there is no derivation gap, so
  `modelRevision` and `isModelStale` are dropped. `ModelBuilt` bumps `revision`; `isRunStale`
  (`analysis.revision !== state.revision`) is the only staleness left.
- **Validation:** `SetModel` keeps calling `assertScenario` before persisting, so an invalid model
  never enters the journal. `RequestAnalysis` now requires `state.model` (not "at least one
  situation fact").
- **`AddFact` becomes outcome-only:** command drops `kind`/`source` situation cases; the server
  only ever sends `kind:"outcome"`. Guard: reject if there is no model yet ("Build a model first").
- **Question wiring unchanged**, but questions now carry an optional `field` pointer (§5) so the UI
  can link a question to the form field it fills.

`OpenQuestion` gains one optional field:

```ts
interface OpenQuestion { id: string; prompt: string; field?: string; } // field = dotted model path
```

Legacy journals still replay: existing `situation` facts / `brief` / `context` already fold into
the facts list via `applyTaskEvent`; a follow-up upcast (or a one-time migration on read) turns a
legacy task's situation-facts into a `situation` string + a best-effort model draft is **not**
attempted automatically — instead a legacy task with no `model` opens in the Model tab with the
old situation-facts shown as the `situation` text seed for the agent to rebuild. (Ponytail: no
history rewrite, no synthetic model; the agent rebuilds on first Run.)

### 3.2 Model editing writes through `SetModel`

Both the form and the agent write the whole `ScenarioModel` via `SetModel`. Field edits produce a
new model object client-side and send `SetModel`; the agent produces a draft and sends `SetModel`.
No granular per-field commands — one write path keeps the aggregate small and validation central.

Ponytail note: `ponytail: whole-model SetModel on every field edit; add granular patch commands only
if payload size or concurrent-edit conflicts measurably hurt.`

---

## 4. Layout and navigation

Three panes + drawer → **situations rail + center with two tabs**. The middle "Scenario" pane is
removed entirely; its facts list becomes the Model tab, its Run form moves into the Model tab, its
runs list moves under the River tab.

```
┌─────────┬───────────────────────────────────────┐
│ Situa-  │   [ Model ] [ River ]      ← tabs      │
│ tions   ├───────────────────────────────────────┤
│ rail    │  MODEL tab:  grouped form │ agent      │
│         │              (the document)│ (build)   │
│  • ...  │              [ Run ]                    │
│  • ...  │  RIVER tab:  river        │ agent      │
│         │              runs strip   │ (explore)  │
└─────────┴───────────────────────────────────────┘
```

- **Tabs `Model | River`** at the top of the center area, switch manually any time.
- **Model tab** is default until the first run completes; then the app lands on River after Run.
- **Empty states:** River with no runs → "Fill in the model and press Run"; Model on a new task →
  empty form + agent greeting.
- **Agent** is one right column across both tabs, first-class (not a cramped drawer), with
  tab-specific behavior (§5). Granola-shaped: the form/river is the document; the agent works on it
  and its questions cite the field they fill.

### 4.1 The model form (grouped, three tiers)

Grouping is derived from `domain.ts` so the form matches validation exactly.

**Basics** (always visible, required to Run):
- `situation` (text) · `game` (PD / Chicken / Stag hunt; `snowdrift` is an alias of Chicken, not a
  separate choice) · `players` 2–10 (name + `dispositions`) · `payoffs` T/R/P/S as ranges (shared)
  · `structure.w` + `structure.noise` (two sliders).

**Mechanisms** (opt-in chips; each expands its own fields; off by default):
- Teams & collusion → per-player `team`, `betrayalProb`
- Reputation → `norm`, `gossip`, `quantitative`, `theta` (chip disabled with a hint when < 3 players)
- Punishment → `beta`, `gamma`, `pool`
- Cheap talk → `credibility`, `lieCost`
- Exit → `sigma`
- Dynamic game → `eco` **or** `transitions` (mutually exclusive sub-choice)
- Lean & drift → per-player `values` + `structure.drift`

Mechanisms that require a disposition add it automatically: enabling Exit gives players the option
of `loner` and sets `sigma`; enabling Punishment wires `punisher` + `punishment`. This mirrors the
`assertScenario` coupling (loner↔sigma, punisher↔punishment) so the user never hand-maintains it.

**Advanced** (collapsed):
- Asymmetric per-player payoffs (toggle from shared) · `rationale` notes · **raw JSON** (read/edit
  escape hatch that round-trips through `SetModel` + `assertScenario`).
- **Custom memory tables (`player.memory`) and spatial `topology` live only in the raw JSON this
  round** — no dedicated editors yet.

Inline validation surfaces `assertScenario` errors next to the offending field; Run is the final
gate (server `SetModel` re-validates).

Agent-inferred field values show an `assumed` badge (the old `source:"agent"` idea, now per field
rather than per fact) so a guess is not mistaken for user input.

---

## 5. Agent: two workflows

- **Build-model** (Model tab): the agent reads the current `ScenarioModel`, proposes field values,
  and raises what it cannot infer as `openQuestions` that each point at a `field`. Confirming a
  proposal or answering a question produces a new model draft written via `SetModel`. Hybrid entry:
  a new task can start from a prose `situation` (agent drafts a first full model) **or** an empty
  form the agent fills field-by-field. Questions never block Run.
- **Explore** (River tab): the agent explains the river and files **outcome** facts. This is the
  trimmed `routeMessage` — classify a message as `outcome` fact or plain `answer`; a `situation`
  message here becomes "that changes the model — switch to the Model tab" rather than a silent
  reclassification.

### 5.1 Server endpoints (`src/app-server.ts`)

- **Model building:** `understand` returns assumed field values + field-pointed questions (not
  `decisions`). It writes the drafted model via `SetModel` and `SuggestQuestions`.
- **Remove research entirely from the UI path:** delete the `research` action and
  `researchQuestion`, drop the "Look it up" buttons. Keep `web-research.ts` in the repo but
  unreferenced (returns later as a step inside build-model, not a per-question button).
- **Explore chat:** `chat`/`routeMessage` trimmed to `outcome`|`answer`; outcome path unchanged
  (reweight + `AddFact(kind:"outcome")`).
- **Run:** unchanged — build model from the current `model` (already set) → simulate → label.

---

## 6. Frontend changes

- **`app/src/workspace.tsx`:** remove the middle Scenario pane; add the `Model | River` center
  tabs; move Run controls into the Model tab; move the runs strip under River; land on River after
  a run completes; remove the model-dialog `<details>` JSON view (JSON moves into the form's
  Advanced tier).
- **New `app/src/model-form.tsx`:** the grouped Basics/Mechanisms/Advanced form, writing whole-model
  `SetModel`, with `assumed` badges and inline validation. This is the big new component; keep it
  focused and split sub-sections (players, payoffs, a mechanism block) into small components.
- **`app/src/facts.tsx`:** shrinks to an outcome-facts list shown in the River tab (no add box, no
  situation group, no research, no questions — questions move to the Model tab agent panel).
- **Agent panel:** shared right column; build-mode renders field-pointed questions, explore-mode
  renders the chat + outcome filing.

---

## 7. Tradeoffs and risks

- **Partial reversal of the facts redesign.** We re-expose the model, but as a first-class form, not
  a hidden JSON blob — arguably the outcome the facts redesign was reaching for. The genuine
  assumption/outcome split it identified is preserved: model = assumptions (re-run), outcome facts =
  evidence (reweight).
- **Whole-model `SetModel` on each edit** is simple but coarse; flagged with a `ponytail:` upgrade
  path (granular patches only if measured).
- **Legacy tasks** without a model open in the Model tab seeded by their old situation text; the
  agent rebuilds on first Run. No history rewrite.
- **Grouped form is the main new surface area.** It must stay in sync with `domain.ts`; a drift there
  means a valid model the form can't express, or vice-versa. The raw-JSON escape hatch is the safety
  valve for anything the form doesn't cover (memory tables, topology, exotic combinations).

---

## 8. Testing

- **Engine / reweight:** unchanged; `abc.ts` self-check still covers `fitPosterior`.
- **Aggregate (`selfcheck.ts`):** cover `SetModel` bumping `revision`, `AddFact` outcome-only
  rejecting when no model, `RequestAnalysis` requiring a model, dropped `SetFactKind`, and the
  legacy replay still folding old journals.
- **Form ↔ validation:** a round-trip test that every mechanism the form can enable produces a model
  `assertScenario` accepts, and that raw-JSON edits re-validate.
- **Frontend:** typecheck + build; manual walkthrough of build-a-model-via-agent → Run → switch to
  River → tell the agent an outcome → reweight.

---

## 9. Summary

The model becomes the object you edit — a grouped Basics/Mechanisms/Advanced form the agent helps
fill, in its own Model tab beside a River tab. Situation-facts disappear into the model; only outcome
facts remain, added one way (through the agent, in the River view) and reweighting the current run.
Research leaves the UI. Two agent workflows — build-model and explore — replace the single classifier.
The middle pane is removed; staleness simplifies to one revision compare. Net user-facing model:
**one model form + one Run + a separate "what happened" evidence layer.**
