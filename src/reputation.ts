/**
 * Leading Eight + gossip + quantitative assessment; see GAME_THEORY.md for the model boundary.
 * Reputation is per-participant private knowledge, not global.
 * Each Participant aggregate keeps `image: Map<opponentId -> G|B>` and `score: Map<...>`.
 * This file is pure — no TEOB runtime import — so it can be unit-tested via verify-pack.
 */

export type Image = "G" | "B";
export type NormId = "L1"|"L2"|"L3"|"L4"|"L5"|"L6"|"L7"|"L8";

export interface ReputationState {
  image: Record<string, Image>; // opponentId -> G/B, defaults to G
  score: Record<string, number>; // quantitative Hilbe 2023 score∈ℤ, C=>+1 D=>-1
}

/**
 * Ohtsuki & Iwasa 2006 — 8 stable norms, exhaustive 256×16.
 * Each norm is p: (donorImage, recipientImage, action) -> newDonorImage
 * Common traits: Nice (G,G,C->G), Retaliatory ( *,G,D->B ), Apologetic (B,G,C->G)
 * We encode all 8 explicitly; L3 Stern-Judging is simplest and most robust with private info after fix.
 */
const L3_STERN_JUDGING: Record<string, Image> = {
  "G,G,C": "G", "G,G,D": "B",
  "G,B,C": "B", "G,B,D": "G",
  "B,G,C": "G", "B,G,D": "B",
  "B,B,C": "B", "B,B,D": "G",
};

// Full L1-L8 tables — derived from Ohtsuki&Iwasa Table 1. L3 above is canonical; others differ only in B,B,* handling.
export const NORMS: Record<NormId, Record<string, Image>> = {
  L1: { "G,G,C":"G","G,G,D":"B","G,B,C":"G","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"G","B,B,D":"G" },
  L2: { "G,G,C":"G","G,G,D":"B","G,B,C":"G","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"G","B,B,D":"B" },
  L3: L3_STERN_JUDGING,
  L4: { "G,G,C":"G","G,G,D":"B","G,B,C":"B","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"G","B,B,D":"G" },
  L5: { "G,G,C":"G","G,G,D":"B","G,B,C":"G","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"B","B,B,D":"G" },
  L6: { "G,G,C":"G","G,G,D":"B","G,B,C":"G","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"B","B,B,D":"B" },
  L7: { "G,G,C":"G","G,G,D":"B","G,B,C":"B","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"B","B,B,D":"G" },
  L8: { "G,G,C":"G","G,G,D":"B","G,B,C":"B","G,B,D":"G","B,G,C":"G","B,G,D":"B","B,B,C":"B","B,B,D":"B" },
};

export function assess(
  norm: NormId,
  donorImage: Image,
  recipientImage: Image,
  action: "C"|"D"
): Image {
  const key = `${donorImage},${recipientImage},${action}` as const;
  return NORMS[norm][key] ?? "B";
}

export function initialReputation(): ReputationState {
  return { image: {}, score: {} };
}

export function getImage(state: ReputationState, opponentId: string): Image {
  return state.image[opponentId] ?? "G"; // Nice assumption
}

export function getScore(state: ReputationState, opponentId: string): number {
  return state.score[opponentId] ?? 0;
}

// Quantitative: C=>+1 D=>-1, cooperate if score > theta (Hilbe 2023)
export function updateScore(state: ReputationState, opponentId: string, action: "C"|"D"): ReputationState {
  const cur = getScore(state, opponentId);
  const next = cur + (action === "C" ? 1 : -1);
  return { ...state, score: { ...state.score, [opponentId]: next } };
}

export function updateImage(
  state: ReputationState,
  norm: NormId,
  donorId: string,
  donorImage: Image,
  recipientId: string,
  recipientImage: Image,
  action: "C"|"D"
): ReputationState {
  const newImage = assess(norm, donorImage, recipientImage, action);
  // image is about donor as seen by observer — we store per opponent as "what I think about opponent"
  return { ...state, image: { ...state.image, [donorId]: newImage } };
}

// Gossip: Kawakatsu 2024 G_min — minimal gossip to reach consensus
// τ' = τ / (1 + gossipBias), gossip spreads images; we model as peer vs common source equivalence
export function gossipBlend(
  myImage: Image,
  peerImage: Image,
  gossipProb: number, // 0..1
  rng: () => number
): Image {
  if (rng() < gossipProb) return peerImage;
  return myImage;
}

// Discriminator: cooperate with G, defect with B (standard)
export function discriminatorMove(opponentImage: Image): "C"|"D" {
  return opponentImage === "G" ? "C" : "D";
}
