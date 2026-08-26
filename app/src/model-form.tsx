import { useEffect, useState, type InputHTMLAttributes } from "react";
import { assertScenario, isValidPayoff, strategyIds } from "../../src/domain";
import type { GameType, PayoffRanges, Range, ReputationNorm, ScenarioPlayer, StrategyId } from "../../src/domain";
import type { ScenarioModel } from "./api";
import type { ResearchSource } from "../../src/web-research";

/**
 * The typed model, edited directly. Three tiers: Basics (always there), Mechanisms (opt-in chips
 * that each add one sub-object), Advanced (asymmetric payoffs, notes, raw JSON). Every edit rebuilds
 * the whole model and hands it up — this component keeps no model state of its own, only text
 * drafts. Validation here is a *hint*: the server re-runs `assertScenario` on save.
 */

type Structure = ScenarioModel["structure"];
type Asymmetric = Record<string, PayoffRanges>;

const DEFAULT_PAYOFFS: PayoffRanges = { T: [5, 5], R: [3, 3], P: [1, 1], S: [0, 0] };

const emptyModel = (situation: string): ScenarioModel => ({
  situation,
  game: "prisoners_dilemma",
  players: [
    { name: "Side A", dispositions: ["provocable"] },
    { name: "Side B", dispositions: ["provocable"] },
  ],
  payoffs: { T: [5, 5], R: [3, 3], P: [1, 1], S: [0, 0] },
  structure: { w: [0.9, 0.9], noise: [0, 0] },
});

const GAMES: readonly (readonly [GameType, string])[] = [
  ["prisoners_dilemma", "Prisoner's dilemma"],
  ["chicken", "Chicken"],
  ["stag_hunt", "Stag hunt"],
];
const PAYOFF_KEYS: readonly (readonly [keyof PayoffRanges, string])[] = [
  ["T", "Temptation (T)"], ["R", "Reward (R)"], ["P", "Punishment (P)"], ["S", "Sucker (S)"],
];
const ORDERING: Record<GameType, string> = {
  prisoners_dilemma: "T > R > P > S and 2R > T + S",
  chicken: "T > R > S > P",
  snowdrift: "T > R > S > P",
  stag_hunt: "R > T > P > S",
};
const NORMS: readonly ReputationNorm[] = ["L1", "L2", "L3", "L4", "L5", "L6", "L7", "L8"];

const num = (text: string) => (Number.isFinite(Number(text)) ? Number(text) : 0);
const prune = <T extends object>(value: T): T =>
  Object.fromEntries(Object.entries(value).filter(([, held]) => held !== undefined)) as T;
const asymmetricOf = (payoffs: ScenarioModel["payoffs"]): Asymmetric | undefined =>
  (payoffs as Partial<PayoffRanges>).T === undefined ? (payoffs as Asymmetric) : undefined;

/** Cheap pre-flight: the engine samples inside the ranges, so check the ordering at the minimums. */
function orderingHint(game: GameType, ranges: PayoffRanges): string | undefined {
  const corner = { T: ranges.T[0], R: ranges.R[0], P: ranges.P[0], S: ranges.S[0] };
  return isValidPayoff(game, corner) ? undefined : `A ${game.replace(/_/g, " ")} needs ${ORDERING[game]}`;
}

/** Slots from best to worst payoff for each ordering — the shape that defines the game. */
const RANKED: Record<GameType, readonly (keyof PayoffRanges)[]> = {
  prisoners_dilemma: ["T", "R", "P", "S"],
  chicken: ["T", "R", "S", "P"],
  snowdrift: ["T", "R", "S", "P"],
  stag_hunt: ["R", "T", "P", "S"],
};

/**
 * Changing the kind of standoff keeps the numbers and moves them into the roles the new ordering
 * needs — otherwise every switch would be rejected until the four ranges are re-typed by hand.
 */
function reorderPayoffs(ranges: PayoffRanges, from: GameType, to: GameType): PayoffRanges {
  const sorted = RANKED[from].map((key) => ranges[key]);
  return RANKED[to].reduce((table, key, rank) => ({ ...table, [key]: sorted[rank]! }), {} as PayoffRanges);
}

function useDraft(value: string, commit: (next: string) => void) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { setDraft(value); }, [value]);
  return { draft, setDraft, blur: () => { if (draft !== value) commit(draft); } };
}

function NumberDraft({ value, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> & { value: number; onChange: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (!draft.trim() || !Number.isFinite(next)) { setDraft(String(value)); return; }
    if (next !== value) onChange(next);
  };
  return <input {...props} type="number" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit}
    onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

function RangeField({ label, value, onChange, min, max, step = 0.1 }: {
  label: string; value: Range; onChange: (next: Range) => void; min?: number; max?: number; step?: number;
}) {
  return <div className="range-field">
    <span>{label}</span>
    <div className="range-pair">
      <NumberDraft value={value[0]} min={min} max={max} step={step} aria-label={`${label}, low`}
        onChange={(next) => onChange([next, value[1]])} />
      <NumberDraft value={value[1]} min={min} max={max} step={step} aria-label={`${label}, high`}
        onChange={(next) => onChange([value[0], next])} />
    </div>
  </div>;
}

function PayoffTable({ ranges, onChange }: { ranges: PayoffRanges; onChange: (next: PayoffRanges) => void }) {
  return <div className="payoff-table">
    {PAYOFF_KEYS.map(([key, label]) => <RangeField key={key} label={label} value={ranges[key]}
      onChange={(next) => onChange({ ...ranges, [key]: next })} />)}
  </div>;
}

function MechanismChip({ label, on, disabled, hint, onToggle }: {
  label: string; on: boolean; disabled?: boolean; hint?: string; onToggle: () => void;
}) {
  return <button type="button" className="mechanism-chip" aria-pressed={on} disabled={disabled}
    title={hint ?? label} onClick={onToggle}>{label}{disabled && hint ? <small>{hint}</small> : null}</button>;
}

function PlayerRow({ player, options, showTeam, showValues, onChange, onRemove }: {
  player: ScenarioPlayer;
  options: readonly StrategyId[];
  showTeam: boolean;
  showValues: boolean;
  onChange: (next: ScenarioPlayer) => void;
  onRemove?: () => void;
}) {
  const name = useDraft(player.name, (text) => { if (text.trim()) onChange({ ...player, name: text.trim() }); });
  return <div className="player-row">
    <div className="player-main">
      <input value={name.draft} aria-label="Name of this side" placeholder="Name"
        onChange={(event) => name.setDraft(event.target.value)} onBlur={name.blur} />
      <label>
        <select value={player.dispositions[0] ?? "provocable"} aria-label={`How ${player.name} behaves`}
          onChange={(event) => onChange({ ...player, dispositions: [event.target.value as StrategyId] })}>
          {options.map((id) => <option key={id} value={id}>{id.replace(/_/g, " ")}</option>)}
        </select>
      </label>
      {onRemove
        ? <button type="button" className="fact-remove" aria-label={`Remove ${player.name}`} onClick={onRemove}>×</button>
        : <span className="player-spacer" />}
    </div>
    {showTeam && <div className="player-extra">
      <label><span>Team</span>
        <input value={player.team ?? ""} placeholder="Team"
          onChange={(event) => onChange({ ...player, team: event.target.value })} /></label>
      <label><span>Betrays own side</span>
        <input type="number" min={0} max={1} step={0.05} value={player.betrayalProb ?? 0}
          onChange={(event) => onChange({ ...player, betrayalProb: num(event.target.value) })} /></label>
    </div>}
    {showValues && <div className="player-extra">
      <RangeField label="Lean (−1 selfish … 1 generous)" value={player.values ?? [0, 0]} min={-1} max={1} step={0.1}
        onChange={(next) => onChange({ ...player, values: next })} />
    </div>}
  </div>;
}

function RawJson({ model, onModel }: { model: ScenarioModel; onModel: (next: ScenarioModel) => void }) {
  const text = JSON.stringify(model, null, 2);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState("");
  useEffect(() => { setDraft(text); setError(""); }, [text]);
  return <div className="advanced-field">
    <span>Raw model</span>
    <textarea className="code" rows={14} value={draft} aria-label="Raw model JSON"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        try {
          const parsed = JSON.parse(draft) as ScenarioModel;
          assertScenario(parsed);
          setError("");
          onModel(parsed);
        } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
      }} />
    <small>The escape hatch for memory tables and network topology, which have no field of their own yet.</small>
    {error && <div className="error" role="alert">{error}</div>}
  </div>;
}

export interface ModelFormProps {
  situation: string;
  model?: ScenarioModel;
  questions: readonly { id: string; prompt: string; field?: string }[];
  sources?: readonly ResearchSource[];
  busy: boolean;
  error?: string;
  justRebuilt?: boolean;
  streaming?: boolean;
  buildStage?: number;
  buildElapsed?: number;
  agentAvailable?: boolean;
  agentStatusText?: string;
  onSituation: (text: string) => void;
  onModel: (model: ScenarioModel) => void;
  onUnderstand: () => void;
  onDismissQuestion: (id: string) => void;
}

export function ModelForm(props: ModelFormProps) {
  const model = props.model ?? emptyModel(props.situation);
  const structure = model.structure;
  const game = model.game ?? "prisoners_dilemma";
  const asymmetric = asymmetricOf(model.payoffs);
  const table = asymmetric ? Object.values(asymmetric)[0] ?? DEFAULT_PAYOFFS : (model.payoffs as PayoffRanges);

  const emit = (next: ScenarioModel) => props.onModel(next);
  const patch = (next: Partial<ScenarioModel>) => emit({ ...model, ...next });
  const patchStructure = (next: Partial<Structure>) => emit({ ...model, structure: prune({ ...structure, ...next }) });
  /** Reputation needs three sides, so shrinking the cast has to drop it (assertScenario rejects it otherwise). */
  const setPlayers = (players: readonly ScenarioPlayer[], payoffs = model.payoffs) => emit({
    ...model, players, payoffs,
    structure: players.length < 3 ? prune({ ...structure, reputation: undefined }) : structure,
  });

  const usesLoner = model.players.some((player) => player.dispositions.includes("loner"));
  const usesPunisher = model.players.some((player) => player.dispositions.includes("punisher"));
  const options = strategyIds.filter((id) =>
    (id !== "loner" || structure.sigma !== undefined || usesLoner) &&
    (id !== "punisher" || structure.punishment !== undefined || usesPunisher));
  const hasTeams = model.players.some((player) => player.team !== undefined);
  const hasLean = structure.drift !== undefined;
  const dynamic = structure.eco !== undefined || structure.transitions !== undefined;
  const hint = asymmetric
    ? Object.entries(asymmetric).map(([name, ranges]) => {
      const problem = orderingHint(game, ranges);
      return problem && `${name} — ${problem}`;
    }).find(Boolean)
    : orderingHint(game, table);

  const updatePlayer = (index: number, next: ScenarioPlayer) => {
    const previous = model.players[index]!;
    const players = model.players.map((player, at) => (at === index ? prune(next) : player));
    if (!asymmetric || next.name === previous.name) return setPlayers(players);
    setPlayers(players, Object.fromEntries(Object.entries(asymmetric)
      .map(([name, ranges]) => [name === previous.name ? next.name : name, ranges])));
  };

  const addPlayer = () => {
    const name = "ABCDEFGHIJ".split("").map((letter) => `Side ${letter}`)
      .find((candidate) => !model.players.some((player) => player.name === candidate)) ?? `Side ${model.players.length + 1}`;
    const player = prune<ScenarioPlayer>({
      name,
      dispositions: ["provocable"],
      team: hasTeams ? "Team B" : undefined,
      betrayalProb: hasTeams ? 0 : undefined,
      values: hasLean ? [0, 0] : undefined,
    });
    setPlayers([...model.players, player], asymmetric ? { ...asymmetric, [name]: table } : model.payoffs);
  };

  const removePlayer = (index: number) => {
    const gone = model.players[index]!.name;
    const players = model.players.filter((_, at) => at !== index);
    if (!asymmetric) return setPlayers(players);
    setPlayers(players, Object.fromEntries(Object.entries(asymmetric).filter(([name]) => name !== gone)));
  };

  const toggleTeams = () => setPlayers(model.players.map((player, index) => hasTeams
    ? prune({ ...player, team: undefined, betrayalProb: undefined })
    : { ...player, team: index * 2 < model.players.length ? "Team A" : "Team B", betrayalProb: 0 }));

  const toggleLean = () => emit({
    ...model,
    players: model.players.map((player) => hasLean ? prune({ ...player, values: undefined }) : { ...player, values: [0, 0] as Range }),
    structure: prune({ ...structure, drift: hasLean ? undefined : ([0, 0.1] as Range) }),
  });

  /** Both encodings seed from the table above, so the default they produce is always valid for `game`. */
  const setDynamic = (kind: "eco" | "transitions" | "off") => patchStructure({
    eco: kind === "eco" ? { A1: table, game1: game, theta: [1, 1], epsilon: [0.05, 0.05], n0: [0.5, 0.5] } : undefined,
    transitions: kind === "transitions"
      ? { states: { rich: table, poor: table }, start: "rich", next: { CC: "rich", CD: "poor", DD: "poor" } }
      : undefined,
  });

  const setAsymmetric = (on: boolean) => {
    if (!on) return patch({ payoffs: table });
    // eco and transitions are both defined against one shared table, so they cannot survive the split.
    emit({
      ...model,
      payoffs: Object.fromEntries(model.players.map((player) => [player.name, table])),
      structure: prune({ ...structure, eco: undefined, transitions: undefined }),
    });
  };

  const notes = model.rationale ?? {};
  const setNotes = (next: Record<string, string>) => patch({ rationale: Object.keys(next).length ? next : undefined });

  const situationStale = Boolean(model.situation && props.situation.trim() && model.situation.trim() !== props.situation.trim());

  return <section className="section model-form">
    {props.agentAvailable === false && <div className="model-warning" role="status">Agent not configured — add an API key in Settings to rebuild the model. You can still edit the model by hand.</div>}
    {situationStale && !props.busy && <div className="model-stale-banner" role="status">
      <span>The situation text changed — use the workflow card above to rebuild before running.</span>
    </div>}
    {props.error && !props.busy && <div className="model-error error" role="alert">{props.error}</div>}
    {!!props.sources?.length && <section className="model-sources" aria-label="Public research sources">
      <div className="fact-group-label">Found in public sources <span>{props.sources.length} · reviewed by the agent</span></div>
      <div className="research-source-list">{props.sources.map((source) => <a href={source.url} target="_blank" rel="noreferrer" key={source.id}>
        <span>{source.title}</span><small>{source.field ? `${source.field} · ` : ""}{source.purpose ?? new URL(source.url).hostname}</small>
      </a>)}</div>
    </section>}

    <fieldset className="model-fields" disabled={props.busy}>
      <div className="model-block">
        <div className="fact-group-label">Kind of standoff</div>
        <div className="chip-row">
          {GAMES.map(([id, label]) => <button key={id} type="button" className="mechanism-chip"
            aria-pressed={id === game || (id === "chicken" && game === "snowdrift")}
            onClick={() => patch({
              game: id,
              payoffs: asymmetric
                ? Object.fromEntries(Object.entries(asymmetric).map(([name, ranges]) => [name, reorderPayoffs(ranges, game, id)]))
                : reorderPayoffs(table, game, id),
              structure: {
                ...structure,
                ...(structure.eco ? { eco: { ...structure.eco, A1: reorderPayoffs(structure.eco.A1, game, id), game1: id } } : {}),
                ...(structure.transitions ? { transitions: { ...structure.transitions, states: Object.fromEntries(Object.entries(structure.transitions.states).map(([name, ranges]) => [name, reorderPayoffs(ranges, game, id)])) } } : {}),
              },
            })}
          >{label}</button>)}
        </div>
      </div>

      <div className="model-block">
        <div className="fact-group-label">Who is involved <span>{model.players.length} of 10</span></div>
        {model.players.map((player, index) => <PlayerRow key={index} player={player} options={options}
          showTeam={hasTeams} showValues={hasLean}
          onChange={(next) => updatePlayer(index, next)}
          onRemove={model.players.length > 2 ? () => removePlayer(index) : undefined} />)}
        <div className="actions">
          <button type="button" disabled={model.players.length >= 10} onClick={addPlayer}>Add a side</button>
        </div>
      </div>

      <div className="model-block">
        <div className="fact-group-label">What is at stake <span>each round's payoffs, as ranges</span></div>
        {asymmetric
          ? Object.entries(asymmetric).map(([name, ranges]) => <div key={name} className="payoff-group">
            <small>{name}</small>
            <PayoffTable ranges={ranges} onChange={(next) => patch({ payoffs: { ...asymmetric, [name]: next } })} />
          </div>)
          : <PayoffTable ranges={table} onChange={(next) => patch({ payoffs: next })} />}
        {hint && <div className="model-warning">{hint}</div>}
      </div>

      <div className="model-block">
        <div className="fact-group-label">How it plays out</div>
        <div className="payoff-table">
          <RangeField label="How long it lasts" value={structure.w} min={0} max={0.9995} step={0.01}
            onChange={(next) => patchStructure({ w: next })} />
          <RangeField label="Chance of a misread" value={structure.noise} min={0} max={1} step={0.01}
            onChange={(next) => patchStructure({ noise: next })} />
        </div>
      </div>

      <div className="model-block">
        <div className="fact-group-label">What else is going on <span>optional</span></div>
        <div className="chip-row">
          <MechanismChip label="Teams & collusion" on={hasTeams} onToggle={toggleTeams} />
          <MechanismChip label="Reputation" on={structure.reputation !== undefined}
            disabled={model.players.length < 3} hint={model.players.length < 3 ? "needs 3+ sides" : undefined}
            onToggle={() => patchStructure({ reputation: structure.reputation ? undefined : { norm: "L3", gossip: [0, 0], quantitative: false, theta: 0 } })} />
          <MechanismChip label="Punishment" on={structure.punishment !== undefined}
            disabled={structure.punishment !== undefined && usesPunisher}
            hint={usesPunisher ? "a side is set to punisher" : undefined}
            onToggle={() => patchStructure({ punishment: structure.punishment ? undefined : { beta: [2, 2], gamma: [0.5, 0.5], pool: false } })} />
          <MechanismChip label="Cheap talk" on={structure.cheapTalk !== undefined}
            onToggle={() => patchStructure({ cheapTalk: structure.cheapTalk ? undefined : { credibility: [0.5, 0.5], lieCost: [0, 0] } })} />
          <MechanismChip label="Walking away" on={structure.sigma !== undefined}
            disabled={structure.sigma !== undefined && usesLoner}
            hint={usesLoner ? "a side is set to loner" : undefined}
            onToggle={() => patchStructure({ sigma: structure.sigma ? undefined : ([1, 1] as Range) })} />
          <MechanismChip label="Dynamic game" on={dynamic} disabled={asymmetric !== undefined}
            hint={asymmetric ? "needs one shared payoff table" : undefined}
            onToggle={() => setDynamic(dynamic ? "off" : "eco")} />
          <MechanismChip label="Lean & drift" on={hasLean} onToggle={toggleLean} />
        </div>

        {structure.reputation && <div className="mechanism-panel">
          <label><span>Norm</span>
            <select value={structure.reputation.norm ?? "L3"}
              onChange={(event) => patchStructure({ reputation: { ...structure.reputation, norm: event.target.value as ReputationNorm } })}>
              {NORMS.map((norm) => <option key={norm} value={norm}>{norm}</option>)}
            </select></label>
          <RangeField label="Gossip" value={structure.reputation.gossip ?? [0, 0]} min={0} max={1} step={0.05}
            onChange={(next) => patchStructure({ reputation: { ...structure.reputation, gossip: next } })} />
          <label className="check">
            <input type="checkbox" checked={structure.reputation.quantitative ?? false}
              onChange={(event) => patchStructure({ reputation: { ...structure.reputation, quantitative: event.target.checked } })} />
            <span>Public score instead of a good/bad name</span></label>
          <label><span>Sanction below</span>
            <input type="number" min={-10} max={10} step={0.5} value={structure.reputation.theta ?? 0}
              onChange={(event) => patchStructure({ reputation: { ...structure.reputation, theta: num(event.target.value) } })} /></label>
        </div>}

        {structure.punishment && <div className="mechanism-panel">
          <RangeField label="Fine on the defector" value={structure.punishment.beta} min={0}
            onChange={(next) => patchStructure({ punishment: { ...structure.punishment!, beta: next } })} />
          <RangeField label="Cost to the punisher" value={structure.punishment.gamma} min={0}
            onChange={(next) => patchStructure({ punishment: { ...structure.punishment!, gamma: next } })} />
          <label className="check">
            <input type="checkbox" checked={structure.punishment.pool ?? false}
              onChange={(event) => patchStructure({ punishment: { ...structure.punishment!, pool: event.target.checked } })} />
            <span>Paid every round into a pool</span></label>
        </div>}

        {structure.cheapTalk && <div className="mechanism-panel">
          <RangeField label="How far a pledge is trusted" value={structure.cheapTalk.credibility} min={0} max={1} step={0.05}
            onChange={(next) => patchStructure({ cheapTalk: { ...structure.cheapTalk!, credibility: next } })} />
          <RangeField label="Cost of breaking a pledge" value={structure.cheapTalk.lieCost} min={0}
            onChange={(next) => patchStructure({ cheapTalk: { ...structure.cheapTalk!, lieCost: next } })} />
        </div>}

        {structure.sigma && <div className="mechanism-panel">
          <RangeField label="Payoff for walking away" value={structure.sigma} min={0}
            onChange={(next) => patchStructure({ sigma: next })} />
        </div>}

        {dynamic && <div className="mechanism-panel">
          <div className="chip-row">
            <button type="button" className="mechanism-chip" aria-pressed={structure.eco !== undefined}
              onClick={() => setDynamic("eco")}>A depleting resource</button>
            <button type="button" className="mechanism-chip" aria-pressed={structure.transitions !== undefined}
              onClick={() => setDynamic("transitions")}>Named game states</button>
          </div>
          {structure.eco && <>
            <RangeField label="Cooperation restores it (θ)" value={structure.eco.theta} min={0} max={100} step={0.1}
              onChange={(next) => patchStructure({ eco: { ...structure.eco!, theta: next } })} />
            <RangeField label="How fast it moves (ε)" value={structure.eco.epsilon} min={0} max={1} step={0.01}
              onChange={(next) => patchStructure({ eco: { ...structure.eco!, epsilon: next } })} />
            <RangeField label="Starting depletion" value={structure.eco.n0} min={0} max={1} step={0.05}
              onChange={(next) => patchStructure({ eco: { ...structure.eco!, n0: next } })} />
            <small>The depleted payoff table (A1) starts as a copy of the one above — retune it in the raw model.</small>
          </>}
          {structure.transitions && <>
            {(["CC", "CD", "DD"] as const).map((outcome) => <label key={outcome}><span>After {outcome}</span>
              <select value={structure.transitions!.next[outcome]}
                onChange={(event) => patchStructure({ transitions: { ...structure.transitions!, next: { ...structure.transitions!.next, [outcome]: event.target.value } } })}>
                {Object.keys(structure.transitions!.states).map((state) => <option key={state} value={state}>{state}</option>)}
              </select></label>)}
            <small>Both states start as a copy of the payoff table above — rename and retune them in the raw model.</small>
          </>}
        </div>}

        {hasLean && <div className="mechanism-panel">
          <RangeField label="How fast a lean drifts" value={structure.drift ?? [0, 0]} min={0} max={1} step={0.05}
            onChange={(next) => patchStructure({ drift: next })} />
        </div>}
      </div>

      </fieldset>
      <details className="clarifications model-advanced" open={undefined}>
        <summary><span className="eyebrow">Advanced</span></summary>
        <fieldset className="model-fields" disabled={props.busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <label className="check">
          <input type="checkbox" checked={asymmetric !== undefined} onChange={(event) => setAsymmetric(event.target.checked)} />
          <span>Each side has its own payoffs</span></label>
        <div className="advanced-field">
          <span>Notes</span>
          {Object.entries(notes).map(([key, value]) => <div key={key} className="note-row">
            <input value={key} aria-label="Note subject" onChange={(event) => {
              const { [key]: held, ...rest } = notes;
              setNotes({ ...rest, [event.target.value]: held ?? "" });
            }} />
            <input value={value} aria-label={`Note about ${key}`}
              onChange={(event) => setNotes({ ...notes, [key]: event.target.value })} />
            <button type="button" className="fact-remove" aria-label={`Remove note ${key}`} onClick={() => {
              const { [key]: _dropped, ...rest } = notes;
              setNotes(rest);
            }}>×</button>
          </div>)}
          <div className="actions">
            <button type="button" onClick={() => setNotes({ ...notes, [`note ${Object.keys(notes).length + 1}`]: "" })}>Add a note</button>
          </div>
        </div>
        <RawJson model={model} onModel={props.onModel} />
        </fieldset>
      </details>
  </section>;
}
