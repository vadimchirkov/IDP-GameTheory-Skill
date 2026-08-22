export type Move = "C" | "D";
export type GameType = "prisoners_dilemma" | "chicken" | "stag_hunt";
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
}

export interface ScenarioModel {
  situation: string;
  game?: GameType;
  players: readonly ScenarioPlayer[];
  payoffs: PayoffRanges | Record<string, PayoffRanges>;
  structure: { w: Range; noise: Range; drift?: Range };
}

export const strategyIds = [
  "provocable", "forgiving", "pavlov", "grim", "exploitative",
  "trusting", "gradual", "erratic", "prober",
  "contrite", "detective", "zd_generous", "zd_extort", "colluder",
  "adaptive", "southampton", "alld", "allc", "tf2t",
] as const;
export type StrategyId = (typeof strategyIds)[number];

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
}

export function isValidPayoff(game: GameType, p: Payoff): boolean {
  if (game === "chicken") return p.T > p.R && p.R > p.S && p.S > p.P;
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

export function assertScenario(model: ScenarioModel): void {
  if (model.players.length < 2) throw new Error("A scenario needs at least two players");
  for (const player of model.players) {
    if (!player.name || player.dispositions.length === 0) throw new Error("Every player needs a name and disposition");
    if (player.dispositions.some((id) => !strategyIds.includes(id))) throw new Error(`Unknown disposition for ${player.name}`);
    if (player.values !== undefined) {
      const v = player.values;
      if (!Number.isFinite(v[0]) || !Number.isFinite(v[1]) || v[0] > v[1] || v[0] < -1 || v[1] > 1) throw new Error(`values for ${player.name} must be an ordered range within -1..1`);
    }
  }
  assertRange(model.structure.w, "w", 0.9995);
  assertRange(model.structure.noise, "noise", 1);
  if (model.structure.drift !== undefined) assertRange(model.structure.drift, "drift", 1);
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
