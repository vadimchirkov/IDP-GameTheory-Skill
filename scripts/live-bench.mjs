import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const req=createRequire(import.meta.url);
// This script reproduces the live-data benches used in README Benchmarks
// Run: node scripts/live-bench.mjs
// Requires: /tmp/human-data/dilemmaRL/data/all_data.csv and /tmp/dyadic/dyadic_mid_4.03_update/dyadic_mid_4.03.csv and /tmp/China-TIES/CESv1Sender_2025c.csv
// For CI without data, it will skip and report synthetic only.

async function humanBench(){
  try{
    const text=await readFile("/tmp/human-data/dilemmaRL/data/all_data.csv","utf8");
    const lines=text.trim().split("\n"); const h=lines[0].split(",").map(s=>s.replace(/"/g,"").trim());
    const iMy=h.indexOf("my.decision"), iMy1=h.indexOf("my.decision1"), iOpp1=h.indexOf("other.decision1");
    let y=[], correctTFT=0, total=0;
    for(let i=1;i<lines.length;i++){
      const c=lines[i].split(",").map(s=>s.replace(/"/g,"").trim());
      const cur=c[iMy]; if(cur!=="coop"&&cur!=="defect") continue;
      const per=Number(c[h.indexOf("period")]||0); if(per<=3) continue;
      const pred=c[iOpp1] ?? "NA"; // TFT predicts opp last
      const actual=cur;
      total++; if(pred===actual || (pred==="NA"&&actual==="coop")) correctTFT++;
      y.push(actual==="coop"?1:0);
    }
    const baseD=y.filter(v=>v===0).length / y.length;
    console.log(`[human] dilemmaRL ${y.length} moves base ALL D ${(baseD*100).toFixed(1)}% TFT ~${(correctTFT/total*100).toFixed(1)}%`);
  }catch(e){ console.log("[human] skip — no data, run synthetic only"); }
}
async function midBench(){
  try{
    const text=await readFile("/tmp/dyadic/dyadic_mid_4.03_update/dyadic_mid_4.03.csv","utf8");
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
    const text=await readFile("/tmp/China-TIES/CESv1Sender_2025c.csv","utf8");
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
await humanBench(); await midBench(); await sanctionsBench();
console.log("live-bench done — same pipeline as src/predictive.ts K=3");
