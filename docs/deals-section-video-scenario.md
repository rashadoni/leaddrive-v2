# Видео-гид «Сделки» от А до Я — сценарий

Длинный сквозной сценарий на весь раздел **Сделки**: воронка/список → карточка сделки.
Обновляет и объединяет прежние сценарии `deals` и `deal-detail` из
`video/scenarios/overrides.mjs`, добавляя новые фичи: **MEDDPICC-вкладку (D1)**,
**MEDDPICC-чипы и колонку в списке (D2)**, **AI-подсказку MEDDPICC из переписки (D3)**,
переработанный **Advisor-рейл** и **KPI-чипы**.

## Как этим пользоваться (для записывающей сессии)
- Конвейер — эталон: `scripts/produce-guides.mjs` (Playwright recordVideo 1280×720 +
  ffmpeg mux озвучки) и `video/scenarios/overrides.mjs` (формат сцен).
- **Тайминг — `holdUntil(доля)`, не фиксированные `sleep`** (az почти вдвое длиннее
  en/ru; последний бит ≤ 0.92). Сцена держится `max(действия, озвучка)`.
- **Селекторы проверять живьём** до записи; диалоги «открыл → poll крестика → до 3
  ретраев»; формы «открыл → Отмена/×», ничего не сохраняем.
- Верификация каждого видео: `silencedetect=-40dB:d=2.5` → 0 пауз; кадры середин
  сцен смотреть глазами (вкладка активна, действие сработало).
- Это один длинный ролик (~17 сцен). При желании режется на два: **A. Воронка**
  (сцены 1–6) и **B. Карточка сделки** (сцены 7–17) — переход органичный (открываем
  сделку из списка).

## Якоря (data-tour-id) — проверить перед записью
Существующие (list): `deals-summary`, `deals-kanban`, `deals-card`, `deals-new`.
Существующие (card): `deal-stage-progress`, `deal-kpi-chips`, `deal-ai-prediction`,
`deal-ai-suggestions` (Advisor-рейл), `deal-quick-actions`, `deal-sidebar`, `deal-timeline`.
**Новые — добавить/проверить:** чип MEDDPICC на канбан-карточке (`span[title*='метрики']`),
колонка/заголовок «MEDDPICC» в списке + `option[value="meddpicc"]` (сортировка),
таб-кнопка **MEDDPICC** на карточке, кнопка **«Предложить из переписки»**, кнопка
**«Сохранить»** и бейдж статуса (Не оценено / n из 40).

---

# ЧАСТЬ A — Воронка и список сделок (`/deals`)

### Сцена 1 — Что такое раздел «Сделки» + аналитика Da Vinci
**Действие:** навести на верхнюю сводку (`deals-summary`), задержать. Ничего не кликаем.
- **RU:** Это раздел «Сделки» — единый источник правды о твоих продажах. Все сделки на одной доске, а сверху аналитика Da Vinci сама считает воронку: сколько сделок, общая стоимость и — самое важное — взвешенная стоимость, прогноз, скорректированный на вероятность каждой сделки. Не таблица с мечтами, а живая картина выручки.
- **EN:** This is the Deals section — the single source of truth for your sales. Every deal on one board, and at the top Da Vinci analytics computes the funnel for you: how many deals, the total value, and — most important — the weighted value, a forecast adjusted by each deal's probability. Not a spreadsheet of wishes, but a living picture of revenue.
- **AZ:** Bu «Sövdələşmələr» bölməsidir — satışlarınızın tək həqiqət mənbəyi. Bütün sövdələşmələr bir lövhədə, yuxarıda isə Da Vinci analitikası hunini özü hesablayır: neçə sövdələşmə, ümumi dəyər və ən vacibi — hər sövdələşmənin ehtimalına görə düzəldilmiş çəkili dəyər. Arzular cədvəli deyil, gəlirin canlı mənzərəsi.

### Сцена 2 — Канбан: карточки по стадиям, drag-to-move
**Действие:** клик по кнопке «Канбан» (`deals-kanban`), дать доске появиться.
- **RU:** Переключаемся на «Канбан» — и каждая сделка становится карточкой в колонке своей стадии: Лид, Квалификация, Предложение, Переговоры, Выиграна. Перетащи карточку в соседнюю колонку — стадия и вероятность обновятся сами. Одним движением ты двигаешь сделку вперёд.
- **EN:** We switch to “Kanban” — and every deal becomes a card in its stage column: Lead, Qualification, Proposal, Negotiation, Won. Drag a card into the next column, and the stage and probability update by themselves. In one motion you move the deal forward.
- **AZ:** «Kanban»a keçirik — və hər sövdələşmə öz mərhələ sütununda karta çevrilir: Lid, Kvalifikasiya, Təklif, Danışıqlar, Qazanıldı. Kartı qonşu sütuna sürükləyin — mərhələ və ehtimal özü yenilənir. Bir hərəkətlə sövdələşməni irəli aparırsınız.

### Сцена 3 — НОВОЕ (D2): MEDDPICC-чипы прямо на карточке
**Действие:** навести на карточку сделки с цветными чипами (`deals-card`, чип `span[title*='метрики']`), задержать.
- **RU:** Обрати внимание на новые цветные чипы прямо на карточке — это экспресс-квалификация MEDDPICC. Зелёный, жёлтый или красный и балл из сорока показывают, насколько сделка проработана, ещё до того как ты её открыл. Слабое место видно сразу — где не хватает экономического покупателя или чемпиона.
- **EN:** Notice the new colored chips right on the card — that's the MEDDPICC qualification at a glance. Green, amber, or red plus a score out of forty show how well-qualified the deal is before you even open it. The weak spot jumps out at once — where the economic buyer or the champion is missing.
- **AZ:** Kartın üstündəki yeni rəngli çiplərə diqqət edin — bu, MEDDPICC kvalifikasiyasının qısa göstəricisidir. Yaşıl, sarı və ya qırmızı, üstəgəl qırx baldan qiymət — sövdələşməni açmadan onun nə qədər hazır olduğunu göstərir. Zəif nöqtə dərhal görünür: harada iqtisadi alıcı və ya çempion çatışmır.

### Сцена 4 — Фильтры по стадии
**Действие:** клик по фильтру «Предложение», затем по «Выиграна» (локализованные чипы). Пауза после каждого.
- **RU:** Фильтруй по любой стадии. Клик по «Предложение» — остаются только сделки, ближайшие к закрытию. «Выиграна» покажет победы, «Проиграна» — уроки. Ты фокусируешься на том, что важно прямо сейчас.
- **EN:** Filter by any stage. Click “Proposal,” and only the deals closest to closing remain. “Won” shows the victories, “Lost” the lessons. You focus on what matters right now.
- **AZ:** İstənilən mərhələ üzrə süzgəcləyin. «Təklif»ə klik — yalnız bağlanmağa ən yaxın sövdələşmələr qalır. «Qazanıldı» qələbələri, «İtirildi» dərsləri göstərir. Siz məhz indi vacib olana diqqəti cəmləyirsiniz.

### Сцена 5 — НОВОЕ (D2): режим «Список» + колонка MEDDPICC + сортировка
**Действие:** клик по переключателю «Список»; навести на заголовок колонки «MEDDPICC»; показать сортировку по квалификации (`option[value="meddpicc"]`).
- **RU:** Переключись в «Список» — и появляется колонка MEDDPICC с теми же цветными чипами по каждой сделке. Отсортируй по квалификации — самые непроработанные сделки поднимутся наверх. Так руководитель сразу видит, какие сделки требуют внимания, а не гадает.
- **EN:** Switch to the List view — and a MEDDPICC column appears with the same colored chips for every deal. Sort by qualification, and the least-qualified deals rise to the top. So the manager sees at once which deals need attention, instead of guessing.
- **AZ:** «Siyahı» rejiminə keçin — hər sövdələşmə üçün eyni rəngli çiplərlə MEDDPICC sütunu görünür. Kvalifikasiyaya görə sıralayın — ən az işlənmiş sövdələşmələr yuxarı qalxır. Beləcə rəhbər təxmin etmədən hansı sövdələşmənin diqqət tələb etdiyini dərhal görür.

### Сцена 6 — Новая сделка
**Действие:** навести на кнопку «Новая сделка» (`deals-new`). По желанию: открыть форму → закрыть по «×»/«Отмена» (ничего не сохраняем).
- **RU:** Новую сделку добавляешь одним кликом — кнопка «Новая сделка», и сделка попадает прямо в воронку, на нужную стадию. Ни одна возможность не теряется, всё зафиксировано.
- **EN:** You add a new deal with one click — the “New Deal” button, and the deal drops straight into the pipeline at the right stage. No opportunity is lost; everything is captured.
- **AZ:** Yeni sövdələşməni bir kliklə əlavə edirsiniz — «Yeni sövdələşmə» düyməsi, və sövdələşmə düz boru xəttinə, lazımi mərhələyə düşür. Heç bir fürsət itmir, hər şey qeydə alınır.

---

# ЧАСТЬ B — Карточка сделки (`/deals/[id]`)

### Сцена 7 — Открываем сделку: командный центр + этапы
**Действие:** открыть демо-сделку из списка (переход на карточку); навести на полосу этапов (`deal-stage-progress`).
- **RU:** Открываем сделку — и попадаем в её командный центр. Наверху имя, компания и контакт, ниже — полоса этапов. Чтобы продвинуть сделку, просто кликаешь по следующему этапу: Лид, Квалификация, Предложение, Переговоры, Выиграна — не покидая страницу.
- **EN:** We open a deal — and land in its command center. At the top the name, company, and contact; below, the stage bar. To move the deal forward you simply click the next stage: Lead, Qualification, Proposal, Negotiation, Won — without leaving the page.
- **AZ:** Sövdələşməni açırıq — və onun idarə mərkəzinə düşürük. Yuxarıda ad, şirkət və kontakt, aşağıda mərhələ zolağı. Sövdələşməni irəli aparmaq üçün sadəcə növbəti mərhələyə klikləyirsiniz: Lid, Kvalifikasiya, Təklif, Danışıqlar, Qazanıldı — səhifəni tərk etmədən.

### Сцена 8 — KPI-чипы: пульс сделки
**Действие:** навести на блок «Детали сделки» с KPI-чипами (`deal-kpi-chips`).
- **RU:** Блок «Детали сделки» сразу отвечает на главные вопросы: сколько дней сделка в воронке, сколько застряла на текущем этапе, сколько было писем и звонков. Это пульс сделки — с одного взгляда видно, живая она или замерла.
- **EN:** The “Deal details” block answers the key questions at once: how many days the deal has been in the funnel, how long it's been stuck at the current stage, how many emails and calls there were. It's the deal's pulse — one glance tells you whether it's alive or frozen.
- **AZ:** «Sövdələşmə təfərrüatları» bloku əsas suallara dərhal cavab verir: sövdələşmə neçə gündür hunidədir, cari mərhələdə nə qədər ilişib qalıb, neçə e-poçt və zəng olub. Bu, sövdələşmənin nəbzidir — bir baxışda onun canlı, yoxsa donmuş olduğunu görürsünüz.

### Сцена 9 — Вкладки: Обзор / Лента / MEDDPICC
**Действие:** показать три таб-кнопки; кликнуть «MEDDPICC».
- **RU:** Вся работа со сделкой разложена по вкладкам: «Обзор» — данные и детали клиента, «Лента» — общение и история, «MEDDPICC» — качество квалификации. Начнём с квалификации — это сердце сделки.
- **EN:** All the work on a deal is organized into tabs: “Overview” — the data and customer details, “Feed” — communication and history, “MEDDPICC” — the quality of qualification. Let's start with qualification — it's the heart of the deal.
- **AZ:** Sövdələşmə üzrə bütün iş vərəqlərə bölünüb: «İcmal» — məlumat və müştəri təfərrüatları, «Lent» — ünsiyyət və tarixçə, «MEDDPICC» — kvalifikasiyanın keyfiyyəti. Kvalifikasiyadan başlayaq — bu, sövdələşmənin ürəyidir.

### Сцена 10 — НОВОЕ (D1): вкладка MEDDPICC — 8 блоков, оценка, статус
**Действие:** на вкладке MEDDPICC навести на сетку блоков; кликнуть оценку (например, «Метрики» = 5), ввести короткую заметку «почему»; показать, как меняется бейдж статуса и балл из 40.
- **RU:** Вкладка MEDDPICC — это методика квалификации из восьми блоков: метрики, экономический покупатель, критерии и процесс решения, бумажный процесс, боль клиента, чемпион и конкуренция. По каждому ставишь оценку от одного до пяти и пишешь «почему такой балл» и «что делать дальше». Сверху — общий статус и балл из сорока: пока хоть один блок не оценён, сделка честно помечена жёлтым, а не выдаёт себя за готовую.
- **EN:** The MEDDPICC tab is an eight-block qualification method: metrics, economic buyer, decision criteria and process, paper process, the customer's pain, the champion, and competition. For each you set a score from one to five and write “why this score” and “what to do next.” At the top is the overall status and a score out of forty — while any block is unscored, the deal is honestly flagged yellow instead of pretending to be ready.
- **AZ:** MEDDPICC vərəqi səkkiz blokdan ibarət kvalifikasiya metodikasıdır: metrikalar, iqtisadi alıcı, qərar meyarları və prosesi, sənəd prosesi, müştərinin ağrısı, çempion və rəqabət. Hər biri üçün birdən beşə qədər qiymət verir, «niyə bu bal» və «sonra nə etməli» yazırsınız. Yuxarıda ümumi status və qırx baldan qiymət: hər hansı blok qiymətlənməyibsə, sövdələşmə hazır kimi görünmür, dürüstcəsinə sarı ilə işarələnir.

### Сцена 11 — НОВОЕ (D3): «Предложить из переписки» — AI-заполнение
**Действие:** клик по кнопке «Предложить из переписки»; дождаться; показать заполненные пустые блоки с бейджем «ИИ».
- **RU:** И самое сильное — кнопка «Предложить из переписки». ИИ читает почту и заметки по сделке и сам заполняет пустые блоки черновиком: кто чемпион, в чём боль, какие критерии решения. Твою работу он не трогает — дополняет только то, что ещё пусто, и помечает бейджем «ИИ». Квалификация из ручной рутины превращается в пару минут — тебе остаётся проверить и поправить.
- **EN:** And the strongest part — the “Suggest from correspondence” button. The AI reads the deal's email and notes and drafts the empty blocks itself: who the champion is, what the pain is, the decision criteria. It never touches your own work — it fills only what's still empty and marks it with an “AI” badge. Qualification turns from manual routine into a couple of minutes — you just review and adjust.
- **AZ:** Və ən güclüsü — «Yazışmadan təklif et» düyməsi. Süni intellekt sövdələşmənin poçtunu və qeydlərini oxuyur və boş blokları özü qaralama ilə doldurur: çempion kimdir, ağrı nədir, qərar meyarları hansılardır. Sizin işinizə toxunmur — yalnız hələ boş olanı doldurur və «AI» nişanı ilə işarələyir. Kvalifikasiya əl işindən bir neçə dəqiqəyə çevrilir — sizə yalnız yoxlamaq və düzəltmək qalır.

### Сцена 12 — AI-прогноз: вероятность выигрыша + причины
**Действие:** навести на карточку «AI-прогноз» (`deal-ai-prediction`).
- **RU:** Справа ИИ даёт собственный прогноз по сделке: вероятность выигрыша и уверенность оценки. И перечисляет причины — сколько дней нет активности, слабое взаимодействие, просроченная дата закрытия. Это оценка на данных, а не на ощущениях.
- **EN:** On the right the AI gives its own forecast for the deal: the win probability and the confidence of the estimate. And it lists the reasons — how many days without activity, weak interaction, an overdue close date. This is a data-driven read, not a gut feeling.
- **AZ:** Sağda süni intellekt sövdələşmə üçün öz proqnozunu verir: qazanma ehtimalı və qiymətin əminliyi. Səbəbləri də sadalayır — neçə gün aktivlik yoxdur, zəif qarşılıqlı əlaqə, keçmiş bağlanma tarixi. Bu, hissə deyil, məlumata əsaslanan qiymətdir.

### Сцена 13 — НОВОЕ (переработка): «Риск Advisor» → рекомендация → в работу
**Действие:** навести на Advisor-рейл (`deal-ai-suggestions`); указать на кнопку «Отправить на согласование».
- **RU:** Ниже — «Риск Advisor». Он не просто называет риск, а рекомендует конкретный следующий шаг и готовит его за тебя: создать задачу, обновить план. Одна кнопка «Отправить на согласование» — и рекомендация уходит в работу с контролем руководителя. Анализ сразу превращается в действие.
- **EN:** Below is the “Risk Advisor.” It doesn't just name the risk — it recommends a concrete next step and prepares it for you: create a task, update the plan. One “Send for approval” button, and the recommendation goes into action with the manager's oversight. Analysis turns straight into action.
- **AZ:** Aşağıda «Risk Advisor». O, təkcə riski demir — konkret növbəti addımı tövsiyə edir və onu sizin üçün hazırlayır: tapşırıq yarat, planı yenilə. Bir «Təsdiqə göndər» düyməsi — və tövsiyə rəhbər nəzarəti ilə işə düşür. Analiz birbaşa fəaliyyətə çevrilir.

### Сцена 14 — Быстрые действия (Лента): заметка / задача / письмо
**Действие:** клик по вкладке «Лента»; открыть композер «Задача» и «Письмо» (`deal-quick-actions`), показать → закрыть без сохранения.
- **RU:** Переходим в «Ленту». Здесь ты действуешь сразу: пишешь заметку, ставишь задачу или отправляешь письмо — всё внутри сделки, не переключаясь на другой экран. На вопрос «какой следующий шаг?» отвечаешь здесь же.
- **EN:** We move to the “Feed.” Here you act immediately: write a note, set a task, or send an email — all inside the deal, without switching to another screen. You answer “what's the next step?” right here.
- **AZ:** «Lent»ə keçirik. Burada dərhal hərəkət edirsiniz: qeyd yazın, tapşırıq qoyun və ya e-poçt göndərin — hamısı sövdələşmənin içində, başqa ekrana keçmədən. «Növbəti addım nədir?» sualına elə burada cavab verirsiniz.

### Сцена 15 — Сайдбар: полный контекст сделки
**Действие:** навести на левый сайдбар (`deal-sidebar`); раскрыть «Конкуренты»; указать на «Следующие лучшие офферы» и «Следующие шаги».
- **RU:** Слева — весь контекст сделки: контакт с кнопками звонка и письма, сумма и вероятность, а ниже раскрываются предложения, счета, команда, роли контактов и конкуренты. Тут же «Следующие лучшие офферы» и чек-лист «Следующие шаги». Сделка не одна — у неё полное окружение.
- **EN:** On the left is the deal's full context: the contact with call and email buttons, the amount and probability, and below, proposals, invoices, the team, contact roles, and competitors expand. Right here are the “Next best offers” and the “Next steps” checklist. The deal isn't alone — it comes with a full environment.
- **AZ:** Solda sövdələşmənin bütün konteksti var: zəng və e-poçt düymələri ilə kontakt, məbləğ və ehtimal, aşağıda isə təkliflər, hesab-fakturalar, komanda, kontakt rolları və rəqiblər açılır. Elə burada «Növbəti ən yaxşı təkliflər» və «Növbəti addımlar» siyahısı. Sövdələşmə tək deyil — onun tam mühiti var.

### Сцена 16 — Хронология сделки
**Действие:** навести на ленту истории (`deal-timeline`).
- **RU:** В «Ленте» ниже — вся история сделки: каждое письмо, заметка, задача, смена этапа. Полная проверяемая хронология: кто, что и когда сделал — в одном месте, без потерь.
- **EN:** Lower in the “Feed” is the deal's full history — every email, note, task, and stage change. A complete, auditable timeline: who did what, and when — all in one place, with nothing lost.
- **AZ:** «Lent»də aşağıda sövdələşmənin bütün tarixçəsi var — hər e-poçt, qeyd, tapşırıq, mərhələ dəyişikliyi. Tam, yoxlanıla bilən xronologiya: kim, nə və nə vaxt etdi — hamısı bir yerdə, itkisiz.

### Сцена 17 — Финал
**Действие:** навести на бейдж статуса MEDDPICC или на полосу этапов; спокойное завершение.
- **RU:** Карточка сделки — единое место, чтобы видеть, квалифицировать и вести сделку. MEDDPICC показывает качество, ИИ — риск и следующий шаг, а ты действуешь, не покидая страницу. Каждая сделка — под полным контролем, от первого касания до закрытия.
- **EN:** The deal page is the single place to see, qualify, and drive a deal. MEDDPICC shows the quality, the AI shows the risk and the next step, and you act without leaving the page. Every deal — fully in control, from first touch to close.
- **AZ:** Sövdələşmə səhifəsi sövdələşməni görmək, kvalifikasiya etmək və irəli aparmaq üçün tək yerdir. MEDDPICC keyfiyyəti, süni intellekt riski və növbəti addımı göstərir, siz isə səhifəni tərk etmədən hərəkət edirsiniz. Hər sövdələşmə — ilk təmasdan bağlanmağa qədər tam nəzarətdə.

---

## Заметки по записи
- **Демо-данные:** сцены 3/5/10/11 требуют сделки с заполненным/частичным MEDDPICC
  (для чипов, колонки и «Не оценено»). Убедись, что у демо-сделки есть переписка
  (email/заметки), иначе «Предложить из переписки» вернёт «нет данных».
- **Сцена 11 (AI-suggest)** — асинхронная: держи сцену через `holdUntil` до появления
  бейджей «ИИ», а не по фиксированному таймеру.
- **AZ** — черновой перевод в стиле эталона; перед финальной озвучкой стоит быстрый
  проход носителя (термины MEDDPICC оставить как есть).

## Статус записи
- 2026-07-19: 6 видео (`deals` + `deal-detail` × az/en/ru) записаны на прод-демо и опубликованы (`video/player/`). Проверено: 0 пауз тишины, кадры середин сцен просмотрены.
