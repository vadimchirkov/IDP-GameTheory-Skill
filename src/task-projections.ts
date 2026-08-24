import { projection } from "@lambda-house/teob-ts/projection";
import type { TaskEvent, TaskState } from "./task.js";
import { applyTaskEvent } from "./task.js";

const empty = (): TaskState => ({ id: "", status: "new", title: "", brief: "", context: [], revision: 0, analyses: [] });

export const taskDetailProjection = projection<TaskEvent, TaskState>({
  projectionId: "scenario-task-detail",
  category: "scenario-task",
  initialState: empty,
  evolve: applyTaskEvent,
});

export interface TaskSummary {
  id: string;
  title: string;
  status: TaskState["status"];
  revision: number;
  updatedAt?: string;
  hasModel: boolean;
  latestReport?: string;
  deleted?: boolean;
}

export const taskSummaryProjection = projection<TaskEvent, TaskSummary>({
  projectionId: "scenario-task-summary",
  category: "scenario-task",
  initialState: () => ({ id: "", title: "", status: "new", revision: 0, hasModel: false }),
  evolve: (view, event, entityId) => {
    switch (event.tag) {
      case "TaskCreated": return { ...view, id: String(entityId), title: event.title, status: "draft", updatedAt: event.now };
      case "BriefEdited": return { ...view, status: "draft", revision: event.revision, hasModel: false, updatedAt: event.now };
      case "ContextAdded": return event.invalidatesModel
        ? { ...view, status: "draft", revision: event.revision, hasModel: false, updatedAt: event.now }
        : { ...view, status: view.hasModel ? "ready" : "draft", revision: event.revision, updatedAt: event.now };
      case "ContextEdited": return { ...view, status: "draft", revision: event.revision, hasModel: false, updatedAt: event.now };
      case "AnalysisRemoved": { const { latestReport: _, ...rest } = view; return { ...rest, updatedAt: event.now }; }
      case "TaskDeleted": return { ...view, deleted: true, updatedAt: event.now };
      case "ModelReplaced": return { ...view, status: "ready", revision: event.revision, hasModel: true, updatedAt: event.now };
      case "AgentProposalAccepted": return { ...view, status: "ready", revision: event.revision, hasModel: true, updatedAt: event.now };
      case "AnalysisRequested": return { ...view, status: "running", updatedAt: event.now };
      case "AnalysisCalculated": return { ...view, status: "labeling", latestReport: event.analysis.report, updatedAt: event.analysis.completedAt };
      case "AnalysisLabelsCompleted": return { ...view, status: "completed", updatedAt: event.now };
      case "AnalysisCancelled": return { ...view, status: event.hasResult || view.latestReport ? "completed" : view.hasModel ? "ready" : "draft", updatedAt: event.now };
      case "AnalysisCompleted": return { ...view, status: event.analysis.revision === view.revision ? "completed" : view.status, latestReport: event.analysis.report, updatedAt: event.analysis.completedAt };
      case "AnalysisFailed": return { ...view, status: event.revision === view.revision ? "failed" : view.status, updatedAt: event.now };
      case "AgentProposalRecorded": return { ...view, title: event.proposal.title?.trim() || view.title, updatedAt: event.now };
      case "AgentProposalRejected": return { ...view, updatedAt: event.now };
    }
  },
});
