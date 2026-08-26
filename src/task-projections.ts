import { projection } from "@lambda-house/teob-ts/projection";
import type { TaskEvent, TaskState } from "./task.js";
import { applyTaskEvent } from "./task.js";

const empty = (): TaskState => ({ id: "", status: "new", title: "", situation: "", facts: [], openQuestions: [], messages: [], revision: 0, analyses: [] });

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
  factCount: number;
  hasRun: boolean;
  latestReport?: string;
  deleted?: boolean;
}

/** The sidebar view: title, status and size, without carrying the whole fact list per row. */
export const taskSummaryProjection = projection<TaskEvent, TaskSummary>({
  projectionId: "scenario-task-summary",
  category: "scenario-task",
  initialState: () => ({ id: "", title: "", status: "new", revision: 0, factCount: 0, hasRun: false }),
  evolve: (view, event, entityId) => {
    const at = (updatedAt: string) => ({ ...view, id: view.id || String(entityId), updatedAt });
    switch (event.tag) {
      case "TaskCreated": return { ...at(event.now), id: String(entityId), title: event.title, status: "ready", revision: 1, factCount: 0 };
      case "TitleSet": return { ...at(event.now), title: event.title };
      case "SituationSet": return { ...at(event.now), revision: event.revision };
      case "AgentProposalRecorded": return { ...at(event.now), title: event.proposal.title?.trim() || view.title };
      case "FactAdded": return { ...at(event.now), revision: event.revision, factCount: view.factCount + 1, status: view.status === "new" ? "ready" : view.status };
      case "ContextAdded": return { ...at(event.now), revision: event.revision, factCount: view.factCount + 1, status: view.status === "new" ? "ready" : view.status };
      case "ObservationRecorded": return { ...at(event.now), factCount: view.factCount + 1 };
      case "FactRemoved": return { ...at(event.now), revision: event.revision, factCount: Math.max(0, view.factCount - 1) };
      case "ContextRemoved": return { ...at(event.now), revision: event.revision, factCount: Math.max(0, view.factCount - 1) };
      case "FactEdited": case "BriefEdited": case "ContextEdited":
        return { ...at(event.now), revision: event.revision };
      case "ModelBuilt": case "ModelReplaced": case "AgentProposalAccepted":
        return { ...at(event.now), revision: event.revision };
      case "AnalysisRequested": return { ...at(event.now), status: "running" };
      case "AnalysisCalculated": return { ...at(event.analysis.completedAt), status: "labeling", hasRun: true, latestReport: event.analysis.report };
      case "AnalysisLabelsCompleted": return { ...at(event.now), status: "completed" };
      case "AnalysisCompleted": return { ...at(event.analysis.completedAt), status: "completed", hasRun: true, latestReport: event.analysis.report };
      case "AnalysisCancelled": return { ...at(event.now), status: view.hasRun ? "completed" : "ready" };
      case "AnalysisFailed": return { ...at(event.now), status: "failed" };
      case "AnalysisRemoved": { const { latestReport: _drop, ...rest } = view; return { ...rest, updatedAt: event.now, hasRun: false, status: "ready" }; }
      case "TaskDeleted": return { ...at(event.now), deleted: true };
      default: return view;
    }
  },
});

/** Re-exported so callers can rebuild a full state without importing the aggregate. */
export { applyTaskEvent };
