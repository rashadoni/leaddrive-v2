# Support — acceptance checklist исходного scope

Проверка источников: 2026-10-06. База этой правки:
`0dad3e4cc2bc1704e6be5258ee5e0874418ab1d4`.
Это checklist приёмки существующего поручения, не расширение разрешения на
разработку функций, production-данные, флаги, collector или выпуск.

## Источники и уровни доказательств

- Исходный `Leadrive_Support_UX_Audit_RU_2026-10-04.docx`, Library
  `libfile_6dd9fa35b540819185fe591a57133163`: 14 разделов, UX01–UX10,
  конкурентные ориентиры и последующая validation-программа, страницы 1–12.
- [План исправлений UX01–UX10](support-ux-audit-remediation-plan-2026-10-04.md).
  Его промежуточные NOT RUN не заменяют более поздний receipt #578.
- [Полный redesign backlog](support-module-ux-redesign-implementation-plan.md):
  191 SUPUX ID, 190 отмечены выполненными, `SUPUX-ROL-006` открыт.
  [Epic #496](https://github.com/rashadoni/leaddrive-v2/issues/496) и gates
  #492–495 закрыты с явным исключением ROL-006. Это не процент готовности продукта.
- [Roadmap условий поддержки](support-entitlements-roadmap.md): 49 ENT ID
  отмечены выполненными; scope пересекается с SUPUX, числа не складываются.
- [Rollout/performance](support-ux-performance-and-rollout.md) и
  [production observation](support-ux-production-observation.md) сохраняют
  собственные ограничения источника, baseline и семи полных дней.

| Метка | Что она доказывает |
| --- | --- |
| HISTORICAL | Записанный результат на указанном SHA, fixture, ролях и размерах; не сегодняшний production |
| LOCAL | Проверка кода/компонентов/изолированного fixture в cloud checkout; mock/contract не равен настоящему API/PG/browser E2E |
| LIVE | Датированная проверка текущего публичного SHA и выбранного tenant/роли; workflow public smoke помечается отдельно |
| NOT RUN | Нет подходящего результата для данной точной проверки; наличие кода или старого PASS его не заменяет |

Текущее получение пользовательской browser-сессии ведётся координатором:
cloud login открыт, safe-auth pending на момент подготовки. Этот checklist
не создаёт второй запрос входа и не содержит паролей, cookies или токенов.

## Receipts, которые разрешено переиспользовать

- **H578:** [37276946369, attempt 1](https://github.com/rashadoni/leaddrive-v2/actions/runs/37276946369),
  `eb13ec9afcfaab2be339e3d62375b979ff3944a5`: functional 11/11 (UX01–UX10 + PG),
  actual PostgreSQL 4/4, read-only UI 34/34, cleanup PASS. Alt+1/Ctrl+2,
  non-ordinal binding и typing/unbound/dialog guards подтверждены JSON.
  PG использовал disposable service superuser; это не non-bypass RLS proof.
  Односэмпловая UI-матрица не доказывает performance p75.
- **H-release:** [37331845621](https://github.com/rashadoni/leaddrive-v2/actions/runs/37331845621),
  merge `60ccd403fa172f2fafda31a9d4728c32933d4058`: штатный deploy/migration path,
  public full-SHA, DB ping, login/CSS/JS PASS. Raw logs не читались.
- **W-current:** [37363983130, attempt 4](https://github.com/rashadoni/leaddrive-v2/actions/runs/37363983130),
  база `0dad3e4cc2bc1704e6be5258ee5e0874418ab1d4`, SUCCESS 2026-10-06 05:58:31 UTC.
  Это workflow public smoke; не новый независимый authenticated Support проход.
  После H-release изменились только MTM ping, его тест и security-документ.
- **L-base:** 2026-10-06 на чистой базе `0dad3e4c…`: targeted 194/194,
  scenario-contract 21/21, readiness/collector/fixture guards 76/76;
  anti-pattern scan 47 TSX/0 findings; EN/RU/AZ 24 503 ключа, missing/extra 0.
  Эти проверки не запускали настоящий PostgreSQL или production browser E2E.

## Исходные десять замечаний — без подмены общим планом

Все строки имеют HISTORICAL H578 PASS. LIVE-повтор после входа пока NOT RUN.
Сохраняющие данные сценарии выполняются только в разрешённом disposable fixture;
production read-only проход не получает такого разрешения автоматически.

| ID / замечание | Конкретный критерий повторной приёмки | Исторический JSON case |
| --- | --- | --- |
| UX01 Пустая выборка выглядит как успех SLA | n=0: No data в UI/API/CSV; n>0: counts согласованы; scope/period видны; list/kanban/report filter/reset согласованы | `UX01-empty-report-ui-api-csv` |
| UX02 Рабочие часы обещаны сильнее чем реализованы | Legacy elapsed и opt-in calendar ясно различимы; timezone, breaks, holidays; пт16+4h → пн11, праздник пн → вт11; DST/stale-source/history preservation | `UX02-working-calendar-capture-stale-history` + PG |
| UX03 Одна сущность имеет три названия | Единый термин EN/RU/AZ; template → independent copy → draft/active → SLA; правка шаблона не меняет копию | `UX03-template-copy-draft-active-independence` |
| UX04 Тур маршрутизации не совпадает с экраном | Видимые корректные targets на desktop/mobile, skip/replay/Escape, выбранная вкладка сохранена | `UX04-mobile-tour-visible-targets-skip-replay` |
| UX05 Карточка предлагает дублирующие способы действия | Quick/full status/assignment: понятный момент сохранения, одинаковый ожидаемый эффект/audit, draft сохранён; Auto/360 объяснены | `UX05-quick-full-status-assignment-draft` |
| UX06 Пустая личная очередь не ведёт к новой работе | Agent/manager переходят к разрешённой неназначенной работе, права не расширяются | `UX06-empty-queue-agent-manager-real-permissions` |
| UX07 Эффект макроса скрыт в контексте тикета | Все эффекты/аудитория до Apply; Alt binding не зависит от позиции; typing/dialog/unbound guards; Cancel/Escape focus; draft и same-ID retry без дубля | `UX07-macro-preview-cancel-lost-response-retry-audience` + PG |
| UX08 Календарь не объясняет значение даты | Тип даты и timestamp согласованы в calendar/details/source; timezone/midnight/DST не меняют смысл | `UX08-calendar-datekind-zone-midnight` |
| UX09 Доступ в портал допускает неготовое начало | Email/readiness до enable, понятный следующий шаг, no false success/invitation; save/search/focus recovery; denied roles | `UX09-portal-prerequisite-ui-server-recovery` |
| UX10 Фильтры и просрочка жалоб неоднозначны | Заголовок, Close/Escape/focus; completed complaint показывает историческую, а не текущую просрочку | `UX10-complaint-historical-state-close-focus` |

UX02 сохраняет прежнюю доменную модель: waiting не становится автоматической
паузой, manual reopen сохраняет срок, customer reply пересчитывает окно.
Новые calendar snapshots не пересчитывают старые dueAt.

## Остатки P2/P3 и критерии для этой узкой правки

| Пункт исходного отчёта | Точный критерий | Текущий уровень / следующий шаг |
| --- | --- | --- |
| Область верхних карточек против фильтрованной выборки | При пустом поиске явно понятно, какие числа глобальные и какие отфильтрованы | H578 подтверждает report scope/sample; все верхние карточки LIVE NOT RUN |
| Timezone SLA и времени обновления | Clock label содержит явный UTC offset, соответствующий показанному browser-local времени, включая DST; не меняет SLA/time arithmetic | LOCAL: исправление этой ветки; LIVE NOT RUN |
| «Новая корневая» | EN/RU/AZ называют создание категории верхнего уровня; действие/parent остаются прежними | LOCAL: исправление этой ветки; LIVE NOT RUN |
| Cron/L1–L5/resolver | Плановая проверка объяснена без cron-жаргона; сохранены порядок L1–L5, максимум одно правило на каждый тикет за проверку, пауза 30 минут и пропуск достигнутых уровней | LOCAL: исправление orderBehavior этой ветки; полный residual copy audit LIVE NOT RUN |
| Демо-категории и статьи | Единый язык, рубрики, нет literal `\n`, SLA-примеры соответствуют настройке | NOT RUN на текущем tenant; никаких автоматических data cleanup |
| Имя рабочего места агента | Menu/header/help описывают одну сущность во всех языках | Исторические copy changes есть; свежая визуальная сверка NOT RUN |
| Плотность 12 колонок | На representative данных видны основные действия, читаемость и контекст без обязательного лишнего скролла | Historical layout evidence; свежая экспертная проверка NOT RUN |

## Конкурентная часть — ориентиры, не список автоматически отсутствующих функций

Исходник: DOCX страницы 8–9, официальные источники M1–M4, Z1–Z6, D1–D5,
F1–F5 на страницах 11–12, проверенные 2026-10-04. Новая актуализация тарифов
или одинаковый живой тест конкурентов этой веткой не проводились.

| Ориентир | Что сравнить в LeadDrive | Disposition |
| --- | --- | --- |
| ManageEngine Cloud: list/search/columns, reply/note, recipients, status, closure | Одна бизнес-цель: найти, назначить, ответить/завершить с понятной аудиторией | Recommendation; частично H578 UX05; полный parity NOT RUN |
| Zoho Desk: Work Modes, включая no-due; email против public comment; macros | Отдельно portal visibility, email delivery и data mutation | Recommendation; H578 UX07 не закрывает всю channel matrix |
| Zendesk: Solved/Closed, separate channel drafts, assignment | Правильный конечный статус и сохранение reply/note при переключении | Recommendation; draft/status historical receipts, fresh LIVE NOT RUN |
| Freshdesk: Card/Inbox/Table, saved views, public note, ограниченный Undo send | Плотность, аудитория и безопасная отмена отправки где возможно | Recommendation; аналог Undo send не установлен, разработка не включена автоматически |
| Все четыре: SLA business calendars | Рабочие часы, timezone, holidays и граничные сроки | Единственный прямо доказанный functional gap исходного DOCX; реализован #578, H578 + PG PASS |
| Zoho Enterprise Contracts/Support Plans; Zendesk/Freshdesk custom objects | Entitlement/rule selection, причина применения, исключения и ограничения | Свой ENT roadmap реализован по документу; эквивалентность чужим лимитам NOT RUN |
| Self-service/visibility и Zendesk Knowledge panel | Отдельный клиентский вход и помощь знаниями в контексте тикета | Recommendation; отсутствие Knowledge panel не доказано, parity NOT RUN |
| Mobile/accessibility | Одинаковые сценарии, размеры и методы проверки; ограничения из VPAT не превращать в общий балл | Historical bounded matrix, не полный WCAG и не comparative user study |

Не подменять ServiceDesk Plus Cloud другими редакциями, Freshdesk — Freshservice.
CMDB/change management не добавляются в CRM helpdesk scope автоматически.
Custom objects не доказывают готовый entitlement engine. Никакого общего
процента отставания/паритета или победителя по удобству источники не устанавливают.

## Повторный экспертный проход и operational validation

Каждая строка остаётся открытой до собственного подходящего receipt. Отсутствие
пункта меню само по себе не дефект: сверять задачу роли и page/API permission.

- [ ] **VAL-01 / LIVE:** после единственного pending auth подтвердить выбранный
  `leaddrive`, роль, текущий full artifact SHA; не сохранять auth/PII в evidence.
- [ ] **VAL-02 / FIXTURE:** UX01–UX10 before/after на одинаковых synthetic данных,
  сохранить source/role/locale/viewport и screenshots по разрешённому каналу.
- [ ] **VAL-03 / ROLES:** отдельные agent, manager, admin и client sessions;
  не подменять четыре роли одной широкой учётной записью.
- [ ] **VAL-04 / AGENT:** поиск по ID/теме/клиенту, понимание SLA, reply/note,
  assignment, completion; реальные сохранение, аудитория, audit, итоговый статус.
- [ ] **VAL-05 / MANAGER:** unassigned/overdue/waiting/no-due; scope метрик и
  фильтров; возврат в очередь с сохранённым контекстом.
- [ ] **VAL-06 / ADMIN:** template → terms → SLA/calendar/conflicts/why-rule;
  проверить mapping «Срочный» к SLA приоритетам, не объявлять gap заранее.
- [ ] **VAL-07 / CLIENT:** отдельный тестовый клиент; ticket/attachment/KB
  ownership и приватность внутренних заметок; delivery отдельно от visibility.
- [ ] **VAL-08 / RESPONSIVE:** ровно 390 px, native browser zoom 200%,
  keyboard/focus; не подменять zoom изменением CSS scale или старой 375 px матрицей.
- [ ] **VAL-09 / RECOVERY:** network failure, сохранение draft, безопасный
  idempotent retry; эффекты только в разрешённом изолированном fixture.
- [ ] **VAL-10 / EXPERT:** повторно оценить интуитивность всех E01–E14
  (тикеты, рабочее место, SLA, условия, шаблоны, категории, эскалации, макросы,
  маршрутизация, календарь, portal users, жалобы, KB, VoIP), nested ticket/portal
  journeys и дополнительный Support AI экран; критерий — понятны цель,
  следующий шаг, последствия и состояние без внешнего объяснения.
- [ ] **VAL-11 / DEMO:** по каждому разделу назвать конкретный безопасный
  сценарий и его ограничения; общий screenshot не подтверждает операции.

AI answer quality/classification/action safety, реальные VoIP effects и полный
WCAG остаются **NOT RUN в исходном экспертном проходе**. Mock/contract tests не
закрывают их. Тест новичков — отдельная предложенная возможность измерить
успешность/ошибочную аудиторию/помощь/время, а не уже выполненное исследование.

## Production observation — отдельное основание перед исполнением

- [ ] **OBS-01:** свежие authenticated tenant flag/audit/source reads и
  утверждённая representative activity; прошлое flag-off не считается текущим.
- [ ] **OBS-02:** согласованные handler baseline, effective logging, telemetry
  loss/coverage/continuity, incident review; UTC receipts и Asia/Baku дни.
- [ ] **OBS-03:** отдельное разрешение на collector/контролируемую активацию,
  точный tenant/current artifact/expected state, trusted audit + authenticated reread.
- [ ] **OBS-04:** семь полных календарных дней после подтверждённого admission;
  missing data не означает zero failures, fixture traffic не означает natural usage.
- [ ] **OBS-05:** отдельное решение по ROL-006/flag retirement после всех gates;
  source performance baseline review boundary 2026-10-08 не продлевается автоматически.

Collector artifact остаётся validation-only: `observationAdmitted=false`,
coverage/continuity `UNVERIFIED`. Эта ветка не запускает production collector,
активацию, merge/deploy или новую CI-модель допуска.

## Проверка этой ветки

После трёх UI-правок: scoped tests 77/77 PASS, Chromium Intl-offset probe
24/24 PASS (EN/RU/AZ × UTC/Baku/New York/Kathmandu × winter/summer).
Probe использует formatting options из текущего Tickets source, работает без
сетевых запросов и app/auth session; это не screenshot или E2E всей страницы.
Первоначальная проверка ожидала только `GMT` для UTC; Chromium возвращает
эквивалентное `GMT+0`. Исправлено ожидание probe, product code не менялся.
Translation parity: 24 503 ключа, missing/extra 0; scoped ESLint,
anti-pattern scan (47 TSX/0 findings), `git diff --check` PASS.

Независимое read-only review: блокеров нет; два замечания исправлены и
перепроверены — per-ticket scope плановой проверки и буквальное `\n` в checklist.
Это review этой правки, не новый обязательный CI `agent-review` gate.
Точный candidate SHA и CI-disposition фиксируются в draft PR.

H578, L-base и W-current не переименовываются в проверки изменённого candidate.
Full typecheck/production build NOT RUN локально: узкая UI/copy правка,
блокирующие CI-gates остаются штатными; draft skip не считается их PASS.
Authenticated LIVE-проход/native zoom/full-page visual NOT RUN здесь.
Timestamp сохраняет прежнюю видимость только от `sm`; мобильная приёмка
не закрывается этой правкой. Merge/deploy не выполнялись.
