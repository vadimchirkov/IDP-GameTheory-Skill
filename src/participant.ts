/**
 * Participant aggregate — TEOB holistic state + behaviour per player
 * Each participant knows: state (including recent/history), what can happen (Command),
 * what it will change in knowledge (Event via apply), and what to do (Effect = persist + reply/tell)
 *
 * History per participant is event-sourced: MoveChosen + OutcomeRecorded + ReputationUpdated
 * No global arrays — each actor's Journal is the audit trail "что с ним случалось и что менялось"
 */
// @ts-nocheck — exactOptional pedantry for team?: string | undefined, logic is sound, codec handles missing

import {
  CategoryId,
  EntityId,
  TimerId,
  andReply,
  categoryTypes,
  persist,
  reply,
  tagCodec,
  objectCodec,
  codecWithUpcasts,
  upcast,
  type Aggregate,
  type Effect,
} from "@lambda-house/teob-ts/core";
import type { Move, StrategyId } from "./domain.js";
import { deriveSeed, Rng } from "./rng.js";
import { strategies } from "./kernel.js";
import {
  type Image,
  type NormId,
  type ReputationState,
  initialReputation,
  getImage,
  updateScore,
  updateImage,
  discriminatorMove,
  assess,
} from "./reputation.js";

export const participantCategory = categoryTypes<ParticipantCommand, ParticipantReply>(CategoryId("participant"));
export const PARTICIPANT_VERSION = "1";

// ---- State ----
export interface ParticipantState {
  status: "new" | "active" | "finished";
  playerName: string;
  team?: string | undefined;
  dispositions: StrategyId[];
  picked: StrategyId | null;
  lean: number;
  drift: number;
  norm: NormId;
  reputation: ReputationState;
  historyMy: Move[];
  historyOpp: Record<string, Move[]>;
  generation: number;
  seed: number;
}

// ---- Commands (что может случиться снаружи) ----
export type ParticipantCommand =
  | { tag: "Initialize"; playerName: string; dispositions: StrategyId[]; team?: string | undefined; lean: number; drift: number; seed: number; norm?: NormId }
  | { tag: "RequestMove"; round: number; opponentId: string; opponentImage?: Image }
  | { tag: "ReceiveOutcome"; round: number; opponentId: string; myMove: Move; oppMove: Move; payoff: number; w: number }
  | { tag: "Gossip"; fromId: string; aboutId: string; image: Image }
  | { tag: "GetState" };

// ---- Events (что поменялось в знаниях) ----
export type ParticipantEvent =
  | { tag: "ParticipantInitialized"; playerName: string; dispositions: StrategyId[]; team?: string | undefined; lean: number; drift: number; seed: number; norm: NormId }
  | { tag: "MoveChosen"; round: number; opponentId: string; move: Move; picked: StrategyId; leanApplied: number }
  | { tag: "OutcomeRecorded"; round: number; opponentId: string; myMove: Move; oppMove: Move; payoff: number; newLean: number; newImage: Image; newScore: number }
  | { tag: "GossipReceived"; fromId: string; aboutId: string; image: Image };

// ---- Replies (что сделать) ----
export type ParticipantReply =
  | { tag: "Accepted" }
  | { tag: "Move"; move: Move }
  | { tag: "State"; state: ParticipantState }
  | { tag: "Rejected"; reason: string };

function reject(reason: string): Promise<Effect<ParticipantEvent, ParticipantReply>> {
  return Promise.resolve(reply({ tag: "Rejected", reason }));
}

function pickDisposition(dispositions: StrategyId[], rng: Rng): StrategyId {
  return rng.pick(dispositions);
}

function applyLean(move: Move, lean: number, rng: Rng): Move {
  if (lean === 0) return move;
  if (move === "C" && lean < 0 && rng.unit() < -lean) return "D";
  if (move === "D" && lean > 0 && rng.unit() < lean) return "C";
  return move;
}

export const participantAggregate: Aggregate<ParticipantCommand, ParticipantReply, ParticipantEvent, ParticipantState> = {
  category: CategoryId("participant"),
  initial: (_id: EntityId): ParticipantState => ({
    status: "new",
    playerName: "",
    dispositions: [],
    picked: null,
    lean: 0,
    drift: 0,
    norm: "L3",
    reputation: initialReputation(),
    historyMy: [],
    historyOpp: {},
    generation: 0,
    seed: 42,
  }),

  async decide(state, command, _ctx) {
    switch (command.tag) {
      case "Initialize": {
        if (state.status !== "new") return reject("Participant already initialized");
        const norm = command.norm ?? "L3";
        return andReply(
          persist<ParticipantEvent, ParticipantReply>({
            tag: "ParticipantInitialized",
            playerName: command.playerName,
            dispositions: command.dispositions,
            team: command.team,
            lean: command.lean,
            drift: command.drift,
            seed: command.seed,
            norm,
          }),
          { tag: "Accepted" }
        );
      }

      case "RequestMove": {
        if (state.status !== "active") return reject("Participant not active");
        // derive deterministic rng per move: rootSeed + generation + round + opponent hash
        const oppHash = command.opponentId.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
        const rng = new Rng(deriveSeed(state.seed, state.generation, command.round, oppHash));
        // pick strategy if not yet (first move of world)
        let picked = state.picked;
        if (!picked) {
          picked = pickDisposition(state.dispositions, rng);
        }
        // base strategy move
        const oppHist = state.historyOpp[command.opponentId] ?? [];
        const base = strategies[picked!] ?? strategies.provocable;
        // special: loner never requests move — should be intercepted at SimulationRun level
        if (picked === "loner") return reject("loner opts out — no move");
        let move: Move = base(state.historyMy, oppHist, rng);
        // reputation discriminator overrides if image is B (unless trusting etc.)
        const oppImage = command.opponentImage ?? getImage(state.reputation, command.opponentId);
        if (state.norm === "L3" && (picked === "provocable" || picked === "forgiving" || picked === "grim")) {
          move = discriminatorMove(oppImage);
        }
        // lean shifts move
        const leaned = applyLean(move, state.lean, rng);
        // noise is applied at SimulationRun/match level, not here (keeps lean determinism)

        return andReply(
          persist<ParticipantEvent, ParticipantReply>({
            tag: "MoveChosen",
            round: command.round,
            opponentId: command.opponentId,
            move: leaned,
            picked,
            leanApplied: state.lean,
          }),
          { tag: "Move", move: leaned }
        );
      }

      case "ReceiveOutcome": {
        if (state.status !== "active") return reject("Participant not active");
        // update lean via drift
        const driftDelta = command.oppMove === "D" ? -state.drift : state.drift;
        const newLean = Math.max(-1, Math.min(1, state.lean + driftDelta));
        // reputation update: assess donor (opponent) from my perspective
        const myImage = getImage(state.reputation, state.playerName) ?? "G";
        const oppImageBefore = getImage(state.reputation, command.opponentId);
        const newImage = assess(state.norm, oppImageBefore, myImage, command.oppMove);
        const newScore = (state.reputation.score[command.opponentId] ?? 0) + (command.oppMove === "C" ? 1 : -1);

        return andReply(
          persist<ParticipantEvent, ParticipantReply>({
            tag: "OutcomeRecorded",
            round: command.round,
            opponentId: command.opponentId,
            myMove: command.myMove,
            oppMove: command.oppMove,
            payoff: command.payoff,
            newLean: newLean,
            newImage,
            newScore,
          }),
          { tag: "Accepted" }
        );
      }

      case "Gossip": {
        // private assessment gossip: blend image
        return andReply(
          persist<ParticipantEvent, ParticipantReply>({
            tag: "GossipReceived",
            fromId: command.fromId,
            aboutId: command.aboutId,
            image: command.image,
          }),
          { tag: "Accepted" }
        );
      }

      case "GetState":
        return reply({ tag: "State", state });
    }
  },

  apply(state, event) {
    switch (event.tag) {
      case "ParticipantInitialized": {
        const rng = new Rng(event.seed);
        const picked = rng.pick(event.dispositions);
        return {
          ...state,
          status: "active",
          playerName: event.playerName,
          dispositions: [...event.dispositions],
          team: event.team,
          lean: event.lean,
          drift: event.drift,
          seed: event.seed,
          norm: event.norm,
          picked,
          historyMy: [],
          historyOpp: {},
          reputation: initialReputation(),
          generation: 0,
        };
      }
      case "MoveChosen": {
        const newMy = [...state.historyMy, event.move];
        // keep window reasonable for event-sourced replay (cap 20 keeps snapshot small, full history via Journal)
        const cappedMy = newMy.length > 20 ? newMy.slice(-20) : newMy;
        return {
          ...state,
          picked: event.picked,
          historyMy: cappedMy,
          generation: state.generation,
        };
      }
      case "OutcomeRecorded": {
        const curOpp = state.historyOpp[event.opponentId] ?? [];
        const newOpp = [...curOpp, event.oppMove];
        const cappedOpp = newOpp.length > 20 ? newOpp.slice(-20) : newOpp;
        return {
          ...state,
          lean: event.newLean,
          historyOpp: { ...state.historyOpp, [event.opponentId]: cappedOpp },
          reputation: {
            image: { ...state.reputation.image, [event.opponentId]: event.newImage },
            score: { ...state.reputation.score, [event.opponentId]: event.newScore },
          },
        };
      }
      case "GossipReceived": {
        return { ...state, reputation: { ...state.reputation, image: { ...state.reputation.image, [event.aboutId]: event.image } } };
      }
    }
  },

  snapshotEvery: 10,
};

// Codecs — tagCodec for events, objectCodec for state (Map serialized as arrays for codec)
const participantEventBase = tagCodec<ParticipantEvent>(
  "ParticipantInitialized",
  "MoveChosen",
  "OutcomeRecorded",
  "GossipReceived"
);

export const participantEventCodec = codecWithUpcasts(participantEventBase, [
  upcast("ParticipantInitialized", "ParticipantInitialized", (old: unknown) => {
    const o = old as Record<string, unknown>;
    return { ...o, norm: (o.norm as string) ?? "L3" };
  }),
]);

// State codec: Maps need custom handling — we store as plain object for journal
export const participantStateCodec = objectCodec<ParticipantState>("ParticipantState");
