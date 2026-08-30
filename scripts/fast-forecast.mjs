import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { Type } from "typebox";
import { runStructured } from "../src/pi-agent.ts";
import { scoreProbabilities, summarizeForecasts } from "../src/forecast.ts";
import { polymarketForecastSnapshot, polymarketResolution } from "../src/adapters/polymarket-live.ts";

const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const numberFlag = (name, fallback) => {
  const value = Number(flag(name, String(fallback)));
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive number`);
  return value;
};
const limit = Math.floor(numberFlag("--limit", 20));
const horizonHours = numberFlag("--horizon-hours", 24);
const maxAgeDays = numberFlag("--max-age-days", 7);
const minVolume = numberFlag("--min-volume", 1_000);
const output = flag("--output", "/tmp/flumina-backcast.jsonl");
const dryRun = args.includes("--dry-run");

const asArray = (value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const timestamp = (value) => {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : undefined;
};
const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`${new URL(url).hostname} returned HTTP ${response.status}`);
  return response.json();
};

function parseClosedMarket(value, now = Date.now()) {
  const outcomes = asArray(value?.outcomes).map((item) => String(item).toUpperCase());
  const yes = outcomes.indexOf("YES"), no = outcomes.indexOf("NO");
  const prices = asArray(value?.outcomePrices).map(Number);
  const tokens = asArray(value?.clobTokenIds).map(String);
  const closedAt = timestamp(value?.closedTime);
  if (value?.closed !== true || yes < 0 || no < 0 || !closedAt || closedAt > now) return undefined;
  const resolved = prices[yes] >= .999 && prices[no] <= .001 ? "YES"
    : prices[no] >= .999 && prices[yes] <= .001 ? "NO" : undefined;
  const question = String(value?.question ?? "").trim();
  const id = String(value?.id ?? "").trim();
  if (!resolved || !question || !id || !tokens[yes] || /\bcompleted match\b/i.test(question)) return undefined;
  return {
    id, question, resolved, closedAt, yesToken: tokens[yes], volume: Number(value?.volumeNum ?? 0),
    eventId: String(value?.events?.[0]?.id ?? id),
  };
}

function priceAtOrBefore(history, cutoff) {
  return asArray(history?.history)
    .map((point) => ({ time: Number(point?.t) * 1_000, price: Number(point?.p) }))
    .filter((point) => Number.isFinite(point.time) && point.time <= cutoff && Number.isFinite(point.price) && point.price >= 0 && point.price <= 1)
    .sort((left, right) => right.time - left.time)[0];
}

async function historicalPrice(token, cutoff) {
  const url = new URL(`${CLOB}/prices-history`);
  url.searchParams.set("market", token);
  url.searchParams.set("startTs", String(Math.floor((cutoff - 7 * 86_400_000) / 1_000)));
  url.searchParams.set("endTs", String(Math.floor(cutoff / 1_000)));
  url.searchParams.set("fidelity", "60");
  return priceAtOrBefore(await fetchJson(url), cutoff);
}

async function selectCases(now = Date.now()) {
  const cases = [], seenEvents = new Set(), skipped = { invalid: 0, old: 0, duplicateEvent: 0, lowVolume: 0, noHistoricalPrice: 0, stalePrice: 0 };
  let cursor;
  for (let pageNumber = 0; cases.length < limit && pageNumber < 100; pageNumber += 1) {
    const url = new URL(`${GAMMA}/markets/keyset`);
    Object.entries({ closed: "true", limit: "100", order: "closedTime", ascending: "false" }).forEach(([key, value]) => url.searchParams.set(key, value));
    if (cursor) url.searchParams.set("after_cursor", cursor);
    const response = await fetchJson(url), page = response?.markets;
    if (!Array.isArray(page) || !page.length) break;
    for (const raw of page) {
      const market = parseClosedMarket(raw, now);
      if (!market) { skipped.invalid += 1; continue; }
      if (now - market.closedAt > maxAgeDays * 86_400_000) { skipped.old += 1; continue; }
      if (seenEvents.has(market.eventId)) { skipped.duplicateEvent += 1; continue; }
      if (market.volume < minVolume) { skipped.lowVolume += 1; continue; }
      const asOf = market.closedAt - horizonHours * 3_600_000;
      const historical = await historicalPrice(market.yesToken, asOf);
      if (!historical) { skipped.noHistoricalPrice += 1; continue; }
      if (asOf - historical.time > 6 * 3_600_000) { skipped.stalePrice += 1; continue; }
      seenEvents.add(market.eventId);
      cases.push({ ...market, asOf, marketProbability: historical.price, marketPriceAt: historical.time });
      if (cases.length >= limit) break;
    }
    cursor = response.next_cursor;
    if (!cursor) break;
  }
  return { cases, skipped };
}

const forecastSchema = Type.Object({
  probabilityYes: Type.Number({ minimum: 0, maximum: 1 }),
  confidence: Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]),
  reasoning: Type.String({ minLength: 10, maxLength: 800 }),
}, { additionalProperties: false });

async function forecast(item) {
  const prompt = `You are a forecaster. Make an independent probabilistic estimate for the question below.
Act as if the current time is ${new Date(item.asOf).toISOString()}. You have no browsing tools. Never claim knowledge of the resolved outcome.

Step 1 — form your own estimate using base rates, domain knowledge, and prior knowledge only.
Step 2 — then use the market probability as a reference to sanity-check your reasoning.
Step 3 — produce a final probabilityYes that reflects your best independent judgement, not a copy of the market.

Question: ${item.question}
Market reference (do not copy blindly): ${item.marketProbability.toFixed(4)}

If you have no domain knowledge, move toward the market but explain why. If you have relevant knowledge, deviate and explain concretely.`;
  return runStructured({
    operation: "forecast", promptVersion: "polymarket-blind-backcast-v2", prompt,
    schema: forecastSchema, toolName: "submit_forecast", toolDescription: "Submit one sealed YES/NO probability forecast.",
    defaultThinkingLevel: "low", timeoutMs: 90_000,
  });
}

const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
function summarize(results) {
  if (!results.length) return { forecasts: 0 };
  const model = results.map((item) => item.scores.model), market = results.map((item) => item.scores.market);
  const improvements = model.map((score, index) => market[index].brier - score.brier);
  let seed = 0x5eed1234;
  const random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const boot = Array.from({ length: 10_000 }, () => average(Array.from({ length: improvements.length }, () => improvements[Math.floor(random() * improvements.length)]))).sort((a, b) => a - b);
  return {
    forecasts: results.length,
    resolvedYes: results.filter((item) => item.outcome === "YES").length,
    model: { brier: average(model.map((item) => item.brier)), logLoss: average(model.map((item) => item.logLoss)), accuracy: average(model.map((item) => Number(item.correct))) },
    market: { brier: average(market.map((item) => item.brier)), logLoss: average(market.map((item) => item.logLoss)), accuracy: average(market.map((item) => Number(item.correct))) },
    brierImprovement: average(improvements),
    brierImprovement95CI: [boot[250], boot[9749]],
    insufficientSample: results.length < 100,
  };
}

// Build paper trading records from backcast results using the engine's position selector.
// Pi gives trueProb -> polymarketForecastSnapshot picks YES/NO/ABSTAIN across 600 worlds
// -> polymarketResolution settles against actual outcome -> summarizeForecasts gives paper PnL.
function buildPaperRecords(results) {
  const records = [];
  for (const r of results) {
    const p = r.probabilities.YES;
    const mp = r.baselineProbabilities.YES;
    const spec = {
      schemaVersion: 1, adapter: "polymarket", situation: r.question,
      model: {
        markets: [{ id: r.marketId, question: r.question, marketPrice: [Math.max(0.01, mp - 0.01), Math.min(0.99, mp + 0.01)], trueProb: [Math.max(0.05, p - 0.06), Math.min(0.95, p + 0.06)] }],
        positions: [{ id: "long_yes", label: "Long YES", side: "YES", size: [100, 100] }, { id: "long_no", label: "Long NO", side: "NO", size: [100, 100] }, { id: "abstain", label: "Abstain", side: "ABSTAIN", size: [0, 0] }],
        fee: [0.02, 0.02], slippage: [0, 0],
      },
      topology: { nodes: ["market"], interactions: [] },
    };
    const mockOpen = { id: r.marketId, conditionId: r.marketId, slug: r.marketId, question: r.question, yesPrice: mp, bestBid: Math.max(0.01, mp - 0.01), bestAsk: Math.min(0.99, mp + 0.01), feeRate: 0.02, active: true, closed: false, restricted: false };
    try {
      const snap = polymarketForecastSnapshot(spec, mockOpen, r.asOf, `bc-${r.marketId}`);
      records.push(snap);
      const mockClosed = { ...mockOpen, closed: true, active: false, resolvedOutcome: r.outcome, yesPrice: r.outcome === "YES" ? 1 : 0 };
      const res = polymarketResolution(snap.id, mockClosed, r.closedAt);
      if (res) records.push(res);
    } catch {}
  }
  return records;
}

function selfCheck() {
  const now = Date.parse("2026-08-30T12:00:00Z");
  const market = parseClosedMarket({ id: "1", question: "Will it happen?", closed: true, closedTime: "2026-08-30T10:00:00Z", outcomes: '["Yes","No"]', outcomePrices: '["1","0"]', clobTokenIds: '["yes-token","no-token"]', volumeNum: 2_000 }, now);  assert.equal(market?.resolved, "YES");
  assert.deepEqual(priceAtOrBefore({ history: [{ t: 100, p: .4 }, { t: 300, p: 1 }, { t: 200, p: .6 }] }, 250_000), { time: 200_000, price: .6 }, "post-cutoff prices must never enter a backcast");
  const score = scoreProbabilities(["YES", "NO"], { YES: .7, NO: .3 }, "YES");
  assert.ok(Math.abs(score.brier - .09) < 1e-12);
  console.log("fast forecast self-check OK");
}

if (args.includes("--self-check")) selfCheck();
else {
  const selected = await selectCases();
  if (dryRun) {
    console.log(JSON.stringify({ method: "blind-backcast", horizonHours, ...selected, cases: selected.cases.map(({ resolved: _resolved, yesToken: _token, ...item }) => ({ ...item, closedAt: new Date(item.closedAt).toISOString(), asOf: new Date(item.asOf).toISOString(), marketPriceAt: new Date(item.marketPriceAt).toISOString() })) }, null, 2));
  } else {
    const results = [], errors = [];
    let cached = [];
    try { cached = (await readFile(output, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
    catch (error) { if (error?.code !== "ENOENT") throw error; }
    const byMarket = new Map(cached.map((record) => [record.marketId, record]));
    for (const item of selected.cases) {
      try {
        const asOf = new Date(item.asOf).toISOString();
        const prior = byMarket.get(item.id);
        if (prior?.asOf === asOf) {
          results.push(prior);
          console.log(`${results.length}/${selected.cases.length} ${item.id} · cached`);
          continue;
        }
        const run = await forecast(item);
        const probabilities = { YES: run.value.probabilityYes, NO: 1 - run.value.probabilityYes };
        const baseline = { YES: item.marketProbability, NO: 1 - item.marketProbability };
        const record = {
          schemaVersion: 1, kind: "blind-backcast", marketId: item.id, eventId: item.eventId, question: item.question, horizonHours, marketVolume: item.volume,
          asOf, forecastedAt: new Date().toISOString(), marketPriceAt: new Date(item.marketPriceAt).toISOString(),
          probabilities, baselineProbabilities: baseline, confidence: run.value.confidence, reasoning: run.value.reasoning,
          outcome: item.resolved, closedAt: new Date(item.closedAt).toISOString(), agentMeta: run.meta,
          scores: { model: scoreProbabilities(["YES", "NO"], probabilities, item.resolved), market: scoreProbabilities(["YES", "NO"], baseline, item.resolved) },
        };
        results.push(record);
        console.log(`${results.length}/${selected.cases.length} ${item.id} · model ${probabilities.YES.toFixed(3)} · market ${item.marketProbability.toFixed(3)}`);
      } catch (error) { errors.push({ marketId: item.id, error: error instanceof Error ? error.message : String(error) }); }
    }
    await writeFile(output, results.map((record) => JSON.stringify(record)).join("\n") + (results.length ? "\n" : ""));
    const paper = results.length ? summarizeForecasts(buildPaperRecords(results)) : undefined;
    console.log(JSON.stringify({ method: "blind-backcast", output, horizonHours, selected: selected.cases.length, skipped: selected.skipped, errors, summary: summarize(results), paper: paper ? { decisions: paper.paper?.decisions, totalValue: paper.paper?.totalValue, meanValue: paper.paper?.meanValue, model: paper.model, baseline: paper.baseline } : undefined, warning: "Retrospective signal only; model memory can still contain an outcome. Prospective ledger remains the proof." }, null, 2));
  }
}
