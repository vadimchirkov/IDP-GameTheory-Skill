import { useEffect, useRef, useState } from "react";
import type { Fact, FactCommand, FactKind, ResearchResult, TaskState } from "./api";

/**
 * The whole input surface of a scenario: one list of facts, plus the questions the agent could not
 * answer. A fact is either about the situation (it shapes the model, so the run goes stale until the
 * next Run) or about what already happened (it reweights the finished run straight away). Nothing
 * here blocks: questions can be ignored, assumptions can be edited, and Run is always one click.
 */

const KIND_LABEL: Record<FactKind, string> = { situation: "about the situation", outcome: "already happened" };

function FactRow({ fact, disabled, onCommand }: { fact: Fact; disabled: boolean; onCommand: (value: FactCommand) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.text);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { setDraft(fact.text); }, [fact.text]);
  useEffect(() => {
    const element = input.current;
    if (!editing || !element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
    element.focus();
    element.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const text = draft.trim();
    if (text && text !== fact.text) onCommand({ tag: "EditFact", factId: fact.id, text });
    else setDraft(fact.text);
  };

  return <li className={`fact ${fact.kind}`}>
    {editing ? <textarea
      ref={input}
      className="fact-input"
      rows={1}
      value={draft}
      onChange={(event) => { setDraft(event.target.value); event.target.style.height = "auto"; event.target.style.height = `${event.target.scrollHeight}px`; }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === "Escape") { event.preventDefault(); setDraft(fact.text); setEditing(false); }
      }}
      aria-label="Edit fact"
    /> : <button type="button" className="fact-text" onClick={() => !disabled && setEditing(true)} title="Click to edit">
      {fact.text}
      {fact.source === "agent" && <span className="fact-tag assumed" title="The agent inferred this — edit it if it is wrong">assumed</span>}
    </button>}
    <div className="fact-tools">
      <button
        type="button"
        className={`fact-kind ${fact.kind}`}
        disabled={disabled}
        title={fact.kind === "situation" ? "Shapes the model. Click to file it as something that already happened." : "Reweights the current run. Click to file it as part of the situation."}
        onClick={() => onCommand({ tag: "SetFactKind", factId: fact.id, kind: fact.kind === "situation" ? "outcome" : "situation" })}
      >{KIND_LABEL[fact.kind]}</button>
      <button type="button" className="fact-remove" disabled={disabled} aria-label={`Remove: ${fact.text}`} onClick={() => onCommand({ tag: "RemoveFact", factId: fact.id })}>×</button>
    </div>
  </li>;
}

function QuestionRow({ question, disabled, canResearch, onAnswer, onDismiss, onResearch }: {
  question: { id: string; prompt: string };
  disabled: boolean;
  canResearch: boolean;
  onAnswer: (text: string) => void;
  onDismiss: () => void;
  onResearch: () => Promise<ResearchResult>;
}) {
  const [answering, setAnswering] = useState(false);
  const [draft, setDraft] = useState("");
  const [sources, setSources] = useState<ResearchResult["sources"]>([]);
  const [looking, setLooking] = useState(false);
  const [error, setError] = useState("");

  const lookUp = async () => {
    setLooking(true); setError("");
    try {
      const result = await onResearch();
      setDraft(result.answer);
      setSources(result.sources);
      setAnswering(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setLooking(false); }
  };

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAnswer(text);
    setAnswering(false); setDraft(""); setSources([]);
  };

  return <li className="question">
    <div className="question-head">
      <span className="question-prompt">{question.prompt}</span>
      <button type="button" className="question-dismiss" disabled={disabled} aria-label={`Dismiss: ${question.prompt}`} onClick={onDismiss}>×</button>
    </div>
    {answering ? <div className="question-answer">
      <textarea
        rows={2}
        value={draft}
        autoFocus
        placeholder="Answer in your own words…"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
          if (event.key === "Escape") { event.preventDefault(); setAnswering(false); }
        }}
        aria-label={question.prompt}
      />
      {sources.length > 0 && <div className="question-sources">{sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>)}</div>}
      <div className="question-actions">
        <button type="button" onClick={() => setAnswering(false)}>Cancel</button>
        <button type="button" className="primary" onClick={submit} disabled={!draft.trim()}>Add as fact</button>
      </div>
    </div> : <div className="question-actions">
      <button type="button" disabled={disabled} onClick={() => setAnswering(true)}>Answer</button>
      {canResearch && <button type="button" disabled={disabled || looking} onClick={() => void lookUp()}>{looking ? "Looking up…" : "Look it up"}</button>}
    </div>}
    {error && <div className="error" role="alert">{error}</div>}
  </li>;
}

export function FactsPanel({ task, busy, canResearch, staleRun, onCommand, onAddFact, onUnderstand, onResearch }: {
  task: TaskState;
  busy: boolean;
  canResearch: boolean;
  staleRun: boolean;
  onCommand: (value: FactCommand) => void;
  onAddFact: (text: string) => void;
  onUnderstand: () => void;
  onResearch: (question: string) => Promise<ResearchResult>;
}) {
  const [draft, setDraft] = useState("");
  const situation = task.facts.filter((fact) => fact.kind === "situation");
  const outcome = task.facts.filter((fact) => fact.kind === "outcome");

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onAddFact(text);
    setDraft("");
  };

  return <section className="section facts-section">
    <div className="section-heading">
      <div className="eyebrow">Facts</div>
      <button type="button" className="link-button" disabled={busy || !canResearch} onClick={onUnderstand} title="Let the agent fill in what it can infer and ask what it cannot">
        Review with agent
      </button>
    </div>

    <ul className="fact-list">
      {situation.map((fact) => <FactRow key={fact.id} fact={fact} disabled={busy} onCommand={onCommand} />)}
    </ul>

    {outcome.length > 0 && <>
      <div className="fact-group-label">What already happened <span>reweights the current run</span></div>
      <ul className="fact-list">
        {outcome.map((fact) => <FactRow key={fact.id} fact={fact} disabled={busy} onCommand={onCommand} />)}
      </ul>
    </>}

    <div className="fact-add">
      <textarea
        rows={2}
        value={draft}
        placeholder="Add a fact — what the situation is, or what already happened…"
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); add(); } }}
        aria-label="Add a fact"
      />
      <button type="button" onClick={add} disabled={busy || !draft.trim()}>Add</button>
    </div>

    {task.openQuestions.length > 0 && <div className="questions">
      <div className="fact-group-label">Worth clarifying <span>optional — ignoring these keeps the agent's assumption</span></div>
      <ul className="question-list">
        {task.openQuestions.map((question) => <QuestionRow
          key={question.id}
          question={question}
          disabled={busy}
          canResearch={canResearch}
          onAnswer={(text) => { onAddFact(text); onCommand({ tag: "DismissQuestion", questionId: question.id }); }}
          onDismiss={() => onCommand({ tag: "DismissQuestion", questionId: question.id })}
          onResearch={() => onResearch(question.prompt)}
        />)}
      </ul>
    </div>}

    {staleRun && <div className="stale-hint">The facts changed since the last run.</div>}
  </section>;
}
