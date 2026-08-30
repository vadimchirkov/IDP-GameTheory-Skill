import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import { runStructured } from "../src/pi-agent.ts";
import { fetchPolymarketMarket, polymarketForecastSnapshot, polymarketResolution } from "../src/adapters/polymarket-live.ts";
import { appendForecastRecord, readForecastLedger } from "../src/forecast-ledger.ts";
import { summarizeForecasts } from "../src/forecast.ts";
import { rm } from "node:fs/promises";

const probSchema = Type.Object({
  trueProbLow: Type.Number({ minimum: 0, maximum: 1 }),
  trueProbHigh: Type.Number({ minimum: 0, maximum: 1 }),
  reasoning: Type.String({ minLength: 10, maxLength: 600 }),
  confidence: Type.String({ enum: ["low", "medium", "high"] }),
}, { additionalProperties: false });

// 3 рынка для быстрого Pi prior теста без web
const files = ["618182.json", "624904.json", "625000.json"];
const ledger = "/tmp/pi-prior-bench.jsonl";
try { await rm(ledger); } catch {}

for (const file of files) {
  const specOrig = JSON.parse(await readFile(`markets/polymarket-closed/${file}`,"utf8"));
  const q = specOrig.situation;
  const prompt = `Estimate true probability YES for Polymarket market AS OF BEFORE event, WITHOUT web research. Use only base rates and prior knowledge.

Question: ${q}
Market ID: ${specOrig.model.markets[0].id}
No excerpts provided.

Return trueProbLow/High width 0.12-0.16, confidence low if uncertain.`;
  const run = await runStructured({
    operation: "build-model",
    promptVersion: "pi-prior-v1",
    toolName: "submit_probability",
    toolDescription: "Submit pre-event YES probability",
    schema: probSchema,
    prompt, timeoutMs: 60000
  });
  const mid = (run.value.trueProbLow + run.value.trueProbHigh) / 2;
  const spec = {
    schemaVersion: 1, adapter: "polymarket", situation: q,
    model: { markets: [{ id: specOrig.model.markets[0].id, question: q, marketPrice: specOrig.model.markets[0].marketPrice, trueProb: [Number((mid-0.07).toFixed(2)), Number((mid+0.07).toFixed(2))] }], positions: specOrig.model.positions, fee: specOrig.model.fee, slippage: specOrig.model.slippage },
    topology: { nodes: ["market"], interactions: [] }
  };
  const liveClosed = await fetchPolymarketMarket(spec.model.markets[0].id);
  const baseline = (spec.model.markets[0].marketPrice[0] + spec.model.markets[0].marketPrice[1]) / 2;
  const liveOpen = { ...liveClosed, closed: false, active: true, yesPrice: baseline, bestBid: Math.max(0.01, baseline-0.01), bestAsk: Math.min(0.99, baseline+0.01) };
  const snap = polymarketForecastSnapshot(spec, liveOpen, new Date(Date.now()-3600_000).toISOString(), `pi-prior-${spec.model.markets[0].id}`);
  await appendForecastRecord(ledger, snap);
  const res = polymarketResolution(snap.id, liveClosed);
  if (res) await appendForecastRecord(ledger, res);
  console.log(`${file} Pi [${run.value.trueProbLow},${run.value.trueProbHigh}] ${run.value.confidence} -> trueProb ${spec.model.markets[0].trueProb} vs ${res?.outcome}`);
}
const s = summarizeForecasts(await readForecastLedger(ledger));
console.log(JSON.stringify({ ledger, fixtures: files.length, ...s }, null, 2));
if (s.model.brier > 0.40) throw new Error(`pi-prior brier ${s.model.brier} too high`);
console.log("pi-prior bench OK - no web, Pi prior only");
