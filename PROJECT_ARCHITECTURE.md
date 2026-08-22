# Архитектура проекта: симуляции стратегического взаимодействия

Статус: утверждённая архитектура и план развития. Этот документ отделяет уже
работающий код от согласованных идей следующих фаз.

## 1. Что решает проект

Есть два связанных, но разных продукта:

1. **Анализ сценария.** Пользователь описывает повторяющееся взаимодействие
   нескольких сторон; движок перебирает неопределённость и выдаёт устойчивые
   выводы.
2. **Лаборатория эволюции/агентов.** Оператор запускает конкретный опыт,
   наблюдает поколения или раунды, ставит на паузу, воспроизводит и сравнивает
   результаты.

Оба используют один игровой kernel, но не обязаны иметь одинаковую модель
журнала. Короткий Monte-Carlo не должен превращаться в миллионы event-sourcing
операций.

## 2. Базовое правило: история запуска неизменяема

`RunStarted` фиксирует полный конфиг, seed и версию kernel. После этого конфиг
**не редактируется**. Новый payoff, состав игроков, команда, стартовый крен или
шум означают новый `runId` и новый журнал.

Это не запрещает менять *состояние внутри запущенной симуляции*: события раундов
и поколений последовательно выводят новое состояние из старого. Неизменяемы
прошедшие факты и исходные условия, а не сама динамика.

Сравнение сценариев — это projection по нескольким независимым журналам, а не
изменение задним числом одного запуска.

## 3. Два режима исполнения

### 3.1 Batch/evolution — быстрый математический режим

Для тысяч синтетических матчей используется чистый TypeScript kernel. Он получает
все входы и явный RNG, не пишет ходов в журнал и детерминирован при данном seed.

Один TEOB aggregate `Run` хранит только экспериментные факты: начало, сводку
поколения, паузу/возобновление и завершение. Это режим для эволюции стратегий,
пространственных сеток и массового Monte-Carlo.

### 3.2 Agent simulation — подробный режим участников

Для 2–10 реальных, человеческих или LLM-участников нужна более полная модель
TEOB: отдельный aggregate `Participant` на участника каждого запуска.

```text
SimulationRun(runId)              Participant(runId:playerId)
----------------------            ----------------------------------
фиксирует конфиг и раунд          state: темперамент, знания, история
открывает/закрывает раунд         command: RequestMove, ReceiveOutcome
фиксирует RoundResolved           events: MoveChosen, OutcomeRecorded
рассылает результат               apply: обновляет личную картину мира
```

`SimulationRun` — координатор. Он сохраняет `RoundOpened`, отправляет игрокам
`RequestMove`, собирает `MoveSubmitted`, затем сохраняет `RoundResolved` и только
после commit рассылает `ReceiveOutcome`. Так у каждого участника есть собственная
объяснимая история: что он видел, что решил и что после этого узнал.

Это не заменяет batch-режим: event-source на каждом ходе популяции из сотен
игроков делает расчёт медленным, не добавляя научной ценности.

## 4. Что уже реализовано (на `teob-ts@0.2.2`)

Рабочая TypeScript-вертикаль находится в `src/` и строго следует `teob-ts` docs:

- `domain.ts` — типы, `isValidPayoff(game)` (PD `T>R>P>S && 2R>T+S` / chicken `T>R>S>P` / stag hunt `R>T>P>S`), `assertScenario/assertRunConfig`;
- `rng.ts` — детерминированный `Rng` xorshift + `deriveSeed(root,generation,i,j,rep)` — глобальный `Math.random` запрещён, каждый матч у `kernel.ts:tournament` получает свой `new Rng(deriveSeed(...))` (docs `core.md: Determinism contract`);
- `kernel.ts` — чистые функции `playMatch(tournament,evolve,stepGeneration)`, 9 стратегий `Strategy=(my,theirs,rng)=>Move`;
- `analysis.ts` — чистый Monte-Carlo `oneTrial/analyzeScenario/scenarioReport` (без TEOB, вызывается из `cli.ts`);
- `run.ts` — один TEOB aggregate `Run` по `docs/core.md:Aggregate`:
  ```ts
  Aggregate<RunCommand,RunReply,RunEvent,RunState> = { category: CategoryId("game-run"), initial, decide, apply, onRecoveryComplete, snapshotEvery:25 }
  ```
  `decide` возвращает декларативный `Effect` (`persist`/`reply`/`andReply`/`andRun` из `teob-ts/core`), `EffectControl` использует только `scheduleOnce(TimerId("next-generation"))` / `cancelTimer` / `tellSelf`; `apply` чист; `onRecoveryComplete` переармирует таймер если `status==="running"` (docs `core.md: Timers — No persistence`); кодек `tagCodec<RunEvent>` + `objectCodec<RunState>`;
- `projections.ts` — декларативные `projection({projectionId,evolve,initialState})` из `teob-ts/projection` (`runSummary`/`strategySeries`), `createInMemoryProjectionStore`/`runProjection`;
- `src/selfcheck.ts` — верификация через `createSingleRuntime` (`teob-ts/inmem`) + `createAggregateTestKit` (`teob-ts/testing`) + `extractEvents` (`teob-ts/core`);
- `src/cli.ts` + `game-theory-scenarios/scenario` shim — тонкий wrapper над `analysis.ts` для скилла.

Рантаймы (docs `inmem.md`/`sqlite.md`/`postgres.md`):
- сейчас — `teob-inmem` (`createSingleRuntime` / `createInMemoryRuntime`) — тесты и демо без Docker;
- далее — `teob-sqlite` (`createSqliteRuntime({path:"./data/journal.db"})`) для локальной персистентности, затем `teob-postgres` (LISTEN/NOTIFY) для продакшена — без изменения `decide/apply` (TEOB `In a nutshell: swap runtime`).

`pnpm build && pnpm test` проверяет kernel, сценарный анализ, TEOB in-memory runtime, таймерный шаг и projection.

Скилл `game-theory-scenarios/` переведён на `teob-ts` (`src/kernel.ts` + `src/analysis.ts` + `src/cli.ts`); Python-движок `scenario.py` удалён. Паритет по 9 диспозициям и 3 играм сохранён, детерминизм через `Rng/deriveSeed`. `team/colluder` и `values/drift` пока не реализованы.

## 5. Фаза 2: фиксированные команды (ещё не реализована)

### Контракт модели

У игрока появляется необязательное поле:

```json
{"name": "A", "team": "coalition-1", "dispositions": ["colluder", "provocable"]}
```

Игрок без `team` считается командой из одного человека. Поэтому существующие
двухсторонние JSON-модели продолжают работать без изменений.

### Семантика

- Победитель сценария — команда с наибольшим суммарным score.
- Отдельно считается `champion`: игрок, чаще других лидирующий по личному score.
- `colluder` намеренно играет `C` против сокомандника и `provocable` против
  внешнего игрока. Шум применяется после намеренного хода; поэтому «всегда
  кооперируется» означает намерение, а не невозможность ошибки связи.
- В `--advise` критерий становится: как часто выбранная стратегия приводит к
  победе **команды** пользователя. Личный score остаётся диагностикой.

Стратегии не должны знать о командах. Kernel подбирает для конкретной пары
обёртку: для `(sameTeam && colluder)` — cooperative policy, иначе исходную
стратегию. Это оставляет сигнатуру стратегии `(myHistory, opponentHistory, rng)`
неизменной.

### Необходимые ограничения до реализации

1. Суммарный score естественно предпочитает более крупную команду: у неё больше
   внутренних пар и больше участников. Это верно, если метрика — общий ресурс
   блока. Для соревнования команд разного размера понадобится вторая метрика —
   score на участника. В отчёте нужно показывать обе, а победную выбрать явно.
2. Нельзя бездумно складывать score игроков с разными шкалами асимметричных
   payoff. Для командной метрики нужны либо сопоставимые единицы, либо нормализация
   относительно собственного `R`/`P` каждого игрока.
3. Команда фиксируется в `RunStarted`. Динамические альянсы, Shapley value, ядро
   коалиции и «жертва одного ради чемпиона» не входят в фазу 2.

### Тестовые ворота

- два `colluder` против двух одиночек `provocable` при шуме выигрывают большинство
  миров по выбранной командной метрике;
- отсутствие `team` воспроизводит прежний индивидуальный подсчёт;
- команды разного размера явно демонстрируют разницу total/per-capita score;
- все старые self-check остаются зелёными.

## 6. Values + drift (предложение, ещё не реализовано)

### Контракт

```json
{
  "players": [{"name": "A", "values": [-0.2, 0.4], "dispositions": ["forgiving"]}],
  "structure": {"drift": [0.0, 0.05]}
}
```

`values` — начальный поведенческий крен `lean` в диапазоне `[-1, 1]`:

- `-1`: превратить намерение кооперации в дефекцию с вероятностью 1;
- `+1`: превратить намерение дефекции в кооперацию с вероятностью 1;
- `0`: не вмешиваться в базовую стратегию.

`drift` — скорость изменения `lean` после **наблюдаемого** хода оппонента. После
наблюдаемого `D` крен сдвигается вниз, после `C` — вверх; затем ограничивается
`[-1, 1]`. Сначала базовая стратегия, затем value-shift, затем noise, затем
обновление истории и `lean`.

### Оценка предложения

Механика логична как простая модель адаптации, но это не «ещё две ручки» — она
меняет поведение всех девяти стратегий. Поэтому она не должна смешиваться с
коалициями в одном изменении: иначе невозможно понять, что вызвало результат.

Есть три обязательные поправки к исходному предложению:

1. Если `values`/`drift` отсутствуют или равны нулю, код не должен даже делать
   дополнительные случайные выборки. Иначе `random.uniform(0, 0)` сдвинет
   глобальный RNG и обещание bit-for-bit обратной совместимости нарушится.
   TypeScript kernel решает это отдельными derived seeds или пропуском sampling.
2. Средний `values` плох для sensitivity: `+0.8` у одного игрока и `-0.8` у
   другого дают среднее 0, хотя взаимодействие изменилось радикально. Нужны
   sensitivity по игрокам либо минимум/максимум/разность кренов.
3. `structure.drift` — общий параметр среды. Если нужна именно психологическая
   реактивность сторон, `drift` должен быть полем игрока, как `values`. В фазе 3
   выбирается одна из этих семантик, а не обе сразу.

В agent-режиме `lean` — естественная часть state `Participant`; в batch-режиме —
локальное состояние одного матча. «Наследовать lean между прогонами» нельзя
делать глобальной памятью: это должен быть новый дочерний run с `parentRunId` и
явно сохранённым inherited lean в `RunStarted`.

### Тестовые ворота

- при `lean=-1` и `noise=0` даже `trusting` не кооперируется;
- при `lean=+1` и `noise=0` `exploitative` кооперируется;
- `forgiving` против постоянного дефектора при положительном `drift` со временем
  кооперируется реже, чем при нулевом drift;
- отсутствие полей или `[0,0]` при том же seed даёт прежний результат побитово.

## 7. Порядок реализации (выровнен с `teob-ts` слоями)

Слои `teob-ts` (docs `README: Package Structure`): `teob-core` (Aggregate/Effect/Codec) → `teob-inmem|sqlite|postgres` (engines) → `teob-projection|saga|http|quickstart|service|telemetry` (envelope) → `teob-ai|petrinet` (domain layers). Проект движется снизу вверх, не перепрыгивая слои.

1. **Закрепить `teob-core` слой.** Использовать текущий TypeScript batch/kernel как есть; покрыть `AggregateTestKit` + `verifyEntity/verifyAll` и `fast-check` property-based для `invariants` (docs `core.md: Invariants`).
2. **Фаза 2 — фиксированные команды (`team/colluder`).** Только домен (`domain.ts` + `kernel.ts` обёртка `sameTeam && colluder ? C : strategy`), без новых TEOB примитивов. Требует `codecWithUpcasts` для `RunStarted.config` (docs `core.md: Event Upcasting`) чтобы старые журналы читались.
3. **Фаза 3 — `values` + `drift`.** Отдельное изменение, тоже `codecWithUpcasts` + `deriveSeed` изоляция чтобы `[0,0]` не сдвигала RNG.
4. **Персистентность (`teob-sqlite` → `teob-postgres`).** Заменить `createSingleRuntime` на `createSqliteRuntime({path:"./data/journal.db"})` (WAL, snapshots, recovery), проекции на `createSqliteProjectionStore`; затем `teob-postgres` с `LISTEN/NOTIFY` (docs `postgres.md`) — без изменения `decide/apply`.
5. **HTTP/UI envelope (`teob-http` + `teob-quickstart`/`teob-service`).** `aggregateRoutes`/`allAggregateRoutes` (ETag/If-Match, OpenAPI `openApiSchema(describeAggregate(...))`), `quickstart({aggregates:[runAggregate]})` для демо; `teob-projection` уже есть — добавить `teob-saga` только если нужен меж-агрегатный оркестр.
6. **Agent-mode (`SimulationRun` + `Participant`) — когда нужна объяснимость одного конфликта.** Тогда оправданы `ctx.ask/tell`, `ReplyDeferred` (`createDeferredReply`) и `teob-ai` (`agentFlowAggregate`, `teob-saga statefulSaga`) — в batch-режиме они не нужны (docs `Why not an aggregate per player/match` в `case_A_evolution_sandbox.md §2`).
7. **Наблюдаемость/масштаб по потребности.** `withTelemetry`/`withJournalTelemetry` (`teob-telemetry`), `teob-service` health checks — только при измеренном CPU/IO-лимите; worker threads — после профилирования.

Это намеренно минимальный путь: фиксированные команды и адаптация поведения — разные научные гипотезы, их следует вводить и проверять по одной, каждый шаг — строгий суперсет предыдущего с зелёным `pnpm test`.
