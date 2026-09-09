# Social Monitoring — Bright Data integration contract

Статус: transport foundation, route registry, Instagram
discovery/post/comment/reel, Facebook discovery/post/comment и TikTok
discovery/post/comment mappings реализованы.
Минимальные live POC выполнены 2026-07-13; остальные платформы ещё не проверены
live.
Проверено по официальной документации Bright Data 2026-07-13.

## 1. Выбранный API flow

Для discovery и массового collect-by-URL используется asynchronous snapshot
flow:

1. `POST /datasets/v3/trigger?dataset_id=...` возвращает `snapshot_id`.
2. `GET /datasets/v3/progress/{snapshot_id}` возвращает
   `starting | running | ready | failed`.
3. После `ready` вызывается
   `GET /datasets/v3/snapshot/{snapshot_id}?format=json`.

Официальные источники:

- [Social Media Scraper APIs overview](https://docs.brightdata.com/api-reference/scrapers/social-media-apis/overview)
- [Asynchronous requests](https://docs.brightdata.com/api-reference/rest-api/scraper/asynchronous-requests)
- [Monitor progress](https://docs.brightdata.com/api-reference/web-scraper-api/management-apis/monitor-progress)
- [Download snapshot](https://docs.brightdata.com/api-reference/scrapers/delivery-apis/download-snapshot)
- [Webhook delivery with caller-supplied Authorization](https://docs.brightdata.com/datasets/scrapers/google/data-delivery/webhooks)
- [Troubleshooting and rate limits](https://docs.brightdata.com/api-reference/marketplace-dataset-api/troubleshooting)

Social endpoints разделены на `discover` и `collect-by-url`; один dataset ID не
должен использоваться как универсальный scraper для всех capabilities.

## 2. Реализованный safe client

`src/lib/social/bright-data-client.ts` обеспечивает:

- фиксированный origin `https://api.brightdata.com`;
- Bearer token только в header;
- timeout через `AbortController`;
- schema validation для trigger/progress/download;
- synchronous scrape с обязательным `limitPerInput` и поддержкой single-record,
  array и snapshot-fallback response shapes;
- snapshot ID prefixes `s_`, `sd_` и `snap_`, подтверждённые API/docs;
- bounded polling и retry только безопасных progress GET;
- классификацию `401/403`, `402`, `429`, `5xx` через общий collector classifier;
- поддержку `Retry-After`;
- redaction provider error text;
- fail-closed dataset registry по `platform + capability`;
- пустой готовый snapshot как валидный zero-result, а не transport failure.

`POST /trigger` намеренно не повторяется автоматически: без доказанного
idempotency contract повтор может создать второй платный snapshot. Повтор trigger
выполняется только orchestration-слоем после сверки run state и бюджета.

## 3. Проверенные social routes

Dataset IDs и режимы ниже проверены в созданном Bright Data account 2026-07-13.
Они не являются секретами; API token хранится только в ignored `.env.local`.

| Платформа | Capability | Dataset | Режим/input |
| --- | --- | --- | --- |
| Instagram | discovery posts | `gd_lk5ns7kz21pck8jpis` | `discover_new`, `discover_by=url`, profile URL |
| Instagram | collect post/media/metrics | `gd_lk5ns7kz21pck8jpis` | post URL |
| Instagram | comments | `gd_ltppn085pokosxh13` | post URL |
| Facebook | page posts discovery | `gd_lkaxegm826bjpoo9m5` | profile/page URL |
| Facebook | collect post/media/metrics | `gd_lyclm1571iy3mv57zw` | post URL |
| Facebook | comments | `gd_lkay758p1eanlolqw8` | post URL |
| TikTok | discovery posts | `gd_lu702nij2f790tmv9h` | `discover_new`, `discover_by=keyword` |
| TikTok | collect post/media/metrics | `gd_lu702nij2f790tmv9h` | video URL |
| TikTok | comments | `gd_lkf2st302ap89utw5k` | video URL |

Критическое ограничение: текущие Instagram/Facebook routes не дают глобальный
поиск всех публичных постов по произвольному brand keyword. Они раскрывают посты
из известных profile/page URLs. Только TikTok из первой волны имеет прямой
keyword discovery. Поэтому Meta coverage требует отдельного URL/profile discovery
слоя; Bright Data нельзя честно считать полной заменой web/search discovery.

`READ_MEDIA` и `UPDATE_METRICS` используют тот же post payload, что
`ENRICH_CONTENT`. Orchestration должен coalesce эти capabilities в один provider
call, иначе система заплатит трижды за один URL.

## 4. Live schema proof: Instagram post, comment и reel

Минимальный synchronous POC использовал официальный Posts dataset
`gd_lk5ns7kz21pck8jpis`, один публичный post URL и вернул HTTP 200 / одну
запись. В ответе подтверждены 37 top-level fields, включая:

- identity: `url`, `post_id`, `shortcode`;
- content: `description`, `date_posted`, `user_posted`;
- metrics: `likes`, `num_comments`;
- media: `thumbnail`, `images`, `photos`, `post_content`.

Raw live payload не коммитится. Тестовый fixture синтетический и сохраняет
только доказанную структуру. Нормализатор
`src/lib/social/bright-data-instagram-post-normalizer.ts` из одного оплачиваемого
post payload создаёт content, media и metric records, тем самым выполняя правило
coalescing и не вызывая provider трижды.

Comments POC использовал dataset `gd_ltppn085pokosxh13` и обязательный
`limit_per_input=1`. Подтверждены `comment_id`, `comment`, `comment_user`,
`comment_date`, `likes_number`, `replies_number` и `post_url`. Provider не
возвращает post ID, поэтому normalizer требует ID уже обогащённого parent post и
fail-closed отклоняет комментарий без этой связи.

Повторный вызов того же endpoint не выполнялся на прежнем POC target. Для
отдельного known-positive public post Instagram UI показывал comment counter
`21` и видимые ветки `3 replies` и `1 reply`. Canary с hard cap одной записи
вернул один валидный top-level row с `replies_number=0`. Follow-up с hard cap
`25 records` вернул 15 уникальных NDJSON rows без provider errors, но у всех
`replies_number=0`; полей `replies`, `parent_comment_id`,
`reply_to_comment_id` или другой reply identity не было.

Следовательно, проверенный Bright Data Instagram comments endpoint не доказал
pagination/replies и не воспроизвёл полный UI-visible comment graph. Его нельзя
использовать как единственный comments source для цели 90% recall. Новые вызовы
на том же endpoint/target остановлены; нужен отдельный reply-capable provider,
официальный contract update либо явно задокументированный coverage gap. Raw
canary payload остаётся только в `/tmp`.

Reel POC использовал dataset `gd_lyclm20il4r5helnj` и тот же hard cap.
Подтверждены `product_type=clips`, `video_url`, `thumbnail`, `audio_url`, `length`,
`views` и `video_play_count`. Reel normalizer сохраняет video/cover/audio,
duration и metrics из одного payload.

Панель показывает тариф comments/reels `$1.50/1k records`. Cost Explorer после
трёх POC-вызовов показывает `3 records`, но `Total cost $0`; это округлённое
отображение, а не доказательство бесплатного сбора. Cost ledger всё ещё должен
сверяться с invoice-grade usage до массового запуска.

## 5. Что ещё не реализовано

- глобальный Meta keyword/search discovery layer и mappings остальных платформ;
- reply-capable fallback для Instagram comments: known-positive Bright Data
  canary вернул только top-level rows без reply identity;
- replies/pagination proof для TikTok comments;
- Facebook Reel comments: live endpoint вернул `dead_page`, нужен другой route
  или явный coverage gap;
- создание Bright Data run и вызов ledger finalizer из production adapter;
- webhook delivery и signature contract;
- дополнительные schema fixtures для pagination/reply/error rows;
- применение schema health к `SourceRoutePlan.status=DEGRADED` с recovery gate;
- invoice-grade Bright Data usage export/reconciliation;
- production routing и fallback.

Это сознательные blockers: dataset IDs и поля output различаются по endpoint.
Маппинг без live sample создаст ложное ощущение готовности и риск тихой потери
comments/media.

## 6. Входы для следующего live POC

Потребуются:

1. `BRIGHT_DATA_API_TOKEN` через secret store;
2. утверждённый spend cap;
3. dataset IDs, выданные аккаунту для выбранных social endpoints;
4. минимум один known-positive URL на каждый endpoint;
5. подтверждённый control corpus;
6. разрешённые retention/export/media условия.

Следующий POC запускается по одному endpoint за раз с одним known-positive URL.
После завершённого TikTok и pure cost-ledger slices приоритет —
replies/pagination, persistence ledger в provider run и Meta discovery.
Production route остаётся неизменным до provider decision record `SM-PR-017`.

## Provider decision: capability-specific routing

As of 2026-07-21, Facebook and selective TikTok discovery/comment routes remain
Bright Data-only. Instagram is the bounded exception: official Business
Discovery is preferred for eligible professional profiles, then the pinned
Apify discovery actor; external comments/replies for known public post URLs use
the pinned `apify/instagram-comment-scraper`. Bright Data remains an Instagram
fallback only when a verified proof and live-routing gate exist. Generic web
search is unchanged.

All paid social providers share an immutable application ceiling of `$4` per
run, `$4` per UTC day and `$120` per month. Tenant/source limits may be lower,
never higher. Manual clicks, automatic runs and provider fallback all consume
the same tenant ceiling; a manual click no longer bypasses daily/monthly spend.

## 7. Live schema proof: Facebook post и comment

Facebook post collect-by-URL (`gd_lyclm1571iy3mv57zw`) вернул synchronous
fallback HTTP 202 с `sd_` snapshot ID. После progress=`ready` snapshot содержал
один post record с 39 полями: text/author/date, likes/comments/shares/views,
video/audio attachments, thumbnail и duration. Повторный billable POST не
выполнялся.

Page-posts endpoint (`gd_lkaxegm826bjpoo9m5`) с hard cap одной записи вернул
обычный NASA post с текстом и комментариями. Comments endpoint
(`gd_lkay758p1eanlolqw8`) для этого URL подтвердил 21 поле, включая
`comment_id`, `post_id`, `parent_comment_id`, `reply`, permalink, author,
likes/replies и parent URL.

Тот же comments endpoint для Facebook Reel вернул error-record
`dead_page: For this type of posts (reels) comments are not available.` Это
зафиксированное ограничение provider, а не zero-result. Production routing не
должен повторять запрос или считать такой ответ отсутствием комментариев.

## 8. Live schema proof: TikTok discovery, post и comment

Keyword discovery (`gd_lu702nij2f790tmv9h`, `type=discover_new`,
`discover_by=keyword`) был запущен с `num_of_posts=1` и
`limit_per_input=1`. Он вернул HTTP 200 и ровно одну single-object запись с
реальным post URL, ID, текстом, video/cover/audio, author/date и metrics.
Нормализатор сохраняет discovery только как `CANDIDATE`: обогащённые поля из
поискового ответа не пересекают ingest boundary до отдельного enrichment шага.

Отдельный collect-by-URL запрос к тому же post dataset и тому же hard cap
вернул тот же post ID. Live schema подтвердила `description`, `create_time`,
`digg_count`, string-valued `share_count`, `comment_count`, `play_count`,
`video_duration`, `video_url`, `preview_image`, `music.playurl`, profile fields
и permalink. Из одного payload создаются content, video/cover/audio и metric
records.

Comments endpoint (`gd_lkf2st302ap89utw5k`) для этого post URL с hard cap одной
записи вернул тот же `post_id` и один comment row: `comment_id`,
`comment_text`, `comment_url`, author, date, `num_likes`, `num_replies` и
`post_url`. Normalizer требует expected parent post ID и fail-closed отклоняет
mismatch. Raw live payloads остаются только в `/tmp`; committed fixtures
синтетические. Pagination и фактическая reply-row схема ещё не доказаны.

Все Bright Data post/media normalizers для Instagram, Facebook и TikTok теперь
применяют общий public-media URL guard до создания content, avatar, video,
cover, audio или image records. Loopback, link-local, private IPv4, reserved IP
и local IPv6 URLs отбрасываются до downstream asset fetch; private parent post
URL считается schema failure. DNS resolution/rebinding protection остаётся
обязанностью downloader на fetch boundary.

Тот же guard применяется к Bright Data comment normalizers: private parent URL
fail-closed отклоняет row, а private optional comment/author URL не сохраняется.

## 9. Cost ledger contract

`src/lib/social/bright-data-cost-ledger.ts` считает requested units, delivered
records, accepted unique, reservation reconciliation и cost per accepted unique
без внешнего вызова и без записи estimate как фактической цены.

Поддерживаются четыре доказательных состояния:

- `PROVIDER_AMOUNT` — provider вернул authoritative `amountUsd`;
- `BILLING_UNITS_PRICE_SNAPSHOT` — provider вернул billing units, а rate взят из
  versioned price snapshot;
- `DELIVERED_RECORD_ESTIMATE` — цена оценена по delivered records; поле
  `SocialProviderRun.actualChargeUsd` намеренно не заполняется;
- `UNAVAILABLE` — authoritative amount/rate отсутствует, система возвращает
  warning, а не придумывает нулевую стоимость.

Provider contract теперь принимает `amountUsd` или units с обязательным
`unitName`. Price snapshot требует ID, effective date, USD rate и source URL.
При `acceptedUnique=0` actual и estimated cost-per-accepted остаются `null`.
`src/lib/social/bright-data-run-ledger-repo.ts` state-guarded сохраняет ledger в
существующий Bright Data `SocialProviderRun`: обновляет delivered/accepted
counts, освобождает reservation только при authoritative actual cost, не
перезаписывает terminal run и не принимает foreign-provider row. Estimate
остаётся только audit JSON.

Следующий блок для полного `SM-PR-036` — создавать run до dispatch, вызывать
finalizer из production adapter и сверять результат с invoice-grade Cost
Explorer export. До этого task остаётся `IN_PROGRESS`.

Account verification 2026-07-13 подтвердила активный Web Scraper API plan
`Pay as you go` со ставкой `$1.50/1k records`. Cost Explorer за 01–13 July
сначала показал `10 records` и `$0.02` total. После двух разрешённых Instagram
comments canary (`1` и `15` delivered rows) aggregate стал `26 records` и
`$0.04`: nominal account total `$0.039` отображается с округлением до цента.
Это подтверждает delivered-record units и account rate, но aggregate UI не
является точным `actualChargeUsd` отдельного provider run. CSV download доступен
в UI, но raw account export не коммитится.

`src/lib/social/bright-data-budget-cap.ts` превращает owner-approved USD hard
cap в `limit_per_input` до provider dispatch. Versioned snapshot загружается из
четырёх несекретных env values:

- `BRIGHT_DATA_PRICE_SNAPSHOT_ID`;
- `BRIGHT_DATA_PRICE_EFFECTIVE_AT`;
- `BRIGHT_DATA_USD_PER_1000_RECORDS`;
- `BRIGHT_DATA_PRICE_SOURCE_URL`.

Частичная, malformed или нулевая конфигурация блокируется. Планировщик считает
aggregate exposure по всем inputs в integer micro-USD, округляет unit rate вверх
и уменьшает одинаковый `limit_per_input`, если requested records не помещаются
в hard cap. `BrightDataClient.scrapeWithBudgetCap()` использует этот план и не
вызывает provider fetch при blocked result.

`src/lib/social/bright-data-adapter.ts` вызывает только budgeted entry point
после атомарной owner reservation, сохраняет redacted input snapshot и завершает
run через state-guarded ledger finalizer. Enrichment coalesces
content/media/metrics в один платный payload; `READ_MEDIA` и `UPDATE_METRICS`
переиспользуют его без второй reservation. Live routing остаётся выключенным по
умолчанию и требует одновременно verified capability proof,
`SOCIAL_BRIGHT_DATA_LIVE_ROUTING=1`, USD enforcement и versioned price snapshot.

## 10. Schema drift evaluation

`src/lib/social/bright-data-schema-drift.ts` оценивает уже полученный provider
batch без I/O и возвращает `TRUE_ZERO`, `HEALTHY`, `DEGRADED` или `FAILED`.
Пустой валидный batch остаётся `TRUE_ZERO`; он не считается transport failure и
не запускает fallback. По умолчанию route candidate деградирует, когда доля
невалидных rows больше 20%; batch без единой валидной записи получает `FAILED`.

Отчёт содержит только агрегированные failure codes. Raw provider messages,
URLs, tokens и payload samples в него не попадают. Явные provider error rows
сохраняются как коды вида `provider_error:dead_page`, а missing ID/text/date/URL
получают стабильные normalizer codes.

Adapter передаёт aggregate health в route executor. `DEGRADED`/`FAILED` сразу
переводят `SourceRoutePlan` в `DEGRADED` без retry circuit; следующий healthy
batch возвращает route в `ACTIVE`. `TRUE_ZERO` остаётся успешным результатом и
не запускает fallback.

## 11. Webhook authentication boundary

Bright Data documentation подтверждает custom
`webhook_header_Authorization=Bearer ...` и IP allowlist, но не описывает
provider-generated HMAC signature для payload. Поэтому система не маркирует
такую delivery как «подписанную Bright Data».

`src/lib/social/bright-data-webhook-auth.ts` реализует documented shared-secret
boundary:

- генерирует 256-bit random bearer secret;
- хранит только context-bound HMAC по `organizationId + idempotencyKey`;
- проверяет `Authorization: Bearer ...` constant-time;
- отклоняет unsigned, wrong-scheme, malformed и cross-run/cross-tenant replay.

`/api/v1/social/providers/bright-data/webhook` проверяет context-bound Bearer до
state mutation, принимает только совпадающий `snapshot_id`, ограничивает тело
16 KiB, запрещает compressed payload и идемпотентно применяет remote status.
Unsigned/cross-run/state-regression delivery отклоняется. Trigger/client пока не
отправляет webhook URL/header: synchronous adapter использует bounded poll.
Поэтому live provider delivery canary остаётся `BLOCKED_EXTERNAL` до отдельного
решения включить async mode; локальный contract `SM-PR-038` завершён.
