# Game Theory after Axelrod and successors: algorithms, strategies, variables, code

A practitioner's field guide for someone who wants to **turn all of it into code**.
From the base model (iterated prisoner's dilemma) to modern extensions
(zero-determinant strategies, evolutionary dynamics, networks, learning). Each
section gives just enough math to write a working program, and ends with what is
actually codable.

---

## 0. Map of the field

```
Axelrod (1980-84): IPD tournament → TIT FOR TAT wins
   │
   ├─ Traits of successful strategies: nice / provocable / forgiving / clear
   │
   ├─ Evolution: replicator dynamics, Moran process, evolution of cooperation
   │
   ├─ Nowak & Sigmund: WSLS (Pavlov), stochastic strategies, reactive
   │
   ├─ Press & Dyson (2012): zero-determinant (ZD), extortion, generous
   │
   ├─ Networks/space: spatial games, reciprocity on graphs
   │
   ├─ Learning: reinforcement learning, evolving finite automata, LSTM
   │
   └─ Tooling: Axelrod-Python library, ~240 ready-made strategies
```

---

## 1. Base model: iterated prisoner's dilemma (IPD)

### 1.1 The one-shot payoff matrix

Two players simultaneously choose **C** (cooperate) or **D** (defect).

|          | Opponent C | Opponent D |
|----------|-----------|-----------|
| **Me C** | R, R      | S, T      |
| **Me D** | T, S      | P, P      |

Axelrod's classic values: **T=5, R=3, P=1, S=0**.

Two conditions that make it a "dilemma":
1. `T > R > P > S` — defecting is always tempting round-by-round.
2. `2R > T + S` — mutual cooperation beats alternating exploitation.

Without the second condition, taking turns being exploited (C/D, D/C) would pay —
it is precisely this condition that makes cooperation a stable outcome.

### 1.2 Why it matters

In a *one-shot* game, D (defect) is the dominant strategy. In the *repeated* game
with an unknown horizon, the "shadow of the future" makes cooperation rational.
Axelrod showed empirically (via tournaments) that simple "nice" strategies win, not
clever exploiters.

### 1.3 The game engine (Python, no dependencies)

```python
from dataclasses import dataclass, field
from typing import Callable, List, Tuple

C, D = "C", "D"
# payoff[(my_move, opp_move)] = (my_score, opp_score)
PAYOFF = {
    (C, C): (3, 3),
    (C, D): (0, 5),
    (D, C): (5, 0),
    (D, D): (1, 1),
}

# Strategy = function of (my history, opponent history) -> next move.
Strategy = Callable[[List[str], List[str]], str]

def play_match(a: Strategy, b: Strategy, rounds: int) -> Tuple[int, int]:
    """One match of `rounds` rounds. Returns total scores (a, b)."""
    hist_a: List[str] = []
    hist_b: List[str] = []
    score_a = score_b = 0
    for _ in range(rounds):
        move_a = a(hist_a, hist_b)
        move_b = b(hist_b, hist_a)   # opponent sees its own history as "mine"
        sa, sb = PAYOFF[(move_a, move_b)]
        score_a += sa
        score_b += sb
        hist_a.append(move_a)
        hist_b.append(move_b)
    return score_a, score_b
```

Key design decision: **a strategy is a pure function `(my_hist, opp_hist) -> move`.**
That is enough for every deterministic and stochastic strategy with memory. For
learning strategies you'll need state (see §7) — then a strategy becomes an object
with `.move()` and `.update()` methods.

---

## 2. Axelrod's classic strategies (and their code)

### 2.1 The zoo

```python
import random

def tit_for_tat(mine, opp):
    "Cooperate on the first move, then copy the opponent's last move."
    return C if not opp else opp[-1]

def always_defect(mine, opp): return D
def always_cooperate(mine, opp): return C

def grim_trigger(mine, opp):
    "Cooperate until the opponent defects once. Then defect forever."
    return D if D in opp else C

def tit_for_two_tats(mine, opp):
    "Retaliate only after TWO defections in a row — tolerates random noise."
    return D if opp[-2:] == [D, D] else C

def two_tits_for_tat(mine, opp):
    "Answer one defection with two — a harsher deterrent."
    return D if D in opp[-2:] else C

def suspicious_tft(mine, opp):
    "Like TFT, but the first move is defection."
    return D if not opp else opp[-1]

def pavlov(mine, opp):
    "Win-Stay, Lose-Shift: repeat your move if the last round was a 'win'."
    if not mine:
        return C
    last_payoff = PAYOFF[(mine[-1], opp[-1])][0]
    # 'win' = got R(3) or T(5) -> stay; otherwise switch move
    if last_payoff in (3, 5):
        return mine[-1]
    return D if mine[-1] == C else C

def generous_tft(mine, opp, g=0.1):
    "TFT, but with probability g forgives a defection (cures noise)."
    if not opp:
        return C
    if opp[-1] == D and random.random() < g:
        return C
    return opp[-1]

def random_player(mine, opp, p=0.5):
    return C if random.random() < p else D
```

### 2.2 What Axelrod concluded about winners

Four traits worth keeping in mind as **design principles for a strategy**:

| Trait          | What it means                                | Code realization                       |
|----------------|----------------------------------------------|----------------------------------------|
| **Nice**       | never defects first                          | `mine==[] -> C`, D only as a response  |
| **Provocable** | punishes defection immediately               | `opp[-1]==D -> D`                       |
| **Forgiving**  | returns to C after punishing                 | holds no eternal grudge (not Grim)     |
| **Clear**      | predictable to the opponent                  | simple function, no hidden state       |

TIT FOR TAT satisfies all four, which is why it won both of Axelrod's tournaments.
This is not a theorem but an empirical fact for a *specific* set of opponents — an
important caveat (see §9).

---

## 3. The tournament: engine, metrics, ecology

### 3.1 Round-robin tournament

```python
from itertools import combinations
from collections import defaultdict

def run_tournament(strategies: dict, rounds=200, repetitions=5):
    """
    strategies: {name: strategy_fn}. Everyone plays everyone (and itself).
    Returns average score per match for each name.
    """
    totals = defaultdict(float)
    counts = defaultdict(int)
    names = list(strategies)
    for _ in range(repetitions):
        for n1, n2 in combinations(names, 2):
            s1, s2 = play_match(strategies[n1], strategies[n2], rounds)
            totals[n1] += s1; counts[n1] += 1
            totals[n2] += s2; counts[n2] += 1
        # self-play — important for ecology
        for n in names:
            s, _ = play_match(strategies[n], strategies[n], rounds)
            totals[n] += s; counts[n] += 1
    return {n: totals[n] / counts[n] for n in names}
```

### 3.2 Key tournament variables (the knobs you turn)

These are the "new variables" researchers introduce — they change the result
dramatically:

| Variable              | What it models                     | Effect                                    |
|-----------------------|------------------------------------|-------------------------------------------|
| `rounds`              | horizon / "shadow of the future"   | few rounds → defection pays               |
| `w` (δ, discount)     | probability the game continues     | equivalent of an infinite horizon         |
| `noise` (ε)           | execution noise (move gets flipped)| breaks TFT (echo of vengeance), loves GTFT|
| `repetitions`         | averaging for stochasticity        | statistical stability                     |
| population makeup     | who plays whom                     | no "objectively best" strategy            |

**Discounted horizon instead of fixed `rounds`:**

```python
def play_match_discounted(a, b, w=0.99, max_rounds=10000):
    "After each round the game continues with probability w."
    hist_a, hist_b, sa, sb = [], [], 0.0, 0.0
    weight = 1.0
    for _ in range(max_rounds):
        ma, mb = a(hist_a, hist_b), b(hist_b, hist_a)
        pa, pb = PAYOFF[(ma, mb)]
        sa += weight * pa; sb += weight * pb
        hist_a.append(ma); hist_b.append(mb)
        weight *= w
        if random.random() > w:      # the game ended
            break
    return sa, sb
```

**Noise — one line, but it changes the whole ecology:**

```python
def noisy(strategy, eps=0.05):
    "Wraps a strategy: with probability eps the move is flipped."
    def wrapped(mine, opp):
        m = strategy(mine, opp)
        if random.random() < eps:
            return D if m == C else C
        return m
    return wrapped
```

Under noise, two TFTs collapse into endless mutual vengeance (CD→DC→CD…), bleeding
points. Noise is the central argument for **forgiving** strategies (GTFT, Pavlov).

---

## 4. Evolutionary dynamics: from tournament to ecology

Axelrod took a second step: not "who wins a match" but "which strategy
**reproduces**". A strategy's share of the population grows in proportion to its
success.

### 4.1 Replicator dynamics (deterministic, continuous)

Let `x_i` be strategy i's share, `A` the average-payoff matrix of "i against j".
Fitness `f_i = Σ_j A_ij x_j`, mean fitness `φ = Σ_i x_i f_i`.

```
dx_i/dt = x_i (f_i − φ)
```

Above-average strategies grow, below-average ones die out. In code — a simple
Euler step:

```python
import numpy as np

def replicator(payoff_matrix, x0, steps=2000, dt=0.01):
    """
    payoff_matrix[i][j] = average score of strategy i against j.
    x0 = initial shares (sum = 1). Returns the trajectory of shares.
    """
    A = np.array(payoff_matrix, float)
    x = np.array(x0, float); x /= x.sum()
    traj = [x.copy()]
    for _ in range(steps):
        f = A @ x                # fitnesses
        phi = x @ f              # population mean
        x = x + dt * x * (f - phi)
        x = np.clip(x, 0, None); x /= x.sum()   # clean numerical drift
        traj.append(x.copy())
    return np.array(traj)
```

To get `payoff_matrix`, first run all pairs through `play_match` and average — that
is the bridge between §3 and §4.

### 4.2 Moran process (stochastic, finite population)

More realistic for finite populations and the notion of **fixation** (the
probability that a single mutant strategy takes over the whole population).

```python
def moran_step(pop: list, payoff, N):
    "One step: pick a 'parent' prop. to fitness, replace a random individual."
    fitness = []
    for i, s in enumerate(pop):
        # fitness = average payoff against the rest
        total = sum(payoff[s][pop[j]] for j in range(N) if j != i)
        fitness.append(total / (N - 1))
    # birth proportional to fitness
    probs = np.array(fitness); probs = probs / probs.sum()
    parent = np.random.choice(N, p=probs)
    death = np.random.randint(N)      # death is uniform
    pop[death] = pop[parent]
    return pop

def fixation_probability(mutant, resident, payoff, N=100, trials=1000):
    "Estimate the probability that 1 mutant displaces N-1 residents."
    wins = 0
    for _ in range(trials):
        pop = [resident] * (N - 1) + [mutant]
        while len(set(pop)) > 1:
            pop = moran_step(pop, payoff, N)
        if pop[0] == mutant:
            wins += 1
    return wins / trials
```

Neutral (random) fixation gives `1/N`. If the mutant's probability exceeds `1/N`,
selection favors it. This is a rigorous "evolutionary success" criterion that
replaces the fuzzy "wins the tournament".

### 4.3 Evolutionarily stable strategy (ESS)

A strategy S is evolutionarily stable if a population of S cannot be invaded by a
small fraction of mutants. Formally, S is an ESS against mutant T if:
`E(S,S) > E(T,S)` **or** `E(S,S)=E(T,S) and E(S,T) > E(T,T)`.

In noisy IPD there often is no pure ESS — the population cycles through
ALLD → TFT → GTFT/cooperators → ALLD (free-riders parasitize the trusting, the
provocable beat them, those soften — and the cycle repeats).

---

## 5. Stochastic memory-1 strategies (Nowak–Sigmund)

A huge class of strategies is fully described by **four cooperation probabilities**,
one for each of the four outcomes of the previous round:

```
p = (p_CC, p_CD, p_DC, p_DD)
```

where `p_XY` = P(cooperate | last round I played X, opponent played Y).

This is a compact parameterization — you can **optimize a vector of 4 numbers**
instead of searching over code. Famous points in this cube:

| Strategy       | (p_CC, p_CD, p_DC, p_DD) |
|----------------|--------------------------|
| Always Defect  | (0, 0, 0, 0)             |
| Always Coop    | (1, 1, 1, 1)             |
| TFT            | (1, 0, 1, 0)             |
| GTFT           | (1, g, 1, g)             |
| WSLS / Pavlov  | (1, 0, 0, 1)             |
| Grim           | (1, 0, 0, 0)             |

```python
def memory_one(p):
    "Factory of memory-1 strategies. p = (p_CC, p_CD, p_DC, p_DD)."
    idx = {(C, C): 0, (C, D): 1, (D, C): 2, (D, D): 3}
    def strat(mine, opp):
        if not mine:
            return C                      # nice start by default
        return C if random.random() < p[idx[(mine[-1], opp[-1])]] else D
    return strat
```

Analytically, the stationary distribution over the 4 outcomes is computed via a
Markov chain — this enables exact (non-simulated) payoff estimates and underlies ZD.

---

## 6. Zero-Determinant strategies (Press & Dyson, 2012)

The 2012 breakthrough: a memory-1 player can **unilaterally impose a linear
relationship** between their own score `s_X` and the opponent's score `s_Y`:

```
α·s_X + β·s_Y + γ = 0
```

regardless of the opponent's strategy. This follows from a determinant property of
the Markov matrix (hence "zero-determinant").

### 6.1 Two famous subclasses

- **Extortion:** imposes `s_X − P = χ·(s_Y − P)` with `χ > 1`. Any opponent payoff
  above the punishment P gives the extortioner χ times more. A rational opponent,
  maximizing itself, is forced to maximize the extortioner too.
- **Generous ZD:** imposes a relationship where the extortioner shares the surplus
  (`χ < 1` in the mirror form). Such strategies are evolutionarily stable and
  promote cooperation — it is these, not extortion, that survive in a population.

### 6.2 Code: an extortion-strategy generator

```python
def zd_extortion(chi=2.0, R=3, S=0, T=5, P=1, phi=0.15):
    """
    Returns a memory-1 vector p imposing s_X - P = chi*(s_Y - P).
    phi — free scaling parameter (must keep p in [0,1]).
    """
    p1 = 1 - phi * (chi - 1) * (R - P) / (P - S)      # p_CC
    p2 = 1 - phi * (1 + chi * (T - P) / (P - S))      # p_CD
    p3 = phi * (chi + (T - P) / (P - S))              # p_DC
    p4 = 0                                             # p_DD
    p = (p1, p2, p3, p4)
    assert all(0 <= v <= 1 for v in p), f"phi too large: {p}"
    return memory_one(p)
```

Practical takeaway for code: ZD strategies are **analytically derived vectors `p`**
that you plug into the same `memory_one`. So the whole §5 engine already runs them;
ZD merely adds formulas for choosing `p`. To verify the strategy truly imposes a
line, regress `s_X` on `s_Y` over matches against random opponents — the slope
should come out `≈ χ`.

---

## 7. Learning and evolving strategies (the "grown-up" code)

Here a strategy stops being a pure function and gains state.

### 7.1 Finite-state machines (FSM) + genetic algorithm

Axelrod himself evolved strategies with a genetic algorithm. The modern approach is
to represent a strategy as a **Moore machine**: state → move, transition depends on
the opponent's move.

```python
@dataclass
class FSMStrategy:
    """Moore machine: transitions[(state, opp_last)] = (next_state, my_move)."""
    transitions: dict
    start_state: int
    start_move: str = C
    _state: int = field(default=None, init=False)

    def reset(self): self._state = self.start_state
    def move(self, opp_last):
        if opp_last is None:
            self._state = self.start_state
            return self.start_move
        self._state, m = self.transitions[(self._state, opp_last)]
        return m
```

The gene is the transition table. Fitness is average tournament score.
Crossover/mutation over the table → evolution. TFT is a 1-state machine; Pavlov is
a 2-state one. GA reliably "rediscovers" TFT and WSLS, and — under noise — forgiving
variants.

### 7.2 Reinforcement learning (Q-learning)

State = recent history (e.g. the opponent's move last round), action = C/D, reward =
the round's payoff.

```python
class QLearner:
    def __init__(self, alpha=0.2, gamma=0.95, eps=0.1):
        self.Q = defaultdict(lambda: {C: 0.0, D: 0.0})
        self.alpha, self.gamma, self.eps = alpha, gamma, eps
        self.prev = None   # (state, action)

    def state(self, opp_hist):
        return opp_hist[-1] if opp_hist else "start"

    def move(self, mine, opp):
        s = self.state(opp)
        if random.random() < self.eps:
            a = random.choice([C, D])
        else:
            a = max((C, D), key=lambda x: self.Q[s][x])
        self._pending = (s, a)
        return a

    def update(self, reward, opp):
        "Call after the round, knowing the reward and the new state."
        s, a = self._pending
        s2 = self.state(opp)
        best_next = max(self.Q[s2].values())
        self.Q[s][a] += self.alpha * (reward + self.gamma * best_next - self.Q[s][a])
```

Against fixed opponents, Q-learning converges to a sensible policy (against ALLD it
learns to always D, against TFT it learns to cooperate). In self-play of two
Q-learners you get nontrivial dynamics, including tacit collusion.

### 7.3 Further up the complexity ladder

- **LSTM / transformer agents** — a strategy as a neural net over the whole history.
  Justified only when history is long and holds patterns memory-k misses.
- **Multi-agent RL (MARL)** — a population learns simultaneously; used to study
  emergent cooperation, ZD-like behavior as a learned policy.
- **Opponent modeling** — the agent builds a model of the opponent and best-responds.

Practical advice (lazy but honest): for 90% of research questions, memory-1 vectors
(§5) and FSM+GA (§7.1) are enough. Reach for RL/neural nets only once you've proven
the simpler class doesn't capture the effect you need.

---

## 8. Spatial and network games

Axelrod and Nowak showed: the **structure of interactions** is a variable in its own
right. Cooperation survives on a lattice/graph where it dies out in a "well-mixed"
population, because cooperators form clusters and mostly play each other.

The model:
- Agents on graph nodes (lattice, small-world, scale-free).
- Each plays IPD with all neighbors, sums the scores.
- Update: a node copies the strategy of its most successful neighbor (imitation) or
  uses a Moran/Fermi rule.

```python
def fermi_update(my_payoff, neighbor_payoff, K=0.1):
    "Probability of adopting a neighbor's strategy (Fermi rule)."
    return 1.0 / (1.0 + np.exp((my_payoff - neighbor_payoff) / K))
```

It codes up as a cellular automaton: a grid of strategies + two passes (compute
scores, then update). The "new variable" here is the topology and the update rule;
the outcome (share of cooperators) is extremely sensitive to them.

---

## 9. A critical look: what Axelrod did NOT prove

It matters that the code doesn't lie about the conclusions:

1. **"TFT is optimal" — false.** TFT won *specific* tournaments with a *specific*
   field. Against an ALLD-heavy population it loses on the opening; under noise the
   forgiving beat it; one-on-one, ZD extortioners exploit it.
2. **Tournament victory ≠ evolutionary stability.** Different criteria (§4.2, §4.3)
   yield different winners. Always state *which* criterion you use.
3. **Collective/team strategies** (later) showed: a group of colluding agents with a
   secret "handshake" can push their own champion (Southampton, 2004 tournament) —
   friend/foe recognition breaks naive ecology.
4. **Parameter sensitivity** (T,R,P,S, noise, horizon) means: run any conclusion
   over a parameter grid, not a single point.

Hence the rule for experiments: **always vary (a) population makeup, (b) noise,
(c) horizon, (d) success criterion** and see whether the conclusion holds.

---

## 10. Tooling: don't reinvent the wheel

**`axelrod` (Axelrod-Python)** — a mature library: ~240 strategies, tournaments,
Moran processes, noise, probabilistic end, ZD, visualization. For serious work use
it; the hand-rolled engine in this document is for understanding and small
experiments.

```bash
pip install axelrod
```

```python
import axelrod as axl

players = [axl.TitForTat(), axl.Defector(), axl.Cooperator(),
           axl.Grudger(), axl.WinStayLoseShift(), axl.ZDExtort2()]

# Tournament
tournament = axl.Tournament(players, turns=200, repetitions=20, noise=0.05)
results = tournament.play()
print(results.ranked_names)

# Evolution (Moran process)
mp = axl.MoranProcess(players, turns=200)
mp.play()
print(mp.winning_strategy_name)
```

When your own engine is enough: learning, visualization, nonstandard rules (teams,
recognition, custom graphs). When to reach for `axelrod`: reproducible tournaments,
a large opponent zoo, publishable results.

---

## 11. A mini research program (what to run today)

One self-checking script tying §1-§4 together. Copy into `ipd.py`, run
`python ipd.py`:

```python
if __name__ == "__main__":
    strategies = {
        "TFT": tit_for_tat,
        "ALLD": always_defect,
        "ALLC": always_cooperate,
        "Grim": grim_trigger,
        "Pavlov": pavlov,
        "GTFT": generous_tft,
        "TF2T": tit_for_two_tats,
    }

    print("== Clean tournament ==")
    res = run_tournament(strategies, rounds=200, repetitions=10)
    for n, s in sorted(res.items(), key=lambda kv: -kv[1]):
        print(f"{n:8s} {s:7.2f}")

    print("\n== Tournament with 5% noise ==")
    noisy_strats = {n: noisy(f, 0.05) for n, f in strategies.items()}
    res_n = run_tournament(noisy_strats, rounds=200, repetitions=10)
    for n, s in sorted(res_n.items(), key=lambda kv: -kv[1]):
        print(f"{n:8s} {s:7.2f}")

    # Self-check: TFT vs ALLC should yield mutual cooperation (~3/round)
    a, _ = play_match(tit_for_tat, always_cooperate, 100)
    assert 295 <= a <= 300, a
    # ALLD vs ALLC exploits to the max (5/round)
    d, _ = play_match(always_defect, always_cooperate, 100)
    assert d == 500, d
    # TFT vs ALLD: 1 naive C, then mutual D -> ~99
    t, _ = play_match(tit_for_tat, always_defect, 100)
    assert t == 99, t
    print("\nself-check OK")
```

Expected qualitative result: without noise the "nice" strategies lead
(TFT/Pavlov/GTFT); with noise TFT sags (echo of vengeance) while GTFT/TF2T/Pavlov
rise — exactly the forgiveness effect they were invented for.

---

## 12. Summary: which "variables" to introduce and what they buy you

| Lever                          | Section | Effect you turn it for                  |
|--------------------------------|---------|-----------------------------------------|
| Matrix (T,R,P,S)               | §1      | strength of the dilemma, cooperation threshold |
| Horizon `rounds` / discount `w`| §3      | "shadow of the future"                  |
| Noise `ε`                      | §3      | reward for forgiveness, penalty for harshness |
| memory-1 vector `p`            | §5      | a continuous strategy space             |
| ZD parameter `χ`               | §6      | extortion ↔ generosity                  |
| Dynamics (replicator/Moran)    | §4      | "wins" → "survives/fixates"             |
| Graph topology                 | §8      | clustering of cooperators               |
| Learning (Q/GA/RL)             | §7      | emergent, non-invented strategies       |
| Friend/foe recognition         | §9      | team/collective effects                 |

Everything in the table is code, not philosophy. Start with §11, add one lever at a
time, and watch how cooperation breaks or strengthens.
```
