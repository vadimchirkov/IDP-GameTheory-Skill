// Field for improvements: find the most profitable worlds-based strategy for Polymarket
// Goal: maximize paper profit (and secondarily Brier) on holdout markets
// What it does:
// - Splits markets/polymarket-closed:30 into train 15 / test 15 (honest, no leakage)
// - Grid-searches over: Kelly multiplier (k) for position sizing, abstain threshold (t) for edge, ensemble weight (w) Pi vs market
// - For each combo, builds trueProb = w*Pi + (1-w)*marketPrice, size = |edge|*k, ABSTAIN if edge < t
// - Scores via src/forecast.ts summarizeForecasts (Brier, paper) and src/adapters/polymarket-live.ts snapshot
// - Picks best train combo by paper, validates on holdout
// Pi handles Brier: Pi's trueProb (from pi-agent.ts) is the sole driver of Brier; worlds only tune paper (size/threshold/ensemble)
// Improve here by: wider grid, Kelly from sim variance, isotonic calibration, domain-specific w
import { readFile, readdir } from "node:fs/promises";
import { fetchPolymarketMarket, polymarketForecastSnapshot, polymarketResolution } from "../src/adapters/polymarket-live.ts";
import { appendForecastRecord, readForecastLedger } from "../src/forecast-ledger.ts";
import { summarizeForecasts } from "../src/forecast.ts";
import { rm } from "node:fs/promises";

const allFiles=(await readdir("markets/polymarket-closed")).filter(f=>f.endsWith(".json")).sort();
const filesTrain=allFiles.slice(0,15);
const filesTest=allFiles.slice(15,30);
console.log(`train ${filesTrain.length} test ${filesTest.length} total ${allFiles.length} - Pi handles Brier, worlds tune paper`);

async function bench(files, params){
  const {kellyK, abstainThresh, ensembleW}=params;
  const ledger="/tmp/best-"+Math.random().toString(36).slice(2)+".jsonl";
  try{ await rm(ledger)}catch{}
  for(const file of files){
    let spec=JSON.parse(await readFile(`markets/polymarket-closed/${file}`,"utf8"));
    const piMid=(spec.model.markets[0].trueProb[0]+spec.model.markets[0].trueProb[1])/2;
    const mMid=(spec.model.markets[0].marketPrice[0]+spec.model.markets[0].marketPrice[1])/2;
    const ensMid= ensembleW*piMid + (1-ensembleW)*mMid;
    let tpMid=ensMid;
    if(Math.abs(tpMid-mMid) < abstainThresh) tpMid=mMid;
    const tp=[Number((tpMid-0.06).toFixed(2)), Number((tpMid+0.06).toFixed(2))];
    const kellySize=Math.max(20, Math.min(300, Math.round(Math.abs(tpMid-mMid)*kellyK)));
    const newSpec={...spec, model:{...spec.model, markets:[{...spec.model.markets[0], trueProb:tp}], positions: spec.model.positions.map(p=> p.id==="abstain"?p:{...p, size:[kellySize,kellySize]})}};
    const m=await fetchPolymarketMarket(newSpec.model.markets[0].id);
    const baseline=(newSpec.model.markets[0].marketPrice[0]+newSpec.model.markets[0].marketPrice[1])/2;
    const liveOpen={...m, closed:false, active:true, yesPrice:baseline, bestBid:Math.max(0.01,baseline-0.01), bestAsk:Math.min(0.99,baseline+0.01)};
    const snap=polymarketForecastSnapshot(newSpec, liveOpen, new Date(Date.now()-3600_000).toISOString(), `best-${newSpec.model.markets[0].id}`);
    await appendForecastRecord(ledger,snap);
    const res=polymarketResolution(snap.id,m);
    if(res) await appendForecastRecord(ledger,res);
  }
  return summarizeForecasts(await readForecastLedger(ledger));
}

const grid=[];
for(const kellyK of [500,800,1200,2000]){
  for(const abstainThresh of [0.01,0.02,0.04]){
    for(const ensembleW of [0.6,0.75,0.9]){
      const s=await bench(filesTrain, {kellyK, abstainThresh, ensembleW});
      grid.push({kellyK, abstainThresh, ensembleW, paper:s.paper.totalValue, brier:s.model.brier, acc:s.model.accuracy});
      console.log(`k${kellyK} t${abstainThresh} w${ensembleW} -> paper ${s.paper.totalValue} brier ${s.model.brier.toFixed(3)}`);
    }
  }
}
grid.sort((a,b)=> b.paper - a.paper);
console.log("\n=== TOP 3 TRAIN by paper ===");
console.log(grid.slice(0,3));
const best=grid[0];
console.log(`\nbest train ${JSON.stringify(best)}`);
const testRaw=await bench(filesTest, {kellyK:800, abstainThresh:0.02, ensembleW:0.7});
const testBest=await bench(filesTest, best);
console.log(`\ntest RAW (k800 t0.02 w0.7) paper ${testRaw.paper.totalValue} brier ${testRaw.model.brier.toFixed(3)}`);
console.log(`test BEST (train best) paper ${testBest.paper.totalValue} brier ${testBest.model.brier.toFixed(3)}`);
console.log(`potential best profit train ${best.paper} test ${testBest.paper.totalValue} - worlds tune paper, Pi handles Brier`);
