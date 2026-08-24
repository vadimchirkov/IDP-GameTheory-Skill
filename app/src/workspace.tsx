import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  askAgent, chatAgent, createTask, getAgentStatus, getScenarioHints, getTask, getTasks, getWorldReplay, removeProviderKey, researchScenarioHint, saveProviderKey, sendCommand,
  type AgentModelStatus, type AgentSelection, type RiverSelection, type TaskDecision, type TaskState, type TaskSummary, type WorldReplay,
} from "./api";
import { relativeTime } from "./relative-time";

const statusName = { draft: "Draft", ready: "Ready", running: "Running", labeling: "Labeling", completed: "Complete", failed: "Failed", new: "New" } as const;
type Proposal = NonNullable<TaskState["pendingProposal"]>;
type PromptState = { mode: "create" | "refine" | "edit-brief" | "edit-context" | "proposal"; index?: number; proposal?: Proposal };
type ModelOption = AgentModelStatus;
type ChatMessage = { role: "user" | "agent"; text: string };
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
    collapse: <path d="m14.5 6.5-5.5 5.5 5.5 5.5" />,
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

function RiverActivity({ label, detail, compact = false }: { label: string; detail?: string; compact?: boolean }) {
  return <div className={`river-activity ${compact ? "compact" : ""}`} role="status" aria-live="polite">
    <svg className="river-orbit" viewBox="0 0 64 64" aria-hidden="true">
      <circle className="river-orbit-track" cx="32" cy="32" r="24" />
      <circle className="river-orbit-flow flow-a" cx="32" cy="32" r="24" pathLength="100" />
      <circle className="river-orbit-flow flow-b" cx="32" cy="32" r="18" pathLength="100" />
      <circle className="river-orbit-flow flow-c" cx="32" cy="32" r="12" pathLength="100" />
      <circle className="river-orbit-core" cx="32" cy="32" r="3" />
    </svg>
    <div><b>{label}</b>{detail && <span>{detail}</span>}</div>
  </div>;
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
  const [hidden, setHidden] = useState(() => ({
    situations: localStorage.getItem("pane-situations") === "hidden",
    runs: localStorage.getItem("pane-runs") === "hidden",
  }));
  const [mobilePane, setMobilePane] = useState<"situations" | "runs" | null>(null);
  const [prompt, setPrompt] = useState<PromptState>();
  const [draftText, setDraftText] = useState("");
  const [debouncedDraft, setDebouncedDraft] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [promptError, setPromptError] = useState("");
  const [researchingHints, setResearchingHints] = useState<string[]>([]);
  const [runError, setRunError] = useState("");
  const [streamError, setStreamError] = useState("");
  const [modelError, setModelError] = useState("");
  const [nextSeed, setNextSeed] = useState<number>();
  const [modelText, setModelText] = useState("");
  const [modelSnapshot, setModelSnapshot] = useState("");
  const [agentKey, setAgentKey] = useState(savedSelection);
  const [runAgentKey, setRunAgentKey] = useState("");
  const [settingsAgentKey, setSettingsAgentKey] = useState("");
  const [keyProvider, setKeyProvider] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [keyError, setKeyError] = useState("");
  const [agentPanel, setAgentPanel] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [generatedSuggestions, setGeneratedSuggestions] = useState<string[]>([]);
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
  const previousTaskStatus = useRef<TaskState["status"] | undefined>(undefined);
  const summarizedAnalyses = useRef(new Set<string>());
  const deleteTimers = useRef(new Map<string, number>());
  const riverFrame = useRef<HTMLIFrameElement>(null);
  const chatScroll = useRef<HTMLDivElement>(null);
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  const tasks = useQuery({ queryKey: ["tasks"], queryFn: getTasks });
  const task = useQuery({ queryKey: ["task", taskId], queryFn: () => getTask(taskId!), enabled: Boolean(taskId) });
  const agent = useQuery({ queryKey: ["agent-status"], queryFn: getAgentStatus, retry: 0 });
  const current = task.data;

  useEffect(() => {
    const first = tasks.data?.[0];
    if (!taskId && first) void navigate({ to: "/tasks/$taskId", params: { taskId: first.id }, replace: true });
  }, [navigate, taskId, tasks.data]);

  useEffect(() => {
    setNextSeed(undefined);
    setRunError("");
    setTrials(current?.analyses.at(-1)?.trials ?? 600);
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
    const dialog = promptDialog.current;
    if (prompt) openDialog(dialog);
    if (!prompt && dialog?.open) dialog.close();
  }, [prompt]);

  useEffect(() => {
    if (!prompt || prompt.mode === "proposal") { setDraftText(""); setDebouncedDraft(""); return; }
    const initial = prompt.mode === "edit-brief" ? current?.brief ?? "" : prompt.mode === "edit-context" && prompt.index !== undefined ? current?.context[prompt.index] ?? "" : "";
    setDraftText(initial);
    setDebouncedDraft("");
  }, [prompt]);

  useEffect(() => {
    const text = draftText.trim();
    setDebouncedDraft("");
    if (!prompt || prompt.mode === "proposal" || text.length < (current ? 8 : 40)) return;
    const timer = setTimeout(() => setDebouncedDraft(text), 1_800);
    return () => clearTimeout(timer);
  }, [current, draftText, prompt?.mode]);

  const models = agent.data?.models ?? [];
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

  const scenarioContext = useMemo(() => {
    if (!prompt || prompt.mode === "proposal") return "";
    if (!current) return debouncedDraft;
    const brief = prompt.mode === "edit-brief" ? debouncedDraft : current.brief;
    const context = current.context.map((text, index) => prompt.mode === "edit-context" && prompt.index === index ? debouncedDraft : text);
    if (prompt.mode === "refine" && debouncedDraft) context.push(debouncedDraft);
    return `Situation: ${brief}\n\nContext:\n${context.map((text) => `- ${text}`).join("\n")}`.slice(0, 20_000);
  }, [current, debouncedDraft, prompt]);

  const scenarioHints = useQuery({
    queryKey: ["scenario-hints", scenarioContext, selectedAgent],
    queryFn: () => getScenarioHints({ text: scenarioContext, agent: selectedAgent }),
    enabled: Boolean(debouncedDraft && selectedAgent && prompt && prompt.mode !== "proposal" && !researchingHints.length),
    staleTime: 5 * 60_000,
    retry: false,
  });

  const createMutation = useMutation({ mutationFn: createTask });
  const commandMutation = useMutation({ mutationFn: ({ id, value }: { id: string; value: Record<string, unknown> }) => sendCommand(id, value) });
  const agentMutation = useMutation({ mutationFn: ({ id, value }: { id: string; value: Parameters<typeof askAgent>[1] }) => askAgent(id, value) });
  const keyMutation = useMutation({ mutationFn: ({ provider, key }: { provider: string; key?: string }) => key ? saveProviderKey(provider, key) : removeProviderKey(provider) });
  const chatMutation = useMutation({ mutationFn: chatAgent });
  const replayMutation = useMutation({ mutationFn: ({ taskId, analysisId, index }: { taskId: string; analysisId: string; index: number }) => getWorldReplay(taskId, analysisId, index) });
  const busy = createMutation.isPending || commandMutation.isPending || agentMutation.isPending;
  const promptBusy = busy || Boolean(researchingHints.length);
  const elapsed = useElapsed(busy);

  const cacheTask = (value: TaskState) => {
    queryClient.setQueryData(["task", value.id], value);
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const showProposal = (proposal?: Proposal) => {
    if (!proposal) return;
    const decisions = proposal.decisions?.length ? proposal.decisions : (proposal.questions ?? []).map((label, index) => ({ id: `question-${index + 1}`, prompt: label, answer: "", alternatives: [] }));
    setAnswers(Object.fromEntries(decisions.map((decision) => [decision.id, decision.answer])));
    setPromptError("");
    setPrompt({ mode: "proposal", proposal: { ...proposal, decisions } });
  };

  const requestAgent = async (id: string, revision: number, message: string, options: { remember?: boolean; research?: boolean; operation?: "understand" | "build-model" | "revise-model"; decisions?: readonly TaskDecision[] } = {}) => {
    const value = await agentMutation.mutateAsync({ id, value: { message, baseRevision: revision, agent: selectedAgent, ...options } });
    cacheTask(value);
    if (selectedAgent) {
      const value = selectionValue(selectedAgent);
      saveSelection(value, models);
      setAgentKey(value);
    }
    return value;
  };

  const submitPrompt = async (event: FormEvent) => {
    event.preventDefault();
    if (!prompt) return;
    setPromptError("");
    try {
      if (prompt.mode === "proposal") { await applyProposal(); return; }
      const text = draftText.trim();
      if (!text) throw new Error("Enter a situation or clarification");
      if (prompt.mode === "create") {
        const created = await createMutation.mutateAsync(text);
        cacheTask(created);
        await navigate({ to: "/tasks/$taskId", params: { taskId: created.id } });
        const value = await requestAgent(created.id, created.revision, "Review the situation and prepare a clear plain-English understanding for confirmation.", { remember: false, research: false });
        showProposal(value.pendingProposal);
      } else if (current && prompt.mode === "refine") {
        const value = await requestAgent(current.id, current.revision, text, { research: false });
        showProposal(value.pendingProposal);
      } else if (current && prompt.mode === "edit-brief") {
        const reply = await commandMutation.mutateAsync({ id: current.id, value: { tag: "EditBrief", brief: text, baseRevision: current.revision } });
        if (reply.tag !== "Accepted") throw new Error(reply.tag === "Rejected" ? reply.reason : "The change was not accepted");
        const value = await requestAgent(current.id, reply.revision, "The situation has changed. Update the title and review every assumption again.", { remember: false, research: false });
        showProposal(value.pendingProposal);
      } else if (current && prompt.mode === "edit-context" && prompt.index !== undefined) {
        const reply = await commandMutation.mutateAsync({ id: current.id, value: { tag: "EditContext", index: prompt.index, text, baseRevision: current.revision } });
        if (reply.tag !== "Accepted") throw new Error(reply.tag === "Rejected" ? reply.reason : "The change was not accepted");
        const value = await requestAgent(current.id, reply.revision, "The context has changed. Rebuild every assumption in clear plain English.", { remember: false, research: false });
        showProposal(value.pendingProposal);
      }
    } catch (error) { setPromptError(error instanceof Error ? error.message : String(error)); }
  };

  const researchHint = async (hint: string) => {
    setResearchingHints((items) => [...items, hint]); setPromptError("");
    try {
      const result = await researchScenarioHint({ question: hint, context: scenarioContext, agent: selectedAgent });
      setDraftText((text) => `${text.trimEnd()}\n\n${result.text.trim()}`);
    } catch (error) { setPromptError(error instanceof Error ? error.message : String(error)); }
    finally { setResearchingHints((items) => items.filter((item) => item !== hint)); }
  };

  const applyProposal = async () => {
    if (!current || !prompt?.proposal) return;
    const proposal = prompt.proposal;
    const decisions = (proposal.decisions ?? []).map((decision) => ({ ...decision, answer: (answers[decision.id] ?? "").trim() }));
    if (decisions.some((decision) => !decision.answer)) throw new Error("Complete the selected assumptions");
    const changed = decisions.some((decision, index) => decision.answer !== proposal.decisions?.[index]?.answer);
    let acceptedProposal = proposal;
    if (changed || !proposal.model) {
      const built = await requestAgent(current.id, current.revision, "Build the model from the explicitly confirmed assumptions provided.", { remember: false, operation: "build-model", decisions });
      if (!built.pendingProposal?.model) { showProposal(built.pendingProposal); return; }
      acceptedProposal = built.pendingProposal;
    }
    const reply = await commandMutation.mutateAsync({ id: current.id, value: { tag: "AcceptProposal", proposalId: acceptedProposal.id, baseRevision: current.revision } });
    if (reply.tag !== "Accepted") throw new Error(reply.tag === "Rejected" ? reply.reason : "The model was not accepted");
    if (acceptedProposal.agentMeta?.operation === "revise-model" && selectedAnalysis) {
      await commandMutation.mutateAsync({ id: current.id, value: { tag: "RequestAnalysis", trials: selectedAnalysis.trials, seed: selectedAnalysis.seed, agent: selectedAgent, baseRevision: reply.revision } });
      onSelectRun(undefined);
    }
    setPrompt(undefined);
    await queryClient.invalidateQueries({ queryKey: ["task", current.id] });
    await queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };

  const refreshAssumptions = async (focus?: TaskDecision) => {
    if (!current) return;
    setPromptError("");
    try {
      const message = focus
        ? `Review all current assumptions in plain English. The user wants to change “${focus.prompt}: ${focus.answer}”.`
        : "Review the current understanding, research the web if necessary, and present every assumption as a clear plain-English statement without internal terminology.";
      showProposal((await requestAgent(current.id, current.revision, message, { remember: false, research: true })).pendingProposal);
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  };

  const runAnalysis = async () => {
    if (!current) return;
    setRunError("");
    try {
      const seed = nextSeed ?? ((crypto.getRandomValues(new Uint32Array(1))[0]! & 0x7fffffff) || 1);
      await commandMutation.mutateAsync({ id: current.id, value: { tag: "RequestAnalysis", trials, seed, agent: selectedAgent, baseRevision: current.revision } });
      setNextSeed(undefined);
      onSelectRun(undefined);
      await queryClient.invalidateQueries({ queryKey: ["task", current.id] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  };

  const cancelAnalysis = async () => {
    if (!current) return;
    setRunError("");
    try {
      await commandMutation.mutateAsync({ id: current.id, value: { tag: "CancelAnalysis", baseRevision: current.revision } });
      await queryClient.invalidateQueries({ queryKey: ["task", current.id] });
      await queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); }
  };

  const commitDelete = async (deletion: PendingDelete) => {
    setPendingDeletes((items) => items.map((item) => item.id === deletion.id ? { ...item, committing: true } : item));
    try {
      const reply = deletion.kind === "task"
        ? await sendCommand(deletion.task.id, { tag: "DeleteTask", baseRevision: deletion.task.revision })
        : await sendCommand(deletion.taskId, { tag: "RemoveAnalysis", analysisId: analysisKey(deletion.analysis), baseRevision: deletion.revision });
      if (reply.tag !== "Accepted") throw new Error(reply.tag === "Rejected" ? reply.reason : "Could not delete the item");
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
    const value = current.model ? JSON.stringify(current.model, null, 2) : "{}";
    setModelText(value); setModelSnapshot(value); setModelError("");
    setRunAgentKey(selectedAgent ? selectionValue(selectedAgent) : agentKey);
    openDialog(modelDialog.current);
  };

  const openSettings = () => {
    setMobilePane(null);
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

  const sendChatMessage = async (message: string, showUser = true) => {
    if (!message || !selectedAgent) return;
    const visible = showUser ? [...chatMessages, { role: "user" as const, text: message }] : chatMessages;
    const request = showUser ? visible : [...visible, { role: "user" as const, text: message }];
    if (showUser) setChatMessages(visible);
    setChatError("");
    try {
      const history = request.slice(-10).map((item) => `${item.role === "user" ? "User" : "Agent"}: ${item.text}`).join("\n\n");
      const riverContext = selectedAnalysis ? [
        `River run: ${selectedAnalysis.trials} worlds, seed ${selectedAnalysis.seed}, model revision ${selectedAnalysis.revision}.`,
        `Run result: ${selectedAnalysis.report}`,
        `Current scope: ${riverSelection?.label ?? "entire river"} (${riverSelection?.worldIds.length ?? selectedAnalysis.trials} worlds).`,
        worldReplay ? `Verified replay of world ${worldReplay.index + 1}: ${JSON.stringify({ exact: worldReplay.exact, winners: worldReplay.stored.winners, cooperation: worldReplay.stored.cooperation, inputs: worldReplay.stored.inputs, scores: worldReplay.stored.scores, digest: worldReplay.stored.digest })}` : "",
      ].filter(Boolean).join("\n") : "";
      const result = await chatMutation.mutateAsync({ message: history, context: current ? `${current.title}\n${current.brief}${riverContext ? `\n\n${riverContext}` : ""}` : undefined, agent: selectedAgent });
      setChatMessages((items) => [...items, { role: "agent", text: result.text }]);
      setGeneratedSuggestions(result.suggestions);
    } catch (error) { setChatError(error instanceof Error ? error.message : String(error)); }
  };

  const submitChat = async (event: FormEvent) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement, message = String(new FormData(form).get("chat") ?? "").trim();
    if (!message || !current || !selectedAgent) return;
    const revising = ((event.nativeEvent as SubmitEvent).submitter as HTMLElement | null)?.dataset.action === "revise";
    form.reset();
    if (revising) {
      setChatMessages((items) => [...items, { role: "user", text: message }]);
      setChatError("");
      try {
        const value = await requestAgent(current.id, current.revision, message, { remember: false, operation: "revise-model" });
        setChatMessages((items) => [...items, { role: "agent", text: "I prepared a model change for review. Nothing has been applied yet." }]);
        showProposal(value.pendingProposal);
      } catch (error) { setChatError(error instanceof Error ? error.message : String(error)); }
      return;
    }
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
      setAgentKey(runAgentKey);
      saveSelection(runAgentKey, models);
      if (modelText !== modelSnapshot) {
        await commandMutation.mutateAsync({ id: current.id, value: { tag: "ReplaceModel", model: JSON.parse(modelText), baseRevision: current.revision } });
        onSelectRun(undefined);
        await queryClient.invalidateQueries({ queryKey: ["task", current.id] });
        await queryClient.invalidateQueries({ queryKey: ["tasks"] });
      }
      modelDialog.current?.close();
    } catch (error) { setModelError(error instanceof Error ? error.message : String(error)); }
  };

  const togglePane = (name: "situations" | "runs") => {
    if (mobile) { setMobilePane((value) => value === name ? null : name); return; }
    setHidden((value) => {
      const next = { ...value, [name]: !value[name] };
      localStorage.setItem(`pane-${name}`, next[name] ? "hidden" : "shown");
      return next;
    });
  };

  const openScenario = () => {
    if (mobile) { setMobilePane("runs"); return; }
    setHidden((value) => {
      if (!value.runs) return value;
      localStorage.setItem("pane-runs", "shown");
      return { ...value, runs: false };
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
  const contextualSuggestions = riverSelection && riverSelection.kind !== "all"
    ? ["Why did this branch emerge?", "How do these worlds differ from the rest?", "How can I change this branch's probability?"]
    : selectedAnalysis
      ? ["Explain the main result", "What changes the outcome most?", "How can cooperation become more likely?"]
      : current
        ? ["What data is missing?", "Review my assumptions", "Which actions have we overlooked?"]
        : ["Help me frame the situation", "What can I explore?", "Show me a good scenario example"];
  const chatSuggestions = chatMessages.length && generatedSuggestions.length ? generatedSuggestions : contextualSuggestions;

  useEffect(() => {
    const previous = previousTaskStatus.current, next = current?.status;
    previousTaskStatus.current = next;
    if ((previous !== "running" && previous !== "labeling") || next !== "completed" || !selectedAnalysis || !selectedAgent) return;
    const id = analysisKey(selectedAnalysis);
    if (summarizedAnalyses.current.has(id)) return;
    summarizedAnalyses.current.add(id);
    setAgentPanel(true);
    void sendChatMessage("Summarize the river that just finished. Use Markdown: a short heading, then three bullets — the main outcome, the key risk, and the most useful action. Do not repeat technical parameters or mention this request.", false);
  }, [current?.status, selectedAnalysisId]);

  useEffect(() => {
    setRiverSelection(undefined);
    setWorldReplay(undefined);
    setReplayError("");
  }, [taskId, selectedAnalysisId]);

  useEffect(() => { setChatMessages([]); setGeneratedSuggestions([]); setChatError(""); }, [taskId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "smooth" }));
    return () => cancelAnimationFrame(frame);
  }, [chatMessages.length, chatMutation.isPending]);

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
  const appClass = ["app", hidden.situations && "hide-situations", hidden.runs && "hide-runs", agentPanel && "agent-open", mobilePane && `mobile-${mobilePane}`].filter(Boolean).join(" ");
  const promptTitle = prompt?.mode === "create" ? "New situation" : prompt?.mode === "edit-brief" ? "Edit situation" : prompt?.mode === "edit-context" ? "Edit context" : prompt?.mode === "proposal" ? "Did we understand correctly?" : "Add context";
  const promptHint = prompt?.mode === "create" ? "Describe the situation in your own words: who is involved, what they want, which decisions are available, what limits their choices, how urgent it is, and which outcome matters. Write freely — Pi will help spot the gaps." : prompt?.mode === "edit-brief" ? "Clarify the participants, their goals, available actions, constraints, timing, and desired outcome. Pi will update the title and review the assumptions after you save." : prompt?.mode === "edit-context" ? "Add specifics: who, what, when, under which conditions, and why it matters. Pi will review the assumptions again after you save." : "Add a fact, participant goal, constraint, or possible action. You can also correct the current understanding or ask Pi to verify up-to-date information.";
  const workingLabel = prompt?.mode === "proposal" ? "Pi is building the model" : "Pi is exploring the situation";

  return <div className={appClass}>
    <aside className="pane situations" aria-label="Situations">
      <header className="pane-head"><button className="icon quiet" onClick={() => togglePane("situations")} aria-label="Collapse situations panel"><Icon name="collapse" /></button><div className="brand"><span>Situations</span></div><button className="icon primary" onClick={() => setPrompt({ mode: "create" })} aria-label="New situation"><Icon name="plus" /></button></header>
      <nav className="tasks">
        {tasks.isPending && <div className="empty-runs">Loading situations…</div>}
        {tasks.isError && <ErrorState error={tasks.error} retry={() => void tasks.refetch()} />}
        {visibleTasks?.map((item) => <WorldRow key={item.id} item={item} now={now} onOpen={openScenario} onDelete={() => removeTask(item)} />)}
        {visibleTasks?.length === 0 && <div className="list-empty"><Icon name="worlds" /><b>No worlds yet</b><span>Create your first situation to begin.</span></div>}
      </nav>
      <footer className="sidebar-footer"><button className="settings-link" onClick={openSettings}><Icon name="settings" /><span>Settings</span></button></footer>
    </aside>

    <aside className="pane run-pane" aria-label="Scenario">
      <header className="pane-head"><button className="icon quiet" onClick={() => togglePane("runs")} aria-label="Collapse scenario panel"><Icon name="collapse" /></button><div className="pane-title"><b>Scenario</b><span>{current ? `${statusName[current.status]} · revision ${current.revision}` : "Select a situation"}</span></div><button className="icon quiet" onClick={openModel} aria-label="Run settings" disabled={!current}><Icon name="more" /></button></header>
      <div className="run-scroll">
        {task.isPending && taskId && <div className="empty-runs">Loading situation…</div>}
        {task.isError && <ErrorState error={task.error} retry={() => void task.refetch()} />}
        {!taskId && <div className="empty-runs">Select a situation or create a new one.</div>}
        {current && <>
          <section className="section"><div className="eyebrow">Situation</div><div className="brief editable-text"><span>{current.brief}</span><button className="inline-edit" onClick={() => setPrompt({ mode: "edit-brief" })} aria-label="Edit situation"><Icon name="edit" /></button></div><Clarifications key={current.id} current={current} onEdit={(index) => setPrompt({ mode: "edit-context", index })} onRefresh={refreshAssumptions} /><div className="actions"><button onClick={() => setPrompt({ mode: "refine" })}><Icon name="plus" />Add context</button></div>{current.pendingProposal && <ProposalCard proposal={current.pendingProposal} onOpen={() => showProposal(current.pendingProposal)} onRefresh={() => void refreshAssumptions()} onReject={async () => { try { await commandMutation.mutateAsync({ id: current.id, value: { tag: "RejectProposal", proposalId: current.pendingProposal!.id, baseRevision: current.revision } }); await queryClient.invalidateQueries({ queryKey: ["task", current.id] }); } catch (error) { setRunError(error instanceof Error ? error.message : String(error)); } }} />}</section>
          <section className="section"><div className="eyebrow">New run</div><div className="run-form single"><label><span>Worlds</span><input type="number" min="1" max="5000" value={trials} disabled={analysisActive} onChange={(event) => setTrials(Number(event.target.value))} /></label>{analysisActive ? <button onClick={() => void cancelAnalysis()} disabled={busy}>{current.status === "running" ? "Cancel calculation" : "Stop labeling"}</button> : <button className="primary" onClick={() => void runAnalysis()} disabled={!current.model || busy}>Run</button>}{!current.model && <div className="run-hint">Review and confirm the agent's assumptions first.</div>}</div>{current.status === "running" && <RiverActivity compact label="Calculating worlds" detail="Exploring how the parties may behave" />}{current.status === "labeling" && <RiverActivity compact label="Labeling the river" detail="Pi is turning the results into a clear narrative" />}{current.lastError && <div className="error" role="alert"><b>The last run did not finish:</b> {current.lastError}</div>}{runError && <div className="error" role="alert">{runError}</div>}{streamError && <div className="error" role="status">{streamError}</div>}</section>
          <section className="section"><div className="section-heading"><div className="eyebrow">Runs</div>{analyses.length > 0 && <span>{uniqueRuns(analyses).length}</span>}</div><div className="runs">{uniqueRuns(analyses).map((analysis) => <RunCard key={analysisKey(analysis)} analysis={analysis} currentRevision={current.revision} selected={Boolean(selectedAnalysis && analysisKey(analysis) === analysisKey(selectedAnalysis))} onClick={() => { onSelectRun(analysisKey(analysis)); setMobilePane(null); }} onDelete={() => void removeAnalysis(analysis)} />)}{!analyses.length && <div className="runs-empty"><span className="runs-empty-icon"><Icon name="runs" /></span><b>Your runs will appear here</b><span>Run a simulation to compare saved rivers of worlds.</span></div>}</div></section>
        </>}
      </div>
    </aside>

    <main className="river-pane">
      <header className="river-toolbar"><button className="toggle open-situations" aria-pressed={mobile && mobilePane === "situations"} onClick={() => togglePane("situations")}><Icon name="situations" /><span>Situations</span></button><button className="toggle open-runs" aria-pressed={mobile && mobilePane === "runs"} onClick={() => togglePane("runs")}><Icon name="runs" /><span>Scenario</span></button><div className="river-heading"><b>{current?.title ?? "River of possibilities"}</b><span>{current?.status === "running" ? "Calculating possible worlds…" : current?.status === "labeling" ? "The river is ready; Pi is labeling its branches…" : selectedAnalysis ? `${selectedAnalysis.trials} possible worlds · ${compactDate(selectedAnalysis.completedAt)} · model r${selectedAnalysis.revision}` : current?.model ? "Start the first run" : "Clarify the situation with the agent first"}</span></div><div className="agent-tools"><button className="icon quiet" onClick={() => selectedAgent ? setAgentPanel(true) : openSettings()} aria-label="Open assistant"><Icon name="chat" /></button></div></header>
      {selectedAnalysis ? <div className={`river-host ${analysisActive ? "processing" : ""}`}><iframe key={`${selectedAnalysis.visualUrl}:${current?.status}`} ref={riverFrame} className="river-frame" src={`${selectedAnalysis.visualUrl}?embed=1`} title="River of possibilities" />{analysisActive && <div className="river-processing"><RiverActivity label={current?.status === "labeling" ? "Labeling the new river" : "Building a new river"} detail={current?.status === "labeling" ? "The calculation is complete — Pi is adding clear branch names" : "The previous result remains visible while new worlds are calculated"} /></div>}</div> : <div className="river-empty"><div>{analysisActive ? <RiverActivity label={current?.status === "labeling" ? "Labeling the river" : "Building the river"} detail={current?.status === "labeling" ? "Pi is adding clear branch names" : "Exploring possible decisions and reactions"} /> : <><button className="empty-world-add" onClick={() => setPrompt({ mode: "create" })} aria-label="Create situation" title="Create situation"><Icon name="plus" /></button><h1>Worlds begin with a situation</h1><p>Describe it, review the assumptions, and run the first set of worlds.</p></>}</div></div>}
    </main>

    {mobilePane && <button className="mobile-scrim" onClick={() => setMobilePane(null)} aria-label="Close side panel" />}

    <div className="toast-region" aria-label="Notifications" aria-live="polite">{pendingDeletes.filter((item) => !item.committing).map((item) => <div className="undo-toast" role="status" key={item.id}><span>{item.kind === "task" ? `World “${item.task.title}” deleted` : `Run with ${item.analysis.trials} ${word(item.analysis.trials, "world", "worlds", "worlds")} deleted`}</span><button onClick={() => undoDelete(item.id)}>Undo</button></div>)}</div>

    <aside className={`agent-drawer ${agentPanel ? "open" : ""}`} aria-label="Pi assistant" aria-hidden={!agentPanel}>
      <header><div><b>Assistant</b><span>{selectedAgent ? models.find((model) => model.provider === selectedAgent.provider && model.model === selectedAgent.model)?.name ?? selectedAgent.model : "No model selected"}</span></div><button className="icon quiet" onClick={() => setAgentPanel(false)} aria-label="Close assistant"><Icon name="close" /></button></header>
      {selectedAnalysis && <div className="river-scope"><div><small>River context</small><b>{riverSelection?.label ?? "Entire river"}</b><span>{riverSelection?.worldIds.length ?? selectedAnalysis.trials} {word(riverSelection?.worldIds.length ?? selectedAnalysis.trials, "world", "worlds", "worlds")}</span></div><button type="button" onClick={() => void replaySelectedWorld()} disabled={replayMutation.isPending || !selectedAnalysis.artifactUrl}>{replayMutation.isPending ? "Replaying…" : selectedAnalysis.artifactUrl ? `Replay world #${(riverSelection?.worldIds[0] ?? 0) + 1}` : "New run required"}</button>{replayError && <div className="error" role="alert">{replayError}</div>}</div>}
      {worldReplay && <WorldReplayCard value={worldReplay} />}
      <div className="chat-messages" ref={chatScroll}>{chatMessages.length ? chatMessages.map((message, index) => <div className={`chat-entry ${message.role}`} key={index}><div className="chat-message"><MarkdownMessage text={message.text} /></div></div>) : <div className="chat-empty"><span>What should we explore?</span><p>Pi can see the situation, selected run, and active river branch.</p><div className="chat-suggestions">{chatSuggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void sendChatMessage(suggestion)} disabled={chatMutation.isPending || !selectedAgent}>{suggestion}</button>)}</div></div>}{(chatMutation.isPending || agentMutation.isPending) && <div className="chat-entry agent pending"><RiverActivity compact label="Studying the context" detail="Comparing assumptions and possible worlds" /></div>}{chatError && <div className="error" role="alert">{chatError}</div>}</div>
      <form className="chat-form" onSubmit={(event) => void submitChat(event)}>{chatMessages.length > 0 && <div className="chat-quick-actions">{chatSuggestions.map((suggestion) => <button type="button" key={suggestion} onClick={() => void sendChatMessage(suggestion)} disabled={chatMutation.isPending}>{suggestion}</button>)}</div>}{current?.model && <button className="chat-revise" type="submit" data-action="revise" disabled={chatMutation.isPending || agentMutation.isPending || analysisActive}>Propose model change</button>}<div className="chat-input-shell"><textarea name="chat" aria-label="Message the assistant" placeholder="Ask about the situation or selected branch…" rows={3} disabled={chatMutation.isPending || agentMutation.isPending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><span className="chat-enter-hint">Shift + Enter — new line</span><button className="chat-send icon" aria-label="Send message" title="Send" disabled={chatMutation.isPending || agentMutation.isPending || !selectedAgent}><Icon name="send" /></button></div></form>
    </aside>

    <dialog ref={promptDialog} onClose={() => setPrompt(undefined)}>
      <form className="dialog-form" onSubmit={(event) => void submitPrompt(event)}>
        <h2>{promptTitle}</h2>
        {prompt?.mode === "proposal" && prompt.proposal ? <ProposalEditor proposal={prompt.proposal} answers={answers} setAnswers={setAnswers} /> : <div><p>{promptHint}</p><textarea name="message" aria-label="Situation description" value={draftText} onChange={(event) => setDraftText(event.target.value)} autoFocus />{debouncedDraft && scenarioHints.isFetching && <RiverActivity compact label="Finding gaps" detail="Pi is checking what the model still needs" />}{researchingHints.length > 0 && debouncedDraft !== draftText.trim() && <RiverActivity compact label="Checking facts" detail={`Research tasks remaining: ${researchingHints.length}`} />}{debouncedDraft === draftText.trim() && scenarioHints.data?.hints.length ? <div className="prompt-hints"><span>Worth clarifying</span><ul>{scenarioHints.data.hints.map((hint) => { const researching = researchingHints.includes(hint); return <li key={hint}><span>{hint}</span><button className="hint-research quiet" type="button" disabled={busy || researching} onClick={() => void researchHint(hint)} aria-label={`Research: ${hint}`}><Icon name="search" />{researching ? "Researching…" : "Research"}</button></li>; })}</ul></div> : null}</div>}
        {busy && <RiverActivity compact label={workingLabel} detail={`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} · you can leave this window open`} />}
        {promptError && <div className="error" role="alert">{promptError}</div>}
        <div className="dialog-actions"><button type="button" onClick={() => setPrompt(undefined)} disabled={promptBusy}>Cancel</button><button className="primary" disabled={promptBusy}>{busy ? "Working…" : prompt?.mode === "proposal" ? "Looks right" : prompt?.mode === "create" ? "Continue" : prompt?.mode === "edit-brief" || prompt?.mode === "edit-context" ? "Save" : "Send to agent"}</button></div>
      </form>
    </dialog>

    <dialog className="model-dialog" ref={modelDialog}>
      <form className="dialog-form" onSubmit={(event) => void saveModel(event)}><div className="dialog-kicker">Current situation</div><h2>Run settings</h2><p>Parameters for the next run. You can usually leave them unchanged.</p><div className="advanced-field"><span>Pi for AI labeling</span><AgentPicker providers={agent.data?.providers ?? []} models={models} value={runAgentKey} onChange={setRunAgentKey} prefix="Labeling" /><small>The simulation remains deterministic; the selected Pi labels the resulting worlds.</small></div><label className="advanced-field"><span>Next run seed</span><input type="number" name="seed" min="1" max="2147483647" defaultValue={nextSeed} placeholder="Random" /><small>Leave this blank to generate a new seed automatically.</small></label><details className="developer-settings"><summary>Manual world model</summary><div className="eyebrow model-label">Model JSON</div><textarea className="code" value={modelText} onChange={(event) => setModelText(event.target.value)} spellCheck={false} aria-label="World model JSON" /></details>{modelError && <div className="error" role="alert">{modelError}</div>}<div className="dialog-actions"><button type="button" onClick={() => modelDialog.current?.close()}>Cancel</button><button className="primary" disabled={commandMutation.isPending || !parseSelection(runAgentKey, models)}>Save</button></div></form>
    </dialog>

    <dialog className="settings-dialog" ref={settingsDialog}>
      <form className="dialog-form" onSubmit={saveSettings}><header className="settings-header"><h2>Model and access</h2></header><div className="settings-content"><section className="settings-section"><div className="settings-section-title"><b>Default model</b></div><AgentPicker providers={agent.data?.providers ?? []} models={models} value={settingsAgentKey} onChange={setSettingsAgentKey} prefix="Default" />{!models.length && <div className="settings-hint">Add an API key to see available models.</div>}</section><section className="settings-section"><div className="settings-section-title"><b>API keys</b></div><div className="key-entry"><label><span>Provider</span><select aria-label="API key provider" value={keyProvider} onChange={(event) => setKeyProvider(event.target.value)}>{authProviders.map((provider) => <option value={provider.id} key={provider.id}>{provider.id === "openai" ? "OpenAI / ChatGPT API" : provider.name}</option>)}</select></label><label><span>API key</span><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void configureKey(); } }} placeholder={authProviders.find((provider) => provider.id === keyProvider)?.label ?? "API key"} aria-label="API key" autoComplete="off" spellCheck={false} /></label><button type="button" onClick={() => void configureKey()} disabled={!keyProvider || !apiKey.trim() || keyMutation.isPending}>Add</button></div>{keyError && <div className="error" role="alert">{keyError}</div>}<div className="key-list">{authProviders.filter((provider) => provider.configured).map((provider) => <div className="key-chip" key={provider.id}><i className="dot on" /><span>{provider.name}</span><small>{provider.source === "environment" ? "from environment" : "configured"}</small>{provider.source !== "environment" && <button type="button" className="icon quiet" onClick={() => void deleteKey(provider.id)} aria-label={`Delete ${provider.name} key`}><Icon name="close" /></button>}</div>)}</div></section></div><div className="dialog-actions"><button type="button" onClick={() => settingsDialog.current?.close()}>Cancel</button><button className="primary" disabled={!parseSelection(settingsAgentKey, models)}>Save</button></div></form>
    </dialog>
  </div>;
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
  return <div className="task-row"><Link to="/tasks/$taskId" params={{ taskId: item.id }} search={{}} className="task" activeProps={{ "aria-current": "page" }} onClick={onOpen}><b className="task-title">{item.title}</b><div className="task-meta"><span><i className={`status-dot ${item.status}`} />{statusName[item.status]}</span><time dateTime={item.updatedAt} title={compactDate(item.updatedAt)}>{relativeTime(item.updatedAt, now)}</time></div></Link><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete world “${item.title}”`} disabled={item.status === "running" || item.status === "labeling"}><Icon name="trash" /></button></div>;
}

function ErrorState({ error, retry }: { error: Error; retry: () => void }) {
  return <div className="load-error" role="alert"><span>{error.message}</span><button onClick={retry}>Retry</button></div>;
}

function Clarifications({ current, onEdit, onRefresh }: { current: TaskState; onEdit: (index: number) => void; onRefresh: (focus?: TaskDecision) => void }) {
  const notes = current.context.map((text, index) => ({ text, index })).filter((item) => !item.text.startsWith("The user confirmed the following assumptions.") && !item.text.startsWith("Пользователь утвердил следующие допущения."));
  const legacy = current.context.length - notes.length, assumptions = current.assumptions ?? [];
  if (!notes.length && !assumptions.length && !legacy) return null;
  return <details className="clarifications"><summary><span className="eyebrow">Context</span></summary><div className="clarification-list">{assumptions.map((item) => <div className="clarification" key={item.id}><div><small>{item.prompt}</small><span>{item.answer}</span></div><button className="inline-edit" onClick={() => onRefresh(item)} aria-label="Edit assumption"><Icon name="edit" /></button></div>)}{notes.map((item) => <div className="clarification" key={item.index}><span>{item.text}</span><button className="inline-edit" onClick={() => onEdit(item.index)} aria-label="Edit context"><Icon name="edit" /></button></div>)}{legacy > 0 && <div className="clarification legacy-note"><span>{legacy} legacy {word(legacy, "item", "items", "items")} need to be updated.</span><button className="inline-refresh" onClick={() => onRefresh()} aria-label="Update legacy context"><Icon name="refresh" /></button></div>}</div></details>;
}

function ProposalCard({ proposal, onOpen, onRefresh, onReject }: { proposal: Proposal; onOpen: () => void; onRefresh: () => void; onReject: () => void }) {
  const legacy = proposal.sources === undefined, count = proposal.decisions?.length ?? proposal.questions?.length ?? 0, sources = proposal.sources?.length ?? 0;
  return <div className="proposal"><div className="eyebrow">{legacy ? "Update required" : "The agent's understanding"}</div><p>{legacy ? "This understanding uses an older technical format. Pi can rewrite it in plain English and verify the facts." : proposal.explanation}</p>{!legacy && <div className="proposal-count">{count ? `${count} ${word(count, "item", "items", "items")} to review` : "Ready to continue"}{sources ? ` · ${sources} ${word(sources, "source", "sources", "sources")}` : ""}</div>}<div className="actions"><button className="primary" onClick={legacy ? onRefresh : onOpen}>{legacy ? "Update with research" : "Review"}</button><button className="danger" onClick={onReject}>Reject</button></div></div>;
}

function ProposalEditor({ proposal, answers, setAnswers }: { proposal: Proposal; answers: Record<string, string>; setAnswers: (value: Record<string, string>) => void }) {
  const decisions = proposal.decisions ?? [];
  return <><p className="proposal-copy">{proposal.explanation}</p>{proposal.sources?.length ? <div className="sources">{proposal.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</div> : null}<div className="decision-grid">{decisions.length ? decisions.map((decision) => <label className="decision" key={decision.id}><small>{decision.prompt}</small><input list={`options-${decision.id}`} value={answers[decision.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [decision.id]: event.target.value })} /><datalist id={`options-${decision.id}`}>{[decision.answer, ...decision.alternatives].filter(Boolean).map((option) => <option value={option} key={option} />)}</datalist></label>) : <div className="empty-runs">Everything needed is already clear.</div>}</div></>;
}

function RunCard({ analysis, currentRevision, selected, onClick, onDelete }: { analysis: TaskState["analyses"][number]; currentRevision: number; selected: boolean; onClick: () => void; onDelete: () => void }) {
  const board = Object.keys(analysis.winPctTeam).length < Object.keys(analysis.winPct).length ? analysis.winPctTeam : analysis.winPct;
  const leader = Object.entries(board).sort((a, b) => b[1] - a[1])[0], stale = analysis.revision !== currentRevision;
  const cooperation = Math.round(analysis.cooperation.mean * 100);
  return <div className="run-row"><button className={`run-item ${stale ? "stale" : ""}`} aria-current={selected} onClick={onClick}><div className="run-top"><b>{analysis.trials} {word(analysis.trials, "world", "worlds", "worlds")}</b><span>{compactDate(analysis.completedAt)}</span></div><div className="run-summary"><div className="run-metric"><strong>{cooperation}%</strong><span>cooperation</span></div><span className="run-revision">{stale ? "outdated" : `r${analysis.revision}`}</span></div><div className="run-bar"><i style={{ width: `${cooperation}%` }} /></div><div className="run-footer">{leader ? <span className="run-leader">{leader[0]} · {Math.round(leader[1])}% wins</span> : <span className="run-leader">No clear leader</span>}<span>seed {analysis.seed}</span></div></button><button className="icon quiet row-delete" onClick={onDelete} aria-label={`Delete run with ${analysis.trials} worlds`}><Icon name="trash" /></button></div>;
}
