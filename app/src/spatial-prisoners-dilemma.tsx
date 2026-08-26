import { useCallback, useEffect, useRef, useState, type ChangeEvent } from "react";

const N = 60;
const CELL = 6;
const STEP_INTERVAL = 280;
const COOP = 0;
const DEFECT = 1;

const COLORS = {
  stayC: "var(--good)",
  stayD: "var(--bad)",
  toC: "var(--muted-strong)",
  toD: "var(--accent)",
} as const;

const wrap = (value: number) => (value + N) % N;
const index = (x: number, y: number) => wrap(y) * N + wrap(x);

export function SpatialPrisonersDilemma() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simulation = useRef({
    grid: new Uint8Array(N * N),
    previous: new Uint8Array(N * N),
    score: new Float32Array(N * N),
  });
  const temptationRef = useRef(1.85);
  const playingRef = useRef(true);
  const animationRef = useRef<number>(0);
  const lastFrameRef = useRef(0);

  const [temptation, setTemptation] = useState(1.85);
  const [playing, setPlaying] = useState(true);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const color = (name: string) => getComputedStyle(canvas).getPropertyValue(name).trim();
    const colors = {
      stayC: color("--good"),
      stayD: color("--bad"),
      toC: color("--muted-strong"),
      toD: color("--accent"),
    };
    const { grid, previous } = simulation.current;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cell = index(x, y);
        const current = grid[cell];
        const before = previous[cell];
        context.fillStyle = current === COOP
          ? before === COOP ? colors.stayC : colors.toC
          : before === DEFECT ? colors.stayD : colors.toD;
        context.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }, []);

  const reset = useCallback(() => {
    const state = simulation.current;
    for (let cell = 0; cell < state.grid.length; cell++) {
      state.grid[cell] = Math.random() < 0.5 ? COOP : DEFECT;
      state.previous[cell] = state.grid[cell];
    }
    draw();
  }, [draw]);

  const step = useCallback(() => {
    const state = simulation.current;
    const { grid, score } = state;
    const temptation = temptationRef.current;

    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let total = 0;
        const strategy = grid[index(x, y)];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const neighbor = grid[index(x + dx, y + dy)];
            total += strategy === COOP ? neighbor === COOP ? 1 : 0 : neighbor === COOP ? temptation : 0;
          }
        }
        score[index(x, y)] = total;
      }
    }

    const next = new Uint8Array(grid.length);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let bestScore = score[index(x, y)];
        let bestStrategy = grid[index(x, y)];
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const neighbor = index(x + dx, y + dy);
            if (score[neighbor] > bestScore) {
              bestScore = score[neighbor];
              bestStrategy = grid[neighbor];
            }
          }
        }
        next[index(x, y)] = bestStrategy;
      }
    }

    state.previous.set(grid);
    grid.set(next);
  }, []);

  useEffect(() => {
    reset();
    const loop = (time: number) => {
      if (playingRef.current && time - lastFrameRef.current > STEP_INTERVAL) {
        step();
        draw();
        lastFrameRef.current = time;
      }
      animationRef.current = requestAnimationFrame(loop);
    };
    animationRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw, reset, step]);

  const onTemptationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = Number.parseFloat(event.target.value);
    temptationRef.current = value;
    setTemptation(value);
  };

  const togglePlaying = () => {
    const next = !playingRef.current;
    playingRef.current = next;
    setPlaying(next);
  };

  return (
    <div className="spd">
      <header className="spd__intro">
        <span className="eyebrow">A living game</span>
        <h2>A small society learns whom to trust</h2>
        <p>Each square plays with its eight neighbors. Successful behavior spreads, turning local choices into waves across the whole society.</p>
      </header>

      <canvas
        ref={canvasRef}
        width={N * CELL}
        height={N * CELL}
        className="spd__canvas"
        aria-label="Spatial prisoner's dilemma simulation"
      />

      <div className="spd__legend" aria-label="Simulation legend">
        <Chip color={COLORS.stayC} label="cooperates" />
        <Chip color={COLORS.stayD} label="defects" />
        <Chip color={COLORS.toC} label="changed to trust" />
        <Chip color={COLORS.toD} label="changed to betray" />
      </div>

      <div className="spd__controls">
        <div className="spd__actions">
          <button type="button" onClick={togglePlaying}>{playing ? "Pause" : "Play"}</button>
          <button type="button" onClick={reset}>Start over</button>
        </div>
        <label className="spd__temptation">
          <span>Temptation to betray</span>
          <input type="range" min={1.4} max={2.2} step={0.01} value={temptation} onChange={onTemptationChange} />
          <b>{temptation.toFixed(2)}</b>
        </label>
      </div>
    </div>
  );
}

function Chip({ color, label }: { color: string; label: string }) {
  return <span className="spd__chip"><span className="spd__swatch" style={{ background: color }} />{label}</span>;
}
