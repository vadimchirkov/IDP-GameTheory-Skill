import { playMatch, strategies } from "./kernel.js";
import { Rng } from "./rng.js";
import type { Move, Payoff } from "./domain.js";

const P: Payoff = {T:5,R:3,P:1,S:0};

export function accuracy(pred: Move[], actual: Move[]): number {
  let ok=0; for(let i=0;i<pred.length;i++) if(pred[i]===actual[i]) ok++;
  return ok/Math.max(1,pred.length);
}
export function f1(pred: Move[], actual: Move[]): number {
  let tp=0, fp=0, fn=0;
  for(let i=0;i<pred.length;i++){
    if(pred[i]==="C" && actual[i]==="C") tp++;
    else if(pred[i]==="C" && actual[i]==="D") fp++;
    else if(pred[i]==="D" && actual[i]==="C") fn++;
  }
  const prec = tp/(tp+fp || 1), rec = tp/(tp+fn || 1);
  return prec+rec===0?0:2*prec*rec/(prec+rec);
}
export function ece(probs: number[], actual: Move[], bins=5): number {
  const b = Array.from({length:bins}, ()=>({sumConf:0,sumAcc:0,n:0}));
  for(let i=0;i<probs.length;i++){
    const p=probs[i] ?? 0.5; const idx=Math.min(bins-1, Math.floor(p*bins));
    const bucket=b[idx]!; bucket.sumConf+=p; bucket.n++; bucket.sumAcc+= actual[i]==="C"?1:0;
  }
  let err=0; const n=probs.length||1;
  for(const {sumConf,sumAcc,n:bn} of b) if(bn) err += bn/n * Math.abs(sumConf/bn - sumAcc/bn);
  return err;
}
export function klDivergence(histSim: number[], histReal: number[], bins=5): number {
  const toHist=(arr:number[])=>{
    const h=Array(bins).fill(0); for(const v of arr) h[Math.min(bins-1, Math.floor(v/bins))]++;
    const s=h.reduce((a,b)=>a+b,0)||1; return h.map(c=> (c||0.5)/ (s + bins*0.5));
  };
  const ps=toHist(histSim), pr=toHist(histReal);
  let kl=0; for(let i=0;i<bins;i++) kl+= pr[i]! * Math.log((pr[i]!)/(ps[i]!));
  return kl;
}

export function crossConditionSweep(): { w:number, coop:number }[] {
  const out: {w:number,coop:number}[]=[];
  for(const w of [0.5,0.6,0.7,0.8,0.9,0.99]){
    const rounds = Math.round(1/(1-Math.min(0.99,w))*3);
    const m=playMatch(strategies.provocable, strategies.forgiving, P,P, rounds, 0.05, new Rng(Math.round(w*1000)));
    out.push({w, coop:m.cooperation});
  }
  return out;
}
export function payoffRatioSweep(): { I:number, coop:number }[] {
  const out: {I:number,coop:number}[]=[];
  for(const I of [0.1,0.3,0.5,0.7,0.9]){
    const R=3+I*2, P=1, T=5, S=0;
    const pv:Payoff={T,R,P,S};
    const m=playMatch(strategies.provocable, strategies.provocable, pv,pv, 50,0, new Rng(Math.round(I*100)));
    out.push({I, coop:m.cooperation});
  }
  return out;
}
