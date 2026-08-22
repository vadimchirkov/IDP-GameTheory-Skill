import { normalizeShares, type ScenarioModel } from "./domain.js";
import { stepGeneration, type Generation } from "./kernel.js";
import type { RunConfig } from "./domain.js";
import { Rng } from "./rng.js";

export function runEvolution(model: ScenarioModel, generations=500, seed=42): { trajectory: Generation[]; fixation: Record<string, number> } {
  const game = model.game ?? "prisoners_dilemma";
  const payoff = { T:4, R:3, P:1, S:0 };
  const allIds = [...new Set(model.players.flatMap(p=>p.dispositions))];
  const init: Record<string,number> = {}; for(const id of allIds) init[id as any]=1/allIds.length;
  const config: RunConfig = { game: game as any, payoff, rounds:50, matchReps:5, noise:0.02, initialShares: normalizeShares(init as any), generations, rule:"replicator", populationSize:100, stepDelayMs:0 };
  let shares = normalizeShares(init as any);
  const traj: Generation[] = [];
  for(let g=0;g<generations;g++){ const gen=stepGeneration(config, shares, g, seed+g); traj.push(gen); shares=gen.shares; }
  const fixation: Record<string,number> = {}; for(const id of allIds) fixation[id]= (shares as any)[id] ?? 0;
  return { trajectory: traj, fixation };
}

export function estimateFixation(mutant:string, resident:string, trials=200, N=50): number {
  let wins=0;
  for(let t=0;t<trials;t++){
    const rng=new Rng(t*997);
    let m=1, r=N-1;
    for(let s=0;s<1000 && m>0 && m<N; s++){
      const fm = rng.unit()>0.5? m+1 : m-1;
      if(fm<0||fm>N) continue;
      m = Math.max(0, Math.min(N, fm));
    }
    if(m===N) wins++;
  }
  return wins/trials;
}
