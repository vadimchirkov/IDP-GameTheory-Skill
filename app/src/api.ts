import type { AgentSelection } from "../../src/agent-contracts";
import type { ScenarioModel } from "../../src/domain";
import type { TaskDecision, TaskReply, TaskState } from "../../src/task";
import type { TaskSummary } from "../../src/task-projections";

export type { AgentSelection, ScenarioModel, TaskDecision, TaskState, TaskSummary };

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

export interface AgentRequest {
  message: string;
  remember?: boolean;
  research?: boolean;
  operation?: "understand" | "build-model" | "revise-model";
  decisions?: readonly TaskDecision[];
  agent?: AgentSelection;
  baseRevision: number;
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

export const getTasks = () => api<TaskSummary[]>("/api/tasks");
export const getTask = (id: string) => api<TaskState>(`/api/tasks/${id}`);
export const getWorldReplay = (taskId: string, analysisId: string, index: number) => api<WorldReplay>(`/api/tasks/${taskId}/analyses/${analysisId}/worlds/${index}/replay`);
export const getAgentStatus = () => api<AgentStatus>("/api/agent/status");
export const saveProviderKey = (provider: string, apiKey: string) => api<AgentStatus>("/api/agent/credentials", { method: "POST", body: JSON.stringify({ provider, apiKey }) });
export const removeProviderKey = (provider: string) => api<AgentStatus>("/api/agent/credentials", { method: "DELETE", body: JSON.stringify({ provider }) });
export const chatAgent = (value: { message: string; context?: string; agent?: AgentSelection }) => api<{ text: string; suggestions: string[]; agent: AgentSelection }>("/api/agent/chat", { method: "POST", body: JSON.stringify(value) });
export const getScenarioHints = (value: { text: string; agent?: AgentSelection }) => api<{ hints: string[]; agent: AgentSelection }>("/api/agent/hints", { method: "POST", body: JSON.stringify(value) });
export const researchScenarioHint = (value: { question: string; context: string; agent?: AgentSelection }) => api<{ text: string; agent: AgentSelection }>("/api/agent/research", { method: "POST", body: JSON.stringify(value) });
export const createTask = (brief: string) => api<TaskState>("/api/tasks", { method: "POST", body: JSON.stringify({ brief }) });
export const sendCommand = (id: string, value: Record<string, unknown>) =>
  api<TaskReply>(`/api/tasks/${id}/commands`, { method: "POST", body: JSON.stringify(value) });
export const askAgent = (id: string, value: AgentRequest) =>
  api<TaskState>(`/api/tasks/${id}/agent`, { method: "POST", body: JSON.stringify(value) });
