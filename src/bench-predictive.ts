import { accuracy, balancedAccuracy, macroF1, confusionTransitions, predictiveReport } from "./predictive.js";
import type { Move } from "./domain.js";

function fmt(n:number){ return (n*100).toFixed(1)+"%"; }
function line(name:string, r:ReturnType<typeof predictiveReport>){
  console.log(`${name}: acc ${fmt(r.accuracy)} | balAcc ${fmt(r.balancedAccuracy)} | macroF1 ${fmt(r.macroF1)} | F1_C ${fmt(r.f1C)} F1_D ${fmt(r.f1D)} | retention ${fmt(r.retentionAcc)} (n=${r.retention_n}) | transition ${fmt(r.transitionAcc)} (n=${r.transition_n}) | C→D ${fmt(r.c2d)} (n=${r.c2d_n}) D→C ${fmt(r.d2c)} (n=${r.d2c_n})`);
}

console.log("=== Predictive benches: Accuracy vs F1 + retention vs transition ===\n");

const TIES_actual: Move[] = Array(248).fill("D").concat(Array(110).fill("C")) as Move[];
const TIES_prev: Move[] = ["C", ...TIES_actual.slice(0,-1)] as Move[];
const predAllD: Move[] = Array(358).fill("D") as Move[];
const predTFT: Move[] = TIES_prev.slice() as Move[];
console.log("-- China-TIES-like 358 dyad-years (69.3% D) --");
line("ALL-D baseline ", predictiveReport(predAllD, TIES_actual, TIES_prev));
line("TFT (prev=pred)", predictiveReport(predTFT, TIES_actual, TIES_prev));
console.log("  → ALL-D: высокая accuracy (69%) за счёт D→D инерции, но balAcc=50% F1_C=0% macroF1=40% — ловит дисбаланс.");
console.log("  → TFT (prev): retention 100% но transition 0% — именно раскол retention vs transition показывает, что общая accuracy завышена инерцией.\n");

const n=200;
const actual2: Move[]=[], prev2: Move[]=[], predTFT2: Move[]=[], predAllC: Move[]=[];
let cur:Move="C";
for(let i=0;i<n;i++){
  const pv:Move=cur;
  cur = Math.random()<0.9 ? pv : (pv==="C"?"D":"C");
  actual2.push(cur); prev2.push(pv);
  predTFT2.push(pv); predAllC.push("C");
}
console.log("-- Transition bench: 90% inertia Markov 200 steps (inertia vs phase-shift) --");
line("ALL-C (hold)", predictiveReport(predAllC, actual2, prev2));
line("TFT (copy prev)", predictiveReport(predTFT2, actual2, prev2));
console.log("  → Общая accuracy завышена инерцией (90% retention); transitionAcc раскрывает реальную цену — оба предиктора валятся на смене фазы.\n");

const pred:Move[]=["C","D","C","C","D","D"], act:Move[]=["C","C","D","D","D","C"], prev:Move[]=["C","C","C","D","D","D"];
console.log("-- Sanity: retention vs transition split --");
const tr=confusionTransitions(pred, act, prev);
console.log(`c2c ${fmt(tr.c2c)} n=${tr.c2c_n} | d2d ${fmt(tr.d2d)} n=${tr.d2d_n} | c2d ${fmt(tr.c2d)} n=${tr.c2d_n} | d2c ${fmt(tr.d2c)} n=${tr.d2c_n} | retention ${fmt(tr.retentionAcc)} n=${tr.retention_n} | transition ${fmt(tr.transitionAcc)} n=${tr.transition_n}`);

console.log("\nbench-predictive OK — используйте predictiveReport() в live-бенчах (COW/TIES/BTS) как: {accuracy, balancedAccuracy, macroF1, retentionAcc, transitionAcc} + n для CI.");
