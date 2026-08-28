import assert from "node:assert/strict";
import { assertScenario, isValidPayoff } from "./domain.js";
import { playMatch, strategies, zdVector, ZD_BASELINE, type EcoState, type TransitionState } from "./kernel.js";
import { Rng } from "./rng.js";
import { analyzeScenario } from "./analysis.js";

const P={T:5,R:3,P:1,S:0};

function run(name:string, fn:()=>void){ try{ fn(); console.log(`✔ ${name}`);}catch(e){ console.error(`✘ ${name}`); throw e; } }

run("1.1 Pairwise strategy checks: TFT vs ALLD vs ALLC vs Grim vs Random vs TF2T", ()=>{
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
  const m={ situation:"coalition betrayal", players:[{name:"A", dispositions:["colluder"], team:"c1", betrayalProb:0.05} as any, {name:"B", dispositions:["colluder"], team:"c1"} as any], payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9], noise:[0,0]}} as any;
  assert.doesNotThrow(()=> assertScenario(m as any));
  (m as any).players[0].betrayalProb=2; assert.throws(()=> assertScenario(m as any));
});

run("5.x memory2/shaper strategies execute", ()=>{
  const mm = playMatch(strategies.memory2, strategies.shaper, {T:5,R:3,P:1,S:0}, {T:5,R:3,P:1,S:0}, 20,0,new Rng(1));
  assert.ok(Number.isFinite(mm.scoreA));
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

run("6.1 Eco feedback (Weitz): cooperation and environment chase each other", ()=>{
  const eco = (n:number): EcoState => ({ A1:{T:5,R:1,P:0,S:-1}, theta:2, epsilon:0.2, n });
  // Coupling direction: mutual C pushes n up (θc-(1-c)>0), mutual D pushes it down.
  const up = playMatch(strategies.trusting, strategies.trusting, P,P,100,0,new Rng(1), { eco: eco(0.5) });
  const down = playMatch(strategies.alld, strategies.alld, P,P,100,0,new Rng(1), { eco: eco(0.5) });
  assert.ok(up.envFinal! > 0.5 && down.envFinal! < 0.5, `coop→n up (${up.envFinal}), defect→n down (${down.envFinal})`);
  // Clamp holds under a violent ε/θ — n never escapes [0.01,0.99].
  const hot = playMatch(strategies.trusting, strategies.trusting, P,P,500,0,new Rng(1), { eco: { A1:P, theta:50, epsilon:0.9, n:0.5 } });
  assert.ok(hot.envFinal! <= 0.99 && hot.envFinal! >= 0.01, `clamp escaped: ${hot.envFinal}`);
  // The tragedy: cooperators degrade the environment (n→1, A1 with R1=1<R0=3), lowering their OWN reward vs static.
  const stat = playMatch(strategies.trusting, strategies.trusting, P,P,100,0,new Rng(1));
  const trag = playMatch(strategies.trusting, strategies.trusting, P,P,100,0,new Rng(1), { eco: eco(0.5) });
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
  const coop = playMatch(strategies.trusting, strategies.trusting, poor, poor, 100, 0, new Rng(1), { transition: trans() });
  const def = playMatch(strategies.alld, strategies.alld, poor, poor, 100, 0, new Rng(1), { transition: trans() });
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

run("9.1 Reputation (Leading Eight): indirect reciprocity punishes a serial defector", ()=>{
  // A lone ALLD among trusting victims. Without reputation it exploits all of them and wins outright.
  // With reputation the victims learn its bad standing (from how it treated the OTHERS) and sanction it —
  // the indirect channel a single 2-player match cannot express.
  const base:any = { situation:"indirect reciprocity",
    players:[{name:"Cheat",dispositions:["alld"]},{name:"V1",dispositions:["trusting"]},{name:"V2",dispositions:["trusting"]},{name:"V3",dispositions:["trusting"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.95,0.95], noise:[0,0]}};
  const noRep = analyzeScenario(base, 150, 42);
  const image = analyzeScenario({...base, structure:{...base.structure, reputation:{norm:"L3"}}}, 150, 42);
  const quant = analyzeScenario({...base, structure:{...base.structure, reputation:{quantitative:true, theta:0}}}, 150, 42);
  assert.ok(noRep.winPct.Cheat! > 99, `without reputation the cheat exploits freely: ${noRep.winPct.Cheat}`);
  assert.ok(image.winPct.Cheat! < noRep.winPct.Cheat! - 30, `image reputation must curb the cheat: ${image.winPct.Cheat} vs ${noRep.winPct.Cheat}`);
  assert.ok(quant.winPct.Cheat! < 1, `a public ledger with θ=0 should shut the cheat out entirely: ${quant.winPct.Cheat}`);
  // Reputation is opt-in: a model without it is byte-for-byte the legacy path (adds no rng draws).
  const a = analyzeScenario(base, 80, 5), b = analyzeScenario(base, 80, 5);
  assert.deepEqual(a.winPct, b.winPct, "reputation-off path stays deterministic");
});

run("9.2 Reputation schema guards + gossip runs deterministically", ()=>{
  const model:any = { situation:"rep", players:[{name:"A",dispositions:["provocable"]},{name:"B",dispositions:["provocable"]},{name:"C",dispositions:["provocable"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9], noise:[0.05,0.05], reputation:{norm:"L3", gossip:[0.2,0.2]}}};
  const r1 = analyzeScenario(model, 60, 3), r2 = analyzeScenario(model, 60, 3);
  assert.deepEqual(r1.cooperation, r2.cooperation, "gossip path is reproducible under a fixed seed");
  const badNorm:any = structuredClone(model); badNorm.structure.reputation.norm="L9";
  assert.throws(()=> assertScenario(badNorm), /norm must be L1..L8/);
  const badField:any = structuredClone(model); badField.structure.reputation.foo=1;
  assert.throws(()=> assertScenario(badField), /Unknown reputation field/);
  const badTheta:any = structuredClone(model); badTheta.structure.reputation.theta=99;
  assert.throws(()=> assertScenario(badTheta), /reputation.theta/);
  // Indirect reciprocity needs a third party — reputation on a 2-player dyad is rejected (it would
  // silently reduce to a direct-reciprocity cooperation knob, which grim/provocable already cover).
  const dyad:any = structuredClone(model); dyad.players = dyad.players.slice(0,2);
  assert.throws(()=> assertScenario(dyad), /needs at least three players/);
});

run("10.1 Pool/peer punishment (Sigmund): deters defection, but plain cooperators free-ride on it", ()=>{
  const P2={T:5,R:3,P:1,S:0};
  const pen = (aP:boolean,bP:boolean,pool:boolean)=>({ punishment:{ beta:3, gamma:1, pool, aPunishes:aP, bPunishes:bP } });
  // Deterrence: a defector facing a punisher is fined β each round, scoring far less than vs a plain cooperator.
  const defVsCoop = playMatch(strategies.alld, strategies.trusting, P2,P2,20,0,new Rng(1));
  const defVsPun  = playMatch(strategies.alld, strategies.punisher, P2,P2,20,0,new Rng(1), pen(false,true,false));
  assert.ok(defVsPun.scoreA < defVsCoop.scoreA - 40, `punishment must bite the defector: ${defVsPun.scoreA} vs ${defVsCoop.scoreA}`);
  // Second-order free-rider (pool): with no defectors, a plain cooperator out-earns a pool-punisher (who pays γ for nothing).
  const coopVsCoop = playMatch(strategies.trusting, strategies.trusting, P2,P2,20,0,new Rng(1));
  const poolPunVsCoop = playMatch(strategies.punisher, strategies.trusting, P2,P2,20,0,new Rng(1), pen(true,false,true));
  assert.ok(poolPunVsCoop.scoreA < coopVsCoop.scoreA, `pool-punisher must under-earn a free-riding cooperator: ${poolPunVsCoop.scoreA} vs ${coopVsCoop.scoreA}`);
  // Peer variant: a punisher pays nothing when there is no defection to fine.
  const peerPunVsCoop = playMatch(strategies.punisher, strategies.trusting, P2,P2,20,0,new Rng(1), pen(true,false,false));
  assert.equal(peerPunVsCoop.scoreA, coopVsCoop.scoreA, `peer-punisher pays only when it fines: ${peerPunVsCoop.scoreA} vs ${coopVsCoop.scoreA}`);
  // β>γ makes it a net social deterrent: the fine on the defector exceeds the punisher's added cost.
  const coopVsDef = playMatch(strategies.trusting, strategies.alld, P2,P2,20,0,new Rng(1)).scoreA; // plain coop, no punishing
  const fine = defVsCoop.scoreA - defVsPun.scoreA;   // β·n levied on the defector
  const cost = coopVsDef - defVsPun.scoreB;          // γ·n the punisher paid vs a non-punishing cooperator
  assert.ok(fine > cost, `fine on defector (β·n=${fine}) must exceed punisher's cost (γ·n=${cost})`);
});

run("10.2 Punishment end-to-end + schema", ()=>{
  const model:any = { situation:"sanctioned commons", players:[
    {name:"Enforcer",dispositions:["punisher"]},{name:"Cheat",dispositions:["exploitative","alld"]}],
    payoffs:{T:[5,5],R:[3,3],P:[1,1],S:[0,0]}, structure:{w:[0.9,0.9], noise:[0,0], punishment:{ beta:[2,4], gamma:[0.5,1.5], pool:false }}};
  const r=analyzeScenario(model, 40, 3);
  assert.ok(r.sensitivity.some(s=> s.input === "punish_beta") && r.sensitivity.some(s=> s.input === "punish_gamma"), "β/γ must appear as sensitivity inputs");
  // Schema: a punisher disposition without config is rejected; unknown punishment field rejected.
  const noCfg:any = structuredClone(model); delete noCfg.structure.punishment;
  assert.throws(()=> assertScenario(noCfg), /structure.punishment/);
  const badField:any = structuredClone(model); badField.structure.punishment.foo=1;
  assert.throws(()=> assertScenario(badField), /Unknown punishment field/);
});

run("11.1 Cheap talk: a mutual C-pledge builds goodwill; a committed defector can't launder itself; lies cost", ()=>{
  const SH={T:3,R:5,P:1,S:0}, P2={T:5,R:3,P:1,S:0};
  // Coordination: in a Stag Hunt a mutual C-pledge lets conditional cooperators lock onto the good equilibrium.
  const shPlain = playMatch(strategies.pavlov, strategies.pavlov, SH,SH,50,0.1,new Rng(3));
  const shTalk  = playMatch(strategies.pavlov, strategies.pavlov, SH,SH,50,0.1,new Rng(3), { cheapTalk:{credibility:0.8, lieCost:0} });
  assert.ok(shTalk.cooperation > shPlain.cooperation + 0.05, `cheap talk must raise Stag-Hunt coordination: ${shTalk.cooperation} vs ${shPlain.cooperation}`);
  // A committed defector opens with D, so it cannot make a C-pledge — it gets no goodwill boost and pays no lie
  // cost. Cheap talk therefore cannot launder ALLD: identical to no talk (ALLD/ALLC are deterministic openers).
  const alldPlain = playMatch(strategies.alld, strategies.trusting, P2,P2,30,0,new Rng(1));
  const alldTalk  = playMatch(strategies.alld, strategies.trusting, P2,P2,30,0,new Rng(1), { cheapTalk:{credibility:0.8, lieCost:5} });
  assert.equal(alldTalk.scoreA, alldPlain.scoreA, `cheap talk must not help a committed defector: ${alldTalk.scoreA} vs ${alldPlain.scoreA}`);
  // A liar that pledges C then defects (detective) is doubly checked: its own goodwill lean cools its defection,
  // and a positive lieCost fines each betrayal — so a lie costs strictly more than a free pledge.
  const liarFree  = playMatch(strategies.detective, strategies.trusting, P2,P2,30,0,new Rng(1), { cheapTalk:{credibility:0.8, lieCost:0} });
  const liarCost  = playMatch(strategies.detective, strategies.trusting, P2,P2,30,0,new Rng(1), { cheapTalk:{credibility:0.8, lieCost:2} });
  assert.ok(liarCost.scoreA < liarFree.scoreA, `lieCost must bite the liar: ${liarCost.scoreA} vs ${liarFree.scoreA}`);
  // An honest cooperator that pledges C and cooperates pays no lie cost.
  const honest = playMatch(strategies.trusting, strategies.trusting, P2,P2,30,0,new Rng(1), { cheapTalk:{credibility:0.5, lieCost:5} });
  const plain  = playMatch(strategies.trusting, strategies.trusting, P2,P2,30,0,new Rng(1));
  assert.equal(honest.scoreA, plain.scoreA, `honouring a pledge is free: ${honest.scoreA} vs ${plain.scoreA}`);
});

run("11.2 Cheap talk end-to-end + schema", ()=>{
  const model:any = { situation:"joint venture", game:"stag_hunt", players:[
    {name:"A",dispositions:["provocable","pavlov"]},{name:"B",dispositions:["provocable","trusting"]}],
    payoffs:{T:[3,4],R:[5,6],P:[1,2],S:[0,1]}, structure:{w:[0.9,0.9], noise:[0.05,0.05], cheapTalk:{credibility:[0.5,0.9], lieCost:[1,3]}}};
  const r=analyzeScenario(model, 40, 3);
  assert.ok(r.sensitivity.some(s=> s.input === "talk_credibility") && r.sensitivity.some(s=> s.input === "talk_lieCost"), "credibility/lieCost must appear as sensitivity inputs");
  const badField:any = structuredClone(model); badField.structure.cheapTalk.foo=1;
  assert.throws(()=> assertScenario(badField), /Unknown cheapTalk field/);
  const badCred:any = structuredClone(model); badCred.structure.cheapTalk.credibility=[0,2];
  assert.throws(()=> assertScenario(badCred), /cheapTalk.credibility/);
});

run("12.1 Visual replay trace is opt-in and does not change a match", ()=>{
  const payoff={T:5,R:3,P:1,S:0};
  const plain=playMatch(strategies.forgiving,strategies.grim,payoff,payoff,40,0.05,new Rng(77));
  const traced=playMatch(strategies.forgiving,strategies.grim,payoff,payoff,40,0.05,new Rng(77),{captureTrace:true});
  assert.equal(plain.scoreA,traced.scoreA); assert.equal(plain.scoreB,traced.scoreB);
  assert.equal(plain.cooperation,traced.cooperation); assert.equal(plain.trace,undefined);
  assert.equal(traced.trace?.length,40); assert.equal(traced.trace?.at(-1)?.scoreA,traced.scoreA);
});

run("13.1 Backend model creation: fast local path + domain guards", ()=>{
  const model: any = {
    situation: "fast local model",
    game: "prisoners_dilemma",
    players: [{ name: "A", dispositions: ["provocable"] }, { name: "B", dispositions: ["alld"] }],
    payoffs: { T: [5,6], R: [3,4], P: [1,2], S: [-1,1] },
    structure: { w: [0.7,0.97], noise: [0,0.1] },
  };
  assert.doesNotThrow(()=> assertScenario(model));
  const badPayoff: any = structuredClone(model); badPayoff.payoffs = { T: [1,1], R: [10,10], P: [1,1], S: [0,0] };
  assert.throws(()=> assertScenario(badPayoff), /cannot satisfy/);
  const typo: any = structuredClone(model); (typo.players[0] as any).value = [-1,1];
  assert.throws(()=> assertScenario(typo), /Unknown field "value"/);
  const loner: any = structuredClone(model); loner.players[0].dispositions = ["loner"];
  assert.throws(()=> assertScenario(loner), /sigma/);
  const t0 = Date.now();
  const r = analyzeScenario(model, 10, 42);
  const dt = Date.now() - t0;
  assert.ok(dt < 500, `local model->result should be <500ms, got ${dt}ms`);
  assert.ok(typeof r.winPct.A === "number" && r.cooperation.mean >= 0);
});

console.log("verify-pack OK");
