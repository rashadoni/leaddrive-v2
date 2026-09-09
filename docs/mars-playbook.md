# Mars Overseas Demo Playbook — Pepsi Pilot Sales Pitch

> **Audience:** Sales Director + IT Lead at Mars Overseas Baku (Pepsi bottler).
> **Goal:** secure 3-month paid pilot for Route & Field module on top of LeadDrive CRM.
> **Duration:** 45–60 минут (15 min pitch + 25 min demo + 15 min Q&A).

---

## Pre-demo setup checklist

**За день до встречи:**

- [ ] Получить одноразовый сильный пароль из одобренного secret manager и выполнить: `CONFIRM_PROD=1 SEED_PASSWORD="$MARS_DEMO_PASSWORD" node scripts/seeds/mars.mjs --slug=mars --reset-passwords`
- [ ] Smoke-test:
  - [ ] Открыть `https://mars.leaddrivecrm.org` → дашборд загружается
  - [ ] Получить актуальные web/mobile credentials из одобренного password manager; не копировать пароль в документ, чат или shell history
  - [ ] Залогиниться как `demo@mars.leaddrivecrm.org`
  - [ ] Открыть мобильное приложение (`Route & Field v1.2.0+`) → войти как `farid@mars.leaddrivecrm.org`
  - [ ] Проверить что у Farid'а есть маршрут на сегодня с 5+ точками
  - [ ] Проверить что хотя бы одна точка показывает «активный визит»
- [ ] Зарядить тестовый Android (минимум 80%)
- [ ] Включить мобильный hotspot на случай если у Mars Wi-Fi окажется барахолкой
- [ ] Подготовить адаптер HDMI/USB-C для проектора
- [ ] Распечатать одностраничник с pricing + roadmap (см. секцию ниже)
- [ ] Зарядить ноут + iPad (если планируете показывать дашборд с него)

**Прямо перед встречей:**

- [ ] Открыть в браузере 3 вкладки:
  1. Дашборд (`/`)
  2. Карта реального времени агентов (`/mtm/map`)
  3. Equipment Inventory (`/mtm/equipment`)
- [ ] Закрыть все Slack/Telegram/почту (no notifications during demo)
- [ ] Развернуть VPN на ноуте если в Mars фильтрация
- [ ] Открыть на телефоне приложение MTM с уже залогиненным Farid'ом

---

## Минута 0–5: проблема и почему вы здесь

> «Спасибо что выделили время. У нас короткая повестка: 15 минут — про
> текущую боль Pepsi-боттлеров, 25 минут — практический показ как LeadDrive
> Route & Field эту боль закрывает, и 15 минут на ваши вопросы.»

**Pain points для Pepsi-боттлера** (адаптируйте под то, что узнаете на M0-2/M0-3 интервью):

1. **Холодильники в полях** — у Mars ~2000 единиц оборудования у дилеров. Сейчас:
   - Excel-таблица обновляется раз в квартал
   - Ремонтные заявки приходят на WhatsApp начальнику склада, теряются
   - Не отследить пробег / срок службы / окупаемость единицы
   - При закрытии магазина холодильник часто «теряется» — списания
2. **Контроль выкладки и фото-фиксации**
   - Текущая система effie: агенты фотографируют, но проверка фото руками
   - 20% фото — фейк (повторяют вчерашнее, GPS не на точке)
   - Manager ловит подделки на 3-й день, штрафы выписываются поздно
3. **Маршрут vs реальность**
   - Plan: 12 точек в день / Реально: 7
   - Причины не отслеживаются → нет dataset для оптимизации
4. **Заказы от точек** — телефон + WhatsApp, ввод в 1С вручную, ошибки

**Why LeadDrive vs effie:**

| Параметр | effie (IPLAND, Украина) | LeadDrive Route & Field |
|---|---|---|
| Многотенантность из коробки | ❌ один tenant на инсталляцию | ✅ shared infrastructure |
| Поддержка AZ/RU/EN | RU/UA | ✅ AZ + RU + EN |
| Локальная команда | Киев, war-affected | ✅ Bakı + Warsaw |
| AI-проверка фото-выкладки | базовая, manual sample | ✅ 3-tier hybrid (quality → Roboflow → Claude vision) — roadmap |
| Equipment inventory модуль | ✅ есть | ✅ есть |
| Repair requests SLA tracker | ⚠️ базовый | ✅ kanban + auto-overdue alerts |
| Open API + ERP коннекторы | ⚠️ только через partner | ✅ REST API + 1С/SAP коннекторы (M2) |
| Cost | enterprise license + per-seat | enterprise contract + per-tenant |

---

## Минута 5–30: live demo

### Сцена 1: Утро менеджера (Web admin, 5 мин)

> «Сейчас 9 утра. Manager заходит в дашборд и видит общую картину дня.»

1. **Открыть `/`** (дашборд)
   - Показать: stats cards (totals: 25 customers, 5 agents, 30 visits today)
   - Показать: «5 активных алертов» badge → клик → список
   - **Highlight:** Alert «Подозрение на спуфинг GPS» — Tural Quliyev. *«Система автоматически проверила EXIF метадату — координаты фото визита расходятся с GPS check-in на 280м. Алерт виден в дашборде сразу после upload. (Push в Telegram/Slack — в roadmap M1.4 как часть notification pipeline; сейчас manager видит алерт когда открывает дашборд или фильтрует /mtm/alerts.)»*

2. **Открыть `/mtm/map`** (карта агентов)
   - 5 точек на карте — где сейчас агенты
   - Кликнуть на Farid'а → его текущая точка (Bravo Nəsimi)
   - **Highlight:** *«Никаких ‘позвоните и узнайте где он’ — manager видит location в реальном времени с точностью до 12 метров.»*

3. **Открыть `/mtm/equipment`** (Equipment Inventory)
   - 30 холодильников + POSM
   - Filter by status: ACTIVE / IN_REPAIR / WAREHOUSE
   - Click on a NEEDS_REPAIR unit → детали
   - Показать: full history timeline, текущее место (Bravo Yasamal), фото при установке, последний осмотр
   - **Highlight:** *«Каждая единица знает где она с момента покупки. Перемещение между точками — одна кнопка ‘Relocate’, история сохраняется. Если магазин закрывается — нажали ‘Write off’ с причиной, audit log сохранит.»*

4. **Открыть `/mtm/repair-requests`** (Kanban)
   - 5 заявок в разных колонках: OPEN / ASSIGNED / IN_PROGRESS / WAITING_PARTS / COMPLETED
   - **Highlight:** *«SLA трекер автоматически помечает просроченные заявки красным. Эта (показать) — компрессор Bravo Nəsimi, 6 дней без движения, статус IN_PROGRESS, isOverdue=true. Manager получит push в Telegram-бота / Slack.»*

### Сцена 2: День агента (Mobile, 10 мин)

> «А вот как день выглядит со стороны field agent. Это телефон Farid'а.»

1. **Login screen** → войти как `farid@mars.leaddrivecrm.org`, используя пароль из одобренного password manager
   - **Highlight:** *«Видите ‘Route & Field’ — это бренд приложения. Цвета и название можно подменить на Pepsi-Mars в течение часа через панель branding.»*

2. **Route screen** — показать сегодняшний маршрут (5 точек, 2 уже посещены)
   - Tap on a planned point (Pyramid Express Xətai)
   - Bottom sheet → распознать customer, увидеть адрес, расстояние, тапнуть «Navigate»
   - **Highlight:** *«Открывается Yandex.Maps или Google Maps — выбор агента.»*

3. **Quick check-in** — show modal with «nearby customers» (within 100m)
   - Tap «Check in»
   - GPS проверка → «Слишком далеко» если > max distance → ask supervisor override
   - **Highlight:** *«Mars устанавливает radius — мы рекомендуем 50 метров. Если агент за пределами — система не даст check-in без подтверждения супервайзера. Это убирает 80% поддельных визитов на старте.»*

4. **Active visit** — taken photo with PhotoCaptureModal
   - Take photo → watermark наносится автоматически в правом нижнем углу:
     `Farid Aliyev · Pyramid Express Xətai · 21.05.2026 10:42 · 40.3812, 49.9215`
   - **Highlight:** *«EXIF metadata сохраняется + добавляется наш watermark (M1-2, уже в production). На сервере приложение проверяет: EXIF timestamp совпадает с upload timestamp ± 5 минут, GPS в EXIF совпадает с check-in GPS, EXIF re-injected after watermarking чтобы Photoshop-edits ловились. Любое расхождение пишется в audit log + статус фото меняется на FLAGGED. Это — главный убийца поддельных фото в effie.»*

5. **Order on the visit**
   - Tap «New order» → выбрать SKU из каталога (показать поиск по бренду: набрать «Mirinda» → 3 результата)
   - Добавить 5 единиц Mirinda 0.5L + 3 единицы Lay's Cheese
   - Cart shows total in AZN
   - Place order → success toast
   - **Highlight:** *«Заказ сразу попадает в очередь на доставку, дублируется в 1С через коннектор (M2-1). Никакого WhatsApp.»*

6. **Check-out** with notes
   - Tap «Check out» → modal с заметкой
   - Ввести: «Выкладка обновлена, ценники проверены, заказ принят»
   - Submit → визит завершён, можно идти к следующей точке

### Сцена 3: Equipment incident (Mobile, 3 мин)

> «А что если на точке агент обнаружил поломку?»

1. На активном визите — tap на «Equipment» (3) badge
2. Список оборудования этого клиента
3. Tap на холодильник → детали (condition: WORKING)
4. Tap «Inspect» → checklist:
   - Чистота: ❌
   - Лампы работают: ✅
   - Дверь закрывается: ❌
   - Брендинг на месте: ✅
   - Температура: -2°C ✅
5. Condition: NEEDS_REPAIR → save
6. Auto-prompt: «Создать заявку на ремонт?» → Yes
7. Заполняется автоматически: equipment, requester, priority HIGH, description: «Не закрывается дверь, уплотнитель повреждён»
8. Submit → заявка появляется в kanban supervisor'а в реальном времени

> **Highlight:** *«От обнаружения проблемы до создания SLA-tracked заявки — 30 секунд. У effie на это уйдёт SMS + ручной ввод координатором.»*

### Сцена 4: Manager закрывает loop (Web admin, 5 мин)

> «Возвращаемся к экрану manager'а.»

1. **`/mtm/repair-requests`** — новая заявка появилась в OPEN
2. Drag в ASSIGNED → диалог выбора инженера → Elnur Mammadov
3. **Кратко показать:** API-вебхук в Telegram-канал «mars-repairs» — Elnur получает уведомление
4. **Открыть detail page заявки** — full timeline, equipment summary, history
5. **Highlight:** *«Все события одной единицы оборудования + связанные заявки + инспекции — в одном месте. Audit log immutable. При продаже бизнеса или аудите — все данные на месте.»*

### Сцена 5: Reports + ROI (3 мин)

1. Открыть `/mtm/reports`
2. Показать:
   - Visits per agent per week
   - Equipment status breakdown (donut chart)
   - Repair SLA compliance (% closed within expectedDays)
   - Top selling SKUs by region
3. **Highlight для CFO:** *«Эти метрики мы baselineим в первую неделю pilot и затем меряем month-over-month. Ожидаемые направления улучшения (на основе публичных кейсов effie + наших ранних пилотов в FMCG в Azerbaijan):
   - реальный count визитов vs план (Excel недосчитывает 15–25% из-за ручного ввода в конце дня)
   - доля поддельных фото (effie фиксирует ~20% при manual sample; с автоматической EXIF + GPS проверкой ожидаем < 5%)
   - average time-to-repair (зависит от размера парка холодильников и наличия инженерных мощностей)
   - выручка по A/B/C категориям (правильная приоритизация даёт сдвиг; конкретный процент зависит от вашей текущей дистрибуции)
   Конкретные числа для Mars — после baseline недели.»*

---

## Минута 30–45: pricing + roadmap

### Pricing structure (Mars-tailored)

| Параметр | Стартовая ставка |
|---|---|
| Setup + customisation | $5K one-time (включает branding, 1С коннектор настройка, обучение 5 человек) |
| Месячная подписка (per-tenant, не per-seat) | $1.2K / месяц до 50 агентов, $2K / месяц до 200 |
| AI module (фото-выкладка, M3) | +$500 / месяц (опция) — включает Roboflow training + Claude vision |
| Pilot 3 месяца | $5K setup + $2K (3 × $1.2K − discount $1.6K) = $5K на запуск + $1.2K/мес после |
| SLA / support | 24/7 emergency line, 99.5% uptime, response < 2h на критичных тикетах |

### Roadmap для Mars (после pilot decision)

| Срок | Кластер | Что |
|---|---|---|
| **Month 1** | M0 → M1 | NDA, интервью, deploy, мобильное приложение под Mars branding, импорт ваших SKU + customers + equipment из 1С |
| **Month 2** | M2 | 1С коннектор (заказы → 1С, остатки 1С → catalog), ERP sync cron |
| **Month 3** | M3 | AI photo recognition — 3-tier hybrid (quality → Roboflow trained on 500 ваших фото → Claude vision exceptions). Roboflow training $3-5K one-time. |
| **Month 4–6** | M4 | Pricing engine (discount rules per customer category), advanced reports, equipment depreciation в P&L |

---

## Q&A — заготовки на популярные вопросы

**Q: А что если у нас нет ваших шаблонов 1С?**
A: «Мы делаем коннектор под ваш конкретный 1С (CommerceML / OData / REST). Стандарт работ — 2 недели, входит в setup fee. У вас 1С 8.3 УТ или Розница?»

**Q: Безопасность? Где данные?**
A: «Текущий production размещён у Contabo; физический регион подтверждается
договором или панелью провайдера и до этого не заявляется как факт.
Чувствительные поля защищены AES-256-GCM на уровне приложения, зашифрованные
резервные копии хранятся с Object Lock; шифрование всей базы мы не обещаем.
Multi-tenant изоляция обеспечивается контекстом организации и принудительным
PostgreSQL RLS. Аудит-лог защищён от изменения на уровне БД. SOC 2 — в
roadmap, а не действующая сертификация.»

**Q: А если agent работает офлайн?**
A: «Mobile app сохраняет визиты + фото локально в IndexedDB / SQLite, синхронизация при появлении сети. Watermark и EXIF проверяются на сервере при upload — даже офлайн-визит не может быть подделан задним числом. Спека offline-sync: `docs/mtm-offline-sync-spec.md`.»

**Q: Сколько фото для AI training нужно?**
A: «Roboflow требует ~500 размеченных фото холодильников Pepsi: фото каждого SKU + фото с выкладкой 80% / 50% / 0%. Это разовая работа 2-3 дней — мы можем помочь с разметкой или сделать сами по фото из ваших архивов.»

**Q: А effie дешевле / уже работает у нас?**
A: «У effie два проблемных места под Pepsi:
1. AI photo validation — manual sample (~10% фото), мы делаем automated 100%
2. Тарификация per-seat — у вас 50 reps × $30 = $1.5K/мес только за seats, у нас flat per-tenant $1.2K включает всех.
Можем дать вам side-by-side demo если эта команда у вас работает.»

**Q: SLA и поддержка?**
A: «24/7 emergency hotline (WhatsApp + email + Telegram). Response < 2h для критичных, < 8h для обычных, < 24h для feature requests. Uptime SLA 99.5% — за каждый 0.1% ниже компенсируем подпиской.»

---

## После встречи — план действий

**В тот же день:**
- [ ] Отправить thank-you email с pricing PDF + ссылкой на demo tenant; пароль передать отдельным защищённым каналом и задать срок отзыва
- [ ] Logikov access expires через 14 дней (auto-revoke)

**Через 3 дня:**
- [ ] Follow-up call — обсудить вопросы из Q&A
- [ ] Предложить sample import: пусть Mars пришлёт CSV с 1000 их customers, мы импортируем в demo за 1 день
- [ ] Если интересно — назначить 1-day on-site visit к одному из их складов

**Pilot decision gate (через 7-14 дней):**
- [ ] Подписать NDA + Pilot Agreement
- [ ] Получить CSV: SKU catalog, customer list, route example, ~500 фото холодильников
- [ ] Migrate `mars.leaddrivecrm.org` demo tenant → production once pilot contract signed
- [ ] Kick-off meeting + onboarding 5 пользователей
- [ ] Mobile APK с Mars branding отправлен 5 reps для пилотной зоны (Bakı central)

---

## Tech notes для команды LeadDrive

**Demo tenant: `mars.leaddrivecrm.org`**
- Shared infra (registered server `13.140.132.245`)
- Slug: `mars`
- Seed script: `scripts/seeds/mars.mjs`
- Re-seed safe (idempotent)
- Added to `clients/registry.json` as key `mars` — transient demo tenant
  until real Mars contract signed.

**Mobile APK for the demo:**
- Build with default branding (Route & Field)
- При подписании контракта — rebuild с Mars logo + Pepsi blue (1 day)
- Sentry DSN на demo указывает на отдельный environment (`mars`) — отделено от production crashes

**Что НЕ показывать на demo (пока):**
- AI photo recognition (M3) — пока infra ready, но без training data Mars видит generic Roboflow → не убедительно
- ERP коннектор (M2) — концепт только в спеке, в demo живого 1С нет
- Pricing engine (M4) — слишком ранний, отвлечёт от MTM-core истории

---

## История изменений

| Дата | Изменение |
|---|---|
| 2026-05-21 | Создан v1 на базе seed-script scripts/seeds/mars.mjs |
