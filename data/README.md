# Flumina Benchmark Data

Live benchmarks (`K=3`, backtest `prev -> actual`) used to validate and calibrate
the simulation engine.

All datasets live in `data/raw/` and are consumed by `scripts/live-bench.mjs`.
The script first tries the project paths `data/raw/*`, then falls back to `/tmp/*` for CI.

## What's here

| File | Source | Version | Rows | Description |
|---|---|---|---|---|
| `dilemmaRL_all_data.csv` 29 MB | https://raw.githubusercontent.com/doerlbh/dilemmaRL/master/data/all_data.csv | `e1755d0` PRICAI 2022 | 168,386 | `my.decision`/`other.decision1`/`period` — lab IPD, 91,220 moves at `period>3` |
| `dyadic_mid_4.03.csv` 1.4 MB | https://correlatesofwar.org/wp-content/uploads/dyadic_mid_4.03_update.zip | MID 4.03 dyadic 1816-2014 | 10,357 dyad-disputes | `statea,stateb,year` — a `C=no dispute / D=dispute` series is built per dyad over `year` |
| `MIDA_5.0.csv` + `MIDB_5.0.csv` + `MIDI/MIDIP 5.0.csv` | https://correlatesofwar.org/wp-content/uploads/MID-5-Data-and-Supporting-Materials.zip | MID 5.0 | — | dispute/participant/incident level, for auditing |
| `CESv1Sender_2025c.csv` 35 KB | https://raw.githubusercontent.com/Trade-War-Lab/China-TIES/main/CESv1Sender_2025c.csv | CES v1 (Zhang & Shanks CMPS 2024) | 127 cases | `sender1,state2,startyear,endyear` — sanctions dyad-year `D=under sanctions` |
| `DF2011.csv` 138 KB | `R::stratEst::DF2011` / https://openicpsr.org/project/112401 | Dal Bó & Fréchette 2011 AER | 7,358 rows → 4,754 pairs | `id,game,period,choice,other.choice` — indefinitely repeated PD `δ=1/2,3/4` |
| `TIESv4.xls` 479 KB | https://sanctions.web.unc.edu/wp-content/uploads/sites/18834/2021/04/TIESv4-1.xls | Morgan et al 2014 TIES 4.0 | 1,412 cases → 482 dyads 4,922y | `sender1,targetstate,startyear,endyear` — full TIES 1945-2005 |

## SHA-256 prefixes (as of 2026-08-23)

```
971209ff CESv1Sender_2025c.csv
672be58b dilemmaRL_all_data.csv
9d26eedd dyadic_mid_4.03.csv
b881beb0 DF2011.csv
3ef2bc39 TIESv4.xls
fa00331f MIDA_5.0.csv
5189071e MIDB_5.0.csv
...
```

## How the benchmarks are reproduced — two levels

**A. Strategy move-level (K=3) — `scripts/live-bench.mjs` (`pred = prev` = TFT `provocable`):**

- **dilemmaRL**: `pred = other.decision1 (1->coop 0->defect NA->coop)`,
  `actual = my.decision`, filter `period>3`. Baseline `ALL-D 56.7%` → TFT 82.1%.
- **DF2011**: 4,754 pairs. Best constant baseline `ALL-D 55.2%` → TFT 87.7%.
- **MID**: dyad `(a,b)` -> `Set(year)` -> `seq[y] = D` if the year contains a
  dispute, otherwise `C`; 19,808 dyad-years, `ALL-C 81.3%` → TFT 85.6%.
- **China-TIES**: the same sequence construction for sanction years; 358
  dyad-years, `ALL-C 30.7%` (`ALL-D 69.3%`) → TFT 91.1%.

The script reports balanced accuracy, macro F1, and retention versus transition;
otherwise `ALL-C 81%` / `ALL-D 69%` inflate accuracy.

**B. Engine scenario-level (holdout, Brier/ECE/MAE) — `npx tsx src/bench-engine.ts`:**

- **Synthetic, 300 models (300 trials, 1 holdout):** the predicted winner matches
  the held-out winner 60.0% of the time versus a 50% coin baseline.
- **DF2011, 6 treatments:** engine cooperation-rate MAE is 10.6 percentage points
  (89.4% mean agreement), compared with 25.9 points for the historical-mean baseline.
- **dilemmaRL, 5 non-zero-delta groups:** cooperation-rate MAE is 5.4 percentage
  points (94.6% mean agreement), compared with 10.8 points for the historical mean.
- **MID/TIES proxies:** cooperation-rate agreement is 92.3% for MID and 98.5% for
  TIES. These are proxy fits, not independent forecasts of conflicts or sanctions.

A checks that repeated behavior carries an inertia signal. B checks calibration and
shows where explicit model elicitation is needed. Neither establishes causal or
out-of-domain predictive validity.

## Licenses / citations

- dilemmaRL: PRICAI 2022 doerlbh/dilemmaRL (MIT-like code, data CC).
- COW MID 5.0 / Dyadic 4.03: `Palmer et al. 2022 Conflict Management and Peace Science; Maoz et al. 2019 JCR 63(3) Dyadic MIDs v3.0`; COW terms: non-commercial, cite, no redistribution without permission.
- China-TIES: `Zhang & Shanks 2024 Conflict Management and Peace Science`, `github.com/Trade-War-Lab/China-TIES`, Minerva FA9550-21-1-0143.

## Not yet downloaded (BTS DB1B — airlines)

`BTS DB1B` + `Yale 50 routes 2019` require a manual pull via `transtats.bts.gov` (needs API key / bulk). In `README Benchmarks` still `preview synthetic 56.7%`.

## Running

```bash
node scripts/live-bench.mjs          # requires data/raw/* (fallback /tmp/*)
npx tsx src/bench-predictive.ts     # synthetic + split retention/transition
npx tsx src/verify-pack.ts          # deterministic verification pack
npx tsx src/cross_validate.ts && python3 scripts/cross_validate.py
```
