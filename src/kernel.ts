import {
  type Move, type Payoff, type RunConfig, type Shares, type StrategyId,
  normalizeShares, score, strategyIds,
} from "./domain.js";
import { deriveSeed, Rng } from "./rng.js";

export type Strategy = (mine: readonly Move[], theirs: readonly Move[], rng: Rng) => Move;

const flip = (move: Move): Move => (move === "C" ? "D" : "C");

function clamp(v: number): number { return Math.max(0, Math.min(1, v)); }

function makeMemoryOne(probsCC: number, probsCD: number, probsDC: number, probsDD: number): Strategy {
  return (mine, theirs, rng) => {
    if (theirs.length === 0) return "C";
    const lastMine = mine[mine.length - 1] ?? "C";
    const lastTheirs = theirs[theirs.length - 1] ?? "C";
    let p = 0.5;
    if (lastMine === "C" && lastTheirs === "C") p = probsCC;
    else if (lastMine === "C" && lastTheirs === "D") p = probsCD;
    else if (lastMine === "D" && lastTheirs === "C") p = probsDC;
    else p = probsDD;
    return rng.unit() < p ? "C" : "D";
  };
}

function makeMemoryN(probs: Record<string, number>, n: number): Strategy {
  return (mine, theirs, rng) => {
    if (mine.length < n || theirs.length < n) return "C";
    const window = Array.from({ length: n }, (_, k) => `${mine[mine.length - n + k] ?? "C"}${theirs[theirs.length - n + k] ?? "C"}`).join("|");
    const p = probs[window] ?? 0.5;
    return rng.unit() < p ? "C" : "D";
  };
}

function zdGenerousStrategy(): Strategy {
  const chi = 0.5; const phi = 0.15; const R = 3; const S = 0; const T = 5; const P = 1;
  const p1 = clamp(1 - phi * (1 - chi) * (R - P) / (P - S));
  const p2 = clamp(1 - phi * (1 + chi * (T - P) / (P - S)));
  const p3 = clamp(1 - phi * (1 - (R - P) / (P - S)));
  const p4 = clamp(phi * ((T - R) / (P - S) + chi * (T - R) / (P - S)));
  return makeMemoryOne(p1, p2, p3, p4);
}

function zdExtortStrategy(): Strategy {
  const chi = 2.0; const phi = 0.15; const R = 3; const S = 0; const T = 5; const P = 1;
  const p1 = clamp(1 - phi * (1 - chi) * (R - P) / (P - S));
  const p2 = clamp(1 - phi * (1 + chi * (T - P) / (P - S)));
  const p3 = clamp(1 - phi * (1 - (R - P) / (P - S)));
  const p4 = clamp(phi * ((T - R) / (P - S) + chi * (T - R) / (P - S)));
  return makeMemoryOne(p1, p2, p3, p4);
}

function gradualPure(mine: readonly Move[], theirs: readonly Move[]): Move {
  if (theirs.length === 0) return "C";
  let defections = 0; let punishLeft = 0; let calmLeft = 0;
  for (let i = 0; i < theirs.length; i += 1) {
    if (punishLeft > 0) { punishLeft -= 1; continue; }
    if (calmLeft > 0) { calmLeft -= 1; continue; }
    if (theirs[i] === "D") { defections += 1; punishLeft = defections; calmLeft = 2; }
  }
  if (punishLeft > 0) return "D";
  if (calmLeft > 0) return "C";
  return "C";
}

export const strategies: Record<StrategyId, Strategy> = {
  provocable: (_mine, theirs) => (theirs.length === 0 ? "C" : theirs[theirs.length - 1] ?? "C"),
  forgiving: (_mine, theirs, rng) => {
    const last = theirs[theirs.length - 1];
    return last === "D" && rng.unit() < 0.25 ? "C" : (last ?? "C");
  },
  pavlov: (mine, theirs) => {
    if (mine.length === 0) return "C";
    return theirs[theirs.length - 1] === "C" ? (mine[mine.length - 1] ?? "C") : flip(mine[mine.length - 1] ?? "C");
  },
  grim: (_mine, theirs) => (theirs.includes("D") ? "D" : "C"),
  exploitative: (_mine, theirs) => (theirs.length >= 2 && theirs.at(-1) === "D" && theirs.at(-2) === "D" ? "C" : "D"),
  trusting: () => "C",
  gradual: (mine, theirs) => gradualPure(mine, theirs),
  erratic: (_mine, _theirs, rng) => (rng.unit() < 0.5 ? "C" : "D"),
  prober: (_mine, theirs) => {
    const opening: Move[] = ["D", "C", "C"];
    if (theirs.length < opening.length) return opening[theirs.length] ?? "C";
    return theirs[1] === "C" && theirs[2] === "C" ? "D" : (theirs.at(-1) ?? "C");
  },
  contrite: (mine, theirs) => {
    if (theirs.length === 0) return "C";
    const lastMine = mine[mine.length - 1];
    const lastTheirs = theirs[theirs.length - 1];
    if (lastMine === "D" && lastTheirs === "D" && mine.length >= 2 && mine[mine.length - 2] === "C") return "C";
    return lastTheirs ?? "C";
  },
  detective: (_mine, theirs) => {
    const opening: Move[] = ["C", "D", "C", "C"];
    if (theirs.length < 4) return opening[theirs.length] ?? "C";
    if (theirs.slice(0, 4).includes("D")) return theirs[theirs.length - 1] ?? "C";
    return "D";
  },
  zd_generous: zdGenerousStrategy(),
  zd_extort: zdExtortStrategy(),
  colluder: (_mine, theirs) => (theirs.length === 0 ? "C" : theirs[theirs.length - 1] ?? "C"),
  adaptive: (_mine, theirs, rng) => {
    if (theirs.length === 0) return "C";
    const pOppC = theirs.filter(m => m === "C").length / theirs.length;
    const target = Math.max(0, Math.min(1, 0.5 + (pOppC - 0.3)));
    return rng.unit() < target ? "C" : "D";
  },
  southampton: (mine, theirs) => {
    const HANDSHAKE: Move[] = ["D","D","C","C","D"];
    const n = theirs.length;
    if (n < HANDSHAKE.length) {
      const prefix = HANDSHAKE.slice(0, n);
      const minePrefix = mine.slice(0, n);
      const matches = prefix.every((v,i) => minePrefix[i] === v);
      return matches ? HANDSHAKE[n] ?? "C" : "D";
    }
    const mineHead = mine.slice(0, HANDSHAKE.length);
    const handOk = HANDSHAKE.every((v,i) => mineHead[i] === v);
    if (handOk) return "C";
    return "D";
  },
  alld: () => "D",
  allc: () => "C",
  tf2t: (_mine, theirs) => {
    if (theirs.length < 2) return "C";
    return theirs.at(-1) === "D" && theirs.at(-2) === "D" ? "D" : "C";
  },
};

export { makeMemoryOne as memoryOne, makeMemoryN as memoryN };

export interface MatchResult {
  scoreA: number;
  scoreB: number;
  cooperation: number;
}

export function playMatch(
  a: Strategy,
  b: Strategy,
  payoffA: Payoff,
  payoffB: Payoff,
  rounds: number,
  noise: number,
  rng: Rng,
  leanA = 0,
  leanB = 0,
  drift = 0,
): MatchResult {
  const historyA: Move[] = [];
  const historyB: Move[] = [];
  let scoreA = 0;
  let scoreB = 0;
  let cooperations = 0;
  let curLeanA = leanA;
  let curLeanB = leanB;
  for (let round = 0; round < rounds; round += 1) {
    let moveA = a(historyA, historyB, rng);
    let moveB = b(historyB, historyA, rng);
    if (curLeanA !== 0) {
      if (moveA === "C" && curLeanA < 0 && rng.unit() < -curLeanA) moveA = "D";
      else if (moveA === "D" && curLeanA > 0 && rng.unit() < curLeanA) moveA = "C";
    }
    if (curLeanB !== 0) {
      if (moveB === "C" && curLeanB < 0 && rng.unit() < -curLeanB) moveB = "D";
      else if (moveB === "D" && curLeanB > 0 && rng.unit() < curLeanB) moveB = "C";
    }
    if (rng.unit() < noise) moveA = flip(moveA);
    if (rng.unit() < noise) moveB = flip(moveB);
    scoreA += score(payoffA, moveA, moveB);
    scoreB += score(payoffB, moveB, moveA);
    cooperations += Number(moveA === "C") + Number(moveB === "C");
    historyA.push(moveA);
    historyB.push(moveB);
    if (drift !== 0) {
      curLeanA = Math.max(-1, Math.min(1, curLeanA + (moveB === "D" ? -drift : drift)));
      curLeanB = Math.max(-1, Math.min(1, curLeanB + (moveA === "D" ? -drift : drift)));
    }
  }
  return { scoreA, scoreB, cooperation: cooperations / (2 * rounds) };
}

export interface TournamentResult {
  fitness: Shares;
  cooperation: number;
}

/** One round-robin generation. Match seeds make later parallelisation reproducible. */
export function tournament(config: RunConfig, generation: number, rootSeed: number): TournamentResult {
  const active = strategyIds.filter((id) => (config.initialShares[id] ?? 0) > 0);
  const scores = Object.fromEntries(strategyIds.map((id) => [id, 0])) as Shares;
  let cooperation = 0;
  let matches = 0;
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i; j < active.length; j += 1) {
      const left = active[i];
      const right = active[j];
      if (!left || !right) continue;
      for (let rep = 0; rep < config.matchReps; rep += 1) {
        const result = playMatch(
          strategies[left], strategies[right], config.payoff, config.payoff,
          config.rounds, config.noise, new Rng(deriveSeed(rootSeed, generation, i, j, rep)),
        );
        if (left === right) {
          scores[left] += (result.scoreA + result.scoreB) / 2;
        } else {
          scores[left] += result.scoreA;
          scores[right] += result.scoreB;
        }
        cooperation += result.cooperation;
        matches += 1;
      }
    }
  }
  const divisor = Math.max(1, active.length * config.matchReps);
  for (const id of strategyIds) scores[id] /= divisor;
  return { fitness: scores, cooperation: cooperation / Math.max(1, matches) };
}

function weightedPick(shares: Shares, rng: Rng): StrategyId {
  let cursor = rng.unit();
  for (const id of strategyIds) {
    cursor -= shares[id];
    if (cursor <= 0) return id;
  }
  return strategyIds.at(-1) ?? "provocable";
}

export function evolve(shares: Shares, fitness: Shares, rule: RunConfig["rule"], populationSize: number, rng: Rng): Shares {
  if (rule === "replicator") {
    const meanFitness = strategyIds.reduce((sum, id) => sum + shares[id] * fitness[id], 0);
    const scale = Math.max(1, ...strategyIds.map((id) => Math.abs(fitness[id] - meanFitness)));
    return normalizeShares(Object.fromEntries(strategyIds.map((id) => [id, shares[id] * (1 + 0.5 * (fitness[id] - meanFitness) / scale)])) as Partial<Shares>);
  }
  const minimum = Math.min(...strategyIds.map((id) => fitness[id]));
  const parentWeights = normalizeShares(Object.fromEntries(strategyIds.map((id) => [id, shares[id] * (fitness[id] - minimum + 1e-9)])) as Partial<Shares>);
  const parent = weightedPick(parentWeights, rng);
  const victim = weightedPick(shares, rng);
  if (parent === victim) return shares;
  const next = { ...shares, [parent]: shares[parent] + 1 / populationSize, [victim]: shares[victim] - 1 / populationSize };
  return normalizeShares(next);
}

export interface Generation {
  shares: Shares;
  meanScores: Shares;
  cooperationRate: number;
}

export function stepGeneration(config: RunConfig, shares: Shares, generation: number, seed: number): Generation {
  const result = tournament({ ...config, initialShares: shares }, generation, seed);
  return {
    meanScores: result.fitness,
    cooperationRate: result.cooperation,
    shares: evolve(shares, result.fitness, config.rule, config.populationSize, new Rng(deriveSeed(seed, generation, 0xfeed))),
  };
}
