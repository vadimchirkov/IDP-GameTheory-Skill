import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { appendForecastRecord, readForecastLedger } from "./forecast-ledger.js";
import { summarizeForecasts, type CategoricalForecastSnapshot, type ForecastResolution } from "./forecast.js";
import { isPolymarket } from "./model.js";
import { fetchPolymarketMarket, polymarketForecastSnapshot, polymarketResolution } from "./adapters/polymarket-live.js";

const args = process.argv.slice(2);
const command = args[0];
const flag = (name: string): string | undefined => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const ledgerPath = resolve(flag("--ledger") ?? "data/forecasts.jsonl");
const modelsPath = resolve(flag("--models") ?? "markets/polymarket");

async function snapshotModel(modelPath: string): Promise<unknown> {
  const model: unknown = JSON.parse(await readFile(modelPath, "utf8"));
  if (!isPolymarket(model)) throw new Error(`${modelPath}: expected a Polymarket model`);
  const marketId = model.model.markets[0]?.id;
  if (!marketId) throw new Error(`${modelPath}: model has no market id`);
  const live = await fetchPolymarketMarket(marketId);
  const snapshot = polymarketForecastSnapshot(model, live);
  await appendForecastRecord(ledgerPath, snapshot);
  return { file: modelPath, id: snapshot.id, question: snapshot.question, probabilities: snapshot.probabilities, baseline: snapshot.baselineProbabilities };
}

async function batch(): Promise<void> {
  const files = (await readdir(modelsPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => resolve(modelsPath, entry.name));
  const records = await readForecastLedger(ledgerPath);
  const resolved = new Set(records.flatMap((record) => record.kind === "resolution" ? [record.snapshotId] : []));
  const pendingMarkets = new Set(records.filter((record): record is CategoricalForecastSnapshot => record.kind === "categorical" && !resolved.has(record.id))
    .map((record) => String(record.metadata?.marketId ?? "")));
  const snapshots: unknown[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const model = JSON.parse(await readFile(file, "utf8")) as { model?: { markets?: Array<{ id?: string }> } };
    const marketId = model.model?.markets?.[0]?.id ?? "";
    if (pendingMarkets.has(marketId)) { skipped.push(file); continue; }
    snapshots.push(await snapshotModel(file));
  }
  console.log(JSON.stringify({ ledger: ledgerPath, models: files.length, snapshots, skipped }, null, 2));
}

async function syncLedger(): Promise<{ checked: number; resolved: number; errors: Array<{ id: string; error: string }> }> {
  const records = await readForecastLedger(ledgerPath);
  const resolved = new Set(records.flatMap((record) => record.kind === "resolution" ? [record.snapshotId] : []));
  const pending = records.filter((record): record is CategoricalForecastSnapshot => record.kind === "categorical" && record.adapter === "polymarket" && !resolved.has(record.id));
  let added = 0;
  const errors: Array<{ id: string; error: string }> = [];
  for (const snapshot of pending) {
    try {
      const reference = String(snapshot.metadata?.marketId || snapshot.metadata?.slug || "");
      if (!reference) throw new Error("snapshot has no live market reference");
      const live = await fetchPolymarketMarket(reference);
      const resolution = polymarketResolution(snapshot.id, live);
      if (!resolution) continue;
      await appendForecastRecord(ledgerPath, resolution);
      added += 1;
    } catch (error) { errors.push({ id: snapshot.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { checked: pending.length, resolved: added, errors };
}

function usage(): never {
  console.error("Usage:");
  console.error("  pnpm forecast snapshot <polymarket-model.json> <market-id|slug|url> [--ledger PATH]");
  console.error("  pnpm forecast batch [--models DIR] [--ledger PATH]");
  console.error("  pnpm forecast watch [--models DIR] [--interval MINUTES] [--ledger PATH]");
  console.error("  pnpm forecast sync [--ledger PATH]");
  console.error("  pnpm forecast resolve <snapshot-id> <outcome> [--ledger PATH]");
  console.error("  pnpm forecast score [--ledger PATH]");
  process.exit(1);
}

if (command === "snapshot") {
  const modelPath = args[1];
  const reference = args[2];
  if (!modelPath || !reference) usage();
  const model: unknown = JSON.parse(await readFile(modelPath, "utf8"));
  if (!isPolymarket(model)) throw new Error("snapshot currently needs a Polymarket model");
  const live = await fetchPolymarketMarket(reference);
  const snapshot = polymarketForecastSnapshot(model, live);
  await appendForecastRecord(ledgerPath, snapshot);
  console.log(JSON.stringify({ ledger: ledgerPath, id: snapshot.id, question: snapshot.question, probabilities: snapshot.probabilities, baseline: snapshot.baselineProbabilities, decision: snapshot.decision, metadata: snapshot.metadata }, null, 2));
} else if (command === "batch") {
  await batch();
} else if (command === "watch") {
  const intervalMinutes = Number(flag("--interval") ?? "60");
  if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new Error("--interval must be a positive number of minutes");
  for (;;) {
    try {
      await batch();
      const result = await syncLedger();
      console.log(JSON.stringify(result));
      console.log(JSON.stringify({ syncedAt: new Date().toISOString() }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMinutes * 60_000));
  }
} else if (command === "sync") {
  const result = await syncLedger();
  const current = await readForecastLedger(ledgerPath);
  console.log(JSON.stringify({ ledger: ledgerPath, ...result, summary: summarizeForecasts(current) }, null, 2));
} else if (command === "resolve") {
  const snapshotId = args[1];
  const outcome = args[2];
  if (!snapshotId || !outcome) usage();
  const record: ForecastResolution = { schemaVersion: 1, kind: "resolution", snapshotId, outcome, resolvedAt: new Date().toISOString() };
  await appendForecastRecord(ledgerPath, record);
  console.log(JSON.stringify({ ledger: ledgerPath, resolution: record }, null, 2));
} else if (command === "score") {
  console.log(JSON.stringify(summarizeForecasts(await readForecastLedger(ledgerPath)), null, 2));
} else usage();
