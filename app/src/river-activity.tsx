/**
 * The one loader of the app. Every wait — a run being calculated, branches being labeled, a chat
 * reply, a command in flight — shows this and nothing else, so "something is happening" always
 * looks the same. `compact` is the inline variant that sits inside a panel or a chat bubble.
 * Styles live with the rest of the app in styles.css (`.river-activity`, `.river-orbit*`).
 */
export function RiverActivity({ label, detail, compact = false }: { label: string; detail?: string; compact?: boolean }) {
  return <div className={`river-activity ${compact ? "compact" : ""}`} role="status" aria-live="polite">
    <svg className="river-orbit" viewBox="0 0 64 64" aria-hidden="true">
      <circle className="river-orbit-track" cx="32" cy="32" r="24" />
      <circle className="river-orbit-flow flow-a" cx="32" cy="32" r="24" pathLength="100" />
      <circle className="river-orbit-flow flow-b" cx="32" cy="32" r="18" pathLength="100" />
      <circle className="river-orbit-flow flow-c" cx="32" cy="32" r="12" pathLength="100" />
      <circle className="river-orbit-core" cx="32" cy="32" r="3" />
    </svg>
    <div><b>{label}</b>{detail && <span>{detail}</span>}</div>
  </div>;
}
