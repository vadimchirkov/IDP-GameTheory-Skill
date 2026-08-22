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
export function balancedAccuracy(pred: Move[], actual: Move[]): number {
  let tp=0,tn=0,fp=0,fn=0;
  for(let i=0;i<pred.length;i++){ const p=pred[i],a=actual[i]; if(p==="C"&&a==="C")tp++; else if(p==="D"&&a==="D")tn++; else if(p==="C"&&a==="D")fp++; else fn++; }
  const sens=tp/(tp+fn||1), spec=tn/(tn+fp||1); return (sens+spec)/2;
}
export function macroF1(pred: Move[], actual: Move[]): number {
  const f1c=(()=>{let tp=0,fp=0,fn=0; for(let i=0;i<pred.length;i++){ if(pred[i]==="C"&&actual[i]==="C")tp++; else if(pred[i]==="C"&&actual[i]!=="C")fp++; else if(pred[i]!=="C"&&actual[i]==="C")fn++; } const p=tp/(tp+fp||1), r=tp/(tp+fn||1); return p+r===0?0:2*p*r/(p+r);})();
  const f1d=(()=>{let tp=0,fp=0,fn=0; for(let i=0;i<pred.length;i++){ if(pred[i]==="D"&&actual[i]==="D")tp++; else if(pred[i]==="D"&&actual[i]!=="D")fp++; else if(pred[i]!=="D"&&actual[i]==="D")fn++; } const p=tp/(tp+fp||1), r=tp/(tp+fn||1); return p+r===0?0:2*p*r/(p+r);})();
  return (f1c+f1d)/2;
}
export function confusionTransitions(pred: Move[], actual: Move[], prevActual: Move[]): {
  c2d:number; d2c:number; c2d_n:number; d2c_n:number;
  c2c:number; d2d:number; c2c_n:number; d2d_n:number;
  retentionAcc:number; retention_n:number;
  transitionAcc:number; transition_n:number;
} {
  let c2d=0,c2d_n=0,d2c=0,d2c_n=0,c2c=0,c2c_n=0,d2d=0,d2d_n=0;
  for(let i=0;i<pred.length;i++){
    const prev=prevActual[i]??"C"; const cur=actual[i]; const pr=pred[i];
    if(prev==="C"&&cur==="D"){ c2d_n++; if(pr==="D")c2d++; }
    else if(prev==="D"&&cur==="C"){ d2c_n++; if(pr==="C")d2c++; }
    else if(prev==="C"&&cur==="C"){ c2c_n++; if(pr==="C")c2c++; }
    else if(prev==="D"&&cur==="D"){ d2d_n++; if(pr==="D")d2d++; }
  }
  const retentionHits=c2c+d2d, retention_n=c2c_n+d2d_n;
  const transitionHits=c2d+d2c, transition_n=c2d_n+d2c_n;
  return {
    c2d: c2d_n?c2d/c2d_n:0, d2c: d2c_n?d2c/d2c_n:0, c2d_n, d2c_n,
    c2c: c2c_n?c2c/c2c_n:0, d2d: d2d_n?d2d/d2d_n:0, c2c_n, d2d_n,
    retentionAcc: retention_n?retentionHits/retention_n:0, retention_n,
    transitionAcc: transition_n?transitionHits/transition_n:0, transition_n,
  };
}

export function predictiveReport(pred: Move[], actual: Move[], prevActual: Move[], probs?: number[]) {
  const trans=confusionTransitions(pred, actual, prevActual);
  let f1C=0,f1D=0;
  { let tp=0,fp=0,fn=0; for(let i=0;i<pred.length;i++){ if(pred[i]==="C"&&actual[i]==="C")tp++; else if(pred[i]==="C"&&actual[i]!=="C")fp++; else if(pred[i]!=="C"&&actual[i]==="C")fn++; } const p=tp/(tp+fp||1), r=tp/(tp+fn||1); f1C=p+r===0?0:2*p*r/(p+r); }
  { let tp=0,fp=0,fn=0; for(let i=0;i<pred.length;i++){ if(pred[i]==="D"&&actual[i]==="D")tp++; else if(pred[i]==="D"&&actual[i]!=="D")fp++; else if(pred[i]!=="D"&&actual[i]==="D")fn++; } const p=tp/(tp+fp||1), r=tp/(tp+fn||1); f1D=p+r===0?0:2*p*r/(p+r); }
  return {
    accuracy: accuracy(pred, actual),
    balancedAccuracy: balancedAccuracy(pred, actual),
    macroF1: macroF1(pred, actual),
    f1C, f1D,
    retentionAcc: trans.retentionAcc, retention_n: trans.retention_n,
    transitionAcc: trans.transitionAcc, transition_n: trans.transition_n,
    c2c: trans.c2c, c2c_n: trans.c2c_n, d2d: trans.d2d, d2d_n: trans.d2d_n,
    c2d: trans.c2d, c2d_n: trans.c2d_n, d2c: trans.d2c, d2c_n: trans.d2c_n,
    ece: probs ? ece(probs, actual) : undefined,
  };
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
