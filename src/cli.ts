import { readFile } from "node:fs/promises";
import { analyzeScenario, scenarioReport } from "./analysis.js";
import type { ScenarioModel } from "./domain.js";

const args = process.argv.slice(2);
const path = args[0];
if (!path) {
  console.error("Usage: pnpm scenario <model.json> [trials] [--seed N]");
  process.exitCode = 1;
} else {
  const trials = Number(args[1] ?? 600);
  const seedIndex = args.indexOf("--seed");
  const seed = seedIndex >= 0 ? Number(args[seedIndex + 1]) : 42;
  const model = JSON.parse(await readFile(path, "utf8")) as ScenarioModel;
  const result = analyzeScenario(model, trials, seed);
  console.log(scenarioReport(result));
  console.log(JSON.stringify({ winPct: result.winPct, cooperation: result.cooperation, sensitivity: result.sensitivity }, null, 2));
}
