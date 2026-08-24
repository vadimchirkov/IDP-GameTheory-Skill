// @ts-nocheck — model literals, like bench-engine.ts
import { readFile } from "node:fs/promises";
import { analyzeScenario } from "./analysis.js";
import { fitPosterior } from "./abc.js";
import { Rng } from "./rng.js";

/**
 * Live out-of-sample test for ABC conditioning on Dal Bó & Fréchette (2011) data.
 *
 * The question: given ONE generic repeated-PD model (a deliberately broad prior, not tuned per
 * treatment) and a handful of observed rounds from a specific treatment, does conditioning through
 * the model predict that treatment's TRUE cooperation better than the untouched prior?
 *
 * This is genuinely out-of-sample: we condition on a small noisy subsample (ĉ, e.g. 40 rounds) and
 * score against the full-sample rate c* (hundreds–thousands of rounds) we never showed the model.
 * If the posterior mean is closer to c* than the one-size prior mean, ABC adds real predictive value.
 */

const csv = await readFile("data/raw/DF2011.csv", "utf8");
const lines = csv.trim().split("\n");
const header = lines[0].split(",");
const iTreat = header.indexOf("treatment");
const iChoice = header.indexOf("choice");
const choices = new Map<string, string[]>();
for (let i = 1; i < lines.length; i++) {
  const cells = lines[i].split(",");
  const t = cells[iTreat], ch = cells[iChoice];
  if (!t || !ch) continue;
  (choices.get(t) ?? choices.set(t, []).get(t)!).push(ch);
}
const trueCoop = new Map([...choices].map(([t, arr]) => [t, arr.filter((c) => c === "c").length / arr.length]));

const DISPOSITIONS = ["alld", "exploitative", "grim", "provocable", "pavlov", "forgiving", "allc", "trusting"];
const payoffs = { T: [4.6, 6.2], R: [2.8, 3.8], P: [1, 1.8], S: [-0.85, 0.55] };
const structure = { w: [0.4, 0.8], noise: [0, 0.08], drift: [0, 0.05] };
const TRIALS = 3000;

// DF2011 is a two-player experiment, so its out-of-sample test uses a two-player prior: wide
// dispositions/leans/horizon so worlds span the cooperation spectrum the data shows (~0.08..0.94).
const broadDuel = {
  situation: "generic repeated PD (duel)", game: "prisoners_dilemma",
  players: ["A", "B"].map((name) => ({ name, dispositions: DISPOSITIONS, values: [-0.9, 0.6] })),
  payoffs, structure,
};
const result = analyzeScenario(broadDuel as never, TRIALS, 42);
const worldCoop = result.trials.map((t) => t.cooperation).sort((a, b) => a - b);
const priorMean = result.cooperation.mean;
console.log(`Prior: ${TRIALS} worlds, cooperation mean ${priorMean.toFixed(3)}, ` +
  `world range ${worldCoop[0].toFixed(3)}..${worldCoop.at(-1).toFixed(3)} ` +
  `(p10 ${worldCoop[Math.floor(TRIALS * 0.1)].toFixed(3)}, p90 ${worldCoop[Math.floor(TRIALS * 0.9)].toFixed(3)})`);
console.log(`Data cooperation spans ${Math.min(...trueCoop.values()).toFixed(3)}..${Math.max(...trueCoop.values()).toFixed(3)}\n`);

const OBS_ROUNDS = 40;   // how many rounds an analyst "saw" of the specific situation
const REPEATS = 200;     // random subsamples per treatment, to average out sampling noise
const TOL = 0.12;
const rng = new Rng(7);

// Three predictors of the full-sample rate c*: the one-size prior mean, the raw subsample ĉ
// (naive echo of the observation), and the ABC posterior mean (ĉ regularised through the model).
let priorErr = 0, naiveErr = 0, postErr = 0, essSum = 0, n = 0;
console.log(`treatment   c*     prior  naive  post    |Δ|prior |Δ|naive |Δ|post  ESS`);
for (const [t, arr] of [...choices].sort()) {
  const cStar = trueCoop.get(t)!;
  let postMean = 0, ne = 0, qe = 0, es = 0;
  for (let r = 0; r < REPEATS; r++) {
    let c = 0;
    for (let k = 0; k < OBS_ROUNDS; k++) c += arr[Math.floor(rng.unit() * arr.length)] === "c" ? 1 : 0;
    const obs = c / OBS_ROUNDS;                       // noisy subsample estimate ĉ
    const post = fitPosterior(result, { cooperation: obs, coopTolerance: TOL });
    postMean += post.cooperation.mean;
    ne += Math.abs(obs - cStar);
    qe += Math.abs(post.cooperation.mean - cStar);
    es += post.effectiveSampleSize;
  }
  const pe = Math.abs(priorMean - cStar);
  postMean /= REPEATS; ne /= REPEATS; qe /= REPEATS; es /= REPEATS;
  priorErr += pe; naiveErr += ne; postErr += qe; essSum += es; n += 1;
  console.log(`${t.padEnd(10)} ${cStar.toFixed(3)}  ${priorMean.toFixed(3)}  ${(ne + cStar).toFixed(3).slice(0, 5)}  ${postMean.toFixed(3)}   ${pe.toFixed(3)}    ${ne.toFixed(3)}    ${qe.toFixed(3)}   ${es.toFixed(0)}`);
}
console.log(`\nMAE  prior ${(priorErr / n).toFixed(3)}   naive-ĉ ${(naiveErr / n).toFixed(3)}   posterior ${(postErr / n).toFixed(3)}   (mean ESS ${(essSum / n).toFixed(0)} of ${TRIALS}, obs=${OBS_ROUNDS} rounds)`);
const vsPrior = (1 - (postErr / n) / (priorErr / n)) * 100;
const vsNaive = (1 - (postErr / n) / (naiveErr / n)) * 100;
console.log(`Posterior beats one-size prior by ${vsPrior.toFixed(0)}% (world-space covers the data, conditioning selects).`);
console.log(vsNaive > 0
  ? `Posterior beats raw ĉ by ${vsNaive.toFixed(0)}% — the model denoises a ${OBS_ROUNDS}-round sample, adding value beyond echoing it.`
  : `Posterior does not beat raw ĉ (${vsNaive.toFixed(0)}%) on this same-quantity task; its edge is predicting UN-observed quantities, not echoing cooperation.`);

// ── Cross-quantity test: recover a HIDDEN strategy from what we DID observe ────────────────────
// The engine (validated by verify-pack) generates ground-truth-labelled worlds. We observe some
// summary of a world, then ask whether the strategy posterior concentrates on the disposition the
// world actually dealt each player — a quantity we never observed. This is the non-circular test of
// whether conditioning is informative. Five players in a round-robin: a player's cooperation rate is
// now averaged over four opponents, so it can be a fingerprint of its own disposition, not one duel.
const broadField = {
  situation: "generic repeated PD (field)", game: "prisoners_dilemma",
  players: ["A", "B", "C", "D", "E"].map((name) => ({ name, dispositions: DISPOSITIONS, values: [-0.9, 0.6] })),
  payoffs, structure,
};
const field = analyzeScenario(broadField as never, TRIALS, 42);
const prior = fitPosterior(field, {});                 // empty obs → the disposition prior itself
const dispPrior = 1 / DISPOSITIONS.length;
const HELDOUT = 400;

function recover(vocab: (w) => Record<string, unknown>) {
  let priorMass = 0, postMass = 0, top1 = 0, cells = 0, ess = 0;
  for (let m = 0; m < HELDOUT; m++) {
    const world = analyzeScenario(broadField as never, 1, 6_000_000 + m).trials[0];
    const post = fitPosterior(field, vocab(world));
    ess += post.effectiveSampleSize;
    for (const [player, trueStrat] of Object.entries(world.digest.strategies)) {
      priorMass += prior.strategyPosterior[player]?.[trueStrat] ?? 0;
      postMass += post.strategyPosterior[player]?.[trueStrat] ?? 0;
      const argmax = Object.entries(post.strategyPosterior[player] ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
      top1 += argmax === trueStrat ? 1 : 0; cells += 1;
    }
  }
  return { postMass: postMass / cells, priorMass: priorMass / cells, top1: 100 * top1 / cells, ess: ess / HELDOUT };
}

const worldObs = recover((w) => ({ winner: w.winners[0], cooperation: w.cooperation, opening: w.digest.opening, response: w.digest.response, regime: w.digest.regime, coopTolerance: 0.1 }));
const perPlayer = recover((w) => ({ playerCooperation: w.playerCoop, coopTolerance: 0.1 }));
const combined = recover((w) => ({ playerCooperation: w.playerCoop, winner: w.winners[0], regime: w.digest.regime, coopTolerance: 0.1 }));

console.log(`\nHidden-strategy recovery (predict each player's dealt disposition), ${HELDOUT} held-out 5-player worlds, chance ${(100 * dispPrior).toFixed(0)}%:`);
console.log(`  vocabulary                    mass(true)  top-1   ESS`);
console.log(`  prior (no obs)                ${worldObs.priorMass.toFixed(3)}       ${(100 * dispPrior).toFixed(0)}%     ${TRIALS}`);
console.log(`  world aggregates              ${worldObs.postMass.toFixed(3)}       ${worldObs.top1.toFixed(0)}%    ${worldObs.ess.toFixed(0)}`);
console.log(`  per-player cooperation        ${perPlayer.postMass.toFixed(3)}       ${perPlayer.top1.toFixed(0)}%    ${perPlayer.ess.toFixed(0)}`);
console.log(`  per-player coop + world       ${combined.postMass.toFixed(3)}       ${combined.top1.toFixed(0)}%    ${combined.ess.toFixed(0)}`);
const massLift = (perPlayer.postMass - worldObs.postMass) / worldObs.postMass * 100;
console.log(massLift > 5
  ? `  → per-player cooperation puts ${massLift.toFixed(0)}% more posterior mass on the true strategy than world aggregates. Per-player granularity is the informative axis, as predicted.`
  : `  → per-player cooperation did not raise belief mass over world aggregates (${massLift.toFixed(0)}%).`);
