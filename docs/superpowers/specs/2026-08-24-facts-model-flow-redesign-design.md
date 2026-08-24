# Redesign: one facts list instead of brief + context + assumptions + observations

**Date:** 2026-08-24
**Status:** Implemented (2026-08-24). Section 6 records what shipped; the remaining open questions are still open.
**Scope:** How information enters a scenario and drives the model and the run. Backend aggregate, agent flow, and workspace UI. Does not change the simulation engine (`kernel.ts`, `analysis.ts`, `abc.ts`).

---

## 1. Problem

Information about a scenario currently enters through **four** separate concepts that behave differently and interact in non-obvious ways:

| Concept | Where | Behaviour |
|---|---|---|
| `brief` | `TaskState.brief` | Free-text description; seeds the title; editing resets the model. |
| `context[]` | `TaskState.context` | List of clarifications; `AddContext` sets `invalidatesModel` → status `draft` → agent rebuilds. |
| `assumptions` / `decisions` | proposal `decisions`, `TaskState.assumptions` | Agent-inferred assumptions the user confirms on a separate "Did we understand correctly?" screen. |
| `observations` | `TaskAnalysis.observations` (per run) | Outcome facts that reweight one run via `fitPosterior`; recorded through a chat router. |

On top of these sit several **state transitions and flows**:

- Model construction is a multi-step dance: `understand` → proposal with `decisions` → `build-model` → `RecordAgentProposal` → `AcceptProposal` → `ModelReplaced` → `RequestAnalysis` → `running` → `labeling` → `completed`.
- A chat message is classified by a router (`routeFact`, `src/scenario-agent.ts`) into `answer` | `observation` | `revision`, each with a different side effect (reweight vs propose a model change).
- Adding context **invalidates** the model and drops the task back to `draft`; the seven-value `TaskStatus` (`new | draft | ready | running | labeling | completed | failed`) encodes this.

The **recommendations/context surface** is a specific source of pain within this:

- Every `decision` is a question the agent has **already answered**, and an empty answer is **forbidden** (`"Complete the selected assumptions"`). There is no notion of a plain open question the user may leave unanswered — recommendations are conflated with pre-filled assumptions.
- **Web research** is wired into the gap/recommendation flow (a "Research" button per hint, `refreshAssumptions(research:true)`) rather than being an optional, separate action. A recommendation should not imply research.
- **Context is formed and edited oddly:** `Clarifications` merges three sources — the `assumptions` list, free-text `context` notes, and a synthetic marker (`"The user confirmed the following assumptions."`) that is written on confirm and then filtered out — plus a "legacy items need updating" affordance, each with different edit/delete controls.
- The **title** is editable and coupled to the brief/proposal, adding another editable surface.

The result is powerful but **hard to hold in your head**. A user cannot answer the simple question "where do I put a new fact, and what will it do?" without knowing the internal distinction between assumptions and outcomes, the invalidation rules, the accept/reject gate, and the recommendation/research/context tangle. This is the "too clever" (хитро) problem.

### Why the distinction is real (not arbitrary cleverness)

There is **one** genuine, irreducible distinction underneath all of this:

- A fact that changes an **assumption** (a payoff, a party's disposition, the time horizon, a mechanism) changes the *space of possible worlds itself* → the simulation must be **re-run**.
- A fact that reports an **outcome** (how much they cooperated, who came out ahead) does not change assumptions → the existing worlds are just **reweighted** (cheap, instant, via `fitPosterior`).

You cannot dissolve this distinction — it reflects a computational fact. Reweighting cannot introduce a world the model never sampled; re-running is expensive. What we *can* do is stop exposing it as four concepts and several flows, and instead present **one list** with the distinction hidden and the expensive path made explicit and batched.

---

## 2. Goal

Collapse the four concepts into **one list of facts** with a single, predictable mental model:

> You keep one list of facts about the situation. Adding a fact is cheap. Facts that describe *what the situation is* shape the model; facts that describe *what actually happened* reweight the current run instantly. You press **Run** once, when you're ready, to (re)build the model and simulate — never on every fact.

Success criteria:

1. A user can add any fact in one place without choosing a category or understanding invalidation rules.
2. Adding a fact never triggers an automatic re-run. Re-running is one explicit action.
3. Outcome facts show their effect immediately and cheaply (no re-run).
4. The number of user-facing concepts drops from four to **one** (`facts`), plus one action (`Run`).

Non-goals: changing the engine, the river visualization, or the benchmarking. Endogenous coalition formation and other roadmap items are out of scope.

---

## 3. Proposed design

### 3.1 Data model

A task holds a single ordered list:

```ts
interface Fact {
  id: string;
  text: string;                 // "Google plans over many years"
  kind: "situation" | "outcome";
  source: "user" | "agent";     // agent = an assumption the agent inferred
  createdAt: string;
}

interface TaskState {
  id: string;
  title: string;                // still derived / agent-set for the sidebar
  facts: readonly Fact[];       // replaces brief, context, assumptions, observations
  openQuestions: readonly { id: string; prompt: string }[]; // non-blocking "worth clarifying"
  model?: ScenarioModel;        // derived from situation-facts on the last Run
  modelRevision?: number;       // revision the model was built from (staleness)
  analyses: readonly TaskAnalysis[];
  // ... run bookkeeping (activeAnalysis, etc.)
}
```

- **`brief` is gone.** The initial free-text description becomes the first `situation` fact (`source:"user"`).
- **`context[]` is gone.** Clarifications are `situation` facts.
- **`assumptions`/`decisions` are gone.** The agent's inferred assumptions are appended as `situation` facts with `source:"agent"`, visible and editable in the same list. No separate confirmation screen.
- **`observations` are gone.** Outcome evidence lives as `outcome` facts on the **task** (not per run). They reweight whichever run is current; after a new Run they reweight the new run.

The model is a pure function of the `situation` facts. The current run's displayed shares are the run reweighted by the `outcome` facts (`fitPosterior`, already built and tested).

### 3.2 Adding a fact

One entry point (the chat box, and/or a "+ add fact" field — see Open Questions). When the user submits a fact:

1. The agent **classifies** it as `situation` or `outcome` (reusing the `routeFact` classifier, trimmed to two kinds + a plain-answer passthrough for questions).
2. It is appended to `facts` with that `kind`.
3. **If `outcome` and a run exists:** reweight the current run immediately and show the updated shares. Cheap; no re-run.
4. **If `situation`:** mark the run **stale** (`revision` has moved past the run's own). Do **not** rebuild or re-run. The Run button becomes prominent.

> **As built:** no separate hash was needed. `revision` already increments on situation-fact changes and is stamped on every analysis, so `analysis.revision !== state.revision` *is* staleness (`isRunStale`), and `modelRevision !== revision` is a stale model (`isModelStale`). Outcome facts deliberately leave `revision` untouched.

The classification is a hidden implementation detail. The user sees a fact appear in the list with a small tag they can flip if the agent guessed wrong (see Open Questions on override).

### 3.3 The Run action

One button. When pressed:

1. Build the model from **all `situation` facts** (`buildScenarioModel`, reusing the existing agent path, but seeded from facts instead of brief+context+decisions).
2. Simulate (`analyzeScenario` in the worker) and label the river.
3. Store `lastRunFactsHash`. The run is now current.
4. Apply the `outcome` facts to reweight the fresh run.

`outcome` facts **never** enter the model build — only `situation` facts do. This preserves the condition/revise separation that makes the analysis honest, while hiding it behind one list and one button.

### 3.4 Staleness

- Adding/editing/removing a `situation` fact → run is stale (Run highlighted, e.g. "3 new facts — Run to update").
- Adding/editing/removing an `outcome` fact → run is **not** stale; it just reweights.
- Removing all `outcome` facts returns the run to its unconditioned shares.

Staleness replaces the `invalidatesModel` / `draft` machinery. `TaskStatus` shrinks to roughly `{ empty | ready | running | done }` plus a `stale` boolean, rather than seven values encoding the invalidation dance.

### 3.5 Agent output: assumptions, questions, and research (not "decisions")

Today the agent's understanding is one bag of `decisions` (`{ prompt, answer, alternatives }`), where every item is a question the agent has already answered, an empty answer is forbidden ("Complete the selected assumptions"), and a "Research" web-lookup is wired into the flow. This conflates three genuinely different things. Split them:

1. **Confident assumptions** → `situation` facts with `source:"agent"`, marked as inferred (a subtle "assumed" tag) so the user sees they are guesses. They live in the one list and are edited/removed like any fact. No separate confirmation screen.
2. **Open questions** (the agent is unsure) → a small, **non-blocking** "Worth clarifying" list. Each is just a prompt with no pre-filled answer. Answering it appends a `situation` fact (`source:"user"`) and removes the question; ignoring it is fine because the corresponding default already exists as an agent-assumed fact. **Questions never block Run.**
3. **Research** → an **optional** per-question action ("look this up"), decoupled from the recommendation concept. It fetches sources and drafts an answer the user can accept or edit. Research is a helper on a question, not the default path for every recommendation.

So "recommendation" stops meaning "a question the agent pre-answered and you must confirm." Confident guesses become editable facts; genuine unknowns become optional questions; verification is an opt-in action.

### 3.6 Title

The situation title becomes **agent-owned**, derived from the facts. It is no longer user-editable, removing the `edit-brief`→title coupling and title editing inside the proposal. (A dedicated rename could be added later if users ask; the default is that the agent names it.)

---

## 4. What changes in the code

### Backend — `src/task.ts` (aggregate)

- **Remove** events/commands: `AddContext`, `EditContext`, `RemoveContext`, `ContextAdded/Edited/Removed`, `AgentProposalRecorded/Accepted/Rejected` (proposal gate), `RecordObservation/ClearObservations`, `ObservationRecorded/ObservationsCleared`, and the `decisions`/`assumptions` fields.
- **Add** events/commands: `AddFact`, `EditFact`, `RemoveFact`, `SetFactKind` (user override), `AnswerQuestion` (answering appends a fact and drops the question), and `FactAdded/Edited/Removed/KindSet`, `QuestionsSet`, `QuestionAnswered`; `SetModel` (written by Run) replacing the proposal flow. Open questions are set by the agent (on describe/Run) and are non-blocking.
- `apply` maintains the single `facts` list. Fact edits that touch a `situation` fact do not change a `revision` counter (staleness is a hash compare, not optimistic revisions) — though we keep an optimistic guard for concurrent edits (see Open Questions).
- Migration/upcasting: old journals replay `brief` → first `situation` fact; each `context[]` entry → `situation` fact; each `observation` → `outcome` fact; drop `decisions`. This is a codec upcast (`codecWithUpcasts`, already used in `src/run.ts`).

### Backend — `src/scenario-agent.ts`

- `routeFact` shrinks: classify a submitted message as `situation` fact | `outcome` fact | plain `answer` (question → chat). Drop the `revision`-produces-a-proposal branch; a `situation` fact just goes in the list and the model rebuilds on the next Run.
- `understandScenario` stops emitting `decisions`. Instead it returns two things: **assumed facts** (`source:"agent"` situation facts) and **open questions** (non-blocking). The forbidden-empty-answer gate and the confirm screen are gone.
- **Research** moves to a small optional endpoint invoked per open question (reusing `researchWeb`), returning sources + a drafted answer; it is no longer part of the understanding/decisions flow.
- `buildScenarioModel` is re-seeded to take the `situation` facts directly.

### Backend — `src/app-server.ts`

- Replace the `/agent` proposal endpoints and the `/fact` router side effects with: `POST /facts` (add, returns classification + optional live reweight), `PATCH/DELETE` a fact, `POST .../run`, and the existing `GET .../posterior` (reweight of current run by task outcome-facts).
- Keep `readRiverArtifact`, `resultFromArtifact`, `runPosterior`, `fitPosterior` — the reweight machinery is unchanged.

### Frontend — `app/src/workspace.tsx`

- Replace the Situation/brief block, the "Add context" flow, the `Clarifications` component (assumptions + context + legacy merge), the ProposalCard/ProposalEditor "Did we understand correctly?" screen and its answer-editing grid, the mandatory "Complete the selected assumptions" gate, the `edit-brief`/`edit-context` prompt modes, and the run-scoped `RunObservations` card with:
  - a **single facts list** — each row shows the text, a `situation`/`outcome` tag, a `source` marker (an "assumed" hint for `source:"agent"`), and edit/remove;
  - a small non-blocking **"Worth clarifying"** questions list — answer inline (→ fact) or ignore; each question has an optional **Research** button;
  - one **Run** button that shows staleness ("3 new facts — Run to update").
- The **title** is read-only (agent-owned); title editing is removed.
- The chat remains for questions and free discussion; stating a fact in chat routes to `AddFact`.

---

## 5. Tradeoffs and risks

- **We hide, not remove, the assumption/outcome distinction.** A `situation`/`outcome` tag is still visible per fact and flippable. If the agent misclassifies, the user must correct it, or an outcome fact could get baked into the model on Run (the original trap). Mitigation: default ambiguous facts to `outcome` (non-destructive) and make the tag obvious.
- **Removing the proposal/decisions gate** trades a quality checkpoint for simplicity. The agent's assumptions are still surfaced (as `source:"agent"` facts) and editable, so the review moves *into* the list rather than a modal — arguably better, but it changes behaviour and needs UX validation.
- **Outcome facts at task level** apply to the current/latest run. With multiple saved runs for comparison, "current" must be defined (see Open Questions).
- **Migration** of existing journals is required and must be reversible-safe (upcast only, never rewrite history).
- **Large rewrite** across aggregate, agent, server, and the single large `workspace.tsx`. `workspace.tsx` is already big; this is a chance to split the facts list, chat, and run panels into focused components.

---

## 6. Decisions made and open questions

**Decided in brainstorming:**

- **Flow:** one facts list + one explicit, batched **Run**; outcome facts reweight instantly, situation facts defer to Run. (No recompute per fact.)
- **Uncertainty:** **non-blocking** questions. The agent adds a default assumed fact *and* surfaces an optional "Worth clarifying" question; answering replaces the default, ignoring keeps it. Never blocks Run.
- **Recommendations split** into assumed facts / open questions / optional research (§3.5).
- **Title:** agent-owned, not user-edited (§3.6).
- **Classification override:** each fact shows its `situation`/`outcome` tag and `source`; the tag is flippable inline. Ambiguous facts default to `outcome` (non-destructive).

**Still open (for the next brainstorm):**

1. **Entry point:** one chat box that also adds facts, or a dedicated "+ add fact" field beside the list, or both? Chat-only is simplest but mixes questions and facts.
2. **Initial description:** stored as one `situation` fact verbatim, or split by the agent into several atomic facts? Splitting is cleaner but risks mangling the user's words.
3. **Model visibility:** fully hidden (only facts + river), or a read-only "view the model" pane for advanced users? The proposal modal is gone; a game-theory tool may still need payoffs/strategies inspectable somewhere.
4. **Multiple runs + outcome facts:** do task-level outcome facts reweight only the latest run, all runs, or the selected run? How does this interact with run comparison?
5. **Staleness vs concurrency:** hash-based staleness for "needs Run" plus an optimistic guard for two clients editing the same fact — or keep the revision counter for both?
6. **Conflicting outcome facts:** two contradictory outcomes collapse ESS toward zero (honest but confusing). Surface a "these facts conflict" hint?
7. **Question volume:** how aggressively should the agent ask vs silently assume? Too many "Worth clarifying" items becomes noise; what caps or ranks them?
8. **Question lifecycle:** are open questions regenerated on every Run, or persistent until answered/dismissed? What happens to a question when the underlying facts change?
9. **Research output:** does a researched answer auto-fill the fact, or present as a draft for the user to accept/edit? How are sources shown once decoupled from the proposal?
10. **"Assumed" visibility:** how strongly to distinguish `source:"agent"` facts so users don't mistake the agent's guesses for their own input (which would falsely raise confidence)?

---

## 7. Testing

- **Engine:** unchanged; `fitPosterior` array accumulation already covered by `abc.ts` self-check.
- **Aggregate:** `selfcheck.ts` gains coverage for `AddFact`/`EditFact`/`RemoveFact`/`SetFactKind`/`SetModel`, staleness, and the upcast from a legacy `brief`/`context`/`observation` journal.
- **Agent:** classifier reduced to `situation`/`outcome`; verify on a few real phrasings (needs a provider).
- **Frontend:** typecheck + build; manual walkthrough of add-fact → reweight and add-situation-fact → stale → Run.

---

## 8. Summary

Four concepts (`brief`, `context`, `assumptions`, `observations`) and several flows collapse into **one list of facts** with a `situation`/`outcome` tag and **one Run button**. Outcome facts reweight the current run instantly and cheaply; situation facts accumulate and are applied on an explicit, batched Run. The genuine assumption/outcome distinction is preserved for correctness but no longer surfaced as separate concepts — resolving the "one list, but no recompute every time" requirement.

The recommendation surface is untangled in parallel: the agent's output splits into **assumed facts** (editable, in the list), **non-blocking open questions** ("Worth clarifying", answer or ignore), and **optional research** (a per-question helper, not a default). The `context` machinery, the "Did we understand correctly?" gate, and title editing are removed. Net user-facing model: **one facts list + a small optional questions list + one Run button**.

**Shipped.** `brief`/`context`/`assumptions`/`observations` are gone from `src/task.ts`, replaced by one
`facts` list plus `openQuestions`; `revision` moves only for situation facts and is the fingerprint a
run is measured against, so a model is now marked stale rather than destroyed. Legacy journals replay
into the facts model through `applyTaskEvent` (no history rewrite). `understandSituation` returns
assumed facts and questions instead of `decisions`; research is a per-question helper. The proposal
gate, the "Did we understand correctly?" screen and title editing are removed; the model is read-only
and derived. `app/src/facts.tsx` holds the new list UI.

Two bugs the new self-checks caught during implementation, both now guarded: `SetModel` was blocked
while a run was in flight (a run builds its model as its first step, so every run from stale facts
deadlocked), and `ModelBuilt` reset the status of an in-flight run.

The open questions above remain the seeds of the next brainstorm.
