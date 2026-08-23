# Data — live benchmarks (K=3, backtest `prev -> actual`)

Все датасеты сохранены в `data/raw/` и используются `scripts/live-bench.mjs`.
Скрипт сначала пробует пути проекта `data/raw/*`, затем fallback `/tmp/*` для CI.

## Что лежит

| Файл | Источник | Версия | Rows | Описание |
|---|---|---|---|---|
| `dilemmaRL_all_data.csv` 29 MB | https://raw.githubusercontent.com/doerlbh/dilemmaRL/master/data/all_data.csv | `e1755d0` PRICAI 2022 | 168 386 | `my.decision`/`other.decision1`/`period` — lab IPD, 91 220 moves при `period>3` |
| `dyadic_mid_4.03.csv` 1.4 MB | https://correlatesofwar.org/wp-content/uploads/dyadic_mid_4.03_update.zip | MID 4.03 dyadic 1816-2014 | 10 357 dyad-disputes | `statea,stateb,year` — по `year` строится `C=no dispute / D=dispute` ряд на диаду |
| `MIDA_5.0.csv` + `MIDB_5.0.csv` + `MIDI/MIDIP 5.0.csv` | https://correlatesofwar.org/wp-content/uploads/MID-5-Data-and-Supporting-Materials.zip | MID 5.0 | — | dispute/participant/incident уровень, для аудита |
| `CESv1Sender_2025c.csv` 35 KB | https://raw.githubusercontent.com/Trade-War-Lab/China-TIES/main/CESv1Sender_2025c.csv | CES v1 (Zhang & Shanks CMPS 2024) | 127 cases | `sender1,state2,startyear,endyear` — sanctions dyad-year `D=under sanctions` |
| `DF2011.csv` 138 KB | `R::stratEst::DF2011` / https://openicpsr.org/project/112401 | Dal Bó & Fréchette 2011 AER | 7 358 rows → 4 754 pairs | `id,game,period,choice,other.choice` — indefinitely repeated PD `δ=1/2,3/4` |
| `TIESv4.xls` 479 KB | https://sanctions.web.unc.edu/wp-content/uploads/sites/18834/2021/04/TIESv4-1.xls | Morgan et al 2014 TIES 4.0 | 1 412 cases → 482 dyads 4 922y | `sender1,targetstate,startyear,endyear` — full TIES 1945-2005 |

## SHA256 (на 2026-08-23)

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

## Как воспроизводятся бенчи — два уровня

**A. Strategy move-level (K=3) — `scripts/live-bench.mjs` (`pred = prev` = TFT `provocable`, `src/predictive.ts:21`):**

- **human**: `pred = other.decision1 (1->coop 0->defect NA->coop)`, `actual = my.decision`, фильтр `period>3`. Baseline `ALL-D 56.7%` → TFT 82.1%.
- **MID**: диада `(a,b)` -> `Set(year)` -> `seq[y]= D if y in disputes else C` на `min..max` -> `19 808y, ALL-C 81.3%, TFT 85.6%`.
- **TIES**: `sender1-state2` -> `startyear..endyear` -> same `seq`, `358y, ALL-D 69.3% → TFT 91.1%`.

Смотри `balancedAccuracy/macroF1/retention vs transition` (`src/predictive.ts:21`) — иначе `ALL-C 81%` / `ALL-D 69%` инфлируют accuracy.

**B. Engine scenario-level (holdout, Brier/ECE/MAE) — `npx tsx src/bench-engine.ts`:**

- **Synthetic 300 models (300 trials, 1 holdout):** `winPct/100` как `p` vs `hit∈{0,1}` → Brier `0.23` vs coin `0.25`, ECE `0.05`, coop MAE `0.24`.
- **DF2011 6 treatments:** engine `cooperation.mean` vs observed rate per treatment → MAE naive `54.7pp` vs elicited wide-SET `31.9pp` vs hist-mean `25.9pp`. Wide-SET бьёт naive, но без `values/drift` не бьёт baseline — честный misfit.
- **MID/TIES generic PD:** `88%` vs MID 81% err 6pp (ок), vs TIES 54% err 33pp > coin — generic не tuned.

A — доказывает что IPD имеет сигнал (TFT≈inertia). B — доказывает калибровку движка и где нужна честная элицитация (SKILL wide ranges/SET).

## Лицензии / цитаты

- dilemmaRL: PRICAI 2022 doerlbh/dilemmaRL (MIT-like code, data CC).
- COW MID 5.0 / Dyadic 4.03: `Palmer et al. 2022 Conflict Management and Peace Science; Maoz et al. 2019 JCR 63(3) Dyadic MIDs v3.0`; условия COW: non-commercial, cite, no redistribution without permission.
- China-TIES: `Zhang & Shanks 2024 Conflict Management and Peace Science`, `github.com/Trade-War-Lab/China-TIES`, Minerva FA9550-21-1-0143.

## Что еще не скачано (BTS DB1B — airlines)

`BTS DB1B` + `Yale 50 routes 2019` требует ручного pull через `transtats.bts.gov` (требует API key / bulk). В `README Benchmarks` пока `preview synthetic 56.7%`.

## Запуск

```bash
node scripts/live-bench.mjs          # требует data/raw/* (fallback /tmp/*)
npx tsx src/bench-predictive.ts     # синтетика + split retention/transition
npx tsx src/verify-pack.ts          # 14 gates
npx tsx src/cross_validate.ts && python3 scripts/cross_validate.py
```
