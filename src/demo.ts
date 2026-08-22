import { analyzeScenario, scenarioReport } from "./analysis.js";
import type { ScenarioModel } from "./domain.js";

const model: ScenarioModel = {
  situation: "Two firms decide whether to honour a data-sharing pact.",
  players: [
    { name: "Northwind", dispositions: ["provocable", "forgiving", "exploitative"] },
    { name: "Kestrel", dispositions: ["provocable", "grim"] },
  ],
  payoffs: { T: [4, 6], R: [3, 4], P: [1, 2], S: [-1, 1] },
  structure: { w: [0.6, 0.97], noise: [0, 0.15] },
};

console.log(scenarioReport(analyzeScenario(model, 600, 42)));
