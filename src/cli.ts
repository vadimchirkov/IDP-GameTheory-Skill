import { readFile, mkdir, writeFile } from "node:fs/promises";
import { analyzeScenario, scenarioReport } from "./analysis.js";
import { buildSuggestions } from "./feedback.js";
import type { ScenarioModel } from "./domain.js";

const args = process.argv.slice(2);
const path = args[0];
const buildMode = args.includes("--suggest") || args.includes("--improve") || args.includes("--build");
const evolveMode = args.includes("--evolve");
const heatmapMode = args.includes("--heatmap");
const tournamentMode = args.includes("--tournament");
if (!path) {
  console.error("Usage: pnpm scenario <model.json> [trials] [--seed N] [--suggest|--build|--evolve|--heatmap|--tournament]");
  process.exitCode = 1;
} else {
  const trialsArg = args.find(a => /^\d+$/.test(a));
  const trials = trialsArg ? Number(trialsArg) : 600;
  const seedIndex = args.indexOf("--seed");
  const seed = seedIndex >= 0 ? Number(args[seedIndex + 1]) : 42;
  const model = JSON.parse(await readFile(path, "utf8")) as ScenarioModel;
  if (tournamentMode) {
    const { runTournament } = await import("./tournament.js");
    const res = runTournament(model, 200);
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  }
  if (evolveMode) {
    const { runEvolution } = await import("./evolution.js");
    const gens = Number(args[args.indexOf("--evolve")+1] ?? 500);
    const evo = runEvolution(model, Number.isFinite(gens)?gens:500, seed);
    console.log(JSON.stringify(evo, null, 2));
    process.exit(0);
  }
  if (heatmapMode) {
    const { generateHeatmap } = await import("./report.js");
    const html = generateHeatmap(model, 10, seed);
    await mkdir("reports", { recursive:true });
    await writeFile("reports/heatmap.html", html);
    console.log("heatmap -> reports/heatmap.html");
    process.exit(0);
  }
  const result = analyzeScenario(model, trials, seed);
  console.log(scenarioReport(result));
  const out: Record<string, unknown> = { winPct: result.winPct, winPctTeam: result.winPctTeam, winPctPerCapita: result.winPctPerCapita, cooperation: result.cooperation, sensitivity: result.sensitivity };
  if (buildMode) {
    const tips = buildSuggestions(model, result);
    out.buildTips = tips;
    console.log("\n-- build suggestions --");
    for (const t of tips) console.log(`• ${t}`);
    try {
      await mkdir("reports", { recursive: true });
      const base = path.replace(/\.json$/, "");
      await writeFile(`${base}.report.json`, JSON.stringify(out, null, 2));
      await writeFile(`${base}.tips.md`, tips.map(t => `- ${t}`).join("\n") + "\n");
    } catch {}
  }
  console.log(JSON.stringify(out, null, 2));
}
