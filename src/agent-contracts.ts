import { Type, type Static, type TSchema } from "typebox";
import { strategyIds, type ScenarioModel } from "./domain.js";

const closed = { additionalProperties: false } as const;
const nullable = <T extends TSchema>(schema: T) => Type.Union([schema, Type.Null()]);
const stringEnum = <const T extends readonly string[]>(values: T) =>
  Type.Unsafe<T[number]>({ type: "string", enum: [...values] });

export const rangeSchema = Type.Object({ min: Type.Number(), max: Type.Number() }, closed);
export const payoffSchema = Type.Object({ T: rangeSchema, R: rangeSchema, P: rangeSchema, S: rangeSchema }, closed);
const gameSchema = stringEnum(["prisoners_dilemma", "chicken", "stag_hunt", "snowdrift"] as const);

export const agentThinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const agentSelectionSchema = Type.Object({
  provider: Type.String({ minLength: 1, maxLength: 80 }),
  model: Type.String({ minLength: 1, maxLength: 180 }),
  thinkingLevel: stringEnum(agentThinkingLevels),
}, closed);
export type AgentSelection = Static<typeof agentSelectionSchema>;

/**
 * What the agent produces after reading a situation: a title and the questions it genuinely cannot
 * answer, each optionally pointing at the model field the answer would fill. The model itself is built
 * separately (see buildScenarioModel), so there is no assumptions field here.
 */
export const understandingOutputSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 72 }),
  questions: Type.Array(Type.Object({
    prompt: Type.String({ minLength: 1, maxLength: 200 }),
    field: nullable(Type.String({ minLength: 1, maxLength: 80 })),
  }, closed)),
}, closed);
export type UnderstandingOutput = Static<typeof understandingOutputSchema>;

/** One context-building turn before the deterministic model is (re)built. */
export const contextReplyOutputSchema = Type.Object({
  kind: stringEnum(["answer", "context"] as const),
  message: Type.String({ minLength: 1, maxLength: 2000 }),
  contextNote: nullable(Type.String({ minLength: 1, maxLength: 800 })),
  title: Type.String({ minLength: 1, maxLength: 72 }),
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

const memoryEntrySchema = Type.Object({
  window: Type.String({ minLength: 2, maxLength: 64 }),
  cooperationProbability: Type.Number({ minimum: 0, maximum: 1 }),
}, closed);
const playerSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 120 }),
  dispositions: Type.Array(stringEnum(strategyIds), { minItems: 1 }),
  team: nullable(Type.String({ minLength: 1, maxLength: 120 })),
  values: nullable(rangeSchema),
  betrayalProb: nullable(Type.Number({ minimum: 0, maximum: 1 })),
  memory: nullable(Type.Array(memoryEntrySchema, { minItems: 4 })),
  note: Type.String({ maxLength: 800 }),
}, closed);

const ecoSchema = Type.Object({
  A1: payoffSchema,
  game1: gameSchema,
  theta: rangeSchema,
  epsilon: rangeSchema,
  n0: rangeSchema,
}, closed);
const transitionSchema = Type.Object({
  states: Type.Array(Type.Object({ name: Type.String({ minLength: 1, maxLength: 80 }), payoffs: payoffSchema }, closed), { minItems: 2 }),
  start: Type.String({ minLength: 1, maxLength: 80 }),
  next: Type.Object({ CC: Type.String(), CD: Type.String(), DD: Type.String() }, closed),
}, closed);
const reputationSchema = Type.Object({
  norm: stringEnum(["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"] as const),
  gossip: nullable(rangeSchema),
  quantitative: Type.Boolean(),
  theta: Type.Number({ minimum: -10, maximum: 10 }),
}, closed);
const punishmentSchema = Type.Object({ beta: rangeSchema, gamma: rangeSchema, pool: Type.Boolean() }, closed);
const cheapTalkSchema = Type.Object({ credibility: rangeSchema, lieCost: rangeSchema }, closed);
const topologySchema = Type.Object({
  type: stringEnum(["lattice", "small_world", "scale_free"] as const),
  size: nullable(Type.Integer({ minimum: 2 })),
  K: nullable(Type.Integer({ minimum: 1 })),
}, closed);
const structureSchema = Type.Object({
  w: rangeSchema,
  noise: rangeSchema,
  drift: nullable(rangeSchema),
  sigma: nullable(rangeSchema),
  eco: nullable(ecoSchema),
  transitions: nullable(transitionSchema),
  reputation: nullable(reputationSchema),
  punishment: nullable(punishmentSchema),
  cheapTalk: nullable(cheapTalkSchema),
}, closed);
const rationaleSchema = Type.Array(Type.Object({ key: Type.String({ minLength: 1, maxLength: 120 }), note: Type.String({ maxLength: 800 }) }, closed));
const scenarioBase = {
  situation: Type.String({ minLength: 1, maxLength: 1000 }),
  game: gameSchema,
  players: Type.Array(playerSchema, { minItems: 2 }),
  structure: structureSchema,
  topology: nullable(topologySchema),
  rationale: rationaleSchema,
};

export const sharedScenarioDraftSchema = Type.Object({ ...scenarioBase, payoffs: payoffSchema }, closed);
export const asymmetricScenarioDraftSchema = Type.Object({
  ...scenarioBase,
  payoffsByPlayer: Type.Array(Type.Object({ player: Type.String({ minLength: 1, maxLength: 120 }), payoffs: payoffSchema }, closed), { minItems: 2 }),
}, closed);
export type SharedScenarioDraft = Static<typeof sharedScenarioDraftSchema>;
export type AsymmetricScenarioDraft = Static<typeof asymmetricScenarioDraftSchema>;

export const scenarioDraftOutputSchema = Type.Object({
  mode: stringEnum(["shared", "asymmetric"] as const),
  shared: nullable(sharedScenarioDraftSchema),
  asymmetric: nullable(asymmetricScenarioDraftSchema),
}, closed);
export type ScenarioDraftOutput = Static<typeof scenarioDraftOutputSchema>;

export function normalizeScenarioDraft(output: ScenarioDraftOutput): ScenarioModel {
  if (output.mode === "shared" && output.shared && output.asymmetric === null) return normalizeSharedDraft(output.shared);
  if (output.mode === "asymmetric" && output.asymmetric && output.shared === null) return normalizeAsymmetricDraft(output.asymmetric);
  throw new Error("Scenario draft mode must select exactly one matching payload");
}

function normalizeBase(draft: SharedScenarioDraft | AsymmetricScenarioDraft): Omit<ScenarioModel, "payoffs"> {
  return {
    situation: draft.situation.trim(),
    game: draft.game,
    players: draft.players.map((player) => ({
      name: player.name.trim(),
      dispositions: player.dispositions,
      ...(player.team ? { team: player.team.trim() } : {}),
      ...(player.values ? { values: normalizeRange(player.values) } : {}),
      ...(player.betrayalProb !== null ? { betrayalProb: player.betrayalProb } : {}),
      ...(player.memory ? { memory: Object.fromEntries(player.memory.map((entry) => [entry.window, entry.cooperationProbability])) } : {}),
      ...(player.note.trim() ? { note: player.note.trim() } : {}),
    })),
    structure: {
      w: normalizeRange(draft.structure.w),
      noise: normalizeRange(draft.structure.noise),
      ...(draft.structure.drift ? { drift: normalizeRange(draft.structure.drift) } : {}),
      ...(draft.structure.sigma ? { sigma: normalizeRange(draft.structure.sigma) } : {}),
      ...(draft.structure.eco ? { eco: {
        A1: normalizePayoffs(draft.structure.eco.A1),
        game1: draft.structure.eco.game1,
        theta: normalizeRange(draft.structure.eco.theta),
        epsilon: normalizeRange(draft.structure.eco.epsilon),
        n0: normalizeRange(draft.structure.eco.n0),
      } } : {}),
      ...(draft.structure.transitions ? { transitions: {
        states: Object.fromEntries(draft.structure.transitions.states.map((state) => [state.name, normalizePayoffs(state.payoffs)])),
        start: draft.structure.transitions.start,
        next: draft.structure.transitions.next,
      } } : {}),
      ...(draft.structure.reputation ? { reputation: {
        norm: draft.structure.reputation.norm,
        ...(draft.structure.reputation.gossip ? { gossip: normalizeRange(draft.structure.reputation.gossip) } : {}),
        quantitative: draft.structure.reputation.quantitative,
        theta: draft.structure.reputation.theta,
      } } : {}),
      ...(draft.structure.punishment ? { punishment: {
        beta: normalizeRange(draft.structure.punishment.beta),
        gamma: normalizeRange(draft.structure.punishment.gamma),
        pool: draft.structure.punishment.pool,
      } } : {}),
      ...(draft.structure.cheapTalk ? { cheapTalk: {
        credibility: normalizeRange(draft.structure.cheapTalk.credibility),
        lieCost: normalizeRange(draft.structure.cheapTalk.lieCost),
      } } : {}),
    },
    ...(draft.topology ? { topology: {
      type: draft.topology.type,
      ...(draft.topology.size !== null ? { size: draft.topology.size } : {}),
      ...(draft.topology.K !== null ? { K: draft.topology.K } : {}),
    } } : {}),
    ...(draft.rationale.length ? { rationale: Object.fromEntries(draft.rationale.map((item) => [item.key, item.note])) } : {}),
  };
}

function normalizeRange(range: { min: number; max: number }): [number, number] {
  return [range.min, range.max];
}

function normalizePayoffs(payoffs: Static<typeof payoffSchema>) {
  return { T: normalizeRange(payoffs.T), R: normalizeRange(payoffs.R), P: normalizeRange(payoffs.P), S: normalizeRange(payoffs.S) };
}

export function normalizeSharedDraft(draft: SharedScenarioDraft): ScenarioModel {
  return { ...normalizeBase(draft), payoffs: normalizePayoffs(draft.payoffs) };
}

export function normalizeAsymmetricDraft(draft: AsymmetricScenarioDraft): ScenarioModel {
  return { ...normalizeBase(draft), payoffs: Object.fromEntries(draft.payoffsByPlayer.map((item) => [item.player, normalizePayoffs(item.payoffs)])) };
}

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
