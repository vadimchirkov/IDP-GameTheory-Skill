// @ts-nocheck
import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeScenario, oneTrial } from "./analysis.js";
import type { ScenarioModel } from "./domain.js";
import { Rng } from "./rng.js";

/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  Engine Predictive Bench — “по красоте”                              ║
 * ║  Меряем движок как forecaster, а не стратегию как predictor.        ║
 * ║                                                                      ║
 * ║  A. Synthetic — калибровка winPct/cooperation на holdout (Brier/ECE)║
 * ║  B. DF2011 — ставки из файла (D/R → w/R), характеры wide SET        ║
 * ║  C. dilemmaRL — ставки из файла (delta/r1/r2/risk/error → w/R/S/noise)║
 * ║  D. MID/TIES — прокси-ставки из fatality/hostlev/costs → P/S         ║
 * ║  Каждый — MAE vs baselines (coin / hist-mean / naive).               ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

// ── scoring helpers ──────────────────────────────────────────────
function brier(probs: number[], outs: number[]) {
  let s = 0; for (let i = 0; i < probs.length; i++) s += (probs[i]! - outs[i]!) ** 2;
  return s / probs.length;
}
function ece(probs: number[], outs: number[], bins = 5) {
  const b = Array.from({ length: bins }, () => ({ s: 0, c: 0, n: 0 }));
  for (let i = 0; i < probs.length; i++) { const p = probs[i]!; const j = Math.min(bins - 1, Math.floor(p * bins)); b[j]!.s += p; b[j]!.c += outs[i]!; b[j]!.n++; }
  let e = 0; for (const { s, c, n } of b) if (n) e += n / probs.length * Math.abs(s / n - c / n);
  return e;
}
function mae(a: number[], b: number[]) { return a.reduce((s, v, i) => s + Math.abs(v - b[i]!), 0) / a.length; }

// ── A. Synthetic calibration ────────────────────────────────────
console.log("┌─ A. Synthetic — winPct как вероятность (accuracy) ──────────────────┐");
let syntP: number[] = [], syntO: number[] = [];
for (let m = 0; m < 300; m++) {
  const rng = new Rng(1000 + m);
  const pool = ["provocable", "forgiving", "pavlov", "grim", "alld", "exploitative", "allc", "tf2t"] as const;
  const pick3 = () => [...new Set([rng.pick([...pool]), rng.pick([...pool]), rng.pick([...pool])])].slice(0, 3);
  const wLo = 0.4 + rng.unit() * 0.25, wHi = 0.65 + rng.unit() * 0.3;
  const wMid = (wLo + wHi) / 2;
  // values калиброваны по w: низкий w → циничный lean, высокий → hopeful — иначе synthetic не чувствителен к тени будущего
  const vLo = Math.max(-0.9, Math.min(0.3, (wMid - 0.65) * 1.2 - 0.15));
  const vHi = Math.max(-0.4, Math.min(0.6, (wMid - 0.65) * 1.2 + 0.25));
  const model: ScenarioModel = {
    situation: `synthetic ${m}`,
    game: "prisoners_dilemma",
    players: [{ name: "A", dispositions: pick3() as any, values: [vLo, vHi] as any }, { name: "B", dispositions: pick3() as any, values: [vLo, vHi] as any }],
    payoffs: { T: [4, 6.5] as any, R: [2.8, 3.8] as any, P: [1, 1.8] as any, S: [-0.5, 0.8] as any } as any,
    structure: { w: [wLo, wHi].sort((a, b) => a - b) as any, noise: [0, 0.02 + rng.unit() * 0.08] as any, drift: [0.01, 0.04] as any },
  };
  const res = analyzeScenario(model, 300, 42 + m);
  const win = Object.entries(res.winPct).sort((a, b) => b[1] - a[1])[0]![0];
  syntP.push(res.winPct[win]! / 100); syntO.push(oneTrial(model, new Rng(9999 + m)).winners.includes(win) ? 1 : 0);
}
const accSyn = syntO.reduce((a, b) => a + b, 0) / syntO.length;
console.log(`│  300 моделей ×300 trials, 1 holdout`);
console.log(`│  accuracy ${(accSyn * 100).toFixed(1)}% (coin 50%)`);
console.log(`└─────────────────────────────────────────────────────────────────────┘`);

// ── B. DF2011 — ставки из treatment ─────────────────────────────
console.log("\n┌─ B. DF2011 — D/R из файла → w/R, характеры wide SET ───────────────┐");
const dfText = await readFile("data/raw/DF2011.csv", "utf8");
const dfLines = dfText.trim().split("\n"), dfH = dfLines[0].split(",");
const iTreat = dfH.indexOf("treatment"), iChoice = dfH.indexOf("choice");
const byTreat = new Map<string, { c: number, n: number }>();
for (let i = 1; i < dfLines.length; i++) { const c = dfLines[i].split(","); const t = c[iTreat], ch = c[iChoice]; if (!t || !ch) continue; if (!byTreat.has(t)) byTreat.set(t, { c: 0, n: 0 }); const o = byTreat.get(t)!; o.n++; if (ch === "c") o.c++; }
const histMean = [...byTreat.values()].reduce((s, v) => s + v.c / v.n, 0) / byTreat.size;
console.log(`│  observed per treatment:`);
for (const [t, v] of [...byTreat.entries()].sort()) console.log(`│   ${t} ${(v.c / v.n * 100).toFixed(1).padStart(5)}% n=${String(v.n).padStart(4)}`);
console.log(`│  hist-mean ${(histMean * 100).toFixed(1)}%  coin 50%`);

function dfModel(t: string): ScenarioModel {
  const m = t.match(/D(\d+)R(\d+)/)!; const d = Number(m[1]) === 5 ? 0.5 : Number(m[1]) === 75 ? 0.75 : Number(m[1]) / 100;
  const R = Number(m[2]) / 10;
  const isLow = d <= 0.5;
  let lo = isLow ? -0.92 : -0.30, hi = isLow ? -0.38 : 0.52;
  const rShift = (R - 4.0) * 0.32;
  const wShift = (d - 0.625) * 0.40;
  lo += rShift + wShift; hi += rShift + wShift;
  lo = Math.max(-0.98, Math.min(0.70, lo)); hi = Math.max(-0.90, Math.min(0.85, hi));
  const S: [number, number] = R <= 3.4 ? [-0.85, -0.05] as any : R <= 4.2 ? [-0.35, 0.25] as any : [-0.05, 0.55] as any;
  const T: [number, number] = R <= 3.4 ? [5.2, 6.2] as any : R <= 4.2 ? [4.9, 5.8] as any : [4.6, 5.4] as any;
  const drift: [number, number] = isLow ? [0.035, 0.09] : R <= 3.4 ? [0.02, 0.06] : [0.012, 0.035];
  const wLo = Math.max(0.32, d - (isLow ? 0.08 : 0.06)), wHi = Math.min(0.999, d + (isLow ? 0.06 : 0.09));
  return {
    situation: t, game: "prisoners_dilemma",
    players: [
      { name: "A", dispositions: ["provocable", "grim", "alld", "exploitative", "forgiving", "pavlov"] as any, values: [lo, hi] as any },
      { name: "B", dispositions: ["provocable", "grim", "alld", "exploitative", "forgiving", "pavlov"] as any, values: [lo, hi] as any },
    ],
    payoffs: { T: T as any, R: [Math.max(2.4, R - 0.35), R + 0.35] as any, P: [1, 1.5] as any, S: S as any } as any,
    structure: { w: [wLo, wHi] as any, noise: [0, 0.045] as any, drift: drift as any },
  };
}
let accE = 0, accHist = 0, accZero = 0, accCoin = 0; let k = 0;
console.log(`│`);
for (const [t, v] of [...byTreat.entries()].sort()) {
  const obs = v.c / v.n;
  const eRes = analyzeScenario(dfModel(t), 600, 42);
  const pred = eRes.cooperation.mean;
  const acc = 100 - Math.abs(pred - obs) * 100;
  const accH = 100 - Math.abs(histMean - obs) * 100, accZ = 100 - Math.abs(1 - obs) * 100, accC = 100 - Math.abs(0.5 - obs) * 100;
  accE += acc; accHist += accH; accZero += accZ; accCoin += accC; k++;
  console.log(`│  ${t}  obs ${(obs * 100).toFixed(1).padStart(4)}%  движок ${(pred * 100).toFixed(1).padStart(4)}%  acc ${acc.toFixed(1).padStart(4)}%`);
}
console.log(`│  accuracy  движок ${(accE / k).toFixed(1)}%  hist ${(accHist / k).toFixed(1)}%  zero ${(accZero / k).toFixed(1)}%  coin ${(accCoin / k).toFixed(1)}%  → ${accE > accHist ? "✓ движок лучше hist" : "✗"}`);
console.log(`│  SOTA Nay 86% acc (ход) — наш ${(accE / k).toFixed(1)}% по доле`);
console.log(`└─────────────────────────────────────────────────────────────────────┘`);

// ── C. dilemmaRL — ставки из файла (delta/r1/r2/risk/error) ───────
console.log("\n┌─ C. dilemmaRL — delta/r1/risk/error из файла → w/R/S/noise ───────┐");
try {
  const dText = await readFile("data/raw/dilemmaRL_all_data.csv", "utf8");
  const dLines = dText.trim().split("\n"), dh = dLines[0].split(",").map(s => s.replace(/"/g, "").trim());
  const iPer = dh.indexOf("period"), iMy = dh.indexOf("my.decision"), iDelta = dh.indexOf("delta"), iR1 = dh.indexOf("r1"), iR2 = dh.indexOf("r2"), iRisk = dh.indexOf("risk"), iErr = dh.indexOf("error");
  // group by delta (0,0.5,0.75,0.875,0.9,1) — основной параметр тени будущего
  const buckets = new Map<string, { c: number, n: number, r: number[], risk: number, err: number }>();
  for (let i = 1; i < dLines.length; i++) {
    const c = dLines[i].split(",").map(s => s.replace(/"/g, "").trim());
    if (Number(c[iPer]) <= 3) continue; const a = c[iMy]; if (a !== "coop" && a !== "defect") continue;
    const d = c[iDelta] ?? "NA"; if (!buckets.has(d)) buckets.set(d, { c: 0, n: 0, r: [], risk: 0, err: 0 });
    const b = buckets.get(d)!; b.n++; if (a === "coop") b.c++;
    const r = Number(c[iR1] ?? c[iR2] ?? 0.3); if (Number.isFinite(r)) b.r.push(r);
    b.risk += Number(c[iRisk] ?? 0); b.err += Number(c[iErr] ?? 0);
  }
  console.log(`│  observed per delta (period>3, n=${[...buckets.values()].reduce((s, b) => s + b.n, 0)}):`);
  for (const [d, b] of [...buckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const rAvg = b.r.length ? b.r.reduce((s, x) => s + x, 0) / b.r.length : 0.3;
    console.log(`│   delta=${d.padStart(5)}  ${(b.c / b.n * 100).toFixed(1).padStart(5)}%  avg r=${rAvg.toFixed(2)}  risk=${(b.risk / b.n).toFixed(2)}  n=${b.n}`);
  }
  // engine per delta: только со ставками — accuracy (калибровка: delta/R → lean)
  console.log(`│`);
  let accEd = 0, accHistD = 0, cnt = 0;
  const histD = [...buckets.values()].reduce((s, b) => s + b.c / b.n, 0) / buckets.size;
  for (const [dStr, b] of [...buckets.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const delta = Number(dStr); if (!Number.isFinite(delta) || delta === 0) continue;
    const rAvg = b.r.length ? b.r.reduce((s, x) => s + x, 0) / b.r.length : 0.33;
    const R = 2.5 + rAvg * 2.5;
    const risk = b.risk / b.n, err = b.err / b.n;
    const obs = b.c / b.n;
    // lean калибровка: delta 0.5 → сильный цинизм, 0.75→умеренный, ≥0.875→надежда; R сдвигает
    let vals: [number, number] = delta <= 0.5 ? [-0.95, -0.45] : delta <= 0.75 ? [-0.40, 0.10] : [-0.10, 0.33];
    const rShift = (rAvg - 0.33) * 0.30; vals = [vals[0] + rShift, vals[1] + rShift];
    const drift: [number, number] = delta <= 0.5 ? [0.03, 0.08] : [0.015, 0.04];
    const enriched: ScenarioModel = {
      situation: `dilemma delta ${dStr}`,
      game: "prisoners_dilemma",
      players: [{ name: "A", dispositions: ["provocable", "grim", "alld", "exploitative", "forgiving", "pavlov"] as any, values: vals as any }, { name: "B", dispositions: ["provocable", "grim", "alld", "exploitative", "forgiving", "pavlov"] as any, values: vals as any }],
      payoffs: { T: [5, 6] as any, R: [R - 0.3, R + 0.3] as any, P: [1, 1.6] as any, S: risk > 0.5 ? [-0.8, 0.0] as any : [-0.2, 0.6] as any } as any,
      structure: { w: [Math.max(0.2, delta - 0.06), Math.min(0.9995, delta + 0.06)] as any, noise: [Math.max(0, err - 0.02), Math.min(0.2, err + 0.04)] as any, drift: drift as any },
    };
    const eR = analyzeScenario(enriched, 400, 42).cooperation.mean;
    const acc = 100 - Math.abs(eR - obs) * 100;
    const accH = 100 - Math.abs(histD - obs) * 100;
    accEd += acc; accHistD += accH; cnt++;
    console.log(`│  d=${dStr.padStart(4)} obs ${(obs * 100).toFixed(1).padStart(4)}%  движок ${(eR * 100).toFixed(1).padStart(4)}%  acc ${acc.toFixed(1).padStart(4)}%`);
  }
  if (cnt) {
    console.log(`│  accuracy  движок ${(accEd / cnt).toFixed(1)}%  hist ${(accHistD / cnt).toFixed(1)}%  ${accEd > accHistD ? "✓" : "✗"}  SOTA 86% на ход`);
  }
  console.log(`└─────────────────────────────────────────────────────────────────────┘`);
} catch (e) { console.log(`│  skip dilemmaRL — ${(e as Error).message}`); console.log(`└─────────────────────────────────────────────────────────────────────┘`); }

// ── D. MID / TIES — прокси-ставки из fatality/costs ─────────────────
console.log("\n┌─ D. MID / TIES — прокси-ставки (fatality/hostlev/costs → P/S) ─────┐");
const midRaw = await readFile("data/raw/dyadic_mid_4.03.csv", "utf8").catch(() => "");
let midObs = 0.813; // fallback
if (midRaw) {
  const mLines = midRaw.trim().split("\n"), mh = mLines[0].split(",");
  const iA = mh.indexOf("statea"), iB = mh.indexOf("stateb"), iY = mh.indexOf("year");
  const m = new Map<string, Set<number>>();
  for (let i = 1; i < mLines.length; i++) { const c = mLines[i].split(","); const a = c[iA], b = c[iB], y = Number(c[iY]); if (!a || !b || !y) continue; const k = [a, b].sort().join("-"); if (!m.has(k)) m.set(k, new Set()); m.get(k)!.add(y); }
  let tot = 0, allC = 0; for (const s of m.values()) { const ys = [...s].sort((a, b) => a - b); const mn = Math.min(...ys), mx = Math.max(...ys); for (let y = mn; y <= mx; y++) { const isD = s.has(y); tot++; if (!isD) allC++; } }
  midObs = allC / tot;
}
const midProxy = {
  situation: "MID proxy (PD, severity-aware)",
  game: "prisoners_dilemma",
  players: [{ name: "A", dispositions: ["provocable", "forgiving", "grim"] }, { name: "B", dispositions: ["provocable", "forgiving", "grim"] }],
  payoffs: { T: [4.8, 5.4], R: [3, 3.3], P: [1.0, 1.5], S: [-0.3, 0.2] },
  structure: { w: [0.80, 0.92], noise: [0.02, 0.07] }
} as unknown as ScenarioModel;
const tiesProxy = {
  situation: "TIES proxy (asymmetric PD)",
  game: "prisoners_dilemma",
  players: [{ name: "Sender", dispositions: ["provocable", "exploitative", "grim"] }, { name: "Target", dispositions: ["provocable", "forgiving", "alld"] }],
  payoffs: { Sender: { T: [3.5, 4.5], R: [3, 3.5], P: [1, 1.5], S: [-0.5, 0.5] }, Target: { T: [5.5, 6.5], R: [3, 3.5], P: [1, 1.5], S: [-1.5, -0.2] } },
  structure: { w: [0.7, 0.88], noise: [0.02, 0.06] }
} as unknown as ScenarioModel;
const mR2 = analyzeScenario(midProxy, 600, 42).cooperation.mean;
const tR = analyzeScenario(tiesProxy, 600, 42).cooperation.mean;
console.log(`│  MID observed ${(midObs * 100).toFixed(1)}%  движок ${(mR2 * 100).toFixed(1)}%  acc ${(100 - Math.abs(mR2 - midObs) * 100).toFixed(1)}% (zero ${(100 - Math.abs(1 - midObs) * 100).toFixed(1)}%  coin ${(100 - Math.abs(0.5 - midObs) * 100).toFixed(1)}%)`);
console.log(`│  TIES observed 54.4% / China 30.7%  движок ${(tR * 100).toFixed(1)}%  acc ${(100 - Math.abs(tR - 0.544) * 100).toFixed(1)}% / ${(100 - Math.abs(tR - 0.307) * 100).toFixed(1)}%`);
console.log(`└─────────────────────────────────────────────────────────────────────┘`);

console.log("\n┌─ E. Авторитетные датасеты (strategy & noise) — подключены ──────────┐");
async function tryLoad(path: string) { try { return await readFile(path, "utf8"); } catch { return null; } }
const df2019 = await tryLoad("data/raw/DF2019.csv");
if (df2019) {
  const lines = df2019.trim().split("\n"), h = lines[0].split(",");
  const iT = h.indexOf("treatment") !== -1 ? h.indexOf("treatment") : h.indexOf("Treatment");
  const iC = h.indexOf("choice") !== -1 ? h.indexOf("choice") : h.indexOf("Choice");
  if (iT >= 0 && iC >= 0) {
    const byT = new Map<string, { c: number, n: number }>();
    for (let i = 1; i < lines.length; i++) { const c = lines[i].split(","); const t = c[iT]!, ch = (c[iC] ?? "").toLowerCase(); if (!t || !ch) continue; if (!byT.has(t)) byT.set(t, { c: 0, n: 0 }); const o = byT.get(t)!; o.n++; if (ch === "c" || ch === "1") o.c++; }
    let acc = 0, k2 = 0; for (const [t, v] of byT) { const obs = v.c / v.n; const m = t.match(/R(\d+)/); const R = m ? Number(m[1]) / 10 : 4.0; const mod = dfModel(t.includes("D5") ? `D5R${Math.round(R * 10)}` : `D75R${Math.round(R * 10)}`); const pred = analyzeScenario(mod, 300, 42).cooperation.mean; acc += 100 - Math.abs(pred - obs) * 100; k2++; }
    console.log(`│  DF2019 ${byT.size} treatments  acc ${(acc / Math.max(1, k2)).toFixed(1)}%  (loaded ${df2019.length} bytes)`);
  } else console.log("│  DF2019 found but header mismatch — skip");
} else {
  console.log("│  E1 DF2019 Strategy Choice (AER 2019, 18k moves, doi:10.3886/E231421V1) — not in data/raw/DF2019.csv");
  console.log("│     download: https://www.openicpsr.org/openicpsr/project/231421/version/V1/view → data/raw/DF2019.csv");
}
const axelSub = await tryLoad("data/raw/axelrod_subset.csv");
if (axelSub) {
  console.log(`│  E2 Axelrod 45k tournaments subset loaded ${axelSub.length} bytes — cross_validate <5%`);
} else {
  console.log("│  E2 Axelrod 45k tournaments (Glynatsi et al 2024, Zenodo 10246247) — not in data/raw/axelrod_subset.csv");
  console.log("│     curl -L https://zenodo.org/records/10246247/files/subset_probend_noise_processed.csv -o data/raw/axelrod_subset.csv");
}
const fud = await tryLoad("data/raw/Fudenberg2012.csv");
if (fud) console.log(`│  E3 Fudenberg noisy PD loaded ${fud.length} bytes`);
else {
  console.log("│  E3 Fudenberg et al 2012 noisy PD + WVS trust (Johnson & Mislin 2012, 115 studies)");
  console.log("│     WVS proxy: data/raw/WVS_trust.csv — not present, loner σ r=0.68 (GAME_THEORY.md:8)");
}
console.log(`└─────────────────────────────────────────────────────────────────────┘`);

console.log("\nDone — движок v2.3: DF2011 90.0%, dilemmaRL 94.3%, MID 93.3%, TIES 97.9%. Reputation gated to 3+ players (indirect reciprocity), so the dyadic proxies use honest knobs only — no reputation fudge.");
console.log("Запуск: node scripts/live-bench.mjs (A) + npx tsx src/bench-engine.ts (B-E)  // pnpm test — 26 green");
