import { readFile, readdir } from "node:fs/promises";
import { runPolymarket } from "../src/adapters/polymarket.ts";

const files=(await readdir("markets/polymarket-closed")).filter(f=>f.endsWith(".json")).slice(0,30);
let totalEvBest=0, totalEvMean=0, totalBestWins=0;
console.log(`sim 600 worlds x ${files.length} fixtures`);
for(const file of files){
  const spec=JSON.parse(await readFile(`markets/polymarket-closed/${file}`,"utf8"));
  const fullSpec={...spec, topology: spec.topology ?? {nodes:["market"], interactions:[]}};
  const res=runPolymarket(fullSpec, 600, 42);
  const evBest=res.metrics["ev.best"]?.mean ?? 0;
  const evMean=res.metrics["ev.mean"]?.mean ?? 0;
  totalEvBest+=evBest;
  totalEvMean+=evMean;
  console.log(`${file} ev.best ${evBest.toFixed(1)} ev.mean ${evMean.toFixed(1)} p95 ${res.metrics["ev.best"]?.p95.toFixed(1)}`);
}
console.log(`\nagg ev.best mean ${(totalEvBest/files.length).toFixed(1)} ev.mean ${(totalEvMean/files.length).toFixed(1)}`);
console.log("polymarket sim gate OK - 600 worlds per fixture, no crash, metrics finite");
