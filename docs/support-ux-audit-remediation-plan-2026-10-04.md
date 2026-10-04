# Support UX audit — план исправлений 2026-10-04

## Основание и границы
Полностью прочитан Leadrive_Support_UX_Audit_RU_2026-10-04.docx из предоставленной владельцем Library: 57645 bytes, SHA256 564c95b1ce049ff21a746457821f72b7f43f899d0cd70fa25c0860a4a1d24fd4. Материализация подтверждена в исполнительном workspace; репозиторий на Mac не копируется. Источник — когнитивный проход 14 разделов 18:05–18:14 UTC, одна широкая роль; серверные эффекты наблюдением не доказаны.
Поручение владельца в 19:25 UTC разрешает план, исправления, тесты и draft PR. Merge/deploy/производственные данные и настройки не входят. Исходная Support ветка codex/help-ai-guides чистая на d43f9951b и ожидает отдельные evidence; её файлы не меняются. Работа из отдельного Contabo worktree leaddrive-support-ux-audit-20261004, ветка codex/support-ux-audit-20261004, base 409e4fc98f1522bf7f60a30941f26c9e36a2eb13. Открытого конкурирующего Support PR при старте нет; HRM #576 не затрагивается. Перед каждым checkpoint повторно сверять dirty-state исходного Support worktree/открытые PR, при пересечении остановить только конфликтующие правки. Нельзя считать clean-status доказательством отсутствия активной сессии; штатный инструмент чтения сессий в текущем executor не предоставлен.
Mac UI/AX/CUA/screenshots/keyboard запрещены. Heavy build/fullcompiler/fullsuite/browser только разрешённый hosted Linux/отдельный браузер координатора; на Contabo малые targeted checks. Никаких credentials/security/baseline ослаблений. Ни один пункт не DONE до независимой приёмки.

## Контекст UX
Из поручения и аудита: агенты обрабатывают обращения, руководители оценивают очередь и SLA, администраторы настраивают условия/правила, клиенты используют портал. Тон точный, спокойный, операционный; сохранение текущего CRM оформления и доступных действий. EN/RU/AZ должны описывать одну фактическую модель, без технического жаргона и ложных обещаний.

## Очередь UX01–UX10
| ID | Приоритет / доказанность | Работа | Приёмка |
|---|---|---|---|
| UX01 | P1, подтверждённая ложная 100% пустой выборки; формула теперь найдена в API | Null при нулевом знаменателе, «Нет данных» на экране/CSV, числитель/знаменатель/область/период. Сохранить текущую семантику активной очереди, явно отличить отсутствие текущей просрочки от исторического выполнения обязательств. Отдельно проверить область верхних карточек. | n=0 никогда не процент; n>0 процент совпадает с показанными counts; пустой поиск и сброс в list/kanban/reports; UI/CSV одинаковы; текущий фильтр явен. |
| UX02 | P1 для обещаний рабочего SLA; P2 текст подтверждён; функциональный календарь отсутствует в текущем resolver | 02a: сохранить переключатель как предпочтение, назвать его честно; календарный отсчёт рядом со сроками/в матрице/справке/preview. 02b: проверить и определить versioned calendar contract: authoritative timezone, week intervals/breaks, holidays, start anchors, pause/resume, reopen, DST, invalid/ambiguous local times; согласовать применение к новым срокам, без изменения истории. | 02a: нигде нет обещания работающего business-hours режима. 02b отдельно: пт16:00+4h при пн–пт09–18=пн11:00; праздник пн→вт11:00; timezone/DST/break/pause boundaries/reopen проверены; старые dueAt неизменны без согласованной миграции. Текст не закрывает 02b. |
| UX03 | P2, подтверждённые три имени одной сущности | Единый термин «Условия поддержки» в навигации/заголовках/SLA/справке; объяснить шаблон→копия условий клиента→правила/SLA и независимость копии после создания. Проверить реальное копирование до утверждений текста. | Один основной термин EN/RU/AZ; сквозной пример draft→active и выбор SLA соответствуют реализации; изменение шаблона не обещает ретроактивного обновления. |
| UX04 | P2, подтверждённый stale routing tour | Привязать tour к фактическим target-элементам, убрать хрупкие «сверху/ниже», проверить responsive target, skip/restart. | Все шаги указывают на видимые правильные области на поддерживаемых ширинах; текст совпадает с экраном; пропуск/повтор доступны. |
| UX05 | P2, дубли/неясные имена видны; несовпадение backend-эффектов НЕ доказано | Проследить handlers status/assign/self/auto/360. Сначала объяснить быстрый и полный путь/момент сохранения; не удалять UI-разделы без явно согласованного изменения. | Синтетический тикет: одинаковый ожидаемый status/assignee/audit, понятная аудитория и сохранение, «Авто» и «360» расшифрованы; нет дублирования операций/потери черновика. |
| UX06 | P2, подтверждённый бесполезный переход assignee=me | Пустой личной очереди дать разрешённый путь к неназначенным или объяснить назначение руководителем; согласовать menu/header. | Под агентом/руководителем пустой экран ведёт к доступной работе, не к той же пустой выборке; права не расширены. |
| UX07 | P2, эффекты макроса перед запуском ещё НЕ проверены | Проверить выбор→preview→apply; при отсутствии preview показать все действия, аудиторию, сохранение, отличить text insertion от mutations; сохранить hotkeys и safety. | До исполнения все эффекты/получатели видны; cancel без эффекта; real isolated apply и audit соответствуют preview; повтор без дубля. |
| UX08 | P2, семантика даты неясна; неверный timestamp НЕ доказан | Проследить источники событий ticket due/task scheduled и timezone, дать легенду/label/detail consistent. | Одна дата и её тип одинаковы в calendar/details/source; timezone явен; DST и midnight не дают иной даты. |
| UX09 | P2, кнопка без email видна; обход server validation НЕ доказан | Проверить readiness/server preconditions; объяснить отсутствующий адрес до включения, дать допустимый переход к контакту. | Нет ложного success/отправки invitation без данных; осмысленная ошибка/next step; реальные разрешённый/запрещённый backend пути в изолированном fixture. |
| UX10 | P2, modal title/close отсутствуют; смысл closed-overdue требует проверки | Добавить видимый заголовок/close, сохранить Escape/focus; проследить due/resolved timestamps, отделить текущую просрочку от исторической. | Close кнопкой/Escape возвращает фокус; resolved complaint не выглядит активной проблемой; историческая подпись соответствует timestamp/contract. |

## Дополнительные P3 и гипотезы
- Демо-категории/статьи: единый язык, буквальные переносы, рубрики, согласованный SLA пример. Не чистить tenant data автоматически; сначала источник seed/demo и безопасный отдельный patch.
- «Новая корневая», cron/L1–L5: понятные labels/объяснения, не менять семантику.
- Верхние counters при поиске: проверить global-vs-filtered scope и явно назвать его; не объявлять ошибку counts без сравнения запроса.
- Поддержка urgent/critical, портал под клиентом, mobile 390 / keyboard / 200%, draft/network retry — отдельные проверки, не выводить из единственного широкого входа.

## Первый ограниченный блок
UX01 + UX02a + UX03. Исследование UX02b фиксируется, но календарь не считается реализованным. Выборка текущего отчёта — все отфильтрованные ACTIVE tickets, numerator=active-currentlyBreached; это operational snapshot, не historical completed-obligations rate. В первом блоке нельзя незаметно изменить denominator contract.
Подтверждён код: reports/route.ts пустой fallback 100; sla-resolver.ts прибавляет часы к epoch; milestone-due-calculator.ts явно defers calendar; SlaPolicy.businessHoursOnly хранит предпочтение. Переключатель остаётся доступным; данные/сроки/паузы не мутируются.

## Проверки и выпуск
1. Targeted API behavior tests: empty/nonempty/mixed filtered sample, counts, query scope; targeted SLA/entitlement regression tests.
2. Scoped ESLint; translations parity; diff/secret scan по неизменённой конфигурации. Fullcompiler/build локально NOT RUN, hosted проверки отдельно.
3. Draft PR с точным списком изменений/ограничений, без merge/deploy. Draft skips не означают пройденные heavy gates.
4. Независимый повторный браузерный проход координатора на правильной версии и синтетических данных: screenshot before/after, filter/reset, CSV, SLA modal/table/help, terminology EN/RU/AZ. Не просить и не поручать Mac UI.
5. Итог каждой UX задачи: IMPLEMENTED / VERIFIED / ACCEPTED раздельно. Зелёный CI не заменяет независимую приёмку.
Support completed-day evidence до 20:00 UTC не запускать; это отдельное согласованное продолжение и не dependency правки UI.

## Checkpoint первого блока: реализация завершена, независимая приёмка ожидается
- UX01: API null при active=0; UI/CSV в очереди Support и общем разделе reports «Нет данных», numerator/denominator, применённая область/период. Существующий operational denominator всех active (в том числе без SLA due date) сохранён и явно объяснён; метрика названа «Активные без просрочки SLA», не историческим compliance.
- UX02a: переключатель сохранён как предпочтение, календарный расчёт назван у сроков/матрицы/preview/справки EN/RU/AZ. UX02b календарный движок НЕ реализован; сроки/паузы/reopen writers и история не изменены.
- UX03: основные menu/title/list/help/SLA dependency labels согласованы; template copy объяснён на основании реального create-copy endpoint.
- Targeted tests 73/73 в 6 файлах PASS. Изменённый production source и остальные test/help файлы ESLint PASS; api-reports-journeys.test.ts содержит 84 прежних no-explicit-any diagnostics, совпадающих с base по rule/message/source line; новых 0. Первая scoped lint попытка: 87 diagnostics сохранена в журнале исполнения: 84 прежних any + 3 прежних JSX-апострофа; последние исправлены без изменения правил. Whole-file lint этого legacy test не объявляется чистым.
- Translation parity EN/RU/AZ: 24442 leaf keys, missing 0 / extra 0 PASS; diff-check PASS. Full typecheck/build/fullsuite/реальныйDB/browser/independentacceptance NOT RUN в этом блоке; draft skips не являютсяPASS.
- План UX04–UX10/P3 сохраняется; ни один из 10 пунктов не объявлен независимо ACCEPTED. HRM #576 и исходный Support worktree не изменены.

## Продолжение: UX04, UX06, UX09, UX10
- UX04 IMPLEMENTED: очередь → агенты; положение больше не описано как «сверху/снизу». Во время тура нужная мобильная панель видна, после завершения сохраняется выбранная пользователем вкладка.
- UX06 IMPLEMENTED: подтверждено, что реестр читает owner=mine/unassigned, а прежний assignee=me не является его контрактом. Заголовок теперь явно обозначает личную очередь; пустая очередь открывает неназначенные обращения через существующий разрешённый tickets/read маршрут.
- UX09 IMPLEMENTED: сервер уже отвергал single/bulk enable без email/активного контакта. UI предлагает редактирование email, не вызывает enable преждевременно и объясняет блокировку неготовой массовой выборки. Серверные права и операции отправки не изменены.
- UX10 IMPLEMENTED: подписанный popover с видимым Close использует штатный Radix Close/Escape/focus return. Для завершённой жалобы SLA сравнивается с resolvedAt, затем closedAt; при отсутствии времени завершения история не выдумывается. Текущая красная просрочка относится только к незавершённым обращениям.
- Targeted checks: 74/74 tests в 9 файлах PASS; scoped ESLint новых/изменённых файлов PASS. Независимая браузерная приёмка этих пунктов ещё NOT RUN.

## Продолжение: UX05, UX07, UX08
- UX05 IMPLEMENTED: быстрые status/assign и полные controls прослежены до общего updateTicketFields; Auto отдельно вызывает существующий PATCH routing. Добавлены объяснения момента сохранения, «Автоназначение» и «Контекст клиента», разделы сохранены. Сквозной браузерный synthetic workflow ещё NOT RUN.
- UX07 IMPLEMENTED: выбор в меню/shortcut открывает полную последовательность действий и аудиторию до применения. Отмена ничего не отправляет; черновик ответа не вставляется и не удаляется. UI отправляет expectedActions + requestId; сервер отвергает изменившийся preview, сериализует подтверждённые действия блокировкой ticket row, сохраняет receipt/audit в той же transaction и возвращает повтор без дублей. Legacy API request без preview сохраняет прежний контракт. 64/64 targeted macro tests PASS; реальные PostgreSQL concurrency/rollback и браузер ещё NOT RUN, unit mocks не доказывают их.
- UX08 IMPLEMENTED: календарь различает SLA/task due, scheduled, event start, resolved/closed/completed, created fallback и undated-today. Время обозначено в browser IANA timezone; запрос содержит точные UTC instants границ локальных дней, включая смену offset/DST. Resolved ticket использует resolvedAt вместо случайной даты создания. Старые timestamps не меняются. 19/19 calendar tests PASS.
- Независимая приёмка UX04–UX10 остаётся PENDING; будущие draft skips не считаются PASS.

## Support observation: read-only collector 2026-10-04
Запущен после границы в 2026-10-04T20:00:24Z: https://github.com/rashadoni/leaddrive-v2/actions/runs/37230421845 .
Штатный protected main workflow tail-app-logs.yml, view=support-ux-observation, выбранный tenant leaddrive, support_day=2026-10-04 (Asia/Baku), expected_main_sha=14eb96914c6a9a01464cd880091e992123fae054. Workflow/job SUCCESS по metadata; raw CI logs не скачивались.
Observation admission НЕ выполнен. Workflow не публикует отдельный структурированный artifact результата. Coverage/log continuity, activation receipt + authenticated reread, суточные samples/latency/incident review не выведены из SUCCESS. Флаг и production данные не менялись; atomic operator не запускался. Не считать этот день началом или одним из семи принятых полных дней.

## Продолжение: UX02b — рабочий календарь реализован, приёмка ожидается
Все UX01–UX10 теперь имеют реализацию в draft. Это не означает ACCEPTED или готовность к merge/deploy.
- UX02b IMPLEMENTED: явный opt-in в копию активного общего BusinessHours, IANA timezone, недельные интервалы/перерывы, праздники, strict DST boundary rejection и immutable snapshots. Изменившийся после preview источник возвращает 409. Legacy policy без snapshot по-прежнему использует elapsed calendar time.
- Контракт: [support-sla-business-calendar-contract.md](support-sla-business-calendar-contract.md). Сохранены существующие anchors/reopen: customer reply пересчитывает окно, manual status reopen сохраняет срок; waiting не является паузой. Pure helper умеет исключать явно переданные завершённые паузы, автоматический pause/resume не добавлен.
- Новые Ticket/SlaPolicy nullable JSON и migration только ADD COLUMN, без backfill. Миграция НЕ выполнялась; существующие сроки/производственные настройки не изменялись. Новые milestones получают snapshot в существующей metadata.
- Prisma schema validate PASS с фиктивным неиспользуемым адресом БД. Shared node_modules не генерируется и не изменяется. Реальная локальная PostgreSQL проверка недоступна: Docker socket permission denied, psql не найден в PATH; обход прав не выполнялся. Hosted evidence и независимая приёмка остаются отдельными этапами.
- Финальный узкий блок: 125/125 SLA/resolver/milestone/reopen/API tests и 28/28 UI-contract/RBAC tests PASS (8 файлов). Scoped ESLint 18 TS/TSX файлов PASS; i18n 24490 leaf keys, missing/extra 0; git diff --check PASS. Первоначальная попытка с неподдерживаемым --minWorkers не запустила тесты; успешный повтор использовал --maxWorkers=1. Full typecheck NOT RUN: draft gate намеренно пропускается, Next build имеет ignoreBuildErrors и не заменяет typecheck.

### Hosted evidence checkpoint
Run 37232250247 на b467d00d6363efb59c29bb74e8ddb3811c054504 остановился до build/browser: штатный anti-pattern scan обнаружил отсутствие focus-visible у нового summary календаря. Исправлен реальный keyboard focus style без изменения scanner/gates. Точная scoped SLA последовательность воспроизведена на Contabo одним worker: scanner 0 findings, lint/translation parity PASS, 102/102 tests в 11 файлах PASS. Raw CI logs не скачивались. Артефактов browser нет, поскольку capture ещё не запускался.
