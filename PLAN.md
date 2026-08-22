# План развития IDP-GameTheory-Skill

## База (текущее)
Монте-карло 2–10 игроков, 20 темпераментов, 3 игры (PD/Chicken/Stag), детерминированный RNG, 600 миров, TEOB Run агрегат, бенчи live (COW MID, TIES, BTS, dilemmaRL), предиктивные метрики (acc/balAcc/macroF1/retention vs transition).

## Фазы

### Фаза A — Валидация + быстрые расширения (неделя 1-2) — ЭТОТ ПР
- **A1 Cross-validation Axelrod-Python** (1д): `scripts/cross_validate.py` vs `src/cross_validate.ts` — 6 стратегий (TFT/GTFT/WSLS/ALLD/ALLC/ZD) при T=5 R=3 P=1 S=0, 200 раундов x20 rep, порог 5% на winPct/cooperation. Fallback если нет Axelrod — сверить с эталонными числами из reference_axelrod.md.
- **A2 Snowdrift** (0.5д): `GameType += "snowdrift"` (`T>R>S>P`), `isValidPayoff`, прогон в `verify-pack` + `analysis`.
- **A3 Dynamic coalitions MVP** (2д): `ScenarioPlayer.betrayalProb?:[0,1]`, `handshakeSpoof?: number` — коллудер с вероятностью предает команду после k раундов. Только домен + kernel hook, без full handshake spoofing.
- **A4 Bench-report upgrade** (0.5д): `predictiveReport` уже done — прокинуть в `analysis` вывод.

### Фаза B — Видимость (неделя 2-3)
- B1 Heatmap/trajectory HTML (plotly) — `cooperation(w x noise)` 10x10 грид, trajectory по раундам, regime map.

### Фаза C — Пространство + память (неделя 3-5)
- C1 Memory-n (Hilbe 2017) — `memory_n: Record<window, p>` 16 чисел для n=2, JSON `handshake`.
- C2 Topology интеграция — `topology: {lattice/small_world/scale_free}` в ScenarioModel, `spatial.ts` → `analysis.ts`.
- C3 Эволюция `--evolve` — `run.ts` Moran + fixationProbability уже есть, прокинуть флаг.

### Фаза D — Тяжелое (месяц 2+)
- D1 LLM-агенты (`llm_agent` disposition, кэш, --llm-budget)
- D2 LOLA learner
- D3 Tournament mode + доп игры (Public Goods N-player, Trust)

## Порядок: A1 → A3 → B1 → A2 → C1 → C2 → C3 → D3 → D1 → D2
Причина: валидация → главная функц. дыра (fixed teams) → видимость → научная глубина.
