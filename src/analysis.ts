import {
  assertScenario, isValidPayoff, type GameType, type Payoff, type PayoffRanges,
  type ScenarioModel, type StrategyId,
} from "./domain.js";
import { memoryN, playMatch, strategies, type EcoState, type TransitionState } from "./kernel.js";
import { Rng } from "./rng.js";

export interface Trial {
  winners: readonly string[];
  teamWinners: readonly string[];
  perCapitaWinners: readonly string[];
  cooperation: number;
  inputs: Payoff & { w: number; noise: number; drift: number } & Record<string, number>;
  /** Sum of members' normalised scores (see `normaliseScore`), not raw points. */
  teamScores: Record<string, number>;
  /** Mean final environment state across the trial's matches, when eco feedback is active. */
  envFinal?: number;
  /** Mean per-state occupancy across the trial's matches, when game transitions are active. */
  stateOccupancy?: Record<string, number>;
}

function payoffRangesFor(model: ScenarioModel, name: string): PayoffRanges {
  const shared = model.payoffs as Partial<PayoffRanges>;
  if (shared.T !== undefined) return model.payoffs as PayoffRanges;
  const asymmetric = model.payoffs as Record<string, PayoffRanges>;
  const ranges = asymmetric[name];
  if (!ranges) throw new Error(`Missing payoffs for ${name}`);
  return ranges;
}

export function samplePayoff(ranges: PayoffRanges, game: GameType, rng: Rng): Payoff {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const payoff: Payoff = { T: rng.between(ranges.T), R: rng.between(ranges.R), P: rng.between(ranges.P), S: rng.between(ranges.S) };
    if (isValidPayoff(game, payoff)) return payoff;
  }
  throw new Error(`Payoff ranges cannot satisfy ${game}`);
}

/** Cap is 5x the longest mean horizon `w` can ask for (1/(1-0.9995)=2000), so truncation bias stays under 1%. */
const MAX_ROUNDS = 10_000;

function geometricHorizon(w: number, rng: Rng): number {
  let rounds = 1;
  while (rounds < MAX_ROUNDS && rng.unit() < w) rounds += 1;
  return rounds;
}

/**
 * Raw points are not comparable across players with different payoff tables — a side whose
 * stakes are denominated 100x larger "wins" every trial by construction. Map each score onto
 * the share of its own attainable range instead: 0 = suckered every round, 1 = exploited every
 * round. Symmetric payoffs divide every player by the same constant, so rankings there are
 * unchanged.
 */
function normaliseScore(score: number, payoff: Payoff, rounds: number, opponents: number): number {
  const span = rounds * opponents * (payoff.T - payoff.S);
  if (span <= 0) return 0;
  return (score - rounds * opponents * payoff.S) / span;
}

function teamOf(p: { name: string; team?: string }): string { return p.team ?? p.name; }

/** A player's own rule, before any coalition wrapper: an explicit memory table beats the picked disposition. */
function baseStrategy(player: import("./domain.js").ScenarioPlayer, pickedId: StrategyId): import("./kernel.js").Strategy {
  const table = player.memory;
  if (table) return memoryN(table, Object.keys(table)[0]?.split("|").length ?? 1);
  return strategies[pickedId];
}

/**
 * Coalition wrapper. `colluder` cooperates unconditionally with a teammate (betraying with
 * `betrayalProb`) and plays tit-for-tat with outsiders. Any other disposition — including a
 * custom `memory` table — passes through untouched.
 */
function effectiveStrategy(
  player: import("./domain.js").ScenarioPlayer,
  pickedId: StrategyId,
  oppTeam: string,
): import("./kernel.js").Strategy {
  if (pickedId !== "colluder") return baseStrategy(player, pickedId);
  if (teamOf(player) !== oppTeam) return (_mine, theirs) => (theirs.length === 0 ? "C" : theirs[theirs.length - 1] ?? "C");
  const betrayalProb = player.betrayalProb;
  if (betrayalProb !== undefined && betrayalProb > 0) return (_mine, _theirs, rng) => (rng.unit() < betrayalProb ? "D" : "C");
  return () => "C";
}

export function oneTrial(model: ScenarioModel, rng: Rng): Trial {
  assertScenario(model);
  const game = model.game ?? "prisoners_dilemma";
  const w = rng.between(model.structure.w);
  const noise = rng.between(model.structure.noise);
  const drift = model.structure.drift ? rng.between(model.structure.drift) : 0;
  const rounds = geometricHorizon(w, rng);
  const payoffByName = new Map(model.players.map((player) => [player.name, samplePayoff(payoffRangesFor(model, player.name), game, rng)]));
  const strategyByName = new Map(model.players.map((player) => [player.name, rng.pick(player.dispositions)]));
  const leanByName = new Map(model.players.map((player) => [player.name, player.values ? rng.between(player.values) : 0]));
  // Eco: sample A1/θ/ε/n0 once per trial; each match gets a fresh EcoState starting at n0 (Weitz per-pair).
  const ecoCfg = model.structure.eco;
  const eco = ecoCfg
    ? { A1: samplePayoff(ecoCfg.A1, ecoCfg.game1 ?? "prisoners_dilemma", rng), theta: rng.between(ecoCfg.theta), epsilon: rng.between(ecoCfg.epsilon), n0: rng.between(ecoCfg.n0) }
    : undefined;
  // Transitions: sample every state matrix once per trial; each match opens at `start` (Su per-edge).
  const transCfg = model.structure.transitions;
  const transStates = transCfg
    ? Object.fromEntries(Object.entries(transCfg.states).map(([name, ranges]) => [name, samplePayoff(ranges, game, rng)]))
    : undefined;
  // Loner opt-out payoff (Szabó-Hauert): both sides collect σ per round, no C/D game played.
  const sigma = model.structure.sigma ? rng.between(model.structure.sigma) : undefined;
  const scores = new Map(model.players.map((player) => [player.name, 0]));
  let cooperation = 0;
  let coopMatches = 0;
  let envSum = 0;
  let ecoMatches = 0;
  const occSum: Record<string, number> = transCfg ? Object.fromEntries(Object.keys(transCfg.states).map((s) => [s, 0])) : {};
  for (let i = 0; i < model.players.length; i += 1) {
    for (let j = i + 1; j < model.players.length; j += 1) {
      const a = model.players[i];
      const b = model.players[j];
      if (!a || !b) continue;
      const aPayoff = payoffByName.get(a.name);
      const bPayoff = payoffByName.get(b.name);
      const aId = strategyByName.get(a.name);
      const bId = strategyByName.get(b.name);
      const aLean = leanByName.get(a.name) ?? 0;
      const bLean = leanByName.get(b.name) ?? 0;
      if (!aPayoff || !bPayoff || !aId || !bId) throw new Error("Incomplete trial");
      if (aId === "loner" || bId === "loner") {
        const optOut = (sigma ?? 0) * rounds;
        scores.set(a.name, (scores.get(a.name) ?? 0) + optOut);
        scores.set(b.name, (scores.get(b.name) ?? 0) + optOut);
        continue; // abstention: not counted toward cooperation
      }
      const aStrat = effectiveStrategy(a, aId, teamOf(b));
      const bStrat = effectiveStrategy(b, bId, teamOf(a));
      const ecoState: EcoState | undefined = eco ? { A1: eco.A1, theta: eco.theta, epsilon: eco.epsilon, n: eco.n0 } : undefined;
      const transState: TransitionState | undefined = transStates && transCfg ? { states: transStates, cur: transCfg.start, next: transCfg.next } : undefined;
      const match = playMatch(aStrat, bStrat, aPayoff, bPayoff, rounds, noise, rng, aLean, bLean, drift, ecoState, transState);
      scores.set(a.name, (scores.get(a.name) ?? 0) + match.scoreA);
      scores.set(b.name, (scores.get(b.name) ?? 0) + match.scoreB);
      cooperation += match.cooperation;
      if (match.envFinal !== undefined) { envSum += match.envFinal; ecoMatches += 1; }
      if (match.stateOccupancy) for (const [s, f] of Object.entries(match.stateOccupancy)) occSum[s] = (occSum[s] ?? 0) + f;
      coopMatches += 1;
    }
  }
  const opponents = model.players.length - 1;
  for (const player of model.players) {
    const payoff = payoffByName.get(player.name);
    if (!payoff) throw new Error("Incomplete trial");
    scores.set(player.name, normaliseScore(scores.get(player.name) ?? 0, payoff, rounds, opponents));
  }
  const highScore = Math.max(...scores.values());
  const winners = [...scores].filter(([, value]) => Math.abs(value - highScore) < 1e-9).map(([name]) => name);
  const teamScores: Record<string, number> = {};
  const teamSizes: Record<string, number> = {};
  for (const p of model.players) { const t = teamOf(p); teamScores[t] = (teamScores[t] ?? 0) + (scores.get(p.name) ?? 0); teamSizes[t] = (teamSizes[t] ?? 0) + 1; }
  const teamPerCapita: Record<string, number> = Object.fromEntries(Object.entries(teamScores).map(([t, s]) => [t, s / (teamSizes[t] ?? 1)]));
  const maxTeam = Math.max(...Object.values(teamScores));
  const maxPerCapita = Math.max(...Object.values(teamPerCapita));
  const teamWinners = Object.entries(teamScores).filter(([, v]) => Math.abs(v - maxTeam) < 1e-9).map(([t]) => t);
  const perCapitaWinners = Object.entries(teamPerCapita).filter(([, v]) => Math.abs(v - maxPerCapita) < 1e-9).map(([t]) => t);
  const average = (key: keyof Payoff) => [...payoffByName.values()].reduce((sum, payoff) => sum + payoff[key], 0) / payoffByName.size;
  const avgDrift = drift;
  const inputs = { T: average("T"), R: average("R"), P: average("P"), S: average("S"), w, noise, drift: avgDrift } as Trial["inputs"];
  for (const [name, lean] of leanByName) (inputs as Record<string, number>)[`value_${name}`] = lean;
  if (eco) { inputs.eco_theta = eco.theta; inputs.eco_epsilon = eco.epsilon; inputs.eco_n0 = eco.n0; }
  if (sigma !== undefined) inputs.sigma = sigma;
  return {
    winners, teamWinners, perCapitaWinners, teamScores,
    cooperation: cooperation / Math.max(1, coopMatches),
    inputs,
    ...(eco ? { envFinal: envSum / Math.max(1, ecoMatches) } : {}),
    ...(transCfg ? { stateOccupancy: Object.fromEntries(Object.entries(occSum).map(([s, f]) => [s, f / Math.max(1, coopMatches)])) } : {}),
  };
}

const mean = (numbers: readonly number[]) => numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
const std = (numbers: readonly number[]) => Math.sqrt(mean(numbers.map((n) => (n - mean(numbers)) ** 2)));
const corr = (xs: readonly number[], ys: readonly number[]) => {
  const mx = mean(xs); const my = mean(ys);
  const numerator = xs.reduce((sum, x, i) => sum + (x - mx) * ((ys[i] ?? 0) - my), 0);
  const denominator = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0) * ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return denominator === 0 ? 0 : numerator / denominator;
};

export interface Sensitivity {
  input: string;
  /** Signed Pearson correlation — the sign tells you which way the input pushes. */
  correlation: number;
}

export interface ScenarioResult {
  trials: readonly Trial[];
  winPct: Record<string, number>;
  winPctTeam: Record<string, number>;
  winPctPerCapita: Record<string, number>;
  cooperation: { mean: number; std: number };
  /** What moves cooperation, strongest first. */
  sensitivity: readonly Sensitivity[];
  /** What moves the leading side's odds of winning, strongest first. */
  sensitivityWin: readonly Sensitivity[];
  /** Side `sensitivityWin` is measured for (top team if teams are used, else top player). */
  sensitivityWinTarget: string;
  /** Final environment state `n` (mean ± std over trials), present only when eco feedback is active. `n→0` = healthy/A0, `n→1` = depleted/A1. */
  environment?: { mean: number; std: number };
  /** Mean fraction of rounds spent in each game state, present only when transitions are active. */
  stateOccupancy?: Record<string, number>;
}

export function analyzeScenario(model: ScenarioModel, trials: number, seed: number): ScenarioResult {
  if (!Number.isInteger(trials) || trials < 1) throw new Error("trials must be a positive integer");
  const rng = new Rng(seed);
  const runs = Array.from({ length: trials }, () => oneTrial(model, rng));
  const wins: Record<string, number> = Object.fromEntries(model.players.map((p) => [p.name, 0]));
  const teamWins: Record<string, number> = {};
  const perCapitaWins: Record<string, number> = {};
  for (const p of model.players) { const t = teamOf(p); if (!(t in teamWins)) teamWins[t]=0; if (!(t in perCapitaWins)) perCapitaWins[t]=0; }
  for (const run of runs) {
    for (const w of run.winners) wins[w] = (wins[w] ?? 0) + 1 / run.winners.length;
    for (const t of run.teamWinners) teamWins[t] = (teamWins[t] ?? 0) + 1 / run.teamWinners.length;
    for (const t of run.perCapitaWinners) perCapitaWins[t] = (perCapitaWins[t] ?? 0) + 1 / run.perCapitaWinners.length;
  }
  const baseInputs = ["T", "R", "P", "S", "w", "noise", "drift"] as const;
  const extraInputs = [...new Set(runs.flatMap(r => Object.keys(r.inputs)).filter(k => k.startsWith("value_") || k.startsWith("eco_") || k === "sigma"))];
  const allInputs = [...baseInputs, ...extraInputs];
  const cooperation = runs.map((run) => run.cooperation);
  const winPct = Object.fromEntries(Object.entries(wins).map(([name, w]) => [name, 100 * w / trials]));
  const winPctTeam = Object.fromEntries(Object.entries(teamWins).map(([t, w]) => [t, 100 * w / trials]));

  // "Who wins" needs its own sensitivity: an input can leave cooperation flat while deciding the winner.
  const usesTeams = model.players.some((p) => p.team);
  const leaderboard = Object.entries(usesTeams ? winPctTeam : winPct).sort(([, a], [, b]) => b - a);
  const target = leaderboard[0]?.[0] ?? "";
  const won = runs.map((run) => {
    const winnersOf = usesTeams ? run.teamWinners : run.winners;
    return winnersOf.includes(target) ? 1 / winnersOf.length : 0;
  });
  const against = (ys: readonly number[]) => allInputs
    .map((input) => ({ input, correlation: corr(runs.map((run) => (run.inputs as Record<string, number>)[input] ?? 0), ys) }))
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  return {
    trials: runs,
    winPct,
    winPctTeam,
    winPctPerCapita: Object.fromEntries(Object.entries(perCapitaWins).map(([t, w]) => [t, 100 * w / trials])),
    cooperation: { mean: mean(cooperation), std: std(cooperation) },
    sensitivity: against(cooperation),
    sensitivityWin: against(won),
    sensitivityWinTarget: target,
    ...(model.structure.eco ? { environment: (() => { const e = runs.map((r) => r.envFinal ?? 0); return { mean: mean(e), std: std(e) }; })() } : {}),
    ...(model.structure.transitions ? { stateOccupancy: (() => {
      const names = Object.keys(model.structure.transitions!.states);
      return Object.fromEntries(names.map((s) => [s, mean(runs.map((r) => r.stateOccupancy?.[s] ?? 0))]));
    })() } : {}),
  };
}

export function scenarioReport(result: ScenarioResult): string {
  const teamWinner = Object.entries(result.winPctTeam).sort(([, a], [, b]) => b - a)[0];
  const playerWinner = Object.entries(result.winPct).sort(([, a], [, b]) => b - a)[0];
  const hasTeams = Object.keys(result.winPctTeam).length !== Object.keys(result.winPct).length || Object.keys(result.winPctTeam).some(k => !(k in result.winPct));
  const leader = hasTeams && teamWinner
    ? (teamWinner[1] >= 60 ? `Team ${teamWinner[0]} leads in ${teamWinner[1].toFixed(0)}% of worlds (per-capita: ${Object.entries(result.winPctPerCapita).sort(([,a],[,b])=>b-a)[0]?.[0]} ${Object.entries(result.winPctPerCapita).sort(([,a],[,b])=>b-a)[0]?.[1].toFixed(0)}%).` : "No team has a robust lead.")
    : (playerWinner?.[1] !== undefined && playerWinner[1] >= 60 ? `${playerWinner[0]} leads in ${playerWinner[1].toFixed(0)}% of worlds.` : "No side has a robust lead.");
  const pivots = [
    describePivot(result.sensitivity[0], "cooperation"),
    describePivot(result.sensitivityWin[0], `${result.sensitivityWinTarget} winning`),
  ].filter(Boolean).join("; ");
  const env = result.environment
    ? ` The shared environment settles ${result.environment.mean < 0.4 ? "healthy" : result.environment.mean > 0.6 ? "depleted" : "mid, oscillating"} (n≈${result.environment.mean.toFixed(2)} ± ${result.environment.std.toFixed(2)}).`
    : "";
  const occ = result.stateOccupancy
    ? (() => { const top = Object.entries(result.stateOccupancy).sort(([, a], [, b]) => b - a)[0]; return top ? ` The game sits in "${top[0]}" ${(top[1] * 100).toFixed(0)}% of the time.` : ""; })()
    : "";
  return `${leader} Cooperation averages ${(result.cooperation.mean * 100).toFixed(0)}% (± ${(result.cooperation.std * 100).toFixed(0)}%).${env}${occ} Most worth verifying: ${pivots || "n/a"}.`;
}

function describePivot(pivot: Sensitivity | undefined, target: string): string {
  if (!pivot || Math.abs(pivot.correlation) < 0.1) return "";
  return `${pivot.input} (${pivot.correlation > 0 ? "raises" : "lowers"} ${target})`;
}
