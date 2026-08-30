import { readFile } from "node:fs/promises";
import { fetchPolymarketMarket, polymarketForecastSnapshot, polymarketResolution } from "../src/adapters/polymarket-live.ts";
import { appendForecastRecord, readForecastLedger } from "../src/forecast-ledger.ts";
import { summarizeForecasts } from "../src/forecast.ts";
import { rm } from "node:fs/promises";
import { readdir } from "node:fs/promises";

const ledger="/tmp/fast-gate.jsonl";
try{ await rm(ledger)}catch{}
const files=(await readdir("markets/polymarket-closed")).filter(f=>f.endsWith(".json"));
if(files.length < 30) throw new Error(`P2 gate: need 30+ fixtures, got ${files.length}`);
for(const file of files){
  const spec=JSON.parse(await readFile(`markets/polymarket-closed/${file}`,"utf8"));
  const m=await fetchPolymarketMarket(spec.model.markets[0].id);
  const baseline=(spec.model.markets[0].marketPrice[0]+spec.model.markets[0].marketPrice[1])/2;
  const liveOpen={...m, closed:false, active:true, yesPrice:baseline, bestBid:Math.max(0.01,baseline-0.01), bestAsk:Math.min(0.99,baseline+0.01)};
  const snap=polymarketForecastSnapshot(spec, liveOpen, new Date(Date.now()-3600_000).toISOString(), `gate-${spec.model.markets[0].id}`);
  await appendForecastRecord(ledger, snap);
  const res=polymarketResolution(snap.id, m);
  if(res) await appendForecastRecord(ledger,res);
}
const s=summarizeForecasts(await readForecastLedger(ledger));
console.log(JSON.stringify({fixtures:files.length, ...s},null,2));
if(s.snapshots < 30) throw new Error("gate: snapshots <30");
if(s.resolved < 30) throw new Error("gate: not all resolved");
if(s.model.brier > 0.35) throw new Error(`gate: brier ${s.model.brier} >0.35 - model worse than coin, need P1 research`);
if(s.calibration.length < 3) throw new Error("gate: calibration too sparse");
console.log("fast gate OK - 30+ closed markets, brier <0.35, calibration present");
