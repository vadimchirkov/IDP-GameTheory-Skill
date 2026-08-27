import {
  CategoryId, EntityId, andReply, categoryTypes, objectCodec, persist, reply, tagCodec,
  type Aggregate, type Effect,
} from "@lambda-house/teob-ts/core";
import { assertScenario, type ScenarioModel } from "./domain.js";
import type { AgentRunMeta, AgentSelection } from "./agent-contracts.js";
import type { ResearchSource } from "./web-research.js";

/**
 * The model (built from the `situation` prose seed) is the source of truth for the scenario.
 * Editing the model or the situation prose bumps `revision` and leaves existing runs stale until
 * the next Run. `outcome` facts say what already *happened*; they are evidence that reweights a
 * finished run and never touch the model, so they leave `revision` alone. There is no separate
 * brief, context list, assumption set, or per-run observation store.
 */
export type FactKind = "situation" | "outcome";
export type FactSource = "user" | "agent";

/** Structured reading of an `outcome` fact, used to reweight a run (see `fitPosterior`). */
export interface FactObservation {
  cooperation?: number;
  winner?: string;
  regime?: string;
  playerCooperation?: Record<string, number>;
}

export interface Fact {
  id: string;
  text: string;
  kind: FactKind;
  /** `agent` marks an assumption the agent inferred rather than something the user stated. */
  source: FactSource;
  observation?: FactObservation;
  createdAt: string;
}

/** Something the agent is unsure about. Answering it adds a fact; ignoring it is always allowed. */
export interface OpenQuestion {
  id: string;
  prompt: string;
  /** Dotted model path the answer fills, e.g. "structure.w" — lets the form link a question to a field. */
  field?: string;
}

export type AgentMode = "context" | "model" | "river";

/** Persisted conversation memory. The mode records which job the agent was doing for this turn. */
export interface TaskMessage {
  id: string;
  role: "user" | "agent";
  mode: AgentMode;
  text: string;
  /** Context revision this turn was based on; absent on messages from older journals. */
  revision?: number;
  createdAt: string;
}

export type TaskStatus = "new" | "ready" | "building" | "running" | "labeling" | "completed" | "failed";

export interface ActiveModelBuild {
  buildId: string;
  revision: number;
  stage: string;
  message: string;
  attempt: number;
  status: "running" | "failed";
  error?: string;
  startedAt: string;
  updatedAt: string;
}

export interface TaskAnalysis {
  /** Stable identity for new runs; legacy journal entries are keyed by visualUrl. */
  id?: string;
  revision: number;
  trials: number;
  seed: number;
  /** Engine that computed this analysis; absent on analyses recorded before provenance stamping. */
  kernelVersion?: string;
  report: string;
  winPct: Record<string, number>;
  winPctTeam: Record<string, number>;
  winPctPerCapita: Record<string, number>;
  cooperation: { mean: number; std: number };
  sensitivity: readonly { input: string; correlation: number }[];
  sensitivityWin: readonly { input: string; correlation: number }[];
  sensitivityWinTarget: string;
  worldLabels?: Record<string, { short: string; detail: string }>;
  agentMeta?: AgentRunMeta;
  visualUrl: string;
  /** Persisted model and trial digests used to reconstruct individual worlds on demand. */
  artifactUrl?: string;
  completedAt: string;
}

export interface TaskState {
  id: string;
  /** Agent-owned; derived from the facts, not edited by hand. */
  title: string;
  /** The prose seed the model is built from; edited in the Basics form as the situation field. */
  situation: string;
  facts: readonly Fact[];
  openQuestions: readonly OpenQuestion[];
  /** Revision for which the current questions were generated. */
  questionsRevision?: number;
  /** Public sources used to fill model context; excerpts are bounded and treated as untrusted data. */
  researchSources?: readonly ResearchSource[];
  /** Revision for which the current sources were collected. */
  researchRevision?: number;
  messages: readonly TaskMessage[];
  /** Bumped when the model or situation prose changes — the fingerprint a run is measured against. */
  revision: number;
  status: TaskStatus;
  model?: ScenarioModel;
  agent?: AgentSelection;
  analyses: readonly TaskAnalysis[];
  activeAnalysis?: { revision: number; trials: number; seed: number; agent?: AgentSelection; analysisId?: string };
  activeBuild?: ActiveModelBuild;
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
}

export type TaskCommand =
  | { tag: "CreateTask"; taskId: string; text: string; factId: string; now: string }
  | { tag: "AddFact"; factId: string; text: string; kind: FactKind; source: FactSource; observation?: FactObservation; now: string }
  | { tag: "EditFact"; factId: string; text: string; now: string }
  | { tag: "RemoveFact"; factId: string; now: string }
  | { tag: "SuggestQuestions"; questions: readonly OpenQuestion[]; now: string }
  | { tag: "DismissQuestion"; questionId: string; now: string }
  | { tag: "RecordResearch"; sources: readonly ResearchSource[]; now: string }
  | { tag: "AddMessage"; message: TaskMessage }
  | { tag: "SetTitle"; title: string; now: string }
  | { tag: "SetSituation"; text: string; now: string }
  | { tag: "SetModel"; model: ScenarioModel; agent?: AgentSelection; now: string }
  | { tag: "StartModelBuild"; buildId: string; revision: number; now: string }
  | { tag: "UpdateModelBuild"; buildId: string; stage: string; message: string; attempt?: number; now: string }
  | { tag: "CompleteModelBuild"; buildId: string; model: ScenarioModel; agent?: AgentSelection; now: string }
  | { tag: "FailModelBuild"; buildId: string; reason: string; now: string }
  | { tag: "CancelModelBuild"; buildId: string; now: string }
  | { tag: "RemoveAnalysis"; analysisId: string; now: string }
  | { tag: "DeleteTask"; now: string }
  | { tag: "RequestAnalysis"; trials: number; seed: number; agent?: AgentSelection; now: string }
  | { tag: "RecordAnalysis"; analysis: TaskAnalysis }
  | { tag: "CompleteAnalysisLabels"; analysisId: string; worldLabels: NonNullable<TaskAnalysis["worldLabels"]>; agentMeta?: AgentRunMeta; now: string }
  | { tag: "RelabelAnalysis"; analysisId: string; agent?: AgentSelection; now: string }
  | { tag: "CancelAnalysis"; now: string }
  | { tag: "FailAnalysis"; revision: number; reason: string; now: string }
  | { tag: "GetTask" };

/**
 * Events tagged "legacy" are never emitted any more; `apply` still folds them so existing journals
 * replay into the facts model without rewriting history.
 */
export type TaskEvent =
  | { tag: "TaskCreated"; taskId: string; title: string; brief?: string; fact?: Fact; now: string }
  | { tag: "FactAdded"; fact: Fact; revision: number; now: string }
  | { tag: "FactEdited"; factId: string; text: string; revision: number; now: string }
  | { tag: "FactRemoved"; factId: string; revision: number; now: string }
  | { tag: "QuestionsSuggested"; questions: readonly OpenQuestion[]; revision?: number; now: string }
  | { tag: "QuestionDismissed"; questionId: string; now: string }
  | { tag: "ResearchRecorded"; sources: readonly ResearchSource[]; revision?: number; now: string }
  | { tag: "MessageAdded"; message: TaskMessage }
  | { tag: "TitleSet"; title: string; now: string }
  | { tag: "SituationSet"; text: string; revision: number; now: string }
  | { tag: "ModelBuilt"; model: ScenarioModel; revision: number; agent?: AgentSelection; now: string }
  | { tag: "ModelBuildStarted"; buildId: string; revision: number; now: string }
  | { tag: "ModelBuildProgressed"; buildId: string; stage: string; message: string; attempt: number; now: string }
  | { tag: "ModelBuildFailed"; buildId: string; reason: string; now: string }
  | { tag: "ModelBuildCancelled"; buildId: string; now: string }
  | { tag: "AnalysisRemoved"; analysisId: string; now: string }
  | { tag: "TaskDeleted"; now: string }
  | { tag: "AnalysisRequested"; revision: number; trials: number; seed: number; agent?: AgentSelection; now: string }
  | { tag: "AnalysisCalculated"; analysis: TaskAnalysis }
  | { tag: "AnalysisLabelsCompleted"; analysisId: string; worldLabels: NonNullable<TaskAnalysis["worldLabels"]>; agentMeta?: AgentRunMeta; now: string }
  | { tag: "RelabelRequested"; analysisId: string; agent?: AgentSelection; now: string }
  | { tag: "AnalysisCancelled"; revision: number; hasResult: boolean; now: string }
  | { tag: "AnalysisCompleted"; analysis: TaskAnalysis }
  | { tag: "AnalysisFailed"; revision: number; reason: string; now: string }
  // legacy — replay only
  | { tag: "BriefEdited"; brief: string; revision: number; now: string }
  | { tag: "ContextAdded"; text: string; revision: number; invalidatesModel?: boolean; now: string }
  | { tag: "ContextEdited"; index: number; text: string; revision: number; now: string }
  | { tag: "ContextRemoved"; index: number; revision: number; now: string }
  | { tag: "ModelReplaced"; model: ScenarioModel; revision: number; now: string }
  | { tag: "AgentProposalRecorded"; proposal: { title?: string }; now: string }
  | { tag: "AgentProposalAccepted"; model: ScenarioModel; agent?: AgentSelection; revision: number; now: string }
  | { tag: "AgentProposalRejected"; proposalId?: string; now: string }
  | { tag: "ObservationRecorded"; analysisId: string; observation: { fact: string; observation: FactObservation; now: string }; now: string }
  | { tag: "ObservationsCleared"; analysisId: string; now: string };

export type TaskReply =
  | { tag: "Accepted"; revision: number }
  | { tag: "State"; state: TaskState }
  | { tag: "Rejected"; reason: string; revision: number };

export const taskCategory = categoryTypes<TaskCommand, TaskReply>(CategoryId("scenario-task"));

const initialTask = (id = ""): TaskState => ({ id, status: "new", title: "", situation: "", facts: [], openQuestions: [], researchSources: [], messages: [], revision: 0, analyses: [] });
const titleFrom = (text: string) => text.trim().replace(/\s+/g, " ").slice(0, 72) || "New situation";
const legacyId = (prefix: string, now: string, index: number) => `${prefix}-${index}-${now}`;

function boundedResearchSources(sources: readonly ResearchSource[]): ResearchSource[] {
  return sources.slice(0, 12).flatMap((source, index) => {
    try {
      const url = new URL(source.url);
      if (url.protocol !== "https:" && url.protocol !== "http:") return [];
      const clean = (value: string, limit: number) => value.trim().replace(/\s+/g, " ").slice(0, limit);
      return [{
        id: clean(source.id, 80) || `source-${index + 1}`,
        title: clean(source.title, 160) || url.hostname,
        url: url.href,
        excerpt: clean(source.excerpt, 3_000),
        query: clean(source.query, 240),
        ...(source.purpose ? { purpose: clean(source.purpose, 240) } : {}),
        ...(source.field ? { field: clean(source.field, 80) } : {}),
        fetchedAt: source.fetchedAt,
      }];
    } catch { return []; }
  });
}

function rejected(state: TaskState, reason: string): Promise<Effect<TaskEvent, TaskReply>> {
  return Promise.resolve(reply({ tag: "Rejected", reason, revision: state.revision }));
}

function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

/** The run a user is looking at is stale when the facts have moved on since it was computed. */
export function isRunStale(state: TaskState, analysis: TaskAnalysis): boolean {
  return analysis.revision !== state.revision;
}

const readyStatus = (state: TaskState): TaskStatus => state.analyses.length ? "completed" : "ready";

/**
 * Journals written before the situation prose existed carry it only inside the model. Seeding it back
 * on replay keeps those tasks editable — without it the form opens blank and the agent refuses to run.
 */
const situationFor = (state: TaskState, model: ScenarioModel): string => state.situation || model.situation;

export function applyTaskEvent(state: TaskState, event: TaskEvent): TaskState {
  switch (event.tag) {
    case "TaskCreated": {
      const base = { ...initialTask(event.taskId), title: event.title, createdAt: event.now, updatedAt: event.now };
      const seed = event.fact?.text ?? event.brief ?? "";
      return seed ? { ...base, situation: seed, revision: 1, status: "ready" } : base;
    }
    case "FactAdded": return { ...state, facts: [...state.facts, event.fact], revision: event.revision, status: state.status === "new" ? "ready" : state.status, updatedAt: event.now };
    case "FactEdited": return { ...state, facts: state.facts.map((fact) => fact.id === event.factId ? { ...fact, text: event.text, source: "user" } : fact), revision: event.revision, updatedAt: event.now };
    case "FactRemoved": return { ...state, facts: state.facts.filter((fact) => fact.id !== event.factId), revision: event.revision, updatedAt: event.now };
    case "QuestionsSuggested": return { ...state, openQuestions: event.questions, questionsRevision: event.revision ?? state.revision, updatedAt: event.now };
    case "QuestionDismissed": return { ...state, openQuestions: state.openQuestions.filter((question) => question.id !== event.questionId), updatedAt: event.now };
    case "ResearchRecorded": return { ...state, researchSources: event.sources, researchRevision: event.revision ?? state.revision, updatedAt: event.now };
    // ponytail: keep a bounded journal until long conversations justify summarization.
    case "MessageAdded": return { ...state, messages: [...(state.messages ?? []), event.message].slice(-200), updatedAt: event.message.createdAt };
    case "TitleSet": return { ...state, title: event.title, updatedAt: event.now };
    case "SituationSet": return { ...state, situation: event.text, revision: event.revision, updatedAt: event.now };
    // A run builds its model as its first step, so this must not disturb an in-flight run's status.
    case "ModelBuilt": return { ...omit(state, "lastError", "activeBuild"), model: event.model, situation: situationFor(state, event.model), revision: event.revision, ...(event.agent ? { agent: event.agent } : {}), status: state.status === "running" || state.status === "labeling" ? state.status : readyStatus(state), updatedAt: event.now };
    case "ModelBuildStarted": return { ...omit(state, "lastError"), status: "building", activeBuild: { buildId: event.buildId, revision: event.revision, stage: "start", message: "Starting the model build…", attempt: 1, status: "running", startedAt: event.now, updatedAt: event.now }, updatedAt: event.now };
    case "ModelBuildProgressed": {
      if (state.activeBuild?.buildId !== event.buildId) return state;
      return { ...state, status: "building", activeBuild: { ...state.activeBuild, stage: event.stage, message: event.message, attempt: event.attempt, status: "running", updatedAt: event.now }, updatedAt: event.now };
    }
    case "ModelBuildFailed": {
      if (state.activeBuild?.buildId !== event.buildId) return state;
      return { ...state, status: state.model ? readyStatus(state) : "failed", activeBuild: { ...state.activeBuild, status: "failed", error: event.reason, updatedAt: event.now }, lastError: event.reason, updatedAt: event.now };
    }
    case "ModelBuildCancelled":
      if (state.activeBuild?.buildId !== event.buildId) return state;
      return { ...omit(state, "activeBuild", "lastError"), status: state.model ? readyStatus(state) : "ready", updatedAt: event.now };
    case "AnalysisRemoved": {
      const analyses = state.analyses.filter((analysis) => (analysis.id ?? analysis.visualUrl) !== event.analysisId);
      return { ...state, analyses, status: state.status === "completed" && !analyses.length ? "ready" : state.status, updatedAt: event.now };
    }
    case "TaskDeleted": return { ...state, deleted: true, updatedAt: event.now };
    case "AnalysisRequested": return { ...omit(state, "lastError"), status: "running", activeAnalysis: { revision: event.revision, trials: event.trials, seed: event.seed, ...(event.agent ? { agent: event.agent } : {}) }, updatedAt: event.now };
    case "AnalysisCalculated": return { ...state, analyses: [...state.analyses, event.analysis], status: "labeling", activeAnalysis: { ...state.activeAnalysis!, analysisId: event.analysis.id! }, updatedAt: event.analysis.completedAt };
    case "RelabelRequested": {
      const target = state.analyses.find((a) => a.id === event.analysisId);
      if (!target) return state;
      return { ...omit(state, "lastError"), status: "labeling", activeAnalysis: { revision: state.revision, trials: target.trials, seed: target.seed, ...(event.agent ? { agent: event.agent } : state.agent ? { agent: state.agent } : {}), analysisId: event.analysisId }, updatedAt: event.now };
    }
    case "AnalysisLabelsCompleted": return { ...omit(state, "activeAnalysis"), analyses: state.analyses.map((analysis) => analysis.id === event.analysisId ? { ...analysis, worldLabels: event.worldLabels, ...(event.agentMeta ? { agentMeta: event.agentMeta } : {}) } : analysis), status: "completed", updatedAt: event.now };
    case "AnalysisCancelled": return { ...omit(state, "activeAnalysis", "lastError"), status: event.hasResult || state.analyses.length ? "completed" : "ready", updatedAt: event.now };
    case "AnalysisCompleted": return { ...omit(state, "activeAnalysis"), analyses: [...state.analyses, event.analysis], status: "completed", updatedAt: event.analysis.completedAt };
    case "AnalysisFailed": return { ...omit(state, "activeAnalysis"), status: "failed", lastError: event.reason, updatedAt: event.now };

    // ── legacy journal events: fold the old brief/context/proposal/observation shape into facts ──
    case "BriefEdited": {
      const [first, ...rest] = state.facts;
      const edited: Fact = first
        ? { ...first, text: event.brief }
        : { id: legacyId("brief", event.now, 0), text: event.brief, kind: "situation", source: "user", createdAt: event.now };
      return { ...state, facts: [edited, ...rest], revision: event.revision, updatedAt: event.now };
    }
    case "ContextAdded": {
      const fact: Fact = { id: legacyId("context", event.now, state.facts.length), text: event.text, kind: "situation", source: "user", createdAt: event.now };
      return { ...state, facts: [...state.facts, fact], revision: event.revision, status: state.status === "new" ? "ready" : state.status, updatedAt: event.now };
    }
    case "ContextEdited": {
      const target = state.facts[event.index + 1];
      return { ...state, facts: target ? state.facts.map((fact) => fact.id === target.id ? { ...fact, text: event.text } : fact) : state.facts, revision: event.revision, updatedAt: event.now };
    }
    case "ContextRemoved": {
      const target = state.facts[event.index + 1];
      return { ...state, facts: target ? state.facts.filter((fact) => fact.id !== target.id) : state.facts, revision: event.revision, updatedAt: event.now };
    }
    case "ModelReplaced":
    case "AgentProposalAccepted":
      return { ...omit(state, "lastError"), model: event.model, situation: situationFor(state, event.model), revision: event.revision, ...("agent" in event && event.agent ? { agent: event.agent } : {}), status: readyStatus(state), updatedAt: event.now };
    case "AgentProposalRecorded": return { ...state, title: event.proposal.title?.trim() || state.title, updatedAt: event.now };
    case "AgentProposalRejected": return state;
    case "ObservationRecorded": {
      const fact: Fact = { id: legacyId("observation", event.now, state.facts.length), text: event.observation.fact, kind: "outcome", source: "user", observation: event.observation.observation, createdAt: event.observation.now };
      return { ...state, facts: [...state.facts, fact], updatedAt: event.now };
    }
    case "ObservationsCleared": return { ...state, facts: state.facts.filter((fact) => fact.kind !== "outcome"), updatedAt: event.now };
  }
}

export const taskAggregate: Aggregate<TaskCommand, TaskReply, TaskEvent, TaskState> = {
  category: CategoryId("scenario-task"),
  initial: (id: EntityId) => initialTask(String(id)),
  async decide(state, command) {
    if (command.tag === "GetTask") return reply({ tag: "State", state });
    if (command.tag === "CreateTask") {
      if (state.status !== "new") return rejected(state, "Task already exists");
      const text = command.text.trim();
      if (!text) return rejected(state, "Describe the situation first");
      const fact: Fact = { id: command.factId, text, kind: "situation", source: "user", createdAt: command.now };
      return andReply(persist<TaskEvent, TaskReply>({ tag: "TaskCreated", taskId: command.taskId, title: titleFrom(text), fact, now: command.now }), { tag: "Accepted", revision: 1 });
    }
    if (state.status === "new") return rejected(state, "Task does not exist");
    if (state.deleted) return rejected(state, "Task is deleted");
    const busy = state.status === "running" || state.status === "labeling";
    // Facts stay editable while a run is in flight, and `SetModel` is the run's own first step —
    // only starting a second run at the same time is blocked.
    if (busy && command.tag === "RequestAnalysis") return rejected(state, "Wait for the current run to finish");

    switch (command.tag) {
      case "AddFact": {
        if (command.kind !== "outcome") return rejected(state, "Situations are edited in the model now; only what happened is filed as a fact");
        const text = command.text.trim();
        if (!text) return rejected(state, "The fact is empty");
        if (!state.model) return rejected(state, "Build a model before recording what happened");
        if (state.facts.some((fact) => fact.id === command.factId)) return rejected(state, "That fact already exists");
        const fact: Fact = { id: command.factId, text: text.slice(0, 2000), kind: "outcome", source: command.source, ...(command.observation ? { observation: command.observation } : {}), createdAt: command.now };
        return andReply(persist<TaskEvent, TaskReply>({ tag: "FactAdded", fact, revision: state.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
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
      case "SuggestQuestions":
        return andReply(persist<TaskEvent, TaskReply>({ tag: "QuestionsSuggested", questions: command.questions.slice(0, 5), revision: state.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "DismissQuestion":
        if (!state.openQuestions.some((question) => question.id === command.questionId)) return rejected(state, "That question is already gone");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "QuestionDismissed", questionId: command.questionId, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "RecordResearch":
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ResearchRecorded", sources: boundedResearchSources(command.sources), revision: state.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "AddMessage": {
        const text = command.message.text.trim();
        if (!text) return rejected(state, "The message is empty");
        if (state.messages?.some((message) => message.id === command.message.id)) return rejected(state, "That message already exists");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "MessageAdded", message: { ...command.message, text: text.slice(0, 4000) } }), { tag: "Accepted", revision: state.revision });
      }
      case "SetTitle": {
        const title = command.title.trim().slice(0, 72);
        if (!title) return rejected(state, "The title is empty");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "TitleSet", title, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "SetModel": {
        try { assertScenario(command.model); } catch (error) { return rejected(state, error instanceof Error ? error.message : "Invalid model"); }
        const changed = JSON.stringify(state.model) !== JSON.stringify(command.model);
        const revision = changed ? state.revision + 1 : state.revision;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuilt", model: command.model, revision, ...(command.agent ? { agent: command.agent } : {}), now: command.now }), { tag: "Accepted", revision });
      }
      case "StartModelBuild":
        if (state.activeBuild?.status === "running") return rejected(state, "A model build is already running");
        if (command.revision !== state.revision) return rejected(state, "That build belongs to an older situation");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuildStarted", buildId: command.buildId, revision: command.revision, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "UpdateModelBuild":
        if (state.activeBuild?.buildId !== command.buildId || state.activeBuild.status !== "running") return rejected(state, "That build is no longer active");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuildProgressed", buildId: command.buildId, stage: command.stage.slice(0, 40), message: command.message.slice(0, 500), attempt: Math.max(1, command.attempt ?? state.activeBuild.attempt), now: command.now }), { tag: "Accepted", revision: state.revision });
      case "CompleteModelBuild": {
        if (state.activeBuild?.buildId !== command.buildId) return rejected(state, "That build is no longer active");
        try { assertScenario(command.model); } catch (error) { return rejected(state, error instanceof Error ? error.message : "Invalid model"); }
        const revision = JSON.stringify(state.model) !== JSON.stringify(command.model) ? state.revision + 1 : state.revision;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuilt", model: command.model, revision, ...(command.agent ? { agent: command.agent } : {}), now: command.now }), { tag: "Accepted", revision });
      }
      case "FailModelBuild":
        if (state.activeBuild?.buildId !== command.buildId) return rejected(state, "That build is no longer active");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuildFailed", buildId: command.buildId, reason: command.reason.slice(0, 1000), now: command.now }), { tag: "Accepted", revision: state.revision });
      case "CancelModelBuild":
        if (state.activeBuild?.buildId !== command.buildId) return rejected(state, "That build is no longer active");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelBuildCancelled", buildId: command.buildId, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "SetSituation": {
        const text = command.text.trim();
        if (!text) return rejected(state, "Describe the situation first");
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "SituationSet", text: text.slice(0, 4000), revision, now: command.now }), { tag: "Accepted", revision });
      }
      case "RemoveAnalysis":
        if (!state.analyses.some((analysis) => (analysis.id ?? analysis.visualUrl) === command.analysisId)) return rejected(state, "That run no longer exists");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisRemoved", analysisId: command.analysisId, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "DeleteTask":
        return andReply(persist<TaskEvent, TaskReply>({ tag: "TaskDeleted", now: command.now }), { tag: "Accepted", revision: state.revision });
      case "RequestAnalysis": {
        if (!state.model) return rejected(state, "Build a model before running");
        if (!Number.isInteger(command.trials) || command.trials < 1 || command.trials > 5000) return rejected(state, "Worlds must be a whole number within 1..5000");
        if (!Number.isSafeInteger(command.seed) || command.seed < 1 || command.seed > 2_147_483_647) return rejected(state, "Seed must be a whole number within 1..2147483647");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisRequested", revision: state.revision, trials: command.trials, seed: command.seed, ...(command.agent ? { agent: command.agent } : {}), now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "RecordAnalysis":
        if (!state.activeAnalysis || state.activeAnalysis.analysisId || state.activeAnalysis.revision !== command.analysis.revision || !command.analysis.id) return rejected(state, "That result belongs to an older run");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisCalculated", analysis: command.analysis }), { tag: "Accepted", revision: state.revision });
      case "CompleteAnalysisLabels":
        if (!state.activeAnalysis?.analysisId || state.activeAnalysis.analysisId !== command.analysisId || !state.analyses.some((analysis) => analysis.id === command.analysisId)) return rejected(state, "Those labels belong to an older run");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisLabelsCompleted", analysisId: command.analysisId, worldLabels: command.worldLabels, ...(command.agentMeta ? { agentMeta: command.agentMeta } : {}), now: command.now }), { tag: "Accepted", revision: state.revision });
      case "RelabelAnalysis": {
        if (state.status === "running" || state.status === "labeling") return rejected(state, "Wait for the current run to finish");
        if (!state.analyses.some((analysis) => analysis.id === command.analysisId)) return rejected(state, "That run no longer exists");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "RelabelRequested", analysisId: command.analysisId, ...(command.agent ? { agent: command.agent } : {}), now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "CancelAnalysis":
        if (!state.activeAnalysis) return rejected(state, "Nothing is running");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisCancelled", revision: state.activeAnalysis.revision, hasResult: !!state.activeAnalysis.analysisId, now: command.now }), { tag: "Accepted", revision: state.revision });
      case "FailAnalysis":
        if (!state.activeAnalysis || state.activeAnalysis.revision !== command.revision) return rejected(state, "That failure belongs to an older run");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisFailed", revision: command.revision, reason: command.reason, now: command.now }), { tag: "Accepted", revision: state.revision });
    }
  },
  apply: applyTaskEvent,
  snapshotEvery: 20,
};

export const taskEventCodec = tagCodec<TaskEvent>(
  "TaskCreated", "FactAdded", "FactEdited", "FactRemoved",
  "QuestionsSuggested", "QuestionDismissed", "ResearchRecorded", "MessageAdded", "TitleSet", "SituationSet", "ModelBuilt", "ModelBuildStarted", "ModelBuildProgressed", "ModelBuildFailed", "ModelBuildCancelled",
  "AnalysisRemoved", "TaskDeleted", "AnalysisRequested", "AnalysisCalculated",
  "RelabelRequested", "AnalysisLabelsCompleted", "AnalysisCancelled", "AnalysisCompleted", "AnalysisFailed",
  // legacy tags kept readable so old journals still replay
  "BriefEdited", "ContextAdded", "ContextEdited", "ContextRemoved", "ModelReplaced",
  "AgentProposalRecorded", "AgentProposalAccepted", "AgentProposalRejected",
  "ObservationRecorded", "ObservationsCleared",
);
export const taskStateCodec = objectCodec<TaskState>("ScenarioTaskState");
