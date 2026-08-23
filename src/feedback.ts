import type { ScenarioModel } from "./domain.js";
import type { ScenarioResult } from "./analysis.js";

export function buildSuggestions(model: ScenarioModel, result: ScenarioResult): string[] {
  const tips: string[] = [];
  const top = result.sensitivity[0];
  const maxWin = Math.max(...Object.values(result.winPctTeam));
  const coop = result.cooperation.mean;
  const coopStd = result.cooperation.std;

  if (maxWin < 60) {
    tips.push(`No team/player has >60% wins (best ${maxWin.toFixed(0)}%) — outcome is undetermined. Try: widen dispositions SET per player, add asymmetric payoffs per side, or add fixed team (team+colluder) if situation has a bloc.`);
  }
  if (coop < 0.35) tips.push(`Cooperation collapses at ${(coop*100).toFixed(0)}% — try lower T upper bound or higher w lower bound, or add forgiving/contrite/gradual to temperaments.`);
  if (coop > 0.8 && coopStd < 0.15) tips.push(`Cooperation always holds — stress-test it: widen noise to [0,0.15] or add drift [0,0.05] + values to see if trust is fragile.`);
  if (top && Math.abs(top.correlation) > 0.25) {
    if (top.input === "noise") tips.push(`Sensitivity #1 is noise (r=${top.correlation.toFixed(2)}) — narrow noise by asking: how often is a move misread? Add contrite/detective to handle misreads.`);
    else if (top.input === "w") tips.push(`Sensitivity #1 is w (r=${top.correlation.toFixed(2)}) — narrow w by asking: how long do both expect this to last? Cap w at 0.99 if horizon unknown.`);
    else if (top.input === "drift") tips.push(`Sensitivity #1 is drift (r=${top.correlation.toFixed(2)}) — drift drives lean. Try narrowing drift or fixing values for key player.`);
    else if (top.input.startsWith("value_")) tips.push(`Sensitivity #1 is ${top.input} (r=${top.correlation.toFixed(2)}) — that player's lean matters. Ask: is that side cynical (-1) or hopeful (+1)? Narrow its values.`);
    else tips.push(`Sensitivity #1 is ${top.input} (r=${top.correlation.toFixed(2)}) — narrow that payoff range first (Stage 2b: only the pivots).`);
  }
  const topWin = result.sensitivityWin[0];
  if (topWin && Math.abs(topWin.correlation) > 0.25 && topWin.input !== top?.input) {
    tips.push(`Who wins turns on a different input than cooperation does: ${topWin.input} (r=${topWin.correlation.toFixed(2)} vs ${result.sensitivityWinTarget} winning). Narrow it too — the cooperation pivot alone will not settle the outcome.`);
  }
  const hasTeam = model.players.some(p => p.team);
  if (!hasTeam && model.players.length > 2 && maxWin < 55) tips.push(`3+ players without teams — round-robin only. If a bloc gangs up, add team:"coalition-1" + colluder to 2+ players.`);
  const hasValues = model.players.some(p => p.values);
  if (!hasValues && coopStd > 0.3) tips.push(`High cooperation variance (±${(coopStd*100).toFixed(0)}%) without values/drift — add values:[-0.2,0.3] + drift:[0,0.03] to model trust erosion.`);
  const game = model.game ?? "prisoners_dilemma";
  if (game === "prisoners_dilemma" && result.cooperation.mean > 0.7 && top?.input === "T") tips.push(`PD with high cooperation sensitive to T — consider if Chicken (mutual defect = crash, T>R>S>P) or Stag Hunt (R>T, coordination) fits the story better.`);
  if (tips.length === 0) tips.push(`Model looks robust — keep ranges wide, only verify the top sensitivity if you need tighter numbers.`);
  return tips;
}
