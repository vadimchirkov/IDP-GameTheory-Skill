import { Type, type Static, type TSchema } from "typebox";
import type { DecisionModel } from "./adapters/decision.js";
import { feasiblePayoffRanges, strategyIds, type GameType, type PayoffRanges, type ScenarioModel } from "./domain.js";

const closed = { additionalProperties: false } as const;
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const stringEnum = <const T extends readonly string[]>(values: T) =>
  Type.Unsafe<T[number]>({ type: "string", enum: [...values] });

export const rangeSchema = Type.Object({ min: Type.Number(), max: Type.Number() }, closed);
const normalizeRange = (range: { min: number; max: number }): [number, number] => [range.min, range.max];

const decisionEffectSchema = Type.Object({ factorId: Type.String({ minLength: 1, maxLength: 80 }), impact: rangeSchema }, closed);
export const decisionDraftSchema = Type.Object({
  timeframe: nullable(Type.String({ minLength: 1, maxLength: 240 })),
  question: Type.String({ minLength: 1, maxLength: 320 }),
  objective: Type.Object({
    label: Type.String({ minLength: 1, maxLength: 120 }),
    unit: nullable(Type.String({ minLength: 1, maxLength: 40 })),
    direction: stringEnum(["maximize", "minimize"] as const),
    target: nullable(Type.Number()),
  }, closed),
  factors: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 80 }), label: Type.String({ minLength: 1, maxLength: 120 }), range: rangeSchema,
    lowLabel: Type.String({ minLength: 1, maxLength: 80 }), highLabel: Type.String({ minLength: 1, maxLength: 80 }),
  }, closed), { minItems: 1, maxItems: 8 }),
  options: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 80 }), label: Type.String({ minLength: 1, maxLength: 120 }),
    description: Type.String({ minLength: 1, maxLength: 320 }), baseline: rangeSchema,
    effects: Type.Array(decisionEffectSchema, { maxItems: 8 }),
  }, closed), { minItems: 2, maxItems: 5 }),
  assumptions: Type.Array(Type.String({ minLength: 1, maxLength: 320 }), { maxItems: 12 }),
  questions: Type.Array(Type.Object({ prompt: Type.String({ minLength: 1, maxLength: 200 }), field: nullable(Type.String({ minLength: 1, maxLength: 80 })) }, closed), { maxItems: 4 }),
  completionMessage: Type.String({ minLength: 1, maxLength: 320 }),
}, closed);
export type DecisionDraft = Static<typeof decisionDraftSchema>;

const id = (value: string, fallback: string): string => value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || fallback;
export function normalizeDecisionDraft(output: DecisionDraft, situation: string): DecisionModel {
  const factorIds = new Map(output.factors.map((factor, index) => [factor.id, id(factor.id, `factor-${index + 1}`)]));
  return {
    schemaVersion: 1, adapter: "decision", situation, ...(output.timeframe ? { timeframe: output.timeframe.trim() } : {}), question: output.question.trim(),
    objective: { label: output.objective.label.trim(), direction: output.objective.direction, ...(output.objective.unit ? { unit: output.objective.unit.trim() } : {}), ...(output.objective.target !== null ? { target: output.objective.target } : {}) },
    factors: output.factors.map((factor, index) => ({ id: factorIds.get(factor.id) ?? `factor-${index + 1}`, label: factor.label.trim(), range: normalizeRange(factor.range), lowLabel: factor.lowLabel.trim(), highLabel: factor.highLabel.trim() })),
    options: output.options.map((option, index) => ({
      id: id(option.id, `option-${index + 1}`), label: option.label.trim(), description: option.description.trim(), baseline: normalizeRange(option.baseline),
      effects: option.effects.map((effect) => ({ factorId: factorIds.get(effect.factorId) ?? id(effect.factorId, effect.factorId), impact: normalizeRange(effect.impact) })),
    })),
    assumptions: output.assumptions.map((assumption) => assumption.trim()).filter(Boolean),
  };
}

const gameSchema = stringEnum(["prisoners_dilemma", "chicken", "stag_hunt", "snowdrift"] as const);
const payoffSchema = Type.Object({ T: rangeSchema, R: rangeSchema, P: rangeSchema, S: rangeSchema }, closed);
export const strategicDraftSchema = Type.Object({
  timeframe: nullable(Type.String({ minLength: 1, maxLength: 240 })),
  game: gameSchema,
  players: Type.Array(Type.Object({
    name: Type.String({ minLength: 1, maxLength: 120 }),
    dispositions: Type.Array(stringEnum(strategyIds), { minItems: 1, maxItems: 2 }),
    note: Type.String({ maxLength: 240 }),
  }, closed), { minItems: 2, maxItems: 4 }),
  continuation: rangeSchema,
  noise: rangeSchema,
  payoffs: payoffSchema,
  assumptions: Type.Array(Type.String({ minLength: 1, maxLength: 320 }), { maxItems: 8 }),
  questions: Type.Array(Type.Object({ prompt: Type.String({ minLength: 1, maxLength: 200 }), field: nullable(Type.String({ minLength: 1, maxLength: 80 })) }, closed), { maxItems: 4 }),
  completionMessage: Type.String({ minLength: 1, maxLength: 320 }),
}, closed);
export type StrategicDraft = Static<typeof strategicDraftSchema>;

const normalizePayoffs = (value: Static<typeof payoffSchema>): PayoffRanges => ({ T: normalizeRange(value.T), R: normalizeRange(value.R), P: normalizeRange(value.P), S: normalizeRange(value.S) });
const canonicalPayoffs = (ranges: PayoffRanges, game: GameType): PayoffRanges => {
  const values = Object.values(ranges).flat(), low = Math.min(...values), span = Math.max(Math.max(...values) - low, 4);
  const point = (share: number): [number, number] => [low + span * share, low + span * share];
  if (game === "chicken" || game === "snowdrift") return { P: point(0), S: point(.3), R: point(.65), T: point(1) };
  if (game === "stag_hunt") return { S: point(0), P: point(.3), T: point(.65), R: point(1) };
  return { S: point(0), P: point(.25), R: point(.65), T: point(1) };
};

export function normalizeStrategicDraft(output: StrategicDraft, situation: string): ScenarioModel {
  const proposed = normalizePayoffs(output.payoffs);
  return {
    situation, ...(output.timeframe ? { timeframe: output.timeframe.trim() } : {}), game: output.game,
    players: output.players.map((player) => ({ name: player.name.trim(), dispositions: player.dispositions, ...(player.note.trim() ? { note: player.note.trim() } : {}) })),
    structure: { w: normalizeRange(output.continuation), noise: normalizeRange(output.noise) },
    payoffs: feasiblePayoffRanges(proposed, output.game) ? proposed : canonicalPayoffs(proposed, output.game),
    ...(output.assumptions.length ? { rationale: Object.fromEntries(output.assumptions.map((assumption, index) => [`Assumption ${index + 1}`, assumption.trim()])) } : {}),
  };
}
export const agentThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const agentSelectionSchema = Type.Object({
  provider: Type.String({ minLength: 1, maxLength: 80 }),
  model: Type.String({ minLength: 1, maxLength: 180 }),
  thinkingLevel: stringEnum(agentThinkingLevels),
}, closed);
export type AgentSelection = Static<typeof agentSelectionSchema>;

/** One context-building turn before the deterministic model is (re)built. */
export const contextReplyOutputSchema = Type.Object({
  kind: stringEnum(["answer", "context"] as const),
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  suggestions: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 2 }),
  contextNote: nullable(Type.String({ minLength: 1, maxLength: 800 })),
  title: Type.String({ minLength: 1, maxLength: 72 }),
  researchQueries: Type.Array(Type.Object({
    query: Type.String({ minLength: 1, maxLength: 240 }),
    field: nullable(Type.String({ minLength: 1, maxLength: 80 })),
    purpose: Type.String({ minLength: 1, maxLength: 240 }),
  }, closed), { maxItems: 3 }),
  questions: Type.Array(Type.Object({
    prompt: Type.String({ minLength: 1, maxLength: 200 }),
    field: nullable(Type.String({ minLength: 1, maxLength: 80 })),
  }, closed)),
}, closed);
export type ContextReplyOutput = Static<typeof contextReplyOutputSchema>;

/**
 * Router output for a chat turn. The agent decides whether the message is a plain question or a
 * statement about what the situation is (`answer`, replied to and left for the user to edit the model),
 * or a fact about what already happened (`outcome`, reweight now). `message` is always the reply to show.
 */
export const factRoutingOutputSchema = Type.Object({
  kind: stringEnum(["answer", "outcome"] as const),
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  suggestions: Type.Array(Type.String({ minLength: 1, maxLength: 120 }), { maxItems: 2 }),
  observation: nullable(Type.Object({
    cooperation: nullable(Type.Number({ minimum: 0, maximum: 1 })),
    winner: nullable(Type.String({ minLength: 1, maxLength: 120 })),
    regime: nullable(stringEnum(["cooperation", "oscillation", "fragile", "conflict", "exit"] as const)),
    playerCooperation: nullable(Type.Array(Type.Object({
      name: Type.String({ minLength: 1, maxLength: 120 }),
      rate: Type.Number({ minimum: 0, maximum: 1 }),
    }, closed))),
  }, closed)),
}, closed);
export type FactRoutingOutput = Static<typeof factRoutingOutputSchema>;

export const worldLabelsOutputSchema = Type.Object({
  labels: Type.Array(Type.Object({
    id: Type.String({ minLength: 1, maxLength: 240 }),
    short: Type.String({ minLength: 1, maxLength: 48 }),
    detail: Type.String({ minLength: 1, maxLength: 180 }),
  }, closed)),
}, closed);
export type WorldLabelsOutput = Static<typeof worldLabelsOutputSchema>;

export interface AgentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

export interface AgentRunMeta {
  runId: string;
  operation: "understand" | "context" | "build-model" | "labels" | "route-fact";
  provider: string;
  model: string;
  thinkingLevel: AgentSelection["thinkingLevel"];
  promptVersion: string;
  structuredOutput?: "tool" | "json-fallback";
  attempts: number;
  durationMs: number;
  usage: AgentUsage;
}
