import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendForecastRecord, readForecastLedger } from "./forecast-ledger.js";
import { scoreProbabilities, summarizeForecasts, type CategoricalForecastSnapshot } from "./forecast.js";
import { parsePolymarketMarket, polymarketForecastSnapshot, polymarketResolution } from "./adapters/polymarket-live.js";
import { polymarketTakerFee, type PolymarketSpec } from "./adapters/polymarket.js";

assert.equal(polymarketTakerFee(100, 0.4, 0.05), 1.2, "taker fee follows the protocol's price-dependent formula");
const score = scoreProbabilities(["YES", "NO"], { YES: 0.7, NO: 0.3 }, "YES");
assert.ok(Math.abs(score.brier - 0.09) < 1e-12 && score.correct && score.logLoss === -Math.log(0.7));

const live = parsePolymarketMarket({
  id: "12", conditionId: "0xabc", slug: "will-it-happen", question: "Will it happen?",
  outcomes: '["Yes","No"]', outcomePrices: '["0.40","0.60"]', bestBid: "0.39", bestAsk: "0.41",
  active: true, closed: false, restricted: false, feesEnabled: true, feeSchedule: { rate: 0.05 },
});
const spec: PolymarketSpec = {
  schemaVersion: 1, adapter: "polymarket", situation: "test",
  model: {
    markets: [{ id: "main", marketPrice: [0.4, 0.4], trueProb: [0.68, 0.72] }],
    positions: [
      { id: "yes", label: "Buy YES", side: "YES", size: [100, 100] },
      { id: "no", label: "Buy NO", side: "NO", size: [100, 100] },
      { id: "wait", label: "Wait", side: "ABSTAIN", size: [0, 0] },
    ],
    fee: [0, 0], slippage: [0, 0],
  },
  topology: { nodes: ["market"], interactions: [] },
};
const snapshot = polymarketForecastSnapshot(spec, live, "2026-01-01T00:00:00Z", "forecast-1");
assert.deepEqual(snapshot.probabilities, { YES: 0.7, NO: 0.30000000000000004 });
assert.deepEqual(snapshot.baselineProbabilities, { YES: 0.4, NO: 0.6 });
assert.equal(snapshot.decision?.actionId, "yes", "the paper action is selected before resolution from expected value");

const resolvedLive = parsePolymarketMarket({ ...live, outcomes: ["Yes", "No"], outcomePrices: ["1", "0"], active: false, closed: true });
const resolution = polymarketResolution(snapshot.id, resolvedLive, "2026-02-01T00:00:00Z");
assert.ok(resolution);
const summary = summarizeForecasts([snapshot, resolution!]);
assert.equal(summary.resolved, 1);
assert.ok(summary.model!.brier < summary.baseline!.brier, "the shared scorer compares the adapter forecast with its external baseline");
assert.ok(summary.paper!.totalValue > 0, "the immutable paper decision settles against the observed outcome");

// A non-market adapter uses the same record without importing Polymarket code.
const generic: CategoricalForecastSnapshot = {
  schemaVersion: 1, kind: "categorical", id: "weather-1", adapter: "weather", subjectId: "riga-tomorrow",
  question: "Will it rain?", issuedAt: "2026-01-01T00:00:00Z", outcomes: ["rain", "dry"], probabilities: { rain: 0.6, dry: 0.4 },
};
assert.equal(summarizeForecasts([generic]).unresolved, 1);

const directory = await mkdtemp(join(tmpdir(), "flumina-forecast-"));
const ledger = join(directory, "ledger.jsonl");
try {
  await appendForecastRecord(ledger, snapshot);
  await appendForecastRecord(ledger, resolution!);
  assert.deepEqual(await readForecastLedger(ledger), [snapshot, resolution], "the append-only ledger round-trips records");
  await assert.rejects(() => appendForecastRecord(ledger, resolution!), /already resolved/);
} finally { await rm(directory, { recursive: true }); }

console.log("forecast self-check OK");
