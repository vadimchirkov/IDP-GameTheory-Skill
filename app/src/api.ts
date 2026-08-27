import type { AgentSelection } from "../../src/agent-contracts";
import type { ScenarioModel } from "../../src/domain";
import type { AgentMode, Fact, FactKind, OpenQuestion, TaskMessage, TaskState } from "../../src/task";
import type { TaskSummary } from "../../src/task-projections";

export type { AgentMode, AgentSelection, Fact, FactKind, OpenQuestion, ScenarioModel, TaskMessage, TaskState, TaskSummary };

export interface AgentStatus {
  available: boolean;
  detail: string;
  defaultSelection?: AgentSelection;
  providers: Array<{ id: string; name: string; models: AgentModelStatus[] }>;
  models: AgentModelStatus[];
  authProviders: Array<{ id: string; name: string; label: string; configured: boolean; source?: string }>;
  error?: string;
}

export interface AgentModelStatus {
  provider: string;
  model: string;
  name: string;
  reasoning: boolean;
  thinkingLevels: AgentSelection["thinkingLevel"][];
}

export interface RiverSelection {
  kind: "all" | "node" | "flow";
  label: string;
  worldIds: number[];
}

export interface WorldReplay {
  worldId: string;
  index: number;
  exact: boolean;
  stored: {
    winners: readonly string[];
    cooperation: number;
    inputs: Record<string, number>;
    scores: Record<string, number>;
    rounds: number;
    digest: { opening: string; response: string; regime: string; pivotalPair?: readonly [string, string] };
  };
  replay: {
    winners: readonly string[];
    cooperation: number;
    inputs: Record<string, number>;
    scores: Record<string, number>;
    rounds: number;
    digest: { opening: string; response: string; regime: string; pivotalPair?: readonly [string, string] };
    trace?: {
      a: string;
      b: string;
      totalRounds: number;
      truncated: boolean;
      rounds: Array<{ round: number; moveA: string; moveB: string; scoreA: number; scoreB: number; leanA?: number; leanB?: number; environment?: number; state?: string }>;
    };
  };
}

/** One side of a reweighted run — shares and belief, without the per-world weights. */
export interface PosteriorView {
  effectiveSampleSize: number;
  fit: number;
  winPct: Record<string, number>;
  winPctTeam: Record<string, number>;
  cooperation: { mean: number; std: number };
  strategyPosterior: Record<string, Record<string, number>>;
}

/** A run reweighted by its accumulated outcome facts; baseline/posterior are null for legacy runs. */
export interface RunPosterior {
  usesTeams: boolean;
  baseline: PosteriorView | null;
  posterior: PosteriorView | null;
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...options.headers },
  });
  const value: unknown = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
  if (!response.ok) {
    const failure = value as { reason?: string; error?: string };
    throw new Error(failure.reason ?? failure.error ?? "Request failed");
  }
  return value as T;
}

/** What a chat message turned out to be. `task` is present when an outcome fact was filed. */
export interface ChatResult {
  kind: "answer" | "outcome";
  message: string;
  task?: TaskState;
}

/** Every command returns the whole task, so the caller never reassembles state by hand. */
export type FactCommand =
  | { tag: "AddFact"; text: string; kind: "outcome" }
  | { tag: "EditFact"; factId: string; text: string }
  | { tag: "RemoveFact"; factId: string }
  | { tag: "SetSituation"; text: string }
  | { tag: "SetModel"; model: ScenarioModel }
  | { tag: "DismissQuestion"; questionId: string }
  | { tag: "RemoveAnalysis"; analysisId: string }
  | { tag: "CancelAnalysis" }
  | { tag: "CancelModelBuild"; buildId: string }
  | { tag: "DeleteTask" };

const post = <T>(path: string, value: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(value) });

export const getTasks = () => api<TaskSummary[]>("/api/tasks");
export const getTask = (id: string) => api<TaskState>(`/api/tasks/${id}`);
export const createTask = (text: string) => post<TaskState>("/api/tasks", { text });
export const sendCommand = (id: string, value: FactCommand) => post<TaskState>(`/api/tasks/${id}/commands`, value);
export const understandTask = (id: string, agent?: AgentSelection) => post<TaskState>(`/api/tasks/${id}/understand`, { agent });
export const clarifyTask = (id: string, value: { message?: string; mode: "context" | "model"; agent?: AgentSelection }, signal?: AbortSignal) => api<ChatResult & { task: TaskState }>(`/api/tasks/${id}/clarify`, { method: "POST", body: JSON.stringify(value), signal });
export async function understandTaskStream(id: string, agent: AgentSelection | undefined, onEvent: (ev: Record<string, unknown>) => void): Promise<TaskState> {
  const response = await fetch(`/api/tasks/${id}/understand/stream`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ agent }),
  });
  if (response.status === 404 || response.status === 409) {
    const value: unknown = await response.json().catch(() => ({}));
    const failure = value as { error?: string; reason?: string };
    throw new Error(failure.error ?? failure.reason ?? `HTTP ${response.status}`);
  }
  if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
    const value: unknown = await response.json().catch(() => ({}));
    const failure = value as { error?: string; reason?: string };
    throw new Error(failure.error ?? failure.reason ?? `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("Streaming not supported");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneTask: TaskState | undefined;
  let error: string | undefined;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const json = line.slice(6);
      try {
        const ev = JSON.parse(json) as Record<string, unknown>;
        if (ev.kind === "done" && ev.task) doneTask = ev.task as TaskState;
        else if (ev.kind === "error") error = (ev.error as string) ?? "Agent failed";
        onEvent(ev);
        if (ev.kind === "error" || ev.kind === "done") {
          // keep reading until stream ends
        }
      } catch {}
    }
  }
  if (error) throw new Error(error);
  if (doneTask) return doneTask;
  throw new Error("Agent stream ended without result");
}
export const runTask = (id: string, value: { trials?: number; seed?: number; agent?: AgentSelection }) => post<TaskState>(`/api/tasks/${id}/run`, value);
export const relabelTask = (id: string, analysisId: string, agent?: AgentSelection) => post<TaskState>(`/api/tasks/${id}/relabel`, { analysisId, agent });
export const chatTask = (id: string, message: string, agent?: AgentSelection, selection?: RiverSelection, analysisId?: string) => post<ChatResult & { pendingOutcome?: { observation: Record<string, unknown>; display: string } }>(`/api/tasks/${id}/chat`, { message, agent, selection, analysisId });
export const confirmOutcome = (id: string, text: string, observation: Record<string, unknown>) => post<{ kind: string; message: string; task: TaskState }>(`/api/tasks/${id}/chat/confirm`, { text, observation });
export const getWorldReplay = (taskId: string, analysisId: string, index: number) => api<WorldReplay>(`/api/tasks/${taskId}/analyses/${analysisId}/worlds/${index}/replay`);
export const getPosterior = (taskId: string, analysisId: string) => api<RunPosterior>(`/api/tasks/${taskId}/analyses/${analysisId}/posterior`);
export const getAgentStatus = () => api<AgentStatus>("/api/agent/status");
export const saveProviderKey = (provider: string, apiKey: string) => post<AgentStatus>("/api/agent/credentials", { provider, apiKey });
export const removeProviderKey = (provider: string) => api<AgentStatus>("/api/agent/credentials", { method: "DELETE", body: JSON.stringify({ provider }) });
