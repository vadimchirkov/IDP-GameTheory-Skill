export interface ForecastDecision {
  actionId: string;
  label?: string;
  /** Value known at forecast time for every possible resolved outcome. */
  valueByOutcome: Record<string, number>;
}

/** Immutable, adapter-neutral categorical forecast recorded before the outcome is known. */
export interface CategoricalForecastSnapshot {
  schemaVersion: 1;
  kind: "categorical";
  id: string;
  adapter: string;
  subjectId: string;
  question: string;
  issuedAt: string;
  outcomes: readonly string[];
  probabilities: Record<string, number>;
  /** Optional external comparator, such as the market price at issuedAt. */
  baselineProbabilities?: Record<string, number>;
  decision?: ForecastDecision;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ForecastResolution {
  schemaVersion: 1;
  kind: "resolution";
  snapshotId: string;
  outcome: string;
  resolvedAt: string;
}

export type ForecastRecord = CategoricalForecastSnapshot | ForecastResolution;

export interface ProbabilityScore {
  brier: number;
  logLoss: number;
  correct: boolean;
}

export interface CalibrationBin {
  lower: number;
  upper: number;
  count: number;
  forecast: number;
  observed: number;
}

export interface ForecastSummary {
  snapshots: number;
  resolved: number;
  unresolved: number;
  model?: { brier: number; logLoss: number; accuracy: number };
  baseline?: { count: number; brier: number; logLoss: number; accuracy: number };
  calibration: readonly CalibrationBin[];
  paper?: { decisions: number; totalValue: number; meanValue: number };
}

const finiteProbability = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function assertIsoDate(value: string, label: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`${label} must be an ISO date`);
}

export function assertProbabilities(outcomes: readonly string[], probabilities: Record<string, number>, label = "probabilities"): void {
  if (outcomes.length < 2 || new Set(outcomes).size !== outcomes.length || outcomes.some((outcome) => !outcome.trim())) {
    throw new Error("forecast outcomes must contain at least two unique non-empty values");
  }
  if (Object.keys(probabilities).length !== outcomes.length || outcomes.some((outcome) => !finiteProbability(probabilities[outcome]))) {
    throw new Error(`${label} must contain one probability within 0..1 for every outcome`);
  }
  const total = outcomes.reduce((sum, outcome) => sum + probabilities[outcome]!, 0);
  if (Math.abs(total - 1) > 1e-9) throw new Error(`${label} must sum to 1`);
}

export function assertForecastRecord(record: ForecastRecord): void {
  if (record.schemaVersion !== 1) throw new Error("unsupported forecast record");
  if (record.kind === "resolution") {
    if (!record.snapshotId.trim() || !record.outcome.trim()) throw new Error("resolution needs a snapshot and outcome");
    assertIsoDate(record.resolvedAt, "resolvedAt");
    return;
  }
  if (!record.id.trim() || !record.adapter.trim() || !record.subjectId.trim() || !record.question.trim()) throw new Error("forecast identity and question are required");
  assertIsoDate(record.issuedAt, "issuedAt");
  assertProbabilities(record.outcomes, record.probabilities);
  if (record.baselineProbabilities) assertProbabilities(record.outcomes, record.baselineProbabilities, "baselineProbabilities");
  if (record.decision) {
    if (!record.decision.actionId.trim()) throw new Error("forecast decision needs an action id");
    if (record.outcomes.some((outcome) => !Number.isFinite(record.decision!.valueByOutcome[outcome]))) throw new Error("forecast decision needs a finite value for every outcome");
  }
}

export function scoreProbabilities(outcomes: readonly string[], probabilities: Record<string, number>, actual: string): ProbabilityScore {
  assertProbabilities(outcomes, probabilities);
  if (!outcomes.includes(actual)) throw new Error(`unknown resolved outcome ${actual}`);
  const brier = outcomes.reduce((sum, outcome) => sum + (probabilities[outcome]! - Number(outcome === actual)) ** 2, 0) / outcomes.length;
  const logLoss = -Math.log(Math.max(Number.EPSILON, probabilities[actual]!));
  const predicted = [...outcomes].sort((a, b) => probabilities[b]! - probabilities[a]!)[0]!;
  return { brier, logLoss, correct: predicted === actual };
}

export function summarizeForecasts(records: readonly ForecastRecord[], bins = 10): ForecastSummary {
  if (!Number.isInteger(bins) || bins < 1) throw new Error("calibration bins must be a positive integer");
  const snapshots = new Map<string, CategoricalForecastSnapshot>();
  const resolutions = new Map<string, ForecastResolution>();
  for (const record of records) {
    assertForecastRecord(record);
    const target = record.kind === "categorical" ? snapshots : resolutions;
    const id = record.kind === "categorical" ? record.id : record.snapshotId;
    if (target.has(id)) throw new Error(`duplicate ${record.kind} record for ${id}`);
    target.set(id, record as never);
  }
  for (const id of resolutions.keys()) if (!snapshots.has(id)) throw new Error(`resolution references unknown snapshot ${id}`);

  const resolved = [...snapshots.values()].flatMap((snapshot) => {
    const resolution = resolutions.get(snapshot.id);
    if (!resolution) return [];
    if (!snapshot.outcomes.includes(resolution.outcome)) throw new Error(`resolution ${snapshot.id} has an unknown outcome`);
    if (Date.parse(resolution.resolvedAt) < Date.parse(snapshot.issuedAt)) throw new Error(`resolution ${snapshot.id} predates its forecast`);
    return [{ snapshot, resolution, model: scoreProbabilities(snapshot.outcomes, snapshot.probabilities, resolution.outcome) }];
  });
  const average = (values: readonly number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const model = resolved.length ? {
    brier: average(resolved.map((item) => item.model.brier)),
    logLoss: average(resolved.map((item) => item.model.logLoss)),
    accuracy: average(resolved.map((item) => Number(item.model.correct))),
  } : undefined;
  const withBaseline = resolved.flatMap((item) => item.snapshot.baselineProbabilities
    ? [{ ...item, score: scoreProbabilities(item.snapshot.outcomes, item.snapshot.baselineProbabilities, item.resolution.outcome) }]
    : []);
  const baseline = withBaseline.length ? {
    count: withBaseline.length,
    brier: average(withBaseline.map((item) => item.score.brier)),
    logLoss: average(withBaseline.map((item) => item.score.logLoss)),
    accuracy: average(withBaseline.map((item) => Number(item.score.correct))),
  } : undefined;
  const rawBins = Array.from({ length: bins }, (_, index) => ({ lower: index / bins, upper: (index + 1) / bins, count: 0, forecast: 0, observed: 0 }));
  for (const { snapshot, resolution } of resolved) for (const outcome of snapshot.outcomes) {
    const probability = snapshot.probabilities[outcome]!;
    const bin = rawBins[Math.min(bins - 1, Math.floor(probability * bins))]!;
    bin.count += 1;
    bin.forecast += probability;
    bin.observed += Number(outcome === resolution.outcome);
  }
  const calibration = rawBins.filter((bin) => bin.count).map((bin) => ({ ...bin, forecast: bin.forecast / bin.count, observed: bin.observed / bin.count }));
  const decisions = resolved.flatMap(({ snapshot, resolution }) => snapshot.decision
    ? [snapshot.decision.valueByOutcome[resolution.outcome]!]
    : []);
  return {
    snapshots: snapshots.size,
    resolved: resolved.length,
    unresolved: snapshots.size - resolved.length,
    ...(model ? { model } : {}),
    ...(baseline ? { baseline } : {}),
    calibration,
    ...(decisions.length ? { paper: { decisions: decisions.length, totalValue: decisions.reduce((sum, value) => sum + value, 0), meanValue: average(decisions) } } : {}),
  };
}
