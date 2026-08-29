# Included C/D compatibility model

The reusable engine is game-agnostic; see `PROJECT_ARCHITECTURE.md`. This document
describes only the repeated C/D model that currently powers the application.

Each world samples uncertain payoffs, continuation probability, noise, optional
mechanism parameters, and one disposition per participant. Every pair then plays a
repeated simultaneous two-action match. Scores are normalized to each participant's
own attainable payoff range before winners are compared.

Supported payoff orderings:

- Prisoner's Dilemma: `T > R > P > S` and `2R > T + S`;
- Chicken / Snowdrift: `T > R > S > P`;
- Stag Hunt: `R > T > P > S`.

The adapter includes memory strategies, fixed teams, behavioral drift, observation
noise, voluntary exit, reputation, punishment, cheap talk, continuous environmental
feedback, and discrete game-state transitions. These are domain code in
`src/domain.ts`, `src/kernel.ts`, `src/reputation.ts`, and `src/adapters/repeated-game.ts`; none is
required by `src/monte-carlo.ts` or `src/topology.ts`.

`src/abc.ts` maps observed C/D outcomes to a likelihood and reuses the generic
conditioning primitive. New games should define their own world type, simulation
callback, observation likelihood, and summaries instead of extending this schema.

The research catalogue in `DYNAMIC_MODELS.md` is background material, not a list of
implemented engine features.
