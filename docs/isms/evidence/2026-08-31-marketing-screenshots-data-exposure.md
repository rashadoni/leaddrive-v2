# Свидетельство: раскрытие данных в маркетинговых скриншотах

| | |
|---|---|
| Дата обнаружения | 2026-08-31 |
| Обнаружил | владелец (Rashad Rahimov) при просмотре `public/marketing/` |
| Зафиксировал | Claude, по поручению владельца |
| Уровень (ISMS-08 §2) | **Высокий** — затронуты данные арендатора и персональные данные |
| Статус | **исправление подготовлено 2026-09-01** (§9), на проде ещё не проверено. Контроль от повторения внедрён (§7). Остаётся история Git и `docs/screenshots/` (§8) |
| Связанные документы | ISMS-08 §6 (журнал), ISMS-09 (риски), ISMS-17 (правовой реестр) |

> Инвентаризация выполнена просмотром всех 48 файлов по одному.
> Ни один файл не отнесён к категории по имени или по догадке.

---

## 1. Суть

Каталог `public/marketing/` (29 PNG) лежит внутри `public/`, поэтому Next.js
раздаёт его **без авторизации**. Подтверждено владельцем 2026-08-31:

    curl -I https://app.leaddrivecrm.org/marketing/deals-pipeline.png   # 200, 360807 bytes
    curl -I https://app.leaddrivecrm.org/marketing/inbox-channels.png   # 200, 296129 bytes
    curl -I https://app.leaddrivecrm.org/marketing/crm-dashboard.png    # 200, 392522 bytes

Скриншоты сняты **на боевом арендаторе** «Güvən Technology LLC» под учётной
записью «Emil Rahimsoy», а не на демо-данных.

### Второй канал раскрытия, обнаруженный при разборе

Репозиторий `rashadrahimov/leaddrive-v2` на GitHub — **публичный**
(`gh repo view --json visibility` → `PUBLIC`). Отсюда следуют два вывода,
которых не было в исходной постановке задачи:

1. `public/marketing/` раскрыт **дважды** — сайтом и репозиторием. Удаление
   файлов из `HEAD` не убирает их из истории Git.
2. `docs/screenshots/` (19 PNG) сайтом **не** раздаётся, но через публичный
   репозиторий доступен так же свободно. Считать его «внутренним» нельзя.

### Индексация

`public/robots.txt` содержит `Allow: /` и не запрещает `/marketing/`.
Картинки слинкованы со страницы `/demo`, которая обходится краулерами.
То есть индексация не только возможна — ей ничто не мешало.

---

## 2. Инвентаризация: `public/marketing/` (29 файлов)

Арендатор «Güvən Technology LLC», пользователь «Emil Rahimsoy» видны
в шапке почти каждого файла.

### 2.1. Персональные данные (ФИО + рабочая почта + телефон)

Это самая тяжёлая категория: не коммерческая тайна, а персональные данные,
у которых есть отдельный правовой режим.

| Файл | Что видно |
|---|---|
| `ai-contact-detail.png` | **Elvin Abushev**, Head of the Special Projects Department, `elvin.abushev@zeytunpharma.az`, **+994 50 377 83 38** |
| `ai-lead-detail.png` | **Tarlan M. Mammadli (AZM)**, Azmade, `tarlan.mammadli@azmade.az`, **+99450 251-72-23**, **+(99412)377-44-44**, оценка сделки $5,000 |
| `ai-ticket-detail.png` | **R.Annihilator**, **+994512060838**, полная стенограмма переписки в WhatsApp |
| `inbox-channels.png` | `rashad.rahimov@zeytunpharma.az` (рабочая почта контактного лица клиента), `rashadrahimov@gmail.com`, превью сообщений |
| `ai-lead-scoring.png`, `ai-scoring-grades.png` | Tarlan M. Mammadli / Azmade ($21000), **Jahan Kh. Pashayev** / Mars Overseas ($21000 + $8500), ServiceDesk PMD / Pmdgroup ($12,500) |
| `ai-email-generation.png` | черновик письма на имя Tarlan M. Mammadli, Azmade |

### 2.2. Клиентская база и коммерческие условия

| Файл | Что видно |
|---|---|
| `companies-list.png` | **59 компаний-клиентов, 606 контактов, 4699 пользователей.** Читаются: «AAC» MMC, «AGHDAM GARDEN HOTEL COMPANY», «AGRARCO» MMC, «ATS FOOD» MMC, «AZBADAM» MMC, «AZERBAIJAN FISH FARM» MMC (www.aff.az), «Azerbaijan Green Energy Company», «Azerbaijan Poultry Company» MMC, «AZERTEXNOLAYN» MMC. У каждого — оценка HOT/WARM и число пользователей |
| `reports-analytics.png` | **Топ-10 клиентов по выручке**: ZEYTUN PHARMACEUTİCALS 59,709.72 ₼, MARS OVERSEAS BAKU LTD 38,331.83 ₼, AZERTEXNOLAYN 36,411.12 ₼, ATS FOOD 30,217.97 ₼, Facility Management Group 24,211.44 ₼. Месячные контракты 489,861.79 ₼ |
| `invoices-billing.png` | **Реестр счетов**: всего 727,938.27 AZN, просрочено 236,130.17 AZN. Поимённо: «AGHDAM GARDEN HOTEL COMPANY» MMC (HILTON GARDEN AGHDAM) 8,146.35 AZN, «Azərbaycan Gimnastika Federasiyası» İB (AGF) 9,605.14 AZN, «Synergia Academy» MMC 6,576.21 AZN — **со статусом overdue** |
| `deals-pipeline.png` | 13 сделок: Zeytun Pharma — ERP 25,000 USD, Pharmastore — контракт 15,000 USD и доп. 8,000 USD, «ZEYTUN PHARMACEUTİCAL» с номерами оферт GT-OFF-2026-001 / GT-OFF-2026-005 (1,800 / 16,284), Afigroup, Azerbaijan Green Energy Co 3,200 AZN, Zeytunpharma — New Deal 3,500 AZN |
| `support-tickets.png` | 22 тикета с названиями клиентов («ZEYTUN PHARMACEUTİCALS» MMC, «AGRARCO» MMC) и дословным текстом раздражённого клиента |
| `marketing-campaigns.png` | «Pharmastore news» (бюджет 5,000), «Pharmastore kampaniyası» — разослано 574/574, «Zeytun Pharma — Лид для Рашада» (бюджет 9,500) |
| `tasks-management.png` | «Promisgroup Microsoft discuss», «Initial outreach call to Rashad Rahimov» |
| `ai-deal-detail.png` | сделка «Firewall» / Afigroup 2,500 AZN + прайс продуктов |

### 2.3. Собственная финансовая отчётность Güvən Technology

Отдельная категория: это не данные клиентов, а конфиденциальные показатели
самого продавца, включая **убыток**. В переговорах такое читается против него.

| Файл | Что видно |
|---|---|
| `finance-treasury.png` | Выручка 3.6M AZN, расходы 3.9M AZN, **чистый убыток −297.9K AZN**, остаток ДС 177.4K, дебиторка 560.3K, кредиторка 13.8K, структура расходов (ФОТ 21%) |
| `ai-profitability.png`, `analytics-profitability.png` | Расходы/мес 646,755 ₼ против выручки 616,367 ₼, **маржа −30,388 ₼**, расход на пользователя 99 ₼, прямой труд 348,889 ₼ (52%). Юнит-экономика по услугам: HelpDesk **−147,469 ₼**, GRC −33,186 ₼, Проекты (PM) −29,876 ₼ |
| `budgeting-pnl.png`, `ai-budgeting.png` | Бюджет Q1 2026 план/факт: расходы 2,019,731 против плана 2,015,083; доходы 1,849,100 против плана 2,034,229; **маржа −170,631 ₼**, отклонение −189,777 ₼ |
| `crm-dashboard.png`, `ai-assistant-panel.png`, `platform-settings.png` | Выручка 616 367 ₼, 59 клиентов, «52 müştəridən 37 zərərli», разбивка выручки по услугам, «AAC» MMC в ленте активности |

### 2.4. Низкий риск и чистые файлы

| Файл | Оценка |
|---|---|
| `agent-desktop.png`, `ai-agent-desktop.png` | внутренние ИТ-инциденты («CRITICAL: диск полон», VPN, принтер). Названий клиентов нет; раскрывает эксплуатационную кухню |
| `events-management.png` | маркетинговые мероприятия, офис Güvən Technology. Риска почти нет |
| `ai-command-center.png` | только метрики ИИ, имён нет |
| `ai-portal-chat.png` | **чисто** — форма входа |
| `erp-projects.png` | **чисто** — пустое состояние |

---

## 3. Инвентаризация: `docs/screenshots/` (19 файлов)

Здесь арендатор — синтетический: «Demo Company» / «Demo User». Утечки
клиентских данных нет. **Но риск другой, и он не нулевой:** выдуманные
контракты и контактные лица приписаны **реальным** азербайджанским компаниям
и госструктурам, с правдоподобными адресами на их настоящих доменах.
Опубликованное в открытом репозитории, это читается как заявление о
клиентской базе, которого нет.

| Файл | Что видно |
|---|---|
| `contracts.png` | 8 «годовых договоров» на **2,004,000 AZN**, MRR 154,154 ₼: SOCAR Trading 580,000, Pasha Holding 345,000, Azercell Telekom MMC 298,000, Kapital Bank 215,000, Port of Baku 178,000, Azersun Holding 156,000, Bravo Supermarket 134,000, ASAN Xidmet 98,000 |
| `contacts.png` | 15 выдуманных лиц на реальных доменах: Aysel Nuriyeva / Silk Way Airlines / `aysel@silkwayairlines.com` / +994 55 400 5678; Elvin Mammadov / Azercell / `elvin@azercell.com`; Emin Aghayev / Pasha Holding; Farid Huseynov / Bravo; Gunay Mehdiyeva / Bakcell; Kamala Hesenova / SOCAR / `kamala@socar.az`; Leyla Quliyeva / Azersun; Nazrin Mammadova / SOCAR; Nigar Babayeva / Kapital Bank |
| `companies.png` | те же 8 реальных компаний как «клиенты», с отраслью и числом пользователей |
| `deals.png` | сделки: SOCAR ₼320K, ASAN Xidmət ₼210K, Azercell ₼145K, Silk Way ₼134K, Kapital Bank ₼95K. Плюс «Анализ конкурентов»: TechStar Solutions, Digital Wave, CloudBase Inc., NextGen IT |
| `dashboard.png` | Silk Way ₼134,000, Port of Baku ₼167,000, ASAN ₼210,000, Bakcell ₼78,000, Azersun ₼89,000 |
| `reports.png` | тот же топ-10 по выручке с реальными названиями |
| `inbox.png` | `leyla@azersun.com`, `farid@bravo.az`, `sevda@azergold.az`, `nigar@kapitalbank.az`, `rashad@abbsigorta.az` (+994506007890), `tural@pashaholding.az` |
| `tickets.png` | тикеты Port of Baku, Azersun, AzerGold, Kapital Bank, SOCAR, Azercell |
| `tasks.png` | задачи по AzerGold, Pasha Holding, Azercell, Azersun, SOCAR, ASAN, Kapital Bank, ABB Sigorta, Bakcell, Bravo |
| `leads.png`, `ai-scoring.png` | вымышленные фирмы (AzNet Solutions, TechVision MMC, GreenTech AZ, DataPro LLC, CloudAz, SmartBaku LLC, InnoTech Baku, DigiServ) — риск низкий |
| `profitability.png`, `invoices.png` | синтетические числа Demo Company; в `invoices.png` — TechCorp Solutions $2,400 |
| `budgeting.png`, `campaigns.png`, `journeys.png`, `knowledge-base.png`, `segments.png`, `ai-command-center.png` | **чисто** — агрегаты или пустые состояния |

---

## 4. Проверка PDF (`docs/LeadDrive-Product-Menu-AZ.pdf`, `-EN.pdf`)

**Скриншоты в PDF не попали.** Проверено разбором структуры файлов:

- `/Subtype` во всём документе только `/TrueType` и `/Type1` — это шрифты;
  ни одного image-XObject.
- `/XObject` — 0 вхождений, `/Width` — 0 вхождений, `/DCTDecode` — 0.
- Найденные `/Image` — это шаблонный массив `/ProcSet [/PDF /Text /ImageB
  /ImageC /ImageI]`, который пишет любой генератор независимо от содержимого.
- Размер 78 КБ и 75 КБ: один скриншот из `public/marketing/` весит 80–540 КБ,
  29 штук туда физически не помещаются.

Текст PDF (декодирован через `ASCII85Decode` + `FlateDecode`) назван
клиентами не является: единственное имя компании — сам продавец в колонтитуле
«Guven Technology LLC | Baku, Azerbaijan | leaddrivecrm.org», а «Gmail»
встречается как название пресета SMTP. **PDF трогать не нужно.**

---

## 5. Почему простого удаления файлов недостаточно

`grep -rn "marketing/" src/` показывает, что картинки не осиротевшие:

- `src/app/(marketing)/layout.tsx:29,35` — `/marketing/crm-dashboard.png`
  стоит как **`og:image` и `twitter:image` всего маркетингового сайта**.
  То есть именно этот файл соцсети и мессенджеры забирают себе в превью при
  каждой ссылке на сайт — и кэшируют у себя.
- `src/app/(marketing)/demo/page.tsx:139–159` — 20 файлов в галерее `/demo`.
- `src/lib/marketing-data.ts:51–99` — 7 файлов как иллюстрации модулей.
- `src/__tests__/lib-middleware.test.ts:161`,
  `src/__tests__/proxy-matcher-security.test.ts:22` — путь зашит в тесты.

Удаление файлов без правки этих мест сломает страницу `/demo`, превью ссылок
и два теста.

---

## 6. Решение владельца (2026-08-31)

Выбран вариант **«пересъёмка на демо-тенанте, замена одним разом»**: сначала
готовятся новые кадры, затем всё меняется одним PR. Сайт при этом не ломается
ни на минуту.

Обратная сторона зафиксирована сознательно: файлы остаются доступны всё время
подготовки. Риск озвучен владельцу до выбора, решение принято им.

## 7. Первопричина и внедрённый контроль

Разбор показал, что дело не в «забыли заретушировать». В `public/marketing/`
пишут **пять** скриптов:

| Скрипт | Кадров | Ретушь |
|---|---|---|
| `capture-marketing-screenshots.mjs` (Playwright) | 20 | **нет** |
| `capture-screenshots.mjs` (CDP) | 10 | денилист |
| `capture-ai-email.mjs` | 2 | нет |
| `capture-fixes.mjs` | произвольно | нет |
| `capture-advisor-screenshots.mjs` | → `docs/` | нет |

Ни один не проверял, на каком арендаторе он находится. Ретушь была ровно в
одном, и она **не сработала**:

- Скрипт с денилистом существует с 2026-03-27, картинки закоммичены
  2026-03-28 — днём позже. При этом в них видны `Güvən Technology LLC` и
  `616 367 ₼`, то есть ровно те строки, на которые нацелены его правила №1
  и №3. Значит, кадры делались не им.
- Даже если бы делались им — из 13 проверенных реальных идентификаторов в
  списке нет **ни одного**. А правило для клиента `AGRARCO` записано как
  `AGRARGO`: опечатка, из-за которой правило не могло сработать никогда, и
  никто об этом не узнал бы.

Денилист **проваливается наружу**: всё, чего нет в списке, публикуется.
Новый клиент завтра — это новая дыра.

**Контроль инвертирован.** Добавлен `scripts/screenshot-safety.mjs`: вместо
перечисления того, что прятать, он требует доказать, что открыт демо-тенант.

- `requireDemoTenant()` — без `SCREENSHOT_DEMO_ORG` съёмка не стартует вообще.
- `assertDemoTenant()` — перед **каждым** кадром проверяет, что на странице
  есть имя демо-организации. Пустая или недогрузившаяся страница тоже
  отвергается: она ничего не доказывает о том, под кем выполнен вход.
- Несовпадение арендатора прерывает **весь** прогон, а не пропускает один
  файл: иначе в каталоге смешаются демо- и боевые кадры, и различить их
  потом будет нечем.
- Список реальных маркеров оставлен, но как сигнализация второго уровня.
  Срабатывание означает «демо-тенант засеян из боевых данных», а не «ретушь
  отработала штатно».

Подключено ко всем четырём скриптам, пишущим в `public/`. Покрыто тестом
`src/__tests__/screenshot-safety.test.ts` (15 проверок, зелёные), включая
случай с опечаткой `AGRARCO` и отказ на пустой странице.

## 8. Что осталось сделать

- [ ] **Съёмка требует машины, которой здесь нет.** `capture-marketing-screenshots.mjs`
      поднимает Playwright + Chromium против работающего приложения. Контракт
      хоста запрещает браузерный E2E на Contabo, и локального `.env` с БД в
      этом воркитри нет (только `.env.example`). Прогон нужен на Mac-воркере
      либо на машине владельца.
- [ ] **Демо-тенант надо создать.** `seed-tenant-demo.mjs` требует
      `CONFIRM_PROD=tenant-demo-seed-v1` и работает по боевой БД — это
      производственное действие, нужна отдельная авторизация владельца.
      Важно: засеять его **выдуманными** данными, а не копией боевых, иначе
      сработает сигнализация второго уровня — и правильно сделает.
- [ ] Пять кадров не покрыты ни одним скриптом и добавлены в список
      `capture-marketing-screenshots.mjs`: `tasks-management`,
      `ai-command-center`, `ai-agent-desktop`, `ai-scoring-grades`,
      `ai-email-generation`. Пути к их страницам — предположение по имени
      файла, при прогоне их надо сверить.
- [ ] `docs/screenshots/` (19 файлов): не утечка, но выдуманные договоры на
      2,004,000 AZN приписаны SOCAR, Kapital Bank, Azercell, ASAN Xidmət,
      Pasha Holding. В публичном репозитории это читается как заявление о
      клиентской базе. Решается отдельно от `public/marketing/`.
- [ ] **История Git.** На момент события репозиторий был публичным; теперь он
      приватный, но ранее скачанные клоны/кэши могут сохранять коммиты
      `2db3690a2`, `52e811281`, `6145fcd10`. Полная зачистка — переписывание
      истории и отдельное решение владельца; перевод в private сам по себе не
      отзывает уже полученные копии.
- [ ] После замены — кэш поисковиков: `site:app.leaddrivecrm.org/marketing`
      в Google, плюс Google Images и Bing. При наличии — Removals Tool.
      `robots.txt` содержит `Allow: /` и `/marketing/` не закрывает, а
      картинки слинкованы с обходимой страницы `/demo`.
- [ ] Оценить обязанность уведомления клиентов (ISMS-08 §2, уровень
      «Высокий» → 24 часа после подтверждения).


---

## 9. Устранение в `HEAD` (2026-09-01)

Пересъёмка из §8 упиралась в Playwright-хост и демо-тенант, которых нет.
Обход найден другой: единственным потребителем `public/marketing/` была
галерея на `/demo`, а на лендинге уже работает система сценарных виньеток
(PR #1065). Галерея заменена на ту же секцию `ModuleScenes`, после чего
каталог удалён целиком.

| Действие | Итог |
|---|---|
| `public/marketing/` (29 PNG) | удалён из `HEAD` |
| Галерея `/demo` (20 кадров, карусель с фильтром) | заменена на `<ModuleScenes />` |
| Раздача сайтом `app.leaddrivecrm.org/marketing/*` | прекратится после мержа и деплоя — **на момент записи ещё отдаётся 200**; сюда вписать SHA и время после проверки на проде |
| `og:image` сайта | ещё 2026-09-01 переведён с `crm-dashboard.png` на `og-image.png` (PR #1068) |

Проверено перед удалением: ни одна страница, кроме `/demo`, на эти файлы не
ссылалась; `screenshot-safety.test.ts` и `privacy-policy-claims.test.ts`
проходят (48 тестов) — они стерегут логику скрипта съёмки, а не наличие PNG.

Виньетки ничего не выдумывают: они схематичны и не содержат ни имён, ни сумм.
Настоящие кадры вернутся на `/demo`, когда появится засеянный демо-тенант, —
задача §8 остаётся открытой, но перестаёт быть блокирующей.

**Не закрыто этим изменением:** файлы остаются в истории Git публичного
репозитория (коммиты из §8) — это отдельное решение владельца о
переписывании истории. Матчер `src/proxy.ts` по-прежнему пропускает путь
`/marketing/` мимо middleware; сейчас это безвредно (каталога нет), но если
кто-то вернёт туда файлы, они снова окажутся публичными — от этого страхует
`scripts/screenshot-safety.mjs` из §7.


## 10. `docs/screenshots/` и коммерческие предложения (2026-09-02)

§3 оценивал этот каталог как «не утечка, решается отдельно». При разборе
выяснилось обстоятельство, которого в §3 нет и которое меняет вес: файлы
не лежат мёртвым грузом — `scripts/generate-proposal.mjs` вставляет 18 из
них в PPTX, который отправляют потенциальным клиентам. Девять из этих
восемнадцати — те самые кадры с выдуманными договорами.

То есть каждое коммерческое предложение показывало адресату, что SOCAR
Trading, Pasha Holding, Azercell, Kapital Bank, Port of Baku, Azersun,
Bravo и ASAN Xidmət — клиенты компании. Это не гигиена репозитория, а
ложное коммерческое утверждение, сделанное с использованием чужих
фирменных наименований и их настоящих доменов в адресах «контактных лиц».

Там же обнаружилось, что каждый слайд-подвал подписан
`© 2026 LeadDrive Inc. | Warsaw, Poland`, а метаданные PPTX (`author`,
`company`) — «LeadDrive Inc.». Та же выдуманная личность, которую убрали
с сайта, продолжала уходить клиентам в презентациях.

### Сделано

| Действие | Итог |
|---|---|
| `docs/screenshots/`: contracts, contacts, companies, deals, dashboard, reports, inbox, tickets, tasks | удалены (9 файлов) |
| Подвал и метаданные PPTX | «Fanumsec MMC, Bakı, Azərbaycan» |
| `img()` в генераторе | больше не возвращает `null` молча: собирает пропуски |
| Запись файла КП | **fail-closed** — при любом отсутствующем кадре скрипт печатает список и выходит с кодом 1, ничего не записав |

Отказ проверен запуском: код возврата 1, PPTX не перезаписан. Проверять
пришлось без конвейера — `node ... | tail` возвращает статус `tail`, и
именно так подобные отказы уже проходили незамеченными.

Осталось чистым 10 файлов: ai-command-center, ai-scoring, budgeting,
campaigns, invoices, journeys, knowledge-base, leads, profitability,
segments — по §3 это агрегаты, пустые состояния либо выдуманные фирмы,
не совпадающие с настоящими.

**Открыто:** пересъёмка девяти удалённых кадров на засеянном демо-тенанте.
До неё генератор КП намеренно не работает — это предпочтительнее, чем
колода с дырами там, где должно быть доказательство.
