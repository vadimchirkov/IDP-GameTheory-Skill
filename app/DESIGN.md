# Flumina UI Design System

This document is the visual contract for Flumina. The product motto is **“Map the currents. Choose your course.”** The interface should make a large space of possible futures feel navigable without turning the river metaphor into decoration. It is inspired by the precision and information hierarchy of Linear, but it is not a pixel-for-pixel copy.

## Product character

- Calm, dense, professional and native-feeling.
- The simulation result is the focal surface. Navigation stays quieter than content.
- River language describes the information architecture: currents are scenario families, branches are possible developments, and a course is a strategy. Use the metaphor in product language, not ornamental UI chrome.
- Dark mode only until a second theme is explicitly designed.
- Prefer familiar desktop-app patterns over decorative dashboard patterns.
- Prefer whitespace, alignment and hover surfaces over visible containers.
- Avoid glassmorphism, neon glows, large gradients, oversized cards and playful iconography.

## Layout and navigation

- Desktop uses a situations sidebar and one staged workspace. The workspace switches
  between `Context`, `Model`, and `Worlds`; these are steps in one flow, not competing
  sidebars or duplicate views.
- A visible situations sidebar owns its collapse button in the upper-left. When it is
  hidden, the workspace toolbar exposes one restore button. Never show both controls
  for the same action at once.
- The assistant is an optional right-hand drawer. It changes role with the active
  stage: context guide before a run and river analyst after a result exists.
- Mobile keeps `Situations` in the workspace toolbar and opens the list off-canvas.
- Global system settings live at the bottom of the situations sidebar.
- Run settings live in the workspace `…` menu. The Model stage owns model type,
  model review, world count, and the decisive Run action.
- Advanced or developer-only controls use native `<details>` progressive disclosure.

## Color tokens

| Role | Value |
|---|---|
| Canvas | `#171717` |
| Main sidebar | `#121212` |
| Context sidebar | `#151515` |
| Raised surface | `#202020` |
| Hover surface | `#272727` |
| Primary text | `#ececec` |
| Secondary text | `#8b8b8b` |
| Primary action | `#ffffff` |
| Success | `#67b99f` |
| Error | `#e47972` |
| Divider | `rgba(255,255,255,.055)` |

Use color for state and priority, not decoration. Sidebars are slightly dimmer so the result canvas stays dominant.

## Type, geometry and spacing

- System sans stack: Inter when available, then platform UI fonts.
- Body `13px / 1.45`; compact metadata `9–10px`; sidebar headings `12–14px`.
- Data uses tabular numerals. JSON uses the system monospace stack with slashed zeroes.
- Use weights around 540–620. Avoid faux bold and display serifs.
- Spacing scale: `4, 8, 12, 16, 24px`.
- Standard control height: `32–34px`.
- Standard interactive radius: `9–11px`; dialogs and floating drawers `16–18px`; structural panels stay square. Avoid pill shapes except status badges.
- Borders are exceptional: use them only when two adjacent regions genuinely need separation. Prefer background contrast and spacing. Shadows are reserved for modal and off-canvas elevation.

## Interaction

- Every icon-only button has an accessible name; decorative SVGs use `aria-hidden`.
- Pointer targets are at least `32×32px`.
- Hover and small state transitions use `160–200ms`; keyboard focus is immediate and clearly visible.
- Respect `prefers-reduced-motion`.
- A light, high-contrast button marks the next decisive action: create, confirm or run. Routine actions remain quiet.
- Scrollbars stay native, thin and low-contrast; do not add a custom scrolling dependency without a functional need.
- Dialog cancellation must not persist draft settings.

## Reusable implementation prompt

```text
Design and implement a dark-only professional simulation workspace combining Codex-like native restraint with Linear's precision and density, without copying either brand. Preserve one clear flow: situations sidebar, then Context → Model → Worlds in a single workspace, with an optional assistant drawer. Use layered near-black surfaces (#171717, #121212, #151515), high-contrast primary text (#ececec), muted metadata (#8b8b8b), and a light decisive action. Prefer spacing, alignment and quiet hover fills over borders or card containers. Use compact system sans typography, 4/8/12/16/24 spacing, 34–36px controls, 9–11px radii on interactive elements, and 16–18px radii only on floating dialogs and drawers. Keep structural panels square and navigation dimmer than the result. Use thin native-feeling line icons. Show the situations restore control only when that sidebar is hidden; put collapse at the upper-left inside the open sidebar. Put global settings at the bottom of the situations sidebar, run settings in the workspace overflow, and model controls in the Model stage. Reveal developer controls progressively with native details. Keep scrollbars native, thin and unobtrusive. No gradients, glassmorphism, neon, decorative glows, dashboard-card mosaics, or extra dependencies. Keep keyboard focus, semantic labels, 32px hit targets, reduced-motion behavior, desktop and mobile states fully working.
```

## References

- [Linear UI refresh](https://linear.app/changelog/2026-03-12-ui-refresh): calmer consistency, aligned headers/navigation, redrawn icons and dimmer sidebars.
- [Linear workspace settings](https://linear.app/docs/workspaces): workspace-level settings are anchored to the main workspace navigation.
- [Linear team settings](https://linear.app/docs/teams): contextual settings belong in the nearby overflow menu.
- [Linear preferences](https://linear.app/docs/account-preferences): interface preferences are centralized rather than repeated per view.
- [Linear Design DNA](https://www.opendesign.cc/en/sites/linear): useful visual analysis and prompt structure; values were verified and adapted rather than copied blindly.
