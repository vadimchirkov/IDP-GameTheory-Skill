import {
  CategoryId, EntityId, andReply, categoryTypes, objectCodec, persist, reply, tagCodec,
  type Aggregate, type Effect,
} from "@lambda-house/teob-ts/core";
import { assertScenario, type ScenarioModel } from "./domain.js";
import type { AgentRunMeta, AgentSelection } from "./agent-contracts.js";

export type TaskStatus = "new" | "draft" | "ready" | "running" | "labeling" | "completed" | "failed";

export interface TaskProposal {
  id: string;
  title?: string;
  explanation: string;
  questions: readonly string[];
  decisions?: readonly TaskDecision[];
  sources?: readonly TaskSource[];
  agent?: AgentSelection;
  agentMeta?: AgentRunMeta;
  /** Legacy field retained so existing journals can still be replayed. */
  claudeModel?: string;
  model?: ScenarioModel;
  createdAt: string;
}

export interface TaskDecision {
  id: string;
  prompt: string;
  answer: string;
  alternatives: readonly string[];
}

export interface TaskSource {
  title: string;
  url: string;
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
  status: TaskStatus;
  title: string;
  brief: string;
  context: readonly string[];
  assumptions?: readonly TaskDecision[];
  revision: number;
  agent?: AgentSelection;
  /** Legacy field retained so existing journals can still be replayed. */
  claudeModel?: string;
  model?: ScenarioModel;
  pendingProposal?: TaskProposal;
  analyses: readonly TaskAnalysis[];
  activeAnalysis?: { revision: number; trials: number; seed: number; agent?: AgentSelection; analysisId?: string };
  lastError?: string;
  createdAt?: string;
  updatedAt?: string;
  deleted?: boolean;
}

export type TaskCommand =
  | { tag: "CreateTask"; taskId: string; brief: string; now: string }
  | { tag: "EditBrief"; brief: string; baseRevision: number; now: string }
  | { tag: "AddContext"; text: string; baseRevision: number; now: string }
  | { tag: "EditContext"; index: number; text: string; baseRevision: number; now: string }
  | { tag: "RemoveAnalysis"; analysisId: string; baseRevision: number; now: string }
  | { tag: "DeleteTask"; baseRevision: number; now: string }
  | { tag: "ReplaceModel"; model: ScenarioModel; baseRevision: number; now: string }
  | { tag: "RecordAgentProposal"; proposal: TaskProposal; baseRevision: number }
  | { tag: "AcceptProposal"; proposalId: string; baseRevision: number; now: string }
  | { tag: "RejectProposal"; proposalId: string; baseRevision: number; now: string }
  | { tag: "RequestAnalysis"; trials: number; seed: number; agent?: AgentSelection; baseRevision: number; now: string }
  | { tag: "RecordAnalysis"; analysis: TaskAnalysis }
  | { tag: "CompleteAnalysisLabels"; analysisId: string; worldLabels: NonNullable<TaskAnalysis["worldLabels"]>; agentMeta?: AgentRunMeta; now: string }
  | { tag: "CancelAnalysis"; baseRevision: number; now: string }
  | { tag: "CompleteAnalysis"; analysis: TaskAnalysis }
  | { tag: "FailAnalysis"; revision: number; reason: string; now: string }
  | { tag: "GetTask" };

export type TaskEvent =
  | { tag: "TaskCreated"; taskId: string; title: string; brief: string; now: string }
  | { tag: "BriefEdited"; brief: string; revision: number; now: string }
  | { tag: "ContextAdded"; text: string; revision: number; invalidatesModel?: boolean; now: string }
  | { tag: "ContextEdited"; index: number; text: string; revision: number; now: string }
  | { tag: "AnalysisRemoved"; analysisId: string; now: string }
  | { tag: "TaskDeleted"; now: string }
  | { tag: "ModelReplaced"; model: ScenarioModel; revision: number; now: string }
  | { tag: "AgentProposalRecorded"; proposal: TaskProposal; now: string }
  | { tag: "AgentProposalAccepted"; proposalId: string; model: ScenarioModel; assumptions?: readonly TaskDecision[]; agent?: AgentSelection; claudeModel?: string; revision: number; now: string }
  | { tag: "AgentProposalRejected"; proposalId: string; now: string }
  | { tag: "AnalysisRequested"; revision: number; trials: number; seed: number; agent?: AgentSelection; now: string }
  | { tag: "AnalysisCalculated"; analysis: TaskAnalysis }
  | { tag: "AnalysisLabelsCompleted"; analysisId: string; worldLabels: NonNullable<TaskAnalysis["worldLabels"]>; agentMeta?: AgentRunMeta; now: string }
  | { tag: "AnalysisCancelled"; revision: number; hasResult: boolean; now: string }
  | { tag: "AnalysisCompleted"; analysis: TaskAnalysis }
  | { tag: "AnalysisFailed"; revision: number; reason: string; now: string };

export type TaskReply =
  | { tag: "Accepted"; revision: number }
  | { tag: "State"; state: TaskState }
  | { tag: "Rejected"; reason: string; revision: number };

export const taskCategory = categoryTypes<TaskCommand, TaskReply>(CategoryId("scenario-task"));
const initialTask = (id = ""): TaskState => ({ id, status: "new", title: "", brief: "", context: [], revision: 0, analyses: [] });
const titleFrom = (brief: string) => brief.trim().replace(/\s+/g, " ").slice(0, 72) || "New situation";

function rejected(state: TaskState, reason: string): Promise<Effect<TaskEvent, TaskReply>> {
  return Promise.resolve(reply({ tag: "Rejected", reason, revision: state.revision }));
}

function guardRevision(state: TaskState, revision: number): string | undefined {
  return revision === state.revision ? undefined : `Task changed: expected revision ${revision}, current ${state.revision}`;
}

function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

export function applyTaskEvent(state: TaskState, event: TaskEvent): TaskState {
  switch (event.tag) {
    case "TaskCreated": return { ...initialTask(event.taskId), status: "draft", title: event.title, brief: event.brief, createdAt: event.now, updatedAt: event.now };
    case "BriefEdited": return { ...omit(state, "pendingProposal", "model", "assumptions", "lastError"), brief: event.brief, revision: event.revision, status: "draft", updatedAt: event.now };
    case "ContextAdded": return event.invalidatesModel
      ? { ...omit(state, "pendingProposal", "model", "assumptions", "lastError"), context: [...state.context, event.text], revision: event.revision, status: "draft", updatedAt: event.now }
      : { ...omit(state, "pendingProposal"), context: [...state.context, event.text], revision: event.revision, status: state.model ? "ready" : "draft", updatedAt: event.now };
    case "ContextEdited": return { ...omit(state, "pendingProposal", "model", "assumptions", "lastError"), context: state.context.map((text, index) => index === event.index ? event.text : text), revision: event.revision, status: "draft", updatedAt: event.now };
    case "AnalysisRemoved": {
      const analyses = state.analyses.filter((analysis) => (analysis.id ?? analysis.visualUrl) !== event.analysisId);
      return { ...state, analyses, status: state.status === "completed" && !analyses.length ? state.model ? "ready" : "draft" : state.status, updatedAt: event.now };
    }
    case "TaskDeleted": return { ...state, deleted: true, updatedAt: event.now };
    case "ModelReplaced": return { ...omit(state, "pendingProposal", "lastError"), model: event.model, revision: event.revision, status: "ready", updatedAt: event.now };
    case "AgentProposalRecorded": return { ...state, title: event.proposal.title?.trim() || state.title, pendingProposal: event.proposal, updatedAt: event.now };
    case "AgentProposalAccepted": return { ...omit(state, "pendingProposal", "lastError", "agent", "claudeModel"), model: event.model, assumptions: event.assumptions ?? [], ...(event.agent ? { agent: event.agent } : {}), ...(event.claudeModel ? { claudeModel: event.claudeModel } : {}), revision: event.revision, status: "ready", updatedAt: event.now };
    case "AgentProposalRejected": return { ...omit(state, "pendingProposal"), updatedAt: event.now };
    case "AnalysisRequested": return { ...omit(state, "lastError"), status: "running", activeAnalysis: { revision: event.revision, trials: event.trials, seed: event.seed, ...(event.agent ? { agent: event.agent } : {}) }, updatedAt: event.now };
    case "AnalysisCalculated": return { ...state, analyses: [...state.analyses, event.analysis], status: "labeling", activeAnalysis: { ...state.activeAnalysis!, analysisId: event.analysis.id! }, updatedAt: event.analysis.completedAt };
    case "AnalysisLabelsCompleted": return { ...omit(state, "activeAnalysis"), analyses: state.analyses.map((analysis) => analysis.id === event.analysisId ? { ...analysis, worldLabels: event.worldLabels, ...(event.agentMeta ? { agentMeta: event.agentMeta } : {}) } : analysis), status: state.model ? "completed" : "draft", updatedAt: event.now };
    case "AnalysisCancelled": return { ...omit(state, "activeAnalysis", "lastError"), status: event.hasResult || state.analyses.length ? "completed" : state.model ? "ready" : "draft", updatedAt: event.now };
    case "AnalysisCompleted": return { ...omit(state, "activeAnalysis"), analyses: [...state.analyses, event.analysis], status: event.analysis.revision === state.revision ? "completed" : state.model ? "ready" : "draft", updatedAt: event.analysis.completedAt };
    case "AnalysisFailed": return { ...omit(state, "activeAnalysis"), status: event.revision === state.revision ? "failed" : state.status, lastError: event.reason, updatedAt: event.now };
  }
}

export const taskAggregate: Aggregate<TaskCommand, TaskReply, TaskEvent, TaskState> = {
  category: CategoryId("scenario-task"),
  initial: (id: EntityId) => initialTask(String(id)),
  async decide(state, command) {
    if (command.tag === "GetTask") return reply({ tag: "State", state });
    if (command.tag === "CreateTask") {
      if (state.status !== "new") return rejected(state, "Task already exists");
      if (!command.brief.trim()) return rejected(state, "Brief is required");
      return andReply(persist<TaskEvent, TaskReply>({ tag: "TaskCreated", taskId: command.taskId, title: titleFrom(command.brief), brief: command.brief.trim(), now: command.now }), { tag: "Accepted", revision: 0 });
    }
    if (state.status === "new") return rejected(state, "Task does not exist");
    if (state.deleted) return rejected(state, "Task is deleted");
    if ((state.status === "running" || state.status === "labeling") && !["RecordAnalysis", "CompleteAnalysisLabels", "CancelAnalysis", "CompleteAnalysis", "FailAnalysis"].includes(command.tag)) {
      return rejected(state, "Wait for the current analysis to finish");
    }
    switch (command.tag) {
      case "EditBrief": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!command.brief.trim()) return rejected(state, "Brief is required");
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "BriefEdited", brief: command.brief.trim(), revision, now: command.now }), { tag: "Accepted", revision });
      }
      case "AddContext": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!command.text.trim()) return rejected(state, "Context is empty");
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ContextAdded", text: command.text.trim(), revision, invalidatesModel: true, now: command.now }), { tag: "Accepted", revision });
      }
      case "EditContext": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!Number.isInteger(command.index) || command.index < 0 || command.index >= state.context.length) return rejected(state, "Context item does not exist");
        if (!command.text.trim()) return rejected(state, "Context is empty");
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ContextEdited", index: command.index, text: command.text.trim(), revision, now: command.now }), { tag: "Accepted", revision });
      }
      case "RemoveAnalysis": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!state.analyses.some((analysis) => (analysis.id ?? analysis.visualUrl) === command.analysisId)) return rejected(state, "Analysis does not exist");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisRemoved", analysisId: command.analysisId, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "DeleteTask": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        return andReply(persist<TaskEvent, TaskReply>({ tag: "TaskDeleted", now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "ReplaceModel": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        try { assertScenario(command.model); } catch (error) { return rejected(state, error instanceof Error ? error.message : "Invalid model"); }
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "ModelReplaced", model: command.model, revision, now: command.now }), { tag: "Accepted", revision });
      }
      case "RecordAgentProposal": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (command.proposal.model) try { assertScenario(command.proposal.model); } catch (error) { return rejected(state, error instanceof Error ? error.message : "Invalid proposed model"); }
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AgentProposalRecorded", proposal: command.proposal, now: command.proposal.createdAt }), { tag: "Accepted", revision: state.revision });
      }
      case "AcceptProposal": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!state.pendingProposal || state.pendingProposal.id !== command.proposalId || !state.pendingProposal.model) return rejected(state, "Proposal is missing or has no model");
        const revision = state.revision + 1;
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AgentProposalAccepted", proposalId: command.proposalId, model: state.pendingProposal.model, assumptions: state.pendingProposal.decisions ?? [], ...(state.pendingProposal.agent ? { agent: state.pendingProposal.agent } : {}), ...(state.pendingProposal.claudeModel ? { claudeModel: state.pendingProposal.claudeModel } : {}), revision, now: command.now }), { tag: "Accepted", revision });
      }
      case "RejectProposal": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!state.pendingProposal || state.pendingProposal.id !== command.proposalId) return rejected(state, "Proposal is missing");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AgentProposalRejected", proposalId: command.proposalId, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "RequestAnalysis": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!state.model) return rejected(state, "Accept or enter a model first");
        if (!Number.isInteger(command.trials) || command.trials < 1 || command.trials > 5000) return rejected(state, "Trials must be an integer within 1..5000");
        if (!Number.isSafeInteger(command.seed) || command.seed < 1 || command.seed > 2_147_483_647) return rejected(state, "Seed must be an integer within 1..2147483647");
        if (state.status === "running" || state.status === "labeling") return rejected(state, "Analysis is already running");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisRequested", revision: state.revision, trials: command.trials, seed: command.seed, ...(command.agent ? { agent: command.agent } : {}), now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "RecordAnalysis":
        if (!state.activeAnalysis || state.activeAnalysis.analysisId || state.activeAnalysis.revision !== command.analysis.revision || state.activeAnalysis.trials !== command.analysis.trials || state.activeAnalysis.seed !== command.analysis.seed || !command.analysis.id) return rejected(state, "Analysis result is stale");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisCalculated", analysis: command.analysis }), { tag: "Accepted", revision: state.revision });
      case "CompleteAnalysisLabels":
        if (!state.activeAnalysis?.analysisId || state.activeAnalysis.analysisId !== command.analysisId || !state.analyses.some((analysis) => analysis.id === command.analysisId)) return rejected(state, "Analysis labels are stale");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisLabelsCompleted", analysisId: command.analysisId, worldLabels: command.worldLabels, ...(command.agentMeta ? { agentMeta: command.agentMeta } : {}), now: command.now }), { tag: "Accepted", revision: state.revision });
      case "CancelAnalysis": {
        const conflict = guardRevision(state, command.baseRevision); if (conflict) return rejected(state, conflict);
        if (!state.activeAnalysis) return rejected(state, "Analysis is not running");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisCancelled", revision: state.activeAnalysis.revision, hasResult: !!state.activeAnalysis.analysisId, now: command.now }), { tag: "Accepted", revision: state.revision });
      }
      case "CompleteAnalysis":
        if (!state.activeAnalysis || state.activeAnalysis.revision !== command.analysis.revision || state.activeAnalysis.trials !== command.analysis.trials || state.activeAnalysis.seed !== command.analysis.seed) return rejected(state, "Analysis result is stale");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisCompleted", analysis: command.analysis }), { tag: "Accepted", revision: state.revision });
      case "FailAnalysis":
        if (!state.activeAnalysis || state.activeAnalysis.revision !== command.revision) return rejected(state, "Analysis failure is stale");
        return andReply(persist<TaskEvent, TaskReply>({ tag: "AnalysisFailed", revision: command.revision, reason: command.reason, now: command.now }), { tag: "Accepted", revision: state.revision });
    }
  },
  apply: applyTaskEvent,
  snapshotEvery: 20,
};

export const taskEventCodec = tagCodec<TaskEvent>("TaskCreated", "BriefEdited", "ContextAdded", "ContextEdited", "AnalysisRemoved", "TaskDeleted", "ModelReplaced", "AgentProposalRecorded", "AgentProposalAccepted", "AgentProposalRejected", "AnalysisRequested", "AnalysisCalculated", "AnalysisLabelsCompleted", "AnalysisCancelled", "AnalysisCompleted", "AnalysisFailed");
export const taskStateCodec = objectCodec<TaskState>("ScenarioTaskState");
