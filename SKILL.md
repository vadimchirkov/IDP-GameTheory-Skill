---
name: flumina
description: >
  Use Flumina to rehearse a consequential choice under uncertainty or a repeated
  strategic interaction. Build an explicit model, evaluate alternatives in the
  same sampled worlds, and explain the recommendation, downside, and assumption
  most likely to change it. Use for "compare these options", "what should we do",
  "simulate this decision", "stress-test this plan", "war-game this", or "what
  happens if". Prefer Decision comparison; use the C/D adapter only when repeated
  mutual reactions are central.
---

# Flumina decision rehearsal

Flumina turns a prose situation into an inspectable model and runs it through
reproducible paired worlds. Your job is to frame the right comparison, keep uncertain
inputs honest, run the engine, and explain what changes the choice.

## The mode is chosen for you

Flumina classifies the situation itself; there is no model-type control in the product. The criterion
below is the one it applies, and it is worth knowing so you can tell when the classification is wrong
and reword the situation rather than looking for a switch.

Use **Decision comparison** when someone controls a choice among 2–5 actions. This
is the default, including cases with many stakeholders.

Use **Strategic interaction** only when parties repeatedly react to one another by
supporting or breaking a shared arrangement. Examples include deterrence,
negotiations, alliances, standards, price wars, and shared-resource governance.

Do not choose C/D merely because several parties appear in the story. If the user
asks which action they should take, start with Decision comparison.

## Decision workflow

### 1. Frame the smallest useful model

Identify:

- the decision maker;
- one concrete question;
- 2–5 mutually exclusive actions the decision maker can take;
- one measurable objective to maximize or minimize;
- 1–8 external uncertainties shared by every option;
- the evidence and assumptions behind the ranges.

Ask at most one question at a time, and only when its answer could change the model.
If the fact is unknown, use a broad range and record the assumption. Research public
facts only when they can narrow a material range; keep source claims separate from
judgment.

### 2. Build the model

When creating model JSON, read the maintained
[Decision example and field semantics](README.md#run-a-model-from-the-cli). Do not
invent fields outside that contract.

Model rules:

- An option is an action, not an outcome or scenario.
- A factor is external uncertainty, not an action or the objective itself.
- `baseline` is the option's objective range when every factor is at its midpoint.
- `impact` is the objective change from a factor's midpoint to its high end. The
  low end applies the opposite sign.
- For a minimized objective, a harmful high factor has positive impact and a helpful
  high factor has negative impact.
- Use a target only when a real threshold exists. Without one, Flumina recommends
  by lowest mean regret.
- Keep ranges wide when evidence is weak. Decimal precision is not evidence.

### 3. Validate and run

From the Flumina repository:

```bash
pnpm scenario model.json 600 --seed 42
pnpm scenario model.json 600 --seed 42 --visual
```

Use a fixed seed while improving the model so changes come from the model rather
than a new random draw. The visual report is written to `reports/visual.html`.

### 4. Interpret the result

Lead with four things:

1. the recommended action;
2. whether its lead is close;
3. its relevant downside (lower tail when maximizing, upper tail when minimizing);
4. the factor and regime that can change the recommendation.

When a target exists, explain target probability. Otherwise explain mean regret.
Use best-world share as a stability clue, not as a real-world forecast probability.
The tails and target probability assume factors move independently. When the
situation suggests they move together, say the reported spread is optimistic or
pessimistic accordingly rather than quoting the tail as settled.
If `stress.reversed` is false, say the one-factor stress test did not find a reversal;
do not claim the recommendation can never change.
If `failureBox` exists, state its two conditions, alternative, support, coverage, and
lift. Both conditions have been tested for relevance, so report them as a pair rather
than leading with one. Call it a holdout-checked pattern inside the model, not a
real-world law. If it is absent, do not infer that no joint failure region exists; the
quality gate may have hidden weak, undersampled, or one-factor candidates — a
one-factor vulnerability belongs to the stress lens instead.
Failure regions are only reliable from roughly 1000 trials; at the default 600 the
holdout is too small to confirm one, so a missing box says little at that setting.

End with the next information to verify or the decision condition to monitor. Keep
the model metrics in a short appendix when the user only wants a recommendation.

## Strategic interaction workflow

Use the C/D model only for repeated mutual reactions. Define 2–4 parties, a game
family, plausible dispositions, continuation, noise, and broad payoff ranges. The
AI-built web flow intentionally uses this compact core. Optional mechanisms such as
teams, reputation, punishment, exit, cheap talk, environmental feedback, tournament,
evolution, and spatial dynamics remain adapter operations documented in
`GAME_THEORY.md` and the example files.

Run the model with the same CLI command. For completed C/D interactions, existing
worlds can be conditioned on observations:

```bash
pnpm scenario model.json 600 --seed 42 \
  --observe-coop 0.4 --observe-winner NAME --observe-tol 0.15
```

Report who tends to come out ahead, whether cooperation holds, which assumption
moves the result, and how many effective worlds remain after conditioning. A small
effective sample means the observation does not fit the original model well.

## Guardrails

- Do not present simulation shares as measured future probabilities.
- Do not hide assumptions behind a confident recommendation.
- Do not invent causal effects from correlation or prose.
- Do not evaluate options in different worlds; paired worlds are the comparison.
- Do not add factors that cannot change an option or the objective.
- Do not turn every multi-party decision into a repeated game.
- Do not add adapters or mechanics to answer a framing problem.
- Preserve the user's language in the explanation and stable ASCII ids in JSON.

If the model cannot represent the decision without misleading simplification, say
what is missing and stop before running it.
