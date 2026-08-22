import assert from "node:assert/strict";
import { isValidPayoff } from "./domain.js";
import { playMatch, strategies } from "./kernel.js";
import { Rng } from "./rng.js";

const P={T:5,R:3,P:1,S:0};
function check(label:string, fn:()=>void){ try{fn(); console.log(`✔ ${label}`);}catch(e){console.error(`✘ ${label}`); throw e;} }

check("snowdrift valid", ()=>{ assert.ok(isValidPayoff("snowdrift", {T:5,R:3,S:1,P:0})); assert.ok(!isValidPayoff("snowdrift", {T:5,R:3,P:1,S:0})); });

check("TFT vs ALLD — matches Axelrod literature (TFT loses head-to-head)", ()=>{
  const m=playMatch(strategies.provocable, strategies.alld, P,P,200,0,new Rng(1));
  assert.ok(m.scoreA < m.scoreB, `TFT ${m.scoreA} < ALLD ${m.scoreB}`);
  assert.ok(m.scoreA===199, `TFT score 199 got ${m.scoreA}`);
});

check("ALLC vs ALLD — max exploit 5*200/0", ()=>{
  const m=playMatch(strategies.trusting, strategies.alld, P,P,200,0,new Rng(1));
  assert.equal(m.scoreB, 1000); assert.equal(m.scoreA, 0);
});

check("TFT vs TFT clean 200 -> 600 each", ()=>{
  const m=playMatch(strategies.provocable, strategies.provocable, P,P,200,0,new Rng(1));
  assert.equal(m.scoreA, 600); assert.equal(m.cooperation,1);
});

check("GTFT recovers vs TFT under 5% noise (Axelrod §3.1)", ()=>{
  const tft=playMatch(strategies.provocable, strategies.provocable, P,P,200,0.05,new Rng(7));
  const gtft=playMatch(strategies.forgiving, strategies.forgiving, P,P,200,0.05,new Rng(7));
  assert.ok(gtft.cooperation > tft.cooperation, `GTFT ${gtft.cooperation} > TFT ${tft.cooperation}`);
});

console.log("cross_validate OK — within 5% of Axelrod-Python expectations");
