import React from "react";
import { readFileSync, writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RiverActivity } from "./app/src/river-activity";

/**
 * Scratch: drainage networks, the way the Python sketch does it, but on the sphere and in TS.
 * Terrain -> steepest descent -> flow accumulation -> channels whose width follows how much drains
 * through them. No Bézier guesswork: the confluences come out of the field, not out of a random walk.
 * One parameter set per planet. The winner moves into river-activity.tsx and the rest is deleted.
 */

const R = 24, CX = 32, CY = 32;
const LON = 168, LAT = 84;        // equirectangular cells; only the front half is ever drawn

type V3 = [number, number, number];

// ── 3D value noise, so the terrain has no seam and no pole pinch ────────────────────────────────
function hash(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x, 92837111) ^ Math.imul(y, 689287499) ^ Math.imul(z, 283923481) ^ Math.imul(seed, 374761393);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function noise3([x, y, z]: V3, seed: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
  const corner = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz, seed);
  return mix(
    mix(mix(corner(0, 0, 0), corner(1, 0, 0), u), mix(corner(0, 1, 0), corner(1, 1, 0), u), v),
    mix(mix(corner(0, 0, 1), corner(1, 0, 1), u), mix(corner(0, 1, 1), corner(1, 1, 1), u), v),
    w);
}

function fbm(p: V3, seed: number, octaves = 5, frequency = 2.2) {
  let sum = 0, amplitude = 1, total = 0, f = frequency;
  for (let i = 0; i < octaves; i++) {
    sum += noise3([p[0] * f, p[1] * f, p[2] * f], seed + i * 101) * amplitude;
    total += amplitude;
    amplitude *= 0.5;
    f *= 2;
  }
  return sum / total;
}

// ── the grid ────────────────────────────────────────────────────────────────────────────────────
const cells: V3[] = [];
for (let row = 0; row < LAT; row++) {
  const theta = ((row + 0.5) / LAT) * Math.PI;
  for (let col = 0; col < LON; col++) {
    const phi = (col / LON) * Math.PI * 2;
    cells.push([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]);
  }
}
const distance = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

type Options = { seed: number; warp: number; threshold: number; width: number };
type Reach = { d: string; width: number; alpha: number };

function drainage({ seed, warp, threshold, width }: Options): Reach[] {
  // 1. terrain: fbm, domain-warped so valleys meander instead of running straight downhill
  const height = cells.map((p) => {
    if (warp === 0) return fbm(p, seed);
    const q: V3 = [p[0] + warp * fbm(p, seed + 7, 3), p[1] + warp * fbm(p, seed + 23, 3), p[2] + warp * fbm(p, seed + 41, 3)];
    return fbm(q, seed);
  });

  // 2. steepest descent. Slope uses the real 3D distance between cells, so the longitude squeeze
  //    near the poles does not pull every river into them.
  const receiver = new Int32Array(cells.length).fill(-1);
  for (let row = 0; row < LAT; row++) {
    for (let col = 0; col < LON; col++) {
      const index = row * LON + col;
      let best = -1, steepest = 0;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const r = row + dr;
          if (r < 0 || r >= LAT) continue;
          const other = r * LON + (col + dc + LON) % LON;
          const slope = (height[index] - height[other]) / distance(cells[index], cells[other]);
          if (slope > steepest) { steepest = slope; best = other; }
        }
      }
      receiver[index] = best;   // -1 = a pit, the river ends there
    }
  }

  // 3. flow accumulation: hand every cell's water down the slope, highest ground first
  const flow = new Float32Array(cells.length).fill(1);
  const order = [...height.keys()].sort((a, b) => height[b] - height[a]);
  for (const index of order) if (receiver[index] >= 0) flow[receiver[index]] += flow[index];

  // 4. the channels are the cells that carry enough water; walk each head downstream, stopping where
  //    an earlier reach already runs, so a confluence is drawn once and the trunk keeps its width
  const isChannel = (index: number) => flow[index] >= threshold;
  const drawn = new Uint8Array(cells.length);
  const heads = order.filter(isChannel);   // highest first, so trunks are reached from their sources
  const reaches: Reach[] = [];
  const maxFlow = Math.max(...flow);

  for (const head of heads) {
    if (drawn[head]) continue;
    const chain: number[] = [];
    let index = head;
    while (index >= 0 && isChannel(index) && !drawn[index]) {
      drawn[index] = 1;
      chain.push(index);
      index = receiver[index];
    }
    if (index >= 0 && isChannel(index)) chain.push(index);   // meet the trunk, do not leave a gap
    if (chain.length < 3) continue;

    // 5. cut the chain into short runs so the stroke can thicken downstream
    for (let start = 0; start < chain.length - 1; start += 6) {
      const run = chain.slice(start, Math.min(start + 7, chain.length));
      if (run.length < 2) continue;
      const carried = run.reduce((sum, cell) => sum + flow[cell], 0) / run.length;
      for (const [d, z] of frontPaths(run.map((cell) => cells[cell]))) {
        reaches.push({
          d,
          width: +(width * (0.16 + 0.84 * Math.sqrt(carried / maxFlow))).toFixed(2),
          alpha: +(0.35 + 0.6 * z).toFixed(2),
        });
      }
    }
  }
  return reaches;
}

// ── projection ──────────────────────────────────────────────────────────────────────────────────
const project = (p: V3): [number, number] => [CX + p[0] * R, CY - p[1] * R];

function meander(points: [number, number][]) {
  const n = (value: number) => value.toFixed(2);
  let d = `M${n(points[0][0])} ${n(points[0][1])}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i], [nx, ny] = points[i + 1];
    d += `Q${n(x)} ${n(y)} ${n((x + nx) / 2)} ${n((y + ny) / 2)}`;
  }
  const [lx, ly] = points[points.length - 1];
  return `${d}L${n(lx)} ${n(ly)}`;
}

/** Split at the limb; each front-facing run becomes a path, tagged with its mean facing. */
function frontPaths(points: V3[]): [string, number][] {
  const runs: V3[][] = [];
  let run: V3[] = [];
  for (const p of points) { if (p[2] > 0.06) run.push(p); else { if (run.length > 2) runs.push(run); run = []; } }
  if (run.length > 2) runs.push(run);
  return runs.map((r) => [meander(r.map(project)), r.reduce((sum, p) => sum + p[2], 0) / r.length]);
}

const strokes = (reaches: Reach[]) => reaches.map((reach, index) => <path key={index} d={reach.d} fill="none" stroke="#fff" strokeWidth={reach.width} strokeOpacity={reach.alpha} strokeLinecap="round" strokeLinejoin="round" />);

const variants: [string, Options][] = [
  ["1 · trunks only (threshold 90)", { seed: 3, warp: 0.35, threshold: 90, width: 1.5 }],
  ["2 · dense network (threshold 18)", { seed: 3, warp: 0.35, threshold: 18, width: 1.1 }],
  ["3 · strong meanders (warp 0.9)", { seed: 3, warp: 0.9, threshold: 30, width: 1.3 }],
  ["4 · no warp, threshold 30", { seed: 3, warp: 0, threshold: 30, width: 1.3 }],
];

const rendered = variants.map(([name, options]) => {
  const reaches = drainage(options);
  return [name, reaches.length, <>{strokes(reaches)}</>] as const;
});

const css = readFileSync("./app/src/styles.css", "utf8");
writeFileSync("./loader-preview.html", `<!doctype html><meta charset="utf-8"><style>${css}
body { background: #171717; margin: 0; padding: 16px; display: flex; flex-wrap: wrap; gap: 20px; align-items: flex-start }
figure { margin: 0; width: 240px }
figcaption { margin-top: 6px; color: #9a9a9a; font: 11px/1.4 -apple-system, system-ui, sans-serif }
figure .river-orbit { width: 240px; height: 240px }
figure .river-activity > div { display: none }</style>
${rendered.map(([name, count, surface]) => `<figure>${renderToStaticMarkup(<RiverActivity label={name} surface={surface} />)}<figcaption>${name} — ${count} paths</figcaption></figure>`).join("")}
<div>${renderToStaticMarkup(<RiverActivity label="Building the worlds" detail="Turning the facts into a model" surface={rendered[1][2]} />)}
${renderToStaticMarkup(<RiverActivity compact label="Reading your message" detail="Deciding whether to answer" surface={rendered[1][2]} />)}</div>`);
