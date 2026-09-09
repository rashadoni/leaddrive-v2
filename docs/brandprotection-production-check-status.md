# Brand Protection Social Monitoring — production-check status (handoff)

> Живой статус production-проверки модуля соц-мониторинга тенанта
> `brandprotection` (slug `brandprotection`, shared-инстанс LeadDrive,
> `https://brandprotection.leaddrivecrm.org`). Обновляется по ходу проверки,
> чтобы любая новая сессия могла продолжить с контекстом, не переспрашивая.
> Дата последнего обновления: 2026-07-20, сессия №5 (ветка
> `claude/brandprotection-prod-checks-x9pggk`) — **марафон фиксов сбора
> IG/FB: маршруты, бюджеты, reservation-burn, parent-matching комментов —
> конвейер FB-комментов заработал end-to-end (см. секцию сессии №5).**

## Цель

Автономная production-проверка Brand Protection Social Monitoring: OAuth
YouTube, реальный YouTube E2E (search видео → комментарии → mentions +
evidence), scheduler/cron, устойчивость очереди, readiness-задачи и финальная
оценка (без заявления «100% готово», пока soak и owner/time-зависимые проверки
не закрыты).

## Сделано и подтверждено (не повторять)

- **Deploy зелёный**, ping 200 `{"ok":true,"db":"ok","orgCount":6}`. Сессия №3
  шла на прод-коммитах `c54178f`→`475dfb9` (в течение дня мержились #440–#446).
- **PR #429** reconnect UI + OAuth владельца — код-верифицирован ранее; live:
  ровно один YouTube-аккаунт, `isActive=true`, `connected=true`, без дубля.
- **PR #424 / #425 / #434** — на main и **подтверждены live** (см. сессию №3).
- **Cron/scheduler активен**: `*/5` collector + `2,17,32,47` poll-all — живьём
  видно по `lastPolledAt`/`lastCheckedAt` и суточному леджеру provider-runs.

## Сессия 2026-07-19 №3 — результаты живых проверок

Скриншоты ключевых шагов сняты через Chromium/Playwright. Примечание для
следующих сессий: через agent-proxy Chromium работает только с
`proxy.server=$HTTPS_PROXY` **и** `--ssl-version-max=tls1.2` (egress-шлюз
сбрасывает TLS 1.3 ClientHello браузера; curl/node работают без этого).

### Тест-логин

Владелец забыл пароль → создан операторский workflow
**`.github/workflows/set-tenant-user-password.yml`** + reset-only скрипт
`scripts/set-user-password.mjs` (PR #442, в main). Вход — **bcrypt-хеш**
(плейнтекст не попадает в CI-inputs/логи), inputs shape-валидируются до
попадания в shell. Пароль `admin@brandprotection.leaddrivecrm.org` сброшен
(run 29686935244, rows: 1), логин проверен в браузере. Сам пароль — у
владельца, в доки/репо не пишется.

### Подтверждено живьём

1. **Аккаунты** (`GET /api/v1/social/accounts`): один YouTube-аккаунт,
   активен/подключён/без дубля, токен скрыт `"***"`; `lastPolledAt` бьётся с
   кроном `2,17,32,47`; `tokenExpiresAt` сдвигается при опросе (OAuth-refresh
   работает); ручной `POST /accounts/{id}/poll` → 200, `lastPolledAt`
   сдвинулся; неактивный twitter опросу остальных не мешает.
2. **YouTube E2E (PR #424)**: ручной запуск обоих youtube-источников
   zeytunpharmaceuticals — через UI-кнопку «Запустить» и через API. Оба
   `status=success`, adapter `YOUTUBE_DATA_API`, capability
   `READ_EXTERNAL_COMMENTS`, канал `UCB7qvQMKFgMgwVp9_rff3FQ`,
   **`coverageClass=COMPLETE_FOR_INPUT`**, found=3 / ignored=3 / new=0
   (runId `cmrrs0xrq004g50bcrskjxbn9`, `cmrrs2rot004u50bcx3an5a8h`).
3. **Фикс #434 live**: свежих (пост-деплойных) comment-строк с ложным
   `subject_alias_match` — **ноль**. Негативный кейс: 3+3 коммента без
   ключевого слова в теле при YouTube-ранах не размечены и не созданы
   (ignored). Позитивный контроль: свежие tiktok VIDEO (bright-data) и
   facebook POST с `#Arazsupermarket` в теле матчатся корректно, UI показывает
   «Почему релевантно: совпал алиас бренда». Старые false-positive 15.07
   остаются как «до» (не пересчитываются). Регрешн-тесты 22/22 (прошлая
   сессия, тот же код).
4. **«Запустить все»** (после #443 — полный скан): 52 источника
   последовательно, 20 выполнено / 22 пропущено / 16 ошибок, «Найдено 6,
   новых 0» — **очередь не падает**; malformed/blocked источники дают
   структурные ошибки (`source_route_plan_blocked` fail-closed,
   `official_fetch_failed` на owned fb/ig с мёртвыми токенами,
   `youtube_video_channel_or_query_required`). Платный araz-источник в этот
   run-all view не входит — расход до/после идентичен.
5. **TikTok / Bright-Data-only (PR #425) live** — только read-only шаги
   `audit`+`evidence` canary-workflow #437, **расход сессии $0**:
   - Apify-остатков **0 активных** (все `APIFY_ASYNC` → INVALIDATED);
     активные tiktok-маршруты — по 1 `BRIGHT_DATA_SNAPSHOT` на capability
     (только araz-источник), остальные `MANUAL_TASK BLOCKED`.
   - 15 capability proofs VERIFIED (bright-data, read=y/export=y/**reply=n**);
     tiktok comments proof до 2026-10-19.
   - Суточный леджер (11 ранов): до деплоя #425 (~09:30Z) — легаси-Apify
     2×FAILED `apify_start_400` + 1 ночной импорт **$0.041 (весь фактический
     расход дня)**; после — только bright-data: DISCOVER 10/10 → ENRICH 9/8 →
     комментарии `PAID_ROUTE_COLLECTION SUCCEEDED` (recv=0). При выключенном
     routing — чистый fail-closed `bright_data_live_routing_disabled`.
   - Blast radius: платная политика включена только у brandprotection (1/6).
6. **Authenticated browser smoke** — пройден:
   `scripts/social-monitoring-browser-smoke.mjs` (ассерты 1:1; раннер
   адаптирован под прокси сессии: playwright-core + tls1.2) →
   «Authenticated Social Monitoring smoke passed: dashboard + tenant API».
7. **Alert SLO live в UI**: «instagram/web source has no successful collector
   run in the last 24 hours» видны в разделе покрытия.

### Параллельные изменения владельца (зафиксировано, сессией не производилось)

- Тестовые субъекты «Bəhruz Şiraliyev» и «Brend qorunması» удалены (status
  `deleted`, 11:38 UTC) — **по решению владельца** (запрет снят, см. guardrails;
  механика — #440 direct-delete). PharmOnline → paused. В тенанте остаются 4
  активных субъекта: Araz Supermarket, Bravo Supermarket, PharmaStore, Zeytun
  Pharmaceuticals — условие «хотя бы один живой субъект для E2E» выполнено.
- Paid-run policy v8 авторизована владельцем 12:23 UTC: `manualRunsEnabled=true`,
  `emergencyStopped=false`, капы $10/run / $100/день / $1000/мес,
  `dailyRunQuota=0` → тенант в **USD-режиме** (run-count-квота #432/#435
  доступна, но не включена). Bright Data live routing включён (canary-шаги
  enable/routing-on, 12:21–12:40). Owner вручную запускал araz-источник 07:41
  (кап $0.50, success). Teardown canary-runbook сознательно не выполнялся —
  это уже боевой режим, не канарейка.

## Сессия 2026-07-19 №4 (вечер) — повторный live-прогон после #445/#450/#452

Прод на коммитах ≥ `5cfcff8` (#453); в течение вечера мержились #445–#453,
из значимых для модуля: **#445** (keyword+engagement comment relevance),
**#450** (TikTok publication gate — comment-фаза раньше вообще не запускалась;
плюс перебалансировка платных капов perRun $10→$1), **#452** (разморозка
blocked route plans + фикс YouTube empty-result circuit poisoning).
Ping 200 `{"ok":true,"db":"ok","orgCount":6}`. Скриншоты ключевых шагов сняты
(Chromium/Playwright, рецепт прокси из сессии №3 работает без изменений).

### Подтверждено живьём (сессия №4)

1. **Аккаунты**: ровно один YouTube-аккаунт, `isActive=true`, `connected=true`,
   токен `"***"`; `lastPolledAt=18:32:35Z` = крон-минута 32; `tokenExpiresAt`
   в будущем (OAuth-refresh жив). **Новое:** TikTok-аккаунт теперь тоже
   активен/подключён (владелец подключил днём); twitter по-прежнему неактивен
   и не мешает.
2. **Scheduler live**: коллектор `*/5` — youtube-источники zeytun
   `lastCheckedAt=18:40:03Z`; poll-all `2,17,32,47` — по `lastPolledAt` всех
   активных аккаунтов.
3. **YouTube E2E повторно**: оба youtube-источника zeytunpharmaceuticals —
   `status=success`, adapter `YOUTUBE_DATA_API`, capability
   `READ_EXTERNAL_COMMENTS`, канал `UCB7qvQMKFgMgwVp9_rff3FQ`,
   `coverageClass=COMPLETE_FOR_INPUT`, found=3/ignored=3/new=0 (runIds
   `cmrs58qnz00df50p9t7fs7yos`, `cmrs58ray00dt50p9a2z8ltw7`).
4. **#434 держится после новых деплоев**: аудит всех comment-mentions за 30д —
   последняя ложная пачка `subject_alias_match` датирована 15.07 14:40Z
   (пре-фиксовый бэклог, по дизайну не пересчитывается); **после неё — ноль**
   новых ложных comment-строк. Позитивный контроль: 75+ строк
   `subject_alias_match` (fb/ig/tiktok POST/VIDEO) содержат алиас в теле;
   «Pharma Store» матчится с «PharmaStore» через нормализацию (пробелы
   схлопываются) — корректно, не false positive.
5. **«Запустить все»**: UI-клик прошёл (всё было недавно проверено кроном →
   моментальные skip); контрольный полный API-прогон всех 58 внешних
   direct-источников последовательно: 2 success / 52 partial / 3 skipped /
   1×409 (лизинг) / **0 жёстких падений**; «Найдено 6, новых 0». Ошибки только
   структурные fail-closed: `manual_collection_required`×22,
   `paid_route_budget_unconfigured`×24, `official_fetch_failed`×6 (те же
   мёртвые owned fb/ig токены), `source_route_plan_blocked`×3 (после #452
   заметно меньше блокировок, чем в сессии №3).
6. **TikTok / Bright-Data, расход сессии $0**: ручной ран araz-keyword
   источника с явным капом `maxTotalChargeUsd=2` (< лимита $4) → чистый
   fail-closed `paid_route_daily_budget_exhausted` (budget-guard live);
   в леджере авторизаций корректная запись: cap $2, policyVersion 10,
   status RELEASED, outcome partial, расход $0. Никакого Apify; маршрут
   `READ_EXTERNAL_COMMENTS` в route-плане присутствует (skipped:
   `route_dependency_pending`).

### Контекст/находки сессии №4 (важно для следующих сессий)

- **Paid-run policy v10** (владелец, 17:18:31Z): maxPerRunUsd=$100,
  daily=$10 000, monthly=$100 000, quota=0 (в v8 было $10/$100/$1000).
  Из-за этого ручной ран без явного капа теперь может резервировать до $100 —
  **всегда передавать `maxTotalChargeUsd` в тестовых ранах**.
- **Причина паузы bright-data-ранов после 16:57Z** (и блока моего рана):
  до фикса #450 авто-раны резервировали по $10/цикл и к 16:55Z сожгли
  route-уровневый дневной бюджет $100 **резервациями** при факт-расходе дня
  ~$0.04 (`paid_route_daily_budget_exhausted`, окно = UTC-день). Фикс #450
  (perRun $1) реально заработает после ресета в 00:00Z.
- **#450 comment-фаза не проверяема сегодня**: фид фазы — revisit-очередь
  (`tikTokPublicationRevisit`), которая наполняется только с этого деплоя, и
  `nextDueAt` = cadenceDays≥1; плюс дневной бюджет сожжён. Проверять с
  20.07: свежие provider-runs фаз DISCOVER→ENRICH→PAID_ROUTE_COLLECTION и
  затем `EXTRACT_COMMENTS_FROM_CANDIDATES`, органический нейтральный коммент.
- UI-нюанс: `?tab=`-параметр вкладку не переключает — в Playwright надо
  кликать таб («Источники» → суб-таб «Мониторинг» = внешний watchlist с
  «Запустить все»; дефолтный суб-таб уже «Мониторинг»).
- Неавторизованный запрос к `/api/v1/*` возвращает **HTML логина с HTTP 200**
  (redirect middleware) — в скриптах проверять `content-type: application/json`,
  а не только `res.ok()`.
- Осиротевшие web-источники удалённого субъекта «Bəhruz Şiraliyev» (16 шт.,
  `lastCheckedAt=null`) всё ещё в списке источников — кандидаты на чистку,
  сессией №4 не трогались (мутация вне явного разрешения).

## Сессия 2026-07-20 №5 — марафон «почему IG/FB пустые» → сбор заработал

Владелец показал: Araz YouTube/IG «от других» = 0, «опять не починил но соврал
что починил». Честная диагностика показала слоёную причину — **не релевантность,
а сбор**. Слои снимались по одному, каждый фикс — отдельный PR:

| # | Слой / причина | Фикс | PR |
|---|---|---|---|
| 1 | Релевантность комментов (ключ ИЛИ негатив в брендовом контексте) + глубина ручного запуска + live-прогресс «Запустить все» | `subject_relevance_v8`, deepSearch, прогресс-бар | #456 |
| 2 | FB OAuth reconnect падал `missing_code` (DM-scopes у monitoring-only тенанта) | DM-scopes только для inbox-тенантов + проброс реальной ошибки FB | #463 |
| 3 | Route-планы IG/FB устарели: verified bright-data proofs не вписаны (`proofId:null`, мёртвый META_GRAPH primary) | self-heal в `runSafeCollector`: routing включён + proof есть + BD в плане нет → recompile once | #468 |
| 4 | **Reservation-burn**: завершённые BD-раны держали полный кап-резерв (актуалы приходят вебхуком асинхронно; reconcile-крон покрывал только Apify) → $25 резервов при $0 факта выжигали дневной бюджет | релиз резерва до record-estimate при завершении (только вниз) | #473 |
| 5 | Комменты: `PARTIAL recv=16..18, acc=0` — **все строки** отвергал нормализатор | сначала post_id-фолбэк (#475, не хватило), затем persisted drift-warnings (#479) доказали `parent identity mapping is required` → **path-token матчинг родителя** + доверие resolved-идентичности в FB-нормализаторе | #475, #479, #482 |
| 6 | «Настраивать бюджет per-source нельзя» (bulk-мутации гейтятся; владелец просил механизм «ищи везде по всем ключам») | **тенант-дефолт route-бюджета** `routeDefaults` в paid-политике + фолбэк в компиляции + policy-version bump v4 (все планы пересобрались сами) | #477 |

**Включено на проде:** policy **v11** — `routeDefaults {maxTotalChargeUsd:0.5,
dailyBudgetUsd:10, monthlyBudgetUsd:100}` (авторизация владельца «настрой сам
10$»). Все активные источники BD-платформ бюджетированы автоматически.

**Финальная живая проверка (после деплоя #482):** ручной ран araz FB —
DISCOVER 33 → ENRICH → **EXTRACT recv=18, acc=1** — впервые FB-коммент прошёл
нормализацию end-to-end. Остальные 17 строк — `provider_error:dead_page`
(датасет так отвечает на посты без комментов / reels — ожидаемая частичность).
Принятый коммент нейтральный → фильтр релевантности корректно НЕ поднял его в
«Упоминания» (по правилу владельца показывается только ключ/негатив).

### Честный статус по платформам (Araz)

- **Facebook**: сбор работает полностью (33 поста, 10 «от других», комменты
  нормализуются). Упоминания-«комменты от других» появятся при реальном
  негативе/ключе в комментах.
- **TikTok**: работает (57 «от других» за 90д), revisit-очередь наполняется.
- **Instagram**: маршрут/бюджет исправны, но (а) BD IG-скан по профилю araz
  отдаёт мало (1 пост), (б) **у Araz нет IG keyword/hashtag-источников** —
  только своя страница; keyword-источники других субъектов в основном
  `disabled`. Включение — продуктовое решение владельца.
- **YouTube**: у Araz **нет YouTube-источников вообще** (у Zeytun/Bravo — есть
  и работают; Bravo душит `youtube_rate_limited` — квота API).

### Диагностическая инфраструктура (осталась в проде)

- Persisted **drift-warnings** на BD-провайдер-ранах (`inputSnapshot.driftWarnings`).
- Canary `evidence` печатает: warnings, полные routeResults, формы parent id/url,
  EXTRACT-снапшоты. Диспатч с любой ветки, read-only.
- Уроки: сквош-мерж уносит ВСЕ коммиты ветки (не дублировать в следующем PR);
  раннеры GitHub в этот день преемптились (#476 чинил это отключением
  webpackMemoryOptimizations); Actions временами не триггерился на пуш — лечится
  пустым коммитом.

## Сессия 2026-07-20 №6 — аудит «скрейп реально прошёл по ВСЕМ источникам?»

Запрос владельца: гарантировать, что добавленные им внешние страницы реально
собираются (чтобы новость о бренде на этих страницах не прошла мимо).

- Новый canary-шаг **`source-coverage-audit`** (read-only): per-source вердикт
  OK/STALE/FAILING/NO_PATH/INACTIVE, прогоны 48ч, планы, ingest, watchdog.
  Прогон 16:13Z: **193 источника: OK=19, FAILING=24, NO_PATH=38, INACTIVE=112**.
- **Root cause №7 (главный)**: экспоненциальный backoff планировщика
  (`2^fails`, кап ×8) считает конфиг-ошибки (`paid_route_budget_unconfigured`,
  нет route-планов) провайдер-ошибками → ~30 FB/IG страниц СМИ владельца
  (baku.ws, qafqazinfo, apa.az, milli.az, lent.az, publika.az, axar.az, СМИ-TV
  и т.д.) спали 21ч+ и спали бы ещё 1–2 суток; self-heal #468 и routeDefaults
  #477 применяются ВНУТРИ прогона, который backoff не даёт запустить.
  **Фикс #487**: конфиг-хвосты капятся на ×2; handle-only FB/IG источники
  (`zeytunpharmaceuticals`, `pharmastore.az`) выводят URL страницы вместо
  `bright_data_discovery_input_missing`; write-шаг **`wake-stale-sources`**
  (confirm-gated) возвращает уснувшие источники в очередь (lastCheckedAt −30д).
- Хронология бюджета за 20.07: daily-агрегат был исчерпан резервами уже с
  02:55Z (холды до деплоя #473); repair 14:45Z освободил $26.75→$1.10; после
  этого FB araz DISCOVER 15:18Z успешно ушёл в BD (33 поста, HEALTHY).
  TikTok-источники (bravo/araz) из-за той же экономики ушли в backoff — их
  будит wake-шаг; полноценный чистый цикл — после 00:00Z ресета.
- FB EXTRACT комментов: 15:23Z recv=18 acc=1 (пайплайн жив после #482), но
  большинство строк по-прежнему `missing_required_field`/`dead_page` —
  наблюдать; возможно, это комменты нетрекаемых постов из батча.
- **Уведомления (проверено по коду)**: per-mention пушей НЕТ. Упоминания — во
  вкладке «Упоминания»; in-app колокольчик — только спайк негатива
  (`spike-alerts.ts`, без browser-push) и эскалации inbox; coverage-алерты
  (stale/consecutive-failures) пишутся в `aiAlert` (панель AI-алертов),
  срабатывали корректно (30 алертов за 24ч — они и указали на проблему).
  Если владельцу нужен пуш/дайджест о новых упоминаниях — отдельная фича.
- LinkedIn: 3 источника needs_setup, путь только MANUAL_TASK — честно «не
  собирается автоматически».

## Осталось (owner/time-зависимое) — НЕ заявлять «100% готово»

1. **Multilingual gold set** — ⛔ BLOCKED на размеченные данные владельца
   (`src/lib/social/relevance-gold-seed.ts` — только синтетический seed).
2. **48–72h soak** — время-зависимо; крон и платные раны идут, soak-метрики
   можно собирать с 19.07 (`evidence`-шаг canary-workflow — готовый суточный
   срез).
3. **Органический кейс «нейтральный коммент под брендовым видео» на TikTok** —
   ждёт новых реальных комментов; негативный кейс пока закрыт YouTube-ранами +
   тестами.
4. **Мёртвые токены owned fb/ig-страниц** (`official_fetch_failed`) —
   владельцу переподключить, если owned-сбор нужен.
5. **Live-прогон TikTok comment-фазы (#450)** — с 20.07 (00:00Z бюджет-ресет):
   убедиться, что авто-цикл DISCOVER→ENRICH→PAID_ROUTE_COLLECTION возобновился с $1-капами,
   появились revisit-регистрации, а через cadenceDays — provider-runs
   `EXTRACT_COMMENTS_FROM_CANDIDATES` и реальные tiktok-комменты (закроет и п.3).

## Ограничения / guardrails

- Субъекты «Bəhruz Şiraliyev» и «Brend qorunması» — тестовые, владелец разрешил
  их удаление (2026-07-19); удалены. Для E2E достаточно оставшихся живых
  субъектов; лучше вести реальный бренд/персону.
- Google-пароль/OAuth-токены **не запрашивать и не выводить**; тест-credentials
  не логировать и не коммитить (сброс — только через workflow с bcrypt-хешем).
- TikTok со стороны проверяющих сессий — по-прежнему без самостоятельного
  запуска платных ранов сверх решения владельца; read-only шаги
  `audit`/`evidence` — безопасны.
- Не заявлять «100% готово», пока gold set и soak не закрыты.
- AGENTS.md/CLAUDE.md: чистый main/worktree; без `git add -A`, `reset --hard`,
  force-push (кроме already-merged истории); scoped-правки; для НОВЫХ изменений
  — свежая ветка от актуального `main`.

## Доступ / как запускать / эндпоинты

- Прод: зарегистрированный host `13.140.132.245`, `/opt/leaddrive-v2`, PM2 `leaddrive-v2`, порт 3001.
- Тенант routing — по Host (`brandprotection.leaddrivecrm.org`).
- Token-safe чтение аккаунтов: `GET /api/v1/social/accounts` (токен → `"***"`).
- Ручной запуск источника: `POST /api/v1/social/monitoring-sources/{id}/run`
  (кнопка «Запустить» в watchlist, `runSourceNow`); poll аккаунта:
  `POST /api/v1/social/accounts/{id}/poll`.
- Сброс пароля тест-логина: workflow `set-tenant-user-password.yml`
  (вход — bcrypt-хеш; плейнтекст в CI не попадает).
- Canary-операции: workflow `canary-brandprotection.yml`; `audit`/`evidence` —
  read-only, без confirm; write-шаги — только с `confirm=brandprotection`.
- Браузер: Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`;
  через agent-proxy — launch с `proxy.server=$HTTPS_PROXY` и
  `--ssl-version-max=tls1.2`.

## Readiness-оценка (2026-07-19 вечер, сессия №4)

| Пункт | Статус |
|---|---|
| Deploy + ping + feature smoke | ✅ зелёный (повторно, на #453) |
| PR #429 reconnect UI + OAuth владельца | ✅ (сессия №4: один активный YouTube + новый активный TikTok-аккаунт) |
| PR #424 search→comments E2E | ✅ live ×2 сессии (COMPLETE_FOR_INPUT, runIds в тексте) |
| PR #425 Bright-Data-only | ✅ live (без Apify; budget-guard fail-closed подтверждён вживую) |
| PR #434 comment-relevance fix | ✅ live: 0 новых ложных comment-строк после 15.07 14:40Z (30д-аудит) |
| PR #452 разморозка route plans | ✅ live: `source_route_plan_blocked` всего ×3 на 58 источников |
| PR #450 TikTok comment phase | ⏳ маршрут в плане есть; live-прогон — после бюджет-ресета 00:00Z 20.07 |
| Cron/scheduler + lastPolledAt | ✅ live ×2 сессии |
| Account tenant-state (isActive/no-dup) | ✅ live ×2 сессии |
| «Запустить все» + устойчивость очереди | ✅ live (58 источников, 0 жёстких падений, fail-closed коды) |
| Alert SLO wiring | ✅ live в UI (сессия №3) |
| Authenticated browser smoke | ✅ пройден (сессия №4: логин + дашборд + tenant API через Chromium) |
| TikTok dry-run ≤ $4 | ✅ ран с капом $2 → budget-guard fail-closed; расход сессии №4 $0 |
| Multilingual gold set | ⛔ BLOCKED на данные владельца |
| 48–72h soak | ⏳ идёт с 19.07 (крон активен) |

**Вывод: НЕ «100% готово», но все live-проверяемые пункты закрыты (двумя
независимыми сессиями за день).** Остаются gold set (owner), soak (время),
live-прогон TikTok comment-фазы после бюджет-ресета (закроет и органический
коммент-кейс) и переподключение owned fb/ig-страниц.
