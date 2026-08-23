import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const req=createRequire(import.meta.url);
// This script reproduces the live-data benches used in README Benchmarks
// Run: node scripts/live-bench.mjs   or   npx tsx src/bench-engine.ts
// Data lives in data/raw/* (fallback /tmp/... for legacy CI). For CI without data, it skips and reports synthetic only.
// NOTE: This file measures STRATEGY move-level accuracy (TFT as predictor of next move, K=3 prev->actual).
// It does NOT measure engine scenario predictiveness — see src/bench-engine.ts for that (Brier/ECE/MAE on holdout).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
async function readWithFallback(candidates){
  for(const p of candidates){
    try{ return await readFile(p,"utf8"); }catch{}
  }
  throw new Error("no data");
}

async function humanBench(){
  try{
    const text=await readWithFallback([path.join(ROOT,"data/raw/dilemmaRL_all_data.csv"), "/tmp/human-data/dilemmaRL/data/all_data.csv", "/tmp/dilemmaRL_all.csv"]);
    const lines=text.trim().split("\n"); const h=lines[0].split(",").map(s=>s.replace(/"/g,"").trim());
    const iMy=h.indexOf("my.decision"), iOpp1=h.indexOf("other.decision1");
    let y=[], correctTFT=0, total=0;
    for(let i=1;i<lines.length;i++){
      const c=lines[i].split(",").map(s=>s.replace(/"/g,"").trim());
      const cur=c[iMy]; if(cur!=="coop"&&cur!=="defect") continue;
      const per=Number(c[h.indexOf("period")]||0); if(per<=3) continue;
      const raw=c[iOpp1] ?? "NA";
      const pred = raw==="1" ? "coop" : raw==="0" ? "defect" : "NA";
      const actual=cur;
      total++; if(pred===actual || (pred==="NA"&&actual==="coop")) correctTFT++;
      y.push(actual==="coop"?1:0);
    }
    const baseD=y.filter(v=>v===0).length / y.length;
    const baseC=1-baseD;
    console.log(`[human] dilemmaRL ${y.length} moves base ALL D ${(baseD*100).toFixed(1)}% ALL C ${(baseC*100).toFixed(1)}% TFT ${(correctTFT/total*100).toFixed(1)}%`);
  }catch(e){ console.log("[human] skip — no data, run synthetic only"); }
}
async function midBench(){
  try{
    const text=await readWithFallback([path.join(ROOT,"data/raw/dyadic_mid_4.03.csv"), "/tmp/dyadic/dyadic_mid_4.03_update/dyadic_mid_4.03.csv", "/tmp/dyadic_mid/dyadic_mid_4.03_update/dyadic_mid_4.03.csv"]);
    const lines=text.trim().split("\n"); const h=lines[0].split(",");
    const iA=h.indexOf("statea"), iB=h.indexOf("stateb"), iY=h.indexOf("year");
    const m=new Map();
    for(let i=1;i<lines.length;i++){ const c=lines[i].split(","); const a=c[iA], b=c[iB], y=Number(c[iY]); if(!a||!b||!y) continue; const k=[a,b].sort().join("-"); if(!m.has(k)) m.set(k,new Set()); m.get(k).add(y); }
    let total=0, allC=0, tft=0;
    for(const s of m.values()){
      const ys=[...s].sort((a,b)=>a-b); const min=Math.min(...ys), max=Math.max(...ys);
      const seq=[]; for(let y=min;y<=max;y++) seq.push(s.has(y)?"D":"C");
      for(let t=1;t<seq.length;t++){ const a=seq[t], p=seq[t-1]??"C"; total++; if(a==="C") allC++; if(a===p) tft++; }
    }
    console.log(`[states disputes] MID ${m.size} dyads ${total} years ALL C ${(allC/total*100).toFixed(1)}% TFT ${(tft/total*100).toFixed(1)}%`);
  }catch(e){ console.log("[states disputes] skip — no MID data"); }
}
async function sanctionsBench(){
  try{
    const text=await readWithFallback([path.join(ROOT,"data/raw/CESv1Sender_2025c.csv"), "/tmp/China-TIES/CESv1Sender_2025c.csv"]);
    const lines=text.trim().split("\n"); const h=lines[0].split(",");
    const iS=h.indexOf("sender1"), iT=h.indexOf("state2"), iSt=h.indexOf("startyear"), iEn=h.indexOf("endyear");
    const m=new Map();
    for(let i=1;i<lines.length;i++){ const c=lines[i].split(","); const a=c[iS], b=c[iT], s=Number(c[iSt]), e=Number(c[iEn]||c[iSt]); if(!a||!b||!s) continue; const k=[a,b].sort().join("-"); if(!m.has(k)) m.set(k,new Set()); for(let y=s;y<=e;y++) m.get(k).add(y); }
    let total=0, allC=0, tft=0;
    for(const s of m.values()){
      const ys=[...s].sort((a,b)=>a-b); const min=Math.min(...ys), max=Math.max(...ys);
      const seq=[]; for(let y=min;y<=max;y++) seq.push(s.has(y)?"D":"C");
      for(let t=1;t<seq.length;t++){ const a=seq[t], p=seq[t-1]??"C"; total++; if(a==="C") allC++; if(a===p) tft++; }
    }
    console.log(`[states sanctions] China-TIES ${m.size} dyads ${total} years ALL C ${(allC/total*100).toFixed(1)}% TFT ${(tft/total*100).toFixed(1)}%`);
  }catch(e){ console.log("[states sanctions] skip — no data"); }
}
async function df2011Bench(){
  try{
    const text=await readWithFallback([path.join(ROOT,"data/raw/DF2011.csv")]);
    const lines=text.trim().split("\n"); const h=lines[0].split(",");
    const iTreat=h.indexOf("treatment"), iId=h.indexOf("id"), iGame=h.indexOf("game"), iPeriod=h.indexOf("period"), iChoice=h.indexOf("choice"), iOther=h.indexOf("other.choice");
    const byKey=new Map();
    for(let i=1;i<lines.length;i++){ const c=lines[i].split(","); const id=c[iId], game=c[iGame], period=Number(c[iPeriod]); if(!id||!game||!period) continue; const k=id+"|"+game; if(!byKey.has(k)) byKey.set(k,[]); byKey.get(k).push({period, choice:c[iChoice], other:c[iOther]}); }
    let total=0, allC=0, tft=0, pred=[], actual=[], prev=[];
    for(const arr of byKey.values()){
      arr.sort((a,b)=>a.period-b.period);
      for(let t=1;t<arr.length;t++){ const a=arr[t].choice, p=arr[t-1].other; if(a!=="c"&&a!=="d") continue; total++; if(a==="c") allC++; if(a===p) tft++; pred.push(p); actual.push(a); prev.push(arr[t-1].choice); }
    }
    const acc=tft/total, baseC=allC/total;
    // balAcc approx
    let tp=0,tn=0,fp=0,fn=0; for(let i=0;i<pred.length;i++){ const pr=pred[i], ac=actual[i]; if(pr==="c"&&ac==="c") tp++; else if(pr==="d"&&ac==="d") tn++; else if(pr==="c"&&ac==="d") fp++; else fn++; }
    const bal=(tp/(tp+fn||1)+tn/(tn+fp||1))/2;
    console.log(`[lab] Dal Bó DF2011 ${pred.length} pairs ALL C ${(baseC*100).toFixed(1)}% ALL D ${((1-baseC)*100).toFixed(1)}% TFT ${(acc*100).toFixed(1)}% balAcc ${(bal*100).toFixed(1)}%`);
  }catch(e){ console.log("[lab] DF2011 skip — no data"); }
}
async function tiesFullBench(){
  try{
    // TIESv4.xls requires parsing as binary — use python fallback if available, else skip
    const { spawn } = await import("node:child_process");
    const py=`import pandas as pd
from collections import defaultdict
try:
 df=pd.read_excel('${ROOT.replace(/'/g,"\\'")}/data/raw/TIESv4.xls')
except: df=pd.read_excel('/tmp/TIESv4.xls')
from collections import defaultdict
import math
m=defaultdict(set)
def to_int(x):
 try:
  import pandas as pd
  if pd.isna(x): return None
  return int(float(x))
 except: return None
for _,r in df.iterrows():
 s=to_int(r['startyear']); e=to_int(r['endyear']); a=to_int(r['sender1']); b=to_int(r['targetstate'])
 if s is None or a is None or b is None: continue
 if e is None: e=s
 k=tuple(sorted([a,b]))
 for y in range(s,e+1): m[k].add(y)
total=0; allC=0; tft=0
for s in m.values():
 ys=sorted(s); mn=min(ys); mx=max(ys)
 seq=['D' if y in s else 'C' for y in range(mn,mx+1)]
 for t in range(1,len(seq)):
  total+=1
  if seq[t]=='C': allC+=1
  if seq[t]==seq[t-1]: tft+=1
print(f\"[states sanctions full] TIES 4.0 {len(m)} dyads {total} years ALL C {allC/total*100:.1f}% TFT {tft/total*100:.1f}%\")
`;
    await new Promise((res,rej)=>{ const p=spawn("python3",["-c",py],{stdio:"inherit"}); p.on("exit",res); p.on("error",rej); });
  }catch(e){ console.log("[states sanctions full] TIES 4.0 skip — no data"); }
}
console.log("\n--- Part A: STRATEGY move-level accuracy (TFT = prev move, K=3) — sanity check, not engine ---\n");
await humanBench(); await df2011Bench(); await midBench(); await sanctionsBench(); await tiesFullBench();
console.log("\n[strategy bench done] TFT accuracy above = how well inertia predicts next year/period.");
console.log("For ENGINE calibration (winPct/cooperation as probabilistic forecast, Brier/ECE/MAE) run: npx tsx src/bench-engine.ts");
