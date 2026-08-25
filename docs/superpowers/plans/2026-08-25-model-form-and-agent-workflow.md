# Model-as-form and two-workflow agent — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `ScenarioModel` the first-class editable object (a grouped form the agent helps fill), reduce facts to an outcome-only evidence layer, split the agent into build-model and explore workflows, and remove research from the UI.

**Architecture:** Three phases that keep `pnpm test` green throughout. Phase 1 reshapes the task aggregate (`src/task.ts`) so the model is the source of truth and only outcome facts remain. Phase 2 rewires the agent (`src/scenario-agent.ts`) and server (`src/app-server.ts`) to build/edit the model and drop research. Phase 3 rewrites the workspace UI into `Model | River` tabs with a grouped model form. Backend is TDD via `src/selfcheck.ts`; frontend is verified by `pnpm build` (typecheck) plus a manual walkthrough.

**Tech Stack:** TypeScript, `@lambda-house/teob-ts` event-sourcing, Node HTTP, React 19 + Vite + TanStack Query/Router, `tsx` self-checks (no test framework).

**Design spec:** [docs/superpowers/specs/2026-08-25-model-form-and-agent-workflow-design.md](../specs/2026-08-25-model-form-and-agent-workflow-design.md)

**Conventions:** run `pnpm test` (self-check + verify-pack) after every backend task; run `pnpm build` after every frontend task. Commit after each task. Branch is `facts-list-and-inference` (already checked out).

---

## Phase 1 — Aggregate: the model becomes the source of truth

Net change in `src/task.ts`:
- `TaskState` gains `situation: string` (the prose seed) and loses `modelRevision`.
- `facts` holds **only** outcome facts. `AddFact` rejects `kind:"situation"`.
- New `SetSituation`/`SituationSet` edits the prose and bumps `revision`.
- `SetModel`/`ModelBuilt` now **bumps `revision`** (the model is the truth) — guarded by a deep-equal check so re-persisting an unchanged model is a no-op.
- Removed: `SetFactKind`/`FactKindChanged`, `revisionAfter`, `modelRevision`, `isModelStale`.
- `OpenQuestion` gains optional `field?: string` (dotted model path).
- Legacy replay unchanged (old situation-facts still fold in; they become read-only history, not editable situation facts — the seed comes from `situation`).

### Task 1.1: TaskState shape — add `situation`, drop `modelRevision`

**Files:**
- Modify: `src/task.ts:39-89` (interfaces), `src/task.ts:151` (`initialTask`), `src/task.ts:166-168` (`isModelStale`)
- Test: `src/selfcheck.ts`

- [ ] **Step 1: Write the failing test** — add after `src/selfcheck.ts:167` (the `created.revision` assertion), replacing nothing yet, append:

```ts
assert.equal(created.situation, "Two suppliers meet every quarter", "the opening description is the situation seed");
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — `created.situation` is `undefined` (property does not exist).

- [ ] **Step 3: Add `situation` to the state and seed it on create**

In `src/task.ts`, extend `OpenQuestion`:

```ts
export interface OpenQuestion {
  id: string;
  prompt: string;
  /** Dotted model path the answer fills, e.g. "structure.w" — lets the form link a question to a field. */
  field?: string;
}
```

Add `situation` to `TaskState` (after `title`) and remove `modelRevision`:

```ts
export interface TaskState {
  id: string;
  title: string;
  /** The prose seed the model is built from; edited in the Basics form as the situation field. */
  situation: string;
  facts: readonly Fact[];
  openQuestions: readonly OpenQuestion[];
  revision: number;
  status: TaskStatus;
  model?: ScenarioModel;
  agent?: AgentSelection;
  analyses: readonly TaskAnalysis[];
  activeAnalysis?: { revision: number; trials: number; seed: number; agent?: AgentSelection; analysisId?: string };
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
}
```

Update `initialTask`:

```ts
const initialTask = (id = ""): TaskState => ({ id, status: "new", title: "", situation: "", facts: [], openQuestions: [], revision: 0, analyses: [] });
```

In `applyTaskEvent`, `TaskCreated` must set `situation`. Replace the `TaskCreated` case:

```ts
    case "TaskCreated": {
      const base = { ...initialTask(event.taskId), title: event.title, createdAt: event.now, updatedAt: event.now };
      const seed = event.fact?.text ?? event.brief ?? "";
      return seed ? { ...base, situation: seed, revision: 1, status: "ready" } : base;
    }
```

Remove `isModelStale` entirely (delete `src/task.ts:165-168`). Leave `isRunStale`.

- [ ] **Step 4: Update the two remaining `isModelStale` importers so the build still compiles**

In `src/app-server.ts:16`, drop `isModelStale` from the import. In `src/app-server.ts:268`, change `modelForRun` to not reference it (fixed properly in Task 2.4; for now make it compile):

```ts
async function modelForRun(id: string, agent: AgentSelection | undefined, now: string): Promise<ScenarioModel> {
  const state = detail(id);
  if (!state) throw new Error("Task not found");
  if (state.model) return state.model;
  const built = await buildScenarioModel(state.situation, undefined, agent);
  const stored = await ask(id, { tag: "SetModel", model: built.model, agent: built.agent, now });
  if (stored.tag === "Rejected") throw new Error(stored.reason);
  return built.model;
}
```

(`buildScenarioModel`'s new signature lands in Task 2.1; this references it ahead so the phases connect. If running Phase 1 alone, temporarily keep the old `buildScenarioModel(state.facts, agent)` call and fix in Phase 2.)

In `src/selfcheck.ts:14`, drop `isModelStale` from the import. Remove the two `isModelStale` assertions at `src/selfcheck.ts:175` and `179` and the surrounding `SetModel`/`AddFact(situation)` lines `174-179` — they are rewritten in Task 1.3.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test`
Expected: PASS with "self-check OK". If `app-server.ts` build errors block `tsx`, that is fine for the self-check (it does not import app-server); ensure `src/selfcheck.ts` runs clean.

- [ ] **Step 6: Commit**

```bash
git add src/task.ts src/selfcheck.ts src/app-server.ts
git commit -m "refactor(task): situation prose seed replaces first fact; model is source of truth"
```

### Task 1.2: `SetSituation` command + `SituationSet` event

**Files:**
- Modify: `src/task.ts` (command/event unions, `decide`, `applyTaskEvent`, `taskEventCodec`)
- Test: `src/selfcheck.ts`

- [ ] **Step 1: Write the failing test** — append after the create assertions (~`src/selfcheck.ts:167`):

```ts
await task.runtime.ask(tid, { tag: "SetSituation", text: "Two suppliers meet every month", now: "2026-01-01T00:00:00Z" }, taskCategory);
const edited = await taskState();
assert.equal(edited.situation, "Two suppliers meet every month", "the situation prose can be edited");
assert.equal(edited.revision, 2, "editing the situation moves the fingerprint");
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — "Unknown command" thrown by `decide` for `SetSituation`.

- [ ] **Step 3: Add the command, event, decide branch, apply branch, codec tag**

Add to `TaskCommand`:

```ts
  | { tag: "SetSituation"; text: string; now: string }
```

Add to `TaskEvent`:

```ts
  | { tag: "SituationSet"; text: string; revision: number; now: string }
```

Add to `decide` (inside the `switch`, before `RemoveAnalysis`):

```ts
      case "SetSituation": {
        const text = command.text.trim();
        if (!text) return rejected(state, "Describe the situation first");
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "SituationSet", text: text.slice(0, 4000), revision, now: command.now }), { tag: "Accepted", revision });
      }
```

Add to `applyTaskEvent` (before the legacy block):

```ts
    case "SituationSet": return { ...state, situation: event.text, revision: event.revision, updatedAt: event.now };
```

Add `"SituationSet"` to the `tagCodec` list in `taskEventCodec` (after `"TitleSet"`).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/task.ts src/selfcheck.ts
git commit -m "feat(task): SetSituation edits the model's prose seed and bumps revision"
```

### Task 1.3: `SetModel` bumps revision (deep-equal guard); drop `SetFactKind`

**Files:**
- Modify: `src/task.ts` (`SetModel` decide, `ModelBuilt` apply, remove `SetFactKind`/`FactKindChanged`/`revisionAfter`)
- Test: `src/selfcheck.ts`

- [ ] **Step 1: Write the failing test** — replace the removed `174-179` block with:

```ts
await task.runtime.ask(tid, { tag: "SetModel", model: scenario, now: "2026-01-01T00:00:02Z" }, taskCategory);
const withModel = await taskState();
assert.ok(withModel.model, "SetModel stores the model");
const modelRevision = withModel.revision;
await task.runtime.ask(tid, { tag: "SetModel", model: scenario, now: "2026-01-01T00:00:02Z" }, taskCategory);
assert.equal((await taskState()).revision, modelRevision, "re-persisting an identical model does not move the fingerprint");
const editedModel = { ...scenario, structure: { ...scenario.structure, noise: [0, 0.1] as const } };
await task.runtime.ask(tid, { tag: "SetModel", model: editedModel, now: "2026-01-01T00:00:03Z" }, taskCategory);
assert.equal((await taskState()).revision, modelRevision + 1, "editing the model moves the fingerprint so runs go stale");
```

Delete the old `SetFactKind` assertions at `src/selfcheck.ts:192-195`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — the identical-model re-persist bumps revision (current `ModelBuilt` sets `modelRevision`, and revision is unchanged, so actually the first new assertion about editing bumping revision fails).

- [ ] **Step 3: Make `SetModel` bump revision on real change only**

In `decide`, replace the `SetModel` case:

```ts
      case "SetModel": {
        try { assertScenario(command.model); } catch (error) { return rejected(state, error instanceof Error ? error.message : "Invalid model"); }
        const changed = JSON.stringify(state.model) !== JSON.stringify(command.model);
        const revision = changed ? state.revision + 1 : state.revision;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuilt", model: command.model, revision, ...(command.agent ? { agent: command.agent } : {}), now: command.now }), { tag: "Accepted", revision });
      }
```

In `applyTaskEvent`, replace the `ModelBuilt` case (it now sets `revision`, not `modelRevision`):

```ts
    case "ModelBuilt": return { ...omit(state, "lastError"), model: event.model, revision: event.revision, ...(event.agent ? { agent: event.agent } : {}), status: state.status === "running" || state.status === "labeling" ? state.status : readyStatus(state), updatedAt: event.now };
```

Remove `SetFactKind` from `TaskCommand`, `FactKindChanged` from `TaskEvent`, the `SetFactKind` case in `decide`, the `FactKindChanged` case in `applyTaskEvent`, and `"FactKindChanged"` from `taskEventCodec`. Remove the `revisionAfter` helper (`src/task.ts:238-241`).

- [ ] **Step 4: Make `AddFact` outcome-only (revision never moves)**

Replace the `AddFact` case in `decide`:

```ts
      case "AddFact": {
        if (command.kind !== "outcome") return rejected(state, "Situations are edited in the model now; only what happened is filed as a fact");
        const text = command.text.trim();
        if (!text) return rejected(state, "The fact is empty");
        if (!state.model) return rejected(state, "Build a model before recording what happened");
        if (state.facts.some((fact) => fact.id === command.factId)) return rejected(state, "That fact already exists");
        const fact: Fact = { id: command.factId, text: text.slice(0, 2000), kind: "outcome", source: command.source, ...(command.observation ? { observation: command.observation } : {}), createdAt: command.now };
        return andReply(persist<TaskEvent, TaskReply>({ tag: "FactAdded", fact, revision: state.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
```

Replace the `EditFact`/`RemoveFact` cases to use `state.revision` directly (no `revisionAfter`):

```ts
      case "EditFact": {
        const target = state.facts.find((fact) => fact.id === command.factId);
        if (!target) return rejected(state, "That fact no longer exists");
        const text = command.text.trim();
        if (!text) return rejected(state, "The fact is empty");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "FactEdited", factId: command.factId, text: text.slice(0, 2000), revision: state.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "RemoveFact": {
        const target = state.facts.find((fact) => fact.id === command.factId);
        if (!target) return rejected(state, "That fact no longer exists");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "FactRemoved", factId: command.factId, revision: state.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
```

Update the self-check's outcome-fact assertions (`src/selfcheck.ts:181-190`): they add outcome facts *after* a model exists now (the model is set earlier in this task), and `SetFactKind` is gone. Keep the "outcome facts do not move the fingerprint" and "outcome facts accumulate" assertions; delete the `situationFacts`/`SetFactKind` lines (`188-195`). Also update `RequestAnalysis` gate assertions later in Task 1.4.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/task.ts src/selfcheck.ts
git commit -m "refactor(task): model edits bump revision, facts are outcome-only, drop SetFactKind"
```

### Task 1.4: `RequestAnalysis` requires a model, not a situation fact

**Files:**
- Modify: `src/task.ts:315-320` (`RequestAnalysis` decide)
- Test: `src/selfcheck.ts`

- [ ] **Step 1: Write the failing test** — before the existing `RequestAnalysis` self-check (`src/selfcheck.ts:210`), on a fresh task with no model, assert rejection. Add near the top-level task section a small block:

```ts
const t2 = createSingleRuntime(taskAggregate, taskEventCodec, taskStateCodec);
const t2id = EntityId("needs-model");
await t2.runtime.ask(t2id, { tag: "CreateTask", taskId: "needs-model", text: "seed", factId: "s", now: "2026-01-01T00:00:00Z" }, taskCategory);
const noModel = await t2.runtime.ask(t2id, { tag: "RequestAnalysis", trials: 10, seed: 1, now: "2026-01-01T00:00:01Z" }, taskCategory);
assert.ok(noModel.ok && noModel.value.reply?.tag === "Rejected", "a run needs a model, and a fresh task has none until Run builds it");
await t2.runtime.shutdown();
```

Note: the real Run endpoint builds the model *before* `RequestAnalysis` (Task 2.4), so this rejection only guards the aggregate-level invariant.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test`
Expected: FAIL — current gate checks `state.facts.some(kind==="situation")`, which is now always false, so it already rejects... verify the message. If it already passes, change the assertion to check the exact reason string below, then proceed.

- [ ] **Step 3: Replace the gate**

In the `RequestAnalysis` case, replace the first guard line:

```ts
        if (!state.model) return rejected(state, "Build a model before running");
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/task.ts src/selfcheck.ts
git commit -m "refactor(task): RequestAnalysis requires a model"
```

---

## Phase 2 — Agent and server: build/edit the model, drop research

### Task 2.1: `buildScenarioModel` builds from prose + existing model

**Files:**
- Modify: `src/scenario-agent.ts:99-135` (`buildScenarioModel`)
- Test: `src/selfcheck.ts` (contract-level; the live agent call needs a provider and is exercised manually)

- [ ] **Step 1: Change the signature and prompt seed**

Replace `buildScenarioModel`'s signature and the `<facts>` block with a prose seed plus the current model as a starting point:

```ts
export async function buildScenarioModel(
  situation: string,
  current: ScenarioModel | undefined,
  selection?: AgentSelection,
): Promise<{ model: ScenarioModel; agent: AgentSelection; meta: AgentRunMeta }> {
  const basePrompt = `Build a complete technical ScenarioModel for the situation below.
Every nullable schema field is required: use null when a mechanism is not needed. Every range is an object {min,max}, with min no greater than max. A prisoners_dilemma must satisfy T>R>P>S and 2R>T+S; chicken/snowdrift must satisfy T>R>S>P; stag_hunt must satisfy R>T>P>S.
memory contains every 2^n window of the same length. payoffsByPlayer names must exactly match participant names. rationale briefly explains material transformations in English.
Choose mode=shared with only the shared payload when the scale is shared; choose mode=asymmetric with only the asymmetric payload when participants need different scales. Set the other payload to null.
Where the situation leaves a quantity uncertain, use a wide range rather than a narrow guess.
When a current draft is given, keep everything the user has already set and only fill gaps or fix validation errors.

<situation>${JSON.stringify(situation)}</situation>
<current-draft>${JSON.stringify(current ?? null)}</current-draft>`;
  // ... invoke/retry body unchanged from here down
```

Keep the rest of the function body (the `invoke`, first/second attempt, `normalizeScenarioDraft`, `assertScenario`) exactly as it was.

- [ ] **Step 2: Update the `understandSituation` signature the same way**

Replace `understandSituation(facts, selection)` with `understandSituation(situation: string, current: ScenarioModel | undefined, selection?)`. Change the prompt's `<facts>` block to `<situation>${JSON.stringify(situation)}</situation>\n<current-draft>${JSON.stringify(current ?? null)}</current-draft>`, and make `questions` carry an optional `field`. Update the `Understanding` interface:

```ts
export interface Understanding {
  title: string;
  model: ScenarioModel;
  questions: { prompt: string; field?: string }[];
  agent: AgentSelection;
  meta: AgentRunMeta;
}
```

Have `understandSituation` call `buildScenarioModel(situation, current, selection)` internally to produce `model`, and return the questions from a trimmed understanding run (or reuse the existing understanding schema, mapping `assumedFacts` away). Concretely: understanding now returns `{ title, questions[] }` and the model is built by `buildScenarioModel`. Merge the two agent metas with `mergeMeta`.

- [ ] **Step 3: Remove the fact helpers no longer used**

Delete `situationFacts` and `factLines` from `src/scenario-agent.ts` **only after** their importers are updated (self-check imports `situationFacts` at `src/selfcheck.ts:18` — remove that import and its one assertion at `src/selfcheck.ts:190`, already deleted in Task 1.3). `routeMessage` still uses facts (outcome only) — give it its own local line builder:

```ts
const outcomeLines = (facts: readonly Fact[]) => facts.filter((f) => f.kind === "outcome").map((f) => `- ${f.text}`).join("\n");
```

and use `outcomeLines(facts)` in the `routeMessage` prompt instead of `factLines(facts)`.

- [ ] **Step 4: Trim `routeMessage` to outcome/answer**

Change `RoutedMessage.kind` to `"answer" | "outcome"`. In the prompt, drop the `kind="situation"` paragraph and replace with: `kind="answer"` covers questions, comments, and anything about what the situation *is* — reply that model changes are made in the Model tab. Keep `kind="outcome"` exactly. Update `factRoutingOutputSchema` in `src/agent-contracts.ts` to a two-value enum (`answer`/`outcome`).

- [ ] **Step 5: Typecheck**

Run: `pnpm build`
Expected: PASS (fix any callers flagged; `app-server.ts` callers are fixed in Task 2.3–2.4).

- [ ] **Step 6: Commit**

```bash
git add src/scenario-agent.ts src/agent-contracts.ts src/selfcheck.ts
git commit -m "feat(agent): build/understand the model from prose seed; route to outcome-or-answer"
```

### Task 2.2: Remove research from the agent and server

**Files:**
- Modify: `src/scenario-agent.ts` (delete `researchQuestion`, `ResearchedAnswer`, `SourceLink`, the `researchWeb` import)
- Modify: `src/app-server.ts` (delete the `research` route `445-452`, drop `researchQuestion` import, drop `research` from the route regex `399`)

- [ ] **Step 1: Delete `researchQuestion` and its types in `src/scenario-agent.ts`** (`137-193`) and the `import { researchWeb } from "./web-research.js";` line. Leave `src/web-research.ts` in the repo, now unreferenced.

- [ ] **Step 2: Delete the research route in `src/app-server.ts`** (`444-452`), remove `researchQuestion` from the import at line 12, and remove `research` from the action regex at line 399 (`(commands|chat|understand|run|events|activity)`).

- [ ] **Step 3: Typecheck**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/scenario-agent.ts src/app-server.ts
git commit -m "refactor: remove research from the agent and server (returns later inside model-building)"
```

### Task 2.3: `understand` endpoint writes the model + field questions

**Files:**
- Modify: `src/app-server.ts:433-443` (`understand` route), delete `addAgentFacts` (`209-214`)

- [ ] **Step 1: Rewrite the `understand` route**

```ts
    if (req.method === "POST" && action === "understand") {
      const input = await body(req); const state = detail(id);
      if (!state || state.deleted) { send(res, 404, { error: "Task not found" }); return; }
      if (!state.situation.trim()) { send(res, 409, { error: "Describe the situation first" }); return; }
      const understanding = await understandSituation(state.situation, state.model, agentFor(state, input.agent));
      const now = new Date().toISOString();
      await ask(id, { tag: "SetTitle", title: understanding.title, now });
      await ask(id, { tag: "SetModel", model: understanding.model, agent: understanding.agent, now });
      await ask(id, { tag: "SuggestQuestions", questions: understanding.questions.map((q) => ({ id: randomUUID(), prompt: q.prompt, ...(q.field ? { field: q.field } : {}) })), now });
      send(res, 200, detail(id)); return;
    }
```

Delete `addAgentFacts` (no longer used). Confirm `SuggestQuestions` command accepts `field` (it passes `command.questions` straight to the event; `OpenQuestion` already has `field?`).

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app-server.ts
git commit -m "feat(server): understand writes the model and field-pointed questions"
```

### Task 2.4: `SetSituation` route + Run uses the stored model; chat is outcome-only

**Files:**
- Modify: `src/app-server.ts` — `commandFrom` (add `SetSituation`), `modelForRun` (`265-273`), the `chat` route (`453-483`)

- [ ] **Step 1: Add `SetSituation` to `commandFrom`**

```ts
    case "SetSituation": return { tag: "SetSituation", text: String(input.text ?? ""), now };
```

Also add a `SetModel` passthrough so the form can save a hand-edited model:

```ts
    case "SetModel": return { tag: "SetModel", model: input.model as ScenarioModel, now };
```

(`input.model` is validated inside the aggregate by `assertScenario`.)

- [ ] **Step 2: Simplify `modelForRun` to use the stored model**

```ts
async function modelForRun(id: string, agent: AgentSelection | undefined, now: string): Promise<ScenarioModel> {
  const state = detail(id);
  if (!state) throw new Error("Task not found");
  if (state.model) return state.model;
  const built = await buildScenarioModel(state.situation, undefined, agent);
  const stored = await ask(id, { tag: "SetModel", model: built.model, agent: built.agent, now });
  if (stored.tag === "Rejected") throw new Error(stored.reason);
  return built.model;
}
```

- [ ] **Step 3: Trim the `chat` route to outcome/answer**

In the `chat` route, `routed.kind` is now `"answer" | "outcome"`. Remove the `situation` note branch (`469`). The `AddFact` call keeps `kind: routed.kind` (only ever `"outcome"` reaches it now). Keep the reweight-summary block for `outcome`. The `answer` early-return is unchanged.

- [ ] **Step 4: Typecheck**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app-server.ts
git commit -m "feat(server): SetSituation/SetModel routes, Run uses stored model, chat is outcome-only"
```

---

## Phase 3 — Frontend: Model | River tabs and a grouped model form

Phase 3 is a UI rewrite; tasks give exact files, real prop/type contracts, one worked example per repeated pattern, and verify with `pnpm build` (typecheck) plus a manual walkthrough. Follow the existing style in `app/src/workspace.tsx` (inline styles are not used there — it is class-driven via `app/src/styles.css`; add classes there).

### Task 3.1: API client — new commands and endpoints

**Files:**
- Modify: `app/src/api.ts`

- [ ] **Step 1: Update `FactCommand` and add model/situation calls**

```ts
export type FactCommand =
  | { tag: "AddFact"; text: string; kind: "outcome" }
  | { tag: "EditFact"; factId: string; text: string }
  | { tag: "RemoveFact"; factId: string }
  | { tag: "SetSituation"; text: string }
  | { tag: "SetModel"; model: ScenarioModel }
  | { tag: "DismissQuestion"; questionId: string }
  | { tag: "RemoveAnalysis"; analysisId: string }
  | { tag: "CancelAnalysis" }
  | { tag: "DeleteTask" };
```

Change `ChatResult.kind` to `"answer" | "outcome"`. Delete `ResearchResult` and `researchQuestion` (the export at `app/src/api.ts:112`). `understandTask`, `runTask`, `chatTask`, `sendCommand` keep their signatures.

- [ ] **Step 2: Typecheck**

Run: `pnpm build`
Expected: FAIL in `workspace.tsx`/`facts.tsx` (they still reference removed things) — that is expected; the next tasks fix the UI. To keep this task self-contained, run only the type emit for `api.ts` mentally and proceed; the build goes green at Task 3.5.

- [ ] **Step 3: Commit**

```bash
git add app/src/api.ts
git commit -m "feat(app): API client for model/situation commands, drop research"
```

### Task 3.2: The grouped model form component

**Files:**
- Create: `app/src/model-form.tsx`
- Modify: `app/src/styles.css` (form classes)

- [ ] **Step 1: Define the component contract**

```ts
import type { ScenarioModel } from "./api";

export interface ModelFormProps {
  situation: string;
  model?: ScenarioModel;
  questions: readonly { id: string; prompt: string; field?: string }[];
  busy: boolean;
  onSituation: (text: string) => void;      // → SetSituation
  onModel: (model: ScenarioModel) => void;   // → SetModel (whole model)
  onUnderstand: () => void;                   // → POST /understand (agent fills)
  onDismissQuestion: (id: string) => void;
}

export function ModelForm(props: ModelFormProps): JSX.Element;
```

The form renders three tiers over `props.model` (or an empty draft when `model` is undefined — see Step 3), calling `props.onModel(next)` with a new whole-model object on every field edit. `situation` edits call `props.onSituation`.

- [ ] **Step 2: Empty draft helper**

When `model` is undefined, edit against a minimal valid-shaped draft so the form is usable before the first agent build:

```ts
const emptyModel = (situation: string): ScenarioModel => ({
  situation,
  game: "prisoners_dilemma",
  players: [
    { name: "Side A", dispositions: ["provocable"] },
    { name: "Side B", dispositions: ["provocable"] },
  ],
  payoffs: { T: [5, 5], R: [3, 3], P: [1, 1], S: [0, 0] },
  structure: { w: [0.9, 0.9], noise: [0, 0] },
});
```

- [ ] **Step 3: Basics tier — worked example**

Render, in order: situation textarea (→ `onSituation`), game-type pills (PD / Chicken / Stag hunt → set `model.game`), players list (name + a disposition `<select>` over `strategyIds`), payoff T/R/P/S range inputs (shared), and two range sliders for `structure.w` and `structure.noise`. Example for the game-type pills (repeat the pattern for the other Basics controls):

```tsx
const GAMES: { id: ScenarioModel["game"]; label: string }[] = [
  { id: "prisoners_dilemma", label: "Prisoner's dilemma" },
  { id: "chicken", label: "Chicken" },
  { id: "stag_hunt", label: "Stag hunt" },
];
// inside render, with `m` = current model draft:
<div className="game-pills">
  {GAMES.map((g) => (
    <button type="button" key={g.id} className={`pill ${m.game === g.id ? "on" : ""}`} disabled={busy}
      onClick={() => onModel({ ...m, game: g.id })}>{g.label}</button>
  ))}
</div>
```

- [ ] **Step 4: Mechanisms tier — chips + one worked block**

A row of toggle chips; each chip toggles a `structure.*` (or player-level) sub-object between `undefined` and a default, then reveals its fields when present. Worked example for Cheap talk (repeat the pattern for Reputation, Punishment, Exit, Dynamic game, Teams, Lean & drift — field lists in the spec §4.1):

```tsx
const cheap = m.structure.cheapTalk;
<div className="mech">
  <button type="button" className={`chip ${cheap ? "on" : ""}`} disabled={busy}
    onClick={() => onModel({ ...m, structure: { ...m.structure, cheapTalk: cheap ? undefined : { credibility: [0.3, 0.5], lieCost: [0, 1] } } })}>
    Cheap talk
  </button>
  {cheap && (
    <div className="mech-fields">
      <RangeField label="Credibility" value={cheap.credibility} max={1}
        onChange={(v) => onModel({ ...m, structure: { ...m.structure, cheapTalk: { ...cheap, credibility: v } } })} />
      <RangeField label="Lie cost" value={cheap.lieCost}
        onChange={(v) => onModel({ ...m, structure: { ...m.structure, cheapTalk: { ...cheap, lieCost: v } } })} />
    </div>
  )}
</div>
```

Coupling rules to implement (mirror `assertScenario`): enabling Exit sets `structure.sigma` and offers `loner` as a disposition; enabling Punishment sets `structure.punishment` and offers `punisher`; the Reputation chip is disabled with a hint when `model.players.length < 3`; Dynamic game is a single choice of `eco` **or** `transitions` (never both). Provide a small `RangeField` helper (two number inputs producing a `[number, number]`).

- [ ] **Step 5: Advanced tier**

A collapsible `<details>` holding: an asymmetric-payoffs toggle, a `rationale` notes editor, and a raw-JSON `<textarea>` that parses on blur and calls `onModel(parsed)` (showing a parse/validation error inline; the server re-validates via `assertScenario`). Custom `memory` tables and `topology` are edited only through this raw JSON this round.

- [ ] **Step 6: Inline validation + questions**

Show `props.questions` as a small "Worth clarifying" list; answering a question calls `onSituation`-appends or, when `field` is set, focuses that field; dismissing calls `onDismissQuestion`. Surface obvious client-side validation (e.g. payoff ordering) as a hint, but Run is the final gate.

- [ ] **Step 7: Typecheck**

Run: `pnpm build`
Expected: FAIL only where `workspace.tsx` has not yet mounted `ModelForm` — acceptable until Task 3.5. Ensure `model-form.tsx` itself has no type errors by temporarily importing it in `workspace.tsx` behind the Model tab (Task 3.4).

- [ ] **Step 8: Commit**

```bash
git add app/src/model-form.tsx app/src/styles.css
git commit -m "feat(app): grouped Basics/Mechanisms/Advanced model form"
```

### Task 3.3: `facts.tsx` shrinks to an outcome list

**Files:**
- Modify: `app/src/facts.tsx`

- [ ] **Step 1: Reduce the component**

Replace `FactsPanel` with `OutcomeFacts` — a read/remove list of `task.facts` (all `outcome` now), no add box (outcome facts arrive via chat), no situation group, no research, no questions (questions move to `ModelForm`):

```tsx
export function OutcomeFacts({ facts, busy, onRemove }: {
  facts: readonly Fact[];
  busy: boolean;
  onRemove: (factId: string) => void;
}) {
  if (!facts.length) return null;
  return <section className="section outcome-facts">
    <div className="eyebrow">What already happened</div>
    <ul className="fact-list">
      {facts.map((fact) => <li key={fact.id} className="fact outcome">
        <span className="fact-text">{fact.text}</span>
        <button type="button" className="fact-remove" disabled={busy} aria-label={`Remove: ${fact.text}`} onClick={() => onRemove(fact.id)}>×</button>
      </li>)}
    </ul>
  </section>;
}
```

Delete `FactRow`, `QuestionRow`, the research plumbing, and the `KIND_LABEL` map.

- [ ] **Step 2: Commit** (build goes green at 3.5)

```bash
git add app/src/facts.tsx
git commit -m "refactor(app): facts panel becomes an outcome-only list"
```

### Task 3.4: Workspace — `Model | River` tabs, mount the form and runs

**Files:**
- Modify: `app/src/workspace.tsx`, `app/src/styles.css`

- [ ] **Step 1: Add tab state and render tabs in the center pane**

```tsx
const [centerTab, setCenterTab] = useState<"model" | "river">("model");
// land on River when a run completes:
useEffect(() => { if (current?.status === "completed" && selectedAnalysis) setCenterTab("river"); }, [current?.status, selectedAnalysisId]);
```

Render a tab bar at the top of `main.river-pane`:

```tsx
<div className="center-tabs">
  <button className={centerTab === "model" ? "on" : ""} onClick={() => setCenterTab("model")}>Model</button>
  <button className={centerTab === "river" ? "on" : ""} onClick={() => setCenterTab("river")}>River</button>
</div>
```

- [ ] **Step 2: Remove the middle Scenario pane; move Run + runs**

Delete the entire `<aside className="pane run-pane">` block (`workspace.tsx:591-612`) and its `FactsPanel` usage. Move the Run controls (worlds input + Run/Cancel button) into the Model tab footer, and the saved-runs strip (`uniqueRuns(analyses).map(...)`) under the River tab. Delete the model-dialog `<details>` JSON view (`workspace.tsx:641`) — JSON now lives in the form's Advanced tier.

- [ ] **Step 3: Render tab bodies**

```tsx
{centerTab === "model" ? (
  <ModelForm
    situation={current?.situation ?? ""}
    model={current?.model}
    questions={current?.openQuestions ?? []}
    busy={busy}
    onSituation={(text) => void runCommand({ tag: "SetSituation", text })}
    onModel={(model) => void runCommand({ tag: "SetModel", model })}
    onUnderstand={() => void reviewWithAgent()}
    onDismissQuestion={(questionId) => void runCommand({ tag: "DismissQuestion", questionId })}
  />
) : (
  /* existing river-host iframe + runs strip + OutcomeFacts */
)}
```

Wire `OutcomeFacts` into the River tab: `<OutcomeFacts facts={current?.facts ?? []} busy={busy} onRemove={(factId) => void runCommand({ tag: "RemoveFact", factId })} />`.

- [ ] **Step 4: Remove research UI and old fact wiring**

Delete `researchQuestion` import and its usage; delete `onAddFact`/`onResearch`/`onUnderstand` props threaded to the old `FactsPanel`; the "Add a fact" box is gone (outcome facts come from chat). Keep the agent drawer/chat exactly as is (explore workflow); its `chatTask` now only returns `answer`/`outcome`.

- [ ] **Step 5: Typecheck + build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/workspace.tsx app/src/styles.css
git commit -m "feat(app): Model | River center tabs, model form and runs relocated"
```

### Task 3.5: Manual walkthrough

**Files:** none (verification)

- [ ] **Step 1: Start the app**

Run: `pnpm app` then open http://127.0.0.1:4317

- [ ] **Step 2: Verify the flow**

  1. Create a situation from prose → lands in the Model tab with the situation text seeded.
  2. Press "Review with agent" → the form fills with an agent-built model; `assumed` fields marked; questions appear under "Worth clarifying".
  3. Toggle a mechanism chip (e.g. Cheap talk) → fields appear; edit a payoff range.
  4. Press Run → switches to the River tab; the river renders.
  5. In the chat, state an outcome ("cooperation collapsed") → it files an outcome fact and the run reweights; the fact shows in the River tab's outcome list.
  6. Edit a model field back in the Model tab → the saved run shows as stale; Run again clears it.

- [ ] **Step 3: Commit any fixes found, then run the full gate**

Run: `pnpm test && pnpm build`
Expected: "self-check OK" and a clean build.

```bash
git add -A
git commit -m "fix(app): model-form workflow polish from manual walkthrough"
```

---

## Notes for the executor

- **`pnpm test` is the backend gate** (`tsx src/selfcheck.ts && tsx src/verify-pack.ts`); there is no test framework — assertions live in `src/selfcheck.ts`.
- **`pnpm build` is the frontend gate** (type-checks engine + app, then Vite build).
- **Legacy journals** must keep replaying: do not touch the legacy `apply` branches in `src/task.ts` (`BriefEdited`/`ContextAdded`/…); the existing self-check legacy-replay block at `src/selfcheck.ts:140-151` must stay green.
- **`ponytail:`** whole-model `SetModel` on each edit is deliberate; add granular patch commands only if payload size or concurrent edits measurably hurt.
