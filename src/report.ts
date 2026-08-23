import type { PayoffRanges, ScenarioModel } from "./domain.js";
import { analyzeScenario, samplePayoff } from "./analysis.js";
import { createGrid, stepSpatial, coopRate, clusterCount, type Grid } from "./spatial.js";
import { Rng } from "./rng.js";

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

export interface VisualFrame { gen:number; grid:Grid; coop:number; clusters:number; }
export function generateSpatialFrames(model: ScenarioModel, seed=42, gens=120, size=30, rule: "imitate-best"|"fermi" = "imitate-best"): VisualFrame[] {
  const rng = new Rng(seed);
  const shared = model.payoffs as Partial<PayoffRanges>;
  const ranges = shared.T !== undefined ? model.payoffs as PayoffRanges : Object.values(model.payoffs as Record<string, PayoffRanges>)[0];
  if (!ranges) throw new Error("Model has no payoff ranges");
  const payoff = samplePayoff(ranges, model.game ?? "prisoners_dilemma", rng);
  const noise = model.structure.noise ? (model.structure.noise[0]+model.structure.noise[1])/2 : 0.02;
  let grid = createGrid(size, () => rng.unit()<0.5 ? "C":"D");
  if(model.topology?.type==="small_world"){ for(let r=0;r<size;r++) for(let c=0;c<size;c++) if(rng.unit()<0.08) grid[r]![c]= rng.unit()<0.5?"C":"D"; }
  const frames: VisualFrame[] = [];
  frames.push({gen:0, grid:grid.map(r=>[...r]), coop:coopRate(grid), clusters:clusterCount(grid)});
  for(let g=1; g<gens; g++){
    if(noise>0 && rng.unit()<noise*2){ const rr=Math.floor(rng.unit()*size), cc=Math.floor(rng.unit()*size); grid[rr]![cc]= grid[rr]![cc]==="C"?"D":"C"; }
    grid = stepSpatial(grid, payoff, rule, rng, model.topology?.K ?? 0.1);
    frames.push({gen:g, grid:grid.map(r=>[...r]), coop:coopRate(grid), clusters:clusterCount(grid)});
  }
  return frames;
}

export function generateVisual(model: ScenarioModel, seed=42): string {
  const frames = generateSpatialFrames(model, seed, 120, 32, "imitate-best");
  const heatSteps=6;
  const wVals = Array.from({length:heatSteps}, (_,i)=> 0.5 + 0.49*i/(heatSteps-1));
  const nVals = Array.from({length:heatSteps}, (_,i)=> 0.0 + 0.15*i/(heatSteps-1));
  const heatGrid: number[][] = [];
  for(const w of wVals){ const row:number[]=[]; for(const n of nVals){ const m: ScenarioModel={...model, structure:{w:[w,w] as const, noise:[n,n] as const, ...(model.structure.drift?{drift:model.structure.drift}:{})}}; const r=analyzeScenario(m, 24, seed); row.push(r.cooperation.mean);} heatGrid.push(row); }
  const payload = { situation: model.situation, game: model.game ?? "prisoners_dilemma", players: model.players, structure: model.structure, payoffs: model.payoffs, wVals, nVals, heatGrid, seed, seedFrames: frames.map(f=> ({gen:f.gen, coop:f.coop, bits:f.grid.map(r=> r.map(v=> v==="C"?1:0))})) };
  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Что будет с договорённостями — визуальный разбор</title>
<script src="https://cdn.plot.ly/plotly-2.27.0.min.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box} html{scroll-behavior:smooth}
body{margin:0;font-family:Inter,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;background:#fcfbf8;color:#1a1a1a;line-height:1.5}
.serif{font-family:"Instrument Serif",Georgia,serif}
.wrap{max-width:1160px;margin:0 auto;padding:20px 16px}
.hero{display:grid;grid-template-columns:1.15fr 0.85fr;gap:18px;align-items:start}
@media(max-width:900px){.hero{grid-template-columns:1fr}}
.card{background:white;border:1px solid #e7e0d6;border-radius:18px;overflow:hidden;box-shadow:0 4px 18px rgba(26,26,26,0.06)}
.card.pad{padding:16px}
.kicker{font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#8a7f6e}
h1{font-size:30px;line-height:0.95;letter-spacing:-0.03em;margin:6px 0 0}
h1 i{font-style:italic;color:#b45309}
.lead{font-size:14px;color:#4a463f;margin:10px 0 0;line-height:1.6}
.verdict{margin-top:14px;background:#1a1a1a;color:#fff;border-radius:14px;padding:14px 14px 12px}
.verdict b{font-size:14px;line-height:1.4;display:block}
.verdict span{font-size:12px;opacity:0.8;display:block;margin-top:6px;line-height:1.5}
.miniMeta{font-size:11px;color:#8a7f6e;margin-top:10px;display:flex;gap:10px;flex-wrap:wrap}
.miniMeta span{background:#f5f1eb;padding:4px 8px;border-radius:999px;border:1px solid #e7e0d6}
.boardWrap{position:relative;background:#f5f1eb}
canvas{display:block;width:100%;height:auto;aspect-ratio:1;cursor:crosshair}
.overlay{position:absolute;left:10px;top:10px;display:flex;gap:8px;flex-wrap:wrap}
.chip{background:rgba(255,255,255,0.92);backdrop-filter:blur(6px);border:1px solid #e7e0d6;padding:7px 10px;border-radius:999px;font-size:12px;display:flex;align-items:center;gap:8px;box-shadow:0 2px 10px rgba(0,0,0,0.08)}
.chip strong{font-size:14px}
.controls{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #f0e9de;flex-wrap:wrap;background:white}
.btn{border:1px solid #e7e0d6;background:white;padding:8px 12px;border-radius:999px;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.btn.pri{background:#1a1a1a;color:white;border-color:#1a1a1a}
.btn:active{transform:translateY(1px)}
input[type=range]{accent-color:#1a1a1a}
.legend{display:flex;flex-wrap:wrap;gap:8px;padding:10px 12px;font-size:11px;color:#6b6256;align-items:center;border-top:1px solid #f0e9de;background:#fcfbf8}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;border:1px solid rgba(0,0,0,0.08)}
.section{margin-top:14px}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:900px){.grid2{grid-template-columns:1fr}}
.h2{font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:#8a7f6e;margin:0 0 8px}
.plot{height:190px}
.small{font-size:11px;color:#8a7f6e}
details{border:1px solid #e7e0d6;border-radius:14px;background:white;overflow:hidden}
summary{list-style:none;cursor:pointer;padding:12px 14px;font-size:13px;display:flex;justify-content:space-between;align-items:center}
summary::-webkit-details-marker{display:none}
.divider{height:1px;background:#f0e9de}
.hint{font-size:12px;color:#6b6256;background:#fffbeb;border:1px solid #fde68a;padding:8px 10px;border-radius:10px}
</style>
<div class="wrap">
  <div class="hero">
    <div>
      <div class="kicker">Визуальный разбор · игра повторяется</div>
      <h1 class="serif">Что будет с <i>договорённостями,</i><br>когда все снова встретятся?</h1>
      <p class="lead" id="lead"></p>
      <div class="verdict" id="verdict">
        <b id="vTitle">—</b>
        <span id="vText">—</span>
      </div>
      <div class="miniMeta" id="meta"></div>
      <div class="hint" id="actionHint" style="margin-top:10px">Подсказка появится по ходу игры →</div>
    </div>
    <div class="card boardWrap">
      <div style="position:relative">
        <canvas id="board" width="640" height="640"></canvas>
        <div class="overlay">
          <span class="chip"><span style="width:8px;height:8px;border-radius:50%;background:#0ea5e9;display:inline-block"></span><strong id="oCoop">—</strong> доверие</span>
          <span class="chip"><strong id="oGen">0</strong> ход</span>
          <span class="chip" id="oExtra">—</span>
        </div>
      </div>
      <div class="controls">
        <button class="btn pri" id="play">▶ Играть</button>
        <button class="btn" id="step">Шаг</button>
        <input id="scrub" type="range" min="0" max="119" value="0" style="flex:1;min-width:90px">
        <span class="small"><span id="cur">0</span>/<span id="max">119</span></span>
        <label class="small" style="display:flex;align-items:center;gap:6px">темп <input id="speed" type="range" min="40" max="320" value="120" style="width:70px"></label>
        <button class="btn" id="reset">↻</button>
      </div>
      <div class="legend" id="legend"></div>
    </div>
  </div>

  <div class="section grid2">
    <div class="card pad">
      <div class="h2">Как меняется доверие — потяни время</div>
      <div id="mainPlot" class="plot"></div>
      <div class="small" id="plotCap" style="margin-top:6px">Синяя линия — доля тех, кто держит слово. Точка — где ты сейчас на доске.</div>
    </div>
    <div class="card pad">
      <div class="h2">Кто сейчас задаёт тон — кликни на цвет</div>
      <div id="shareBar" style="height:14px;border-radius:999px;overflow:hidden;display:flex;border:1px solid #e7e0d6"></div>
      <div id="shareLabels" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px"></div>
      <div class="small" id="shareNote" style="margin-top:8px">Наведи на сегмент — подсветятся клетки на поле.</div>
      <div id="subPlot" class="plot" style="height:110px;margin-top:10px;border-top:1px solid #f0e9de;padding-top:8px"></div>
    </div>
  </div>

  <details class="section" id="deep">
    <summary><span><b>Погрузиться глубже</b> <span class="small">— ставки, характеры, память, ошибки</span></span><span class="small">раскрыть →</span></summary>
    <div style="padding:12px 14px;display:grid;gap:14px">
      <div style="display:grid;grid-template-columns:1.1fr 0.9fr;gap:14px">
        <div>
          <div class="h2">Ставки — что на кону</div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <label class="small" style="display:flex;flex-direction:column;gap:4px">Оба держат (R) <input id="inCC" type="number" step="0.5" value="3" style="padding:8px;border:1px solid #e7e0d6;border-radius:10px"></label>
            <label class="small" style="display:flex;flex-direction:column;gap:4px">Ты держишь, тебя кинули (S) <input id="inCD" type="number" step="0.5" value="0" style="padding:8px;border:1px solid #e7e0d6;border-radius:10px"></label>
            <label class="small" style="display:flex;flex-direction:column;gap:4px">Ты кинул, они держат (T) <input id="inDC" type="number" step="0.5" value="5" style="padding:8px;border:1px solid #e7e0d6;border-radius:10px"></label>
            <label class="small" style="display:flex;flex-direction:column;gap:4px">Оба кинули (P) <input id="inDD" type="number" step="0.5" value="1" style="padding:8px;border:1px solid #e7e0d6;border-radius:10px"></label>
          </div>
          <div style="display:flex;gap:6px;margin-top:8px">
            <button class="btn" id="btnPD" style="font-size:11px">Картель (PD)</button>
            <button class="btn" id="btnChicken" style="font-size:11px">Блеф (Chicken)</button>
            <button class="btn" id="btnStag" style="font-size:11px">Команда (Stag)</button>
            <span id="gameLbl" style="font-size:11px;background:#fef3c7;padding:6px 8px;border-radius:999px">PD</span>
          </div>
          <div class="small" style="margin-top:6px">Для не-технарей: это просто «насколько сладко кинуть» (T), «как больно быть кинутым» (S) и «что если все кидают» (P). Пресеты задают классические сюжеты.</div>
        </div>
        <div>
          <div class="h2">Характеры — кто в поле</div>
          <div id="stratGrid" style="display:flex;flex-wrap:wrap;gap:6px"></div>
          <div class="small" style="margin-top:6px">5 архетипов для старта (человечно), 16 — если включишь. Клик — вкл/выкл. Мутация идёт только на 1-бит соседей.</div>
          <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label class="small" style="background:#fcfbf8;border:1px solid #f0e9de;border-radius:10px;padding:8px">Память обид <b id="payMemV">1</b><input id="payMem" type="range" min="1" max="8" value="1" style="width:100%"></label>
            <label class="small" style="background:#fcfbf8;border:1px solid #f0e9de;border-radius:10px;padding:8px">Ошибки/шум <b id="pMutV">0.001</b><input id="pMut" type="range" min="0" max="0.05" step="0.001" value="0.001" style="width:100%"></label>
          </div>
          <div class="row" style="margin-top:8px;display:flex;gap:6px;align-items:center">
            <span class="small">Поле</span><select id="sizeSel" style="padding:6px;border:1px solid #e7e0d6;border-radius:8px"><option value="32">32</option><option value="64" selected>64</option><option value="80">80</option></select>
            <span class="small">Правило</span><select id="rule" style="padding:6px;border:1px solid #e7e0d6;border-radius:8px"><option value="imitate">подражание лучшим (N5)</option><option value="fermi">мягкое (fermi)</option></select>
          </div>
        </div>
      </div>
      <div class="divider"></div>
      <div id="heat" style="height:220px"></div>
      <div class="small">Heatmap — чувствительность к тени будущего (w) и шуму. Смотри только если хочешь понять, что ломает доверие.</div>
    </div>
  </details>

  <div class="small" style="text-align:center;margin-top:14px;color:#8a7f6e">Поле — метафора сети договорённостей. Синее = держат слово, розовое = срывают. Кластеры — кварталы доверия. Нажми «Играть» и тяни время.<br><b>Это песочница, а не результат разбора:</b> она играет 16 простых стратегий «по последнему ходу» на решётке соседей, тогда как вывод сверху считается по вашим игрокам в round-robin. Совпадение направления — хороший знак, точных чисел от неё ждать не нужно.</div>
</div>
<script>
const DATA=${JSON.stringify(payload)};
const HUMAN={0:{n:"Доверчивый",d:"всегда держит"}, 1:{n:"Наивный+",d:"почти всегда"}, 5:{n:"Ответный",d:"как ты — так и я (TFT)"}, 6:{n:"Гибкий",d:"учюсь на ошибках (WSLS)"}, 7:{n:"Злопамятный",d:"долго помнит срыв"}, 10:{n:"Хитрец",d:"давит слабых"}, 15:{n:"Циник",d:"всегда рвёт"}};
const PALETTE=["#e11d48","#2563eb","#16a34a","#9333ea","#ea580c","#eab308","#0e7490","#f43f5e","#6b7280","#14b8a6","#f97316","#6366f1","#ec4899","#84cc16","#f59e0b","#78716c"];
const ARCHETYPES=[0,5,6,7,15]; // старт — 5 человечных
function stratChoices(n){ const c=[]; for(let i=3;i>=0;i--) c.push((n>>i)&1); return c; }
function bitsDiff(a,b){ let d=0; for(let i=0;i<4;i++) if(a[i]!==b[i]) d++; return d; }
function gameLabel(){ const r=+inCC.value, s=+inCD.value, t=+inDC.value, p=+inDD.value; if(t>r && r>p && p>s && 2*r>t+s) return "Картель PD"; if(r>t) return "Команда Stag"; if(t>r && r>s && s>p) return "Блеф Chicken"; return "Своя игра"; }
const canvas=document.getElementById('board'), ctx=canvas.getContext('2d');
const scrub=document.getElementById('scrub'), speedEl=document.getElementById('speed'), playBtn=document.getElementById('play'), stepBtn=document.getElementById('step'), resetBtn=document.getElementById('reset');
const ruleSel=document.getElementById('rule'), sizeSel=document.getElementById('sizeSel');
const inCC=document.getElementById('inCC'), inCD=document.getElementById('inCD'), inDC=document.getElementById('inDC'), inDD=document.getElementById('inDD');
document.getElementById('lead').textContent = DATA.situation + " — смотрим, удержит ли доверие, когда встреча повторяется снова и снова.";
function getIncluded(){ return [...document.querySelectorAll('.s.on')].map(e=> +e.dataset.i).sort((a,b)=>a-b); }
function humanVerdict(coop, clusters, distinct){
  if(coop>0.72 && distinct<=4) return {t:"Доверие держится — кварталы крупные", d:"Большинство держит слово. Срывы гасятся соседями. Риск — только если шум (искажения сигналов) вырастет."};
  if(coop>0.55) return {t:"Хрупкий баланс — доверие есть, но трещины растут", d:"Синее и розовое перемешаны. Один неверно прочитанный сигнал может запустить волну срывов. Проверь, как часто вас понимают неправильно."};
  if(coop>0.32) return {t:"Доверие сыпется — циники захватывают", d:"Розовые кварталы растут. Ответные стратегии не успевают наказать срыв. Нужно снижать соблазн кинуть (T) или удлинять тень будущего."};
  return {t:"Доверие рухнуло", d:"Почти все рвут. Держать слово невыгодно — система скатилась в P (оба кинули). Меняй ставки или правила."};
}
function actionFor(coop, game){ if(game.includes("PD") && coop<0.6) return "Что проверить первым: как часто сигнал искажается и насколько сладок срыв (T)."; if(game.includes("Stag") && coop<0.6) return "Что проверить: видят ли все выгоду от общего дела (R) — без неё команда не соберётся."; if(game.includes("Chicken") ) return "Что проверить: кто первым моргнёт — блеф опасен, ищите способ показать сигнал без краха."; return "Что проверить: тень будущего (w) — чем дольше играете, тем крепче доверие."; }
// strat UI — 5 архетипов по умолчанию, кнопка раскрыть все 16
const stratGrid=document.getElementById('stratGrid');
function renderStrats(expanded=false){
  stratGrid.innerHTML="";
  const list = expanded? Array.from({length:16},(_,i)=>i) : ARCHETYPES;
  for(const i of list){
    const h=HUMAN[i]||{n:"s"+i,d: stratChoices(i).map(b=>b?"D":"C").join(" ")};
    const el=document.createElement('button'); el.className='s on'; el.dataset.i=i;
    el.innerHTML='<i style="background:'+PALETTE[i]+'"></i><span><b>'+h.n+'</b> <span style="opacity:0.6">· '+h.d+'</span></span>';
    el.onclick=()=>{ el.classList.toggle('on'); syncLegend(); if(mode==='pop') resetPop(); };
    stratGrid.appendChild(el);
  }
  const more=document.createElement('button'); more.className='s'; more.textContent= expanded? "скрыть 11 →" : "показать все 16 →"; more.onclick=()=> renderStrats(!expanded); stratGrid.appendChild(more);
}
renderStrats(false);
document.getElementById('gameLbl').textContent=gameLabel();
["inCC","inCD","inDC","inDD"].forEach(id=> document.getElementById(id).addEventListener('input', ()=>{ document.getElementById('gameLbl').textContent=gameLabel(); }));
document.getElementById('payMem').addEventListener('input', e=> document.getElementById('payMemV').textContent=e.target.value);
document.getElementById('pMut').addEventListener('input', e=> document.getElementById('pMutV').textContent=e.target.value);
document.getElementById('btnPD').onclick=()=>{ inCC.value=3; inCD.value=0; inDC.value=5; inDD.value=1; document.getElementById('gameLbl').textContent=gameLabel(); if(mode==='pop') resetPop(); };
document.getElementById('btnChicken').onclick=()=>{ inCC.value=2; inCD.value=1; inDC.value=3; inDD.value=0; document.getElementById('gameLbl').textContent=gameLabel(); if(mode==='pop') resetPop(); };
document.getElementById('btnStag').onclick=()=>{ inCC.value=5; inCD.value=0; inDC.value=3; inDD.value=1; document.getElementById('gameLbl').textContent=gameLabel(); if(mode==='pop') resetPop(); };
// Pop sim (single unified)
let mode="pop"; // single tab — сразу популяция, но с человеческим нарративом; scenario frames используются как сид?
let idx=0, timer=null, playing=false, active=DATA.seedFrames;
let pop=null, popHistory=[];
class PopSim{
  constructor(N,rewards,payMem,pMut,inc){ this.N=N; this.rewards=rewards; this.payMem=payMem; this.pMut=pMut; this.inc=inc.length?inc:ARCHETYPES; this.sc=Array.from({length:16},(_,i)=> stratChoices(i)); this.players=[]; this.games=[]; this.seed=(DATA.seed>>>0)||1; this.gen=0; this.init(); }
  rand(){ this.seed=(this.seed*1664525+1013904223)>>>0; return this.seed/4294967296; }
  init(){ this.players=[]; for(let r=0;r<this.N;r++) for(let c=0;c<this.N;c++){ const s=this.inc[Math.floor(this.rand()*this.inc.length)]; this.players.push({r,c,strat:s,recent:[],cur:0}); } this.games=[]; for(let r=0;r<this.N;r++) for(let c=0;c<this.N;c++){ const i=r*this.N+c, j1=r*this.N+((c+1)%this.N), j2=((r+1)%this.N)*this.N+c; this.games.push({a:i,b:j1,prev:[this.rand()<0.5?0:1,this.rand()<0.5?0:1]}, {a:i,b:j2,prev:[this.rand()<0.5?0:1,this.rand()<0.5?0:1]}); } this.gen=0; }
  idx(r,c){ return ((r+this.N)%this.N)*this.N+((c+this.N)%this.N); }
  play(prevOwn,prevOpp,s){ return this.sc[s][ (prevOwn<<1)|prevOpp ]; }
  step(){ let coop=0; for(const g of this.games){ const p1=this.players[g.a], p2=this.players[g.b]; const m1=this.play(g.prev[0],g.prev[1],p1.strat), m2=this.play(g.prev[1],g.prev[0],p2.strat); p1.cur+=this.rewards[(m1<<1)|m2]; p2.cur+=this.rewards[(m2<<1)|m1]; coop+=(m1===0?1:0)+(m2===0?1:0); g.prev=[m1,m2]; } for(const p of this.players){ p.recent.unshift(p.cur); if(p.recent.length>this.payMem) p.recent.pop(); p.cur=0; } const nxt=new Array(this.players.length); for(let i=0;i<this.players.length;i++){ const p=this.players[i]; if(this.rand()<this.pMut){ const cur=this.sc[p.strat]; let cand=this.inc.filter(s=> s!==p.strat && bitsDiff(cur,this.sc[s])===1); if(!cand.length) cand=this.inc.filter(s=> s!==p.strat); if(!cand.length) cand=[p.strat]; nxt[i]=cand[Math.floor(this.rand()*cand.length)]; } else { const neigh=[this.idx(p.r,p.c),this.idx(p.r-1,p.c),this.idx(p.r+1,p.c),this.idx(p.r,p.c-1),this.idx(p.r,p.c+1)]; for(let k=neigh.length-1;k>0;k--){ const j=Math.floor(this.rand()*(k+1)); const t=neigh[k]; neigh[k]=neigh[j]; neigh[j]=t; } let best=neigh[0], bestS=-1e9; for(const ni of neigh){ const s=this.players[ni].recent.reduce((a,b)=>a+b,0); if(s>bestS){ bestS=s; best=ni; } } nxt[i]=this.players[best].strat; } } for(let i=0;i<this.players.length;i++) this.players[i].strat=nxt[i]; this.gen++; const coopRate=coop/(this.games.length*2); const shares=new Array(16).fill(0); for(const p of this.players) shares[p.strat]++; return {gen:this.gen, coop:coopRate, shares:shares.map(v=>v/this.players.length), grid:this.grid()}; }
  grid(){ const g=Array.from({length:this.N},()=> Array(this.N).fill(0)); for(const p of this.players) g[p.r][p.c]=p.strat; return g; }
  snap(){ const shares=new Array(16).fill(0); for(const p of this.players) shares[p.strat]++; let coop=0; for(const p of this.players) coop+= this.sc[p.strat].filter(b=>b===0).length/4; return {gen:this.gen, coop:coop/this.players.length, shares:shares.map(v=>v/this.players.length), grid:this.grid()}; }
}
function resetPop(){ const N=+sizeSel.value, rewards=[+inCC.value,+inCD.value,+inDC.value,+inDD.value], pm=+document.getElementById('payMem').value, pM=+document.getElementById('pMut').value, inc=getIncluded(); pop=new PopSim(N,rewards,pm,pM,inc.length?inc:ARCHETYPES); popHistory=[pop.snap()]; idx=0; scrub.max=String(popHistory.length-1); document.getElementById('max').textContent=popHistory.length-1; syncLegend(); draw(); renderPlots(); }
function ensurePop(){ if(!pop) resetPop(); }
function syncLegend(){
  const leg=document.getElementById('legend'); leg.innerHTML="";
  const inc=getIncluded(); const activeStrats = new Set(popHistory[idx]?.shares.map((v,i)=> v>0?i:null).filter(v=>v!==null) ?? inc);
  (inc.length?inc:[0]).forEach(i=>{
    const h=HUMAN[i]||{n:"s"+i}; const on=activeStrats.has(i);
    const el=document.createElement('span'); el.style.opacity= on? "1":"0.35"; el.style.display="inline-flex"; el.style.alignItems="center"; el.style.gap="5px";
    el.innerHTML='<i style="width:9px;height:9px;border-radius:50%;background:'+PALETTE[i]+';display:inline-block"></i>'+h.n;
    leg.appendChild(el);
  });
  if(!inc.length) leg.textContent="включи характеры";
}
function draw(){
  ensurePop(); const snap=popHistory[idx]||popHistory[popHistory.length-1], grid=snap.grid, n=grid.length, cell=canvas.width/n;
  ctx.clearRect(0,0,canvas.width,canvas.height);
  // soft paper
  ctx.fillStyle='#f5f1eb'; ctx.fillRect(0,0,canvas.width,canvas.height);
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){ const s=grid[r][c]; ctx.fillStyle=PALETTE[s]; // slight rounding
    const x=c*cell, y=r*cell, rad=Math.min(2, cell*0.18); ctx.beginPath(); ctx.roundRect(x+0.5,y+0.5,cell-1,cell-1,rad); ctx.fill();
  }
  document.getElementById('oGen').textContent= snap.gen;
  document.getElementById('oCoop').textContent= (snap.coop*100).toFixed(0)+"%";
  const distinct=snap.shares.filter(v=>v>0).length; document.getElementById('oExtra').textContent= distinct+" типажей";
  document.getElementById('cur').textContent=idx; document.getElementById('max').textContent=popHistory.length-1;
  scrub.value=String(idx);
  // verdict human
  const v=humanVerdict(snap.coop, distinct, distinct); document.getElementById('vTitle').textContent=v.t; document.getElementById('vText').textContent=v.d; document.getElementById('actionHint').textContent= actionFor(snap.coop, gameLabel());
  // двигаем вертикальную метку без перерисовки всего графика
  const marker={type:'line', x0:idx, x1:idx, y0:0, y1:1, yref:'paper', line:{color:'#1a1a1a', width:1.2, dash:'dot'}};
  Plotly.relayout('mainPlot',{shapes:[marker]}).catch(()=>{});
  Plotly.relayout('subPlot',{shapes:[marker]}).catch(()=>{});
  updateShareBar(snap);
}
function updateShareBar(snap){
  const bar=document.getElementById('shareBar'), labels=document.getElementById('shareLabels'); bar.innerHTML=""; labels.innerHTML="";
  const sorted = snap.shares.map((v,i)=> ({v,i})).filter(o=>o.v>0.005).sort((a,b)=> b.v-a.v);
  for(const o of sorted){
    const seg=document.createElement('div'); seg.style.flex=o.v.toString(); seg.style.background=PALETTE[o.i]; seg.style.height="100%"; seg.title=(HUMAN[o.i]?.n||"s"+o.i)+" "+(o.v*100).toFixed(1)+"%"; seg.onmouseenter=()=> highlightStrat(o.i); seg.onmouseleave=()=> draw(); bar.appendChild(seg);
  }
  for(const o of sorted.slice(0,6)){
    const h=HUMAN[o.i]||{n:"s"+o.i}; const el=document.createElement('span'); el.style.fontSize="11px"; el.style.display="inline-flex"; el.style.alignItems="center"; el.style.gap="4px"; el.innerHTML='<i style="width:8px;height:8px;border-radius:50%;background:'+PALETTE[o.i]+';display:inline-block"></i>'+h.n+' '+(o.v*100).toFixed(0)+'%'; el.onmouseenter=()=> highlightStrat(o.i); el.onmouseleave=()=> draw(); labels.appendChild(el);
  }
  if(sorted.length===0) labels.textContent="пока нет доминирующих";
}
function highlightStrat(sIdx){
  const grid=popHistory[idx].grid, n=grid.length, cell=canvas.width/n;
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){ if(grid[r][c]!==sIdx){ ctx.fillStyle="rgba(245,241,235,0.72)"; ctx.fillRect(c*cell,r*cell,cell,cell); } }
}
function mkLayout(yTitle, xTitle){
  return {
    margin:{l:38,r:10,t:10,b:24}, hovermode:'x unified', hoverlabel:{bgcolor:'white', bordercolor:'#e7e0d6', font:{size:11}},
    xaxis:{title:xTitle||'', showgrid:false, zeroline:false, tickfont:{size:10}, title:{font:{size:11}}},
    yaxis:{title:yTitle, range:[0,1], tickformat:'.0%', showgrid:true, gridcolor:'#f0e9de', tickfont:{size:10}, title:{font:{size:11}}},
    shapes:[{type:'line', x0:0, x1:0, y0:0, y1:1, yref:'paper', line:{color:'#1a1a1a', width:1, dash:'dot'}, opacity:0.9}],
    paper_bgcolor:'white', plot_bgcolor:'white', showlegend:false, uirevision:'keep'
  };
}
function renderPlots(){
  ensurePop();
  const x=popHistory.map(h=>h.gen);
  const yCoop=popHistory.map(h=>h.coop);
  // subPlot — доверие (верхний маленький)
  Plotly.react('subPlot', [{x, y:yCoop, type:'scatter', mode:'lines', line:{color:'#0ea5e9', width:2.2, shape:'spline', smoothing:0.6}, fill:'tozeroy', fillcolor:'rgba(14,165,233,0.10)', hovertemplate:'доверие %{y:.0%}<extra></extra>', name:'доверие'}],
    {...mkLayout('доверие',''), xaxis:{...mkLayout('','').xaxis, showticklabels:false}, shapes:[{type:'line', x0:idx, x1:idx, y0:0, y1:1, yref:'paper', line:{color:'#1a1a1a', width:1, dash:'dot'}}], margin:{l:38,r:10,t:6,b:6}},
    {displayModeBar:false, responsive:true});
  // mainPlot — stacked shares (16 → 5 видимых, но рисуем все для суммы=1)
  const traces=Array.from({length:16},(_,i)=>{
    const y=popHistory.map(h=>h.shares[i]||0);
    const isVisible = getIncluded().includes(i);
    return {
      x, y, type:'scatter', mode:'lines', stackgroup:'one', groupnorm:'', line:{width:0.7, color:PALETTE[i]},
      fillcolor:PALETTE[i], opacity: isVisible? 0.95:0.18,
      hovertemplate: (HUMAN[i]?.n||('s'+i))+' %{y:.0%}<extra></extra>', showlegend:false
    };
  });
  Plotly.react('mainPlot', traces,
    {...mkLayout('кто в поле','ход'), shapes:[{type:'line', x0:idx, x1:idx, y0:0, y1:1, yref:'paper', line:{color:'#1a1a1a', width:1.2, dash:'dot'}}], margin:{l:38,r:10,t:8,b:24}, legend:{orientation:'h'}},
    {displayModeBar:false, responsive:true});
  // heat — только когда details открыт, иначе Plotly меряет 0px
  const heatEl=document.getElementById('heat');
  if(heatEl && document.getElementById('deep').open){
    Plotly.react('heat', [{z:DATA.heatGrid, x:DATA.nVals, y:DATA.wVals, type:'heatmap',
      colorscale:[[0,'#991b1b'],[0.35,'#fca5a5'],[0.5,'#fef3c7'],[0.75,'#7dd3fc'],[1,'#0ea5e9']], zmin:0, zmax:1,
      hovertemplate:'w %{y:.2f}<br>шум %{x:.2f}<br>доверие %{z:.0%}<extra></extra>', showscale:true, colorbar:{tickformat:'.0%', len:0.85, thickness:10}}],
      {margin:{l:44,r:40,t:6,b:28}, xaxis:{title:'шум (искажения)', tickfont:{size:10}}, yaxis:{title:'тень будущего w', tickfont:{size:10}}, paper_bgcolor:'white', plot_bgcolor:'white'}, {displayModeBar:false, responsive:true});
  }
}
canvas.addEventListener('click', (e)=>{
  ensurePop(); const rect=canvas.getBoundingClientRect(), n=pop.N, cell=rect.width/n;
  const c=Math.floor((e.clientX-rect.left)/cell), r=Math.floor((e.clientY-rect.top)/cell);
  const p=pop.players[pop.idx(r,c)]; const inc=getIncluded(); if(!inc.length) return; const j=inc.indexOf(p.strat); p.strat=inc[(j+1)%inc.length]; popHistory[idx]=pop.snap(); draw(); renderPlots();
});
scrub.addEventListener('input',()=>{ idx=+scrub.value; draw(); });
stepBtn.onclick=()=>{ ensurePop(); const s=pop.step(); popHistory.push(s); scrub.max=String(popHistory.length-1); document.getElementById('max').textContent=popHistory.length-1; idx=popHistory.length-1; draw(); if(popHistory.length%10===0) renderPlots(); };
resetBtn.onclick=()=> resetPop();
playBtn.onclick=()=>{
  playing=!playing; playBtn.textContent=playing?'⏸ Пауза':'▶ Играть';
  if(playing) timer=setInterval(()=>{ const s=pop.step(); popHistory.push(s); if(popHistory.length>420) popHistory.shift(); else idx=popHistory.length-1; scrub.max=String(popHistory.length-1); document.getElementById('max').textContent=popHistory.length-1; draw(); if(popHistory.length%12===0) renderPlots(); }, +speedEl.value); else clearInterval(timer);
};
speedEl.addEventListener('input',()=>{ if(!playing) return; clearInterval(timer); timer=setInterval(()=>{ const s=pop.step(); popHistory.push(s); idx=popHistory.length-1; scrub.max=String(popHistory.length-1); document.getElementById('max').textContent=popHistory.length-1; draw(); }, +speedEl.value); });
sizeSel.addEventListener('change',()=> resetPop());
syncLegend(); resetPop(); renderPlots(); draw();
window.addEventListener('resize', ()=>{ Plotly.Plots.resize('mainPlot'); Plotly.Plots.resize('subPlot'); if(document.getElementById('deep').open) Plotly.Plots.resize('heat'); });
document.getElementById('deep').addEventListener('toggle', ()=>{ if(document.getElementById('deep').open) setTimeout(()=>{ renderPlots(); Plotly.Plots.resize('heat'); }, 30); });
document.getElementById('payMem').addEventListener('change', ()=> renderPlots());
document.getElementById('pMut').addEventListener('change', ()=> renderPlots());
</script>
`;
  return html;
}
