import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, extname, join, resolve } from "node:path";
import { Worker } from "node:worker_threads";
import { CategoryId, EntityId, SequenceNr } from "@lambda-house/teob-ts/core";
import { createInMemoryProjectionStore, runProjection } from "@lambda-house/teob-ts/projection";
import { createSqliteRuntime, registration } from "@lambda-house/teob-ts/sqlite";
import type { ScenarioModel } from "./domain.js";
import { agentThinkingLevels, type AgentSelection } from "./agent-contracts.js";
import { getAgentAvailability, removeProviderApiKey, saveProviderApiKey } from "./pi-agent.js";
import { buildScenarioModel, labelWorlds, routeMessage, understandSituation } from "./scenario-agent.js";
import { taskDetailProjection, taskSummaryProjection, type TaskSummary } from "./task-projections.js";
import { generateWorldsVisual, injectWorldLabels, type WorldLabelNode, type WorldLabels } from "./worlds-report.js";
import {
  taskAggregate, taskCategory, taskEventCodec, taskStateCodec,
  type Fact, type FactKind, type TaskAnalysis, type TaskCommand, type TaskReply, type TaskState,
} from "./task.js";
import { replayScenarioWorld, type RiverArtifact, type ScenarioResult, type Trial } from "./analysis.js";
import { fitPosterior, type Observation } from "./abc.js";

const root = resolve(process.cwd());
const databasePath = resolve(process.env.APP_DB_PATH ?? join(root, "data", "app.db"));
const reportDirectory = resolve(root, "reports", "tasks");
const appDirectory = resolve(root, "app", "dist");
const port = Number(process.env.PORT ?? 4317);
const analysisTimeoutMs = Math.max(1_000, Number(process.env.ANALYSIS_TIMEOUT_MS) || 300_000);
await mkdir(dirname(databasePath), { recursive: true });
await mkdir(reportDirectory, { recursive: true });

const { runtime, journal } = createSqliteRuntime(
  { path: databasePath },
  [registration(taskAggregate, taskEventCodec, taskStateCodec)],
);
await runtime.start();
const views = createInMemoryProjectionStore();
const listeners = new Map<string, Set<ServerResponse>>();
const analysisJobs = new Map<string, AbortController>();

function refresh(): void {
  runProjection(taskDetailProjection, journal, views, { eventCodec: taskEventCodec });
  runProjection(taskSummaryProjection, journal, views, { eventCodec: taskEventCodec });
}
refresh();

function detail(id: string): TaskState | undefined {
  return views.get<TaskState>(taskDetailProjection.projectionId, id)?.view;
}

function summaries(): TaskSummary[] {
  return views.list<TaskSummary>(taskSummaryProjection.projectionId)
    .map(({ view }) => view)
    .filter((view) => !view.deleted)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

async function removeReport(assetUrl: string): Promise<void> {
  const fileName = assetUrl.match(/^\/reports\/tasks\/([a-zA-Z0-9._-]+\.(?:html|json))$/)?.[1];
  if (fileName) await unlink(join(reportDirectory, fileName)).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
}

async function readRiverArtifact(artifactUrl: string): Promise<RiverArtifact> {
  const fileName = artifactUrl.match(/^\/reports\/tasks\/([a-zA-Z0-9._-]+\.json)$/)?.[1];
  if (!fileName) throw new Error("Invalid river artifact path");
  const parsed: unknown = JSON.parse(await readFile(join(reportDirectory, fileName), "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid river artifact");
  const artifact = parsed as Partial<RiverArtifact>;
  if (artifact.schemaVersion !== 1 || !artifact.model || !Number.isSafeInteger(artifact.seed) || !Array.isArray(artifact.trials)) throw new Error("Unsupported river artifact");
  return artifact as RiverArtifact;
}

/** fitPosterior only reads `trials` and the key sets of `winPct`/`winPctTeam`, so a stored artifact reconstructs a usable result with no re-simulation. */
function resultFromArtifact(artifact: RiverArtifact): ScenarioResult {
  const teamOf = (player: { name: string; team?: string }) => player.team ?? player.name;
  const winPct = Object.fromEntries(artifact.model.players.map((p) => [p.name, 0]));
  const winPctTeam = Object.fromEntries(artifact.model.players.map((p) => [teamOf(p), 0]));
  return { trials: artifact.trials, winPct, winPctTeam, winPctPerCapita: winPctTeam, cooperation: { mean: 0, std: 0 }, sensitivity: [], sensitivityWin: [], sensitivityWinTarget: "" };
}

function observationFrom(input: Record<string, unknown>, model: RiverArtifact["model"]): Observation {
  const names = new Set(model.players.map((p) => p.name));
  const teams = new Set(model.players.map((p) => p.team ?? p.name));
  const obs: Observation = {};
  if (input.cooperation !== undefined && input.cooperation !== null) {
    const c = Number(input.cooperation);
    if (!(c >= 0 && c <= 1)) throw new Error("cooperation must be between 0 and 1");
    obs.cooperation = c;
  }
  if (input.winner) { const w = String(input.winner); if (!names.has(w) && !teams.has(w)) throw new Error(`unknown winner ${w}`); obs.winner = w; }
  if (input.regime) obs.regime = String(input.regime);
  if (input.coopTolerance !== undefined) { const t = Number(input.coopTolerance); if (!(t > 0 && t <= 1)) throw new Error("coopTolerance must be within (0, 1]"); obs.coopTolerance = t; }
  if (input.playerCooperation && typeof input.playerCooperation === "object" && !Array.isArray(input.playerCooperation)) {
    const pc: Record<string, number> = {};
    for (const [name, value] of Object.entries(input.playerCooperation as Record<string, unknown>)) {
      if (!names.has(name)) throw new Error(`unknown player ${name}`);
      const n = Number(value);
      if (!(n >= 0 && n <= 1)) throw new Error(`cooperation for ${name} must be between 0 and 1`);
      pc[name] = n;
    }
    if (Object.keys(pc).length) obs.playerCooperation = pc;
  }
  return obs;
}

/**
 * The outcome facts that condition a run, validated against that run's own model so a fact naming a
 * player who no longer exists is skipped rather than rejecting the whole request.
 */
function outcomeObservations(state: TaskState, artifact: RiverArtifact): Observation[] {
  const names = new Set(artifact.model.players.map((player) => player.name));
  const teams = new Set(artifact.model.players.map((player) => player.team ?? player.name));
  return state.facts.flatMap((fact) => {
    if (fact.kind !== "outcome" || !fact.observation) return [];
    const value: Record<string, unknown> = { ...fact.observation };
    if (typeof value.winner === "string" && !names.has(value.winner) && !teams.has(value.winner)) delete value.winner;
    if (value.playerCooperation) value.playerCooperation = Object.fromEntries(Object.entries(value.playerCooperation as Record<string, number>).filter(([name]) => names.has(name)));
    try { return [observationFrom(value, artifact.model)]; } catch { return []; }
  });
}

/** Reweight a run to its accumulated observations, dropping the large per-world weights from the reply. */
function runPosterior(artifact: RiverArtifact, observations: readonly Observation[]) {
  const result = resultFromArtifact(artifact);
  const usesTeams = new Set(artifact.model.players.map((p) => p.team ?? p.name)).size !== artifact.model.players.length;
  const trim = ({ weights: _weights, ...view }: ReturnType<typeof fitPosterior>) => view;
  return { usesTeams, baseline: trim(fitPosterior(result, {})), posterior: trim(fitPosterior(result, observations)) };
}

function sampledRounds(rounds: NonNullable<Trial["trace"]>["matches"][number]["rounds"], limit: number) {
  const indexed = rounds.map((round, index) => ({ round: index + 1, ...round }));
  if (indexed.length <= limit) return indexed;
  const head = Math.ceil(limit / 2);
  return [...indexed.slice(0, head), ...indexed.slice(indexed.length - (limit - head))];
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function sendAppFile(res: ServerResponse, fileName: string): Promise<void> {
  const types: Record<string, string> = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".svg": "image/svg+xml" };
  const content = await readFile(join(appDirectory, fileName));
  res.writeHead(200, {
    "content-type": types[extname(fileName)] ?? "application/octet-stream",
    "cache-control": fileName === "index.html" ? "no-store" : "public, max-age=31536000, immutable",
  });
  res.end(content);
}

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (!chunks.length) return {};
  if (chunks.reduce((n, c) => n + c.length, 0) > 1_000_000) throw new Error("Request is too large");
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object expected");
  return parsed as Record<string, unknown>;
}

async function ask(id: string, command: TaskCommand): Promise<TaskReply> {
  const result = await runtime.ask(EntityId(id), command, taskCategory);
  if (!result.ok) throw new Error(result.error.tag === "General" ? result.error.message : result.error.tag);
  const answer = result.value.reply;
  if (!answer) throw new Error("Task did not reply");
  refresh();
  notify(id);
  return answer;
}

function notify(id: string): void {
  const payload = `data: ${JSON.stringify({ type: "changed", id })}\n\n`;
  for (const response of listeners.get(id) ?? []) response.write(payload);
}

const factKind = (value: unknown): FactKind => {
  if (value !== "situation" && value !== "outcome") throw new Error("A fact is either about the situation or about what happened");
  return value;
};

function commandFrom(input: Record<string, unknown>): TaskCommand {
  const now = new Date().toISOString();
  switch (input.tag) {
    case "AddFact": return { tag: "AddFact", factId: randomUUID(), text: String(input.text ?? ""), kind: factKind(input.kind ?? "outcome"), source: "user", now };
    case "EditFact": return { tag: "EditFact", factId: String(input.factId ?? ""), text: String(input.text ?? ""), now };
    case "RemoveFact": return { tag: "RemoveFact", factId: String(input.factId ?? ""), now };
    case "SetSituation": return { tag: "SetSituation", text: String(input.text ?? ""), now };
    case "SetModel": return { tag: "SetModel", model: input.model as ScenarioModel, now };
    case "DismissQuestion": return { tag: "DismissQuestion", questionId: String(input.questionId ?? ""), now };
    case "RemoveAnalysis": return { tag: "RemoveAnalysis", analysisId: String(input.analysisId ?? ""), now };
    case "DeleteTask": return { tag: "DeleteTask", now };
    case "CancelAnalysis": return { tag: "CancelAnalysis", now };
    default: throw new Error("Unknown command");
  }
}

function agentSelection(input: unknown, fallback?: AgentSelection): AgentSelection | undefined {
  if (input === undefined || input === null) return fallback;
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Agent selection must be an object");
  const value = input as Record<string, unknown>;
  const provider = String(value.provider ?? "").trim();
  const model = String(value.model ?? "").trim();
  const thinkingLevel = String(value.thinkingLevel ?? "medium");
  if (!provider || !model || !agentThinkingLevels.some((level) => level === thinkingLevel)) throw new Error("Invalid Pi agent selection");
  return { provider, model, thinkingLevel: thinkingLevel as AgentSelection["thinkingLevel"] };
}

const agentFor = (state: TaskState, input?: unknown): AgentSelection | undefined => agentSelection(input, state.agent);

function analysisWorker(model: ScenarioModel, trials: number, seed: number, signal: AbortSignal): Promise<{ html: string; labelNodes: WorldLabelNode[]; artifact: RiverArtifact; summary: Omit<TaskAnalysis, "revision" | "visualUrl" | "completedAt"> }> {
  return new Promise((resolvePromise, reject) => {
    const worker = new Worker(new URL("./analysis-worker.ts", import.meta.url), { workerData: { model, trials, seed } });
    let settled = false;
    const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener("abort", abort); action(); };
    const abort = () => { void worker.terminate(); finish(() => reject(new Error("Analysis was cancelled"))); };
    const timer = setTimeout(() => { void worker.terminate(); finish(() => reject(new Error(`Analysis timed out after ${analysisTimeoutMs}ms`))); }, analysisTimeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    worker.once("message", (message: { ok: boolean; html?: string; labelNodes?: WorldLabelNode[]; artifact?: RiverArtifact; summary?: Omit<TaskAnalysis, "revision" | "visualUrl" | "completedAt">; error?: string }) => {
      if (message.ok && message.html && message.labelNodes && message.artifact && message.summary) finish(() => resolvePromise({ html: message.html!, labelNodes: message.labelNodes!, artifact: message.artifact!, summary: message.summary! }));
      else finish(() => reject(new Error(message.error ?? "Analysis failed")));
    });
    worker.once("error", (error) => finish(() => reject(error)));
    worker.once("exit", (code) => finish(() => reject(new Error(`Analysis worker exited before returning a result (${code})`))));
    if (signal.aborted) abort();
  });
}

async function labelAnalysis(id: string, analysis: TaskAnalysis, model: ScenarioModel, agent: AgentSelection | undefined, signal: AbortSignal, html: string, nodes: readonly WorldLabelNode[]): Promise<void> {
  let worldLabels: WorldLabels = {};
  let agentMeta;
  try {
    const labeled = await labelWorlds(model, nodes, agent, signal);
    worldLabels = labeled.labels;
    agentMeta = labeled.meta;
    if (!signal.aborted) await writeFile(join(reportDirectory, analysis.visualUrl.split("/").at(-1)!), injectWorldLabels(html, worldLabels), "utf8");
  } catch (error) {
    if (signal.aborted) return;
    console.warn("Pi world labels unavailable:", error instanceof Error ? error.message : String(error));
  }
  if (!signal.aborted) await ask(id, { tag: "CompleteAnalysisLabels", analysisId: analysis.id!, worldLabels, ...(agentMeta ? { agentMeta } : {}), now: new Date().toISOString() });
}

async function resumeAnalysisLabels(id: string, analysis: TaskAnalysis, model: ScenarioModel, agent: AgentSelection | undefined, signal: AbortSignal): Promise<void> {
  try {
    const result = await analysisWorker(model, analysis.trials, analysis.seed, signal);
    if (!signal.aborted) await labelAnalysis(id, analysis, model, agent, signal, result.html, result.labelNodes);
  } catch (error) {
    if (signal.aborted) return;
    console.warn("Analysis label recovery unavailable:", error instanceof Error ? error.message : String(error));
    await ask(id, { tag: "CompleteAnalysisLabels", analysisId: analysis.id!, worldLabels: {}, now: new Date().toISOString() });
  }
}

/**
 * The stored model is the source of truth: if the task already has one, return it as-is. Only when
 * the task has no model yet do we build one from the situation prose and store it. Outcome facts are
 * never part of the build — they reweight the finished run instead.
 */
async function modelForRun(id: string, agent: AgentSelection | undefined, now: string): Promise<ScenarioModel> {
  const state = detail(id);
  if (!state) throw new Error("Task not found");
  if (state.model) return state.model;
  const built = await buildScenarioModel(state.situation, undefined, agent);
  const stored = await ask(id, { tag: "SetModel", model: built.model, agent: built.agent, now });
  if (stored.tag === "Rejected") throw new Error(stored.reason);
  return built.model;
}

async function runAnalysis(id: string, requested: { revision: number; trials: number; seed: number; agent?: AgentSelection }, signal: AbortSignal): Promise<void> {
  const unrecordedAssets: string[] = [];
  try {
    const state = detail(id);
    if (!state) throw new Error("Task not found");
    const agent = requested.agent ?? state.agent;
    const model = await modelForRun(id, agent, new Date().toISOString());
    if (signal.aborted) return;
    const result = await analysisWorker(model, requested.trials, requested.seed, signal);
    if (signal.aborted) return;
    const analysisId = randomUUID();
    const fileName = `${id}-r${requested.revision}-${requested.trials}w-${requested.seed}-${analysisId}.html`;
    const artifactName = fileName.replace(/\.html$/, ".json");
    await writeFile(join(reportDirectory, fileName), result.html, "utf8");
    unrecordedAssets.push(`/reports/tasks/${fileName}`);
    await writeFile(join(reportDirectory, artifactName), JSON.stringify(result.artifact), "utf8");
    unrecordedAssets.push(`/reports/tasks/${artifactName}`);
    const analysis: TaskAnalysis = { ...result.summary, id: analysisId, revision: requested.revision, visualUrl: `/reports/tasks/${fileName}`, artifactUrl: `/reports/tasks/${artifactName}`, completedAt: new Date().toISOString() };
    const recorded = await ask(id, { tag: "RecordAnalysis", analysis });
    if (recorded.tag === "Rejected") throw new Error(recorded.reason);
    unrecordedAssets.length = 0;
    await labelAnalysis(id, analysis, model, agent, signal, result.html, result.labelNodes);
  } catch (error) {
    await Promise.all(unrecordedAssets.map(removeReport));
    if (!signal.aborted) await ask(id, { tag: "FailAnalysis", revision: requested.revision, reason: error instanceof Error ? error.message : String(error), now: new Date().toISOString() });
  }
}

function startAnalysis(id: string, requested: NonNullable<TaskState["activeAnalysis"]>): void {
  const controller = new AbortController();
  analysisJobs.set(id, controller);
  const state = detail(id);
  const work = requested.analysisId && state?.model
    ? resumeAnalysisLabels(id, state.analyses.find((analysis) => analysis.id === requested.analysisId)!, state.model, requested.agent ?? state.agent, controller.signal)
    : runAnalysis(id, requested, controller.signal);
  void work.finally(() => { if (analysisJobs.get(id) === controller) analysisJobs.delete(id); });
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (req.method === "GET" && (url.pathname === "/" || /^\/tasks\/[a-f0-9-]+$/.test(url.pathname))) {
    await sendAppFile(res, "index.html"); return;
  }
  const assetMatch = url.pathname.match(/^\/assets\/([a-zA-Z0-9._-]+)$/);
  if (req.method === "GET" && assetMatch?.[1]) {
    await sendAppFile(res, join("assets", assetMatch[1])); return;
  }
  if (req.method === "GET" && (url.pathname === "/api/agent/status" || url.pathname === "/api/claude/status")) {
    const status = await getAgentAvailability();
    send(res, 200, { ...status, detail: status.available ? "Pi agent connected" : status.error ?? "Configure Pi authentication" }); return;
  }
  if (url.pathname === "/api/agent/credentials" && (req.method === "POST" || req.method === "DELETE")) {
    const input = await body(req); const provider = String(input.provider ?? "").trim();
    if (req.method === "POST") await saveProviderApiKey(provider, String(input.apiKey ?? ""));
    else await removeProviderApiKey(provider);
    const status = await getAgentAvailability();
    send(res, 200, { ...status, detail: status.available ? "Pi agent connected" : status.error ?? "Add an API key" }); return;
  }
  if (req.method === "GET" && url.pathname === "/api/tasks") { send(res, 200, summaries()); return; }
  if (req.method === "POST" && url.pathname === "/api/tasks") {
    const input = await body(req); const id = randomUUID();
    const answer = await ask(id, { tag: "CreateTask", taskId: id, text: String(input.text ?? ""), factId: randomUUID(), now: new Date().toISOString() });
    send(res, answer.tag === "Rejected" ? 422 : 201, answer.tag === "Rejected" ? answer : detail(id)); return;
  }
  const replayMatch = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)\/analyses\/([a-f0-9-]+)\/worlds\/(\d+)\/replay$/);
  if (req.method === "GET" && replayMatch) {
    const [, taskId = "", analysisId = "", indexText = ""] = replayMatch;
    const state = detail(taskId);
    if (!state || state.deleted) { send(res, 404, { error: "Task not found" }); return; }
    const analysis = state.analyses.find((candidate) => (candidate.id ?? candidate.visualUrl) === analysisId);
    if (!analysis) { send(res, 404, { error: "Analysis not found" }); return; }
    if (!analysis.artifactUrl) { send(res, 409, { error: "Replay is unavailable for this legacy run. Run the river again to enable it." }); return; }
    const index = Number(indexText);
    const artifact = await readRiverArtifact(analysis.artifactUrl);
    const stored = artifact.trials[index];
    if (!stored) { send(res, 404, { error: "World not found" }); return; }
    const replayed = replayScenarioWorld(artifact.model, artifact.seed, index, stored.digest.pivotalPair);
    const exact = JSON.stringify(replayed.digest) === JSON.stringify(stored.digest);
    const requestedLimit = Number(url.searchParams.get("limit") ?? 160);
    const limit = Number.isFinite(requestedLimit) ? Math.min(400, Math.max(20, Math.floor(requestedLimit))) : 160;
    const match = replayed.trace?.matches[0];
    send(res, 200, {
      worldId: `world-${index + 1}`,
      index,
      exact,
      stored: {
        winners: stored.winners,
        cooperation: stored.cooperation,
        inputs: stored.inputs,
        scores: stored.scores,
        rounds: stored.rounds,
        digest: stored.digest,
      },
      replay: {
        winners: replayed.winners,
        cooperation: replayed.cooperation,
        inputs: replayed.inputs,
        scores: replayed.scores,
        rounds: replayed.rounds,
        digest: replayed.digest,
        trace: match ? {
          a: match.a,
          b: match.b,
          totalRounds: match.rounds.length,
          truncated: match.rounds.length > limit,
          rounds: sampledRounds(match.rounds, limit),
        } : undefined,
      },
    });
    return;
  }
  const posteriorMatch = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)\/analyses\/([a-f0-9-]+)\/posterior$/);
  if (req.method === "GET" && posteriorMatch) {
    const [, taskId = "", analysisId = ""] = posteriorMatch;
    const state = detail(taskId);
    if (!state || state.deleted) { send(res, 404, { error: "Task not found" }); return; }
    const analysis = state.analyses.find((candidate) => (candidate.id ?? candidate.visualUrl) === analysisId);
    if (!analysis) { send(res, 404, { error: "Run not found" }); return; }
    if (!analysis.artifactUrl) { send(res, 200, { usesTeams: false, baseline: null, posterior: null }); return; }
    const artifact = await readRiverArtifact(analysis.artifactUrl);
    const view = runPosterior(artifact, outcomeObservations(state, artifact));
    send(res, 200, view);
    return;
  }
  const match = url.pathname.match(/^\/api\/tasks\/([a-f0-9-]+)(?:\/(commands|chat|understand|run|events|activity))?$/);
  if (match) {
    const id = match[1] ?? ""; const action = match[2];
    if (req.method === "GET" && !action) { const state = detail(id); send(res, state && !state.deleted ? 200 : 404, state && !state.deleted ? state : { error: "Task not found" }); return; }
    if (req.method === "GET" && action === "activity") { send(res, 200, journal.loadEvents(CategoryId("scenario-task"), EntityId(id), SequenceNr(0), taskEventCodec)); return; }
    if (req.method === "GET" && action === "events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" }); res.write("retry: 1500\n\n");
      const group = listeners.get(id) ?? new Set<ServerResponse>(); group.add(res); listeners.set(id, group);
      req.on("close", () => { group.delete(res); if (!group.size) listeners.delete(id); }); return;
    }
    if (req.method === "POST" && action === "commands") {
      const command = commandFrom(await body(req));
      const before = detail(id);
      const removed = command.tag === "RemoveAnalysis" ? before?.analyses.find((analysis) => (analysis.id ?? analysis.visualUrl) === command.analysisId) : undefined;
      const assetsOf = (analysis: TaskAnalysis) => [analysis.visualUrl, analysis.artifactUrl].filter((value): value is string => !!value);
      const reports = command.tag === "DeleteTask" ? before?.analyses.flatMap(assetsOf) ?? [] : removed ? assetsOf(removed) : [];
      const answer = await ask(id, command);
      if (answer.tag === "Accepted") await Promise.all(reports.map(removeReport));
      if (answer.tag === "Accepted" && command.tag === "CancelAnalysis") analysisJobs.get(id)?.abort();
      send(res, answer.tag === "Rejected" ? 409 : 200, answer.tag === "Rejected" ? answer : detail(id)); return;
    }
    // One Run: use the stored model (building it once from the situation prose if none exists), then simulate and label.
    if (req.method === "POST" && action === "run") {
      const input = await body(req); const state = detail(id);
      if (!state || state.deleted) { send(res, 404, { error: "Task not found" }); return; }
      const agent = agentFor(state, input.agent);
      const trials = Number(input.trials ?? state.analyses.at(-1)?.trials ?? 600);
      const seed = Number(input.seed ?? Math.floor(Math.random() * 2_000_000_000) + 1);
      const answer = await ask(id, { tag: "RequestAnalysis", trials, seed, ...(agent ? { agent } : {}), now: new Date().toISOString() });
      if (answer.tag !== "Accepted") { send(res, 409, answer); return; }
      startAnalysis(id, { revision: answer.revision, trials, seed, ...(agent ? { agent } : {}) });
      send(res, 200, detail(id)); return;
    }
    // Read the situation and let the agent build the model, plus the questions it cannot answer.
    if (req.method === "POST" && action === "understand") {
      const input = await body(req); const state = detail(id);
      if (!state || state.deleted) { send(res, 404, { error: "Task not found" }); return; }
      if (!state.situation.trim()) { send(res, 409, { error: "Describe the situation first" }); return; }
      const understanding = await understandSituation(state.situation, state.model, agentFor(state, input.agent));
      const now = new Date().toISOString();
      await ask(id, { tag: "SetTitle", title: understanding.title, now });
      await ask(id, { tag: "SetModel", model: understanding.model, agent: understanding.agent, now });
      await ask(id, { tag: "SuggestQuestions", questions: understanding.questions.map((q) => ({ id: randomUUID(), prompt: q.prompt, ...(q.field ? { field: q.field } : {}) })), now });
      send(res, 200, detail(id)); return;
    }
    // The single conversational entry point: a question is answered, a fact is filed by kind.
    if (req.method === "POST" && action === "chat") {
      const input = await body(req); const state = detail(id);
      if (!state || state.deleted) { send(res, 404, { error: "Task not found" }); return; }
      const message = String(input.message ?? "").trim();
      if (!message || message.length > 4_000) { send(res, 422, { error: "The message is empty or too long" }); return; }
      const agent = agentFor(state, input.agent);
      const analysis = state.analyses.at(-1);
      const routed = await routeMessage(state.facts, state.model, message, analysis?.report ?? "no run yet", agent);
      if (routed.kind === "answer") { send(res, 200, { kind: "answer", message: routed.message }); return; }
      const now = new Date().toISOString();
      const observation = routed.kind === "outcome" && analysis?.artifactUrl
        ? observationFrom({ ...routed.observation }, (await readRiverArtifact(analysis.artifactUrl)).model)
        : undefined;
      const added = await ask(id, { tag: "AddFact", factId: randomUUID(), text: message, kind: routed.kind, source: "user", ...(observation ? { observation } : {}), now });
      if (added.tag === "Rejected") { send(res, 409, added); return; }
      let note = "";
      if (routed.kind === "outcome" && analysis?.artifactUrl) {
        const artifact = await readRiverArtifact(analysis.artifactUrl);
        const fresh = detail(id)!;
        const view = runPosterior(artifact, outcomeObservations(fresh, artifact));
        const baseWin = view.usesTeams ? view.baseline.winPctTeam : view.baseline.winPct;
        const postWin = view.usesTeams ? view.posterior.winPctTeam : view.posterior.winPct;
        const shares = Object.keys(postWin).sort((a, b) => (postWin[b] ?? 0) - (postWin[a] ?? 0))
          .map((name) => `- ${name}: ${Math.round(baseWin[name] ?? 0)}% → ${Math.round(postWin[name] ?? 0)}%`).join("\n");
        const count = fresh.facts.filter((fact) => fact.kind === "outcome").length;
        const fit = view.posterior.fit < 0.05 ? `\n\n_Unlikely under the current facts (${Math.round(view.posterior.fit * 100)}% fit) — the situation facts may be worth revisiting._` : "";
        note = `\n\n**Reweighted** — ${Math.round(view.posterior.effectiveSampleSize)} of ${analysis.trials} worlds match${count > 1 ? ` across ${count} outcome facts` : ""}. Cooperation ${Math.round(view.baseline.cooperation.mean * 100)}% → ${Math.round(view.posterior.cooperation.mean * 100)}%.\n${shares}${fit}`;
      }
      send(res, 200, { kind: routed.kind, message: `${routed.message}${note}`, task: detail(id) }); return;
    }
  }
  const reportMatch = url.pathname.match(/^\/reports\/tasks\/([a-f0-9-]+-r\d+(?:-\d+w)?--?\d+(?:-[a-f0-9-]+)?\.html)$/);
  if (req.method === "GET" && reportMatch?.[1]) {
    try {
      const visualUrl = `/reports/tasks/${reportMatch[1]}`;
      const analysis = summaries().flatMap((summary) => detail(summary.id)?.analyses ?? []).find((candidate) => candidate.visualUrl === visualUrl);
      let html: string | Buffer;
      if (analysis?.artifactUrl) {
        const artifact = await readRiverArtifact(analysis.artifactUrl);
        html = injectWorldLabels(generateWorldsVisual(artifact.model, analysis.trials, analysis.seed, artifact), analysis.worldLabels ?? {});
      } else html = await readFile(join(reportDirectory, reportMatch[1]));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(html);
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; res.writeHead(404).end(); }
    return;
  }
  send(res, 404, { error: "Not found" });
}

function httpError(error: unknown): { status: number; code: string; error: string } {
  const message = error instanceof Error ? error.message : String(error);
  if (/timed out/i.test(message)) return { status: 504, code: "AGENT_TIMEOUT", error: message };
  if (/did not call|schema|draft mode|cannot satisfy/i.test(message)) return { status: 502, code: "AGENT_INVALID_OUTPUT", error: message };
  if (/not authenticated|No authenticated|provider error/i.test(message)) return { status: 503, code: "AGENT_UNAVAILABLE", error: message };
  if (/invalid|unknown|expected|required|must/i.test(message)) return { status: 422, code: "INVALID_REQUEST", error: message };
  return { status: 500, code: "INTERNAL_ERROR", error: message };
}

const server = createServer((req, res) => { route(req, res).catch((error) => { const failure = httpError(error); send(res, failure.status, failure); }); });
server.listen(port, "127.0.0.1", () => console.log(`Scenario workspace: http://127.0.0.1:${port}`));

for (const summary of summaries()) {
  const state = detail(summary.id);
  if ((state?.status === "running" || state?.status === "labeling") && state.activeAnalysis) startAnalysis(state.id, state.activeAnalysis);
}

async function close(): Promise<void> { server.close(); for (const job of analysisJobs.values()) job.abort(); await runtime.shutdown(); journal.close(); }
process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
