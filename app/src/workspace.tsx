import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  chatTask, clarifyTask, confirmContext, confirmOutcome, createTask, getAgentStatus, getPosterior, getTask, getTasks, getWorldReplay, relabelTask, removeProviderKey, runTask, saveProviderKey, sendCommand, understandTask, understandTaskStream,
  type AgentMode, type AgentModelStatus, type AgentSelection, type DecisionModel, type Fact, type FactCommand, type ModelMode, type PinnedContext, type PinnedKind, type RiverSelection, type ScenarioModel, type TaskState, type TaskSummary, type WorldReplay,
} from "./api";
import { RiverActivity } from "./river-activity";
import { relativeTime } from "./relative-time";

const statusName = { ready: "Ready", running: "Running", labeling: "Labeling", completed: "Complete", failed: "Failed", building: "Building", new: "New" } as const;
type PromptState = { mode: "create"; taskId: string };
type ModelOption = AgentModelStatus;
type BuildActivityItem = { id: string; stage: string; message: string; status: "active" | "done" | "failed" };
type PendingDelete =
  | { id: string; kind: "task"; task: TaskSummary; nextTaskId?: string; committing?: boolean }
  | { id: string; kind: "analysis"; taskId: string; revision: number; analysis: TaskState["analyses"][number]; wasSelected: boolean; committing?: boolean };

const thinkingName: Record<AgentSelection["thinkingLevel"], string> = { off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Maximum" };
const selectionValue = (selection: AgentSelection) => JSON.stringify(selection);
const levelsFor = (model: ModelOption): AgentSelection["thinkingLevel"][] => model.thinkingLevels?.length ? model.thinkingLevels : model.reasoning ? ["off", "low", "medium", "high"] : ["off"];

function parseSelection(value: string, models: ModelOption[]): AgentSelection | undefined {
  let candidate: Partial<AgentSelection> = {};
  try { candidate = JSON.parse(value) as Partial<AgentSelection>; }
  catch { const [provider, model] = value.split("\0"); candidate = { provider, model, thinkingLevel: "medium" }; }
  const model = models.find((item) => item.provider === candidate.provider && item.model === candidate.model);
  if (!model) return undefined;
  const levels = levelsFor(model);
  const requested = candidate.thinkingLevel;
  const thinkingLevel = requested && levels.includes(requested) ? requested : levels.includes("medium") ? "medium" : levels[0] ?? "off";
  return { provider: model.provider, model: model.model, thinkingLevel };
}

function savedSelection() {
  return localStorage.getItem("pi-agent") ?? localStorage.getItem("pi-agent-key") ?? "";
}

function saveSelection(value: string, models: ModelOption[]) {
  const selection = parseSelection(value, models);
  if (!selection) return;
  localStorage.setItem("pi-agent", selectionValue(selection));
  localStorage.setItem("pi-agent-key", `${selection.provider}\0${selection.model}`);
}

function openDialog(dialog: HTMLDialogElement | null) {
  if (dialog && !dialog.open) dialog.showModal();
}

function Icon({ name }: { name: "collapse" | "worlds" | "situations" | "runs" | "settings" | "plus" | "more" | "trash" | "chat" | "close" | "edit" | "refresh" | "search" | "send" | "branch" | "option" | "factor" | "assump" | "source" }) {
  const paths = {
    collapse: <><path d="M9 4v16" /><path d="m15 9-3 3 3 3" /></>,
    worlds: <><circle cx="12" cy="12" r="8.5" /><path d="M3.8 12h16.4M12 3.5c2.3 2.3 3.5 5.1 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.1-3.5-8.5S9.7 5.8 12 3.5z" /></>,
    situations: <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" /></>,
    runs: <><circle cx="6" cy="5" r="2" /><circle cx="18" cy="5" r="2" /><circle cx="18" cy="18" r="2" /><path d="M8 5h8M6 7v5a6 6 0 0 0 6 6h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    more: <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>,
    trash: <><path d="M5.5 7h13M9 7V4.5h6V7M7 7l1 13h8l1-13M10.5 10.5V16M13.5 10.5V16" /></>,
    chat: <path d="M4 5h16v11H9l-5 4z" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    edit: <><path d="M5 19h3.2L18 9.2 14.8 6 5 15.8z" /><path d="M13.8 7l3.2 3.2" /></>,
    refresh: <><path d="M19 8V4l-2 2a7 7 0 1 0 1.2 9" /><path d="M19 4h-4" /></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></>,
    send: <><path d="M12 19V5" /><path d="m6.5 10.5 5.5-5.5 5.5 5.5" /></>,
    branch: <><path d="M7 5a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM17 13a2 2 0 1 1 0 4 2 2 0 0 1 0-4z" /><path d="M7 7v6a4 4 0 0 0 4 4h6" /></>,
    option: <><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M8 9h8M8 12h8" /></>,
    factor: <><path d="M4 16l6-8 4 5 6-7" /><path d="M12 5v2M8 8l1 1" /></>,
    assump: <><path d="M12 5l7 4v6l-7 4-7-4v-6z" /><path d="M12 9v6M9 12h6" /></>,
    source: <><path d="M10 7H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h4" /><path d="M14 17h4a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-4" /><path d="M8 12h8" /></>,
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function pinnedIcon(kind: PinnedKind): "branch" | "option" | "factor" | "assump" | "source" | "worlds" | "search" | "chat" {
  if (kind === "branch") return "branch";
  if (kind === "option") return "option";
  if (kind === "factor") return "factor";
  if (kind === "assumption") return "assump";
  if (kind === "source") return "source";
  if (kind === "world") return "worlds";
  if (kind === "fact") return "chat";
  return "search";
}

function compactDate(value?: string) {
  return value ? new Date(value).toLocaleString("en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

function word(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100, last = count % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

const FIELD_LABELS: Record<string, string> = {
  players: "participants", payoffs: "incentives", "structure.w": "repeat interaction",
  "structure.noise": "misunderstandings", "structure.drift": "changing preferences",
  "structure.sigma": "option to leave", "structure.reputation": "reputation",
  "structure.punishment": "sanctions", "structure.cheapTalk": "promises and signals",
  "structure.eco": "changing conditions", "structure.transitions": "state changes",
  rationale: "model reasoning",
};
const fieldLabel = (field: string | undefined) => field ? FIELD_LABELS[field] ?? field : "";
const shortTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
const sourceKind = (url: string) => {
  const host = new URL(url).hostname;
  const official = /(^|\.)(gov|mil)(\.|$)|\.europa\.eu$|\.int$/.test(host);
  const academic = /\.edu$|\.ac\.[a-z]{2}$/.test(host);
  return official ? "official" : academic ? "academic" : "public";
};

function analysisKey(analysis: TaskState["analyses"][number]) {
  return analysis.id ?? analysis.visualUrl;
}

function uniqueRuns(analyses: TaskState["analyses"]) {
  const seen = new Set<string>();
  return [...analyses].reverse().filter((analysis) => {
    const key = analysisKey(analysis);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function useMobile() {
  const [mobile, setMobile] = useState(() => matchMedia("(max-width:900px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width:900px)"), update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return mobile;
}

function useElapsed(active: boolean) {
  const [started, setStarted] = useState(0);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!active) { setStarted(0); return; }
    setStarted(Date.now());
    const timer = setInterval(() => tick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  return started ? Math.floor((Date.now() - started) / 1_000) : 0;
}

function useMinuteClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  return now;
}

function inlineMarkdown(text: string): ReactNode[] {
  const token = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|\*[^*\n]+\*)/g;
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(token)) {
    const index = match.index ?? 0, value = match[0];
    if (index > cursor) nodes.push(text.slice(cursor, index));
    if (value.startsWith("**")) nodes.push(<strong key={index}>{value.slice(2, -2)}</strong>);
    else if (value.startsWith("`")) nodes.push(<code key={index}>{value.slice(1, -1)}</code>);
    else if (value.startsWith("[")) {
      const link = value.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      nodes.push(link ? <a key={index} href={link[2]} target="_blank" rel="noopener noreferrer">{link[1]}</a> : value);
    } else nodes.push(<em key={index}>{value.slice(1, -1)}</em>);
    cursor = index + value.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

function MarkdownMessage({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n"), blocks: ReactNode[] = [];
  const startsBlock = (line: string) => /^(```|#{1,3}\s|[-*]\s|\d+\.\s|>\s)/.test(line);
  for (let index = 0; index < lines.length;) {
    const line = lines[index] ?? "";
    if (!line.trim()) { index += 1; continue; }
    if (line.startsWith("```")) {
      const language = line.slice(3).trim(), code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith("```")) code.push(lines[index++]!);
      if (index < lines.length) index += 1;
      blocks.push(<pre key={`code-${index}`}><code data-language={language || undefined}>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const content = inlineMarkdown(heading[2]!);
      blocks.push(heading[1]!.length === 1 ? <h2 key={index}>{content}</h2> : heading[1]!.length === 2 ? <h3 key={index}>{content}</h3> : <h4 key={index}>{content}</h4>);
      index += 1; continue;
    }
    if (/^[-*]\s/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^[-*]\s/.test(lines[index]!)) items.push(<li key={index}>{inlineMarkdown(lines[index++]!.replace(/^[-*]\s+/, ""))}</li>);
      blocks.push(<ul key={`list-${index}`}>{items}</ul>); continue;
    }
    if (/^\d+\.\s/.test(line)) {
      const items: ReactNode[] = [];
      while (index < lines.length && /^\d+\.\s/.test(lines[index]!)) items.push(<li key={index}>{inlineMarkdown(lines[index++]!.replace(/^\d+\.\s+/, ""))}</li>);
      blocks.push(<ol key={`list-${index}`}>{items}</ol>); continue;
    }
    if (/^>\s/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^>\s/.test(lines[index]!)) quote.push(lines[index++]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={`quote-${index}`}>{inlineMarkdown(quote.join(" "))}</blockquote>); continue;
    }
    const paragraph = [line]; index += 1;
    while (index < lines.length && lines[index]!.trim() && !startsBlock(lines[index]!)) paragraph.push(lines[index++]!);
    blocks.push(<p key={`p-${index}`}>{inlineMarkdown(paragraph.join(" "))}</p>);
  }
  return <div className="markdown-message">{blocks}</div>;
}

export function Workspace({ taskId, selectedRun, onSelectRun = () => {} }: { taskId?: string; selectedRun?: string; onSelectRun?: (run?: string) => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const mobile = useMobile();
  const now = useMinuteClock();
  const [hideSituations, setHideSituations] = useState(() => localStorage.getItem("pane-situations") === "hidden");
  const [situationsOpen, setSituationsOpen] = useState(false);
  const [centerTab, setCenterTab] = useState<"context" | "model" | "river">("context");
  const [pendingOutcome, setPendingOutcome] = useState<{ message: string; observation: Record<string, unknown>; display: string } | null>(null);
  const [prompt, setPrompt] = useState<PromptState>();
  const [draftText, setDraftText] = useState(() => sessionStorage.getItem("flumina-situation-draft") ?? "");
  const [promptError, setPromptError] = useState("");
  const [runError, setRunError] = useState("");
  const [rebuildDone, setRebuildDone] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [buildActivity, setBuildActivity] = useState<BuildActivityItem[]>([]);
  const [streamError, setStreamError] = useState("");
  const [modelError, setModelError] = useState("");
  const [modelMode, setModelMode] = useState<ModelMode>("decision");
  const [nextSeed, setNextSeed] = useState<number>();
  const [agentKey, setAgentKey] = useState(savedSelection);
  const [settingsAgentKey, setSettingsAgentKey] = useState("");
  const [keyProvider, setKeyProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [agentPanel, setAgentPanel] = useState(() => {
    const saved = localStorage.getItem("pane-agent");
    return saved === "open";
  });
  const [relabelPending, setRelabelPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [initialGuidePending, setInitialGuidePending] = useState(false);
  const initialGuideAbort = useRef<AbortController | undefined>(undefined);
  const [chatFollowUps, setChatFollowUps] = useState<string[]>([]);
  const [riverSelection, setRiverSelection] = useState<RiverSelection>();
  const [worldReplay, setWorldReplay] = useState<WorldReplay>();
  const [replayError, setReplayError] = useState("");
  const [trials, setTrials] = useState(600);
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([]);
  const [pinned, setPinned] = useState<PinnedContext[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pendingQueue, setPendingQueue] = useState<Array<{ id: string; note: string; display: string; edit: string }>>([]);
  const promptDialog = useRef<HTMLDialogElement>(null);
  const modelDialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsPrompted = useRef(false);
  const deleteTimers = useRef(new Map<string, number>());
  const riverFrame = useRef<HTMLIFrameElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const chatInput = useRef<HTMLTextAreaElement>(null);
  const chatAbort = useRef<AbortController | undefined>(undefined);
  const situationInput = useRef<HTMLTextAreaElement>(null);
  const situationSave = useRef<Promise<TaskState | undefined>>(Promise.resolve(undefined));
  const buildCancelled = useRef(false);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const tasks = useQuery({ queryKey: ["tasks"], queryFn: getTasks });
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => getTask(taskId!), enabled: Boolean(taskId) });
  const agent = useQuery({ queryKey: ["agent-status"], queryFn: getAgentStatus, retry: 0 });
  const current = task.data;
  // Two roles, not three: one thread guides the situation before a run, the other reads the river after
  // it. The agent cannot edit the model in either, so a separate "model" chat promised what it can't do.
  const assistantMode: AgentMode = current?.model && centerTab === "river" ? "river" : "context";
  const chatMessages = (current?.messages ?? []).filter((message) => (assistantMode === "river" ? message.mode === "river" : message.mode !== "river"));
  const storedFollowUps = [...chatMessages].reverse().find((message) => message.role === "agent" && message.suggestions?.length)?.suggestions ?? [];

  useEffect(() => {
    const first = tasks.data?.[0];
    if (!taskId && first) void navigate({ to: "/tasks/$taskId", params: { taskId: first.id }, replace: true });
  }, [navigate, taskId, tasks.data]);

  useEffect(() => {
    setNextSeed(undefined);
    setRunError("");
    setBuildActivity([]);
    buildCancelled.current = false;
    setStreaming(false);
    setRebuildDone(false);
    setTrials(current?.analyses.at(-1)?.trials ?? 600);
    setModelMode(current?.model && !("adapter" in current.model) ? "strategic" : "decision");
    setCenterTab(current?.analyses.length ? "river" : current?.model ? "model" : "context");
    setPinned([]);
    setPickerOpen(false);
    setPendingQueue([]);
  }, [taskId, current?.id]);

  // auto-clean nullish pending items (fixes "Suggested from chat null" bug)
  useEffect(() => {
    setPendingQueue((prev) => {
      const filtered = prev.filter((p) => p.note && !/^(null|undefined|none)$/i.test(p.note.trim()) && p.note.trim().length >= 8);
      return filtered.length === prev.length ? prev : filtered;
    });
  }, [pendingQueue]);

  useEffect(() => {
    if (!taskId) return;
    const stream = new EventSource(`/api/tasks/${taskId}/events`);
    stream.onmessage = () => {
      void queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    };
    stream.onopen = () => setStreamError("");
    stream.onerror = () => setStreamError("The live update connection was lost. Your browser will try to reconnect.");
    return () => stream.close();
  }, [queryClient, taskId]);

  useEffect(() => {
    const build = current?.activeBuild;
    if (!build || streaming) return;
    setBuildActivity([{ id: build.buildId, stage: build.stage, message: build.error ?? build.message, status: build.status === "failed" ? "failed" : "active" }]);
  }, [current?.activeBuild?.buildId, current?.activeBuild?.stage, current?.activeBuild?.message, current?.activeBuild?.status, current?.activeBuild?.error, current?.activeBuild?.updatedAt, streaming]);

  useEffect(() => {
    const dialog = promptDialog.current;
    if (prompt) openDialog(dialog);
    if (!prompt && dialog?.open) dialog.close();
  }, [prompt]);

  useEffect(() => { setPromptError(""); }, [prompt]);

  const models = agent.data?.models ?? [];
  const agentAvailable = Boolean(agent.data?.available && models.length > 0);
  const agentStatusText = agent.data?.detail ?? (agentAvailable ? "Pi agent connected" : agent.data?.error ?? "Configure Pi authentication in Settings");
  const selectedAgent = useMemo<AgentSelection | undefined>(() => {
    const saved = parseSelection(agentKey, models);
    if (saved) return saved;
    const preferred = current?.agent ?? agent.data?.defaultSelection;
    if (preferred) {
      const normalized = parseSelection(selectionValue(preferred), models);
      if (normalized) return normalized;
    }
    const first = models[0];
    return first ? parseSelection(selectionValue({ provider: first.provider, model: first.model, thinkingLevel: "medium" }), models) : undefined;
  }, [agent.data?.defaultSelection, agentKey, current?.agent, models]);

  const createMutation = useMutation({ mutationFn: ({ text, id }: { text: string; id: string }) => createTask(text, id) });
  const commandMutation = useMutation({ mutationFn: ({ id, value }: { id: string; value: FactCommand }) => sendCommand(id, value) });
  const agentMutation = useMutation({ mutationFn: ({ id, mode }: { id: string; mode: ModelMode }) => understandTask(id, selectedAgent, mode) });
  // keep agentMutation for fallback non-stream calls; streaming uses understandTaskStream directly
  const keyMutation = useMutation({ mutationFn: ({ provider, key }: { provider: string; key?: string }) => key ? saveProviderKey(provider, key) : removeProviderKey(provider) });
  const addPin = (item: PinnedContext) => setPinned((prev) => prev.some((p) => p.id === item.id) ? prev : [...prev, item].slice(0, 12));
  const removePin = (id: string) => setPinned((prev) => prev.filter((p) => p.id !== id));
  const clearPins = () => setPinned([]);

  // The chat is the conversational way in: the agent answers questions and files facts itself, so the
  // user never has to decide which box a sentence belongs in.
  const chatMutation = useMutation({
    mutationFn: async (vars: { message: string }) => {
      if (!taskId) throw new Error("Open a situation first");
      const controller = new AbortController();
      chatAbort.current = controller;
      const routed = assistantMode === "river"
        ? await chatTask(taskId, vars.message, selectedAgent, riverSelection, selectedAnalysisId, pinned)
        : await clarifyTask(taskId, { message: vars.message, agent: selectedAgent, pinned }, controller.signal).catch((error: unknown) => {
          // A running pre-upgrade server has no /clarify route yet; keep context prompts usable.
          if (error instanceof Error && error.message === "Not found") return chatTask(taskId, vars.message, selectedAgent, undefined, undefined, pinned);
          throw error;
        });
      if (routed.task) cacheTask(routed.task);
      const pending = (routed as unknown as { pendingContext?: { note: string; display: string } }).pendingContext;
      if (pending?.note) {
        const norm = pending.note.trim();
        const isNullish = !norm || /^(null|undefined|none)$/i.test(norm) || norm.length < 8;
        if (isNullish) return routed;
        const display = (pending.display && !/^(null|undefined)$/i.test(pending.display)) ? pending.display : norm.slice(0, 220);
        setPendingQueue((prev) => {
          if (prev.some((p) => p.note === norm)) return prev;
          const id = (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
          return [...prev, { id, note: norm, display, edit: norm }];
        });
      }
      return routed;
    },
    onSettled: () => { chatAbort.current = undefined; },
  });
  const replayMutation = useMutation({ mutationFn: ({ taskId, analysisId, index }: { taskId: string; analysisId: string; index: number }) => getWorldReplay(taskId, analysisId, index) });
  const buildActive = current?.activeBuild?.status === "running" || current?.status === "building";
  const buildFailed = buildActivity.some((item) => item.status === "failed");
  const busy = createMutation.isPending || commandMutation.isPending || agentMutation.isPending || streaming || buildActive;
  const promptBusy = createMutation.isPending;
  const elapsed = useElapsed(busy);
  const assistantPending = chatMutation.isPending || agentMutation.isPending || initialGuidePending;
  const chatElapsed = useElapsed(assistantPending);

  const cacheTask = (value: TaskState) => {
    queryClient.setQueryData(["task", value.id], value);
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const persistSituation = () => {
    const text = situationInput.current?.value.trim();
    if (!current || !text) return situationSave.current;
    const run = situationSave.current.catch(() => undefined).then(async () => {
      const latest = queryClient.getQueryData<TaskState>(["task", current.id]) ?? current;
      if (latest.situation.trim() === text) return latest;
      const saved = await sendCommand(current.id, { tag: "SetSituation", text });
      cacheTask(saved);
      return saved;
    });
    situationSave.current = run.catch(() => undefined);
    return run;
  };

  const runCommand = async (value: FactCommand) => {
    if (!current) return;
    setRunError("");
    try { cacheTask(await commandMutation.mutateAsync({ id: current.id, value })); }
    catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  };

  /** Persist drawer open state */
  useEffect(() => { localStorage.setItem("pane-agent", agentPanel ? "open" : "closed"); }, [agentPanel]);

  /** Explicit Context → Model transition. Progress is status, never fake chat history. */
  const reviewWithAgent = async (id = current?.id) => {
    if (!id) return;
    await persistSituation();
    if (!agentAvailable) { setRunError(agentStatusText); openSettings(); return; }
    setRunError("");
    setRebuildDone(false);
    setBuildActivity([]);
    setStreaming(true);
    setCenterTab("model");
    const advanceStage = (ev: Record<string, unknown>) => {
      const stage = String(ev.stage ?? "");
      if (ev.kind === "error") {
        const message = String(ev.error ?? "The model build stopped").trim();
        setBuildActivity((items) => {
          const failed: BuildActivityItem[] = items.map((item) => ({ ...item, status: (item.status === "active" ? "failed" : item.status) as BuildActivityItem["status"] }));
          const next: BuildActivityItem[] = [...failed, { id: `error-${items.length}`, stage: "error", message, status: "failed" }];
          return next.slice(-6);
        });
        return;
      }
      if (ev.kind === "done") {
        setBuildActivity((items) => items.map((item) => ({ ...item, status: "done" as const })));
        return;
      }
      const message = String(ev.message ?? "").trim();
      if (!message || !stage || stage === "shape" || stage === "save") return;
      setBuildActivity((items) => {
        const current = items.at(-1);
        if (current?.stage === stage && current.message === message) return items;
        return [...items.map((item) => ({ ...item, status: "done" as const })), { id: `${stage}-${items.length}`, stage, message, status: "active" as const }].slice(-6);
      });
    };
    try {
      // Prefer streaming endpoint (shows live agent messages); fallback to classic
      let task: TaskState;
      try {
        task = await understandTaskStream(id, selectedAgent, modelMode, advanceStage);
      } catch (e) {
        // If streaming not available, fallback
        if (!String(e).includes("Streaming not supported")) throw e;
        task = await agentMutation.mutateAsync({ id, mode: modelMode });
      }
      cacheTask(task);
      if (buildCancelled.current) return;
      if (selectedAgent) { const value = selectionValue(selectedAgent); saveSelection(value, models); setAgentKey(value); }
      setRebuildDone(true);
      window.setTimeout(() => setRebuildDone(false), 4000);
    } catch (error) {
      if (buildCancelled.current) return;
      const message = error instanceof Error ? error.message : String(error);
      setBuildActivity((items) => {
        if (items.at(-1)?.status === "failed") return items;
        const failed: BuildActivityItem[] = items.map((item) => ({ ...item, status: (item.status === "active" ? "failed" : item.status) as BuildActivityItem["status"] }));
        const next: BuildActivityItem[] = [...failed, { id: `error-${items.length}`, stage: "error", message, status: "failed" }];
        return next.slice(-6);
      });
    }
    finally { setStreaming(false); }
  };

  const submitPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt) return;
    setPromptError("");
    try {
      const text = draftText.trim();
      if (!text) throw new Error("Describe the situation first");
      if (text.length > 4_000) throw new Error("The situation is too long (maximum 4000 characters)");
      const created = await createMutation.mutateAsync({ text, id: prompt.taskId });
      cacheTask(created);
      sessionStorage.removeItem("flumina-situation-draft");
      setDraftText("");
      setPrompt(undefined);
      void navigate({ to: "/tasks/$taskId", params: { taskId: created.id } });
      setAgentPanel(true);
      if (agentAvailable) {
        const controller = new AbortController();
        initialGuideAbort.current = controller;
        setInitialGuidePending(true);
        setChatError("");
        try {
          const guided = await clarifyTask(created.id, { agent: selectedAgent }, controller.signal);
          cacheTask(guided.task);
        } catch (error) {
          if (!(error instanceof DOMException && error.name === "AbortError")) setChatError(`The situation was saved, but the context guide failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
          if (initialGuideAbort.current === controller) initialGuideAbort.current = undefined;
          setInitialGuidePending(false);
        }
      }
    } catch (error) { setPromptError(error instanceof Error ? error.message : String(error)); }
  };

  // One Run: if situation is stale we rebuild first (so Run reflects what the user sees). Simulation itself is deterministic and needs no agent; labeling will be skipped if no agent.
  const runAnalysis = async () => {
    if (!current) return;
    if (situationStale) {
      await reviewWithAgent(current.id);
      // re-read after rebuild: if still stale or model missing, abort
      const fresh = queryClient.getQueryData<TaskState>(["task", current.id]);
      if (!fresh?.model || fresh.model.situation.trim() !== fresh.situation.trim()) {
        setRunError("Rebuild did not apply — check the situation text and try again.");
        return;
      }
    }
    setRunError("");
    try {
      const worldCount = Math.min(5000, Math.max(1, Math.round(trials)));
      setTrials(worldCount);
      const seed = nextSeed ?? ((crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff) || 1);
      cacheTask(await runTask(current.id, { trials: worldCount, seed, ...(selectedAgent ? { agent: selectedAgent } : {}) }));
      setNextSeed(undefined);
      onSelectRun(undefined);
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  };

  const relabelAnalysis = async () => {
    if (!current || !selectedAnalysis?.id) return;
    if (!agentAvailable) { setRunError(agentStatusText); openSettings(); return; }
    setRelabelPending(true);
    setRunError("");
    try {
      cacheTask(await relabelTask(current.id, selectedAnalysis.id, selectedAgent));
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
    finally { setRelabelPending(false); }
  };

  const cancelAnalysis = () => void runCommand({ tag: "CancelAnalysis" });
  const cancelModelBuild = async () => {
    if (!current?.activeBuild) return;
    buildCancelled.current = true;
    setBuildActivity([]);
    try { cacheTask(await sendCommand(current.id, { tag: "CancelModelBuild", buildId: current.activeBuild.buildId })); }
    catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  };

  const commitDelete = async (deletion: PendingDelete) => {
    setPendingDeletes((items) => items.map((item) => item.id === deletion.id ? { ...item, committing: true } : item));
    try {
      if (deletion.kind === "task") await sendCommand(deletion.task.id, { tag: "DeleteTask" });
      else await sendCommand(deletion.taskId, { tag: "RemoveAnalysis", analysisId: analysisKey(deletion.analysis) });
      if (deletion.kind === "analysis") await queryClient.invalidateQueries({ queryKey: ["task", deletion.taskId] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      if (deletion.kind === "task" && taskIdRef.current === deletion.task.id) {
        if (deletion.nextTaskId) await navigate({ to: "/tasks/$taskId", params: { taskId: deletion.nextTaskId }, replace: true });
        else await navigate({ to: "/", replace: true });
      }
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
    finally { deleteTimers.current.delete(deletion.id); setPendingDeletes((items) => items.filter((item) => item.id !== deletion.id)); }
  };

  const deferDelete = (deletion: PendingDelete) => {
    setPendingDeletes((items) => [...items, deletion]);
    deleteTimers.current.set(deletion.id, window.setTimeout(() => void commitDelete(deletion), 6_000));
  };

  const undoDelete = (id: string) => {
    const deletion = pendingDeletes.find((item) => item.id === id);
    if (!deletion || deletion.committing) return;
    const timer = deleteTimers.current.get(id); if (timer !== undefined) window.clearTimeout(timer);
    deleteTimers.current.delete(id);
    setPendingDeletes((items) => items.filter((item) => item.id !== id));
    if (deletion.kind === "analysis" && deletion.wasSelected) onSelectRun(analysisKey(deletion.analysis));
  };

  const removeAnalysis = (analysis: TaskState["analyses"][number]) => {
    if (!current) return;
    const runId = analysisKey(analysis), wasSelected = Boolean(selectedAnalysis && analysisKey(selectedAnalysis) === runId);
    deferDelete({ id: crypto.randomUUID(), kind: "analysis", taskId: current.id, revision: current.revision, analysis, wasSelected });
    if (wasSelected) onSelectRun(undefined);
  };

  const removeTask = (item: TaskSummary) => {
    const hidden = new Set(pendingDeletes.filter((entry) => entry.kind === "task").map((entry) => entry.task.id));
    const nextTaskId = tasks.data?.find((task) => task.id !== item.id && !hidden.has(task.id))?.id;
    deferDelete({ id: crypto.randomUUID(), kind: "task", task: { ...item, revision: current?.id === item.id ? current.revision : item.revision }, ...(nextTaskId ? { nextTaskId } : {}) });
  };

  const openModel = () => {
    if (!current) return;
    setModelError("");
    openDialog(modelDialog.current);
  };

  const openSettings = () => {
    setSituationsOpen(false);
    setAgentPanel(false);
    setSettingsAgentKey(selectedAgent ? selectionValue(selectedAgent) : agentKey);
    setKeyProvider(agent.data?.authProviders.find((provider) => provider.id === "openai")?.id ?? agent.data?.authProviders[0]?.id ?? "");
    setKeyError("");
    openDialog(settingsDialog.current);
  };

  useEffect(() => {
    if (settingsPrompted.current || agent.isPending || !agent.data || parseSelection(savedSelection(), models)) return;
    settingsPrompted.current = true;
    const preferred = agent.data.defaultSelection ?? (models[0] ? { provider: models[0].provider, model: models[0].model, thinkingLevel: "medium" as const } : undefined);
    if (preferred) {
      const value = selectionValue(preferred);
      setAgentKey(value);
      saveSelection(value, models);
      return;
    }
    setSettingsAgentKey("");
    setKeyProvider(agent.data.authProviders.find((provider) => provider.id === "openai")?.id ?? agent.data.authProviders[0]?.id ?? "");
    openDialog(settingsDialog.current);
  }, [agent.data, agent.isPending, models]);

  const saveSettings = (event: FormEvent) => {
    event.preventDefault();
    setAgentKey(settingsAgentKey);
    saveSelection(settingsAgentKey, models);
    settingsDialog.current?.close();
  };

  const configureKey = async () => {
    setKeyError("");
    try {
      const status = await keyMutation.mutateAsync({ provider: keyProvider, key: apiKey.trim() });
      queryClient.setQueryData(["agent-status"], status);
      setApiKey("");
      const first = status.defaultSelection ?? (status.models[0] ? { provider: status.models[0].provider, model: status.models[0].model, thinkingLevel: "medium" as const } : undefined);
      if (!parseSelection(settingsAgentKey, status.models) && first) setSettingsAgentKey(selectionValue(first));
    } catch (error) { setKeyError(error instanceof Error ? error.message : String(error)); }
  };

  const deleteKey = async (provider: string) => {
    if (!confirm("Delete the saved API key for this provider?")) return;
    setKeyError("");
    try {
      const status = await keyMutation.mutateAsync({ provider });
      queryClient.setQueryData(["agent-status"], status);
      if (selectedAgent?.provider === provider) {
        localStorage.removeItem("pi-agent"); localStorage.removeItem("pi-agent-key"); setAgentKey("");
      }
    } catch (error) { setKeyError(error instanceof Error ? error.message : String(error)); }
  };

  const sendChatMessage = async (message: string) => {
    if (!message) return;
    if (!selectedAgent && !agentAvailable) { setChatError(agentStatusText); openSettings(); return; }
    setChatError("");
    try {
      if (assistantMode !== "river") await persistSituation();
      const result = await chatMutation.mutateAsync({ message });
      setChatFollowUps(result.suggestions ?? []);
      if ((result as unknown as { pendingOutcome?: { observation: Record<string, unknown>; display: string } }).pendingOutcome) {
        const pending = (result as unknown as { pendingOutcome: { observation: Record<string, unknown>; display: string } }).pendingOutcome;
        setPendingOutcome({ message, observation: pending.observation, display: pending.display });
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setChatError(error instanceof Error ? error.message : String(error));
    }
  };

  const confirmPendingOutcome = async () => {
    if (!pendingOutcome || !current) return;
    setChatError("");
    try {
      const res = await confirmOutcome(current.id, pendingOutcome.message, pendingOutcome.observation);
      if (res.task) cacheTask(res.task);
      setPendingOutcome(null);
    } catch (error) { setChatError(error instanceof Error ? error.message : String(error)); }
  };

  const confirmPendingContext = async (id: string) => {
    const item = pendingQueue.find((p) => p.id === id);
    if (!item || !current) return;
    const note = item.edit.trim() || item.note.trim();
    if (!note) { setPendingQueue((prev) => prev.filter((p) => p.id !== id)); return; }
    setChatError("");
    try {
      const updated = await confirmContext(current.id, note);
      cacheTask(updated);
      setPendingQueue((prev) => prev.filter((p) => p.id !== id));
    } catch (error) { setChatError(error instanceof Error ? error.message : String(error)); }
  };
  const dismissPendingContext = (id: string) => setPendingQueue((prev) => prev.filter((p) => p.id !== id));
  const updatePendingEdit = (id: string, edit: string) => setPendingQueue((prev) => prev.map((p) => p.id === id ? { ...p, edit } : p));

  const handleSuggestion = (suggestion: string) => {
    if (chatInput.current) {
      chatInput.current.value = suggestion;
      chatInput.current.focus();
      // move cursor to end
      const len = suggestion.length;
      chatInput.current.setSelectionRange(len, len);
    }
    setAgentPanel(true);
  };

  const answerQuestion = (prompt: string) => {
    const prefix = `Question: ${prompt}\nAnswer: `;
    if (chatInput.current) { chatInput.current.value = prefix; chatInput.current.focus(); }
    setAgentPanel(true);
  };

  const submitChat = async (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement, message = String(new FormData(form).get("chat") ?? "").trim();
    if (!message || !current || !agentAvailable) return;
    form.reset();
    await sendChatMessage(message);
  };

  const saveModel = async (event: FormEvent) => {
    event.preventDefault();
    if (!current) return;
    setModelError("");
    try {
      const form = new FormData(event.currentTarget as HTMLFormElement), rawSeed = form.get("seed")?.toString().trim() ?? "";
      const seed = rawSeed ? Number(rawSeed) : undefined;
      if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 1 || seed > 2_147_483_647)) throw new Error("Seed must be an integer from 1 to 2147483647");
      setNextSeed(seed);
      modelDialog.current?.close();
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
  };

  const toggleSituations = () => {
    if (mobile) { setSituationsOpen((value) => !value); return; }
    setHideSituations((value) => {
      localStorage.setItem("pane-situations", value ? "shown" : "hidden");
      return !value;
    });
  };

  const hiddenTaskIds = new Set(pendingDeletes.filter((item) => item.kind === "task").map((item) => item.task.id));
  const hiddenAnalysisIds = new Set(pendingDeletes.flatMap((item) => item.kind === "analysis" && item.taskId === current?.id ? [analysisKey(item.analysis)] : []));
  const visibleTasks = tasks.data?.filter((item) => !hiddenTaskIds.has(item.id));
  const analyses = (current?.analyses ?? []).filter((analysis) => !hiddenAnalysisIds.has(analysisKey(analysis)));
  const authProviders = [...(agent.data?.authProviders ?? [])].sort((a, b) => {
    const preferred = ["openai", "anthropic", "openrouter", "google", "xai", "deepseek"];
    const ai = preferred.indexOf(a.id), bi = preferred.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi) || a.name.localeCompare(b.name);
  });
  const selectedAnalysis = (selectedRun
    ? [...analyses].reverse().find((item) => analysisKey(item) === selectedRun)
    : undefined) ?? analyses.at(-1);
  const selectedAnalysisId = selectedAnalysis ? analysisKey(selectedAnalysis) : "";
  const analysisActive = current?.status === "running" || current?.status === "labeling";
  const decisionCurrent = Boolean(current?.model && "adapter" in current.model && current.model.adapter === "decision");
  const strategicCurrent = Boolean(current?.model && !("adapter" in current.model));
  const modelBuildSupported = !current?.model || decisionCurrent || strategicCurrent;
  // Only outcome facts are evidence. Journals written before the redesign still carry situation facts,
  // and the engine ignores them — so the workspace must not count or list them as things that happened.
  const outcomeFacts = (current?.facts ?? []).filter((fact) => fact.kind === "outcome");
  const situationStale = Boolean(current?.model && current.situation.trim() && current.model.situation.trim() !== current.situation.trim());
  const questionsStale = current?.questionsRevision !== undefined && current.questionsRevision !== current.revision;
  const researchStale = current?.researchRevision !== undefined && current.researchRevision !== current.revision;
  const openQs = (current?.openQuestions ?? []).slice(0, 3);
  const contextualSuggestions = assistantMode === "context"
    ? [
        ...openQs.map((q) => q.prompt),
        ...(current?.model
          ? ["Which assumption changes the result most?", "What is the weakest part of this model?"]
          : [
              ...(openQs.length ? [] : ["What important context is still missing?"]),
              ...(current?.researchSources?.length ? ["Which public evidence matters most here?"] : ["What could you verify from public sources?"]),
            ]),
      ].slice(0, 4)
    : riverSelection && riverSelection.kind !== "all"
      ? [`Why does “${riverSelection.label}” emerge?`, "What would make this branch less likely?"]
      : selectedAnalysis
        ? decisionCurrent
          ? ["What makes the recommended option robust?", "What could reverse this recommendation?"]
          : ["What drives the most likely outcome?", "Which assumption changes this run most?"]
        : ["What will the first run reveal?", "What should I check before running it?"];
  const chatSuggestions = chatFollowUps.length ? chatFollowUps : storedFollowUps.length ? [...storedFollowUps] : contextualSuggestions;
  const openQuestionIds = new Map(openQs.map((q) => [q.prompt, q.id]));

  useEffect(() => { if (current?.status === "completed" && selectedAnalysis) setCenterTab("river"); }, [current?.status, selectedAnalysisId]);

  useEffect(() => {
    setRiverSelection(undefined);
    setWorldReplay(undefined);
    setReplayError("");
  }, [taskId, selectedAnalysisId]);

  useEffect(() => { setChatError(""); }, [taskId]);

  useEffect(() => { setChatFollowUps([]); }, [taskId, assistantMode, selectedAnalysisId, riverSelection?.kind, riverSelection?.label]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [chatMessages.length, chatMutation.isPending, streaming]);

  useEffect(() => {
    const receiveSelection = (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== riverFrame.current?.contentWindow) return;
      const value = event.data as Partial<RiverSelection> & { type?: string };
      if (value.type !== "river:selection" || !["all", "node", "flow"].includes(value.kind ?? "") || typeof value.label !== "string" || !Array.isArray(value.worldIds)) return;
      const worldIds = value.worldIds.filter((id): id is number => Number.isInteger(id) && id >= 0).slice(0, 5_000);
      setRiverSelection({ kind: value.kind as RiverSelection["kind"], label: value.label.slice(0, 180), worldIds });
      setWorldReplay(undefined);
      setReplayError("");
    };
    window.addEventListener("message", receiveSelection);
    return () => window.removeEventListener("message", receiveSelection);
  }, []);

  // World selection → chat context: every branch/node/flow click becomes a pinned chip (like Cursor/Notion canvas chips)
  useEffect(() => {
    if (!riverSelection || riverSelection.kind === "all") return;
    const id = `branch-${riverSelection.kind}:${riverSelection.label}`;
    setPinned((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, { id, kind: "branch" as PinnedKind, label: riverSelection.label, detail: `${riverSelection.worldIds.length} worlds · ${riverSelection.kind}`, meta: { worldIds: riverSelection.worldIds, kind: riverSelection.kind } }].slice(0, 12);
    });
  }, [riverSelection]);

  // Replayed world → also pinnable as specific world context
  useEffect(() => {
    if (!worldReplay) return;
    const id = `world-${worldReplay.index}`;
    setPinned((prev) => {
      if (prev.some((p) => p.id === id)) return prev;
      return [...prev, { id, kind: "world" as PinnedKind, label: `World #${worldReplay.index + 1}`, detail: `${worldReplay.replay.winners.join(", ") || "no winner"} · ${Math.round(worldReplay.replay.cooperation * 100)}% coop`, meta: { index: worldReplay.index } }].slice(0, 12);
    });
  }, [worldReplay]);

  const replaySelectedWorld = async () => {
    const index = riverSelection?.worldIds[0] ?? 0;
    if (!taskId || !selectedAnalysis?.id || !selectedAnalysis.artifactUrl) return;
    setReplayError("");
    try { setWorldReplay(await replayMutation.mutateAsync({ taskId, analysisId: selectedAnalysis.id, index })); }
    catch (error) { setReplayError(error instanceof Error ? error.message : String(error)); }
  };
  const appClass = ["app", hideSituations && "hide-situations", agentPanel && "agent-open", situationsOpen && "mobile-situations"].filter(Boolean).join(" ");
  const assistantTitle = assistantMode === "river" ? "River analyst" : "Context guide";
  const promptTitle = "New situation";
  const promptHint = "Describe the situation in your own words: who is involved, what they want, which choices they have, and what makes it hard. The agent will fill in the rest and ask about anything it cannot infer.";
  const workingLabel = "Reading the situation";
  const workflowRunning = current?.status === "running" || current?.status === "labeling";
  const contextReady = Boolean(current?.situation.trim());
  const modelReady = Boolean(current?.model);
  const contextActive = centerTab === "context";
  const worldsActive = centerTab === "river" || workflowRunning;

  return <div className={appClass}>
    <aside className="pane situations" aria-label="Situations">
      <header className="pane-head"><button className="icon quiet" onClick={toggleSituations} aria-label="Collapse situations panel"><Icon name="collapse" /></button><div className="brand"><span>Situations</span></div><button className="icon primary" onClick={() => setPrompt({ mode: "create", taskId: crypto.randomUUID() })} aria-label="New situation"><Icon name="plus" /></button></header>
      <nav className="tasks">
        {tasks.isPending && <div className="empty-runs">Loading situations…</div>}
        {tasks.isError && <ErrorState error={tasks.error} retry={() => void tasks.refetch()} />}
        {visibleTasks?.map((item) => <WorldRow key={item.id} item={item} now={now} onOpen={() => setSituationsOpen(false)} onDelete={() => removeTask(item)} />)}
        {visibleTasks?.length === 0 && <div className="list-empty"><Icon name="worlds" /><b>No worlds yet</b><span>Create your first situation to begin.</span></div>}
      </nav>
      <footer className="sidebar-footer"><button className="settings-link" onClick={openSettings}><Icon name="settings" /><span>Settings</span></button></footer>
    </aside>

    <main className="river-pane">
      <header className="river-toolbar"><button className="toggle open-situations" aria-pressed={mobile && situationsOpen} onClick={toggleSituations}><Icon name="situations" /><span>Situations</span></button><nav className="stage-switcher" aria-label="Scenario stages">
        <button type="button" className={`${contextActive ? "active" : ""} ${contextReady && !contextActive ? "done" : ""}`} aria-current={contextActive ? "step" : undefined} onClick={() => setCenterTab("context")}><i aria-hidden>{contextReady && !contextActive ? "✓" : "1"}</i><span>Context</span></button><b aria-hidden />
        <button type="button" className={`${centerTab === "model" ? "active" : ""} ${modelReady && centerTab !== "model" ? "done" : ""}`} aria-current={centerTab === "model" ? "step" : undefined} onClick={() => setCenterTab("model")}><i aria-hidden>{modelReady && centerTab !== "model" ? "✓" : "2"}</i><span>Model</span></button><b aria-hidden />
        <button type="button" className={`${worldsActive ? "active" : ""} ${selectedAnalysis && !worldsActive ? "done" : ""}`} aria-current={worldsActive ? "step" : undefined} onClick={() => setCenterTab("river")}><i aria-hidden>{selectedAnalysis && !worldsActive ? "✓" : "3"}</i><span>Worlds{selectedAnalysis ? ` · ${selectedAnalysis.trials}` : ""}</span></button>
      </nav><div className="agent-tools"><button className="icon quiet" onClick={openModel} aria-label="Run settings" disabled={!current}><Icon name="more" /></button><button className="icon quiet" onClick={() => selectedAgent ? setAgentPanel(true) : openSettings()} aria-label="Open assistant"><Icon name="chat" /></button></div></header>

      {centerTab === "context" ? <div className="context-pane">
        {current && <div className="context-workspace">
          <section className="section context-card">
            <div className="section-heading"><div><div className="eyebrow">Context — Model</div><h1>What is happening?</h1></div>{pendingQueue.length>0 && <span className="pending-badge">{pendingQueue.length} suggested</span>}</div>
            {pendingQueue.length>0 && <div className="pending-queue" role="list">
              {pendingQueue.map((item) => <div key={item.id} className="pending-context-banner" role="listitem">
                <div><b>Suggested from chat</b><textarea value={item.edit} onChange={(e) => updatePendingEdit(item.id, e.target.value)} rows={2} style={{width:"100%", marginTop:6, minHeight:48, resize:"vertical", borderRadius:8, border:"1px solid var(--line)", background:"rgba(255,255,255,.03)", color:"var(--ink)", padding:8, fontSize:11}} /><div style={{display:"flex",gap:6, marginTop:6}}><button className="primary" onClick={() => void confirmPendingContext(item.id)} disabled={!item.edit.trim()}>Add to Context</button><button onClick={() => dismissPendingContext(item.id)}>Dismiss</button></div></div>
              </div>)}
              <div style={{display:"flex", gap:6, marginTop:6}}><button className="link-button" onClick={() => setPendingQueue([])}>Dismiss all</button></div>
            </div>}
            <textarea ref={(el) => { (situationInput as React.MutableRefObject<HTMLTextAreaElement | null>).current = el; if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } }} key={`${current.id}:${current.situation}:${pendingQueue.map(p=>p.id).join(",")}`} aria-label="Situation context" defaultValue={current.situation} placeholder="Who is involved, what do they want, and what makes this difficult?" rows={3} disabled={busy} onFocus={(e) => { e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }} onInput={(e) => { e.currentTarget.style.height = "auto"; e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`; }} onBlur={() => { void persistSituation().catch((error) => setRunError(error instanceof Error ? error.message : String(error))); }} />
          </section>
          {!!current.researchSources?.length && <ResearchSources sources={current.researchSources} stale={researchStale} />}
        </div>}
      </div> : centerTab === "model" ? <div className="model-pane">
        {task.isPending && taskId && <div className="empty-runs">Loading situation…</div>}
        {task.isError && !current && <ErrorState error={task.error} retry={() => void task.refetch()} />}
        {!taskId && <div className="empty-runs">Select a situation or create a new one.</div>}
        {current && <div className="model-workspace">
          <section className={`workflow-card ${streaming || buildActive ? "toy" : ""}`} aria-label="Scenario workflow">
            {!streaming && !buildActive && workflowRunning && <div className="workflow-head"><b>{current.status === "labeling" ? "Naming the branches" : "Exploring possible worlds"}</b></div>}
            {!streaming && workflowRunning && <div className="workflow-live"><RiverActivity compact label={current.status === "labeling" ? "Calculation complete" : "Building the worlds"} detail={current.status === "labeling" ? "Pi is adding clear names to the branches" : "Exploring the model with the selected number of worlds"} /></div>}
            {!streaming && !workflowRunning && current.model && situationStale && <p className="workflow-copy">{modelBuildSupported ? "The situation changed. Rebuild the model before running it." : "The situation changed. This imported model cannot be rebuilt by the assistant; update or re-import it before running."}</p>}
            {workflowRunning && <button type="button" className="workflow-cancel" onClick={cancelAnalysis} disabled={busy}>Cancel</button>}
            {(streaming || buildActive) && <button type="button" className="workflow-cancel" onClick={() => void cancelModelBuild()} disabled={commandMutation.isPending || !current.activeBuild}>Cancel model build</button>}
            {!streaming && !buildActive && !workflowRunning && (!current.model || situationStale) && modelBuildSupported && <><fieldset className="model-mode"><legend>Model type</legend><label><input type="radio" name="model-mode" value="decision" checked={modelMode === "decision"} onChange={() => setModelMode("decision")} /><b>Decision comparison</b><span>Compare actions under shared uncertainty</span></label><label><input type="radio" name="model-mode" value="strategic" checked={modelMode === "strategic"} onChange={() => setModelMode("strategic")} /><b>Strategic interaction</b><span>Model repeated C/D reactions between parties</span></label></fieldset><button type="button" className="primary workflow-action" onClick={() => void reviewWithAgent()} disabled={busy || !agentAvailable}>{current.model ? "Rebuild model" : "Build model"}</button></>}
            {buildActivity.length > 0 && (streaming || buildActive || buildFailed || rebuildDone) && <BuildActivity items={buildActivity} active={streaming || buildActive} />}
            {!streaming && !buildActive && !workflowRunning && current.model && !situationStale && <section className="workflow-simulation"><div><span className="eyebrow">Simulation</span><p>Turn the finished model into possible worlds.</p></div><div className="workflow-run"><label><span>Worlds to explore</span><input type="number" min="1" max="5000" step="1" value={trials} disabled={analysisActive} onChange={(event) => { if (Number.isFinite(event.currentTarget.valueAsNumber)) setTrials(event.currentTarget.valueAsNumber); }} onBlur={() => setTrials(Math.min(5000, Math.max(1, Math.round(trials))))} /></label><button type="button" className="primary" onClick={() => void runAnalysis()} disabled={busy}>{selectedAnalysis ? "Run again" : "Run simulation"}</button></div></section>}
            {runError && !streaming && <div className="error" role="alert">{runError}</div>}
          </section>
          {!streaming && !buildActive && current.model && <div className={situationStale ? "model-preview stale" : "model-preview"}>{decisionCurrent ? <DecisionModelReview model={current.model as DecisionModel} onPin={addPin} /> : strategicCurrent ? <StrategicModelReview model={current.model as ScenarioModel} /> : null}</div>}
          {!streaming && !buildActive && current.model && !!current.researchSources?.length && <div className="model-grounding-summary"><span>Grounded by {current.researchSources.length} public source{current.researchSources.length === 1 ? "" : "s"}{researchStale ? " · context changed" : ""}</span><button type="button" className="link-button" onClick={() => setCenterTab("context")}>View in Context</button></div>}
          {streamError && <div className="error model-run-error" role="status">{streamError}</div>}
        </div>}
      </div> : <>
        {selectedAnalysis ? <div className={`river-host ${analysisActive ? "processing" : ""}`}><iframe key={`${selectedAnalysis.visualUrl}:${current?.status}`} ref={riverFrame} className="river-frame" src={`${selectedAnalysis.visualUrl}?embed=1`} title="River of possibilities" />{analysisActive && <div className="river-processing"><RiverActivity label={current?.status === "labeling" ? "Labeling the new river" : "Building a new river"} detail={current?.status === "labeling" ? "The calculation is complete — Pi is adding clear branch names" : "The previous result remains visible while new worlds are calculated"} /></div>}</div> : <div className="river-empty"><div>{analysisActive ? <RiverActivity label={current?.status === "labeling" ? "Labeling the river" : "Building the river"} detail={current?.status === "labeling" ? "Pi is adding clear branch names" : "Exploring possible decisions and reactions"} /> : current ? <><h1>{current.model ? "The model is ready" : "Build the model first"}</h1><p>{current.model ? "Review it if needed, then press Run to create the river." : "Answer any useful questions, then build a model from the context."}</p><button className="primary" onClick={() => setCenterTab("model")}>{current.model ? "Go to Model" : "Build model"}</button></> : <><h1>Worlds begin with a situation</h1><p>Describe it in your own words to begin.</p><button className="primary" onClick={() => setPrompt({ mode: "create", taskId: crypto.randomUUID() })}>New situation</button></>}</div></div>}
        <div className="river-below">
          {selectedAnalysis && !selectedAnalysis.adapter && (worldReplay || riverSelection || outcomeFacts.length > 0 || replayError) && <div className="river-detail">
            {riverSelection && selectedAnalysis.artifactUrl ? <div className="river-tools"><div style={{display:"flex",gap:6,alignItems:"center"}}><button type="button" className="primary" onClick={() => void replaySelectedWorld()} disabled={replayMutation.isPending}>{replayMutation.isPending ? "Replaying…" : `Replay world #${(riverSelection.worldIds[0] ?? 0) + 1}`}</button>{(() => {
              const bid = `branch-${riverSelection.kind}:${riverSelection.label}`;
              const already = pinned.some((p) => p.id === bid);
              return <button type="button" disabled={already} onClick={() => addPin({id:bid,kind:"branch",label:riverSelection.label,detail:`${riverSelection.worldIds.length} worlds · ${riverSelection.kind}`,meta:{worldIds:riverSelection.worldIds, kind: riverSelection.kind}})} title={already ? "Already in chat context" : "Pin this branch to chat"}>{already ? "✓ Pinned" : "Pin to chat"}</button>;
            })()}</div><span className="river-tools-hint">{riverSelection.label}</span></div> : selectedAnalysis.artifactUrl ? <div className="river-tools river-tools-empty"><span>Click a branch in the river to inspect a world</span></div> : null}
            {replayError && <div className="error" role="alert">{replayError}</div>}
            {worldReplay && <WorldReplayCard value={worldReplay} />}
            {taskId && selectedAnalysis?.id && selectedAnalysis.artifactUrl && outcomeFacts.length > 0 && <EvidenceCard taskId={taskId} analysisId={selectedAnalysis.id} trials={selectedAnalysis.trials} outcomeCount={outcomeFacts.length} facts={outcomeFacts} busy={busy} onRemove={(factId) => void runCommand({ tag: "RemoveFact", factId })} />}
            {!worldReplay && !outcomeFacts.length && !replayError && riverSelection && <button type="button" className="link-button river-relabel" onClick={() => void relabelAnalysis()} disabled={relabelPending || analysisActive} title={agentAvailable ? "Regenerate branch labels" : agentStatusText}>{relabelPending ? "Relabeling…" : "Relabel branches"}</button>}
          </div>}
          {current && <RunHistory analyses={analyses} currentRevision={current.revision} selectedAnalysis={selectedAnalysis} collapsed={decisionCurrent} onSelect={onSelectRun} onDelete={(analysis) => void removeAnalysis(analysis)} onRelabel={() => void relabelAnalysis()} relabelPending={relabelPending} relabelDisabled={!selectedAnalysis?.artifactUrl || analysisActive || !agentAvailable} relabelTitle={agentAvailable ? "Regenerate branch labels" : agentStatusText} />}
        </div>
      </>}
    </main>

    {situationsOpen && <button className="mobile-scrim" onClick={() => setSituationsOpen(false)} aria-label="Close side panel" />}

    <div className="toast-region" aria-label="Notifications" aria-live="polite">{pendingDeletes.filter((item) => !item.committing).map((item) => <div className="undo-toast" role="status" key={item.id}><span>{item.kind === "task" ? `World “${item.task.title}” deleted` : `Run with ${item.analysis.trials} ${word(item.analysis.trials, "world", "worlds", "worlds")} deleted`}</span><button onClick={() => undoDelete(item.id)}>Undo</button></div>)}</div>

    <aside className={`agent-drawer ${agentPanel ? "open" : ""}`} aria-label="Pi assistant" aria-hidden={!agentPanel}>
      <header><div><b>{assistantTitle}</b><span>{selectedAgent ? models.find((model) => model.provider === selectedAgent.provider && model.model === selectedAgent.model)?.name ?? selectedAgent.model : agentAvailable ? "No model selected" : "Not configured"}</span></div><button className="icon quiet" onClick={() => setAgentPanel(false)} aria-label="Close assistant"><Icon name="close" /></button></header>
      {!agentAvailable && <div className="agent-drawer-banner" role="status">Agent not configured — <button className="link-button" onClick={openSettings}>open Settings</button> to add an API key.</div>}
      {pendingOutcome && <div className="pending-outcome" role="dialog" aria-label="Confirm outcome fact"><div><b>File as outcome?</b><span>{pendingOutcome.display || pendingOutcome.message.slice(0,180)}</span><small>{pendingOutcome.observation.winner ? `winner: ${String(pendingOutcome.observation.winner)}` : ""}{pendingOutcome.observation.cooperation !== undefined ? ` · coop ${(Number(pendingOutcome.observation.cooperation)*100).toFixed(0)}%` : ""}</small></div><div className="pending-actions"><button onClick={() => setPendingOutcome(null)}>Cancel</button><button className="primary" onClick={() => void confirmPendingOutcome()}>File it</button></div></div>}
      {pendingQueue.length > 0 && <div className="pending-outcome pending-context compact" role="status"><div><b>{pendingQueue.length} context suggestion{pendingQueue.length>1?"s":""} ready</b><small>Chat found new facts for Model Context. Review in Context tab to confirm, edit or dismiss.</small></div><div className="pending-actions"><button onClick={() => setCenterTab("context")}>Review in Context</button><button className="link-button" onClick={() => setPendingQueue([])}>Dismiss all</button></div></div>}
       <div className="chat-messages" ref={chatScroll}>{chatMessages.length ? chatMessages.map((message) => <div className={`chat-entry ${message.role}`} key={message.id}><div className="chat-message"><MarkdownMessage text={message.text} /></div></div>) : <div className="chat-empty">{chatSuggestions.length > 0 && <div className="chat-suggestions">{chatSuggestions.slice(0, 4).map((suggestion) => {
            const qid = openQuestionIds.get(suggestion);
            return qid ? (
              <div key={suggestion} className="chat-suggestion-row"><button type="button" onClick={() => answerQuestion(suggestion)} disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable}>{suggestion}</button><button type="button" className="icon quiet" onClick={() => void runCommand({ tag: "DismissQuestion", questionId: qid })} aria-label="Dismiss question">×</button></div>
            ) : (
              <button type="button" key={suggestion} onClick={() => void handleSuggestion(suggestion)} disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable}>{suggestion}</button>
            );
          })}</div>}</div>}{assistantPending && !streaming && <div className="chat-entry agent pending"><div className="chat-pending"><RiverActivity compact label={assistantMode === "river" ? "Reading the river" : "Checking the context"} detail={assistantMode === "river" ? "Connecting your question to the calculated worlds" : `May check public sources · ${shortTime(chatElapsed)}`} />{assistantMode !== "river" && <button type="button" onClick={() => { chatAbort.current?.abort(); initialGuideAbort.current?.abort(); }}>Cancel</button>}</div></div>}{chatError && <div className="error" role="alert">{chatError}</div>}</div>
      <form className="chat-form" onSubmit={(event) => void submitChat(event)}>{chatMessages.length > 0 && <div className="chat-quick-actions">{chatSuggestions.slice(0, 4).map((suggestion) => {
            const qid = openQuestionIds.get(suggestion);
            return qid ? (
              <div key={suggestion} className="chat-suggestion-row"><button type="button" onClick={() => answerQuestion(suggestion)} disabled={chatMutation.isPending || agentMutation.isPending}>{suggestion}</button><button type="button" className="icon quiet" onClick={() => void runCommand({ tag: "DismissQuestion", questionId: qid })} aria-label="Dismiss">×</button></div>
            ) : (
              <button type="button" key={suggestion} onClick={() => void handleSuggestion(suggestion)} disabled={chatMutation.isPending || agentMutation.isPending}>{suggestion}</button>
            );
          })}</div>}<div className="chat-input-shell">
        {(pinned.length > 0 || pickerOpen) && <div className="chat-pinned-row">
          {pinned.map((item) => <span key={item.id} className="pinned-chip" title={item.detail ?? item.label}><Icon name={pinnedIcon(item.kind as PinnedKind)} /><b>{item.label}</b>{item.detail && <small>{item.detail}</small>}<button type="button" aria-label={`Remove ${item.label}`} onClick={() => removePin(item.id)}>×</button></span>)}
          <button type="button" className="pinned-add" onClick={() => setPickerOpen((v) => !v)} aria-label="Add context"><Icon name="plus" /><span>{pinned.length ? "Add" : "Add context"}</span></button>
        </div>}
        {!pinned.length && !pickerOpen && <button type="button" className="pinned-add pinned-add-empty" onClick={() => setPickerOpen(true)}><Icon name="plus" /><span>Add context</span><small>@ branch · option · factor</small></button>}
        {pickerOpen && <PinnedPicker current={current} riverSelection={riverSelection} pinnedIds={new Set(pinned.map((p) => p.id))} query={pickerQuery} onQuery={setPickerQuery} onPick={(item) => { addPin(item); setPickerOpen(false); setPickerQuery(""); }} onClose={() => setPickerOpen(false)} />}
        <textarea ref={chatInput} name="chat" aria-label="Message the assistant" placeholder={!agentAvailable ? "Configure agent first…" : assistantMode === "river" ? decisionCurrent ? "Ask what makes an option win…" : "Ask about the river or report an outcome…" : "Add context or ask what is missing…"} rows={3} disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } if (event.key === "Backspace" && !event.currentTarget.value && pinned.length) { event.preventDefault(); removePin(pinned[pinned.length - 1]!.id); } if (event.key === "@" && !pickerOpen) setPickerOpen(true); }} onChange={(e) => { if (e.target.value.includes("@")) setPickerOpen(true); }} /><div className="chat-input-footer"><span className="chat-enter-hint">Shift + Enter — new line · @ to add context · Backspace to remove last chip</span></div><button className="chat-send icon" aria-label="Send message" title="Send" disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable}><Icon name="send" /></button></div></form>
    </aside>

    <dialog ref={promptDialog} onClose={() => setPrompt(undefined)}>
      <form className="dialog-form" onSubmit={(event) => void submitPrompt(event)}>
        <h2>{promptTitle}</h2>
        <div><p>{promptHint}</p><textarea name="message" aria-label="Situation description" value={draftText} maxLength={4000} onChange={(event) => { setDraftText(event.target.value); sessionStorage.setItem("flumina-situation-draft", event.target.value); }} autoFocus /><small>{draftText.length} / 4000</small></div>
        {busy && <RiverActivity compact label={workingLabel} detail={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} · you can leave this window open`} />}
        {promptError && <div className="error" role="alert">{promptError}</div>}
        <div className="dialog-actions"><button type="button" onClick={() => setPrompt(undefined)} disabled={promptBusy}>Cancel</button><button className="primary" disabled={promptBusy}>{busy ? "Working…" : "Continue"}</button></div>
      </form>
    </dialog>

    <dialog className="model-dialog" ref={modelDialog}>
      <form className="dialog-form" onSubmit={(event) => void saveModel(event)}><div className="dialog-kicker">Current situation</div><h2>Run settings</h2><p>Parameters for the next run. You can usually leave them unchanged.</p><label className="advanced-field"><span>Next run seed</span><input type="number" name="seed" min="1" max="2147483647" defaultValue={nextSeed} placeholder="Random" /><small>Leave this blank to generate a new seed automatically.</small></label>{modelError &&<div className="error" role="alert">{modelError}</div>}<div className="dialog-actions"><button type="button" onClick={() => modelDialog.current?.close()}>Cancel</button><button className="primary" disabled={commandMutation.isPending}>Save</button></div></form>
    </dialog>

    <dialog className="settings-dialog" ref={settingsDialog}>
      <form className="dialog-form" onSubmit={saveSettings}><header className="settings-header"><h2>Model and access</h2></header><div className="settings-content"><section className="settings-section"><div className="settings-section-title"><b>Default model</b></div><AgentPicker providers={agent.data?.providers ?? []} models={models} value={settingsAgentKey} onChange={setSettingsAgentKey} prefix="Default" />{!models.length && <div className="settings-hint">Add an API key to see available models.</div>}</section><section className="settings-section"><div className="settings-section-title"><b>API keys</b></div><div className="key-entry"><label><span>Provider</span><select aria-label="API key provider" value={keyProvider} onChange={(event) => setKeyProvider(event.target.value)}>{authProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.id === "openai" ? "OpenAI / ChatGPT API" : provider.name}</option>)}</select></label><label><span>API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void configureKey(); } }} placeholder={authProviders.find((provider) => provider.id === keyProvider)?.label ?? "API key"} aria-label="API key" autoComplete="off" spellCheck={false} /></label><button type="button" onClick={() => void configureKey()} disabled={!keyProvider || !apiKey.trim() || keyMutation.isPending}>Add</button></div>{keyError && <div className="error" role="alert">{keyError}</div>}<div className="key-list">{authProviders.filter((provider) => provider.configured).map((provider) => <div className="key-chip" key={provider.id}><i className="dot on" /><span>{provider.name}</span><small>{provider.source === "environment" ? "from environment" : "configured"}</small>{provider.source !== "environment" && <button type="button" className="icon quiet" onClick={() => void deleteKey(provider.id)} aria-label={`Delete ${provider.name} key`}><Icon name="close" /></button>}</div>)}</div></section></div><div className="dialog-actions"><button type="button" onClick={() => settingsDialog.current?.close()}>Cancel</button><button className="primary" disabled={!parseSelection(settingsAgentKey, models)}>Save</button></div></form>
    </dialog>
  </div>;
}

/** One block: what happened (facts) + how it reweights the current run. */
function EvidenceCard({ taskId, analysisId, trials, outcomeCount, facts, busy, onRemove }: { taskId: string; analysisId: string; trials: number; outcomeCount: number; facts: readonly Fact[]; busy: boolean; onRemove: (factId: string) => void }) {
  const posterior = useQuery({ queryKey: ["posterior", taskId, analysisId, outcomeCount], queryFn: () => getPosterior(taskId, analysisId) });
  const base = posterior.data?.baseline, post = posterior.data?.posterior, usesTeams = posterior.data?.usesTeams;
  const baseWin = base && (usesTeams ? base.winPctTeam : base.winPct);
  const postWin = post && (usesTeams ? post.winPctTeam : post.winPct);
  if (!base || !post || !baseWin || !postWin) {
    return <section className="observed" aria-label="What already happened">
      <div className="observed-head"><div><small>What already happened</small><b>{outcomeCount} {word(outcomeCount, "fact", "facts", "facts")}</b></div></div>
      <ul className="fact-list">{facts.map((fact) => <li key={fact.id} className="fact outcome"><span className="fact-text">{fact.text}</span><button type="button" className="fact-remove" disabled={busy} aria-label={`Remove: ${fact.text}`} onClick={() => onRemove(fact.id)}>×</button></li>)}</ul>
    </section>;
  }
  return <section className="observed" aria-label="The run given what happened">
    <div className="observed-head"><div><small>Given what already happened</small><b>{outcomeCount} {word(outcomeCount, "fact", "facts", "facts")} applied to this run</b></div></div>
    <ul className="fact-list compact">{facts.map((fact) => <li key={fact.id} className="fact outcome"><span className="fact-text">{fact.text}</span><button type="button" className="fact-remove" disabled={busy} aria-label={`Remove: ${fact.text}`} onClick={() => onRemove(fact.id)}>×</button></li>)}</ul>
    <div className="observed-result">
      <div className="observed-stats"><div><small>Worlds that match</small><b>{Math.round(post.effectiveSampleSize)} / {trials}</b></div><div><small>Cooperation</small><b>{Math.round(base.cooperation.mean * 100)}% → {Math.round(post.cooperation.mean * 100)}%</b></div></div>
      {post.fit < 0.05 && <div className="observed-note">Unlikely under the current model ({Math.round(post.fit * 100)}% fit) — check the model assumptions.</div>}
      <div className="observed-bars">{Object.keys(postWin).sort((a, b) => (postWin[b] ?? 0) - (postWin[a] ?? 0)).map((name) => <div className="observed-row" key={name}><span className="observed-name">{name}</span><span className="observed-bar"><i style={{ width: `${postWin[name] ?? 0}%` }} /></span><span className="observed-num">{Math.round(baseWin[name] ?? 0)}→{Math.round(postWin[name] ?? 0)}%</span></div>)}</div>
    </div>
  </section>;
}

function WorldReplayCard({ value }: { value: WorldReplay }) {
  const trace = value.replay.trace;
  const rounds = trace?.rounds ?? [];
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => { setCursor(0); setPlaying(false); }, [value.worldId]);
  useEffect(() => {
    if (!playing || rounds.length < 2) return;
    const timer = window.setInterval(() => setCursor((current) => {
      if (current >= rounds.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 550);
    return () => window.clearInterval(timer);
  }, [playing, rounds.length]);
  const frame = rounds[cursor];
  return <section className="world-replay" aria-label={`Replay world ${value.index + 1}`}>
    <div className="replay-title"><div><small>World #{value.index + 1}</small><b>{trace ? `${trace.a} ↔ ${trace.b}` : "Exited the interaction"}</b></div><span className={value.exact ? "exact" : "mismatch"}>{value.exact ? "exact match" : "result differs"}</span></div>
    {frame && trace ? <><div className="replay-round"><span><small>{trace.a}</small><strong className={frame.moveA === "C" ? "cooperate" : "defect"}>{frame.moveA}</strong><i>{frame.scoreA.toFixed(1)}</i></span><em>round {frame.round} / {trace.totalRounds}</em><span><small>{trace.b}</small><strong className={frame.moveB === "C" ? "cooperate" : "defect"}>{frame.moveB}</strong><i>{frame.scoreB.toFixed(1)}</i></span></div><div className="replay-controls"><button type="button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Pause" : "Play"}>{playing ? "Pause" : "▶"}</button><input type="range" min="0" max={Math.max(0, rounds.length - 1)} value={cursor} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)); }} aria-label="Replay round" /></div>{trace.truncated && <small className="replay-note">The beginning and end of a long match are shown; the exact result was verified using the full calculation.</small>}</> : <p>The parties did not enter a key match in this world.</p>}
  </section>;
}

function BuildActivity({ items, active }: { items: BuildActivityItem[]; active: boolean }) {
  const failed = items.some((item) => item.status === "failed");
  return <section className="model-build-report" aria-label="Live model build" aria-live="polite">
    <div className="model-build-report-head"><span>{failed ? "Model build stopped" : active ? "Working on the model" : "Model build complete"}</span></div>
    <ol>
      {items.map((item) => <li className={item.status} key={item.id}><i aria-hidden>{item.status === "done" ? "✓" : item.status === "failed" ? "!" : ""}</i><span>{item.message}</span></li>)}
    </ol>
  </section>;
}

function StrategicModelReview({ model }: { model: ScenarioModel }) {
  const range = (value: readonly [number, number]) => value[0] === value[1] ? String(value[0]) : `${value[0]}–${value[1]}`;
  const sharedPayoffs = "T" in model.payoffs && Array.isArray(model.payoffs.T)
    ? model.payoffs as { T: readonly [number, number]; R: readonly [number, number]; P: readonly [number, number]; S: readonly [number, number] }
    : undefined;
  return <section className="decision-model strategic-model" aria-label="Strategic interaction model review">
    <header><div><span className="eyebrow">Strategic interaction{model.timeframe ? ` · ${model.timeframe}` : ""}</span><h2>{model.situation}</h2></div><div className="decision-objective"><small>Repeated game</small><b>{(model.game ?? "prisoners_dilemma").replaceAll("_", " ")}</b><span>continuation {range(model.structure.w)}</span></div></header>
    <p className="model-caveat">Payoffs and behavior ranges are inspectable scenario assumptions, not measured probabilities. Check the material assumptions before running.</p>
    <div className="decision-model-grid"><section><h3>Parties and dispositions</h3><ol>{model.players.map((player) => <li key={player.name}><b>{player.name}</b><span>{player.dispositions.join(" · ")}</span>{player.note && <small>{player.note}</small>}</li>)}</ol></section><section><h3>Interaction</h3><ul><li><b>Continuation</b><span>{range(model.structure.w)}</span><small>chance of another round</small></li><li><b>Action noise</b><span>{range(model.structure.noise)}</span><small>chance an intended action flips</small></li>{sharedPayoffs && <li><b>Shared payoffs</b><span>T {range(sharedPayoffs.T)} · R {range(sharedPayoffs.R)} · P {range(sharedPayoffs.P)} · S {range(sharedPayoffs.S)}</span></li>}</ul></section></div>
    {model.rationale && <details><summary>Material assumptions · {Object.keys(model.rationale).length}</summary><ul>{Object.entries(model.rationale).map(([label, value]) => <li key={label}><b>{label}</b><span>{value}</span></li>)}</ul></details>}
  </section>;
}

function DecisionModelReview({ model, onPin }: { model: DecisionModel; onPin?: (p: PinnedContext) => void }) {
  const range = (value: readonly [number, number]) => value[0] === value[1] ? String(value[0]) : `${value[0]}–${value[1]}`;
  const effect = (value: readonly [number, number] | undefined) => !value ? "—" : `${value[0] > 0 ? "+" : ""}${range(value)}`;
  return <section className="decision-model" aria-label="Decision model review">
    <header><div><span className="eyebrow">Decision model{model.timeframe ? ` · ${model.timeframe}` : ""}</span><h2>{model.question}</h2></div><div className="decision-objective"><small>{model.objective.direction === "minimize" ? "Minimize" : "Maximize"}</small><b>{model.objective.label}</b>{model.objective.target !== undefined && <span>target {model.objective.target}{model.objective.unit ? ` ${model.objective.unit}` : ""}</span>}</div></header>
    <p className="model-caveat">Ranges and effects are inspectable scenario assumptions, not measured forecasts. Public sources support only the claims they explicitly state.</p>
    <div className="decision-model-grid"><section><h3>Options</h3><ol>{model.options.map((option) => <li key={option.id}><b>{option.label}</b><span>{option.description}</span><small>midpoint outcome {range(option.baseline)}{model.objective.unit ? ` ${model.objective.unit}` : ""}</small>{onPin && <button className="link-button" onClick={() => onPin({id:`option-${option.id}`,kind:"option",label:option.label,detail:option.description})}>Pin to chat</button>}</li>)}</ol></section><section><h3>Shared uncertainties</h3><ul>{model.factors.map((factor) => <li key={factor.id}><b>{factor.label}</b><span>{range(factor.range)}</span><small>{factor.lowLabel} ↔ {factor.highLabel}</small>{onPin && <button className="link-button" onClick={() => onPin({id:`factor-${factor.id}`,kind:"factor",label:factor.label,detail:`${range(factor.range)} · ${factor.lowLabel} ↔ ${factor.highLabel}`})}>Pin to chat</button>}</li>)}</ul></section></div>
    <details className="decision-effects"><summary>How options respond</summary><p>Objective change at each factor’s high end; the low end applies the opposite change.</p><div><table><thead><tr><th>Option</th>{model.factors.map((factor) => <th key={factor.id}>{factor.highLabel || factor.label}</th>)}</tr></thead><tbody>{model.options.map((option) => <tr key={option.id}><th>{option.label}</th>{model.factors.map((factor) => <td key={factor.id}>{effect(option.effects.find((item) => item.factorId === factor.id)?.impact)}{model.objective.unit ? ` ${model.objective.unit}` : ""}</td>)}</tr>)}</tbody></table></div></details>
    {!!model.assumptions.length && <details><summary>Material assumptions · {model.assumptions.length}</summary><ul>{model.assumptions.map((assumption, index) => <li key={index}><span>{assumption}</span>{onPin && <button className="link-button" onClick={() => onPin({id:`assump-${index}`,kind:"assumption",label:assumption.slice(0,40),detail:assumption})}>Pin</button>}</li>)}</ul></details>}
  </section>;
}

function QuestionList({ questions, stale, busy, onAnswer, onDismiss }: { questions: TaskState["openQuestions"]; stale: boolean; busy: boolean; onAnswer: (prompt: string) => void; onDismiss: (id: string) => void }) {
  return <>
    {stale && <div className="question-stale-note">Context changed — rebuild to refresh</div>}
    <ul className={`question-list ${stale ? "stale" : ""}`}>{questions.map((question) => <li key={question.id} className="question">
      <div className="question-head"><span className="question-prompt">{question.prompt}</span></div>
      <div className="question-actions"><button type="button" onClick={() => onAnswer(question.prompt)} disabled={busy}>Answer</button><button type="button" onClick={() => onDismiss(question.id)} disabled={busy}>Skip</button></div>
    </li>)}</ul>
  </>;
}

function ResearchSources({ sources, stale, onPin }: { sources: NonNullable<TaskState["researchSources"]>; stale: boolean; onPin?: (p: PinnedContext) => void }) {
  return <section className={`section context-sources ${stale ? "stale" : ""}`} aria-label="Public research sources">
    <div className="fact-group-label">Found in public sources <span>{sources.length}{stale ? " · context changed" : " · used as evidence"}</span></div>
    <div className="research-source-list">{sources.map((source) => <details key={source.id}><summary><span>{source.title}</span><small>{sourceKind(source.url)} · {fieldLabel(source.field) || new URL(source.url).hostname} · {new Date(source.fetchedAt).toLocaleDateString("en-US")}</small></summary><p>{source.excerpt || source.purpose}</p><div style={{display:"flex",gap:6,marginTop:6}}><a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a>{onPin && <button className="link-button" onClick={() => onPin({id:`source-${source.id}`,kind:"source",label:source.title,detail:source.excerpt.slice(0,120)})}>Pin to chat</button>}</div></details>)}</div>
  </section>;
}


function PinnedPicker({ current, riverSelection, pinnedIds, query, onQuery, onPick, onClose }: { current?: TaskState; riverSelection?: RiverSelection; pinnedIds: Set<string>; query: string; onQuery: (v: string) => void; onPick: (p: PinnedContext) => void; onClose: () => void }) {
  const candidates: PinnedContext[] = [];
  if (riverSelection) candidates.push({ id: `branch-${riverSelection.label}`, kind: "branch", label: riverSelection.label, detail: `${riverSelection.worldIds.length} worlds` });
  const model = current?.model as unknown as DecisionModel | undefined;
  if (model && "adapter" in (model as any) && (model as any).adapter === "decision") {
    for (const o of model.options) candidates.push({ id: `option-${o.id}`, kind: "option", label: o.label, detail: o.description?.slice(0,80) });
    for (const f of model.factors) candidates.push({ id: `factor-${f.id}`, kind: "factor", label: f.label, detail: `${f.lowLabel} ↔ ${f.highLabel}` });
    for (let i = 0; i < (model.assumptions?.length ?? 0); i++) candidates.push({ id: `assump-${i}`, kind: "assumption", label: (model.assumptions[i] ?? "").slice(0,40), detail: model.assumptions[i] });
  }
  for (const s of current?.researchSources ?? []) candidates.push({ id: `source-${s.id}`, kind: "source", label: s.title.slice(0,40), detail: s.excerpt.slice(0,80) });
  for (const f of (current?.facts ?? []).filter((f) => f.kind === "outcome").slice(-6)) candidates.push({ id: `fact-${f.id}`, kind: "fact", label: f.text.slice(0,40), detail: f.text.slice(0,80) });
  const q = query.trim().toLowerCase();
  const filtered = q ? candidates.filter((c) => c.label.toLowerCase().includes(q) || (c.detail ?? "").toLowerCase().includes(q)) : candidates;
  const visible = filtered.slice(0, 12);
  return <div className="pinned-picker" role="dialog" aria-label="Add context">
    <div className="pinned-picker-head"><input autoFocus placeholder="Search branch, option, factor…" value={query} onChange={(e) => onQuery(e.target.value)} /><button className="icon quiet" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
    <div className="pinned-picker-list">{visible.length ? visible.map((c) => <button key={c.id} type="button" className="pinned-picker-item" disabled={pinnedIds.has(c.id)} onClick={() => onPick(c)}><span className="pick-icon"><Icon name={pinnedIcon(c.kind as PinnedKind)} /></span><span className="pick-label"><b>{c.label}</b><small>{c.kind} · {c.detail?.slice(0,60)}</small></span>{pinnedIds.has(c.id) && <small>pinned</small>}</button>) : <div className="pinned-picker-empty">No matches — try “option” or “demand”</div>}</div>
    <div className="pinned-picker-foot"><small>{candidates.length} pinnable · pick several and keep chatting</small></div>
  </div>;
}

function AgentPicker({ providers, models, value, onChange, prefix }: { providers: Array<{ id: string; name: string }>; models: ModelOption[]; value: string; onChange: (value: string) => void; prefix: string }) {
  const selection = parseSelection(value, models) ?? (models[0] ? parseSelection(selectionValue({ provider: models[0].provider, model: models[0].model, thinkingLevel: "medium" }), models) : undefined);
  const providerModels = selection ? models.filter((model) => model.provider === selection.provider) : [];
  const model = selection ? models.find((item) => item.provider === selection.provider && item.model === selection.model) : undefined;
  const levels = model ? levelsFor(model) : [];
  const chooseModel = (next: ModelOption, preferred: AgentSelection["thinkingLevel"] = selection?.thinkingLevel ?? "medium") => {
    const supported = levelsFor(next);
    const thinkingLevel = supported.includes(preferred) ? preferred : supported.includes("medium") ? "medium" : supported[0] ?? "off";
    onChange(selectionValue({ provider: next.provider, model: next.model, thinkingLevel }));
  };
  return <div className="agent-picker-grid">
    <label><span>Provider</span><select aria-label={`${prefix}: provider`} value={selection?.provider ?? ""} disabled={!models.length} onChange={(event) => { const first = models.find((item) => item.provider === event.target.value); if (first) chooseModel(first, "medium"); }}>{[...new Set(models.map((item) => item.provider))].map((id) => { const provider = providers.find((item) => item.id === id); return <option key={id} value={id}>{provider?.name ?? id}</option>; })}</select></label>
    <label><span>Model</span><select aria-label={`${prefix}: model`} value={selection?.model ?? ""} disabled={!providerModels.length} onChange={(event) => { const next = providerModels.find((item) => item.model === event.target.value); if (next) chooseModel(next); }}>{providerModels.map((item) => <option key={item.model} value={item.model}>{item.name || item.model}</option>)}</select></label>
    <label><span>Reasoning</span><select aria-label={`${prefix}: reasoning level`} value={selection?.thinkingLevel ?? "off"} disabled={!levels.length || levels.length === 1} onChange={(event) => { if (selection) onChange(selectionValue({ ...selection, thinkingLevel: event.target.value as AgentSelection["thinkingLevel"] })); }}>{levels.map((level) => <option key={level} value={level}>{thinkingName[level]}</option>)}</select></label>
  </div>;
}

function WorldRow({ item, now, onOpen, onDelete }: { item: TaskSummary; now: number; onOpen: () => void; onDelete: () => void }) {
  return <div className="task-row"><Link to="/tasks/$taskId" params={{ taskId: item.id }} search={{}} className="task" activeProps={{ "aria-current": "page" }} onClick={onOpen}><b className="task-title">{item.title}</b><div className="task-meta"><span><i className={`status-dot ${item.status}`} />{statusName[item.status]}</span><time dateTime={item.updatedAt} title={compactDate(item.updatedAt)}>{relativeTime(item.updatedAt, now)}</time></div></Link><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete world “${item.title}”`}><Icon name="trash" /></button></div>;
}

function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="load-error" role="alert"><span>{error.message}</span><button onClick={retry}>Retry</button></div>;
}

function RunHistory({ analyses, currentRevision, selectedAnalysis, collapsed, onSelect, onDelete, onRelabel, relabelPending, relabelDisabled, relabelTitle }: { analyses: TaskState["analyses"]; currentRevision: number; selectedAnalysis?: TaskState["analyses"][number]; collapsed: boolean; onSelect: (id: string) => void; onDelete: (analysis: TaskState["analyses"][number]) => void; onRelabel?: () => void; relabelPending?: boolean; relabelDisabled?: boolean; relabelTitle?: string }) {
  const runs = uniqueRuns(analyses);
  if (!runs.length) return <section className="section"><div className="section-heading"><div className="eyebrow">Runs</div></div><div className="runs-empty"><span className="runs-empty-icon"><Icon name="runs" /></span><b>No runs yet</b><span>Run the model to see the river.</span></div></section>;
  if (collapsed) {
    const list = <div className="runs">{runs.map((analysis) => <RunCard key={analysisKey(analysis)} analysis={analysis} selected={Boolean(selectedAnalysis && analysisKey(analysis) === analysisKey(selectedAnalysis))} onClick={() => onSelect(analysisKey(analysis))} onDelete={() => onDelete(analysis)} />)}</div>;
    return <details className="section runs-history"><summary>Saved runs <span>{runs.length}</span></summary>{list}</details>;
  }
  const fresh = runs.filter((a) => a.revision === currentRevision);
  const outdated = runs.filter((a) => a.revision !== currentRevision);
  const freshList = <div className="runs">{(fresh.length ? fresh : runs.slice(0, 3)).map((analysis) => <RunCard key={analysisKey(analysis)} analysis={analysis} selected={Boolean(selectedAnalysis && analysisKey(analysis) === analysisKey(selectedAnalysis))} onClick={() => onSelect(analysisKey(analysis))} onDelete={() => onDelete(analysis)} />)}</div>;
  return <section className="section">
    <div className="section-heading"><div className="eyebrow">Runs</div><span>{runs.length}</span></div>
    {freshList}
    {outdated.length > 0 && <details className="runs-history-inline"><summary>Outdated · {outdated.length}</summary><div className="runs">{outdated.map((analysis) => <RunCard key={analysisKey(analysis)} analysis={analysis} selected={Boolean(selectedAnalysis && analysisKey(analysis) === analysisKey(selectedAnalysis))} onClick={() => onSelect(analysisKey(analysis))} onDelete={() => onDelete(analysis)} />)}</div></details>}
    {fresh.length === 0 && outdated.length > 0 && <div className="runs-stale-hint">Model changed — run again to update.</div>}
    {onRelabel && <div className="runs-advanced"><button type="button" className="link-button" onClick={onRelabel} disabled={relabelPending || relabelDisabled} title={relabelTitle}>{relabelPending ? "Relabeling…" : "Relabel branches"}</button></div>}
  </section>;
}

function RunCard({ analysis, selected, onClick, onDelete }: { analysis: TaskState["analyses"][number]; selected: boolean; onClick: () => void; onDelete: () => void }) {
  const board = Object.keys(analysis.winPctTeam).length < Object.keys(analysis.winPct).length ? analysis.winPctTeam : analysis.winPct;
  const leader = Object.entries(board).sort((a, b) => b[1] - a[1])[0];
  if (analysis.decision) return <div className="run-row"><button className="run-item decision-run" aria-current={selected} onClick={onClick}><div className="run-top"><b>{analysis.decision.recommendedOptionLabel ?? leader?.[0] ?? "Decision run"}</b><span>{compactDate(analysis.completedAt)}</span></div><div className="run-footer"><span>{analysis.trials} worlds</span><span>r{analysis.revision}</span></div></button><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete run with ${analysis.trials} worlds`}><Icon name="trash" /></button></div>;
  return <div className="run-row"><button className="run-item" aria-current={selected} onClick={onClick}><div className="run-top"><b>{leader ? `${leader[0]} · ${Math.round(leader[1])}%` : `${analysis.trials} worlds`}</b><span>{compactDate(analysis.completedAt)}</span></div><div className="run-footer"><span>{analysis.trials} worlds · r{analysis.revision}</span><span>seed {analysis.seed}</span></div></button><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete run with ${analysis.trials} worlds`}><Icon name="trash" /></button></div>;
}
