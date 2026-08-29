import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { assertForecastRecord, type ForecastRecord } from "./forecast.js";

export async function readForecastLedger(path: string): Promise<ForecastRecord[]> {
  let text: string;
  try { text = await readFile(path, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return text.split("\n").flatMap((line, index) => {
    if (!line.trim()) return [];
    try {
      const record = JSON.parse(line) as ForecastRecord;
      assertForecastRecord(record);
      return [record];
    } catch (error) {
      throw new Error(`invalid forecast ledger line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

/** Append-only storage keeps the forecast that existed before resolution auditable. */
export async function appendForecastRecord(path: string, record: ForecastRecord): Promise<void> {
  // ponytail: one writer is enough for the CLI; use the TEOB journal when concurrent writers appear.
  assertForecastRecord(record);
  const existing = await readForecastLedger(path);
  if (record.kind === "categorical" && existing.some((item) => item.kind === "categorical" && item.id === record.id)) throw new Error(`forecast ${record.id} already exists`);
  if (record.kind === "resolution") {
    const snapshot = existing.find((item) => item.kind === "categorical" && item.id === record.snapshotId);
    if (!snapshot || snapshot.kind !== "categorical") throw new Error(`forecast ${record.snapshotId} does not exist`);
    if (existing.some((item) => item.kind === "resolution" && item.snapshotId === record.snapshotId)) throw new Error(`forecast ${record.snapshotId} is already resolved`);
    if (!snapshot.outcomes.includes(record.outcome)) throw new Error(`forecast ${record.snapshotId} has no outcome ${record.outcome}`);
    if (Date.parse(record.resolvedAt) < Date.parse(snapshot.issuedAt)) throw new Error("forecast cannot resolve before it was issued");
  }
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${JSON.stringify(record)}\n`, "utf8");
}
