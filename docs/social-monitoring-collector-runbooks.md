# Social Monitoring — collector reliability runbooks (CR-1)

Статус: операционные runbooks для платного управляемого пилота. Источник истины
коммерческой готовности — [`SOCIAL-MONITORING-CLIENT-READINESS.md`](./SOCIAL-MONITORING-CLIENT-READINESS.md).

Эти runbooks описывают, что уже встроено в код collector-а, как оператор видит
проблему и что делает. Они не заменяют dashboards/alerts из §18 архитектурного
плана — их поставка остаётся отдельной задачей (см. «Открытые пункты»).

## 0. Механизмы, на которые опираются runbooks

- **Классификация ошибок** — `src/lib/social/collector-error-classifier.ts`.
  Любая ошибка адаптера сводится к одному классу: `TRANSIENT`, `RATE_LIMIT`,
  `AUTH`, `POLICY`, `BUDGET`, `PERMANENT`, `UNKNOWN`. У класса есть `retryable`,
  `quarantine`, базовый cooldown и `operatorAction`.
- **Circuit breaker по маршруту** — `recordSourceRouteResult`
  (`src/lib/social/source-route-plan.ts`). Восстановимые классы открывают circuit
  на пороге `CIRCUIT_FAILURE_THRESHOLD` (3) с экспоненциальным backoff и
  детерминированным ±25% jitter. `AUTH`/`POLICY`/`PERMANENT` немедленно переводят
  маршрут в `BLOCKED` (fail-closed), и `getExecutableSourceRoutePlans` его больше
  не выбирает до пересборки плана.
- **Claim/lease/fencing** — `claimMonitoringSourceRun` /
  `releaseMonitoringSourceRunClaim` / `reapStaleMonitoringSourceLeases`
  (`src/lib/social/monitoring-collector.ts`).
  15-минутный lease с `runClaimToken` + `runClaimVersion`; потерявший claim worker
  не перезаписывает source-health (`collector_lease_lost`). Каждый запуск
  authenticated `social-monitoring-sources` cron сначала выполняет отдельный
  reaper: CAS снимает только точный истёкший claim и помечает соответствующий
  всё ещё `running` run как `collector_lease_expired`.
- **Коммерческий USD budget** — платный route исполняется только при
  `SOCIAL_MONITORING_ENFORCE_USD_BUDGETS=1`, owner-supplied per-run/day/month
  limits и успешной `reservePaidRouteBudget`. Bright Data дополнительно требует
  versioned price snapshot; live routing остаётся выключенным без
  `SOCIAL_BRIGHT_DATA_LIVE_ROUTING=1`. Отсутствие любого условия блокирует вызов
  fail-closed, а не включает «battle mode».
- **Coverage completeness** — адаптеры комментариев сообщают `coverageClass`
  (`COMPLETE_FOR_INPUT | PARTIAL | SAMPLED | BLOCKED`). Legacy YouTube poller
  проходит все `nextPageToken`; после первого полного обхода использует
  `lastPolledAt` watermark и двигает его только после полного успешного run.
- **YouTube hybrid discovery** — официальный адаптер принимает прямой video URL,
  channel ID/`@handle`/channel URL либо keyword/subject query. Для query он
  вызывает `search.list`, сохраняет найденные видео как posts и затем проходит
  все страницы `commentThreads` и `comments` каждого videoId. Channel watchlist
  использует `allThreadsRelatedToChannelId`; выполнение ограничивается
  техническими `maxItems`, cadence и YouTube quota, но не денежным лимитом.
- **Kill switches** — outbound остаётся закрытым (PR6): global env, tenant,
  platform, connection, subject-identity gates, все fail-closed.

Оператор видит класс последней ошибки в `SourceRoutePlan.lastFailureClass` и
готовность источника в `summarizeMonitoringReadiness` (вкладка «Источники →
Статус» + «Карта покрытия»).

## 1. Provider outage (TRANSIENT)

Симптом: `lastFailureClass=TRANSIENT`, `SourceRoutePlan.status=DEGRADED`,
`circuitOpenUntil` в будущем; провайдер/сеть недоступны.

1. Подтвердить, что это upstream (5xx/timeout), а не наш баг: посмотреть
   `routeResults[].error` последнего `CollectorRun`.
2. Ничего не делать вручную, если circuit открыт: backoff+jitter сам разведёт
   повторы. Проверить, что `circuitOpenUntil` растёт при повторных сбоях
   (экспонента до 6 часов).
3. Если outage провайдера длится дольше SLA — переключить сценарий на
   альтернативный route (owned/official) или поставить источник на паузу.
4. Пока circuit открыт, успешный fallback сохраняет `DEGRADED` и не маскирует
   здоровье primary. После TTL primary выполняет probe. Возврат в `ACTIVE`
   разрешён только после bounded overlap reconciliation: fallback-наблюдения
   должны быть уже сохранены либо совпасть с primary, без unresolved gaps и
   конфликтующих canonical identity.

Эскалация: если outage затрагивает несколько tenant — уведомить owner пилота и
зафиксировать инцидент.

## 2. Token expiry / auth failure (AUTH)

Симптом: `lastFailureClass=AUTH`, `SourceRoutePlan.status=BLOCKED`, retry-таймера
нет (маршрут выведен из ротации).

1. Найти подключение: `SocialAccount` по platform источника; проверить
   `isActive` и наличие токена.
2. Переподключить аккаунт через OAuth (`/api/v1/social/oauth/<platform>/start`)
   или обновить сервисный токен в env.
   Для YouTube reply требуется повторный consent scope `youtube.force-ssl`;
   reconnect намеренно сбрасывает connection live/capability verification до
   нового sandbox proof.
3. Пересобрать план: `compileOrganizationSourceRoutePlans(orgId)` (запускается
   при подключении аккаунта/верификации proof) — маршрут вернётся в `ACTIVE`.
4. Убедиться, что новый токен не хранится в git/логах.

Никогда не «чинить» AUTH автоматическим повтором: маршрут остаётся `BLOCKED`
намеренно, чтобы не блокировать аккаунт частыми отказами.

## 3. Rate limit / quota (RATE_LIMIT)

Симптом: `lastFailureClass=RATE_LIMIT`, `status=DEGRADED`, `circuitOpenUntil`
через ~15 мин (базовый cooldown) с jitter.

1. Проверить cadence источника (`cadenceMinutes`) — при частом лимите увеличить.
2. Для YouTube — проверить дневную quota проекта; для VK/TikTok — лимиты токена.
3. Backoff сам замедлит повторы; ручное вмешательство только если лимит
   структурный (нужен другой тариф/ключ).
4. Не обходить лимит вторым ключом/scraping — это нарушение платформенной policy.

## 4. Budget exhaustion (BUDGET)

Симптом: run `skipped` c `apify_budget_exhausted`,
`paid_route_budget_unconfigured`, `paid_route_daily_budget_exhausted` или
`paid_route_monthly_budget_exhausted`; `lastFailureClass=BUDGET`.
Платный вызов заблокирован fail-closed — lead не потерян, просто не обработан
платно.

1. Посмотреть дневной/месячный расход по tenant (analytics rollups: provider
   costs, cost per accepted).
2. Решение владельца: поднять `dailyBudgetUsd`/`monthlyBudgetUsd` в настройках
   источника **или** дождаться UTC-сброса (день/месяц).
3. Не поднимать бюджет без подтверждённого budget/authorization (правило §9
   readiness-плана).
4. Для Apify/Bright Data сверить `reservedChargeUsd`, provider run и
   authoritative billing export. Estimate/округлённое значение UI никогда не
   записывается как `actualChargeUsd`; без invoice-grade строки actual остаётся
   `null`, reservation показывается как консервативная максимальная exposure.

## 5. Schema drift

Симптом: `lastFailureClass=SCHEMA_DRIFT`, route немедленно `DEGRADED`, provider
run `PARTIAL`/`FAILED`; raw error не содержит token или полный payload.

1. Сравнить `schemaVersion`, adapter build и redacted drift summary с последним
   принятым fixture. `TRUE_ZERO` не является drift.
2. Не повышать route обратно по одному успешному row: прогнать versioned fixture
   и regression gate. Смена contract/corpus version без принятого baseline
   блокирует promotion.
3. Если critical identity (`externalId`, parent/thread, canonical URL) потеряна,
   оставить route `DEGRADED`/`BLOCKED` и использовать только доказанный fallback.
4. Не коммитить live payload. В fixture разрешены только synthetic/redacted
   значения и стабильная shape.

## 6. Purge / retention failure

Симптом: растёт `purgeAt`-backlog; envelope/media не удаляются в срок.

1. Проверить job удержания (`observation-retention.ts`) и `deletion ledger`.
2. Для Apify dataset: `processApifyDatasetDeletion` помечает `PURGED`, зануляет
   `inputSnapshot` и `datasetId`; проверить, что нет застрявших `IMPORTED` без
   последующего `PURGED`.
3. Ретраи удаления идемпотентны — повторный прогон не создаёт дублей.
4. Legal hold не отменяет обязательное platform deletion — если hold мешает
   срочному удалению, эскалировать юристу (CR-6), не игнорировать deadline.

## 7. Queue backlog / stuck RUNNING

Симптом: источники долго `RUNNING`; next-due не двигается.

1. Reaper на каждом tick `social-monitoring-sources` снимает истёкший
   15-минутный lease; следующий claim поднимает `runClaimVersion` (fencing).
   Долгие `RUNNING` без прогресса
   допустимы до истечения lease.
2. Проверить `CollectorRun.leaseExpiresAt`; если run завис за пределами lease —
   его подхватит следующий планировщик, а проигравший worker получит
   `collector_lease_lost` и не перезапишет health.
3. Дубли упоминаний предотвращаются ingest-dedupe (externalId/contentHmac), дубли
   Apify-биллинга — freshness-bucketed idempotency key.
4. Если backlog системный — временно снизить fan-out (реже cron) и разобрать
   очередь.

## 8. Emergency stop

1. **Outbound (внешние отправки)**: остаются выключены (PR6). Global env kill
   switch + tenant/platform/connection/subject gates — все fail-closed. Для
   немедленной остановки убедиться, что `SOCIAL_LIVE_REPLY_ENABLED != 1` и tenant
   live-флаг выключен.
2. **Сбор**: поставить источник(и) в `status=paused`/`disabled`
   (`summarizeMonitoringReadiness` вернёт `disabled`, collector его пропустит).
3. **Платные вызовы**: выключить provider live-routing gate либо monetary
   enforcement authorization. Не подменять emergency stop фиктивным бюджетом;
   уже зарезервированные runs сверить и завершить через state-guarded finalizer.
4. Зафиксировать причину и время в инциденте; не удалять production data без
   отдельного разрешения.

## 9. Synthetic canary (без клиентских данных)

Цель — проверять сбор без реальных клиентских объектов.

1. Создать demo/sandbox tenant (см. CR-7) и источник на публичный owned-объект
   команды (например, собственный тестовый YouTube video / Telegram-группу), не
   клиентские страницы.
2. Прогонять по обычному cron; сверять `coverageClass`, freshness и стоимость с
   ожидаемыми.
3. Canary не должен создавать внешние отправки и платные вызовы сверх
   symbolic-бюджета.
4. Полный 14-дневный canary с метриками §6.2 — отдельная runtime-задача (см.
   «Открытые пункты»): требует включённого источника и прод-окружения.

## 10. Owner rotation

- У пилота один назначенный owner и support channel (CR-7/§6.4).
- Ротация: при передаче дежурства — сверить открытые `BLOCKED`/`DEGRADED`
  маршруты, активные инциденты, budget-статус tenant и pending legal candidates.
- Support intake принимает correlation/source/run IDs без запроса секретов.

## Открытые пункты (runtime/infra-gated, не закрыты кодом CR-1)

- 14-дневный canary с метриками §6.2 (webhook P95, polling freshness, pagination
  canary) — требует прод-прогонов; `NOT RUN`.
- SLO metrics, dashboards и alerts (§18) — отдельная поставка.
- Live Bright webhook delivery — `NOT RUN`: endpoint/auth/idempotency готовы,
  provider async callback не активирован до release gates.
