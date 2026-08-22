Ниже — расширение документа: новые разделы, модельные обобщения, ключевые исследования и ссылки, сохраняющие существующий стиль (короткая математика + код + вывод). Добавления организованы как дополнительные секции к уже существующим главам.

---

## 5.5 Стратегии с памятью-n: обобщение memory-1

Hilbe et al. обобщили стохастические стратегии на память произвольной длины: стратегия описывается условными вероятностями кооперации для каждого возможного окна последних n исходов. Аналитически это уже не 4-мерный куб, а пространство размерности 2^(2n), поэтому исследования memory-n стратегий почти всегда численные【turn5search11】.

Ключевой результат Hilbe, Wu, Traulsen, Nowak (2017): оптимальная длина памяти зависит от популяции противников. Против memory-1 «умный» memory-2 получает преимущество, но между двумя memory-2 часто возникает цикл без чистого равновесия — эволюционно выгоднее «отказаться от лишней памяти». В коде это значит: **длина памяти — это не бесплатный бонус, а параметр, который надо варьировать**.

```python
def memory_n(probs, n=2):
    """
    probs: dict {(window_tuple_of_n_outcomes): P(C)}
    Каждый ключ — кортеж из n исходов вида (my_move, opp_move).
    """
    def strat(mine, opp):
        if len(mine) < n:
            return C
        window = tuple(zip(mine[-n:], opp[-n:]))
        return C if random.random() < probs.get(window, 0.5) else D
    return strat
```

Библиография: Hilbe, Schmid, Sukhoverkhina, Traulsen (2015) _Direct reciprocity in populations with heterogeneous reputation_; Balabanova, Duong, Hilbe (2024) _Adaptive dynamics of direct reciprocity with N rounds of memory_【turn5search12】.

---

## 6.3 Щедрые ZD-стратегии (Stewart–Plotkin, 2013)

Extortion-стратегии Press–Dyson плохо выживают в эволюционной динамике, потому что их «жертвы» получают стимул кооперироваться только друг с другом. Stewart и Plotkin (2013) показали, что существует подкласс ZD-стратегий — **generous ZD** — которые одновременно навязывают линейное соотношение и не дают оппоненту стимул к обходу【turn2search0】【turn2search1】.

Формула для генератора (по аналогии с §6.2):

```python
def zd_generous(chi=0.5, R=3, S=0, T=5, P=1, phi=0.15):
    """
    Generous ZD: s_X - R = chi*(s_Y - R), chi < 1.
    Реализует ZDGTFT-2 из Stewart-Plotkin (2013).
    """
    p1 = 1 - phi * (1 - chi) * (R - P) / (P - S)   # p_CC
    p2 = 1 - phi * (1 + chi * (T - P) / (P - S))   # p_CD
    p3 = 1 - phi * (1 - (R - P) / (P - S))          # p_DC
    p4 = phi * ((T - R) / (P - S) + chi * (T - R) / (P - S))  # p_DD
    p = (p1, p2, p3, p4)
    assert all(0 <= v <= 1 for v in p), f"phi out of range: {p}"
    return memory_one(p)
```

Эксперимент: прогоните турнир {Extort-2, ZDGTFT-2, TFT, ALLD, ALLC} через репликаторную динамику §4.1 — устойчивое равновесие смещается к ZDGTFT-2, а Extort-2 вымирает【turn2search3】.

Библиография: Stewart & Plotkin (2013) _From extortion to generosity, evolution in the Iterated Prisoner's Dilemma_, PNAS【turn2search0】; Hilbe, Nowak, Traulsen (2013) _Evolution of extortion in Iterated Prisoner's Dilemma games_【turn2search2】; Hilbe, Wu, Adami, Traulsen, Nowak (2014) _Cooperation and control in multiplayer social dilemmas_【turn4search9】.

---

## 7.4 LOLA: Learning with Opponent-Learning Awareness

Классический Q-learning (§7.2) видит оппонента как стационарную среду. Foerster et al. (2018) предложили **LOLA** — агент оптимизирует свою награду, явно моделируя, как его действия изменят градиент обновления оппонента. На IPD два LOLA-агента самопроизвольно «открывают» Tit-for-Tat, тогда как независимые Q-обучатели скатываются к взаимному предательству【turn3search0】【turn2search8】.

Схематическая реализация (упрощённо):

```python
def lola_update(my_params, opp_params, my_return, opp_return, lr=0.01, eta=0.1):
    """
    LOLA: my_params' = my_params + lr * (grad_my_return
          + eta * opp_grad_response_to_my_params)
    Второй член — «предвосхищение» реакции оппонента.
    """
    grad_self = grad(my_return, my_params)
    # оппонент обновится своим градиентом
    opp_update = lr * grad(opp_return, opp_params)
    # как моё изменение параметров сдвинет награду оппонента
    shaping = grad(opp_return, my_params) @ opp_update
    return my_params + lr * grad_self + eta * shaping
```

Результат Foerster: в турнире против независимых Q-обучателей LOLA-агент получает максимальную среднюю награду на IPD, а при self-play сходится к TFT-подобному поведению【turn3search0】.

Библиография: Foerster et al. (2018) _Learning with Opponent-Learning Awareness_, AAMAS / arXiv:1709.04326【turn3search0】; Zhao et al. (2022) _Proximal Learning With Opponent-Learning Awareness_ (стабилизация LOLA)【turn3search2】.

---

## 8.5 Пространственная кооперация: расширенная библиография

Nowak & May (1992) — прорывная работа: вместо «well-mixed» популяции агенты сидят на решётке, и сотрудничество выживает за счёт **кластеризации**. Результат стал основой для целого направления — **network reciprocity**【turn1search15】【turn1search18】.

Позднейшие обобщения:

- Santos & Pacheco: **scale-free сети** резко усиливают кооперацию, потому что хабы-кооператоры обеспечивают высокую награду соседям.
- Ohtsuki et al. (2006): аналитическое условие `b/c > k` (benefit-to-cost превышает среднюю степень вершины) для выживания кооперации на случайных графах.
- Szabó & Fáth (2007): обзор пространственных эволюционных игр, включая решётки, малые миры, безмасштабные топологии.

В коде — обновите §8, добавив генераторы топологий:

```python
import networkx as nx

# Решётка (как у Nowak-May 1992)
lattice = nx.grid_2d_graph(20, 20, periodic=True)

# Безмасштабная сеть (Barabási-Albert)
scale_free = nx.barabasi_albert_graph(100, 3)

# Малый мир (Watts-Strogatz)
small_world = nx.watts_strogatz_graph(100, k=4, p=0.1)
```

Библиография: Nowak & May (1992) _Evolutionary games and spatial chaos_, Nature【turn1search15】; Nowak (2006) _Five rules for the evolution of cooperation_, Science (network reciprocity как один из пяти механизмов)【turn0search16】; Ohtsuki et al. (2006) _A simple rule for the evolution of cooperation on graphs and social networks_.

---

## 9.5 Southampton (2004): коллективные стратегии и «молчаливый сговор»

На 20-летнем турнире Axelrod (2004, Nottingham) команда Southampton во главе с Nick Jennings подала **60 программ**, которые распознавали друг друга по заданной последовательности из 5–10 ходов. После распознавания одна («master») эксплуатировала другую («slave»), а slave саботировала чужие матчи, немедленно начиная предательство【turn8fetch0】.

Ключевые детали:

- Итог: три верхние позиции в итоговой таблице — Southampton, но также множество «жертв» внизу.
- Jennings отмечал, что для победы достаточно было около 20 коллудеров, а не 60【turn7fetch0】.
- Правила турнира не запрещали такую тактику, но эффект на «одинокую» стратегию (без признания своих) был бы иным【turn8fetch0】.

В коде: коллективная стратегия — это чистая функция истории, но с **протоколом рукопожатия**:

```python
HANDSHAKE = [D, D, C, C, D]  # секретная последовательность

def southampton_node(mine, opp, role="master"):
    """
    role="master": после рукопожатия — всегда C.
    role="slave": после рукопожатия — всегда D (жертвует собой).
    """
    n = len(opp)
    if n < len(HANDSHAKE):
        return HANDSHAKE[n] if mine[:n] == HANDSHAKE[:n] else D
    if mine[:len(HANDSHAKE)] == HANDSHAKE:
        return C if role == "master" else D
    return D  # против чужих — всегда D
```

Вывод: **коллективное поведение меняет экосистему турниров**. Одинокий TFT или ZD не выживают против скоординированной группы, и это аргумент за введение «переменной команды» в экспериментальную сетку §12.

Библиография: Wired (2004) _New Tack Wins Prisoner's Dilemma_【turn8fetch0】; Kendall et al. (2004) отчёты о 20-летнем турнире Nottingham.

---

## 13. Расширенная библиография (по темам)

### Zero-determinant и memory-one

- Press & Dyson (2012) _Iterated Prisoner's Dilemma contains strategies that dominate any evolutionary opponent_, PNAS【turn0search0】【turn0search4】
- Stewart & Plotkin (2013) _Extortion and cooperation in the Prisoner's Dilemma_, PNAS【turn2search0】
- Hilbe, Nowak, Traulsen (2013) _Evolution of extortion in Iterated Prisoner's Dilemma games_, PNAS【turn2search2】
- Hilbe, Wu, Adami, Traulsen, Nowak (2014) _Cooperation and control in multiplayer social dilemmas_, PNAS【turn4search9】
- Akin (2012/2015) _ZD strategies for the iterated PD_ (математическое расширение на общие игры)

### Эволюция кооперации

- Nowak & Sigmund (1993) _A strategy of win-stay, lose-shift that outperforms tit-for-tat in the Prisoner's Dilemma game_, Nature【turn0search5】【turn0search8】
- Nowak & May (1992) _Evolutionary games and spatial chaos_, Nature【turn1search15】
- Nowak (2006) _Five rules for the evolution of cooperation_, Science【turn0search16】
- Nowak & Sigmund (1998) _Evolution of indirect reciprocity by image scoring_, Nature (репутация как пятый механизм)【turn3search10】
- Riolo, Cohen, Axelrod (2001) _Evolution of cooperation without reciprocity_ (тег-распознавание)【turn3search14】

### Обучение

- Sandholm & Crites (1996) _Multiagent reinforcement learning in the Iterated Prisoner's Dilemma_【turn1search0】
- Foerster et al. (2018) _Learning with Opponent-Learning Awareness_ (LOLA)【turn3search0】
- Leibo et al. (2017) _Multi-agent Reinforcement Learning in Sequential Social Dilemmas_ (DeepMind)【turn1search6】
- Bertrand et al. (2025) _Self-Play Q-Learners Can Provably Collude in the Iterated Prisoner's Dilemma_【turn1search1】

### Стратегии и турниры

- Glynatsi, Knight, Harper (2024) _Properties of winning Iterated Prisoner's Dilemma strategies_, PLOS Computational Biology【turn10fetch0】
- Beaufils, Delahaye, Mathieu (1996) _Our Meeting with Gradual_【turn4search1】
- Mathieu & Delahaye (2017) _New Winning Strategies for the Iterated Prisoner's Dilemma_【turn4search0】
- Axelrod (1987) _The evolution of strategies in the iterated prisoner's dilemma_ (GA + FSM)【turn1search11】

---

## 14. Машинное обучение на IPD: от Q-learning до LLM

### 14.1 Что показал Glynatsi–Knight–Harper (2024)

Крупнейший по объёму мета-анализ турниров: 195 стратегий, тысячи прогонов. Выводы【turn10fetch0】【turn9search2】:

1. **Не существует одной универсально лучшей стратегии**. Победитель зависит от состава популяции.
2. Уточнённые черты победителей (расширение «четырёх черт» Axelrod):
   - **быть nice** (не предавать первым),
   - **быть provocable и generous** (наказывать, но прощать),
   - **быть слегка envious** (не позволять оппоненту уйти в отрыв),
   - **быть clever** (адаптироваться к текущей популяции),
   - **адаптироваться к среде**.
3. **Ключевая переменная**: вероятность кооперации стратегии должна совпадать с агрегированной вероятностью кооперации всей популяции. Это конкретный, кодируемый критерий.
4. ZD-стратегии в среднем плохо выступают в турнирах (несмотря на теоретическое доминирование против одного оппонента).

Кодируемый вывод — стратегия должна **калибровать себя по популяции**:

```python
def adaptive_coop_rate(mine, opp, coop_memory=0.3):
    """
    Оценивает частоту C в популяции (по оппоненту) и подстраивается.
    """
    if not opp:
        return C
    # Оценка вероятности кооперации оппонента
    p_opp_c = sum(m == C for m in opp) / len(opp)
    # Если оппонент более кооперативен, чем ожидаем — повышаем свою C-вероятность
    target = min(1.0, max(0.0, 0.5 + (p_opp_c - coop_memory)))
    return C if random.random() < target else D
```

### 14.2 LLM как агенты IPD (2024–2026)

Pal & Hilbe et al. (2026): пять ведущих LLM (GPT-4o, GPT-5, Claude, Gemini, Llama) тестируются на repeated PD. Результат: некоторые LLM демонстрируют **эволюционно устойчивые стратегии кооперации**, другие скатываются к предательству【turn5search1】.

Nature Human Behaviour (2025): LLM адаптируют стратегии in-context, но с чувствительностью к обрамлению промпта; обман в контексте может сдвинуть LLM к предательству【turn5search2】.

Открытый фреймворк (2026): LLM-агенты на решётке (line, cycle, star) показывают **различное поведение по семействам моделей**; некоторые устойчиво поддерживают кооперацию, другие — нет【turn5search4】.

Прототип LLM-стратегии (упрощённо, через OpenAI API):

```python
# pip install openai
from openai import OpenAI

def llm_strategy(mine, opp, client=None):
    """
    Простейший LLM-агент на IPD: строит контекст и запрашивает ход.
    Возвращает C или D.
    """
    if not opp:
        return C
    prompt = f"""You are playing Iterated Prisoner's Dilemma.
My last 5 moves: {mine[-5:]}. Opponent's last 5 moves: {opp[-5:]}.
Payoff: R=3, S=0, T=5, P=1.
Should you cooperate (C) or defect (D) next? Answer with one letter."""
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=1
    )
    return response.choices[0].message.content.strip().upper()[:1] or C
```

Предостережение: LLM-агенты — это не «улучшенный Q-learning», а отдельный класс с собственной чувствительностью к промптам, шуму и контексту. Для исследования IPD их стоит рассматривать как новую популяцию оппонентов, а не замену аналитических моделей【turn5search0】.

---

## 15. Области применения: где IPD уже реально работает

| Домен                       | Как применяется                                                                               | Ключевая работа                                                                                |
| --------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **BitTorrent / P2P**        | TFT в механизме обмена: «ты мне блок — я тебе блок», защита от free-riders                    | Qiu & Srikant (2004) _Incentives in BitTorrent induce free riding_【turn5search5】             |
| **Криптовалюты**            | Стимулы для валидаторов в PoS/PoW — потенциальные IPD между узлами                            | Spear et al. учебные курсы по game theory in blockchains【turn5search7】                       |
| **Биология**                | Взаимный альтруизм у летучих мышей (Regurgitation), бактерий (микориза), рыб (чистка)         | Wilkinson (1984); Sachs et al. (2004) _The evolution of cooperation_                           |
| **Поведенческая экономика** | Человеческие эксперименты: условная кооперация, наказание предателей                          | Fehr & Gächter (2000) _Cooperation and Punishment in Public Goods Experiments_【turn9search6】 |
| **Международные отношения** | Модель гонки вооружений; доверие в переговорах — прямое применение IPD                        | Axelrod (1984); Jervis (1978) _Cooperation under the Security Dilemma_                         |
| **Роевой интеллект / MARL** | Кооперация в multi-agent RL (Sequential Social Dilemmas, Coin Game)                           | Leibo et al. (2017)【turn1search6】; Foerster et al. (2018)【turn3search0】                    |
| **Микробиология**           | Бактериальные популяции как IPD (доступ к питательным веществам, устойчивость к антибиотикам) | Gore, Youk, van Oudenaarden (2009) _Snowdrift game dynamics and facultative cheating in yeast_ |

Конкретный пример для кода — **BitTorrent-инцентив через TFT**:

```python
def bittorrent_like_upload(my_blocks_sent, opp_blocks_sent, threshold=0.5):
    """
    Простая TFT-модель раздачи в P2P.
    Загружаю оппоненту только если он загрузил мне достаточно.
    """
    if not opp_blocks_sent:
        return True  # seed: изначально раздаём
    ratio = len(my_blocks_sent) / max(1, len(opp_blocks_sent))
    return ratio >= threshold
```

---

## 16. Дополнительные стратегии для зоопарка §2

### 16.1 Gradual (Beaufils et al., 1996)

Победитель множества поздних турниров. Наказывает n-кратным предательством за n-е предательство оппонента, а затем **успокаивается** двумя кооперациями【turn4search0】【turn4search4】.

```python
def gradual(mine, opp):
    """
    Gradual: Cooperates first.
    After opponent's n-th defection, defects n times, then cooperates 2 times.
    """
    if not opp:
        return C
    if not hasattr(gradual, "_state"):
        gradual._state = {"punish_left": 0, "calm_left": 0, "defections": 0}
    s = gradual._state

    # Если мы в фазе наказания
    if s["punish_left"] > 0:
        s["punish_left"] -= 1
        return D
    # Если в фазе успокоения
    if s["calm_left"] > 0:
        s["calm_left"] -= 1
        return C

    # Оппонент только что предал?
    if opp[-1] == D:
        s["defections"] += 1
        s["punish_left"] = s["defections"] - 1  # уже наказали этим D
        s["calm_left"] = 2
        return D

    return C
```

### 16.2 Contrite TFT (cTFT)

Исправляет собственные ошибки: если после шума случайно предал — признаёт вину и терпеливо сносит ответное наказание, сохраняя кооперацию. В шумных IPD cTFT и GTFT — две сильнейшие «реалистичные» стратегии.

```python
def contrite_tft(mine, opp, noise=False):
    """
    Если моё последнее намерение было C, но реализовалось D (шум),
    признаю вину и сотрудничаю, пока оппонент наказывает.
    """
    if not opp:
        return C
    if not hasattr(contrite_tft, "_intent"):
        contrite_tft._intent = None
    # ... (требует явного отслеживания намерения и реализации)
```

### 16.3 Detective

Комбинация теста и адаптации: первые 4 хода — C, D, C, C; если оппонент хоть раз предал — переключается на TFT; если оппонент всегда сотрудничал — становится ALLD.

```python
def detective(mine, opp):
    if len(opp) < 4:
        return [C, D, C, C][len(opp)]
    if D in opp[:4]:
        return opp[-1]  # ведём себя как TFT
    return D  # оппонент наивен — эксплуатируем
```

### 16.4 Prober

Активно тестирует оппонента на «мягкость»: иногда предаёт, чтобы проверить реакцию; если оппонент не наказывает — становится ALLD.

---

## 17. Дальнейшее чтение и инструменты

### 17.1 Axelrod-Python (расширенная ссылка)

Библиотека выросла из исследовательского проекта в стандартный инструмент【turn2search9】【turn2search11】:

```python
# Полный пример: турнир с шумом + Moran + ZD
import axelrod as axl

players = [
    axl.TitForTat(),
    axl.WinStayLoseShift(),
    axl.ZDExtort2(),
    axl.ZDGTFT2(),
    axl.Grudger(),
    axl.Prober(),
    axl.Random(),
]

# Турнир
tournament = axl.Tournament(players, turns=200, repetitions=50, noise=0.05)
results = tournament.play()

# Экология (replicator dynamics)
ecological = axl.Ecosystem(results)
ecological.reproduce(100)

# Moran process
mp = axl.MoranProcess(players, turns=200, mutation_rate=0.01)
mp.play()
```

Документация: https://axelrod.readthedocs.io【turn2search9】; репозиторий: https://github.com/Axelrod-Python/Axelrod【turn2search10】; статья о библиотеке: Knight et al. (2016) _An Open Framework for the Reproducible Study of the Iterated Prisoner's Dilemma_【turn2search11】.

### 17.2 Полезные открытые материалы

- **Stanford Encyclopedia of Philosophy**: _Prisoner's Dilemma_ — стратегическая таблица всех классических стратегий【turn4search4】.
- **Vincent Knight's blog**: разборы турниров, Python-код, визуализации【turn9search0】.
- **Christian Hilbe's publications**: исследования memory-n, direct reciprocity, multiplayer ZD【turn5search12】.
- **Nowak's _Evolutionary Dynamics_ (2006, Harvard UP)** — базовый учебник по всем пяти механизмам кооперации.
- **Axelrod (1984) _The Evolution of Cooperation_** — исходная книга, критическая для контекста, но не заменяющая современные результаты.

### 17.3 Актуальные направления (2024–2026)

- **LLM-агенты как новые стратегические объекты** в IPD и сетевых дилеммах【turn5search1】【turn5search4】.
- **Co-evolution прямого, косвенного и обобщённого взаимного альтруизма** — как механизмы сосуществуют【turn5search12】.
- **Memory-n стратегии**: Balabanova & Hilbe (2024) — динамика адаптации длины памяти【turn5search12】.
- **Воспроизведение второго турнира Axelrod** (Glynatsi et al., 2025) — насколько современная библиотека восстанавливает исторические результаты【turn4search13】.

---

## Итоговая таблица переменных (расширение §12)

| Рычаг                               | Раздел      | Дополнительно к уже указанному                                 |
| ----------------------------------- | ----------- | -------------------------------------------------------------- |
| Длина памяти `n`                    | §5.5, §16   | memory-1 vs memory-n; адаптация к популяции                    |
| Параметр щедрости `χ` (generous ZD) | §6.3        | вместо бинарного extortion/generous — непрерывный спектр       |
| Учет обучения оппонента             | §7.4 (LOLA) | LOLA vs независимый Q-learning — качественно разные равновесия |
| Топология графа                     | §8.5        | решётка / малый мир / безмасштабная — разные пороги кооперации |
| Коллективность                      | §9.5        | одиночная стратегия vs команда с распознаванием                |
| Адаптивность к популяции            | §14.1       | коэффициент кооперации стратегии ↔ популяции                   |
| Природа агента                      | §14.2       | аналитический / FSM / RL / LLM — разные пространства стратегий |

---

## Замечание о методологии

Glynatsi, Knight, Harper (2024) подчёркивают главный практический урок: **выводы о «лучшем» strategе всегда контекстуальны**【turn10fetch0】. Поэтому их мета-анализ и повторная проверка Axelrod's второго турнира — это методологический ориентир для любого эксперимента с IPD: без явного указания (a) популяции оппонентов, (b) критерия успеха (турнирный счёт, фиксация в Moran, устойчивость в replicator), (c) шумов и горизонта, любой вывод о «победителе» — артефакт конкретного прогона【turn9search2】.
