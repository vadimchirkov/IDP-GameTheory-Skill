import assert from "node:assert/strict";
import { assertScenario, isValidPayoff, normalizeShares } from "./domain.js";
import { accuracy, f1, ece, klDivergence, crossConditionSweep, payoffRatioSweep, balancedAccuracy, macroF1, confusionTransitions, predictiveReport } from "./predictive.js";
import { playMatch, strategies, tournament, stepGeneration, zdVector, ZD_BASELINE, type EcoState, type TransitionState } from "./kernel.js";
import { Rng } from "./rng.js";
import { analyzeScenario } from "./analysis.js";
import { runEvolution } from "./evolution.js";
import { runTournament } from "./tournament.js";
import { generateHeatmap } from "./report.js";

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

run("5.2 ZD vectors are canonical (Press-Dyson 2012 / Stewart-Plotkin 2013)", ()=>{
  // Generous chi=2 at the largest valid phi must reproduce ZDGTFT-2 = (1, 1/8, 1, 1/4).
  const gen = zdVector(ZD_BASELINE, 2, "R");
  assert.deepEqual(gen.map(v=>Math.round(v*1000)/1000), [1, 0.125, 1, 0.25]);
  // Extortion always refuses to forgive mutual defection: p4 = 0.
  const ext = zdVector(ZD_BASELINE, 3, "P");
  assert.equal(ext[3], 0, `extortion p4 must be 0, got ${ext[3]}`);
  assert.ok(ext.every(v=> v>=0 && v<=1), `ZD vector out of [0,1]: ${ext}`);
});

run("5.3 ZD enforces s_self - k = chi*(s_opp - k) against ANY opponent", ()=>{
  const rounds=40_000;
  // The defining property: the linear relation holds whatever the opponent does.
  for(const opp of ["trusting","alld","erratic","provocable","pavlov"] as const){
    const chi=3;
    const m = playMatch(strategies.zd_extort, strategies[opp], P,P,rounds,0,new Rng(7));
    const sSelf=m.scoreA/rounds, sOpp=m.scoreB/rounds;
    const lhs=sSelf-P.P, rhs=chi*(sOpp-P.P);
    assert.ok(Math.abs(lhs-rhs) < 0.12, `extort vs ${opp}: s-P=${lhs.toFixed(3)} vs chi*(s'-P)=${rhs.toFixed(3)}`);
  }
  for(const opp of ["trusting","alld","erratic","provocable"] as const){
    const chi=2;
    const m = playMatch(strategies.zd_generous, strategies[opp], P,P,rounds,0,new Rng(7));
    const sSelf=m.scoreA/rounds, sOpp=m.scoreB/rounds;
    const lhs=sSelf-P.R, rhs=chi*(sOpp-P.R);
    assert.ok(Math.abs(lhs-rhs) < 0.12, `generous vs ${opp}: s-R=${lhs.toFixed(3)} vs chi*(s'-R)=${rhs.toFixed(3)}`);
  }
});

run("5.4 Extortioner beats a pushover; generous never does", ()=>{
  const ext = playMatch(strategies.zd_extort, strategies.trusting, P,P,20_000,0,new Rng(3));
  assert.ok(ext.scoreA > ext.scoreB * 1.05, `extort must out-score ALLC, got ${ext.scoreA} vs ${ext.scoreB}`);
  const gen = playMatch(strategies.zd_generous, strategies.trusting, P,P,20_000,0,new Rng(3));
  assert.ok(gen.scoreA <= gen.scoreB, `generous must not out-score its opponent, got ${gen.scoreA} vs ${gen.scoreB}`);
  assert.ok(gen.cooperation >= 0.8, `generous should sustain cooperation with ALLC, got ${gen.cooperation}`);
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

run("4.z Snowdrift is an alias of Chicken (same T>R>S>P ordering)", ()=>{
  for(const p of [{T:5,R:3,S:1,P:0},{T:5,R:3,P:1,S:0},{T:3,R:5,P:1,S:0}]){
    assert.equal(isValidPayoff("snowdrift", p), isValidPayoff("chicken", p), `snowdrift/chicken disagree on ${JSON.stringify(p)}`);
  }
  const sd={T:5,R:3,S:1,P:0};
  const m=playMatch(strategies.provocable, strategies.alld, sd,sd,20,0,new Rng(1));
  assert.ok(Number.isFinite(m.scoreA) && Number.isFinite(m.scoreB));
});

run("4.zb Schema rejects silent typos and malformed memory tables", ()=>{
  const base={ situation:"s", players:[{name:"A", dispositions:["provocable"]},{name:"B", dispositions:["alld"]}], payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9],noise:[0,0]}};
  assert.doesNotThrow(()=> assertScenario(base as any));
  // A mistyped key used to be accepted in silence — the lean was simply never applied.
  const typo:any = structuredClone(base); typo.players[0].value=[-1,1];
  assert.throws(()=> assertScenario(typo), /Unknown field "value"/);
  const typo2:any = structuredClone(base); typo2.playerz=[];
  assert.throws(()=> assertScenario(typo2), /Unknown scenario field "playerz"/);
  const badProb:any = structuredClone(base); badProb.players[0].memory={CC:5,CD:0,DC:1,DD:0};
  assert.throws(()=> assertScenario(badProb), /probability/);
  const badKey:any = structuredClone(base); badKey.players[0].memory={garbage:0.5,CD:0,DC:1,DD:0};
  assert.throws(()=> assertScenario(badKey), /window of CC/);
  const incomplete:any = structuredClone(base); incomplete.players[0].memory={CC:1,CD:0};
  assert.throws(()=> assertScenario(incomplete), /must list all 4 windows/);
  const ok:any = structuredClone(base); ok.players[0].memory={CC:1,CD:0,DC:1,DD:0};
  assert.doesNotThrow(()=> assertScenario(ok));
});

run("4.zc Asymmetric payoff scales do not decide the winner", ()=>{
  // Same strategies, same game — one side's stakes merely denominated 100x larger.
  const model:any = { situation:"scale", players:[
    {name:"Big", dispositions:["provocable"]}, {name:"Small", dispositions:["provocable"]}],
    payoffs:{ Big:{T:[500,500],R:[300,300],P:[100,100],S:[0,0]}, Small:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]} },
    structure:{w:[0.9,0.9],noise:[0,0]} };
  const r=analyzeScenario(model, 60, 5);
  assert.ok(Math.abs(r.winPct.Big! - r.winPct.Small!) < 1e-6, `scale alone must not decide: ${JSON.stringify(r.winPct)}`);
  // And a genuinely better-playing side still wins under asymmetric scales.
  const exploit:any = structuredClone(model);
  exploit.players=[{name:"Big", dispositions:["exploitative"]},{name:"Small", dispositions:["trusting"]}];
  assert.equal(analyzeScenario(exploit, 30, 5).winPct.Big, 100);
});

run("4.zd Team behaviour survives a custom memory table", ()=>{
  const model:any = { situation:"team+memory", players:[
    {name:"A", team:"X", dispositions:["colluder"], memory:{CC:1,CD:1,DC:1,DD:1}},
    {name:"B", team:"X", dispositions:["colluder"]},
    {name:"Z", dispositions:["alld"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.95,0.95],noise:[0,0]}};
  // A colluder must still play TFT against the outsider, so ALL-D cannot farm it forever.
  const r=analyzeScenario(model, 40, 3);
  assert.ok(r.winPctTeam.X! > r.winPctTeam.Z!, `colluding team should beat lone ALL-D, got ${JSON.stringify(r.winPctTeam)}`);
});

run("4.za Dynamic coalitions fields", ()=>{
  assert.doesNotThrow(()=> normalizeShares({provocable:0.5, alld:0.5}));
  const m={ situation:"coalition betrayal", players:[{name:"A", dispositions:["colluder"], team:"c1", betrayalProb:0.05} as any, {name:"B", dispositions:["colluder"], team:"c1"} as any], payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9], noise:[0,0]}} as any;
  assert.doesNotThrow(()=> assertScenario(m as any));
  (m as any).players[0].betrayalProb=2; assert.throws(()=> assertScenario(m as any));
});

run("5.x memory2/shaper + evolve/tournament honour the model's own game", ()=>{
  const mm = playMatch(strategies.memory2, strategies.shaper, {T:5,R:3,P:1,S:0}, {T:5,R:3,P:1,S:0}, 20,0,new Rng(1));
  assert.ok(Number.isFinite(mm.scoreA));
  const stag={ situation:"stag", game:"stag_hunt", players:[{name:"A", dispositions:["provocable","alld"]},{name:"B", dispositions:["trusting"]}], payoffs:{T:[3,3],R:[5,5],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9], noise:[0.02,0.02]}} as any;
  const evo=runEvolution(stag, 5, 1);
  assert.equal(evo.trajectory.length,5);
  // Used to hardcode a PD table regardless of the model — R must now dominate T.
  assert.ok(evo.config.payoff.R > evo.config.payoff.T, `evolve must use the model's stag-hunt payoff, got ${JSON.stringify(evo.config.payoff)}`);
  assert.ok(Math.abs(evo.config.noise - 0.02) < 1e-9, `evolve must use the model's noise, got ${evo.config.noise}`);
  const tour=runTournament(stag, 20);
  assert.ok(tour.ranking.length>0);
  assert.ok(tour.payoff.R > tour.payoff.T, `tournament must use the model's payoff, got ${JSON.stringify(tour.payoff)}`);
  const html=generateHeatmap({ situation:"hm", players:[{name:"A", dispositions:["provocable"]},{name:"B", dispositions:["alld"]}], payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9], noise:[0,0]}} as any, 3, 1);
  assert.ok(html.includes("Plotly"));
});

run("5.y Sensitivity is signed and reported for winning as well as cooperation", ()=>{
  const model:any = { situation:"pivot", players:[
    {name:"Steady", dispositions:["provocable"]}, {name:"Shark", dispositions:["exploitative"]}],
    payoffs:{T:[4,7],R:[3,4],P:[1,2],S:[-1,1]}, structure:{w:[0.5,0.99], noise:[0,0.2]}};
  const r=analyzeScenario(model, 300, 11);
  assert.ok(r.sensitivity.length === r.sensitivityWin.length && r.sensitivity.length > 0);
  assert.ok(r.winPct[r.sensitivityWinTarget!] !== undefined, `win target ${r.sensitivityWinTarget} must be a real side`);
  // Sorted by magnitude, sign preserved (an all-positive list would mean abs() crept back in).
  for(let i=1;i<r.sensitivity.length;i++) assert.ok(Math.abs(r.sensitivity[i-1]!.correlation) >= Math.abs(r.sensitivity[i]!.correlation));
  assert.ok(r.sensitivity.some(s=> s.correlation < 0), "some input must correlate negatively with cooperation");
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

run("6.1 Eco feedback (Weitz): cooperation and environment chase each other", ()=>{
  const eco = (n:number): EcoState => ({ A1:{T:5,R:1,P:0,S:-1}, theta:2, epsilon:0.2, n });
  // Coupling direction: mutual C pushes n up (θc-(1-c)>0), mutual D pushes it down.
  const up = playMatch(strategies.trusting, strategies.trusting, P,P,100,0,new Rng(1),0,0,0, eco(0.5));
  const down = playMatch(strategies.alld, strategies.alld, P,P,100,0,new Rng(1),0,0,0, eco(0.5));
  assert.ok(up.envFinal! > 0.5 && down.envFinal! < 0.5, `coop→n up (${up.envFinal}), defect→n down (${down.envFinal})`);
  // Clamp holds under a violent ε/θ — n never escapes [0.01,0.99].
  const hot = playMatch(strategies.trusting, strategies.trusting, P,P,500,0,new Rng(1),0,0,0, { A1:P, theta:50, epsilon:0.9, n:0.5 });
  assert.ok(hot.envFinal! <= 0.99 && hot.envFinal! >= 0.01, `clamp escaped: ${hot.envFinal}`);
  // The tragedy: cooperators degrade the environment (n→1, A1 with R1=1<R0=3), lowering their OWN reward vs static.
  const stat = playMatch(strategies.trusting, strategies.trusting, P,P,100,0,new Rng(1));
  const trag = playMatch(strategies.trusting, strategies.trusting, P,P,100,0,new Rng(1),0,0,0, eco(0.5));
  assert.ok(trag.scoreA < stat.scoreA, `eco tragedy: eco ${trag.scoreA} should be < static ${stat.scoreA}`);
  assert.equal(stat.envFinal, undefined, "non-eco match must not report envFinal (bit-for-bit legacy path)");
});

run("6.2 Eco end-to-end + schema guards", ()=>{
  const model:any = { situation:"commons", players:[{name:"A",dispositions:["provocable"]},{name:"B",dispositions:["provocable"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]},
    structure:{w:[0.95,0.95], noise:[0,0], eco:{A1:{T:[3.5,3.5],R:[2,2],P:[1,1],S:[0,0]}, theta:[2,2], epsilon:[0.2,0.2], n0:[0.5,0.5]}}};
  const r=analyzeScenario(model, 40, 1);
  assert.ok(r.environment && r.environment.mean >= 0.01 && r.environment.mean <= 0.99, `environment reported: ${JSON.stringify(r.environment)}`);
  assert.ok(r.sensitivity.some(s=> s.input.startsWith("eco_")), "eco_* inputs must appear in sensitivity");
  // eco requires a shared A0 table.
  const perPlayer:any = structuredClone(model); perPlayer.payoffs = { A:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, B:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]} };
  assert.throws(()=> assertScenario(perPlayer), /shared payoff table/);
  const badField:any = structuredClone(model); badField.structure.eco.foo=1;
  assert.throws(()=> assertScenario(badField), /Unknown eco field/);
  const badN0:any = structuredClone(model); badN0.structure.eco.n0=[0,2];
  assert.throws(()=> assertScenario(badN0), /eco.n0/);
});

run("7.1 Game transitions (Su): cooperation holds the rich game, defection sinks to the poor one", ()=>{
  const rich = {T:5,R:4,P:1,S:0}, poor = {T:5,R:2,P:1,S:0};
  const trans = (): TransitionState => ({ states:{rich, poor}, cur:"rich", next:{CC:"rich", CD:"poor", DD:"poor"} });
  // Cooperators stay in "rich" the whole match; defectors get dragged to "poor" after round 1.
  const coop = playMatch(strategies.trusting, strategies.trusting, poor, poor, 100, 0, new Rng(1), 0,0,0, undefined, trans());
  const def = playMatch(strategies.alld, strategies.alld, poor, poor, 100, 0, new Rng(1), 0,0,0, undefined, trans());
  assert.ok(coop.stateOccupancy!.rich! > 0.99, `coop should hold rich, got ${coop.stateOccupancy!.rich}`);
  assert.ok(def.stateOccupancy!.poor! > 0.98, `defect should sink to poor, got ${def.stateOccupancy!.poor}`);
  // Occupancy is a distribution.
  assert.ok(Math.abs(def.stateOccupancy!.rich! + def.stateOccupancy!.poor! - 1) < 1e-9);
  // Su synergy in pairwise form: sustained cooperation unlocks the rich game (R=4) — more than being
  // locked in the poor game (R=2), and exactly as much as being handed the rich game outright.
  const lockedPoor = playMatch(strategies.trusting, strategies.trusting, poor, poor, 100, 0, new Rng(1));
  const lockedRich = playMatch(strategies.trusting, strategies.trusting, rich, rich, 100, 0, new Rng(1));
  assert.ok(coop.scoreA > lockedPoor.scoreA, `transitions must beat locked-poor: ${coop.scoreA} vs ${lockedPoor.scoreA}`);
  assert.equal(coop.scoreA, lockedRich.scoreA, `held-rich must equal locked-rich: ${coop.scoreA} vs ${lockedRich.scoreA}`);
  assert.equal(lockedPoor.stateOccupancy, undefined, "non-transition match must not report occupancy (legacy path)");
});

run("7.2 Transitions end-to-end + schema guards", ()=>{
  const model:any = { situation:"cartel", players:[{name:"A",dispositions:["provocable"]},{name:"B",dispositions:["provocable"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]},
    structure:{w:[0.95,0.95], noise:[0,0], transitions:{ states:{rich:{T:[5,5],R:[4,4],P:[1,1],S:[0,0]}, poor:{T:[3,3],R:[2,2],P:[1,1],S:[0,0]}}, start:"rich", next:{CC:"rich", CD:"poor", DD:"poor"} }}};
  const r=analyzeScenario(model, 40, 1);
  assert.ok(r.stateOccupancy && Math.abs((r.stateOccupancy.rich ?? 0) + (r.stateOccupancy.poor ?? 0) - 1) < 1e-9, `occupancy reported+normalised: ${JSON.stringify(r.stateOccupancy)}`);
  assert.ok(r.stateOccupancy!.rich! > 0.9, "TFT pair (all C) should keep it rich");
  const perPlayer:any = structuredClone(model); perPlayer.payoffs = { A:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, B:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]} };
  assert.throws(()=> assertScenario(perPlayer), /shared payoff table/);
  const badStart:any = structuredClone(model); badStart.structure.transitions.start="ghost";
  assert.throws(()=> assertScenario(badStart), /transitions.start "ghost"/);
  const badDest:any = structuredClone(model); badDest.structure.transitions.next.CC="ghost";
  assert.throws(()=> assertScenario(badDest), /is not a defined state/);
  const missing:any = structuredClone(model); delete missing.structure.transitions.next.DD;
  assert.throws(()=> assertScenario(missing), /missing outcome "DD"/);
  const both:any = structuredClone(model); both.structure.eco={A1:{T:[3,3],R:[2,2],P:[1,1],S:[0,0]}, theta:[2,2], epsilon:[0.2,0.2], n0:[0.5,0.5]};
  assert.throws(()=> assertScenario(both), /use one, not both/);
});

run("8.1 Voluntary loner (Szabó-Hauert): cyclic dominance L>D>C>L, never exploited", ()=>{
  const P2={T:5,R:3,P:1,S:0};
  const fit = (a:string,b:string) => { const s=normalizeShares({[a]:0.5,[b]:0.5} as any);
    const t=tournament({game:"prisoners_dilemma",payoff:P2,rounds:30,matchReps:5,noise:0,initialShares:s,generations:1,rule:"replicator",populationSize:100,stepDelayMs:0,sigma:2} as any,0,1);
    return { a:(t.fitness as any)[a] as number, b:(t.fitness as any)[b] as number }; };
  // With P < σ=2 < R: D beats C (exploitation), L beats D (opt-out avoids the P grind), C beats L (σ<R).
  const dc=fit("alld","trusting"); assert.ok(dc.a > dc.b, `D should beat C: ${dc.a} vs ${dc.b}`);
  const ld=fit("loner","alld");   assert.ok(ld.a > ld.b, `L should beat D: ${ld.a} vs ${ld.b}`);
  const cl=fit("trusting","loner");assert.ok(cl.a > cl.b, `C should beat L: ${cl.a} vs ${cl.b}`);
  // Opt-out floor: a loner vs an exploiter still gets σ*rounds (never the sucker's S), and both sides get it.
  const optOut = tournament({game:"prisoners_dilemma",payoff:P2,rounds:30,matchReps:5,noise:0,initialShares:normalizeShares({loner:0.5,exploitative:0.5} as any),generations:1,rule:"replicator",populationSize:100,stepDelayMs:0,sigma:2} as any,0,1);
  assert.ok((optOut.fitness as any).loner > 0, "loner collects σ, is never zeroed out by an exploiter");
  // A loner share with no σ configured must fail loud rather than silently score 0.
  assert.throws(()=> tournament({game:"prisoners_dilemma",payoff:P2,rounds:20,matchReps:2,noise:0,initialShares:normalizeShares({loner:0.5,alld:0.5} as any),generations:1,rule:"replicator",populationSize:100,stepDelayMs:0} as any,0,1), /sigma is not set/);
});

run("8.2 Loner as a scenario walk-away (BATNA) + schema guard", ()=>{
  // Pure opt-out on both sides: every match abstains to σ, so they tie and cooperation is undefined-safe.
  const optModel:any = { situation:"walk away", players:[{name:"A",dispositions:["loner"]},{name:"B",dispositions:["exploitative"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.95,0.95], noise:[0,0], sigma:[2,2]}};
  const r=analyzeScenario(optModel, 30, 1);
  assert.ok(Math.abs(r.winPct.A! - r.winPct.B!) < 1e-6, `both opt out to σ → tie: ${JSON.stringify(r.winPct)}`);
  assert.ok(r.sensitivity.some(s=> s.input === "sigma"), "sigma must appear as a sensitivity input");
  // Walk-away beats being suckered: a side that MAY opt out fares no worse against an exploiter than one that can't.
  const canWalk:any = { situation:"batna", players:[{name:"A",dispositions:["loner","trusting"]},{name:"B",dispositions:["exploitative"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.95,0.95], noise:[0,0], sigma:[2,2]}};
  const cannot:any = structuredClone(canWalk); cannot.players[0].dispositions=["trusting"]; delete cannot.structure.sigma;
  assert.ok(analyzeScenario(canWalk, 60, 2).winPct.A! >= analyzeScenario(cannot, 60, 2).winPct.A!, "the option to walk away should not hurt");
  // Schema: a loner disposition without σ is rejected.
  const noSigma:any = structuredClone(canWalk); delete noSigma.structure.sigma;
  assert.throws(()=> assertScenario(noSigma), /structure.sigma/);
});

console.log("verify-pack OK");
