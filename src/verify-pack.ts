import assert from "node:assert/strict";
import { isValidPayoff, normalizeShares } from "./domain.js";
import { accuracy, f1, ece, klDivergence, crossConditionSweep, payoffRatioSweep, balancedAccuracy, macroF1, confusionTransitions, predictiveReport } from "./predictive.js";
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

run("2.x Cross-condition: w↑ ⇒ coop↑ and I↑ ⇒ coop?", ()=>{
  const sweepW=crossConditionSweep();
  console.log("  sweep w", sweepW.map(s=>`${s.w}:${s.coop.toFixed(2)}`).join(" "));
  // w higher should generally give more cooperation for TFT-like pair
  assert.ok(sweepW.at(-1)!.coop >= sweepW[0]!.coop -0.1);
  const sweepI=payoffRatioSweep();
  console.log("  sweep I", sweepI.map(s=>`${s.I.toFixed(1)}:${s.coop.toFixed(2)}`).join(" "));
});

run("4.x Predictive metrics: Accuracy/F1/ECE/KL on synthetic", ()=>{
  const pred:("C"|"D")[]=["C","D","C","C"]; const actual:("C"|"D")[]=["C","C","C","D"];
  assert.ok(Math.abs(accuracy(pred,actual)-0.5)<1e-9);
  assert.ok(f1(pred,actual) > 0.4 && f1(pred,actual) < 0.7);
  const probs=[0.9,0.2,0.8,0.1];
  assert.ok(ece(probs,actual) < 0.5);
  const kl=klDivergence([1,2,3,2,1],[1,2,2,3,5]);
  assert.ok(Number.isFinite(kl));
});

run("4.y Weak spots — balanced accuracy, ECE, transitions vs Markov", ()=>{
  const pred:("C"|"D")[]=["C","C","C","D","D","D"], actual:("C"|"D")[]=["C","C","D","D","D","C"];
  assert.ok(Math.abs(balancedAccuracy(pred,actual)-0.5)<0.2);
  assert.ok(macroF1(pred,actual) > 0.3 && macroF1(pred,actual) < 0.8);
  assert.ok(ece([0.9,0.8,0.6,0.2,0.1,0.4], actual) < 0.6);
  const trans=confusionTransitions(["D","C"],["D","C"], ["C","D"]);
  assert.ok(trans.c2d_n===1 && trans.d2c_n===1 && trans.c2d===1 && trans.d2c===1);
  const tr2=confusionTransitions(["C","C","D","D"],["C","D","D","C"], ["C","C","D","D"]);
  assert.ok(tr2.c2c_n===1 && tr2.d2d_n===1 && tr2.retention_n===2 && tr2.transition_n===2);
  assert.ok(Math.abs(tr2.retentionAcc-1)<0.01 && Math.abs(tr2.transitionAcc-0)<0.01);
  const mkPred:("C"|"D")[]=["C","D","C"], mkActual:("C"|"D")[]=["C","C","C"];
  assert.ok(Math.abs(accuracy(mkPred,mkActual)-0.66)<0.02);
});

run("4.z PredictiveReport + imbalanced + retention vs transition (friend proposal)", ()=>{
  const actualTies:("C"|"D")[]=[...Array(248).fill("D"), ...Array(110).fill("C")] as ("C"|"D")[];
  const prevTies:("C"|"D")[]=["C", ...actualTies.slice(0,-1)] as ("C"|"D")[];
  const predAllD:("C"|"D")[]=Array(358).fill("D") as ("C"|"D")[];
  const rAllD=predictiveReport(predAllD, actualTies, prevTies);
  assert.ok(Math.abs(rAllD.accuracy - 248/358) < 0.01, `ALL-D acc ${rAllD.accuracy}`);
  assert.ok(rAllD.balancedAccuracy < 0.6, `ALL-D balAcc should be ~50% got ${rAllD.balancedAccuracy}`);
  assert.ok(rAllD.macroF1 < 0.5, `ALL-D macroF1 should be low got ${rAllD.macroF1}`);
  assert.ok(rAllD.f1C < 0.01, `ALL-D F1_C ~0 got ${rAllD.f1C}`);
  const predTFT:("C"|"D")[]=prevTies.slice() as ("C"|"D")[];
  const rTFT=predictiveReport(predTFT, actualTies, prevTies);
  assert.ok(rTFT.macroF1 > rAllD.macroF1, `TFT macroF1 ${rTFT.macroF1} > ALL-D ${rAllD.macroF1}`);
  assert.ok(rTFT.accuracy > rAllD.accuracy);
  assert.ok(rTFT.retention_n + rTFT.transition_n === 358);
  assert.ok(rTFT.retentionAcc >= rTFT.transitionAcc, `retention ${rTFT.retentionAcc} should >= transition ${rTFT.transitionAcc} (inertia inflates acc)`);
  const simplePred:("C"|"D")[]=["C","D"], simpleAct:("C"|"D")[]=["C","D"], simplePrev:("C"|"D")[]=["C","C"];
  const rSimple=predictiveReport(simplePred, simpleAct, simplePrev);
  assert.equal(rSimple.c2c_n,1); assert.equal(rSimple.c2d_n,1);
});

console.log("verify-pack OK");
