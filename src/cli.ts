import { readFile, mkdir, writeFile } from "node:fs/promises";
import { analyzeScenario, scenarioReport } from "./analysis.js";
import { fitPosterior, type Observation } from "./abc.js";
import type { ScenarioModel } from "./domain.js";

const args = process.argv.slice(2);
const path = args[0];
const visualMode = args.includes("--visual");
function flagValue(name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Build an ABC observation from `--observe-*` flags, or undefined if none are present. */
function parseObservation(): Observation | undefined {
  const obs: Observation = {};
  const coop = flagValue("--observe-coop");
  if (coop !== undefined) obs.cooperation = Number(coop);
  const winner = flagValue("--observe-winner");
  if (winner !== undefined) obs.winner = winner;
  const regime = flagValue("--observe-regime");
  if (regime !== undefined) obs.regime = regime;
  const tol = flagValue("--observe-tol");
  if (tol !== undefined) obs.coopTolerance = Number(tol);
  const players: Record<string, number> = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== "--observe-player") continue;
    const [name, value] = (args[i + 1] ?? "").split("=");
    if (!name || value === undefined) { console.error("--observe-player expects NAME=RATE, e.g. --observe-player China=0.3"); process.exit(1); }
    players[name] = Number(value);
  }
  if (Object.keys(players).length) obs.playerCooperation = players;
  return Object.keys(obs).length && (obs.cooperation !== undefined || obs.winner !== undefined || obs.regime !== undefined || obs.playerCooperation) ? obs : undefined;
}

if (!path) {
  console.error("Usage: pnpm scenario <model.json> [trials] [--seed N] [--visual]");
  console.error("  condition on evidence: [--observe-coop 0..1] [--observe-winner NAME] [--observe-regime cooperation|oscillation|fragile|conflict|exit] [--observe-player NAME=RATE ...] [--observe-tol 0.15]");
  process.exitCode = 1;
} else {
  const trialsArg = args.find(a => /^\d+$/.test(a));
  const trials = trialsArg ? Number(trialsArg) : 600;
  const seedIndex = args.indexOf("--seed");
  const seed = seedIndex >= 0 ? Number(args[seedIndex + 1]) : 42;
  const model = JSON.parse(await readFile(path, "utf8")) as ScenarioModel;
  if (visualMode) {
    const { generateWorldsVisual } = await import("./worlds-report.js");
    const html = generateWorldsVisual(model, trials, seed);
    await mkdir("reports", { recursive:true });
    await writeFile("reports/visual.html", html);
    console.log("visual -> reports/visual.html");
    process.exit(0);
  }
  const result = analyzeScenario(model, trials, seed);
  console.log(scenarioReport(result));
  const observation = parseObservation();
  if (observation) {
    const post = fitPosterior(result, observation);
    const usesTeams = model.players.some((p) => p.team);
    const baseWin = usesTeams ? result.winPctTeam : result.winPct;
    const postWin = usesTeams ? post.winPctTeam : post.winPct;
    const shownObs = [
      observation.cooperation !== undefined ? `cooperation≈${observation.cooperation}` : "",
      observation.winner ? `winner=${observation.winner}` : "",
      observation.regime ? `regime=${observation.regime}` : "",
      observation.playerCooperation ? Object.entries(observation.playerCooperation).map(([n, v]) => `${n}≈${v}`).join(", ") : "",
    ].filter(Boolean).join("; ");
    console.log(`\n-- conditioned on observation --`);
    console.log(`observation: ${shownObs}`);
    console.log(`effective worlds: ${post.effectiveSampleSize.toFixed(0)} of ${trials} (fit ${(post.fit * 100).toFixed(0)}%)`);
    console.log(`cooperation: ${(result.cooperation.mean * 100).toFixed(0)}% → ${(post.cooperation.mean * 100).toFixed(0)}%`);
    console.log(`${(usesTeams ? "team" : "player").padEnd(14)} baseline  posterior`);
    for (const [name] of Object.entries(postWin).sort(([, a], [, b]) => b - a)) {
      console.log(`  ${name.padEnd(12)} ${(baseWin[name] ?? 0).toFixed(0).padStart(5)}%   ${postWin[name]!.toFixed(0).padStart(5)}%`);
    }
    console.log(`most likely disposition (posterior):`);
    for (const [player, row] of Object.entries(post.strategyPosterior)) {
      const top = Object.entries(row).sort(([, a], [, b]) => b - a).slice(0, 3).map(([s, p]) => `${s} ${(p * 100).toFixed(0)}%`).join(", ");
      console.log(`  ${player.padEnd(12)} ${top}`);
    }
    process.exit(0);
  }
  const out: Record<string, unknown> = { winPct: result.winPct, winPctTeam: result.winPctTeam, winPctPerCapita: result.winPctPerCapita, cooperation: result.cooperation, sensitivity: result.sensitivity, sensitivityWin: result.sensitivityWin, sensitivityWinTarget: result.sensitivityWinTarget, ...(result.environment ? { environment: result.environment } : {}), ...(result.stateOccupancy ? { stateOccupancy: result.stateOccupancy } : {}) };
  console.log(JSON.stringify(out, null, 2));
}
