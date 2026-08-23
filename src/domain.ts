export type Move = "C" | "D";
/**
 * The engine plays symmetric 2x2 simultaneous games; the "game type" IS the payoff
 * ordering, nothing else branches on it. `snowdrift` is an accepted alias of
 * `chicken` — they are the same ordering (Hawk-Dove). Public-goods and trust games
 * are not 2x2 (N-player group play / sequential moves) and are deliberately absent.
 */
export type GameType = "prisoners_dilemma" | "chicken" | "stag_hunt" | "snowdrift";
export type Range = readonly [number, number];

export interface Payoff {
  T: number;
  R: number;
  P: number;
  S: number;
}

export interface PayoffRanges {
  T: Range;
  R: Range;
  P: Range;
  S: Range;
}

export interface ScenarioPlayer {
  name: string;
  dispositions: readonly StrategyId[];
  team?: string;
  values?: Range;
  /** Colluder defects on its own teammate with this probability. */
  betrayalProb?: number;
  /** Custom memory-n table `p(C | window)`; overrides the picked disposition. */
  memory?: Record<string, number>;
  /** Free-text elicitation note; ignored by the kernel. */
  note?: string;
}

const PLAYER_KEYS = new Set(["name", "dispositions", "team", "values", "betrayalProb", "memory", "note"]);
const MODEL_KEYS = new Set(["situation", "game", "players", "payoffs", "structure", "topology", "rationale"]);
const STRUCTURE_KEYS = new Set(["w", "noise", "drift", "eco", "transitions", "sigma"]);
const ECO_KEYS = new Set(["A1", "game1", "theta", "epsilon", "n0"]);
const TRANSITION_KEYS = new Set(["states", "start", "next"]);

/**
 * Eco-evolutionary feedback (Weitz et al. 2016, "An oscillating tragedy of the commons").
 * A latent environment `n ∈ [0,1]` couples to how much the pair cooperates. The payoff a
 * match actually plays is `Π(n) = (1-n)·A0 + n·A1`, where A0 is the model's own `payoffs`
 * (the healthy game, `n=0`) and `A1` is the depleted game (`n=1`, defection favoured).
 * After each round `n` moves per `dn/dt = ε·n(1-n)[θ·c - (1-c)]` (`c` = that round's
 * cooperation fraction), so cooperation and the environment chase each other — the source
 * of Weitz's limit cycles. Because linear interpolation preserves every ordering
 * inequality, sampling A0 and A1 valid once makes every intermediate Π(n) a legitimate
 * payoff matrix, so there is no mid-match re-validation.
 */
export interface EcoConfig {
  /** Depleted-state game A1 (the corner reached at `n=1`). */
  A1: PayoffRanges;
  /** Ordering A1 must satisfy (default `prisoners_dilemma`: defection dominates when depleted). */
  game1?: GameType;
  /** Cooperator enhancement of the environment (θ). Larger θ → cooperation pushes `n` up faster. */
  theta: Range;
  /** Environment speed relative to strategy (ε); >0.05 auto-sub-steps to bound Euler error. */
  epsilon: Range;
  /** Initial environment state n0 ∈ [0,1]. */
  n0: Range;
}

/** Round outcome from the edge's (symmetric) view: both cooperated, both defected, or exactly one did. */
export type Outcome = "CC" | "CD" | "DD";

/**
 * Game transitions (Su et al. PNAS 2019, "Evolution of prosocial behaviours in multilayer…").
 * A match carries a discrete game state; the round's outcome jumps it to the next state, so a
 * cooperating pair can hold a rich game alive while a defecting pair is dragged to a poor one —
 * the discrete counterpart of eco's continuous resource. Each state's matrix is validated against
 * the model's `game`, so every state shares one ordering (Su's donation-game b1 vs b2 case; the
 * cross-ordering PD↔Chicken extension of `I.4` is a future spatial branch).
 */
export interface TransitionConfig {
  /** Named game states; each matrix must satisfy the model's `game` ordering. */
  states: Record<string, PayoffRanges>;
  /** State a match opens in. */
  start: string;
  /** Where each round outcome sends the shared game state next. */
  next: Record<Outcome, string>;
}

export interface ScenarioModel {
  situation: string;
  game?: GameType;
  players: readonly ScenarioPlayer[];
  payoffs: PayoffRanges | Record<string, PayoffRanges>;
  structure: {
    w: Range; noise: Range; drift?: Range; eco?: EcoConfig; transitions?: TransitionConfig;
    /** Guaranteed per-round payoff a `loner` (voluntary opt-out) collects; required if any player can play `loner`. Cycle C→D→L→C needs `P<σ<R`. */
    sigma?: Range;
  };
  topology?: { type: "lattice" | "small_world" | "scale_free"; size?: number; K?: number };
}

export const strategyIds = [
  "provocable", "forgiving", "pavlov", "grim", "exploitative",
  "trusting", "gradual", "erratic", "prober",
  "contrite", "detective", "zd_generous", "zd_extort", "colluder",
  "adaptive", "southampton", "alld", "allc", "tf2t", "semigrim",
  "memory2", "shaper", "loner",
] as const;
export type StrategyId = (typeof strategyIds)[number];

/** `loner` opts out of the C/D game entirely and is resolved at the match level, so it has no move function. */
export const LONER: StrategyId = "loner";

export type EvolutionRule = "replicator" | "moran";
export type Shares = Record<StrategyId, number>;

export interface RunConfig {
  game: GameType;
  payoff: Payoff;
  rounds: number;
  matchReps: number;
  noise: number;
  initialShares: Partial<Shares>;
  generations: number;
  rule: EvolutionRule;
  populationSize: number;
  stepDelayMs: number;
  /** Loner opt-out payoff; required if `loner` has positive initial share. */
  sigma?: number;
}

export function isValidPayoff(game: GameType, p: Payoff): boolean {
  if (game === "chicken" || game === "snowdrift") return p.T > p.R && p.R > p.S && p.S > p.P;
  if (game === "stag_hunt") return p.R > p.T && p.T > p.P && p.P > p.S;
  return p.T > p.R && p.R > p.P && p.P > p.S && 2 * p.R > p.T + p.S;
}

export function score(payoff: Payoff, mine: Move, theirs: Move): number {
  if (mine === "C" && theirs === "C") return payoff.R;
  if (mine === "C") return payoff.S;
  return theirs === "C" ? payoff.T : payoff.P;
}

export function assertRange(range: Range, label: string, upper = Number.POSITIVE_INFINITY): void {
  if (!Number.isFinite(range[0]) || !Number.isFinite(range[1]) || range[0] > range[1] || range[0] < 0 || range[1] > upper) {
    throw new Error(`${label} must be an ordered range within 0..${upper}`);
  }
}

/** Window keys look like `CC` (memory-1) or `CC|DD` (memory-2); all keys must share one width. */
export function assertMemoryTable(table: Record<string, number>, label: string): void {
  const keys = Object.keys(table);
  if (keys.length === 0) throw new Error(`memory for ${label} must not be empty`);
  const width = keys[0]?.split("|").length ?? 0;
  for (const key of keys) {
    const parts = key.split("|");
    if (parts.length !== width) throw new Error(`memory for ${label}: key "${key}" has a different window width than "${keys[0]}"`);
    if (parts.some((pair) => !/^[CD][CD]$/.test(pair))) throw new Error(`memory for ${label}: key "${key}" is not a window of CC/CD/DC/DD pairs`);
    const p = table[key];
    if (p === undefined || !Number.isFinite(p) || p < 0 || p > 1) throw new Error(`memory for ${label}: p(C|${key}) must be a probability in 0..1`);
  }
  if (keys.length !== 4 ** width) throw new Error(`memory for ${label} must list all ${4 ** width} windows of width ${width}, got ${keys.length}`);
}

export function assertScenario(model: ScenarioModel): void {
  for (const key of Object.keys(model)) {
    if (!MODEL_KEYS.has(key)) throw new Error(`Unknown scenario field "${key}" — expected one of ${[...MODEL_KEYS].join(", ")}`);
  }
  if (model.players.length < 2) throw new Error("A scenario needs at least two players");
  for (const player of model.players) {
    if (!player.name || player.dispositions.length === 0) throw new Error("Every player needs a name and disposition");
    for (const key of Object.keys(player)) {
      if (!PLAYER_KEYS.has(key)) throw new Error(`Unknown field "${key}" for ${player.name} — expected one of ${[...PLAYER_KEYS].join(", ")}`);
    }
    if (player.dispositions.some((id) => !strategyIds.includes(id))) throw new Error(`Unknown disposition for ${player.name}`);
    if (player.values !== undefined) {
      const v = player.values;
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || v[0] > v[1] || v[0] < -1 || v[1] > 1) throw new Error(`values for ${player.name} must be an ordered range within -1..1`);
    }
    if (player.betrayalProb !== undefined && (!Number.isFinite(player.betrayalProb) || player.betrayalProb < 0 || player.betrayalProb > 1)) throw new Error(`betrayalProb for ${player.name} must be 0..1`);
    if (player.memory !== undefined) assertMemoryTable(player.memory, player.name);
  }
  for (const key of Object.keys(model.structure)) {
    if (!STRUCTURE_KEYS.has(key)) throw new Error(`Unknown structure field "${key}" — expected one of ${[...STRUCTURE_KEYS].join(", ")}`);
  }
  assertRange(model.structure.w, "w", 0.9995);
  assertRange(model.structure.noise, "noise", 1);
  if (model.structure.drift !== undefined) assertRange(model.structure.drift, "drift", 1);
  if (model.structure.sigma !== undefined) assertRange(model.structure.sigma, "sigma");
  if (model.players.some((p) => p.dispositions.includes(LONER)) && model.structure.sigma === undefined) {
    throw new Error("a player can play loner but structure.sigma (the opt-out payoff) is not set");
  }
  if (model.structure.eco !== undefined) assertEco(model);
  if (model.structure.transitions !== undefined) assertTransitions(model);
  if (model.structure.eco !== undefined && model.structure.transitions !== undefined) {
    throw new Error("eco and transitions are two encodings of a dynamic game — use one, not both");
  }
}

function assertTransitions(model: ScenarioModel): void {
  const t = model.structure.transitions!;
  for (const key of Object.keys(t)) {
    if (!TRANSITION_KEYS.has(key)) throw new Error(`Unknown transitions field "${key}" — expected one of ${[...TRANSITION_KEYS].join(", ")}`);
  }
  const shared = model.payoffs as Partial<PayoffRanges>;
  if (shared.T === undefined) throw new Error("game transitions require a shared payoff table, not per-player payoffs");
  const names = Object.keys(t.states);
  if (names.length < 2) throw new Error("transitions.states needs at least two named game states");
  for (const [name, ranges] of Object.entries(t.states)) {
    for (const key of ["T", "R", "P", "S"] as const) {
      const r = ranges[key];
      if (!Number.isFinite(r[0]) || !Number.isFinite(r[1]) || r[0] > r[1]) throw new Error(`transitions.states.${name}.${key} must be an ordered finite range`);
    }
  }
  if (!(t.start in t.states)) throw new Error(`transitions.start "${t.start}" is not a defined state`);
  for (const outcome of ["CC", "CD", "DD"] as const) {
    const dest = t.next[outcome];
    if (dest === undefined) throw new Error(`transitions.next is missing outcome "${outcome}"`);
    if (!(dest in t.states)) throw new Error(`transitions.next.${outcome} → "${dest}" is not a defined state`);
  }
  for (const key of Object.keys(t.next)) {
    if (key !== "CC" && key !== "CD" && key !== "DD") throw new Error(`transitions.next has unknown outcome "${key}" — expected CC, CD, DD`);
  }
}

function assertEco(model: ScenarioModel): void {
  const eco = model.structure.eco!;
  for (const key of Object.keys(eco)) {
    if (!ECO_KEYS.has(key)) throw new Error(`Unknown eco field "${key}" — expected one of ${[...ECO_KEYS].join(", ")}`);
  }
  const shared = model.payoffs as Partial<PayoffRanges>;
  if (shared.T === undefined) throw new Error("eco feedback requires a shared payoff table (A0), not per-player payoffs");
  // A1 entries are payoffs (S may be negative), so only require ordered finite ranges — validity is enforced at sample time.
  for (const key of ["T", "R", "P", "S"] as const) {
    const r = eco.A1[key];
    if (!Number.isFinite(r[0]) || !Number.isFinite(r[1]) || r[0] > r[1]) throw new Error(`eco.A1.${key} must be an ordered finite range`);
  }
  assertRange(eco.theta, "eco.theta", 100);
  assertRange(eco.epsilon, "eco.epsilon", 1);
  assertRange(eco.n0, "eco.n0", 1);
}

export function assertRunConfig(config: RunConfig): void {
  if (!isValidPayoff(config.game, config.payoff)) throw new Error("Payoff does not match the selected game");
  if (!Number.isInteger(config.rounds) || config.rounds < 1) throw new Error("rounds must be a positive integer");
  if (!Number.isInteger(config.matchReps) || config.matchReps < 1) throw new Error("matchReps must be a positive integer");
  if (config.noise < 0 || config.noise > 1) throw new Error("noise must be between 0 and 1");
  if (!Number.isInteger(config.generations) || config.generations < 1) throw new Error("generations must be a positive integer");
  if (!Number.isInteger(config.populationSize) || config.populationSize < 2) throw new Error("populationSize must be at least two");
  if (Object.keys(config.initialShares).length === 0) throw new Error("initialShares must not be empty");
  normalizeShares(config.initialShares);
}

export function normalizeShares(input: Partial<Shares>): Shares {
  for (const [id, value] of Object.entries(input)) {
    if (!strategyIds.includes(id as StrategyId) || value === undefined || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid share for ${id}`);
    }
  }
  const total = Object.values(input).reduce((sum, value) => sum + (value ?? 0), 0);
  if (!Number.isFinite(total) || total <= 0) throw new Error("shares must have a positive total");
  const result = Object.fromEntries(strategyIds.map((id) => [id, (input[id] ?? 0) / total])) as Shares;
  return result;
}
