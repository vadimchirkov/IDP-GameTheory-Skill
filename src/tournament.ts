import type { ScenarioModel, StrategyId } from "./domain.js";
import { playMatch, strategies } from "./kernel.js";
import { strategyIds } from "./domain.js";
import { Rng } from "./rng.js";
import type { Payoff } from "./domain.js";

const P:Payoff={T:5,R:3,P:1,S:0};

export function runTournament(model: ScenarioModel, rounds=200){
  const zoo: StrategyId[] = [...new Set(model.players.flatMap(p=>p.dispositions))] as StrategyId[];
  const pool = zoo.length? zoo : [...strategyIds] as StrategyId[];
  const scores: Record<string,number> = Object.fromEntries(pool.map(id=>[id,0]));
  const coop: Record<string,number> = Object.fromEntries(pool.map(id=>[id,0]));
  let matches=0;
  for(let i=0;i<pool.length;i++) for(let j=i;j<pool.length;j++){
    const a=pool[i]!, b=pool[j]!;
    const sA=strategies[a], sB=strategies[b];
    if(!sA||!sB) continue;
    let sumA=0,sumB=0,sumC=0;
    for(let rep=0;rep<5;rep++){
      const r=playMatch(sA,sB,P,P,rounds,0,new Rng(rep*100+i*10+j));
      sumA+=r.scoreA; sumB+=r.scoreB; sumC+=r.cooperation;
    }
    if(a===b){ (scores as any)[a]+= (sumA+sumB)/2/5; (coop as any)[a]+=sumC/5; }
    else { (scores as any)[a]+=sumA/5; (scores as any)[b]+=sumB/5; (coop as any)[a]+=sumC/5; (coop as any)[b]+=sumC/5; }
    matches++;
  }
  const ranking=Object.entries(scores).sort(([,a],[,b])=>b-a).map(([id,sc])=>({id, score:sc, coop:coop[id]??0}));
  return { ranking, pool, rounds };
}
