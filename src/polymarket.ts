import type { Rng } from "./rng.js";
import { runSimulation, type SimulationAdapter, type SimulationSpec, type WorldSample } from "./simulation.js";
import { assertTopologyPrior, type NumberRange, type Topology, type TopologyPrior } from "./topology.js";

export type PolymarketSide = "YES" | "NO" | "ABSTAIN" | "LP";

export interface PolymarketPosition {
  id: string;
  label?: string;
  side: PolymarketSide;
  /** Stake in USD (or share). Sampled per world. */
  size: NumberRange;
  /** Entry price override. If absent uses marketPrice (or 1-marketPrice for NO). */
  entry?: NumberRange;
}

export interface PolymarketMarket {
  id: string;
  question?: string;
  /** Market implied price for YES, 0..1. Sampled per world. */
  marketPrice: NumberRange;
  /** True underlying probability YES resolves, 0..1. Sampled per world. */
  trueProb: NumberRange;
}

export interface PolymarketModel {
  /** P0 supports one binary market. */
  markets: readonly PolymarketMarket[];
  /** Strategies/positions to compare paired-world. 2..5. */
  positions: readonly PolymarketPosition[];
  /** Taker fee on cost, 0..0.1 */
  fee: NumberRange;
  /** Slippage as fraction of entry, 0..0.1 */
  slippage?: NumberRange;
  /** LP fee rebate per dollar of liquidity (if LP present), 0..0.1 */
  lpRebate?: NumberRange;
}

export interface PolymarketWorld {
  outcome: Record<string, "YES" | "NO">;
  bestPositionId: string;
  feesPaid: number;
}

export type PolymarketSpec = SimulationSpec<PolymarketModel> & { adapter: "polymarket" };

const assertRange = (value: NumberRange, label: string, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY): void => {
  if (!Array.isArray(value) || value.length !== 2 || !Number.isFinite(value[0]) || !Number.isFinite(value[1]) || value[0] > value[1] || value[0] < min || value[1] > max) {
    throw new Error(`${label} must be an ordered finite range within ${min}..${max}`);
  }
};

export function assertPolymarket(model: PolymarketModel, topology: TopologyPrior): void {
  assertTopologyPrior(topology);
  if (model.markets?.length !== 1) throw new Error("polymarket needs exactly one market");
  if (!model.positions?.length || model.positions.length < 2 || model.positions.length > 5) throw new Error("polymarket needs 2..5 positions");
  assertRange(model.fee, "fee", 0, 0.2);
  if (model.slippage) assertRange(model.slippage, "slippage", 0, 0.2);
  if (model.lpRebate) assertRange(model.lpRebate, "lpRebate", 0, 0.2);
  const marketIds = new Set<string>();
  for (const m of model.markets) {
    if (!m.id || marketIds.has(m.id)) throw new Error("market ids must be unique non-empty");
    marketIds.add(m.id);
    assertRange(m.marketPrice, `${m.id}.marketPrice`, 0, 1);
    assertRange(m.trueProb, `${m.id}.trueProb`, 0, 1);
    if (m.marketPrice[0] === 0 && m.marketPrice[1] === 0) throw new Error(`${m.id}.marketPrice cannot be zero range`);
    if (m.marketPrice[0] === 1 && m.marketPrice[1] === 1) throw new Error(`${m.id}.marketPrice cannot be 1 range`);
  }
  const posIds = new Set<string>();
  for (const p of model.positions) {
    if (!p.id || posIds.has(p.id)) throw new Error("position ids must be unique non-empty");
    posIds.add(p.id);
    if (!["YES","NO","ABSTAIN","LP"].includes(p.side)) throw new Error(`position ${p.id} side must be YES|NO|ABSTAIN|LP`);
    assertRange(p.size, `${p.id}.size`, 0, 1_000_000);
    if (p.entry) assertRange(p.entry, `${p.id}.entry`, 0.01, 0.99);
  }
  // topology: at least one node; if markets map to nodes, enforce match optionally
}

const sample = (range: NumberRange | undefined, fallback: number, rng: Rng): number =>
  range ? (range[0] === range[1] ? range[0] : rng.between(range)) : fallback;

const clamp01 = (v: number): number => Math.max(0.01, Math.min(0.99, v));

export const polymarketAdapter: SimulationAdapter<PolymarketModel, PolymarketWorld> = {
  id: "polymarket",
  validate: assertPolymarket,
  simulate(model, _topology: Topology, rng: Rng): WorldSample<PolymarketWorld> {
    const fee = sample(model.fee, 0, rng);
    const slippage = sample(model.slippage, 0, rng);
    const lpRebate = sample(model.lpRebate, 0, rng);

    const inputs: Record<string, number> = { fee, slippage, lpRebate };
    const perMarket: Record<string, { marketPrice: number; trueProb: number; outcome: "YES"|"NO" }> = {};
    let feesPaid = 0;

    for (const m of model.markets) {
      const marketPrice = clamp01(sample(m.marketPrice, 0.5, rng));
      const trueProb = Math.max(0, Math.min(1, sample(m.trueProb, 0.5, rng)));
      const outcome: "YES"|"NO" = rng.unit() < trueProb ? "YES" : "NO";
      perMarket[m.id] = { marketPrice, trueProb, outcome };
      inputs[`${m.id}.marketPrice`] = marketPrice;
      inputs[`${m.id}.trueProb`] = trueProb;
      inputs[`${m.id}.edge`] = trueProb - marketPrice; // positive = YES underpriced
    }

    // P0 evaluates every position against the same single market.
    const primary = model.markets[0]!;
    const pm = perMarket[primary.id]!;

    const metrics: Record<string, number> = {};
    const entities: Record<string, Record<string, number>> = {};
    const positionPnl: Record<string, number> = {};

    for (const pos of model.positions) {
      const size = sample(pos.size, 0, rng);
      inputs[`${pos.id}.size`] = size;
      let pnl = 0;
      let cost = 0;
      if (pos.side === "ABSTAIN" || size === 0) {
        pnl = 0;
      } else if (pos.side === "YES") {
        const entry = clamp01(sample(pos.entry, pm.marketPrice, rng));
        inputs[`${pos.id}.entry`] = entry;
        cost = size * entry * (1 + fee + slippage);
        feesPaid += size * entry * fee;
        const payout = pm.outcome === "YES" ? size * 1 : 0;
        // slippage already in cost; entry is what you paid per share
        pnl = payout - cost;
      } else if (pos.side === "NO") {
        const entryNo = clamp01(sample(pos.entry, 1 - pm.marketPrice, rng));
        inputs[`${pos.id}.entry`] = entryNo;
        cost = size * entryNo * (1 + fee + slippage);
        feesPaid += size * entryNo * fee;
        const payout = pm.outcome === "NO" ? size * 1 : 0;
        pnl = payout - cost;
      } else if (pos.side === "LP") {
        // LP: earn fee on volume, lose on adverse selection ~ |edge| * size
        // Simplified: pnl = size*lpRebate - size*|edge|*0.5  with outcome variance
        const adverse = Math.abs(pm.trueProb - pm.marketPrice) * size * 0.5;
        // LP always pays no taker fee, earns rebate
        pnl = size * lpRebate - Math.abs(adverse);
        // no cost basis for LP in this simple model, but track notional
        cost = size * 0.02; // capital lock ~2% notional for metric denominator guard
      }
      const roi = cost > 0 ? pnl / cost : pnl; // abstain 0
      metrics[`pnl.${pos.id}`] = pnl;
      metrics[`roi.${pos.id}`] = roi;
      // also global ev as primary metric = pnl
      entities[pos.id] = { pnl, roi, cost };
      positionPnl[pos.id] = pnl;
    }

    // best position in this world (paired-world comparison)
    let bestPositionId = model.positions[0]!.id;
    let bestPnl = positionPnl[bestPositionId]!;
    for (const [id, pnl] of Object.entries(positionPnl)) {
      if (pnl > bestPnl) { bestPnl = pnl; bestPositionId = id; }
    }

    // aggregate metrics for generic report
    const pnls = Object.values(positionPnl);
    metrics["ev.best"] = bestPnl;
    metrics["ev.mean"] = pnls.reduce((a,b)=>a+b,0)/pnls.length;

    const outcome: Record<string, "YES"|"NO"> = Object.fromEntries(Object.entries(perMarket).map(([k,v])=>[k,v.outcome]));
    const regime = pm.trueProb > pm.marketPrice + 0.05 ? "YES_underpriced" : pm.trueProb < pm.marketPrice - 0.05 ? "NO_underpriced" : "fair";
    const edgeBand = Math.abs(pm.trueProb - pm.marketPrice) < 0.03 ? "thin edge" : Math.abs(pm.trueProb - pm.marketPrice) < 0.1 ? "moderate edge" : "wide edge";
    const winnerLabel = positionPnl[bestPositionId]! > 0 ? bestPositionId : "ABSTAIN_best";

    return {
      inputs,
      metrics,
      entities,
      path: [`price:${pm.marketPrice < 0.5 ? "YES cheap" : "YES rich"}`, `${regime} · ${edgeBand}`, `${winnerLabel}`, `${outcome[primary.id]}`],
      payload: { outcome, bestPositionId, feesPaid },
    };
  },
};

export function runPolymarket(spec: PolymarketSpec, trials: number, seed: number) {
  return runSimulation(spec, polymarketAdapter, trials, seed);
}
