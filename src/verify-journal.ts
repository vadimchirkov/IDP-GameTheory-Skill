import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { EntityId, replayAndVerify } from "@lambda-house/teob-ts/core";
import { createSqliteJournal } from "@lambda-house/teob-ts/sqlite";
import { taskAggregate, taskEventCodec, type TaskEvent } from "./task.js";

const path = resolve(process.argv[2] ?? process.env.APP_DB_PATH ?? "data/app.db");
if (!existsSync(path)) throw new Error(`Journal not found: ${path}`);

const journal = createSqliteJournal({ path });
try {
  const streams = new Map<string, Array<{ sequenceNr: number; event: TaskEvent }>>();
  const knownEvents = new Set(taskEventCodec.manifests ?? []);
  for (const row of journal.allEvents(taskAggregate.category, taskEventCodec)) {
    const id = String(row.entityId);
    if (!knownEvents.has(row.event.tag)) throw new Error(`${id} #${Number(row.sequenceNr)}: unknown event ${row.event.tag}`);
    const stream = streams.get(id) ?? [];
    stream.push({ sequenceNr: Number(row.sequenceNr), event: row.event });
    streams.set(id, stream);
  }

  let events = 0;
  const failures: string[] = [];
  for (const [id, stream] of streams) {
    stream.sort((a, b) => a.sequenceNr - b.sequenceNr);
    events += stream.length;
    const result = replayAndVerify(taskAggregate, EntityId(id), stream.map((row) => row.event));
    for (const violation of result.violations) failures.push(`${id} #${violation.afterEvent}: ${violation.invariantName}`);
  }

  if (failures.length) {
    console.error(failures.join("\n"));
    throw new Error(`${failures.length} journal invariant violation(s)`);
  }
  console.log(`journal replay OK · ${streams.size} tasks · ${events} events`);
} finally {
  journal.close();
}
