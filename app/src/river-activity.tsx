/**
 * The one loader of the app. Every wait — a run being calculated, branches being labeled, a chat
 * reply, a command in flight — shows this and nothing else, so "something is happening" always
 * looks the same. `compact` is the inline variant that sits inside a panel or a chat bubble.
 *
 * The mark is a lit sphere flooded with colour that drifts through the spectrum. `surface` is the
 * layer drawn on it — the flumina, the Titan-like channel networks — clipped to the disc and sitting
 * under the limb shadow, so it darkens towards the edge with everything else. Styles: styles.css.
 */

import type { ReactNode } from "react";

const R = 24, CX = 32, CY = 32;   // the sphere inside the 64x64 viewBox

export function RiverActivity({ label, detail, compact = false, surface }: { label: string; detail?: string; compact?: boolean; surface?: ReactNode }) {
  return <div className={`river-activity ${compact ? "compact" : ""}`} role="status" aria-live="polite">
    <svg className="river-orbit" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <radialGradient id="planet-body" cx="34%" cy="27%" r="80%">
          <stop offset="0%" stopColor="#4c586b" />
          <stop offset="45%" stopColor="#232935" />
          <stop offset="100%" stopColor="#070910" />
        </radialGradient>
        <radialGradient id="planet-limb">
          <stop offset="62%" stopColor="#000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000" stopOpacity=".62" />
        </radialGradient>
        <radialGradient id="planet-spec" cx="31%" cy="25%" r="34%">
          <stop offset="0%" stopColor="#fff" stopOpacity=".2" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="planet-flood" cx="36%" cy="30%" r="76%">
          <stop offset="0%" stopColor="hsl(186 85% 64%)" stopOpacity=".95" />
          <stop offset="55%" stopColor="hsl(268 72% 58%)" stopOpacity=".72" />
          <stop offset="100%" stopColor="hsl(332 66% 44%)" stopOpacity=".3" />
        </radialGradient>
        <clipPath id="planet-clip"><circle cx={CX} cy={CY} r={R} /></clipPath>
      </defs>
      <circle cx={CX} cy={CY} r={R} fill="url(#planet-body)" />
      <g className="river-flood"><circle cx={CX} cy={CY} r={R} fill="url(#planet-flood)" /></g>
      {surface && <g clipPath="url(#planet-clip)">{surface}</g>}
      <circle cx={CX} cy={CY} r={R} fill="url(#planet-limb)" />
      <circle cx={CX} cy={CY} r={R} fill="url(#planet-spec)" />
    </svg>
    <div><b>{label}</b>{detail && <span>{detail}</span>}</div>
  </div>;
}
