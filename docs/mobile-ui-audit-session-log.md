# Mobile UI audit and simplification — session log

This file is append-only. It preserves requirements, decisions, implementation evidence, and the exact continuation point when chat history is compacted.

## 2026-09-19 — recovered scope and corrected baseline

- User approved simplifying the mobile Route & Field application for tablet-first use while preserving phone compatibility and both portrait and landscape orientations.
- Requested route-planning changes: date-only planning, no planned time, no draft step, month calendar, clients in the main navigation, add a client to a route for a selected date, and label the navigation action as “Как добраться”.
- Requested field-control changes: 30-minute visit guidance, reliable agent location on the manager map, detailed visit actions, and evidence that product presentations were opened, including time and location.
- Requested commercial hierarchy: product presentations grouped per agents/managers; managers own groups and subgroups; agents receive the relevant group.
- Requested client model: every client is a person located at one or more organizations; administrators can assign/unassign agents and the mobile application must remove out-of-scope client data; agents can add a doctor with name, specialty, address/clinic, phone, and notes.
- Requested SaaS customization: tenant administrators can add and change client categories such as doctors and pharmacies, with different fields for each category.
- Corrected an earlier stale-branch assessment. Current mobile `current/main` at `34ffca0` already contains presentation tracking, manager visit evidence, product hierarchy/membership, contact assignment tombstones, 30-minute visit guidance, location/map fixes, simplified date-only routes, Clients in main navigation, add-to-route, month calendar, and rotation navigation fixes.
- Physical tablet verification remains pending because neither the normal ADB server nor the forwarded ADB server at `127.0.0.1:35037` currently lists a device.

## 2026-09-19 — configurable client categories implementation

- Server worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mtm-configurable-client-types`, branch `codex/mtm-configurable-client-types`, based on server `active-github/main` commit `67e3f2800`.
- Mobile worktree: `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mtm-presentation-evidence-mobile`, branch `codex/mtm-presentation-evidence-mobile`, based on mobile `current/main` commit `34ffca0`.
- Added governed `CLIENT_TYPE` dictionaries with multilingual category labels, configurable fields, field types, required rules, and select options.
- Added `MtmContact.categoryData` and a migration so tenant-specific values remain separate from the signed category schema.
- Assignment validation rejects unknown fields, missing required values, invalid numbers, and unsupported select options.
- Web contact detail can assign/change a category and its fields; sync pull includes the category and field values for offline mobile use.
- Contact creation now loads active tenant categories, renders the correct fields, validates required inputs, and writes the person, workplace, category assignment, and category data together.
- Added a visual SaaS administrator builder for categories, fields, field types, required flags, and select options. Active configuration is changed by creating a prefilled new immutable version, preserving audit history.
- Mobile contact detail now displays the configured category in the header/summary and displays localized category fields in the overview, online and from the offline snapshot.
- Verification completed: server translation parity passed; Prisma schema validation passed; 43 targeted server tests passed; targeted production-file ESLint passed; server `git diff --check` passed. Mobile contact-detail suite passed 12 tests; mobile targeted ESLint passed; mobile TypeScript `tsc --noEmit` passed; mobile `git diff --check` passed.
- Full server TypeScript/build was not rerun locally: a previous full `tsc --noEmit` exhausted the local Node memory limit, and host rules require the heavy gate to run in CI.

## Current continuation point

- Next: checkpoint-commit the server and mobile changes, push feature branches, open/observe CI, then merge/deploy only after green required checks.
- After a tablet becomes visible in ADB: install the resulting mobile build and verify Clients, route planning/month calendar, configurable category fields, presentations, maps, and navigation in portrait and landscape.

## 2026-09-19 — release and deploy continuation

- The previous continuation point is superseded: server PR `rashadoni/leaddrive-v2#241` and mobile PR `rashadoni/leaddrive-mtm#66` were merged after green CI.
- Mobile main produced release `v3.3.0-build256`; the APK was downloaded and its published SHA-256 checksum passed.
- Server production workflow run `35467618741` passed quality/security and artifact-build jobs; the atomic production deployment was still running when this entry was appended.
- ADB was checked again through both the local server and forwarded server at `127.0.0.1:35037`; both device lists remained empty, so no physical-device visual claim has been made.
- Per the user's explicit instruction, removed the three Social Monitoring-specific requirements from the shared deploy workflow: standalone page-manifest assertion, queue-scheduler smoke, and authenticated browser smoke/evidence upload. General build, security, database, MTM, scheduler, revision, ping, and asset smokes remain intact.
- Current continuation point: finish and smoke-check the active production deployment, publish the deploy-gate cleanup through review/CI, then install build 256 and complete portrait/landscape visual verification as soon as ADB exposes the device.

## 2026-09-19 — production completion and deploy-gate cleanup

- Server PR `rashadoni/leaddrive-v2#241` deployed successfully in workflow run `35467618741`; atomic deployment, database-path ping, deployed revision, login page, and hashed asset smokes all passed.
- Deploy-gate cleanup PR `rashadoni/leaddrive-v2#242` passed static checks and the full TypeScript gate, then merged as `b594797fb65059f4ae9192a3d5a4e60f9e9d14e5`.
- The next main commit `df65ee2bb1c33cd73c23465687809ee316c03c0f` contained the cleanup and superseded the first control run through the workflow concurrency rule.
- Final production workflow run `35470189884` completed successfully. Its actual deploy job contained the general security, database, MTM, scheduler, tenant-isolation, ping, revision, and asset checks, and contained no Social Monitoring step.
- Mobile release remains `v3.3.0-build256`; the verified APK is staged at `/tmp/leaddrive-mtm-build256/leaddrive-mtm-v3.3.0.apk` for installation.
- Current continuation point: both code releases and production deployment are complete. Physical portrait/landscape verification is the only unfinished item; resume by installing build 256 when the forwarded or local ADB server lists the phone/tablet.

## 2026-09-20 — physical phone audit and Outlook-style route calendar

- The previous continuation point is superseded: the forwarded ADB server at `127.0.0.1:35037` exposed the user's USB-connected Galaxy S23 Ultra (`SM_S918B`). Release `v3.3.0-build256` was checksum-verified, installed, opened with the existing demo account, and visually inspected from real device screenshots and UI-automation trees.
- The production bootstrap returned the old `fieldContactsEnabled=false` policy, causing the approved person-first client directory to appear as “Места”. Mobile policy handling was corrected so the primary destination is always “Клиенты”; organization/place context remains inside that directory.
- The month calendar was confirmed to contain route counts but rendered routes as dots only. It now preserves compact route summaries from `/mobile/week` and renders Outlook-style event rows directly in each relevant date: route name when present (otherwise “Маршрут”), point count, up to two rows plus an overflow count on tablets, and a compact route row on phones.
- The tablet calendar was changed from a narrow 55% split pane to a full-width seven-column month before the selected-day details. This gives route rows enough room and keeps date selection as the single path to the detailed plan for that day.
- The bottom navigation received an explicit high z-layer to keep all six destinations visible through Android rotation redraws.
- Mobile PR `rashadoni/leaddrive-mtm#67` passed scope, test, TypeScript, signing, APK/AAB build, package/version and signature verification, then merged to `main` as `fec03ed9428cb13669f504b8d5915ceaced780ae`.
- Main workflow run `35476085262` passed and published prerelease `v3.3.0-build259`. The published APK checksum passed, installation succeeded, and the device reports `versionCode=1259`.
- Physical phone acceptance passed in portrait: the main navigation says “Клиенты”, dates with demo routes show visible route rows, and all six bottom destinations are present. Physical phone acceptance passed in landscape: the calendar shows readable route rows and all six destinations remain visible.
- Because the Wi-Fi tablet did not appear in forwarded ADB or mDNS, physical-tablet acceptance remains `NOT RUN`. A reversible 2560×1600/320-dpi tablet viewport was applied to the connected phone instead; it confirmed the full-width Outlook-style grid, route rows/counts, and complete left navigation. This is responsive-layout evidence, not a claim that the physical tablet was inspected.
- The temporary viewport and orientation overrides were removed. Final device state was verified as physical 1080×2316 at 450 dpi, `accelerometer_rotation=1`, `user_rotation=0`.
- Verification: 39 targeted Jest tests passed; targeted ESLint passed; `npx tsc --noEmit` passed; `git diff --check` passed; PR and main Android CI passed; release checksum and install passed; real portrait/landscape device screenshots and UI trees passed.
- Current continuation point: code, release, phone installation, portrait/landscape acceptance, and simulated tablet responsive acceptance are complete. When the Wi-Fi tablet becomes visible in ADB, install release build 259 there and repeat the physical tablet portrait/landscape acceptance; no additional code change is currently required for this calendar request.

## 2026-09-20 — route-flow confusion audit and recovery implementation

- The previous continuation point is superseded. A new physical audit on the connected Galaxy S23 Ultra confirmed that the active route repeated the current client in the route-point list, showed a route journey strip and route summary above a second active-visit workflow, placed “Изменить план” inside the “Точки маршрута” heading, and appended another self-planning promo below the same published route.
- Tapping “Задачи и презентации” opened a screen titled “Итог визита” during an active visit. That screen mixed product presentations, assigned tasks, result history and every policy snapshot action, including OPTIONAL “Чек-лист” and “Следующее действие”. This is the confirmed source of the user-reported confusion.
- Mobile work now continues on `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-mtm-presentation-evidence-mobile`, branch `codex/field-ux-simplification-v2`, based on mobile `current/main` commit `fec03ed`.
- Implemented but not yet released: one active-visit action list; separate Presentation and Visit tasks entries; inline completion checks; only REQUIRED policy actions are shown; the retired CHECKLIST and NEXT_ACTION rows are hidden; active client duplication is removed; route journey/summary are hidden while a visit is active; change-plan is separated from the section title; the redundant planning promo/hint is removed.
- The Today screen now preserves and renders the whole route client list instead of exposing only the next client.
- The web team-message send path already created threads, messages, notifications and receipts, but the mobile application had no Messages screen or API call. A Team messages screen, unread banner on Today, read receipts and acknowledgement receipts are now implemented in the mobile branch.
- A real demo “New doctor” submission was attempted from the installed production app. Required fields were filled, but submit returned the user to Login with “Доступ отозван”; no successful delivery is claimed. Code inspection confirms that a successful request has status SUBMITTED and appears in web `/mtm/contacts` under “Заявки на новых врачей”; approval creates the doctor, clinic and requesting-agent assignment.
- Server web recovery work continues on `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-field-ux-recovery`, branch `codex/field-ux-recovery`, based on `active-github/main` commit `921aa9d34`.
- The product-catalog form no longer silently disables creation with no explanation. Group and product actions remain pressable, show specific missing-field guidance, and surface the API error instead of replacing every failure with a generic message.
- Verification so far: mobile `npx tsc --noEmit` passed; 18 targeted mobile tests passed before the message screen addition; server translation parity passed. Server targeted ESLint is currently NOT RUN because this clean worktree has no installed ESLint dependency; no dependency install or full build was run on Contabo.
- Current continuation point: finish targeted mobile tests and the automated UI audit, checkpoint both branches, push/open CI, fix any CI findings, merge/release/deploy, install the new APK, log the agent back in, and repeat the route/message/doctor-request flows on the real phone before tablet acceptance.

## 2026-09-20 — simplified visit steps and retired prototype actions

- The user clarified that the visit must not show a second standalone “Обязательные действия” form and that prototype “Чек-лист” and “Следующее действие” rows are not part of the desired agent flow. Completion should instead be visible as checks on the real visit steps.
- Mobile now presents the active visit as one checklist: Presentation, Visit tasks when assigned, required photo/signature when configured, then Finish visit. Presentation and task workspaces are separate; only task-like policy requirements can appear in the task workspace.
- The server now treats legacy CHECKLIST and NEXT_ACTION policy actions as retired: new requirement snapshots resolve them as HIDDEN, the policy editor no longer offers them, demo seeds no longer require them, and historical REQUIRED snapshots cannot trap an already-started visit at checkout.
- Mobile verification passed: `npx tsc --noEmit`, `git diff --check`, and 21 targeted Jest tests across route simplification, Today route clients, route state, and visit-workspace mapping.
- Server verification passed: translation parity, targeted ESLint, `git diff --check`, and 23 targeted Vitest tests for visit-policy resolution and checkout readiness. Full server TypeScript/build remains for CI under the Contabo workload rules.
- Current continuation point: checkpoint the mobile, server, and journal changes; push both feature branches; open and observe CI; merge/release/deploy only after green gates; install the resulting APK and repeat the route, team-message, and doctor-request scenarios after the demo agent logs in again.

## 2026-09-20 — new-doctor request ingress and clinic visibility recovery

- The previous assumption that the mobile new-doctor request reached its handler was disproved. The exact v2 mobile path allowlist omitted `POST /api/v2/mtm/mobile/route-field/contact-create-requests`, so the edge proxy rejected a valid mobile bearer before the existing handler could create the `SUBMITTED` request.
- Added only that exact endpoint (including normalized trailing-slash handling); arbitrary request-detail descendants remain outside the mobile allowlist.
- Approval now assigns the approved doctor's clinic to the requesting agent in the same transaction as clinic/workplace/contact creation. A newly created clinic receives a `PRIMARY` assignment. An existing clinic receives a `SECONDARY` visibility assignment so approval cannot silently steal another agent's primary ownership. An already-active assignment is reused rather than duplicated.
- This clinic assignment is required because the mobile contact projection independently applies organization scope to workplaces; the prior contact-only assignment made the doctor visible while suppressing the clinic/workplace details.
- Server checkpoint: `83d58d8fb` (`fix(mtm): recover doctor request approval flow`). No push, merge, or deployment was performed in this parallel recovery step.
- Verification passed: 6 targeted Vitest tests across mobile path admission, mobile submission, and approval; targeted ESLint; `git diff --check`. Full `npx tsc --noEmit` is `NOT RUN (OOM)`: it reached the Node heap limit first at 2 GiB and again at 6 GiB without emitting a TypeScript diagnostic, so no further memory-heavy retry was made on Contabo.
- Current continuation point: parent task should integrate the checkpoint, run the full TypeScript/CI gate remotely, deploy only through the reviewed `main` workflow, then submit one uniquely named demo doctor from the physical app and verify `SUBMITTED` in `/mtm/contacts`; after approval, verify both the doctor and clinic appear for the requesting agent.

## 2026-09-20 (вечер) — приёмка сборок 273/275 и четыре найденных дефекта

Сессия на Contabo, телефон Galaxy S23 Ultra через проброшенный adb
(`ssh -N -R 35037:127.0.0.1:5037`). Порт 5037 на боксе занят чужим adb-сервером
(пользователь `codex-alt`), поэтому туннель поднимается только на 35037.

### Что принято на устройстве

- Сборка **273**: `versionCode=1273`, сессия демо-агента сохранена, ложного
  «Доступ отозван» нет, приостановленный рабочий день восстановлен. Карточка
  «Маршрут на сегодня» без дублей: один `ADV-DEMO Store 3` с меткой «Следующая»,
  один `ADV-Store 1`, один счётчик «Осталось точек: 2».
- **Нативный просмотр PDF** работает в обеих ориентациях: страницы
  рендерятся, счётчик `Страница N / 4`, переходы вперёд/назад, пустого WebView нет.
  Показ фиксируется в журнале визита (`Открыто: N`).
- **Сообщения команды**: объявление отправлено из веба в 17:13, на телефоне
  появилось через **8 секунд** (опрос раз в 30 с при открытом экране), прочитано и
  подтверждено. В вебе — «Получателей: 1 · Подтвердили 1 из 1 · Прочитали 1 из 1».
- **Сборка 275** (зум презентации) установлена поверх без очистки данных,
  `versionCode=1275`, сессия сохранена, зум подтверждён визуально.

### Дефекты, найденные приёмкой, и что с ними сделано

1. **Заявка на нового врача падала с `JSON Parse error: Unexpected end of input`.**
   Причина на сервере: миграция `20260919170000_mtm_contact_create_requests`
   создала политику RLS по `current_setting('app.current_organization_id')`.
   Эту настройку не выставляет ни один путь в коде — тенантный контекст ставит
   `app.org_id`. Замер на проде: `uses_current_org=1, uses_org_id=555, total=600`.
   RLS fail-closed, поэтому INSERT агента отклонялся (`42501`), а очередь
   менеджера читала ноль строк. Next отвечал 500 с пустым телом, мобильный клиент
   отдавал это в `JSON.parse`. Исправлено: `rashadoni/leaddrive-v2#259`
   (новая миграция пересоздаёт политику на `app.org_id` + сторож по всем
   миграциям), задеплоено, политика на проде проверена. Клиентская половина —
   `rashadoni/leaddrive-mtm#75`: не-JSON ответ становится ошибкой
   `SERVER_INVALID_RESPONSE`, экран печатает человеческий текст.
2. **Презентация открывалась маленькой и не увеличивалась** (жалоба владельца).
   `rashadoni/leaddrive-mtm#74`: щипок, двойное касание, панорамирование,
   чип «Увеличить»; нативный рендер поднят с 1600×2400 до 2600×3600, чтобы зум не
   мылился. Вышло сборкой 275, принято на телефоне.
3. **В ландшафте страница уходила за рамку карточки и под навигационную панель.**
   `rashadoni/leaddrive-mtm#76`: одно касание убирает панели и системные бары
   (`WindowInsetsControllerCompat`), двойное остаётся зумом, сцена тёмная, белый
   лист ровно по размеру страницы, всё разведено по safe-area.
4. **Карточку организации нельзя было сохранить**, если адрес/телефон/контактное
   лицо пустые: форма шлёт `""`, а `optionalString` требовал ≥1 символ. Поймано
   при простановке координат `ADV-DEMO Store 3` (разрешение владельца).
   `rashadoni/leaddrive-v2#262`: `""` снова значит «неизвестно», диалог называет
   поля вместо английского «Validation failed».

### Аудит карточки визита и что изменено

Владелец: «детали визита слишком растянутые… сделай аудит». Найдено: девять
блоков в одну колонку (~4 экрана), дублирование фактов (фото и заметка по два
раза), «Шаги визита» показывали пять строк «Не сделано» по необязательным шагам,
которых приложение агенту не предлагает (`RouteScreen` выводит только `REQUIRED`
и выбрасывает `NEXT_ACTION`/`CHECKLIST`), «Открытые задачи: 10» — это задачи
клиента, проверка места без ссылок на карту, пустые блоки занимали место,
`787 мин` печаталось нейтральным числом. Исправление —
`rashadoni/leaddrive-v2#267`: полоса фактов, две колонки, пустые блоки не
рисуются (одна строка «Не записано: …»), `13 ч 7 мин`, ссылки на карту, шаги
только обязательные либо с записанным результатом.

### Уведомления

Владелец: уведомлений нет вовсе (сообщения, превышение времени на точке,
напоминания о задачах). Разделено на два слоя. Локальный слой не требует ни
Firebase, ни отдельного сервера — `rashadoni/leaddrive-mtm#77`: нативный модуль
`FieldNotifications` (канал, показ, отмена, `AlarmManager.setWindow`), два
напоминания на визит (30 минут и 2 часа), планирование привязано к визиту,
отмена при закрытии, без имени клиента в тексте. Push от сервера требует проекта
Firebase (`google-services.json` + сервисный ключ) — это единственное, что ждёт
владельца; отправка при этом живёт в CRM, отдельный хост не нужен.

### Админка

Создание группы продуктов и презентации проверено в браузере по-настоящему:
создана группа «Тест 273 — группа», загружен PDF, получено «Продукт и
презентация созданы», агент назначен на группу («1 агент · 1 продукт»).

### Точка продолжения

- Туннель adb упал в 15:48; телефон недоступен. Что осталось на устройстве:
  повторить заявку на врача (сервер уже исправлен и задеплоен) до `SUBMITTED`
  в `/mtm/contacts`, одобрить и проверить синхронизацию врача и клиники агенту;
  довести визит на `ADV-DEMO Store 3` до конца; проверить агента на живой карте
  при активном GPS; проверить отвязку клиента от агента; принять полноэкранный
  просмотр презентации (PR #76) и напоминания (PR #77) после релиза.
- Физический Wi-Fi планшет снят с плана: владелец сообщил, что планшет
  недоступен.
- Автоповорот на телефоне остался зафиксированным в ландшафте
  (`accelerometer_rotation=0`, `user_rotation=1`) — вернуть при следующем сеансе.

## 2026-09-20 (ночь) — заявки, дорожная карта, уведомления и push

Продолжение предыдущей записи: туннель adb был восстановлен владельцем, приёмка
на телефоне доведена до конца, после чего работа ушла в три заказанные владельцем
темы — **статусы заявок → экран уведомлений → Firebase** (порядок задал владелец).

### Что принято на устройстве

- Заявка на нового врача повторена после деплоя исправления RLS: ушла со статусом
  `SUBMITTED`, появилась в `/mtm/contacts`, одобрена в админке, врач **и его
  клиника** приехали агенту следующей синхронизацией.
  Чтобы одобрение прошло, пришлось включить организации LeadDrive Inc. модуль
  «Полевые контакты»: он был выключен с 15 сентября **точечной строкой только для
  этого тенанта**. У Zeytun Pharma и остальных строки нет вовсе, а отсутствие
  строки означает «включено», — проверено, трогать не потребовалось.
- Отвязка клиента от агента проверена целиком: назначение → клиент появился в
  «Местах» → отвязка → после полной синхронизации исчез. По дороге нашлось, что
  экраны не перезапрашивали данные при возврате фокуса, отсюда
  `rashadoni/leaddrive-mtm#79`.
- Ограничение визита 30 минут: напоминание из `#77` планируется на визит и
  снимается при закрытии; в тексте нет имени клиента (push и локальное
  уведомление могут появиться на заблокированном экране перед врачом).

### Итог визита как дорожная карта

Владелец: «чтоб понять что он сделал ли всё надо читать как чек-поинты, сделай
как дорожную карту — шаг сделан зелёной иконкой, а что нет красной, также надо в
админке облегчить этот момент».

- Приложение — `rashadoni/leaddrive-mtm#81`: `src/services/visit-roadmap.ts`
  строит семь шагов (приход, презентация, фото, подпись, задачи, итог, уход) в
  трёх состояниях `done | missing | skipped`.
- Админка — `rashadoni/leaddrive-v2#275`: `src/lib/mtm/visit-roadmap.ts`, тот же
  набор правил, и `RoadmapTrack` в карточке визита.
- Третье состояние — главное в этой паре. Шаг, который этот визит не требовал,
  бледный, а не красный: красным он обвинял бы агента в пропуске того, чего ему
  никто не предлагал. Ровно этим и был плох старый список «Шаги визита», где
  пять необязательных строк печатались как «Не сделано».
- `WAIVED` считается выполненным: подпись снял руководитель, и это его решение,
  а не провал агента.
- Две реализации обязаны совпадать — агент и его руководитель, глядя на один
  визит, должны видеть один ответ. В обоих файлах стоит ссылка на второй.

### Дорога на маршруте

Владелец: «когда строится маршрут и выполняются шаги — линию дорожную вертикально
чтоб выполняя дорога заполнялась от шага к шагу». `rashadoni/leaddrive-mtm#82`:
вертикальная рельса слева от точек, сегмент до пройденной точки залит, дальше —
бледный. Сделано и в телефонном списке, и в планшетной сетке.

### Статусы заявок

`rashadoni/leaddrive-mtm#80` + `rashadoni/leaddrive-v2#272`. Агент видит судьбу
своей заявки: открытые — всегда, решения — семь дней, потом уходят. Решение без
даты не показывается вовсе: «одобрено неизвестно когда» — это не информация.
Тест поймал настоящий дефект в серверной половине: `Number(null) === 0`, и запрос
без `limit` просил одну строку вместо страницы.

### Уведомления: два слоя

Владелец: «уведомления не приходят… связь с агентами, время которое он там провёл
больше, напоминания о задачи… управление уведомлениями как полноценное
приложение».

1. **Локальный слой** (`#77`, `#83`) — не требует ни Firebase, ни отдельного
   хоста. Нативный модуль `FieldNotifications`, напоминания о превышении времени
   на точке (30 минут и 2 часа), экран «Уведомления» с переключателями по видам
   и отметкой прочитанного.
2. **Push от сервера** — `rashadoni/leaddrive-mtm#84` (Firebase в приложении) и
   `rashadoni/leaddrive-v2#278` (реестр адресов и отправка).

### Push: как это устроено и где граница доверия

- Firebase — служба доставки, а не место, где живут наши данные. В payload едут
  заголовок, одна строка и пара подсказок для навигации; всё, что агент потом
  читает, приходит с нашего сервера под его собственной сессией.
- Токен устройства — адрес, а не ключ. Строка в `MtmDeviceToken` под FORCE RLS по
  `organizationId`; выход из аккаунта строку удаляет, потому что следующий агент
  на этом телефоне не должен получать чужие уведомления.
- `UNREGISTERED` / `INVALID_ARGUMENT` / `SENDER_ID_MISMATCH` / 404 гасят адрес;
  5xx и сеть — нет: это проблема минуты, а не токена.
- Отправка везде fire-and-forget: не доставленный push не имеет права уронить
  действие, которое его вызвало. Сообщение руководителя отправлено тогда, когда
  записано в базу, а не когда его подтвердил Google.
- **Один проект Firebase на приложение, а не на тенанта** (вопрос владельца).
  Проект привязан к имени пакета `com.mtmobileapp`; тенанты разделяются нашей
  таблицей адресов, а не отдельными проектами Google.

### Ключ FCM

Сервисный ключ проекта `leaddrive-mtm` владелец поставил на прод сам, одной
строкой `MTM_PUSH_SERVICE_ACCOUNT` в `/etc/leaddrive/app.env`, и перезапустил PM2
с `--update-env`. В репозитории и в GitHub Secrets ключа нет.

**Этот ключ засвечен в переписке и подлежит замене.** Владелец решил заменить его
позже и сказал, что скажет сам, когда менять. Замена — одна кнопка в консоли
Firebase (новый ключ) плюс та же строка в `app.env`; код читать ничего нового не
будет.

### Точка продолжения

- Сборка `v3.3.0` (`versionCode=1302`, коммит `a49e3e3`) скачана, контрольная
  сумма сошлась, Firebase внутри проверен (`FieldPushService`, app id
  `1:887681841081`). **На телефон не поставлена: туннель adb снова упал.**
- Осталось на устройстве: поставить 1302, убедиться, что адрес устройства
  зарегистрировался (строка в `MtmDeviceToken`), отправить из админки объявление
  и увидеть его на заблокированном экране. Если не придёт — разбирать по логам
  прода и по телефону.
- Автоповорот на телефоне возвращён в нормальное состояние
  (`accelerometer_rotation=1`, `user_rotation=0`).
- Физический Wi-Fi планшет снят с плана владельцем.
