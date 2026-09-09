# Social Monitoring — provider routing и внешнее покрытие

Статус: **актуальный execution roadmap**.

Обновлено: 2026-07-14.

Этот документ переводит решение `official API → licensed provider → Apify
fallback` в исполнимый backlog. Он дополняет:

- [`social-monitoring-v2-architecture-plan.md`](./social-monitoring-v2-architecture-plan.md) — целевая архитектура;
- [`SOCIAL-MONITORING-CLIENT-READINESS.md`](./SOCIAL-MONITORING-CLIENT-READINESS.md) — коммерческие release gates;
- [`social-monitoring-coverage-contract-template.md`](./social-monitoring-coverage-contract-template.md) — договор покрытия;
- [`social-monitoring-labeling-guide.md`](./social-monitoring-labeling-guide.md) — единые правила gold/control разметки;
- [`social-monitoring-collector-runbooks.md`](./social-monitoring-collector-runbooks.md) — эксплуатационные процедуры.

Исторический [`social-monitoring-roadmap.md`](./social-monitoring-roadmap.md) не
является актуальным backlog и не изменяется этим планом.

## 1. Решение и границы

### 1.1 Цель

Построить измеримый контур, который для согласованного набора публичных источников:

- находит не менее 90% релевантных материалов;
- сохраняет публикации, статьи, комментарии, ответы, видео, изображения и обложки;
- классифицирует релевантность, тему, язык и тональность с целевой точностью не
  ниже 90%;
- показывает источник, acquisition route, ограничения и стоимость каждого
  результата;
- использует Apify только как проверенный `BEST_EFFORT_FALLBACK`.

### 1.2 Допущения, которые должен письменно подтвердить владелец

1. Жёсткий SLA доставки тревоги за 30 минут исключён из целевого scope.
2. Разрешены внешние providers и subprocessors.
3. Показатель корректности изменён на 90%, либо исходное требование 95% остаётся
   действующим до официальной правки ТЗ.
4. Покрытие измеряется только по согласованной совокупности публичных материалов,
   доступных через разрешённые API/provider routes.
5. Закрытый, удалённый, недоступный по privacy settings и не возвращаемый API
   контент не входит в denominator.
6. Сохранение копий видео, изображений и обложек разрешается только когда это
   допускают договор и retention policy; иначе сохраняются URL и metadata.

### 1.3 Не входит в этот roadmap

- включение live public replies;
- обход captcha, anti-bot, авторизации или privacy controls;
- обещание мониторинга «всего интернета»;
- автоматический failover только потому, что provider вернул `0`;
- параллельный двойной billable fetch вне ограниченного POC/shadow режима;
- косметический redesign Social Monitoring, не влияющий на acquisition или
  доказательство качества.

## 2. Целевая маршрутизация

Маршрут выбирается детерминированно по capability, platform, ownership, scope и
сохранённому capability proof. ИИ не выбирает provider.

### 2.1 Логические capabilities

| Capability | Назначение | Результат |
| --- | --- | --- |
| `DISCOVER_URLS` | Найти candidate URLs по ключевым словам, профилям, хештегам и темам | Candidate/evidence, но не финальный mention |
| `ENRICH_CONTENT` | Получить реальный текст, автора, дату, permalink и platform ID | Нормализованный post/article/video |
| `READ_COMMENTS` | Получить комментарии, ответы и parent/thread identity | Comment/reply tree |
| `READ_MEDIA` | Получить media URL, thumbnail/cover, размеры, duration и transcript metadata | Media observations/assets |
| `UPDATE_METRICS` | Обновить views, likes, shares, comments и replies | Versioned metric snapshot |

Если текущий enum использует другие имена, реализация сохраняет существующие
значения и добавляет недостающие семантики без параллельной второй модели.

### 2.2 Platform route matrix

| Платформа/источник | Discovery primary | Content/comments/media primary | Fallback | Начальный статус |
| --- | --- | --- | --- | --- |
| Facebook owned | Meta Graph | Meta Graph | manual | `CONFIGURED`, нужен canary |
| Facebook external | Bright Data candidate | Bright Data candidate | Apify known-URL actors → manual | `POC_PARTIAL`: post/comment schema verified; Reel comments gap |
| Instagram owned | Meta Graph | Meta Graph | manual | `CONFIGURED`, нужен canary |
| Instagram external professional | Meta Business Discovery where allowed | Bright Data для post/media/top-level comments | Apify-maintained known-URL comments actor → Data365 trial → manual | `POC_PARTIAL`: post/media и Apify known-URL replies verified; production routing и completeness gate не пройдены |
| TikTok owned/partner | Approved official/business route | Approved official/business route | provider → manual | `BLOCKED_EXTERNAL` |
| TikTok external | Bright Data candidate | Bright Data candidate | Apify → manual | `POC_PARTIAL`: keyword/post/comment schema verified; pagination pending |
| LinkedIn external | Bright Data candidate | Bright Data candidate | Apify known URL → manual | `POC_REQUIRED` |
| YouTube | YouTube Data API | YouTube Data API comments/videos/thumbnails | Bright Data → manual | `CONFIGURED`, нужен canary |
| Telegram public | Telegram MTProto search/watchlist | Telegram MTProto messages/discussions/media | manual | `CONFIGURED`, нужен canary |
| X | Paid official search where approved | Official API or contract-tested provider | Bright Data candidate → manual | `BLOCKED_EXTERNAL` |
| VK | VK official API | VK official posts/comments/media | provider → manual | `CONFIGURED`, нужен canary |
| Web/news | RSS/sitemap/direct crawler + Brave/News API discovery | Direct article extractor | Apify crawler → manual | `POC_REQUIRED` |
| Government sites | RSS/sitemap/direct domain crawler | Direct article/document extractor | manual | `SOURCE_LIST_REQUIRED` |
| TV/radio/print | Licensed media monitoring provider | Provider transcript/metadata | manual import | `OUTSIDE_SOCIAL_PROVIDER_POC` |

Bright Data остаётся кандидатом primary для объёмного content/media collection,
но known-positive Instagram canary не подтвердил replies. Apify рассматривается
не как единый поисковый backend, а как узкий known-URL fallback для тех
capabilities, которые он реально докажет. Data365 остаётся контрактным
альтернативным кандидатом. Маркетинговая документация любого provider сама по
себе не создаёт `VERIFIED` capability proof.

### 2.3 Failover policy

Fallback разрешается только при одном из событий:

- auth/permission failure;
- HTTP `429` после исчерпания разрешённого retry/backoff;
- provider `5xx`, timeout или network failure;
- payload schema drift;
- failed known-positive canary;
- измеренное покрытие primary ниже договорного порога;
- operator-approved incident override с TTL.

Нулевой результат без других признаков ошибки не запускает fallback автоматически.
В POC/shadow режиме параллельные запросы разрешаются только с отдельным budget,
одним comparison run ID и запретом повторных side effects.

### 2.4 Дедупликация и стоимость

- основной ключ: `platform + externalId`;
- fallback: canonical URL + content kind + parent/thread identity;
- последний fallback: hash нормализованного текста, автора и временного окна;
- provider provenance не участвует в identity материала;
- каждый run пишет requested units, delivered records, accepted unique, стоимость
  и причину fallback;
- основная коммерческая метрика: `total acquisition cost / accepted unique`.

### 2.5 Решение по Instagram comment replies

Research snapshot 2026-07-13 разделяет «provider заявляет» и «контракт/POC
доказал»:

| Кандидат | Проверенный публичный контракт | Стоимость/ограничение | Решение |
| --- | --- | --- | --- |
| Bright Data | Comments dataset документирует reply fields, но наш known-positive canary вернул только top-level rows | `$1.50/1k delivered records` на текущем account snapshot | Instagram fallback; Bright Data remains primary only on approved Facebook/TikTok capabilities |
| `apify/instagram-comment-scraper` | Maintained by Apify; controlled POC на pinned build `0.0.502` вернул 15 top-level + 4 reply rows, все 4 parent links разрешены | POC `$0.0437`; `resultsLimit` сам по себе не ограничивает replies, поэтому сохранены `maxItems` и общий `$4` run/day ceiling | Primary для known-URL Instagram comments/replies через versioned route compiler |
| Data365 | Vendor заявляет comments+replies, до 500 comments/post, async POST/poll/GET и 5 credits за post+comments | Basic `€300/month`, 500k credits; есть 14-day trial, но точный reply parameter/response schema публично не раскрыт | Второй POC/contract option, если Apify не проходит recall или stability gate |
| EnsembleData | Текущая public OpenAPI содержит только `/instagram/post/comments`: popular около 15 либо paginated recent; sample имеет `child_comment_count`/`parent_comment_id`, но отдельного Instagram replies endpoint нет | Free trial; public pricing/schema требуют reconciliation перед spend | Не выбирать для Instagram replies без письменного schema contract или POC |
| ScrapeCreators | В официальной навигации есть Instagram Comments, но reply endpoints опубликованы для TikTok/Facebook, не Instagram | Free credits доступны после регистрации | Кандидат для TikTok/Facebook replies, не для Instagram reply gate |
| community Apify actors | Некоторые actors имеют `scrape_replies`/`max_replies`, но поддерживаются community | Например от `$1.20/1k comments` | Только tertiary fallback после Apify-maintained actor |

Primary sources:

- [Apify-maintained Instagram Comment Scraper](https://apify.com/apify/instagram-comment-scraper) и его [input schema](https://apify.com/apify/instagram-comment-scraper/input-schema);
- [Apify Run Actor API: `maxItems`, `maxTotalChargeUsd`, `build`](https://docs.apify.com/api/v2/act-runs-post);
- [Data365 Instagram guide](https://data365.co/es/guides/how-to-use-instagram-api), [reply claim](https://data365.co/blog/how-to-get-instagram-data) и [pricing](https://data365.co/pricing);
- [EnsembleData Instagram comments API](https://ensembledata.com/instagram-comments-api), [public API docs](https://ensembledata.com/apis/docs) и [pricing](https://ensembledata.com/pricing);
- [ScrapeCreators official docs](https://docs.scrapecreators.com/).

Controlled POC выполнен 2026-07-14; redacted evidence находится в
[`social-monitoring-apify-instagram-replies-poc.md`](./social-monitoring-apify-instagram-replies-poc.md).
Route разрешён только для Instagram discovery и `READ_EXTERNAL_COMMENTS`;
Facebook/TikTok остаются Bright Data-only. Все провайдеры делят один tenant
spend ceiling, включая manual и fallback.

## 3. Acceptance metrics

Показатели считаются отдельно по каждой обязательной платформе, языку и content
kind. Большой объём одной платформы не компенсирует провал другой.

| Метрика | Gate |
| --- | ---: |
| Discovery recall на согласованном control set | `>= 90%` |
| Relevance precision | `>= 90%` |
| Успешное извлечение известного публичного URL | `>= 95%` |
| Полнота provider-visible comments/replies | `>= 90%` |
| Author/date/permalink completeness | `>= 95%` |
| Video/cover completeness, когда объект видим на платформе | `>= 95%` |
| Topic accuracy | `>= 90%` |
| Sentiment macro-F1 по AZ/RU/EN | `>= 90%` |
| Invalid/schema-drift records | `<= 1%` |
| Необъяснимые cross-provider duplicates | `<= 1%` |
| POC cost accounting | `100%` runs имеют units/cost/status |

Если исходное ТЗ сохраняет 95% корректности, release gate автоматически
повышается до 95% независимо от этого внутреннего roadmap.

## 4. Входы и владельцы

### 4.1 Что нужно от владельца продукта

- подтверждённый список обязательных платформ и источников;
- Bright Data trial/API key;
- Data365 trial/demo key или письменный отказ от сравнительного POC;
- Apify billing resolution и отдельный небольшой POC spend cap;
- official API credentials для включённых платформ;
- утверждённый месячный provider budget и overage policy;
- список разрешённых provider hosts;
- решение по хранению media assets;
- OCR/ASR credentials и budget, если анализируется содержимое медиа;
- ответственный аналитик для разметки control/gold datasets.

Секреты передаются только через environment/secret store и не попадают в Git,
логи, screenshots или roadmap.

### 4.2 Роли

| Роль | Ответственность |
| --- | --- |
| Product/contract owner | Scope, denominator, бюджет, provider contract, final GO/NO-GO |
| Backend integrations | Provider adapters, routing, queues, normalization, cost ledger |
| Data/ML | Gold set, relevance/topic/sentiment evaluation, drift monitoring |
| Frontend | Source/provider health, provenance, review queue, evidence/media UI |
| QA/operations | Canary corpus, shadow comparison, incident/runbook verification |
| Legal/privacy | Provider terms, DPA, retention, storage and export rights |

## 5. Backlog

Статусы: `BLOCKED_EXTERNAL`, `WAITING_OBSERVATION`, `DONE`.

Текущий foundation checkpoint:

| Задача | Статус | Evidence |
| --- | --- | --- |
| `SM-PR-003` | `DONE` | [`social-monitoring-provider-control-corpus.md`](./social-monitoring-provider-control-corpus.md) фиксирует formulas, denominators и gates |
| `SM-PR-004` | `BLOCKED_EXTERNAL` | Формат поддерживает отдельную строку на locale/query; реальный AZ/RU/EN pack требует subjects владельца |
| `SM-PR-005` | `BLOCKED_EXTERNAL` | Формат и synthetic example готовы; минимум 50 реальных URL на платформу требует аналитической разметки |
| `SM-PR-006` | `DONE` | Versioned AZ/RU/EN relevance/topic/sentiment/media labeling contract и adjudication gates зафиксированы |
| `SM-PR-011` | `DONE` | `provider-comparison.ts` запускает одинаковый corpus без Prisma side effects |
| `SM-PR-012` | `DONE` | Billing доступен; pinned/no-restart hard-capped run завершён за `$0.0437`, billing failure, actor failure и true zero различаются |
| `SM-PR-018` | `DONE` | Instagram reply candidates сравнены по public schema, maintenance owner, цене и hard-cap support |
| `SM-PR-019` | `DONE` | Controlled POC получил 4 reply rows в 2 ветках; 4/4 parent links resolved, 0 duplicate/missing critical fields |
| `SM-PR-020` | `DONE` | `provider-capability-contract.ts` задаёт пять versioned capabilities и runtime schema gate |
| `SM-PR-022` | `DONE` | Candidate draft не является `IngestInput`; ingest разрешён только после enrichment |
| `SM-PR-023` | `DONE` | `SocialMention` и `IngestEnvelope` хранят post/parent/thread/reply/depth identity в отдельных колонках; backfill/indexes уже применены migration PR1 |
| `SM-PR-024` | `DONE` | Tenant-scoped immutable `SocialMetricSnapshot` history, bigint counters, idempotent repository, RLS/check constraints и no-fake-history migration proof |
| `SM-PR-025` | `DONE` | Bright Data + Apify regression создаёт один canonical mention и два provider-specific provenance envelopes |
| `SM-PR-030` | `DONE` | Safe snapshot client реализован и протестирован; live POC подтвердил также plain-text error shape Bright Data |
| `SM-PR-031` | `DONE` | Instagram/Facebook profile discovery и TikTok keyword discovery нормализуются в candidate rows с query/provenance и не обходят enrichment boundary |
| `SM-PR-032` | `DONE` | Единый pure batch normalizer покрывает Instagram/Facebook/TikTok content mappings, валидирует provider contract и отделяет malformed rows через drift report; live POC пока только Instagram |
| `SM-PR-033` | `BLOCKED_EXTERNAL` | Bright Data остаётся primary top-level route; Apify reply identity доказан; нужен новый known-positive TikTok pagination/reply target и Facebook Reel endpoint contract |
| `SM-PR-034` | `DONE` | Provider image/video/thumbnail/audio records проходят public URL guard и идемпотентно планируются через существующий media policy pipeline; network fetch остаётся отдельным downloader boundary |
| `SM-PR-035` | `DONE` | Один enrichment payload coalesced в content/media/metrics; metric snapshots сохраняют immutable observedAt/provider provenance без второго provider call |
| `SM-PR-036` | `DONE` | Bright dispatch требует owner budget reservation + versioned price snapshot, вызывает budget-capped client и state-guarded ledger finalizer; estimate не пишется в actualChargeUsd |
| `SM-PR-037` | `DONE` | Batch drift health подключён к route health: malformed/provider-error rows дают DEGRADED/FAILED, TRUE_ZERO остаётся success и не открывает circuit |
| `SM-PR-038` | `DONE` | Bright webhook endpoint использует context-bound Bearer, 16 KiB/body-compression gates, snapshot binding и idempotent state transition; live provider delivery не активирована |
| `SM-PR-040` | `DONE` | Bright Data имеет отдельный adapter key, paid-provider identity и выбирается только при `VERIFIED` capability proof + явном live-routing gate; gate по умолчанию выключен |
| `SM-PR-041` | `DONE` | Bright Data route graph разделён на discovery → enrichment → comments/media/metrics; у каждого этапа отдельный proof, route key и budget, Apify fallback только для поддерживаемых discovery/comments |
| `SM-PR-042` | `DONE` | Canonical hard-failure classes управляют retry/quarantine, а Bright TRUE_ZERO остаётся успешным zero и не запускает fallback |
| `SM-PR-043` | `DONE` | Circuit использует threshold + exponential jittered backoff, bounded owner TTL override, physical-route dedupe и paid-run idempotency |
| `SM-PR-044` | `DONE` | Dual shadow harness изолирует providers, передаёт `allowPersistence=false` и требует отдельные request/USD hard caps до первого вызова |
| `SM-PR-051` | `BLOCKED_EXTERNAL` | Facebook/Instagram mappings готовы; Reel comments gap и platform control-corpus gate требуют внешнего target/contract evidence |

`DONE` здесь означает завершённый локальный foundation, а не доказанное живое
покрытие provider. Capped Bright Data proofs сохранены для проверенных
Instagram/Facebook/TikTok routes, но полнота pagination/replies и invoice-grade
стоимость ещё не доказаны. `SM-PR-014`–`017` зависят от внешнего corpus,
сравнимого evidence/waiver и периода наблюдения.

### Epic A — scope и контрольный набор

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-001` | Письменно подтвердить допущения §1.2 | owner | Есть утверждённая scope revision | `BLOCKED_EXTERNAL` |
| `SM-PR-002` | Заполнить coverage contract по платформам/capabilities | `001` | Нет строк без primary/fallback/status | `DONE`: §2.2 содержит primary/content/fallback/status для каждой заявленной platform/source; коммерческое утверждение scope остаётся `001` |
| `SM-PR-003` | Зафиксировать formulas/denominators KPI | `001` | Один воспроизводимый calculation spec | `DONE` |
| `SM-PR-004` | Подготовить AZ/RU/EN query pack и aliases | `002` | Queries имеют expected/negative examples | `BLOCKED_EXTERNAL`: schema/labeling готовы; нужны реальные monitoring subjects, aliases и negative examples владельца |
| `SM-PR-005` | Собрать known-URL control corpus | `002` | Не менее 50 URL на обязательную платформу, включая video/comment-rich cohorts | `BLOCKED_EXTERNAL` |
| `SM-PR-006` | Подготовить labeling guide | `003` | Два аналитика одинаково трактуют relevance/topic/sentiment | `DONE` |

### Epic B — provider POC

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-010` | Создать secret-safe POC configuration | credentials | Нет committed secrets; hosts allowlisted | `DONE` |
| `SM-PR-011` | Реализовать единый comparison harness | `005` | Один input запускается против нескольких providers без side effects | `DONE` |
| `SM-PR-012` | Проверить Apify billing и known-positive direct actors | `010` | Отличены billing failure, actor failure и true zero | `DONE`: capped run `SUCCEEDED`, 19 rows, `$0.0437` |
| `SM-PR-013` | Проверить Bright Data discover/collect/comments/media | `010`,`011` | Сохранены redacted samples, counts, units, latency, schema version | `BLOCKED_EXTERNAL`: IG/FB/TikTok capped proofs сохранены; закрытие требует неповторяющегося known-positive pagination/replies target и invoice-unit export |
| `SM-PR-014` | Проверить Data365 тем же corpus | `010`,`011` | Сравнимый evidence pack или owner waiver | `BLOCKED_EXTERNAL` |
| `SM-PR-015` | Получить Brandwatch sample export, если рассматривается enterprise option | owner decision | Проверены raw comments/thread/media/storage rights | `BLOCKED_EXTERNAL` |
| `SM-PR-016` | Выполнить 14-дневный provider comparison | `012`–`014` | Daily runs без скрытых пропусков; cost/accepted unique рассчитан | `WAITING_OBSERVATION`: harness/caps готовы; отсчёт нельзя начинать до owner corpus и Data365 waiver/evidence |
| `SM-PR-017` | Provider decision record | `016` | Primary/fallback выбран отдельно по capability/platform | `BLOCKED_EXTERNAL`: требуется завершённый `016` и owner GO/waiver по каждому capability/platform |
| `SM-PR-018` | Провести contract audit Instagram reply candidates | `013` | Зафиксированы schema, цена, hard cap и owner/maintenance risk | `DONE` |
| `SM-PR-019` | Controlled Instagram reply fallback POC | `012`,`018` | Known-positive replies получены с parent IDs и reconciled cost либо кандидат отклонён | `DONE`: 4 replies, 4/4 parent links, `$0.0437`, evidence redacted |

### Epic C — provider-neutral contract и data spine

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-020` | Расширить provider adapter contract под discovery/enrichment/comments/media/metrics | POC samples | Contract не содержит vendor-specific domain fields | `DONE` |
| `SM-PR-021` | Добавить versioned raw payload fixtures | `020` | Fixtures покрывают posts, videos, comments, replies, missing fields | `DONE` |
| `SM-PR-022` | Использовать `IngestEnvelope` как candidate boundary | `020` | SERP/search snippet не создаёт финальный mention до enrichment | `DONE` |
| `SM-PR-023` | Добавить недостающие normalized fields/relations | `020`,`021` | Post/comment/reply/media identity сохраняется без JSON-only critical fields | `DONE` |
| `SM-PR-024` | Добавить metric snapshots | `023` | Views/likes/shares/comments не перезаписываются без history | `DONE` |
| `SM-PR-025` | Добавить cross-provider dedupe regression suite | `022`,`023` | Один материал из двух providers создаёт один mention | `DONE` |

`SM-PR-023` и `024` являются safety-lane: Prisma validate/generate, миграционная
процедура, RLS и backfill proof обязательны до deploy.

### Epic D — Bright Data adapter и двухступенчатый pipeline

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-030` | Реализовать Bright Data async client | `013`,`020` | Auth, timeout, poll, retry и redacted errors протестированы; webhook delivery отдельно в `038` | `DONE` |
| `SM-PR-031` | Реализовать `DISCOVER_URLS` mappings | `030` | Candidate URL хранит query/source/provenance, но не имитирует post | `DONE` |
| `SM-PR-032` | Реализовать `ENRICH_CONTENT` mappings | `030`,`031` | Text/author/date/permalink/platform ID нормализованы | `DONE`: единый batch normalizer + contract/drift tests для Instagram/Facebook/TikTok |
| `SM-PR-033` | Реализовать comments/replies pagination | `032` | Parent/thread identity, replies и next cursor сохраняются | `BLOCKED_EXTERNAL`: Instagram Apify reply identity доказан; нужен known-positive TikTok pagination/reply target и Facebook Reel endpoint contract без повтора уже проверенных calls |
| `SM-PR-034` | Реализовать media/cover normalization | `032` | Video/image/thumbnail URLs и metadata проходят asset policy | `DONE`: provider records планируются через media policy; fetch-boundary SSRF остаётся обязанностью downloader |
| `SM-PR-035` | Реализовать metrics refresh | `032`,`024` | Metrics имеют observedAt и provider provenance | `DONE`: coalesced enrichment + immutable snapshot persistence |
| `SM-PR-036` | Добавить provider cost ledger mapping | `030` | Run units/cost/reservation/accepted unique рассчитаны | `DONE`: pre-dispatch reservation/cap и state-guarded finalizer wired; invoice-grade actual остаётся null без authoritative export |
| `SM-PR-037` | Добавить schema-drift detector | `021`,`030` | Unknown/missing critical fields переводят route в `DEGRADED` | `DONE`: route health wiring + recovery/true-zero semantics |
| `SM-PR-038` | Добавить webhook delivery и signature contract | `030` | Delivery аутентифицирован, идемпотентен и не принимает unsigned payload | `DONE`: local endpoint/contract tests; provider HMAC не заявляется, live canary `BLOCKED_EXTERNAL` до async activation |

### Epic E — deterministic routing и failover

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-040` | Добавить Bright Data adapter key/capability proof | `017`,`030` | Route compiler выбирает provider только при verified proof | `DONE`: отдельный key/provider identity, USD guard и default-off live gate |
| `SM-PR-041` | Разделить discovery, enrichment и comments route plans | `022`,`040` | Каждый этап имеет primary/fallback и отдельный budget | `DONE`: dependency graph и capability-scoped fallback проверены тестами |
| `SM-PR-042` | Реализовать failover classifier | `041` | True zero не считается failure; hard failures классифицированы | `DONE`: canonical error classes + Bright TRUE_ZERO/schema-health tests |
| `SM-PR-043` | Добавить circuit breaker и TTL override | `042` | Provider outage не создаёт retry storm/double billing | `DONE`: threshold/backoff/jitter, bounded owner TTL override, physical-route dedupe и paid-run idempotency |
| `SM-PR-044` | Добавить shadow comparison mode | `041`,`036` | Dual fetch изолирован, budgeted и не дублирует side effects | `DONE`: side-effect-free dual harness требует per-provider request/USD caps и `allowPersistence=false` |
| `SM-PR-045` | Добавить fallback/failback reconciliation | `043`,`044` | Возврат к primary не создаёт gaps или duplicates | `DONE`: fallback success не сбрасывает circuit; expired-primary probe повышается в `ACTIVE` только после bounded overlap audit без unresolved gaps/identity conflicts |

### Epic F — platform rollout

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-050` | Wave 1: YouTube, Telegram, VK official canaries | credentials | Posts/comments/media capability proofs `VERIFIED` или честный blocker | `BLOCKED_EXTERNAL` |
| `SM-PR-051` | Wave 2: Facebook/Instagram external | `033`–`045` | Discovery → enrichment → comments проходит platform gates | `BLOCKED_EXTERNAL`: local pipeline готов; Reel comments contract gap и owner-labeled platform gate не закрыты |
| `SM-PR-052` | Wave 3: TikTok/LinkedIn external | `033`–`045` | Platform-specific POC gates пройдены | `BLOCKED_EXTERNAL`: TikTok pagination/reply proof и LinkedIn known-positive corpus/contract отсутствуют |
| `SM-PR-053` | Wave 4: X route | paid X/provider decision | Official/provider route имеет contract proof | `BLOCKED_EXTERNAL` |
| `SM-PR-054` | Wave 5: web/news/government sources | source list | RSS/direct/Brave/News API routes измерены отдельно | `BLOCKED_EXTERNAL` |

### Epic G — качество 90%

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-060` | Собрать versioned gold dataset | `005`,`006`, live samples | Представлены platforms/content kinds/AZ-RU-EN/sentiments | `BLOCKED_EXTERNAL`: v2 schema/example/validator готовы; нужны owner-labeled known-positive/negative rows из `005` и live samples |
| `SM-PR-061` | Добавить coverage evaluator | `060` | Recall/precision считаются по platform/language/content kind | `DONE`: aggregate и обязательные `platform × locale × contentKind` slices; провал одного cohort блокирует общий pass |
| `SM-PR-062` | Добавить media/comment completeness evaluator | `060` | Visible/provider-visible denominator воспроизводим | `DONE`: owner-visible и provider-visible comment/media denominators заданы corpus contract и валидируются как subset |
| `SM-PR-063` | Настроить confidence thresholds и review queue | `061` | Низкая уверенность не проходит как автоматически verified | `DONE`: versioned `0.70` auto-accept boundary enforced at ingest; lower/invalid confidence enters existing 7-day operator `REVIEW` queue; locale/content-kind gate fail-closed |
| `SM-PR-064` | Добавить regression/drift run | `061`,`062` | Изменение model/provider schema блокирует promotion | `DONE`: provider/model contract, corpus/dataset, missing cohort, absolute gate и bounded metric regression fail closed before promotion |
| `SM-PR-065` | Сформировать evidence report 90% | `064` | Все обязательные платформы проходят gate отдельно | `BLOCKED_EXTERNAL`: evaluator/regression format готов; нужен завершённый owner-labeled `060` и platform shadow evidence, общая средняя не принимается |

### Epic H — UI, отчёты и operations

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-070` | Показать provider route/provenance/capability status | `040` | Operator видит primary, fallback, last proof, limitation | `DONE`: source watchlist раскрывает capability route, primary/fallback chain, proof state и persisted limitation reason |
| `SM-PR-071` | Показать discovery → enrichment funnel | `031`,`032` | Видны candidates/enriched/review/accepted counts | `DONE`: bounded recent provider runs показывают candidates/enriched/review/accepted/duplicates без нового backend call |
| `SM-PR-072` | Добавить post/comment/thread/media presentation | `033`,`034` | Comments tree и covers видимы без ложных полей | `DONE`: feed использует normalized contentKind/depth/thread/parent columns и linked MediaObservation thumbnail/source URL; отсутствующая identity не имитируется |
| `SM-PR-073` | Добавить cost/accepted unique dashboard | `036` | Стоимость видна по provider/platform/capability | `DONE`: source-level provider evidence показывает authoritative actual либо явно labelled reserved exposure и cost/accepted; estimate не маскируется под actual |
| `SM-PR-074` | Включить provider/media data в DOCX/XLSX reports | reporting foundation | Ссылки, covers и top comments корректно экспортируются | `DONE`: tenant-scoped no-store DOCX/XLSX export включает provider, source/parent links, linked cover/media URL и до 5 top comments |
| `SM-PR-075` | Обновить runbooks | `042`–`045` | Billing, outage, drift, fallback, purge описаны и rehearsed | `DONE`: mandatory budget gates, authoritative billing, outage/circuit, schema drift, overlap failback, purge и emergency stop aligned; live drill остаётся частью `082` |
| `SM-PR-076` | Archive-first reuse для новых сценариев | normalized archive, scenario matcher | Сценарий сначала локально переиспользует сохранённые записи; provider resume идёт после durable query watermark | `DONE`: scenario archive start/backfill, hidden-until-matched archive rows, subject/scenario metadata merge и monotonic `fetchAfter` реализованы; async provider watermark двигается только после import, live-send остаётся выключен |

### Epic I — release и пилот

| ID | Задача | Зависимость | Acceptance | Статус |
| --- | --- | --- | --- | --- |
| `SM-PR-080` | Security/privacy/provider contract review | provider decision | DPA/retention/storage/subprocessors approved | `BLOCKED_EXTERNAL`: [local technical review](./social-monitoring-provider-security-review.md) и test evidence готовы; нужны owner/legal approvals по Bright Data secondary use/DPA, subprocessors/transfers/retention и risk acceptance по Nodemailer advisory без fixed release |
| `SM-PR-081` | Нагрузочный и budget test | platform waves | Нет queue starvation; budgets fail closed | `BLOCKED_EXTERNAL`: local 500-candidate/100-run bounded scheduler stress и disabled/unconfigured/daily/monthly/idempotent budget fail-closed tests готовы; production-like load ждёт platform waves |
| `SM-PR-082` | 14-дневный production-like shadow run | `065`,`075`,`080`,`081` | Daily evidence, no hidden fallback/double billing | `BLOCKED_EXTERNAL`: сначала нужны owner corpus/evidence report, security/DPA approval и production-like source authorization; затем статус станет `WAITING_OBSERVATION` |
| `SM-PR-083` | GO/EXTEND/NO-GO review | `082` | Решение принято по platform/capability, а не общей средней | `BLOCKED_EXTERNAL`: owner decision после полного `082` |
| `SM-PR-084` | 30-дневный client pilot | `083=GO` | Реальные темы, отчёты, качество и стоимость подтверждены | `BLOCKED_EXTERNAL`: нужен `083=GO`, клиент pilot scope и разрешённые targets |

## 6. План по неделям

Оценка предполагает минимум двух backend engineers, одного frontend engineer и
частичную доступность QA/data analyst. Внешний blocker останавливает только
зависимый поток, а не весь roadmap.

| Период | Основной результат |
| --- | --- |
| Неделя 1 | Scope revision, coverage contract, provider credentials, control corpus |
| Неделя 2 | Comparison harness, Apify controlled test, Bright Data/Data365 samples |
| Неделя 3 | Provider decision record и frozen normalized contract |
| Недели 4–5 | Data spine, candidate boundary, Bright Data client, fixtures |
| Неделя 6 | Discovery → enrichment pipeline |
| Неделя 7 | Comments/replies/media/metrics |
| Неделя 8 | Deterministic routing, failover, cost ledger |
| Недели 9–10 | Platform rollout waves и UI provenance/funnel |
| Неделя 11 | Gold evaluation, confidence/review queue, reports |
| Неделя 12 | Hardening, privacy review, runbooks, load/budget tests |
| Недели 13–14 | Production-like shadow run |
| Недели 15–18 | 30-дневный client pilot после `GO` |

## 7. Release gates

### Gate 0 — scope ready

- допущения §1.2 утверждены;
- source universe и KPI denominator зафиксированы;
- test corpus доступен;
- provider budgets и credentials готовы.

### Gate 1 — provider selected

- одинаковый POC выполнен для кандидатов;
- стоимость считается на accepted unique;
- ограничения comments/media зафиксированы;
- выбран primary/fallback по capability/platform.

### Gate 2 — pipeline complete

- search snippet не создаёт финальный mention;
- discovery → enrichment → comments/media воспроизводим;
- raw evidence, normalized identity и cost ledger связаны;
- cross-provider duplicates подавлены.

### Gate 3 — quality proven

- обязательные platform/language/content cohorts проходят §3;
- низкоуверенные материалы попадают в review;
- отчёт строится из versioned evaluation set.

### Gate 4 — operationally ready

- circuit breaker, budgets, drift detection и runbooks проверены;
- privacy/provider contracts приняты;
- 14-дневный shadow run завершён решением `GO`.

### Gate 5 — pilot accepted

- 30-дневный pilot подтверждает качество, покрытие и стоимость;
- ограничения источников отражены в клиентском coverage contract;
- production status назначен только capability proofs, прошедшим приёмку.

## 8. Verification matrix для будущих изменений

| Изменение | Минимальная проверка |
| --- | --- |
| Provider client/normalizer | Contract fixtures + malformed payload + auth/rate-limit/timeout tests |
| Route compiler/failover | Deterministic route, true-zero, hard-failure, circuit-breaker, no-double-billing tests |
| Prisma/schema/RLS | Prisma validate/generate, migration procedure, tenant/RLS and backfill tests |
| Comments/media | Pagination, parent/thread identity, deleted/edited, missing asset, SSRF/retention tests |
| Cost ledger | Reservation/reconciliation/idempotency and invoice-unit tests |
| UI | Targeted lint/typecheck + authenticated browser smoke desktop/narrow viewport |
| Reports/messages | Export tests; `npm run i18n:check` when `messages/*.json` change |
| Release | Targeted social suite, `npx tsc --noEmit` where practical, build when required by changed boundary |

Проверка считается пройденной только если выполнена в текущем tree. Невыполненная
проверка записывается как `NOT RUN` с причиной.

## 9. Оставшиеся внешние действия

Локальный foundation завершён. Bright Data остаётся primary route; Apify
разрешён только как проверенный узкий fallback для Instagram replies и не
заменяет Bright Data для discovery/enrichment. Live routing, public replies и
production fan-out выключены. Следующий порядок не требует повторять уже
проверенные target/endpoint:

1. Владелец письменно утверждает допущения §1.2, обязательные платформы и список
   разрешённых внешних источников.
2. Владелец предоставляет реальные AZ/RU/EN monitoring subjects, aliases и
   negative examples; аналитики размечают минимум 50 known-positive URL на
   обязательную платформу, включая video/comment-rich cohorts.
3. Владелец даёт Data365 waiver либо сопоставимый capped evidence pack. Basic
   plan без comparable trial POC не покупать.
4. Для Bright Data предоставить новый known-positive TikTok target с replies и
   pagination, а также отдельный Facebook Reel comments endpoint contract.
   Успешные Instagram/Apify и уже проверенные `dead_page` calls не повторять.
5. Выгрузить Cost Explorer/invoice CSV и связать authoritative billing row с
   provider run. Raw export не коммитить, display rounding не записывать в
   `actualChargeUsd`.
6. Предоставить официальные credentials для YouTube/Telegram/VK canaries,
   known-positive LinkedIn corpus и согласованный global Meta discovery route.
7. Принять DPA, retention, storage и subprocessors для выбранных routes и явно
   разрешить production-like source access.
8. После выполнения пунктов 1–7 запустить 14-дневный provider comparison и
   production-like shadow. Только platform/capability cohorts, прошедшие 90%
   gates и owner `GO`, могут получить отдельное разрешение на production routing.

До выполнения этих действий `SOCIAL_BRIGHT_DATA_LIVE_ROUTING` остаётся
выключенным; низкая уверенность идёт в review, а недоказанный route остаётся
`BLOCKED_EXTERNAL`.
