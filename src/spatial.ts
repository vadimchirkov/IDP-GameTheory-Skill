import type { Move, Payoff } from "./domain.js";
import { score } from "./domain.js";
import { Rng } from "./rng.js";

export type Grid = Move[][];
export type UpdateRule = "imitate-best" | "fermi";

export function createGrid(size: number, fill: Move | ((r:number,c:number)=>Move)): Grid {
  return Array.from({length:size}, (_,r)=> Array.from({length:size}, (_,c)=> typeof fill==="function" ? (fill as any)(r,c) : fill));
}

function neighbours(r:number,c:number,size:number): [number,number][] {
  return [[r-1,c],[r+1,c],[r,c-1],[r,c+1]].map((p)=> [((p[0] as number)+size)%size, ((p[1] as number)+size)%size] as [number,number]);
}

function totalScore(grid:Grid, r:number,c:number, payoff:Payoff): number {
  const me = grid[r]?.[c] ?? "C";
  let s=0;
  for(const [rr,cc] of neighbours(r,c,grid.length)) {
    const nr = rr as number; const nc = cc as number;
    s+= score(payoff, me, grid[nr]?.[nc] ?? "C");
  }
  return s;
}

export function stepSpatial(grid:Grid, payoff:Payoff, rule:UpdateRule, rng:Rng, K=0.1): Grid {
  const n=grid.length;
  const scores = Array.from({length:n}, (_,r)=> Array.from({length:n}, (_,c)=> totalScore(grid,r,c,payoff)));
  const next: Grid = grid.map(row=> [...row]);
  for(let r=0;r<n;r++) for(let c=0;c<n;c++){
    const neigh = [...neighbours(r,c,n), [r,c] as [number,number]];
    if(rule==="imitate-best"){
      let best=neigh[0]!; let bestScore=scores[best[0]]?.[best[1]] ?? -Infinity;
      for(const [rr,cc] of neigh){ const s=scores[rr]?.[cc] ?? -Infinity; if(s>bestScore){bestScore=s; best=[rr,cc];}}
      next[r]![c] = grid[best[0]]?.[best[1]] ?? "C";
    } else {
      const [rr,cc]= rng.pick(neigh.slice(0,4));
      const myScore=scores[r]?.[c] ?? 0; const otherScore=scores[rr]?.[cc] ?? 0;
      const prob = 1/(1+Math.exp((myScore - otherScore)/K));
      if(rng.unit() < prob) next[r]![c]= grid[rr]?.[cc] ?? "C";
    }
  }
  return next;
}

export function coopRate(grid:Grid): number {
  const n=grid.length; let c=0; for(const row of grid) for(const v of row) if(v==="C") c+=1; return c/(n*n);
}

export function clusterCount(grid:Grid): number {
  const n=grid.length; const vis=Array.from({length:n},()=>Array(n).fill(false)); let clusters=0;
  const bfs=(sr:number,sc:number, val:Move)=>{
    const q:[[number,number]]=[[sr,sc]]; vis[sr]![sc]=true;
    while(q.length){ const [r,c]=q.shift()!; for(const [rr,cc] of neighbours(r,c,n)) if(!vis[rr]![cc] && grid[rr]?.[cc]===val){vis[rr]![cc]=true; q.push([rr,cc]);}}
  };
  for(let r=0;r<n;r++) for(let c=0;c<n;c++) if(!vis[r]![c] && grid[r]?.[c]==="C"){ clusters+=1; bfs(r,c,"C"); }
  return clusters;
}
