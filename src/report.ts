import type { ScenarioModel } from "./domain.js";
import { analyzeScenario } from "./analysis.js";

export function generateHeatmap(model: ScenarioModel, steps=10, seed=42): string {
  const wVals = Array.from({length:steps}, (_,i)=> 0.5 + 0.49*i/(steps-1));
  const nVals = Array.from({length:steps}, (_,i)=> 0.0 + 0.15*i/(steps-1));
  const grid: number[][] = [];
  for(const w of wVals){
    const row:number[]=[];
    for(const n of nVals){
      const m: ScenarioModel = { ...model, structure:{ w:[w,w] as const, noise:[n,n] as const, ...(model.structure.drift?{drift:model.structure.drift}:{}) } };
      const r=analyzeScenario(m, 50, seed);
      row.push(r.cooperation.mean);
    }
    grid.push(row);
  }
  const trajectory = Array.from({length:20}, (_,i)=>{
    const r=analyzeScenario(model, 1, seed+i);
    return r.cooperation.mean;
  });
  const html = `<!doctype html><meta charset="utf-8"><title>Game Theory Report</title>
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
<h2>Heatmap cooperation(w x noise)</h2><div id="heat" style="width:700px;height:500px"></div>
<h2>Trajectory</h2><div id="traj" style="width:700px;height:300px"></div>
<script>
const wVals=${JSON.stringify(wVals)}, nVals=${JSON.stringify(nVals)}, grid=${JSON.stringify(grid)}, traj=${JSON.stringify(trajectory)};
Plotly.newPlot("heat", [{z:grid, x:nVals, y:wVals, type:"heatmap", colorscale:"Viridis"}], {xaxis:{title:"noise"}, yaxis:{title:"w"}});
Plotly.newPlot("traj", [{y:traj, type:"scatter", mode:"lines+markers"}], {xaxis:{title:"trial"}, yaxis:{title:"cooperation", range:[0,1]}});
</script>`;
  return html;
}
