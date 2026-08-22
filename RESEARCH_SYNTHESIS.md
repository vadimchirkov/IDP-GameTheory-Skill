# Синтез исследований: что реализовывать, в каком порядке и почему

> Глубокий разбор всех предложений из `PROJECT_ARCHITECTURE.md §§5-7`, `case_A_*`, `reference_axelrod.md` и `more-things.md §§5.5-17`. Каждый пункт прогнан через 3 фильтра: **научная ценность × стоимость × совместимость**, затем три итерации упорядочивания. Итог — экологичная последовательность без смешивания гипотез.

Статус: `teob-ts@0.2.2` (`teob-core` + `teob-inmem` сейчас, `teob-sqlite→postgres` далее, `teob-projection/http/ai` по потребности). Скилл `game-theory-scenarios/` уже на `src/kernel.ts|analysis.ts|run.ts`. Ниже — что добавлять дальше.

---

## 1. Инвентарь: 14 кандидатов

| # | Источник | Идея | Суть | Зависит от |
|---|----------|------|------|------------|
| A | PA §5 | **team/colluder** | `team:"coalition-1"` + `colluder` (C своим, provocable чужим), метрики `total` vs `per-capita` + `champion` | 9 базовых стратегий |
| B | PA §6 | **values/drift** | `lean∈[-1,1]` (крен) + `drift` после наблюдаемого хода; порядок `strategy→lean→noise→история` | детерминизм Rng |
| C | MT §5.5 | **memory-n** | `probs: Map<window(n)→P(C)>`, размер `2^(2n)`, Hilbe 2017: оптим. `n` зависит от популяции, лишняя память ≠ бонус | memory-1 |
| D | MT §6.3 | **generous ZD (Stewart-Plotkin)** | `s_X-R=χ(s_Y-R), χ<1` (ZDGTFT-2), формулы `p_CC..p_DD` через `χ,φ` | memory-1 (§6.2) |
| E | MT §16.1 | **Gradual / cTFT / Detective / Prober** | Gradual n×D + 2×C, cTFT (признание собственного шума), Detective `[C,D,C,C]→TFT/ALLD`, Prober-зонд | 9 стратегий |
| F | MT §8.5 | **spatial/topology** | Решётка Nowak-May 1992 + scale-free (Santos-Pacheco) + small-world (Watts-Strogatz), условие `b/c>k` (Ohtsuki 2006), EFE `imitate-best / Fermi 1/(1+exp((my-neighbor)/K))` | kernel tournament |
| G | MT §9.5 | **Southampton collective** | 5–10 ходов handshake `HANDSHAKE=[D,D,C,C,D]`, `master:C / slave:D`, жертва ради чемпиона; Jennings: 20 коллудеров достаточно | A (team) |
| H | MT §7.4 | **LOLA** | `my_params' = lr*(grad_self + η·grad_opp_response)`, эмерджентный TFT в self-play, побеждает независимый Q-learning | Q-learning §7.2 |
| I | MT §7.2+§17 | **Q-learning / FSM+GA** | `Q[state=(opp_last)]→C/D`, `FSM(Moore)+GA` — Axelrod 1987 «выращивает» TFT/WSLS | — |
| J | MT §14.1 | **adaptive coop → Glynatsi 2024** | `p(C) ≈ aggregate p(C) популяции`, 195 стратегий meta-анализ: нет универсального победителя, победитель контекстуален | population mix |
| K | MT §14.2 | **LLM-агенты IPD** | `llm_strategy(mine[-5:],opp[-5:],prompt)→C/D` (GPT-4o/Claude/Gemini/Llama 2024-26), чувствительность к обрамлению | teob-ai |
| L | PA §3.2 | **agent-mode SimulationRun+Participant** | `SimulationRun: RoundOpened→RequestMove→MoveSubmitted→RoundResolved→ReceiveOutcome`, per-агрегатный `Participant` с `MoveChosen/OutcomeRecorded`, `ctx.ask/tell`, `ReplyDeferred` | teob-core EffectControl |
| M | MT §15 | **доменные рескины** | BitTorrent TFT, вакцины/рыбалка/цены/гонка вооружений, EV-grid feeder blackout `P` | F (топология) |
| N | MT §17 | **axelrod-python как оракул** | 240 стратегий как референс, не реимплементировать, использовать для сверки | — |

PA=`PROJECT_ARCHITECTURE.md`, MT=`more-things.md`.

---

## 2. Три фильтра ценности (1 проход)

### 2.1 Научная ценность (что меняет вывод)

| Класс | Оценка | Почему |
|-------|--------|--------|
| **Высшая** — меняет «кто побеждает» | F, D, G, A | Пространство спасает кооперацию без памяти (Nowak-May); generous ZD объясняет устойчивость vs extortion; Southampton ломает наивную экологию; team — единственный способ моделировать коалиции, без него N>2 — артефакт round-robin |
| **Высокая** — уточняет или обобщает | C, E, J, H | memory-n показывает немонотонность памяти; Gradual/cTFT — сильнейшие реалистичные стратегии при шуме; adaptive — единственный количественный критерий Glynatsi; LOLA — качественный разрыв Q vs LOLA |
| **Средняя** — ниша/иллюстрация | B, I, M | values/drift — поведенческая пластичность, но «ещё две ручки» на всю популяцию; FSM+GA — переоткрывает TFT, но требует настройки GA; рескины — контент, не механизм |
| **Низкая / рискованная сейчас** | K, N | LLM — высокая дисперсия по промпту/модели (Pal 2026), дорогая, не воспроизводимая без фиксации модели/промпта; axelrod-python — полезна как сверка, не как цель |

**Урок Glynatsi 2024 (MT §14.1, §Замечание):** любой вывод о «лучшей» стратегии без фиксации `(a) популяции (b) критерия (турнир/репликатор/фиксация Moran) (c) шума и горизонта` — артефакт. Поэтому рычаги из таблицы `§12/Итоговая` ценны только в сетке параметров.

### 2.2 Стоимость / риск

| Дешево (дни, без TEOB) | Средне (неделя, TEOB codec/timers) | Дорого (недели, внешние зависимости) |
|------------------------|------------------------------------|--------------------------------------|
| E (просто функции `(mine,opp,rng)=>Move`), D (4 формулы → `memory_one`), J (1 функция оценки `p_opp_C`) | A (`team` + `codecWithUpcasts`, метрики total/per-capita, champion), B (`lean/drift` + `deriveSeed` изоляция, sensitivity per-player), C (карта окон `2^(2n)`, тесты Hilbe), F (grid + 2 топологии + `imitate-best/Fermi`) | G (совместно с A + протокол + симуляция Southampton 60 vs 20), H (градиенты, `eta`, стабилизация Zhao 2022), K (OpenAI API, `teob-ai:agentFlowAggregate`, промпт-чувствительность), L (два агрегата + `ReplyDeferred`+`sync`), M (EV feeder граф — нужен реальный `case_D`) |

**Риски детерминизма (PA §6.1):** B и E с состоянием (`gradual._state`, `contrite_tft._intent`) ломают чистоту `Strategy` если хранить глобально. Требует либо `Strategy` как объект с `reset()` (MT §7.1 FSM), либо замыкание с `Rng` и `derivedSeed` без `random.random()` — иначе `seed=42` плывёт. Это прямое требование `teob-ts/docs/core.md: apply must be pure, decide is async`.

### 2.3 Совместимость (что с чем нельзя смешивать)

```
F (spatial) ━━ несовместим с well-mixed tournament одновременно — это две конфигурации kernel'а (выбор в RunConfig)
A (team)    ━━ ортогонален F и B, но G требует A
G (Southampton) ── требует A (team) + E (handshake как стратегия с памятью последних 5 ходов)
B (values)  ── конфликтует с A в одном PR: невозможно атрибутировать эффект (PA §6 Оценка)
C (memory-n) ── расширяет D (ZD — частный случай memory-1), конкурирует за «память» с I (FSM/Q)
H (LOLA)    ── требует I (Q-learning) и бессмысленна без MARL популяции; несовместима с простым replicator
K (LLM)     ── ортогоналена всему, но требует L (agent-mode) и teob-ai; ставить только после стабилизации всех аналитических механизмов
J (adaptive)── зависит от текущего mix'а популяции — ставить после F/A чтобы mix был нетривиален
```

**Вывод 1 прохода:** дешёвые обобщения памяти/ZD/зоопарк — высокий ROI, дорогие MARL/LLM — низкий ROI до стабилизации базы.

---

## 3. Три итерации упорядочивания

### Итерация 1 — «наивный научный порядок» (по ссылкам)
memory-n → generous ZD → LOLA → spatial → Southampton → LLM. **Провал:** смешивает гипотезы (memory-n+spatial+team в одном релизе → не атрибутируемо), ставит LLM до фиксации команд.

### Итерация 2 — «инженерный порядок teob-ts» (снизу вверх по слоям)
core → inmem → sqlite → projection → http → ai. **Провал:** откладывает всю науку (team/generous ZD) ради инфраструктуры (http, postgres) которая сейчас не нужна (PA §7.5).

### Итерация 3 — «экологичная» (научная гипотеза за раз + teob-слой по потребности)
Критерий PA §7: *каждый шаг — строгий суперсет предыдущего, зелёный `pnpm test`, одна гипотеза*. Отсортировано по `ценность/стоимость` с учётом зависимостей.

---

## 4. Рекомендуемая последовательность (7 фаз, 2 ветки)

```
Phase 0  (сделано): pure kernel + 9 стратегий + 3 игры + Rng/deriveSeed + Monte-Carlo + Run(timers/snapshotEvery:25)
  │
  ├─→ Phase 1 (дёшево, 2-3 дня): Зоопарк + memory-1 фундамент          [E + D + C-скелет]
  ├─→ Phase 2 (средне, 1 неделя): Фиксированные команды                [A]  ← первая смена критерия победы
  ├─→ Phase 3 (средне, 1 неделя): Поведенческий крен                 [B]  ← вторая смена поведения
  ├─→ Phase 4 (средне, 1 неделя): Пространство                        [F]  ← смена структуры взаимодействий
  └─→ Phase 5 (дёшево, 3 дня): Адаптивность к популяции               [J]  ← стратегия-наблюдатель
        │
        ├─ Ветка R (исследования RL, опционально):  I → H
        └─ Ветка G (история/игра, опционально):     G (+ handshake) → M (рескины/EV-grid) → K (LLM)
              L (agent-mode) только для G/K где нужен ctx.ask/ReplyDeferred/teob-ai
```

Детально:

### Phase 1 — Зоопарк и память (E + D + C-скелет) — *следующий шаг*
**Что:** `gradual` (Beaufils 1996 — победитель шумных турниров, `punish n×D + calm 2×C` без глобального `_state`, а как `(mine,opp,rng)` с подсчётом `opp.count(D)` и фазой), `contrite TFT` (признание собственного шума), `Detective [C,D,C,C]→TFT/ALLD`, доработка `Prober` → 13 стратегий. Параллельно: `zd_generous(chi<1)` по формулам MT §6.3 (ZDGTFT-2) + общий `memory_n(probs,n)` каркас (MT §5.5) с `n=1` как `memory_one(p)`, `n=2` как опция для численных экспериментов Hilbe.

**Почему первым:** стоимость ≈0 (`(mine,opp,rng)=>Move`), не требует upcast/TEOB, открывает ворота для всех тестов MT §16.1/§5.5/§6.3, проверяет гипотезу «forgiveness спасает кооперацию при шуме» + «щедрость спасает ZD». `teob-ts`: только `teob-core` (чистые функции), `AggregateTestKit` для `gradual` без глобального состояния.

**Ворота:** `gradual` vs TFT при `noise=0.02` не проигрывает; `cTFT` сохраняет >90% C в self-play с шумом; `zd_generous(χ=0.5)` в репликаторе вытесняет `ZDExtort2` (MT §6.3 эксперимент); `memory_n(n=2)` при `n=1` популяции не доминирует (Hilbe 2017).

### Phase 2 — Фиксированные команды (A) — *первая смена критерия*
**Что:** `ScenarioPlayer.team?:"solo"`, `colluder` как обёртка `(sameTeam ? C : provocable)`, kernel выбирает обёртку по `team` пары, не меняя `Strategy` сигнатуру (PA §5). Метрики `winPctTeam(total)` + `winPctTeam(perCapita)` + `champion` (личный лидер). `codecWithUpcasts([upcast("RunStarted","RunStarted",(old)=>({...old, team:"solo"}))])` чтобы старые журналы читались (docs `core.md: Event Upcasting`).

**Почему вторым:** без команд N>2 — артефакт round-robin; Southampton (G) невозможен; это смена *критерия победы*, не поведения — изолируема от B. `teob-ts`: остаётся `teob-inmem`, добавляется только upcast.

**Ворота:** 2 `colluder` vs 2 `provocable` при `noise=0.05` побеждают по `total`; `team` отсутствует → старый подсчёт; разные размеры команд показывают расхождение `total vs perCapita`.

### Phase 3 — Крен и дрейф (B) — *вторая смена поведения*
**Что:** `players[].values?:Range` → `lean∈[-1,1]`, `structure.drift?:Range` (выбрать одну семантику: общий vs per-player, PA §6.3), порядок `baseStrategy→lean flip→noise→drift update` (PA §6). Изоляция RNG: при `[0,0]` нулевые `rng.unit()` не вызываются (derived seed), иначе `seed=42` плывёт. Sensitivity per-player/min-max, не средний `values`.

**Почему третьим, отдельно от A:** «ещё две ручки на всё» (PA §6 Оценка) + меняет все 9+4 стратегий; смешанный PR A+B не атрибутируем. `teob-ts`: в batch — локальный `lean` внутри `playMatch`; в agent-mode (будущее) — часть `Participant` state, новый `runId` с `parentRunId` а не глобальная память.

**Ворота:** `lean=-1,noise=0 → trusting→D`, `lean=+1 → exploitative→C`, `drift>0` снижает C у `forgiving` против ALLD, `[0,0]` бит-в-бит с прежним seed.

### Phase 4 — Пространство (F) — *смена структуры*
**Что:** `grid:N×N` вместо `shares`, `tournament` → `play vs neighbours`, update `imitate-best / Fermi K=0.1` (MT §8.5), топологии `grid_2d(periodic) → watts_strogatz → barabasi_albert` (networkx-подобные генераторы на TS), условие `b/c>k` (Ohtsuki 2006). Конфиг `Run` получает `topology, neighbourhood, updateRule`, журнал — `GenerationCompleted{coopRate, clusterCount}` + `Painted/EventCardPlayed` для шаринга реплеев (case_A_spatial §6).

**Почему четвёртым:** требует смены kernel интерфейса (несовместим с well-mixed в одном прогоне), но даёт самый наглядный качественный эффект (Nowak-May кластеризация) и открывает M. `teob-ts`: остаётся 1 агрегат `Run`, kernel чистый, проекция — `strategyShares` → `coopRate+clusterCount`; frame storage — `initialGrid+seed+interventions` (пересчёт дешёвый) + опц. diff'ы.

**Ворота:** одиночный D в море C растёт симметрично; `b≈1.85` персистентные кластеры; `b↑` кооперация исчезает.

### Phase 5 — Адаптивность (J) — *наблюдатель*
**Что:** `adaptive_coop_rate` (MT §14.1): `p_opp_C = opp.count(C)/len`, `target=0.5+(p_opp_C - memory)`, `C if rng<target`. Это кодируемый вывод Glynatsi 2024 «p(C) стратегии ≈ p(C) популяции».

**Почему пятым:** требует нетривиального mix'а — после F/A mix уже интересен; стоимость 1 функция; проверяет мета-вывод без тяжёлой инфраструктуры.

**Ворота:** в турнире 195 аналогов adaptive не худшая, средний ранг выше TFT в шумной популяции.

### Ветка R — RL (опционально, после Phase 5)
**I (Q-learning + FSM+GA)** → **H (LOLA)**. Сначала `Q[state=opp_last] + ε-greedy` (Sandholm 1996) и `FSM(ga)` (Axelrod 1987) как база, затем LOLA `grad_self + η·shaping` (Foerster 2018, Zhao 2022). Требует MARL популяции, вне replicator/Moran. `teob-ts`: остаётся за пределами `Run`, отдельный эксперимент.

### Ветка G — История/игра (опционально, после Phase 2)
**G (Southampton handshake)** → **M (рескины)** → **K (LLM)**. G требует A (team) + память 5 ходов; M требует F (топология) + payoff-маппинг (recycling/vaccination/EV feeder blackout); K требует `teob-ai:agentFlowAggregate` + `ToolPermission.Confirm` + `L: SimulationRun+Participant` с `ReplyDeferred` (docs `ai.md`). LLM ставить последним: промпт-чувствительность (MT §14.2, Nature 2025) делает выводы контекстуальными; без фиксации модели/промпта — артефакт.

**Ворота G:** 20 `southampton_node(master/slave)` входят в top-3 vs TFT/ALLD/GTFT; без коллудеров TFT побеждает (Kendall 2004).
**Ворота K:** 5 LLM на `line/cycle/star` дают разные семейства поведения (MT §14.2 фреймворк 2026), не «LLM лучше Q-learning».

---

## 5. Что НЕ делать и почему

- **Не смешивать A+B в одном PR** — две гипотезы (коалиция vs крен) в одном релизе ломают атрибуцию (PA §6).
- **Не хранить состояние стратегий глобально** (`gradual._state`, `contrite_tft._intent`) — ломает `teob-ts` чистоту `apply` и `deriveSeed` детерминизм; делать `Strategy` объектом с `reset()` или замыканием.
- **Не ставить LLM раньше команд/пространства** — без A/F выводы LLM не отличить от артефакта популяции/топологии.
- **Не гнать `teob-postgres/http/telemetry` до потребности** (PA §7.5) — `teob-sqlite` покрывает персистентность, `quickstart` покрывает демо; `teob-ai/petrinet` только для K/L.

---

## 6. Карта teob-ts слоёв → фаз

| Слой teob-ts (README) | Когда нужен |
|----------------------|-------------|
| `core` (Aggregate/Effect/Codec/TestKit) | Phase 0-3 (уже, + upcasts) |
| `inmem` (createSingleRuntime) | Phase 0-3 |
| `sqlite` (createSqliteRuntime, WAL) | после Phase 3, перед пространством если нужен шаринг реплеев |
| `projection` (projection/runProjection) | Phase 0-4 (уже) |
| `http`/`quickstart`/`service` (aggregateRoutes, openApiSchema) | Phase 4-5 для lattice UI (SSE live от `Run` events) |
| `saga` (statefulSaga) | только если нужен меж-агрегатный оркестр (не для A) |
| `ai` (agentFlowAggregate, ToolPermission) | Ветка K (LLM) + L (agent-mode) |
| `petrinet` | не нужен для A (flow-машина избыточна) |
| `telemetry` (withTelemetry) | по измеренному лимиту |

---

## 7. Итоговая матрица ценности (сжато)

| Приоритет | Фазы | ROI | Риск |
|-----------|------|-----|------|
| P0 (сделать) | Phase 1 зоопарк + generous ZD + memory-n каркас | Высокий | Низкий |
| P1 | Phase 2 team/colluder | Высокий | Средний (upcast) |
| P2 | Phase 3 values/drift (изолированно) | Средний | Средний (RNG) |
| P3 | Phase 4 spatial/topology | Высший (визуальный) | Средний |
| P4 | Phase 5 adaptive | Средний | Низкий |
| P5 (ветки) | G→M→K , I→H , L | Нишевый | Высокий (LLM/MARL) |

**Следующий шаг (рекомендация):** Phase 1 — 13 стратегий + generous ZD + `memory_n` без ожидания остальных; каждая фаза — зелёный `pnpm test` и документ «что изменилось» по Glynatsi-чеклисту `(популяция, критерий, шум, горизонт)`.

---

*Источники: `PROJECT_ARCHITECTURE.md §§5-7`, `more-things.md §§5.5,6.3,7.4,8.5,9.5,14-17`, `case_A_evolution_sandbox.md §2/§5/§8`, `case_A_spatial_game.md §6/§8`, `teob-ts docs core.md/inmem.md/README Package Structure`, `SKILL.md` (скилл уже на `teob-ts`).*
