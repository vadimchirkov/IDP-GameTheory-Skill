import type { AgentSelection } from "../../src/agent-contracts";
import type { ScenarioModel } from "../../src/domain";
import type { DecisionModel } from "../../src/adapters/decision";
import type { SimulationModel } from "../../src/model";
import type { AgentMode, Fact, FactKind, OpenQuestion, TaskMessage, TaskState } from "../../src/task";
import type { TaskSummary } from "../../src/task-projections";

export type { AgentMode, AgentSelection, DecisionModel, Fact, FactKind, OpenQuestion, ScenarioModel, SimulationModel, TaskMessage, TaskState, TaskSummary };

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

export type PinnedKind = "branch" | "option" | "factor" | "world" | "assumption" | "source" | "fact" | "run";

export interface PinnedContext {
  id: string;
  kind: PinnedKind;
  label: string;
  detail?: string;
  meta?: Record<string, unknown>;
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

/** One side of a reweighted decision run: the option summaries the evidence implies. */
export interface DecisionPosteriorView {
  effectiveSampleSize: number;
  fit: number;
  options: Record<string, { mean: number; std: number; p05: number; p50: number; p95: number; bestProbability: number; meanRegret: number; targetProbability?: number }>;
  recommendedOptionId: string;
  recommendation: { criterion: "targetProbability" | "meanRegret"; margin: number; close: boolean };
}

/**
 * A run reweighted by its accumulated outcome facts; baseline/posterior are null for legacy runs.
 * `adapter` says which shape the two sides carry — decision option summaries or C/D shares.
 */
export type RunPosterior =
  | { adapter: "decision"; baseline: DecisionPosteriorView; posterior: DecisionPosteriorView }
  | { adapter: null; usesTeams: boolean; baseline: PosteriorView | null; posterior: PosteriorView | null };

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
  suggestions: string[];
  task?: TaskState;
}

/** Every command returns the whole task, so the caller never reassembles state by hand. */
export type FactCommand =
  | { tag: "AddFact"; text: string; kind: "outcome" }
  | { tag: "EditFact"; factId: string; text: string }
  | { tag: "RemoveFact"; factId: string }
  | { tag: "SetSituation"; text: string }
  | { tag: "SetModel"; model: SimulationModel }
  | { tag: "DismissQuestion"; questionId: string }
  | { tag: "RemoveAnalysis"; analysisId: string }
  | { tag: "CancelAnalysis" }
  | { tag: "CancelModelBuild"; buildId: string }
  | { tag: "DeleteTask" };

const post = <T>(path: string, value: unknown) => api<T>(path, { method: "POST", body: JSON.stringify(value) });

export const getTasks = () => api<TaskSummary[]>("/api/tasks");
export const getTask = (id: string) => api<TaskState>(`/api/tasks/${id}`);
export const createTask = (text: string, id: string) => post<TaskState>("/api/tasks", { text, id });
export const sendCommand = (id: string, value: FactCommand) => post<TaskState>(`/api/tasks/${id}/commands`, value);
export const understandTask = (id: string, agent: AgentSelection | undefined) => post<TaskState>(`/api/tasks/${id}/understand`, { agent });
export const confirmContext = (id: string, note: string) => post<TaskState>(`/api/tasks/${id}/context/confirm`, { note });

/** What the assistant is doing right now, so a wait is never an unexplained spinner. */
export interface AgentEvent {
  kind: "status" | "text" | "restart" | "progress" | "done" | "error";
  stage?: string;
  message?: string;
  text?: string;
  attempt?: number;
  error?: string;
}

/**
 * Read one server-sent agent stream and resolve with its `done` event. Both long agent operations —
 * building a model and answering in chat — narrate themselves the same way, so they share this reader.
 */
async function postStream(path: string, value: unknown, onEvent: (event: AgentEvent) => void, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(value),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok && !response.headers.get("content-type")?.includes("text/event-stream")) {
    const failure = await response.json().catch(() => ({})) as { error?: string; reason?: string };
    throw new Error(failure.reason ?? failure.error ?? `HTTP ${response.status}`);
  }
  if (!response.body) throw new Error("Streaming not supported");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: Record<string, unknown> | undefined;
  let error: string | undefined;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.split("\n").find((item) => item.startsWith("data: "));
      if (!line) continue;
      let event: AgentEvent & Record<string, unknown>;
      try { event = JSON.parse(line.slice(6)) as AgentEvent & Record<string, unknown>; } catch { continue; }
      if (event.kind === "done") done = event;
      if (event.kind === "error") error = event.error ?? "The agent failed";
      onEvent(event);
    }
  }
  if (error) throw new Error(error);
  if (done) return done;
  throw new Error("The agent stream ended without a result");
}

export type ClarifyResult = ChatResult & {
  task: TaskState;
  pendingContext?: { note: string; display: string };
  pendingOutcome?: { observation: Record<string, unknown>; display: string };
};

export const clarifyTask = async (
  id: string,
  value: { message?: string; clientMessageId?: string; agent?: AgentSelection; pinned?: PinnedContext[]; selection?: RiverSelection; analysisId?: string },
  onEvent: (event: AgentEvent) => void = () => {},
  signal?: AbortSignal,
) => (await postStream(`/api/tasks/${id}/clarify`, value, onEvent, signal)).result as ClarifyResult;

export const understandTaskStream = async (id: string, agent: AgentSelection | undefined, onEvent: (event: AgentEvent) => void) =>
  (await postStream(`/api/tasks/${id}/understand/stream`, { agent }, onEvent)).task as TaskState;
export const runTask = (id: string, value: { trials?: number; seed?: number; agent?: AgentSelection }) => post<TaskState>(`/api/tasks/${id}/run`, value);
export const relabelTask = (id: string, analysisId: string, agent?: AgentSelection) => post<TaskState>(`/api/tasks/${id}/relabel`, { analysisId, agent });
export const confirmOutcome = (id: string, text: string, observation: Record<string, unknown>) => post<{ kind: string; message: string; task: TaskState }>(`/api/tasks/${id}/chat/confirm`, { text, observation });
export const getWorldReplay = (taskId: string, analysisId: string, index: number) => api<WorldReplay>(`/api/tasks/${taskId}/analyses/${analysisId}/worlds/${index}/replay`);
export const getPosterior = (taskId: string, analysisId: string) => api<RunPosterior>(`/api/tasks/${taskId}/analyses/${analysisId}/posterior`);
export const getAgentStatus = () => api<AgentStatus>("/api/agent/status");
export const saveProviderKey = (provider: string, apiKey: string) => post<AgentStatus>("/api/agent/credentials", { provider, apiKey });
export const removeProviderKey = (provider: string) => api<AgentStatus>("/api/agent/credentials", { method: "DELETE", body: JSON.stringify({ provider }) });
