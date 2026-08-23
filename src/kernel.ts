import {
  type Move, type Outcome, type Payoff, type RunConfig, type Shares, type StrategyId,
  normalizeShares, score, strategyIds,
} from "./domain.js";
import { deriveSeed, Rng } from "./rng.js";
import { assess, discriminatorMove, type Image, type NormId } from "./reputation.js";

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

/**
 * Canonical zero-determinant memory-1 vector (Press & Dyson PNAS 2012).
 *
 * A ZD strategy enforces the linear relation `s_self - k = chi * (s_opp - k)` on the
 * long-run average scores against *any* opponent. Writing the probability vector as
 * `p~ = (p1-1, p2-1, p3, p4) = phi * [(S_self - k) - chi * (S_opp - k)]` with
 * `S_self = (R,S,T,P)` and `S_opp = (R,T,S,P)` gives the four entries below.
 *
 * - `anchor: "P"` (extortion, chi > 1): self keeps a chi-fold share of the surplus over
 *   mutual defection. Yields `p4 = 0` — never forgives mutual D.
 * - `anchor: "R"` (generosity, chi > 1): self absorbs a chi-fold share of any shortfall
 *   below mutual cooperation. Yields `p1 = 1` — never defects after mutual C.
 *
 * `phi` is set to its largest value keeping all four entries inside `[0,1]`, which is the
 * standard normalization; for `T,R,P,S = 5,3,1,0` and `chi = 2` the generous branch
 * reproduces Stewart & Plotkin's ZDGTFT-2 vector `(1, 1/8, 1, 1/4)` exactly.
 */
export function zdVector(payoff: Payoff, chi: number, anchor: "P" | "R"): [number, number, number, number] {
  const { T, R, P, S } = payoff;
  const k = anchor === "P" ? P : R;
  const raw = [(R - k) * (1 - chi), (S - k) - chi * (T - k), (T - k) - chi * (S - k), (P - k) * (1 - chi)];
  // Largest phi with p1..p4 all inside [0,1]: every |raw| term must stay within its slack.
  const bounds = [Math.abs(raw[0] ?? 0), Math.abs(raw[1] ?? 0), Math.abs(raw[2] ?? 0), Math.abs(raw[3] ?? 0)];
  const phi = 1 / Math.max(...bounds.filter((b) => b > 0), Number.EPSILON);
  return [
    clamp(1 + phi * (raw[0] ?? 0)), clamp(1 + phi * (raw[1] ?? 0)),
    clamp(phi * (raw[2] ?? 0)), clamp(phi * (raw[3] ?? 0)),
  ];
}

/** Payoff the registry entries are calibrated for; a ZD vector is only exact for one payoff table. */
export const ZD_BASELINE: Payoff = { T: 5, R: 3, P: 1, S: 0 };

export function zdStrategy(payoff: Payoff, chi: number, anchor: "P" | "R"): Strategy {
  const [p1, p2, p3, p4] = zdVector(payoff, chi, anchor);
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

function memory2Hilbe(): Strategy {
  const probs: Record<string, number> = {
    "CC|CC": 1, "CC|CD": 1, "CC|DC": 0, "CC|DD": 0.3,
    "CD|CC": 1, "CD|CD": 0, "CD|DC": 1, "CD|DD": 0,
    "DC|CC": 1, "DC|CD": 0.2, "DC|DC": 1, "DC|DD": 0,
    "DD|CC": 0.4, "DD|CD": 0, "DD|DC": 0.5, "DD|DD": 0.1,
  };
  return makeMemoryN(probs, 2);
}
/**
 * Retaliate-and-shape heuristic: punish the last defection hard, but push back toward
 * cooperation once the opponent's running cooperation rate is already high. Hand-tuned,
 * not a learning rule — deliberately *not* called LOLA, which needs opponent gradients.
 */
function shaperStrategy(): Strategy {
  let lastLen = 0; let coop = 0; let lastRef: readonly Move[] | null = null;
  return (mine, theirs, rng) => {
    if (theirs.length === 0) { lastLen = 0; coop = 0; lastRef = theirs; return "C"; }
    if (theirs === lastRef && theirs.length === lastLen + 1) {
      if (theirs[theirs.length - 1] === "C") coop += 1;
    } else if (theirs !== lastRef || theirs.length < lastLen) {
      coop = 0; for (let i = 0; i < theirs.length; i++) if (theirs[i] === "C") coop++;
    }
    lastLen = theirs.length; lastRef = theirs;
    const lastOpp = theirs[theirs.length - 1] ?? "C";
    const coopRate = coop / theirs.length;
    const retaliate = lastOpp === "D" ? 0.8 : 0.2;
    const shaping = coopRate > 0.6 ? -0.2 : 0.3;
    const pDefect = Math.max(0, Math.min(1, retaliate + shaping));
    return rng.unit() < pDefect ? "D" : "C";
  };
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
  zd_generous: zdStrategy(ZD_BASELINE, 2, "R"),
  zd_extort: zdStrategy(ZD_BASELINE, 3, "P"),
  colluder: (_mine, theirs) => (theirs.length === 0 ? "C" : theirs[theirs.length - 1] ?? "C"),
  adaptive: (() => {
    let lastLen = 0; let coop = 0; let lastRef: readonly Move[] | null = null;
    return (_mine, theirs, rng) => {
      if (theirs.length === 0) { lastLen = 0; coop = 0; lastRef = theirs; return "C"; }
      // incremental update when same array grows by one (playMatch path)
      if (theirs === lastRef && theirs.length === lastLen + 1) {
        if (theirs[theirs.length - 1] === "C") coop += 1;
      } else if (theirs !== lastRef || theirs.length < lastLen) {
        // fallback full scan for external callers (verify-pack, tournament)
        coop = 0; for (let i = 0; i < theirs.length; i++) if (theirs[i] === "C") coop++;
      }
      lastLen = theirs.length; lastRef = theirs;
      const pOppC = coop / theirs.length;
      const target = Math.max(0, Math.min(1, 0.5 + (pOppC - 0.3)));
      return rng.unit() < target ? "C" : "D";
    };
  })(),
  southampton: (_mine, theirs) => {
    const HANDSHAKE: Move[] = ["D","D","C","C","D"];
    const n = theirs.length;
    if (n < HANDSHAKE.length) return HANDSHAKE[n] ?? "C";
    const oppHead = theirs.slice(0, HANDSHAKE.length);
    const isKin = HANDSHAKE.every((v,i) => oppHead[i] === v);
    if (isKin) return "C";
    return "D";
  },
  alld: () => "D",
  allc: () => "C",

  semigrim: (mine, theirs, rng) => {
    if (mine.length===0) return "C";
    const lm=mine[mine.length-1], lt=theirs[theirs.length-1];
    if (lm==="C" && lt==="C") return "C";
    if (lm==="D" && lt==="D") return "D";
    return rng.unit()<0.5?"C":"D";
  },
  tf2t: (_mine, theirs) => {
    if (theirs.length < 2) return "C";
    return theirs.at(-1) === "D" && theirs.at(-2) === "D" ? "D" : "C";
  },
  memory2: memory2Hilbe(),
  shaper: shaperStrategy(),
  // Voluntary opt-out (Szabó & Hauert 2002): never plays a C/D move — resolved at the match level
  // (tournament / oneTrial award σ to both sides). This stub fires only if a caller forgets to intercept.
  loner: () => { throw new Error("loner opts out of the C/D game — resolve it at the match level with σ, do not call it as a move"); },
};

export { makeMemoryOne as memoryOne, makeMemoryN as memoryN };

export interface MatchResult {
  scoreA: number;
  scoreB: number;
  cooperation: number;
  /** Final environment state `n` when eco feedback is active; undefined otherwise. */
  envFinal?: number;
  /** Fraction of rounds spent in each game state when transitions are active; undefined otherwise. */
  stateOccupancy?: Record<string, number>;
}

/** Weitz eco state carried through a match: A0 is the passed match payoff, A1 the depleted corner. */
export interface EcoState { A1: Payoff; theta: number; epsilon: number; n: number }

/** Su game-transition state: named payoff matrices + the current state + the outcome→next map. */
export interface TransitionState { states: Record<string, Payoff>; cur: string; next: Record<Outcome, string> }

const outcomeOf = (a: Move, b: Move): Outcome => (a === "C" && b === "C" ? "CC" : a === "D" && b === "D" ? "DD" : "CD");

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpPayoff(a: Payoff, b: Payoff, t: number): Payoff {
  return { T: lerp(a.T, b.T, t), R: lerp(a.R, b.R, t), P: lerp(a.P, b.P, t), S: lerp(a.S, b.S, t) };
}

/** One environment step per round, sub-stepped so a large ε keeps the Euler error bounded (ROADMAP 1A). */
function ecoStep(n: number, epsilon: number, theta: number, coop: number): number {
  const steps = Math.max(1, Math.ceil(epsilon / 0.05));
  const de = epsilon / steps;
  let next = n;
  for (let s = 0; s < steps; s += 1) {
    next += de * next * (1 - next) * (theta * coop - (1 - coop));
    next = Math.min(0.99, Math.max(0.01, next));
  }
  return next;
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
  eco?: EcoState,
  transition?: TransitionState,
  norm?: NormId,
  gossipProb = 0,
  quantitative = false,
  theta = 0,
): MatchResult {
  const historyA: Move[] = [];
  const historyB: Move[] = [];
  let scoreA = 0;
  let scoreB = 0;
  let cooperations = 0;
  let curLeanA = leanA;
  let curLeanB = leanB;
  let ecoN = eco?.n ?? 0;
  let tState = transition?.cur ?? "";
  const occupancy: Record<string, number> = transition ? Object.fromEntries(Object.keys(transition.states).map((s) => [s, 0])) : {};
  let imageA: Image = "G", imageB: Image = "G";
  let repScoreA = 0, repScoreB = 0;
  for (let round = 0; round < rounds; round += 1) {
    let moveA = a(historyA, historyB, rng);
    let moveB = b(historyB, historyA, rng);
    if (quantitative) {
      moveA = repScoreA >= theta ? "C" : "D";
      moveB = repScoreB >= theta ? "C" : "D";
    } else if (norm) {
      if (imageA === "B") moveA = "D";
      if (imageB === "B") moveB = "D";
    }
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
    // Both sides play one shared matrix per round: eco interpolates it, transitions pick a named state.
    // (eco and transitions are mutually exclusive by schema, so these branches never overlap.)
    let pA = payoffA;
    let pB = payoffB;
    if (eco) { pA = lerpPayoff(payoffA, eco.A1, ecoN); pB = lerpPayoff(payoffB, eco.A1, ecoN); }
    else if (transition) { const m = transition.states[tState]!; pA = m; pB = m; occupancy[tState]! += 1; }
    scoreA += score(pA, moveA, moveB);
    scoreB += score(pB, moveB, moveA);
    const roundCoop = (Number(moveA === "C") + Number(moveB === "C")) / 2;
    cooperations += roundCoop * 2;
    if (eco) ecoN = ecoStep(ecoN, eco.epsilon, eco.theta, roundCoop);
    if (transition) tState = transition.next[outcomeOf(moveA, moveB)];
    historyA.push(moveA);
    historyB.push(moveB);
    if (norm || quantitative) {
      if (norm) {
        imageA = assess(norm, imageA, "G", moveB);
        imageB = assess(norm, imageB, "G", moveA);
        if (gossipProb > 0 && rng.unit() < gossipProb) {
          const tmp = imageA;
          imageA = imageB;
          imageB = tmp;
          if (rng.unit() < 0.5) { imageA = "G"; imageB = "G"; }
        }
      }
      if (quantitative) {
        repScoreA += moveB === "C" ? 1 : -1;
        repScoreB += moveA === "C" ? 1 : -1;
      }
    }
    if (drift !== 0) {
      curLeanA = Math.max(-1, Math.min(1, curLeanA + (moveB === "D" ? -drift : drift)));
      curLeanB = Math.max(-1, Math.min(1, curLeanB + (moveA === "D" ? -drift : drift)));
    }
  }
  return {
    scoreA, scoreB, cooperation: cooperations / (2 * rounds),
    ...(eco ? { envFinal: ecoN } : {}),
    ...(transition ? { stateOccupancy: Object.fromEntries(Object.entries(occupancy).map(([s, n]) => [s, n / rounds])) } : {}),
  };
}

export interface TournamentResult {
  fitness: Shares;
  cooperation: number;
}

/** One round-robin generation. Match seeds make later parallelisation reproducible. */
export function tournament(config: RunConfig, generation: number, rootSeed: number): TournamentResult {
  const active = strategyIds.filter((id) => (config.initialShares[id] ?? 0) > 0);
  if (active.includes("loner") && config.sigma === undefined) throw new Error("loner has a share but config.sigma is not set");
  const scores = Object.fromEntries(strategyIds.map((id) => [id, 0])) as Shares;
  let cooperation = 0;
  let matches = 0;
  let coopMatches = 0;
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i; j < active.length; j += 1) {
      const left = active[i];
      const right = active[j];
      if (!left || !right) continue;
      for (let rep = 0; rep < config.matchReps; rep += 1) {
        // A loner opts out: both sides collect σ per round, no C/D game, no cooperation contribution.
        if (left === "loner" || right === "loner") {
          const optOut = config.sigma! * config.rounds;
          if (left === right) scores[left] += optOut;
          else { scores[left] += optOut; scores[right] += optOut; }
          matches += 1;
          continue;
        }
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
        coopMatches += 1;
      }
    }
  }
  const divisor = Math.max(1, active.length * config.matchReps);
  for (const id of strategyIds) scores[id] /= divisor;
  return { fitness: scores, cooperation: cooperation / Math.max(1, coopMatches) };
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
