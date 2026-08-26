import type { Fact } from "./api";

/** What already happened: evidence that reweights the current run. Facts arrive through the agent chat. */
export function OutcomeFacts({ facts, busy, onRemove }: {
  facts: readonly Fact[];
  busy: boolean;
  onRemove: (factId: string) => void;
}) {
  if (!facts.length) return null;
  return <section className="section outcome-facts">
    <div className="eyebrow">What already happened</div>
    <ul className="fact-list">
      {facts.map((fact) => <li key={fact.id} className="fact outcome">
        <span className="fact-text">{fact.text}</span>
        <button type="button" className="fact-remove" disabled={busy} aria-label={`Remove: ${fact.text}`} onClick={() => onRemove(fact.id)}>×</button>
      </li>)}
    </ul>
  </section>;
}
