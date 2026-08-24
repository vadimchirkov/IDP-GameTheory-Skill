import {
  type Move, type Outcome, type Payoff, type RunConfig, type Shares, type StrategyId,
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
const coopCount = (theirs: readonly Move[]): number => {
  let coop = 0;
  for (let i = 0; i < theirs.length; i += 1) if (theirs[i] === "C") coop += 1;
  return coop;
};

/**
 * Retaliate-and-shape heuristic: punish the last defection hard, but push back toward
 * cooperation once the opponent's running cooperation rate is already high. Hand-tuned,
 * not a learning rule — deliberately *not* called LOLA, which needs opponent gradients.
 *
 * Pure: the cooperation rate is recomputed from `theirs` each call (O(n), matching `grim`/
 * `detective`), so no shared mutable closure can leak across matches — which is what the
 * `apply`/`deriveSeed` determinism contract requires (PROJECT_ARCHITECTURE §12).
 */
function shaperStrategy(): Strategy {
  return (_mine, theirs, rng) => {
    if (theirs.length === 0) return "C";
    const lastOpp = theirs[theirs.length - 1] ?? "C";
    const coopRate = coopCount(theirs) / theirs.length;
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
  // Pure: opponent cooperation rate recomputed from `theirs` each call (no shared closure state).
  adaptive: (_mine, theirs, rng) => {
    if (theirs.length === 0) return "C";
    const pOppC = coopCount(theirs) / theirs.length;
    const target = Math.max(0, Math.min(1, 0.5 + (pOppC - 0.3)));
    return rng.unit() < target ? "C" : "D";
  },
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
  // Institutional punisher (Sigmund 2010): cooperates in moves; its costly fining of defectors is
  // applied at the payoff layer via MatchModifiers.punishment (set by the caller from strategy identity).
  punisher: () => "C",
};

export { makeMemoryOne as memoryOne, makeMemoryN as memoryN };

export interface MatchResult {
  scoreA: number;
  scoreB: number;
  cooperation: number;
  /** Fraction of rounds each side cooperated — used by trial-level reputation to assess standing. */
  coopA: number;
  coopB: number;
  /** Constant-size story summary used to aggregate hundreds of matches into the worlds river. */
  digest: MatchDigest;
  /** Final environment state `n` when eco feedback is active; undefined otherwise. */
  envFinal?: number;
  /** Fraction of rounds spent in each game state when transitions are active; undefined otherwise. */
  stateOccupancy?: Record<string, number>;
  /** Full per-round history, collected only for an explicitly requested visual replay. */
  trace?: readonly MatchRound[];
}

export interface MatchDigest {
  opening: "CC" | "A-defects" | "B-defects" | "DD";
  firstBreach?: { round: number; by: "A" | "B" | "both"; response?: "repair" | "retaliation" | "exploitation" | "escalation" };
  finalCooperation: number;
  switchRate: number;
}

export interface MatchRound {
  moveA: Move;
  moveB: Move;
  scoreA: number;
  scoreB: number;
  leanA: number;
  leanB: number;
  environment?: number;
  state?: string;
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

/**
 * Per-match model knobs. Everything past the core `(a,b,payoffs,rounds,noise,rng)` lives here so
 * adding a dynamic model is a new optional field, not another positional argument. A bare
 * `playMatch(...,rng)` call plays the plain iterated game (every field defaults off).
 */
export interface MatchModifiers {
  /** Initial lean of each side (`values`), −1 flips C→D w.p.1, +1 flips D→C. */
  leanA?: number;
  leanB?: number;
  /** Lean shift per observed move (after D `−=drift`, after C `+=drift`). */
  drift?: number;
  /** Weitz eco feedback: the shared matrix drifts between A0 and A1 with the environment. */
  eco?: EcoState | undefined;
  /** Su game transitions: the shared matrix jumps between named states by round outcome. */
  transition?: TransitionState | undefined;
  /** Sigmund pool/peer punishment: a punishing side fines a defecting opponent `beta` at self-cost `gamma`. */
  punishment?: { beta: number; gamma: number; pool: boolean; aPunishes: boolean; bPunishes: boolean } | undefined;
  /** Pre-play cheap talk: a mutual C-pledge grants `credibility` cooperative lean; a broken C-pledge costs `lieCost`/defection. */
  cheapTalk?: { credibility: number; lieCost: number } | undefined;
  /** Collect the match timeline for a visual replay. Off on the Monte Carlo hot path. */
  captureTrace?: boolean;
}

export function playMatch(
  a: Strategy,
  b: Strategy,
  payoffA: Payoff,
  payoffB: Payoff,
  rounds: number,
  noise: number,
  rng: Rng,
  mods: MatchModifiers = {},
): MatchResult {
  const leanA = mods.leanA ?? 0;
  const leanB = mods.leanB ?? 0;
  const drift = mods.drift ?? 0;
  const eco = mods.eco;
  const transition = mods.transition;
  const punishment = mods.punishment;
  const cheapTalk = mods.cheapTalk;
  const trace: MatchRound[] | undefined = mods.captureTrace ? [] : undefined;
  const historyA: Move[] = [];
  const historyB: Move[] = [];
  let scoreA = 0;
  let scoreB = 0;
  let cooperations = 0;
  let coopA = 0;
  let coopB = 0;
  let opening: MatchDigest["opening"] = "CC";
  let firstBreach: MatchDigest["firstBreach"];
  let previousOutcome = "";
  let switches = 0;
  const tailSize = Math.max(1, Math.ceil(rounds * 0.2));
  const tail: number[] = [];
  let tailCooperation = 0;
  let curLeanA = leanA;
  let curLeanB = leanB;
  // Cheap talk: each side pledges its opening move; a mutual C-pledge grants a cooperative lean.
  let pledgeA: Move = "C", pledgeB: Move = "C";
  if (cheapTalk) {
    pledgeA = a(historyA, historyB, rng);
    pledgeB = b(historyB, historyA, rng);
    if (pledgeA === "C" && pledgeB === "C") {
      curLeanA = Math.min(1, curLeanA + cheapTalk.credibility);
      curLeanB = Math.min(1, curLeanB + cheapTalk.credibility);
    }
  }
  let ecoN = eco?.n ?? 0;
  let tState = transition?.cur ?? "";
  const occupancy: Record<string, number> = transition ? Object.fromEntries(Object.keys(transition.states).map((s) => [s, 0])) : {};
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
    // Both sides play one shared matrix per round: eco interpolates it, transitions pick a named state.
    // (eco and transitions are mutually exclusive by schema, so these branches never overlap.)
    let pA = payoffA;
    let pB = payoffB;
    if (eco) { pA = lerpPayoff(payoffA, eco.A1, ecoN); pB = lerpPayoff(payoffB, eco.A1, ecoN); }
    else if (transition) { const m = transition.states[tState]!; pA = m; pB = m; occupancy[tState]! += 1; }
    scoreA += score(pA, moveA, moveB);
    scoreB += score(pB, moveB, moveA);
    // Sigmund punishment: a punisher pays γ (peer: only when it fines a defection; pool: every round)
    // and each defector loses β to every punishing opponent.
    if (punishment) {
      const { beta, gamma, pool, aPunishes, bPunishes } = punishment;
      if (aPunishes) { if (pool) { scoreA -= gamma; if (moveB === "D") scoreB -= beta; } else if (moveB === "D") { scoreA -= gamma; scoreB -= beta; } }
      if (bPunishes) { if (pool) { scoreB -= gamma; if (moveA === "D") scoreA -= beta; } else if (moveA === "D") { scoreB -= gamma; scoreA -= beta; } }
    }
    // Cheap-talk lie cost: a side that pledged C pays for each round it defects (makes the pledge credible).
    if (cheapTalk && cheapTalk.lieCost !== 0) {
      if (pledgeA === "C" && moveA === "D") scoreA -= cheapTalk.lieCost;
      if (pledgeB === "C" && moveB === "D") scoreB -= cheapTalk.lieCost;
    }
    trace?.push({
      moveA, moveB, scoreA, scoreB, leanA: curLeanA, leanB: curLeanB,
      ...(eco ? { environment: ecoN } : {}),
      ...(transition ? { state: tState } : {}),
    });
    coopA += Number(moveA === "C");
    coopB += Number(moveB === "C");
    const roundCoop = (Number(moveA === "C") + Number(moveB === "C")) / 2;
    const directedOutcome = moveA === "C" && moveB === "C" ? "CC" : moveA === "D" && moveB === "D" ? "DD" : moveA === "D" ? "A-defects" : "B-defects";
    if (round === 0) opening = directedOutcome;
    if (!firstBreach && directedOutcome !== "CC") firstBreach = { round: round + 1, by: directedOutcome === "DD" ? "both" : directedOutcome === "A-defects" ? "A" : "B" };
    else if (firstBreach && firstBreach.response === undefined && round === firstBreach.round) {
      const breachedByA = firstBreach.by === "A";
      firstBreach.response = directedOutcome === "CC" ? "repair"
        : directedOutcome === "DD" ? "escalation"
        : (breachedByA && moveB === "D") || (!breachedByA && moveA === "D") ? "retaliation"
        : "exploitation";
    }
    if (previousOutcome && previousOutcome !== directedOutcome) switches += 1;
    previousOutcome = directedOutcome;
    tail.push(roundCoop); tailCooperation += roundCoop;
    if (tail.length > tailSize) tailCooperation -= tail.shift() ?? 0;
    cooperations += roundCoop * 2;
    if (eco) ecoN = ecoStep(ecoN, eco.epsilon, eco.theta, roundCoop);
    if (transition) tState = transition.next[outcomeOf(moveA, moveB)];
    historyA.push(moveA);
    historyB.push(moveB);
    if (drift !== 0) {
      curLeanA = Math.max(-1, Math.min(1, curLeanA + (moveB === "D" ? -drift : drift)));
      curLeanB = Math.max(-1, Math.min(1, curLeanB + (moveA === "D" ? -drift : drift)));
    }
  }
  return {
    scoreA, scoreB, cooperation: cooperations / (2 * rounds),
    coopA: coopA / rounds, coopB: coopB / rounds,
    digest: {
      opening,
      ...(firstBreach ? { firstBreach } : {}),
      finalCooperation: tailCooperation / tail.length,
      switchRate: switches / Math.max(1, rounds - 1),
    },
    ...(eco ? { envFinal: ecoN } : {}),
    ...(transition ? { stateOccupancy: Object.fromEntries(Object.entries(occupancy).map(([s, n]) => [s, n / rounds])) } : {}),
    ...(trace ? { trace } : {}),
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
  if (active.includes("punisher") && config.punishment === undefined) throw new Error("punisher has a share but config.punishment is not set");
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
        const punishment = config.punishment && (left === "punisher" || right === "punisher")
          ? { beta: config.punishment.beta, gamma: config.punishment.gamma, pool: config.punishment.pool, aPunishes: left === "punisher", bPunishes: right === "punisher" }
          : undefined;
        const result = playMatch(
          strategies[left], strategies[right], config.payoff, config.payoff,
          config.rounds, config.noise, new Rng(deriveSeed(rootSeed, generation, i, j, rep)),
          { punishment },
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
