import assert from "node:assert/strict";
import { isValidPayoff, normalizeShares } from "./domain.js";
import { playMatch, strategies, tournament, stepGeneration } from "./kernel.js";
import { Rng } from "./rng.js";

const P={T:5,R:3,P:1,S:0};

function run(name:string, fn:()=>void){ try{ fn(); console.log(`✔ ${name}`);}catch(e){ console.error(`✘ ${name}`); throw e; } }

run("1.1 Tournament benchmarks: TFT vs ALLD vs ALLC vs Grim vs Random vs TF2T", ()=>{
  const t1=playMatch(strategies.provocable, strategies.alld, P,P,50,0,new Rng(1));
  assert.ok(t1.scoreA < t1.scoreB, "TFT loses to ALLD");
  const t2=playMatch(strategies.trusting, strategies.alld, P,P,50,0,new Rng(1));
  assert.equal(t2.scoreA, 0); assert.equal(t2.scoreB, 250);
  const t3=playMatch(strategies.trusting, strategies.trusting, P,P,50,0,new Rng(1));
  assert.equal(t3.scoreA, 150);
  const t4=playMatch(strategies.grim, strategies.alld, P,P,50,0,new Rng(1));
  assert.ok(t4.scoreA < t2.scoreB);
  const t5=playMatch(strategies.tf2t, strategies.alld, P,P,20,0,new Rng(1));
  assert.ok(t5.cooperation > 0 && t5.cooperation < 0.2);
  const t6=playMatch(strategies.erratic, strategies.erratic, P,P,100,0,new Rng(1));
  assert.ok(t6.cooperation > 0.3 && t6.cooperation < 0.7);
  const sum = tournament({ game:"prisoners_dilemma", payoff:P, rounds:20, matchReps:5, noise:0, initialShares: normalizeShares({ provocable:1/6, alld:1/6, allc:1/6, grim:1/6, erratic:1/6, tf2t:1/6 }), generations:1, rule:"replicator", populationSize:100, stepDelayMs:0 },0,1);
  assert.ok(Object.values(sum.fitness).every(v=>Number.isFinite(v)));
  assert.ok(sum.cooperation > 0.2 && sum.cooperation < 0.9);
});

run("2.1 Replicator ESS: TFT population resists 1% ALLD invasion at low noise", ()=>{
  let shares = normalizeShares({ provocable:0.99, alld:0.01 });
  for(let g=0; g<20; g++) shares = stepGeneration({ game:"prisoners_dilemma", payoff:P, rounds:20, matchReps:5, noise:0, initialShares:shares, generations:20, rule:"replicator", populationSize:100, stepDelayMs:0 }, shares, g, g+100).shares;
  assert.ok(shares.provocable > 0.5, `TFT should resist, got ${JSON.stringify(shares)}`);
});

run("2.2 Replicator cycles: alld+allc+tft should not crash", ()=>{
  let s = normalizeShares({ alld:0.33, allc:0.33, provocable:0.34 });
  for(let g=0; g<10; g++) s = stepGeneration({ game:"prisoners_dilemma", payoff:P, rounds:20, matchReps:2, noise:0, initialShares:s, generations:10, rule:"replicator", populationSize:100, stepDelayMs:0 }, s, g, g+200).shares;
  assert.ok(Object.values(s).every(v=>v>=0));
});

run("3.1 Noise spiral: TFT vs TFT with noise 5% collapses, GTFT recovers", ()=>{
  const tftNoise = playMatch(strategies.provocable, strategies.provocable, P,P,100,0.05,new Rng(10));
  assert.ok(tftNoise.cooperation < 0.7, `TFT spiral ${tftNoise.cooperation}`);
  const gtftNoise = playMatch(strategies.forgiving, strategies.forgiving, P,P,100,0.05,new Rng(10));
  assert.ok(gtftNoise.cooperation > tftNoise.cooperation, `GTFT ${gtftNoise.cooperation} > TFT ${tftNoise.cooperation}`);
  const pavlovNoise = playMatch(strategies.pavlov, strategies.pavlov, P,P,100,0.05,new Rng(10));
  assert.ok(pavlovNoise.cooperation > 0.3);
});

run("3.2 Pavlov WSLS forgives", ()=>{
  const p = playMatch(strategies.pavlov, strategies.alld, P,P,50,0,new Rng(1));
  assert.ok(p.cooperation < 0.3);
  const p2 = playMatch(strategies.pavlov, strategies.trusting, P,P,50,0,new Rng(1));
  assert.ok(p2.cooperation > 0.8);
});

run("4.1 Payoff baseline: T>R>P>S and 2R>T+S", ()=>{
  assert.ok(isValidPayoff("prisoners_dilemma", {T:5,R:3,P:1,S:0}));
  assert.ok(!isValidPayoff("prisoners_dilemma", {T:10,R:3,P:1,S:0}));
  assert.ok(!isValidPayoff("prisoners_dilemma", {T:5,R:3,P:2,S:1}));
  assert.ok(isValidPayoff("chicken", {T:5,R:3,S:2,P:0}));
  assert.ok(isValidPayoff("stag_hunt", {T:3,R:5,P:1,S:0}));
});

run("4.2 High temptation shifts to defect", ()=>{
  const highT={T:10,R:3,P:1,S:0};
  const lowT=P;
  const mHigh = playMatch(strategies.provocable, strategies.alld, highT,highT,20,0,new Rng(1));
  const mLow = playMatch(strategies.provocable, strategies.alld, lowT,lowT,20,0,new Rng(1));
  assert.ok(mHigh.scoreB > mLow.scoreB);
});

run("5.1 Known vs probabilistic horizon", ()=>{
  const fixed = playMatch(strategies.provocable, strategies.provocable, P,P,100,0,new Rng(1));
  assert.equal(fixed.cooperation, 1);
  const prob = playMatch(strategies.provocable, strategies.provocable, P,P,5,0,new Rng(1));
  assert.ok(prob.cooperation===1);
});

run("5.2 ZD extortion vs generous", ()=>{
  const ext = playMatch(strategies.zd_extort, strategies.trusting, P,P,50,0,new Rng(1));
  const gen = playMatch(strategies.zd_generous, strategies.trusting, P,P,50,0,new Rng(1));
  assert.ok(gen.cooperation >= 0.8);
  assert.ok(Number.isFinite(ext.scoreA));
});

console.log("verify-pack OK");
