import {
  assertScenario, isValidPayoff, type GameType, type Payoff, type PayoffRanges,
  type ScenarioModel, type Shares, type StrategyId,
} from "./domain.js";
import { playMatch, strategies } from "./kernel.js";
import { Rng } from "./rng.js";
import { coopRate, createGrid, stepSpatial } from "./spatial.js";

export interface Trial {
  winners: readonly string[];
  teamWinners: readonly string[];
  perCapitaWinners: readonly string[];
  cooperation: number;
  inputs: Payoff & { w: number; noise: number; drift: number } & Record<string, number>;
  teamScores: Record<string, number>;
}

function payoffRangesFor(model: ScenarioModel, name: string): PayoffRanges {
  const shared = model.payoffs as Partial<PayoffRanges>;
  if (shared.T !== undefined) return model.payoffs as PayoffRanges;
  const asymmetric = model.payoffs as Record<string, PayoffRanges>;
  const ranges = asymmetric[name];
  if (!ranges) throw new Error(`Missing payoffs for ${name}`);
  return ranges;
}

function samplePayoff(ranges: PayoffRanges, game: GameType, rng: Rng): Payoff {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const payoff: Payoff = { T: rng.between(ranges.T), R: rng.between(ranges.R), P: rng.between(ranges.P), S: rng.between(ranges.S) };
    if (isValidPayoff(game, payoff)) return payoff;
  }
  throw new Error(`Payoff ranges cannot satisfy ${game}`);
}

function geometricHorizon(w: number, rng: Rng): number {
  let rounds = 1;
  while (rounds < 2_000 && rng.unit() < w) rounds += 1;
  return rounds;
}

function teamOf(p: { name: string; team?: string }): string { return p.team ?? p.name; }

function effectiveStrategy(id: StrategyId, myTeam: string, oppTeam: string): import("./kernel.js").Strategy {
  if (id !== "colluder") return strategies[id];
  if (myTeam === oppTeam) return () => "C";
  return (_mine, theirs) => (theirs.length === 0 ? "C" : theirs[theirs.length - 1] ?? "C");
}

function spatialTrial(model: ScenarioModel, rng: Rng, payoff: import("./domain.js").Payoff, noise: number, w:number, drift:number): { cooperation:number; scores: Map<string,number> } {
  const size = model.topology?.size ?? 10;
  const K = model.topology?.K ?? 0.1;
  const gens = Math.max(10, Math.round(geometricHorizon(w, rng)/2));
  const ri=(n:number)=> Math.floor(rng.unit()*n);
  let grid = createGrid(size, ()=> rng.unit()<0.5?"C":"D");
  if (model.topology?.type==="small_world") { for(let r=0;r<size;r++) for(let c=0;c<size;c++) if(rng.unit()<0.1) grid[r]![c]= rng.unit()<0.5?"C":"D"; }
  if (model.topology?.type==="scale_free") { const hubs=Math.floor(size/3); for(let i=0;i<hubs;i++) grid[ri(size)]![ri(size)]="C"; }
  let coopSum=0;
  for(let g=0;g<gens;g++){ if(rng.unit()<noise) grid[ri(size)]![ri(size)]= grid[ri(size)]![ri(size)]==="C"?"D":"C"; grid=stepSpatial(grid, payoff, "fermi", rng, K); coopSum+=coopRate(grid); }
  const finalCoop=coopRate(grid);
  // Synthetic: lattice is C/D field, not per-player strategies — all players share global coop score (placeholder). Real per-player payoff requires mapping players→grid clusters (TODO spatial branch).
  const scores=new Map(model.players.map(p=>[p.name, finalCoop>0.5? finalCoop*10 : (1-finalCoop)*10]));
  return { cooperation: coopSum/gens, scores: scores as Map<string,number> };
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
  if (model.topology) {
    const avgPayoff: import("./domain.js").Payoff = { T: [...payoffByName.values()].reduce((s,p)=>s+p.T,0)/payoffByName.size, R: [...payoffByName.values()].reduce((s,p)=>s+p.R,0)/payoffByName.size, P: [...payoffByName.values()].reduce((s,p)=>s+p.P,0)/payoffByName.size, S: [...payoffByName.values()].reduce((s,p)=>s+p.S,0)/payoffByName.size };
    const sp = spatialTrial(model, rng, avgPayoff, noise, w, drift);
    const high = Math.max(...sp.scores.values());
    const winners=[...sp.scores].filter(([,v])=>Math.abs(v-high)<1e-9).map(([n])=>n);
    const teamScores: Record<string, number> = {}; const teamSizes: Record<string, number> = {};
    for(const p of model.players){ const t=teamOf(p); teamScores[t]=(teamScores[t]??0)+(sp.scores.get(p.name)??0); teamSizes[t]=(teamSizes[t]??0)+1; }
    const perCap=Object.fromEntries(Object.entries(teamScores).map(([t,s])=>[t,s/(teamSizes[t]??1)]));
    const maxT=Math.max(...Object.values(teamScores)); const maxP=Math.max(...Object.values(perCap));
    const teamWinners=Object.entries(teamScores).filter(([,v])=>Math.abs(v-maxT)<1e-9).map(([t])=>t);
    const perCapWinners=Object.entries(perCap).filter(([,v])=>Math.abs(v-maxP)<1e-9).map(([t])=>t);
    const avg=(key: keyof import("./domain.js").Payoff)=> [...payoffByName.values()].reduce((s,p)=>s+p[key],0)/payoffByName.size;
    const inputs={T:avg("T"),R:avg("R"),P:avg("P"),S:avg("S"),w,noise,drift} as Trial["inputs"];
    for(const [name,lean] of leanByName) (inputs as Record<string,number>)[`value_${name}`]=lean;
    return { winners, teamWinners, perCapitaWinners:perCapWinners, teamScores, cooperation: sp.cooperation, inputs };
  }
  const scores = new Map(model.players.map((player) => [player.name, 0]));
  let cooperation = 0;
  let matches = 0;
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
      const aTeam = teamOf(a); const bTeam = teamOf(b);
      const match = playMatch(effectiveStrategy(aId, aTeam, bTeam), effectiveStrategy(bId, bTeam, aTeam), aPayoff, bPayoff, rounds, noise, rng, aLean, bLean, drift);
      scores.set(a.name, (scores.get(a.name) ?? 0) + match.scoreA);
      scores.set(b.name, (scores.get(b.name) ?? 0) + match.scoreB);
      cooperation += match.cooperation;
      matches += 1;
    }
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
  return {
    winners, teamWinners, perCapitaWinners, teamScores,
    cooperation: cooperation / Math.max(1, matches),
    inputs,
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

export interface ScenarioResult {
  trials: readonly Trial[];
  winPct: Record<string, number>;
  winPctTeam: Record<string, number>;
  winPctPerCapita: Record<string, number>;
  cooperation: { mean: number; std: number };
  sensitivity: readonly { input: string; correlation: number }[];
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
  const extraInputs = [...new Set(runs.flatMap(r => Object.keys(r.inputs)).filter(k => k.startsWith("value_")))];
  const allInputs = [...baseInputs, ...extraInputs];
  const cooperation = runs.map((run) => run.cooperation);
  return {
    trials: runs,
    winPct: Object.fromEntries(Object.entries(wins).map(([name, w]) => [name, 100 * w / trials])),
    winPctTeam: Object.fromEntries(Object.entries(teamWins).map(([t, w]) => [t, 100 * w / trials])),
    winPctPerCapita: Object.fromEntries(Object.entries(perCapitaWins).map(([t, w]) => [t, 100 * w / trials])),
    cooperation: { mean: mean(cooperation), std: std(cooperation) },
    sensitivity: allInputs.map((input) => ({ input, correlation: Math.abs(corr(runs.map((run) => (run.inputs as Record<string,number>)[input] ?? 0), cooperation)) })).sort((a, b) => b.correlation - a.correlation),
  };
}

export function scenarioReport(result: ScenarioResult): string {
  const teamWinner = Object.entries(result.winPctTeam).sort(([, a], [, b]) => b - a)[0];
  const playerWinner = Object.entries(result.winPct).sort(([, a], [, b]) => b - a)[0];
  const hasTeams = Object.keys(result.winPctTeam).length !== Object.keys(result.winPct).length || Object.keys(result.winPctTeam).some(k => !(k in result.winPct));
  const leader = hasTeams && teamWinner
    ? (teamWinner[1] >= 60 ? `Team ${teamWinner[0]} leads in ${teamWinner[1].toFixed(0)}% of worlds (per-capita: ${Object.entries(result.winPctPerCapita).sort(([,a],[,b])=>b-a)[0]?.[0]} ${Object.entries(result.winPctPerCapita).sort(([,a],[,b])=>b-a)[0]?.[1].toFixed(0)}%).` : "No team has a robust lead.")
    : (playerWinner?.[1] !== undefined && playerWinner[1] >= 60 ? `${playerWinner[0]} leads in ${playerWinner[1].toFixed(0)}% of worlds.` : "No side has a robust lead.");
  const pivot = result.sensitivity[0];
  return `${leader} Cooperation averages ${(result.cooperation.mean * 100).toFixed(0)}% (± ${(result.cooperation.std * 100).toFixed(0)}%). Most worth verifying: ${pivot?.input ?? "n/a"}.`;
}
