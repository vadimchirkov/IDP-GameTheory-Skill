import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  chatTask, clarifyTask, confirmOutcome, createTask, getAgentStatus, getPosterior, getTask, getTasks, getWorldReplay, relabelTask, removeProviderKey, runTask, saveProviderKey, sendCommand, understandTask, understandTaskStream,
  type AgentMode, type AgentModelStatus, type AgentSelection, type FactCommand, type RiverSelection, type TaskState, type TaskSummary, type WorldReplay,
} from "./api";
import { OutcomeFacts } from "./facts";
import { ModelForm } from "./model-form";
import { RiverActivity } from "./river-activity";
import { SpatialPrisonersDilemma } from "./spatial-prisoners-dilemma";
import { relativeTime } from "./relative-time";

const statusName = { ready: "Ready", running: "Running", labeling: "Labeling", completed: "Complete", failed: "Failed", building: "Building", new: "New" } as const;
type PromptState = { mode: "create" };
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

function Icon({ name }: { name: "collapse" | "worlds" | "situations" | "runs" | "settings" | "plus" | "more" | "trash" | "chat" | "close" | "edit" | "refresh" | "search" | "send" }) {
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
  };
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function compactDate(value?: string) {
  return value ? new Date(value).toLocaleString("en-US", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
}

function word(count: number, one: string, few: string, many: string) {
  const lastTwo = count % 100, last = count % 10;
  return lastTwo >= 11 && lastTwo <= 14 ? many : last === 1 ? one : last >= 2 && last <= 4 ? few : many;
}

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
  const [draftText, setDraftText] = useState("");
  const [promptError, setPromptError] = useState("");
  const [runError, setRunError] = useState("");
  const [rebuildDone, setRebuildDone] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [modelBuildStage, setModelBuildStage] = useState(0);
  const [buildActivity, setBuildActivity] = useState<BuildActivityItem[]>([]);
  const [streamError, setStreamError] = useState("");
  const [modelError, setModelError] = useState("");
  const [nextSeed, setNextSeed] = useState<number>();
  const [agentKey, setAgentKey] = useState(savedSelection);
  const [runAgentKey, setRunAgentKey] = useState("");
  const [settingsAgentKey, setSettingsAgentKey] = useState("");
  const [keyProvider, setKeyProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [agentPanel, setAgentPanel] = useState(() => {
    const saved = localStorage.getItem("pane-agent");
    return saved ? saved === "open" : window.matchMedia("(min-width: 901px)").matches;
  });
  const [relabelPending, setRelabelPending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [riverSelection, setRiverSelection] = useState<RiverSelection>();
  const [worldReplay, setWorldReplay] = useState<WorldReplay>();
  const [replayError, setReplayError] = useState("");
  const [trials, setTrials] = useState(600);
  const [pendingDeletes, setPendingDeletes] = useState<PendingDelete[]>([]);
  const promptDialog = useRef<HTMLDialogElement>(null);
  const modelDialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const settingsPrompted = useRef(false);
  const deleteTimers = useRef(new Map<string, number>());
  const riverFrame = useRef<HTMLIFrameElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const tasks = useQuery({ queryKey: ["tasks"], queryFn: getTasks });
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => getTask(taskId!), enabled: Boolean(taskId) });
  const agent = useQuery({ queryKey: ["agent-status"], queryFn: getAgentStatus, retry: 0 });
  const current = task.data;
  const assistantMode: AgentMode = !current?.model || centerTab === "context" ? "context" : centerTab === "model" ? "model" : "river";
  const chatMessages = current?.messages ?? [];

  useEffect(() => {
    const first = tasks.data?.[0];
    if (!taskId && first) void navigate({ to: "/tasks/$taskId", params: { taskId: first.id }, replace: true });
  }, [navigate, taskId, tasks.data]);

  useEffect(() => {
    setNextSeed(undefined);
    setRunError("");
    setModelBuildStage(1);
    setBuildActivity([]);
    setStreaming(false);
    setRebuildDone(false);
    setTrials(current?.analyses.at(-1)?.trials ?? 600);
    setCenterTab(current?.analyses.length ? "river" : current?.model ? "model" : "context");
  }, [taskId, current?.id]);

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
    setModelBuildStage(build.stage === "frame" ? 0 : build.stage === "draft" ? 1 : 2);
    setBuildActivity([{ id: build.buildId, stage: build.stage, message: build.error ?? build.message, status: build.status === "failed" ? "failed" : "active" }]);
  }, [current?.activeBuild?.buildId, current?.activeBuild?.stage, current?.activeBuild?.message, current?.activeBuild?.status, current?.activeBuild?.error, current?.activeBuild?.updatedAt, streaming]);

  useEffect(() => {
    const dialog = promptDialog.current;
    if (prompt) openDialog(dialog);
    if (!prompt && dialog?.open) dialog.close();
  }, [prompt]);

  useEffect(() => { setDraftText(""); setPromptError(""); }, [prompt]);

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

  const createMutation = useMutation({ mutationFn: createTask });
  const commandMutation = useMutation({ mutationFn: ({ id, value }: { id: string; value: FactCommand }) => sendCommand(id, value) });
  const agentMutation = useMutation({ mutationFn: ({ id }: { id: string }) => understandTask(id, selectedAgent) });
  // keep agentMutation for fallback non-stream calls; streaming uses understandTaskStream directly
  const keyMutation = useMutation({ mutationFn: ({ provider, key }: { provider: string; key?: string }) => key ? saveProviderKey(provider, key) : removeProviderKey(provider) });
  // The chat is the conversational way in: the agent answers questions and files facts itself, so the
  // user never has to decide which box a sentence belongs in.
  const chatMutation = useMutation({
    mutationFn: async (vars: { message: string }) => {
      if (!taskId) throw new Error("Open a situation first");
      const routed = assistantMode === "river"
        ? await chatTask(taskId, vars.message, selectedAgent)
        : await clarifyTask(taskId, { message: vars.message, mode: assistantMode, agent: selectedAgent }).catch((error: unknown) => {
          // A running pre-upgrade server has no /clarify route yet; keep context prompts usable.
          if (error instanceof Error && error.message === "Not found") return chatTask(taskId, vars.message, selectedAgent);
          throw error;
        });
      if (routed.task) cacheTask(routed.task);
      return routed;
    },
  });
  const replayMutation = useMutation({ mutationFn: ({ taskId, analysisId, index }: { taskId: string; analysisId: string; index: number }) => getWorldReplay(taskId, analysisId, index) });
  const buildActive = current?.activeBuild?.status === "running" || current?.status === "building";
  const buildFailed = buildActivity.some((item) => item.status === "failed");
  const busy = createMutation.isPending || commandMutation.isPending || agentMutation.isPending || streaming || buildActive;
  const promptBusy = busy;
  const elapsed = useElapsed(busy);

  const cacheTask = (value: TaskState) => {
    queryClient.setQueryData(["task", value.id], value);
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
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
    if (!agentAvailable) { setRunError(agentStatusText); openSettings(); return; }
    setRunError("");
    setRebuildDone(false);
    setModelBuildStage(1);
    setBuildActivity([]);
    setStreaming(true);
    setCenterTab("model");
    const advanceStage = (ev: Record<string, unknown>) => {
      const stage = String(ev.stage ?? "");
      const index = stage === "frame" || stage === "research-plan" || stage === "research" ? 0
        : stage === "draft" ? 1
          : stage === "validate" || stage === "review" || stage === "repair" ? 2
            : stage === "smoke" || stage === "check" || stage === "save" ? 3
              : 1;
      setModelBuildStage(index);
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
        task = await understandTaskStream(id, selectedAgent, advanceStage);
      } catch (e) {
        // If streaming not available, fallback
        if (!String(e).includes("Streaming not supported")) throw e;
        task = await agentMutation.mutateAsync({ id });
      }
      cacheTask(task);
      if (selectedAgent) { const value = selectionValue(selectedAgent); saveSelection(value, models); setAgentKey(value); }
      setRebuildDone(true);
      window.setTimeout(() => setRebuildDone(false), 4000);
    } catch (error) {
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
      const created = await createMutation.mutateAsync(text);
      cacheTask(created);
      setPrompt(undefined);
      await navigate({ to: "/tasks/$taskId", params: { taskId: created.id } });
      setAgentPanel(true);
      if (agentAvailable) {
        const guided = await clarifyTask(created.id, { mode: "context", agent: selectedAgent });
        cacheTask(guided.task);
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
    setRunAgentKey(selectedAgent ? selectionValue(selectedAgent) : agentKey);
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
      const result = await chatMutation.mutateAsync({ message });
      if ((result as unknown as { pendingOutcome?: { observation: Record<string, unknown>; display: string } }).pendingOutcome) {
        const pending = (result as unknown as { pendingOutcome: { observation: Record<string, unknown>; display: string } }).pendingOutcome;
        setPendingOutcome({ message, observation: pending.observation, display: pending.display });
      }
    } catch (error) { setChatError(error instanceof Error ? error.message : String(error)); }
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

  const handleSuggestion = (suggestion: string) => {
    if (suggestion === "Rebuild model from new situation") {
      setAgentPanel(false);
      setCenterTab("model");
      void reviewWithAgent();
      return;
    }
    void sendChatMessage(suggestion);
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
      if (runAgentKey) { setAgentKey(runAgentKey); saveSelection(runAgentKey, models); }
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
  // Only outcome facts are evidence. Journals written before the redesign still carry situation facts,
  // and the engine ignores them — so the workspace must not count or list them as things that happened.
  const outcomeFacts = (current?.facts ?? []).filter((fact) => fact.kind === "outcome");
  const situationStale = Boolean(current?.model && current.situation.trim() && current.model.situation.trim() !== current.situation.trim());
  const chatSuggestions = assistantMode === "context"
    ? []
    : assistantMode === "model"
      ? ["Which assumptions should I review?", "What could change the result most?"]
      : riverSelection && riverSelection.kind !== "all"
    ? ["Why did this branch emerge?", "How do these worlds differ from the rest?", "How can I change this branch's probability?"]
    : selectedAnalysis
      ? ["Explain the main result", "What changes the outcome most?", "How do I tell you what actually happened?"]
      : ["What can I learn after the first run?"];

  useEffect(() => { if (current?.status === "completed" && selectedAnalysis) setCenterTab("river"); }, [current?.status, selectedAnalysisId]);

  useEffect(() => {
    setRiverSelection(undefined);
    setWorldReplay(undefined);
    setReplayError("");
  }, [taskId, selectedAnalysisId]);

  useEffect(() => { setChatError(""); }, [taskId]);

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

  const replaySelectedWorld = async () => {
    const index = riverSelection?.worldIds[0] ?? 0;
    if (!taskId || !selectedAnalysis?.id || !selectedAnalysis.artifactUrl) return;
    setReplayError("");
    try { setWorldReplay(await replayMutation.mutateAsync({ taskId, analysisId: selectedAnalysis.id, index })); }
    catch (error) { setReplayError(error instanceof Error ? error.message : String(error)); }
  };
  const appClass = ["app", hideSituations && "hide-situations", agentPanel && "agent-open", situationsOpen && "mobile-situations"].filter(Boolean).join(" ");
  const assistantTitle = assistantMode === "context" ? "Context guide" : assistantMode === "model" ? "Model copilot" : "River analyst";
  const assistantHint = assistantMode === "model"
      ? "Discuss assumptions here; rebuild explicitly when the context changes."
      : assistantMode === "river" ? "Ask about branches or tell me what actually happened." : "";
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
      <header className="pane-head"><button className="icon quiet" onClick={toggleSituations} aria-label="Collapse situations panel"><Icon name="collapse" /></button><div className="brand"><span>Situations</span></div><button className="icon primary" onClick={() => setPrompt({ mode: "create" })} aria-label="New situation"><Icon name="plus" /></button></header>
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
            <div className="section-heading"><div><div className="eyebrow">Context</div><h1>What is happening?</h1></div></div>
            <p className="context-intro">Describe the situation in your own words. The assistant will turn it into explicit assumptions and ask about anything that matters.</p>
            <textarea key={`${current.id}:${current.situation}`} aria-label="Situation context" defaultValue={current.situation} placeholder="Who is involved, what do they want, and what makes this difficult?" rows={9} disabled={busy} onBlur={(event) => { const text = event.currentTarget.value.trim(); if (text && text !== current.situation.trim()) void runCommand({ tag: "SetSituation", text }); }} />
          </section>
          {!!current.researchSources?.length && <ResearchSources sources={current.researchSources} />}
          {current.openQuestions.length > 0 && <section className="section context-questions questions">
            <div className="fact-group-label">Needs your input <span>these require your judgment or a choice</span></div>
            <ul className="question-list">
              {current.openQuestions.map((question) => <li key={question.id} className="question"><div className="question-head"><span className="question-prompt">{question.prompt}{question.field && <span className="question-field">→ {question.field}</span>}</span><button type="button" className="question-dismiss" disabled={busy} aria-label={`Dismiss: ${question.prompt}`} onClick={() => void runCommand({ tag: "DismissQuestion", questionId: question.id })}>×</button></div></li>)}
            </ul>
          </section>}
        </div>}
      </div> : centerTab === "model" ? <div className="model-pane">
        {task.isPending && taskId && <div className="empty-runs">Loading situation…</div>}
        {task.isError && <ErrorState error={task.error} retry={() => void task.refetch()} />}
        {!taskId && <div className="empty-runs">Select a situation or create a new one.</div>}
        {current && <div className="model-workspace">
          <section className={`workflow-card ${streaming || buildActive || (current.model && !situationStale && !workflowRunning) ? "toy" : ""}`} aria-label="Scenario workflow">
            {!streaming && !buildActive && workflowRunning && <div className="workflow-head"><b>{current.status === "labeling" ? "Naming the branches" : "Exploring possible worlds"}</b></div>}
            {!streaming && workflowRunning && <div className="workflow-live"><RiverActivity compact label={current.status === "labeling" ? "Calculation complete" : "Building the worlds"} detail={current.status === "labeling" ? "Pi is adding clear names to the branches" : "Exploring the model with the selected number of worlds"} /></div>}
            {!streaming && !workflowRunning && current.model && situationStale && <p className="workflow-copy">The situation changed. Rebuild the model before running it.</p>}
            {workflowRunning && <button type="button" className="workflow-cancel" onClick={cancelAnalysis} disabled={busy}>Cancel</button>}
            {!streaming && !buildActive && !workflowRunning && (!current.model || situationStale) && <button type="button" className="primary workflow-action" onClick={() => void reviewWithAgent()} disabled={busy || !agentAvailable}>{current.model ? "Rebuild model" : "Build model"}</button>}
            {(streaming || buildActive || Boolean(current.model && !situationStale && !workflowRunning)) && <div className="workflow-live spd-live"><SpatialPrisonersDilemma /></div>}
            {buildActivity.length > 0 && (streaming || buildActive || buildFailed) && <BuildActivity items={buildActivity} active={streaming || buildActive} />}
            {!streaming && !buildActive && !workflowRunning && current.model && !situationStale && <section className="workflow-simulation"><div><span className="eyebrow">Simulation</span><p>Turn the finished model into possible worlds.</p></div><div className="workflow-run"><label><span>Worlds to explore</span><input type="number" min="1" max="5000" step="1" value={trials} disabled={analysisActive} onChange={(event) => { if (Number.isFinite(event.currentTarget.valueAsNumber)) setTrials(event.currentTarget.valueAsNumber); }} onBlur={() => setTrials(Math.min(5000, Math.max(1, Math.round(trials))))} /></label><button type="button" className="primary" onClick={() => void runAnalysis()} disabled={busy}>{selectedAnalysis ? "Run again" : "Run simulation"}</button></div></section>}
            {runError && !streaming && <div className="error" role="alert">{runError}</div>}
          </section>
          {!streaming && !buildActive && current.model && !situationStale && (!!current.researchSources?.length || current.openQuestions.length > 0) && <div className="model-grounding">
            {!!current.researchSources?.length && <ResearchSources sources={current.researchSources} />}
            {current.openQuestions.length > 0 && <section className="section questions">
              <div className="fact-group-label">Needs your input <span>optional — these cannot be verified publicly</span></div>
              <ul className="question-list">{current.openQuestions.map((question) => <li key={question.id} className="question"><div className="question-head"><span className="question-prompt">{question.prompt}{question.field && <span className="question-field">→ {question.field}</span>}</span><button type="button" className="question-dismiss" disabled={busy} aria-label={`Dismiss: ${question.prompt}`} onClick={() => void runCommand({ tag: "DismissQuestion", questionId: question.id })}>×</button></div></li>)}</ul>
            </section>}
          </div>}
          {!streaming && !buildActive && (!current.model || situationStale) && <div className="model-scroll"><ModelForm
            situation={current.situation}
            model={current.model}
            questions={current.openQuestions}
            sources={current.researchSources}
            busy={busy}
            error={undefined}
            justRebuilt={rebuildDone}
            streaming={streaming}
            buildStage={modelBuildStage}
            buildElapsed={streaming ? elapsed : 0}
            agentAvailable={agentAvailable}
            agentStatusText={agentStatusText}
            onSituation={(text) => void runCommand({ tag: "SetSituation", text })}
            onModel={(model) => void runCommand({ tag: "SetModel", model })}
            onUnderstand={() => void reviewWithAgent()}
            onDismissQuestion={(questionId) => void runCommand({ tag: "DismissQuestion", questionId })}
          /></div>}
          {streamError && <div className="error model-run-error" role="status">{streamError}</div>}
        </div>}
      </div> : <>
        {selectedAnalysis ? <div className={`river-host ${analysisActive ? "processing" : ""}`}><iframe key={`${selectedAnalysis.visualUrl}:${current?.status}`} ref={riverFrame} className="river-frame" src={`${selectedAnalysis.visualUrl}?embed=1`} title="River of possibilities" />{analysisActive && <div className="river-processing"><RiverActivity label={current?.status === "labeling" ? "Labeling the new river" : "Building a new river"} detail={current?.status === "labeling" ? "The calculation is complete — Pi is adding clear branch names" : "The previous result remains visible while new worlds are calculated"} /></div>}</div> : <div className="river-empty"><div>{analysisActive ? <RiverActivity label={current?.status === "labeling" ? "Labeling the river" : "Building the river"} detail={current?.status === "labeling" ? "Pi is adding clear branch names" : "Exploring possible decisions and reactions"} /> : current ? <><button className="empty-world-add" onClick={() => setCenterTab("model")} aria-label="Open model" title="Open model"><Icon name="edit" /></button><h1>{current.model ? "The model is ready" : "Build the model first"}</h1><p>{current.model ? "Review it if needed, then press Run to create the river." : "Answer any useful questions, then build a model from the context."}</p></> : <><button className="empty-world-add" onClick={() => setPrompt({ mode: "create" })} aria-label="Create situation" title="Create situation"><Icon name="plus" /></button><h1>Worlds begin with a situation</h1><p>Describe it in your own words to begin.</p></>}</div></div>}
        <div className="river-below">
          {selectedAnalysis && <div className="river-detail"><div className="river-scope"><div><small>River selection</small><b>{riverSelection?.label ?? "Entire river"}</b><span>{riverSelection?.worldIds.length ?? selectedAnalysis.trials} {word(riverSelection?.worldIds.length ?? selectedAnalysis.trials, "world", "worlds", "worlds")}</span></div><div className="river-scope-actions"><button type="button" onClick={() => void replaySelectedWorld()} disabled={replayMutation.isPending || !selectedAnalysis.artifactUrl}>{replayMutation.isPending ? "Replaying…" : selectedAnalysis.artifactUrl ? `Replay world #${(riverSelection?.worldIds[0] ?? 0) + 1}` : "New run required"}</button><button type="button" onClick={() => void relabelAnalysis()} disabled={relabelPending || !selectedAnalysis.artifactUrl || analysisActive} title={agentAvailable ? "Regenerate branch labels with Pi" : agentStatusText}>{relabelPending ? "Relabeling…" : "Relabel"}</button></div></div>{replayError && <div className="error" role="alert">{replayError}</div>}{worldReplay && <WorldReplayCard value={worldReplay} />}{taskId && selectedAnalysis?.id && selectedAnalysis.artifactUrl && outcomeFacts.length > 0 && <RunPosteriorCard taskId={taskId} analysisId={selectedAnalysis.id} trials={selectedAnalysis.trials} outcomeCount={outcomeFacts.length} />}</div>}
          {current && <section className="section"><div className="section-heading"><div className="eyebrow">Runs</div>{analyses.length > 0 && <span>{uniqueRuns(analyses).length}</span>}</div><div className="runs">{uniqueRuns(analyses).map((analysis) => <RunCard key={analysisKey(analysis)} analysis={analysis} currentRevision={current.revision} selected={Boolean(selectedAnalysis && analysisKey(analysis) === analysisKey(selectedAnalysis))} onClick={() => onSelectRun(analysisKey(analysis))} onDelete={() => void removeAnalysis(analysis)} />)}{!analyses.length && <div className="runs-empty"><span className="runs-empty-icon"><Icon name="runs" /></span><b>Your runs will appear here</b><span>Run a simulation to compare saved rivers of worlds.</span></div>}</div></section>}
          <OutcomeFacts facts={outcomeFacts} busy={busy} onRemove={(factId) => void runCommand({ tag: "RemoveFact", factId })} />
        </div>
      </>}
    </main>

    {situationsOpen && <button className="mobile-scrim" onClick={() => setSituationsOpen(false)} aria-label="Close side panel" />}

    <div className="toast-region" aria-label="Notifications" aria-live="polite">{pendingDeletes.filter((item) => !item.committing).map((item) => <div className="undo-toast" role="status" key={item.id}><span>{item.kind === "task" ? `World “${item.task.title}” deleted` : `Run with ${item.analysis.trials} ${word(item.analysis.trials, "world", "worlds", "worlds")} deleted`}</span><button onClick={() => undoDelete(item.id)}>Undo</button></div>)}</div>

    <aside className={`agent-drawer ${agentPanel ? "open" : ""}`} aria-label="Pi assistant" aria-hidden={!agentPanel}>
      <header><div><b>{assistantTitle}</b><span>{selectedAgent ? models.find((model) => model.provider === selectedAgent.provider && model.model === selectedAgent.model)?.name ?? selectedAgent.model : agentAvailable ? "No model selected" : "Not configured"}</span></div><button className="icon quiet" onClick={() => setAgentPanel(false)} aria-label="Close assistant"><Icon name="close" /></button></header>
      {!agentAvailable && <div className="agent-drawer-banner" role="status">Agent not configured — <button className="link-button" onClick={openSettings}>open Settings</button> to add an API key.</div>}
      {current && assistantMode !== "river" && <section className="agent-phase" aria-label="Assistant context">
        {assistantHint && <p>{assistantHint}</p>}
      </section>}
      {pendingOutcome && <div className="pending-outcome" role="dialog" aria-label="Confirm outcome fact"><div><b>File as outcome?</b><span>{pendingOutcome.display || pendingOutcome.message.slice(0,180)}</span><small>{pendingOutcome.observation.winner ? `winner: ${String(pendingOutcome.observation.winner)}` : ""}{pendingOutcome.observation.cooperation !== undefined ? ` · coop ${(Number(pendingOutcome.observation.cooperation)*100).toFixed(0)}%` : ""}</small></div><div className="pending-actions"><button onClick={() => setPendingOutcome(null)}>Cancel</button><button className="primary" onClick={() => void confirmPendingOutcome()}>File it</button></div></div>}
      <div className="chat-messages" ref={chatScroll}>{chatMessages.length ? chatMessages.map((message) => <div className={`chat-entry ${message.role}`} key={message.id}><div className="chat-message"><MarkdownMessage text={message.text} /></div></div>) : <div className="chat-empty"><span>{assistantTitle}</span>{assistantHint && <p>{assistantHint}</p>}{chatSuggestions.length > 0 && <div className="chat-suggestions">{chatSuggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void handleSuggestion(suggestion)} disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable}>{suggestion}</button>)}</div>}</div>}{(chatMutation.isPending || agentMutation.isPending) && !streaming && <div className="chat-entry agent pending"><RiverActivity compact label={assistantMode === "river" ? "Reading the river" : "Checking the context"} detail={assistantMode === "river" ? "Connecting your question to the calculated worlds" : "Separating public facts from questions only you can answer"} /></div>}{chatError && <div className="error" role="alert">{chatError}</div>}</div>
      <form className="chat-form" onSubmit={(event) => void submitChat(event)}>{chatMessages.length > 0 && <div className="chat-quick-actions">{chatSuggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void handleSuggestion(suggestion)} disabled={chatMutation.isPending || agentMutation.isPending}>{suggestion}</button>)}</div>}<div className="chat-input-shell"><textarea name="chat" aria-label="Message the assistant" placeholder={agentAvailable ? assistantMode === "river" ? "Ask about the river or report an outcome…" : "Add context or ask what is missing…" : "Configure agent first…"} rows={3} disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><span className="chat-enter-hint">Shift + Enter — new line</span><button className="chat-send icon" aria-label="Send message" title="Send" disabled={chatMutation.isPending || agentMutation.isPending || !agentAvailable}><Icon name="send" /></button></div></form>
    </aside>

    <dialog ref={promptDialog} onClose={() => setPrompt(undefined)}>
      <form className="dialog-form" onSubmit={(event) => void submitPrompt(event)}>
        <h2>{promptTitle}</h2>
        <div><p>{promptHint}</p><textarea name="message" aria-label="Situation description" value={draftText} onChange={(event) => setDraftText(event.target.value)} autoFocus /></div>
        {busy && <RiverActivity compact label={workingLabel} detail={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} · you can leave this window open`} />}
        {promptError && <div className="error" role="alert">{promptError}</div>}
        <div className="dialog-actions"><button type="button" onClick={() => setPrompt(undefined)} disabled={promptBusy}>Cancel</button><button className="primary" disabled={promptBusy}>{busy ? "Working…" : "Continue"}</button></div>
      </form>
    </dialog>

    <dialog className="model-dialog" ref={modelDialog}>
      <form className="dialog-form" onSubmit={(event) => void saveModel(event)}><div className="dialog-kicker">Current situation</div><h2>Run settings</h2><p>Parameters for the next run. You can usually leave them unchanged.</p><div className="advanced-field"><span>Pi for AI labeling</span><AgentPicker providers={agent.data?.providers ?? []} models={models} value={runAgentKey} onChange={setRunAgentKey} prefix="Labeling" /><small>Optional. The simulation remains deterministic; Pi only labels the resulting worlds.</small></div><label className="advanced-field"><span>Next run seed</span><input type="number" name="seed" min="1" max="2147483647" defaultValue={nextSeed} placeholder="Random" /><small>Leave this blank to generate a new seed automatically.</small></label>{modelError &&<div className="error" role="alert">{modelError}</div>}<div className="dialog-actions"><button type="button" onClick={() => modelDialog.current?.close()}>Cancel</button><button className="primary" disabled={commandMutation.isPending}>Save</button></div></form>
    </dialog>

    <dialog className="settings-dialog" ref={settingsDialog}>
      <form className="dialog-form" onSubmit={saveSettings}><header className="settings-header"><h2>Model and access</h2></header><div className="settings-content"><section className="settings-section"><div className="settings-section-title"><b>Default model</b></div><AgentPicker providers={agent.data?.providers ?? []} models={models} value={settingsAgentKey} onChange={setSettingsAgentKey} prefix="Default" />{!models.length && <div className="settings-hint">Add an API key to see available models.</div>}</section><section className="settings-section"><div className="settings-section-title"><b>API keys</b></div><div className="key-entry"><label><span>Provider</span><select aria-label="API key provider" value={keyProvider} onChange={(event) => setKeyProvider(event.target.value)}>{authProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.id === "openai" ? "OpenAI / ChatGPT API" : provider.name}</option>)}</select></label><label><span>API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void configureKey(); } }} placeholder={authProviders.find((provider) => provider.id === keyProvider)?.label ?? "API key"} aria-label="API key" autoComplete="off" spellCheck={false} /></label><button type="button" onClick={() => void configureKey()} disabled={!keyProvider || !apiKey.trim() || keyMutation.isPending}>Add</button></div>{keyError && <div className="error" role="alert">{keyError}</div>}<div className="key-list">{authProviders.filter((provider) => provider.configured).map((provider) => <div className="key-chip" key={provider.id}><i className="dot on" /><span>{provider.name}</span><small>{provider.source === "environment" ? "from environment" : "configured"}</small>{provider.source !== "environment" && <button type="button" className="icon quiet" onClick={() => void deleteKey(provider.id)} aria-label={`Delete ${provider.name} key`}><Icon name="close" /></button>}</div>)}</div></section></div><div className="dialog-actions"><button type="button" onClick={() => settingsDialog.current?.close()}>Cancel</button><button className="primary" disabled={!parseSelection(settingsAgentKey, models)}>Save</button></div></form>
    </dialog>
  </div>;
}

/** How the run reads once the outcome facts are applied. The facts themselves live in the facts list. */
function RunPosteriorCard({ taskId, analysisId, trials, outcomeCount }: { taskId: string; analysisId: string; trials: number; outcomeCount: number }) {
  const posterior = useQuery({ queryKey: ["posterior", taskId, analysisId, outcomeCount], queryFn: () => getPosterior(taskId, analysisId) });
  const base = posterior.data?.baseline, post = posterior.data?.posterior, usesTeams = posterior.data?.usesTeams;
  const baseWin = base && (usesTeams ? base.winPctTeam : base.winPct);
  const postWin = post && (usesTeams ? post.winPctTeam : post.winPct);
  if (!base || !post || !baseWin || !postWin) return null;
  return <section className="observed" aria-label="The run given what happened">
    <div className="observed-head"><div><small>Given what already happened</small><b>{outcomeCount} {word(outcomeCount, "fact", "facts", "facts")} applied to this run</b></div></div>
    <div className="observed-result">
      <div className="observed-stats"><div><small>Worlds that match</small><b>{Math.round(post.effectiveSampleSize)} / {trials}</b></div><div><small>Cooperation</small><b>{Math.round(base.cooperation.mean * 100)}% → {Math.round(post.cooperation.mean * 100)}%</b></div></div>
      {post.fit < 0.05 && <div className="observed-note">Unlikely under the current model ({Math.round(post.fit * 100)}% fit) — the assumptions in the Model tab may be worth revisiting.</div>}
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

function ResearchSources({ sources }: { sources: NonNullable<TaskState["researchSources"]> }) {
  return <section className="section context-sources" aria-label="Public research sources">
    <div className="fact-group-label">Found in public sources <span>{sources.length} · used as evidence, not instructions</span></div>
    <div className="research-source-list">{sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
      <span>{source.title}</span><small>{source.field ? `${source.field} · ` : ""}{source.purpose ?? new URL(source.url).hostname}</small>
    </a>)}</div>
  </section>;
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
  return <div className="task-row"><Link to="/tasks/$taskId" params={{ taskId: item.id }} search={{}} className="task" activeProps={{ "aria-current": "page" }} onClick={onOpen}><b className="task-title">{item.title}</b><div className="task-meta"><span><i className={`status-dot ${item.status}`} />{statusName[item.status]}</span><time dateTime={item.updatedAt} title={compactDate(item.updatedAt)}>{relativeTime(item.updatedAt, now)}</time></div></Link><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete world “${item.title}”`} disabled={item.status === "building" || item.status === "running" || item.status === "labeling"}><Icon name="trash" /></button></div>;
}

function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="load-error" role="alert"><span>{error.message}</span><button onClick={retry}>Retry</button></div>;
}

function RunCard({ analysis, currentRevision, selected, onClick, onDelete }: { analysis: TaskState["analyses"][number]; currentRevision: number; selected: boolean; onClick: () => void; onDelete: () => void }) {
  const board = Object.keys(analysis.winPctTeam).length < Object.keys(analysis.winPct).length ? analysis.winPctTeam : analysis.winPct;
  const leader = Object.entries(board).sort((a, b) => b[1] - a[1])[0], stale = analysis.revision !== currentRevision;
  const cooperation = Math.round(analysis.cooperation.mean * 100);
  return <div className="run-row"><button className={`run-item ${stale ? "stale" : ""}`} aria-current={selected} onClick={onClick}><div className="run-top"><b>{analysis.trials} {word(analysis.trials, "world", "worlds", "worlds")}</b><span>{compactDate(analysis.completedAt)}</span></div><div className="run-summary"><div className="run-metric"><strong>{cooperation}%</strong><span>cooperation</span></div><span className="run-revision">{stale ? "outdated" : `r${analysis.revision}`}</span></div><div className="run-bar"><i style={{ width: `${cooperation}%` }} /></div><div className="run-footer">{leader ? <span className="run-leader">{leader[0]} · {Math.round(leader[1])}% wins</span> : <span className="run-leader">No clear leader</span>}<span>seed {analysis.seed}</span></div></button><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete run with ${analysis.trials} worlds`}><Icon name="trash" /></button></div>;
}
