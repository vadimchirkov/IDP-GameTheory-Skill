import { randomUUID } from "node:crypto";
import type { CategoricalForecastSnapshot, ForecastResolution } from "../forecast.js";
import { polymarketPositionValue, type PolymarketSpec } from "./polymarket.js";

export interface PolymarketLiveMarket {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  yesPrice: number;
  bestBid?: number;
  bestAsk?: number;
  feeRate?: number;
  active: boolean;
  closed: boolean;
  restricted: boolean;
  resolvedOutcome?: "YES" | "NO";
}

type GammaMarket = {
  id?: unknown;
  conditionId?: unknown;
  slug?: unknown;
  question?: unknown;
  outcomes?: unknown;
  outcomePrices?: unknown;
  bestBid?: unknown;
  bestAsk?: unknown;
  active?: unknown;
  closed?: unknown;
  restricted?: unknown;
  feesEnabled?: unknown;
  feeSchedule?: { rate?: unknown };
};

const asArray = (value: unknown): unknown[] => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try { const parsed: unknown = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; }
  catch { return []; }
};
const finite = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const withinProbability = (value: number | undefined): value is number => value !== undefined && value >= 0 && value <= 1;

export function parsePolymarketMarket(value: unknown): PolymarketLiveMarket {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Polymarket returned an invalid market");
  const market = value as GammaMarket;
  const outcomes = asArray(market.outcomes).map(String);
  const prices = asArray(market.outcomePrices).map(finite);
  const yesIndex = outcomes.findIndex((outcome) => outcome.toUpperCase() === "YES");
  const noIndex = outcomes.findIndex((outcome) => outcome.toUpperCase() === "NO");
  const yesPrice = prices[yesIndex];
  if (yesIndex < 0 || noIndex < 0 || !withinProbability(yesPrice)) throw new Error("only binary YES/NO Polymarket markets are supported");
  const closed = market.closed === true;
  const resolvedOutcome = closed && prices[yesIndex] !== undefined && prices[noIndex] !== undefined
    ? prices[yesIndex]! >= 0.999 && prices[noIndex]! <= 0.001 ? "YES" as const
      : prices[noIndex]! >= 0.999 && prices[yesIndex]! <= 0.001 ? "NO" as const
        : undefined
    : undefined;
  const bestBid = finite(market.bestBid);
  const bestAsk = finite(market.bestAsk);
  const feeRate = market.feesEnabled === true ? finite(market.feeSchedule?.rate) : 0;
  return {
    id: String(market.id ?? "").trim(),
    conditionId: String(market.conditionId ?? "").trim(),
    slug: String(market.slug ?? "").trim(),
    question: String(market.question ?? "").trim(),
    yesPrice,
    ...(withinProbability(bestBid) ? { bestBid } : {}),
    ...(withinProbability(bestAsk) ? { bestAsk } : {}),
    ...(feeRate !== undefined && feeRate >= 0 ? { feeRate } : {}),
    active: market.active === true,
    closed,
    restricted: market.restricted === true,
    ...(resolvedOutcome ? { resolvedOutcome } : {}),
  };
}

function marketReference(value: string): { id?: string; slug?: string } {
  const input = value.trim();
  if (!input) throw new Error("market id, slug, or URL is required");
  if (/^\d+$/.test(input)) return { id: input };
  if (/^[a-z0-9-]+$/.test(input)) return { slug: input };
  try {
    const url = new URL(input);
    const parts = url.pathname.split("/").filter(Boolean);
    const slug = parts.at(-1);
    if (url.hostname.endsWith("polymarket.com") && slug && /^[a-z0-9-]+$/.test(slug)) return { slug };
  } catch {}
  throw new Error("market reference must be a numeric Gamma id, slug, or Polymarket URL");
}

export async function fetchPolymarketMarket(reference: string, fetcher: typeof fetch = fetch): Promise<PolymarketLiveMarket> {
  const target = marketReference(reference);
  const url = target.id
    ? `https://gamma-api.polymarket.com/markets/${encodeURIComponent(target.id)}`
    : `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(target.slug!)}`;
  const response = await fetcher(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Polymarket market request failed with HTTP ${response.status}`);
  const body: unknown = await response.json();
  const value = Array.isArray(body) ? body[0] : body;
  if (!value) throw new Error("Polymarket market not found");
  return parsePolymarketMarket(value);
}

const midpoint = (range: readonly [number, number]): number => (range[0] + range[1]) / 2;

/** Convert one live market plus an independent adapter model into the shared forecast contract. */
export function polymarketForecastSnapshot(spec: PolymarketSpec, live: PolymarketLiveMarket, issuedAt = new Date().toISOString(), id: string = randomUUID()): CategoricalForecastSnapshot {
  if (live.closed) throw new Error("cannot snapshot a closed market");
  const market = spec.model.markets[0];
  if (!market) throw new Error("Polymarket model has no market");
  const yesProbability = midpoint(market.trueProb);
  const feeRate = live.feeRate ?? midpoint(spec.model.fee);
  const slippage = midpoint(spec.model.slippage ?? [0, 0]);
  const candidates = spec.model.positions.flatMap((position) => {
    if (position.side === "LP") return [];
    const size = midpoint(position.size);
    const entry = position.entry ? midpoint(position.entry)
      : position.side === "YES" ? live.bestAsk ?? live.yesPrice
        : position.side === "NO" ? 1 - (live.bestBid ?? live.yesPrice)
          : 0;
    const valueByOutcome = {
      YES: polymarketPositionValue(position.side, size, entry, feeRate, slippage, "YES"),
      NO: polymarketPositionValue(position.side, size, entry, feeRate, slippage, "NO"),
    };
    const expectedValue = yesProbability * valueByOutcome.YES + (1 - yesProbability) * valueByOutcome.NO;
    return [{ position, entry, expectedValue, valueByOutcome }];
  });
  const chosen = candidates.sort((a, b) => b.expectedValue - a.expectedValue)[0];
  if (!chosen) throw new Error("Polymarket model has no paper-tradable YES, NO, or ABSTAIN position");
  return {
    schemaVersion: 1,
    kind: "categorical",
    id,
    adapter: spec.adapter,
    subjectId: live.conditionId || live.id,
    question: live.question || market.question || spec.situation,
    issuedAt,
    outcomes: ["YES", "NO"],
    probabilities: { YES: yesProbability, NO: 1 - yesProbability },
    baselineProbabilities: { YES: live.yesPrice, NO: 1 - live.yesPrice },
    decision: { actionId: chosen.position.id, ...(chosen.position.label ? { label: chosen.position.label } : {}), valueByOutcome: chosen.valueByOutcome },
    metadata: {
      marketId: live.id,
      conditionId: live.conditionId,
      slug: live.slug,
      marketPrice: live.yesPrice,
      bestBid: live.bestBid ?? null,
      bestAsk: live.bestAsk ?? null,
      feeRate,
      slippage,
      expectedValue: chosen.expectedValue,
      restricted: live.restricted,
      modelProbabilityLow: market.trueProb[0],
      modelProbabilityHigh: market.trueProb[1],
    },
  };
}

export function polymarketResolution(snapshotId: string, live: PolymarketLiveMarket, resolvedAt = new Date().toISOString()): ForecastResolution | undefined {
  return live.resolvedOutcome ? { schemaVersion: 1, kind: "resolution", snapshotId, outcome: live.resolvedOutcome, resolvedAt } : undefined;
}
