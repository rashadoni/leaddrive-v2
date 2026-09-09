# Social Monitoring V2 — целевая архитектура и план реализации

Статус: source of truth для следующего этапа Social Monitoring.

Исторический журнал уже реализованных этапов остаётся в
[`docs/social-monitoring-roadmap.md`](./social-monitoring-roadmap.md). Этот документ
описывает целевую архитектуру, ограничения платформ и обязательный порядок
последующей реализации.

Актуальный исполнимый backlog для разделения official APIs, licensed providers,
Bright Data candidates и Apify fallback находится в
[`social-monitoring-provider-routing-roadmap.md`](./social-monitoring-provider-routing-roadmap.md).

## 1. Цель

Построить multi-tenant контур мониторинга, который:

- отслеживает компании, личности, бренды, продукты, темы, хештеги и ключевые слова;
- собирает публикации, упоминания, комментарии и ответы только разрешёнными для
  конкретной платформы способами;
- отбрасывает нерелевантные наблюдения до постоянного хранения;
- обнаруживает текстовые, визуальные и речевые упоминания;
- создаёт отдельные кандидаты для репутационной, юридической и security-проверки;
- поручает настроенному для объекта ИИ-агенту готовить ответы;
- публикует ответ только после явного утверждения и повторной fail-closed проверки;
- показывает реальное покрытие каждого источника, а не обещает мониторинг «всего
  интернета».

## 2. Неподлежащие ослаблению правила

1. Официальный API имеет приоритет над скрейпингом.
2. Подключённый владельцем аккаунт имеет приоритет над внешним сбором.
3. Лицензированный поставщик данных имеет приоритет над Apify.
4. Apify является маркированным `best_effort` fallback, а не способом обойти API,
   авторизацию или Terms of Service.
5. Если законного и технически стабильного пути нет, продукт показывает пробел
   покрытия и не имитирует успешный сбор.
6. Нерелевантный контент не хранится постоянно и не попадает в память ИИ-агента.
7. ИИ не выносит юридический вердикт: он создаёт кандидата с объяснением и
   уверенностью, решение принимает человек.
8. ИИ-ответ всегда сначала является черновиком.
9. Ни один UI route не отправляет социальный ответ напрямую: отправка проходит
   только через durable outbox.
10. Внешняя отправка остаётся выключенной, пока последний этап плана не внедрён и
    отдельно не активирован для tenant и платформы.

## 3. Текущее состояние и ключевые разрывы

В существующей системе уже есть `SocialMention`, `MonitoringSource`,
`CollectorRun`, evidence/cluster-модели, сценарии, AI drafts, ручные юридические
кейсы и Apify/search-index pass для внешних источников. Недавний ingest приводит
webhook и poller к общему пути, сохраняет `sourceType`, не использует URL публикации
как уникальность комментария и умеет включать комментарии по сценарию.

Перед расширением необходимо закрыть следующие разрывы:

- объект мониторинга пока представлен главным образом строками и ключевыми словами;
- нет временного ingest-буфера и раннего relevance gate;
- нет системной политики purge для raw payload, медиа, OCR, embeddings и provider
  datasets;
- у комментария недостаточно типизированы post/thread/parent/reply/version связи;
- эвристика `text + author + day` может ошибочно склеить разные сообщения;
- юридический кейс рассчитан на ручное действие и фактически одно упоминание;
- runtime не использует единую сохранённую reply policy во всех путях;
- AI-draft route содержит прямой `send_live` путь и не должен оставаться отдельной
  границей отправки;
- нет outbox, compare-and-set переходов, idempotency и reconciliation отправки;
- отчётность ограничивается выборкой упоминаний в память вместо SQL-агрегаций;
- multimedia pipeline не связан с Social Monitoring;
- collector scheduler нуждается в атомарном lease/claim;
- tenant coherence дочерних связей должна обеспечиваться составными ключами, а не
  только проверками приложения.

## 4. Модель покрытия платформ

### 4.1 Источники данных по приоритету

Каждый результат получает `acquisitionMode`:

```text
OFFICIAL_API
CONNECTED_ACCOUNT
LICENSED_PROVIDER
APIFY_FALLBACK
MANUAL_URL
```

При наличии более приоритетного рабочего способа нижестоящий способ не запускается.
Один и тот же результат, найденный несколькими способами, объединяется в одно
упоминание с несколькими evidence records.

### 4.2 Честная матрица чужих комментариев

| Платформа | Чужие публичные комментарии без Apify | Основной путь | Ограничение |
| --- | --- | --- | --- |
| YouTube | Да | YouTube Data API `commentThreads.list` + `comments.list` | Нужен известный или найденный `videoId`; отключённые/закрытые комментарии недоступны; соблюдать quota и YouTube policies |
| VK | Да, для доступных объектов | Официальный `wall.getComments` | Зависит от токена, прав, региона, приватности и текущих правил VK |
| X | Да, платно | Официальный X API или лицензированный firehose/provider | Бесплатного стабильного и допустимого эквивалента нет |
| Telegram | Только подключённые обсуждения | Bot API или разрешённый Telegram API-клиент в доступной группе/discussion | Глобального Bot API-поиска комментариев по Telegram нет; не агрегировать недоступные чаты |
| Facebook | Ограниченно | Подключённые Pages; отдельно одобренные Meta capabilities | Нет универсального доступа ко всем чужим Page comments |
| Instagram | В основном только owned/connected | Instagram Graph API для подключённого professional account | Business Discovery даёт чужие professional posts/метрики, но не универсальный доступ к телам их комментариев |
| TikTok | Для коммерческой CRM общего API нет | Connected account capabilities; лицензированный provider; разрешённый fallback | Research API содержит comments, но рассчитан на квалифицированные некоммерческие исследования |

Чтение и ответ являются разными capabilities. То, что licensed provider или
Apify вернул текст и ID чужого комментария, не означает, что этот ID можно передать
официальному publishing API. Поэтому отдельно вычисляется `engagementMode`:

```text
API_REPLY       — CRM может ответить от выбранного подключённого профиля
PROVIDER_REPLY  — CRM отправляет через одобренного engagement-партнёра платформы
OPEN_NATIVE     — CRM открывает точный permalink в приложении/браузере
COPY_DRAFT      — CRM даёт утверждённый текст для ручной вставки
NO_ACTION       — ответ запрещён policy или технически невозможен
```

### 4.2.1 Матрица ответа от страниц клиента

| Платформа и расположение комментария | Ответ из CRM | Какая identity отвечает |
| --- | --- | --- |
| Instagram, комментарий под media подключённого professional account | `API_REPLY` после approval | Подключённый Instagram professional account |
| Instagram, комментарий под чужим media | `PROVIDER_REPLY` для подтверждённых tagged/branded/@mention capabilities, иначе `OPEN_NATIVE` + `COPY_DRAFT` | Подключённый professional account через approved provider либо ручной ответ |
| Facebook, комментарий под post подключённой Page | `API_REPLY` после approval | Подключённая Facebook Page |
| Facebook, комментарий под чужим post/Page | `PROVIDER_REPLY`, если enterprise provider доказал read+reply для конкретного типа объекта, иначе `OPEN_NATIVE` + `COPY_DRAFT` | Подключённая Page через provider либо ручной ответ |
| TikTok, комментарий под organic video подключённого Business Account | `API_REPLY` после approval и получения Business Comment scopes | Подключённый TikTok Business Account |
| TikTok, fan post/comment с явным @mention бренда | `PROVIDER_REPLY` через подтверждённую TikTok partner capability | Подключённый TikTok Business Account через provider |
| TikTok, произвольный чужой video/comment без qualifying mention | `OPEN_NATIVE` + `COPY_DRAFT`, пока provider не докажет capability | Ручной ответ из TikTok; Research/scraping ID не превращается в publishing permission |
| YouTube, комментарий под своим или чужим публичным video | `API_REPLY`, если thread сообщает `canReply` | Подключённый OAuth YouTube channel; UI обязан показать channel attribution |
| X, Post/reply явно упоминает или цитирует брендовый account | `API_REPLY` при подходящем тарифе и user OAuth | Подключённый X account; self-serve ограничения перепроверяются перед send |
| X, найден только текст бренда без разрешённого reply context | Обычно `OPEN_NATIVE` + `COPY_DRAFT` | Ручная публикация либо отдельный approved/enterprise capability |
| Telegram discussion, sender присутствует и имеет право писать | `API_REPLY` | Подключённый bot/account; пользователю заранее показывается, от чьего имени уйдёт сообщение |
| VK, доступный post/thread и токен разрешает comment create | `API_REPLY` после capability probe | Подключённое сообщество или user identity согласно токену |

Meta официально поддерживает чтение и ответы на комментарии у media, принадлежащих
app user's professional account. TikTok Business API аналогично ограничивает
organic comment management видео подключённого owned business account. Однако
enterprise-партнёры могут получать дополнительные platform-approved capabilities.
Например, актуальная документация Sprinklr описывает ingest полной TikTok-ветки,
если бренд @упомянут в fan post или comment, и reply для mentioned comments.
Для Instagram партнёр описывает отдельные capabilities для public comment mentions,
tagged posts и branded content. Эти возможности включаются только после contract и
sandbox proof для tenant: название функции в маркетинговом материале недостаточно.
Если партнёрский capability отсутствует, безопасный fallback — не скрытая browser
automation, а утверждённый draft, точный permalink и ручное действие.

Оператор всегда видит до approval:

- страницу/профиль, от имени которого будет ответ;
- расположение комментария: owned или external;
- `engagementMode` и причину ограничения;
- исходный текст, parent post и thread context;
- предупреждение, если ответ будет ручным и CRM не сможет подтвердить публикацию.

Официальные точки проверки:

- YouTube comments: <https://developers.google.com/youtube/v3/docs/commentThreads/list>
- YouTube replies: <https://developers.google.com/youtube/v3/docs/comments/list>
- X search: <https://docs.x.com/x-api/posts/search/introduction>
- Telegram discussions: <https://core.telegram.org/api/discussion>
- Meta Business Discovery: <https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/business-discovery>
- Instagram owned comment moderation: <https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api>
- TikTok Research API scope: <https://developers.tiktok.com/doc/research-api-codebook/>
- TikTok Business API: <https://business-api.tiktok.com/gateway/docs/index>
- Sprinklr TikTok fan-post conversation coverage: <https://www.sprinklr.com/help/articles/mentions-on-tiktok/retrieve-comments-and-replies-from-tiktok-fan-posts-with-brand-mentions/6a43b66c0748377e13343da6>
- Sprinklr TikTok engagement capabilities: <https://www.sprinklr.com/help/articles/engage-with-tiktok-accounts/engaging-with-tiktok-accounts/68317e212a447159f7a7078d>
- Sprinklr Instagram capabilities: <https://www.sprinklr.com/help/articles/getting-started-instagram/instagram-capabilities-and-limitations/63ec6a94f6e2cc7d18fa2297>
- YouTube comment insert: <https://developers.google.com/youtube/v3/docs/comments/insert>
- X create/reply Post: <https://docs.x.com/x-api/posts/manage-tweets/introduction>
- VK comments: <https://dev.vk.com/ru/method/wall.getComments>

Capability matrix должна перепроверяться при изменении версии API, scope или
договора с поставщиком. Наличие технического endpoint не означает автоматически
разрешённое коммерческое хранение или AI processing.

### 4.3 Лицензированные data и engagement providers

Для широкого внешнего покрытия допускается отдельный adapter к Brandwatch,
Meltwater, Talkwalker или другому поставщику только после договорной проверки:

- какие платформы и типы контента входят в конкретный тариф;
- доступны ли полные тексты комментариев или только метрики/ссылки;
- разрешён ли экспорт в CRM и последующая AI-классификация;
- срок хранения, требования удаления и атрибуции;
- историческая глубина и latency;
- географические ограничения;
- цена одного нового уникального принятого результата.

Для ответа на внешние комментарии отдельно рассматриваются engagement providers,
например Sprinklr или другой официальный/одобренный партнёр платформы. LeadDrive
не считает наличие provider UI достаточным. Для `PROVIDER_REPLY` требуется:

- договорное право клиента использовать capability;
- подключённая identity клиента, а не общий аккаунт LeadDrive/provider;
- API/webhook или другой поддерживаемый machine-to-machine contract;
- точный список объектов: owned, tagged, branded, @mentioned, ads, public fan post;
- подтверждение attribution: от какого профиля опубликован ответ;
- sandbox send и read-back external ID;
- idempotency или поддерживаемая provider reconciliation;
- rate limits, retention, audit и incident contacts;
- дата последней проверки capability и автоматическое истечение proof.

Если поставщик умеет действие только внутри своего UI и не предоставляет
интеграционный контракт, LeadDrive создаёт переход в provider workspace или manual
task, но не показывает отправку из CRM.

Маркетинговое заявление поставщика о «покрытии платформы» не считается контрактом
на получение каждого комментария. Capability включается только после sandbox
проверки реального payload.

### 4.4 Apify как fallback

Apify допускается для разрешённых публичных источников, где нет достаточного
официального или лицензированного канала. Для X, YouTube и VK он не должен заменять
доступный официальный API. Для Instagram/TikTok/Facebook external он может дать
дополнительное покрытие, но только после правовой проверки конкретного actor и
целевого контента.

Обязательная реализация:

- асинхронный actor run вместо ожидания в HTTP request;
- сохранение `actorId`, version/build, run ID и dataset ID;
- schema pin и contract tests на sample payload;
- webhook import с idempotency key;
- `maxTotalChargeUsd`, `maxItems`, timeout и tenant/day/month budget;
- circuit breaker после серии provider/schema/auth failures;
- adaptive polling и backoff;
- partial result semantics вместо ложного `success`;
- импорт, reconciliation и удаление provider dataset;
- запрет передачи cookies, session tokens и CRM credentials community actors;
- метрика `cost / new unique relevant accepted mention`;
- UI-метка `APIFY_FALLBACK`, freshness и последнее полное/частичное выполнение.

### 4.5 Discovery публикаций и extraction комментариев — разные этапы

Существующие scrapers действительно извлекают публичные comments/replies, но чаще
всего требуют URL/ID публикации или профиль как вход. Они не создают полного
глобального индекса всех комментариев Facebook, Instagram или TikTok. Поэтому
формулировка «поиск чужих комментариев» реализуется двухэтапным pipeline:

```text
DISCOVER_CANDIDATE_POSTS
→ rank candidate posts/videos
→ EXTRACT_COMMENTS_FROM_CANDIDATES
→ filter comment text by subject aliases/context
→ accept / review / reject
```

Практическое покрытие:

- Instagram: найти posts/reels через profile, tagged mentions, hashtags, captions,
  known URLs и provider results; затем передать URL в maintained Instagram Comments
  Scraper. Сам Instagram search не ищет произвольное слово внутри всех comments.
- TikTok: найти videos через accounts, @mentions, hashtags, keyword/video search и
  provider feed; затем передать video URLs/IDs в TikTok Comments Scraper и забрать
  replies.
- Facebook: получить posts из monitored public Pages, search/provider/manual URLs;
  затем передать post URLs в Facebook Comments Scraper. Глобальная полнота public
  Facebook comments не гарантируется.

Подтверждённые на момент проектирования примеры:

- Apify-maintained Instagram Comments Scraper принимает public post/reel URLs и
  возвращает comment/reply IDs, text, authors и timestamps:
  <https://apify.com/apify/instagram-comment-scraper>
- Apify-maintained Facebook Comments Scraper принимает public post URLs, получает
  public comments и до трёх уровней replies, но результат может быть меньше счётчика
  Facebook из-за privacy/ranking/visibility:
  <https://apify.com/apify/facebook-comments-scraper>
- Clockworks TikTok Comments Scraper принимает video URLs и поддерживает search,
  profiles и hashtags как способы получить видео-кандидаты:
  <https://apify.com/clockworks/tiktok-comments-scraper>

Это техническое подтверждение способности extraction, а не юридическая гарантия.
Перед включением проверяются ToS, lawful basis, geography, PII handling и contract.
Community actors не активируются как production primary без отдельного reliability
test; предпочтение отдаётся maintained actor или договорному provider.

Для контроля честности coverage сохраняются:

- число обнаруженных candidate posts;
- причина попадания каждого post в кандидаты;
- сколько candidate posts реально просканировано;
- comments/replies requested и returned;
- pagination completeness и configured caps;
- privacy/rate-limit/blocked failures;
- доля comments, совпавших с subject;
- estimated coverage class: `COMPLETE_FOR_INPUT`, `PARTIAL`, `SAMPLED`, `BLOCKED`.

Надпись `READ_EXTERNAL_COMMENTS` в routing plan означает «извлечь comments из
известного набора candidate posts», а не «гарантированно найти каждый комментарий
на всей платформе».

## 5. Capability policy

Политика задаётся конфигурацией adapter, а не разбросанными `if` по collectors:

```ts
type SourcePolicy = {
  discovery: "none" | "known_url" | "owned" | "connected" | "public_api" | "approved";
  commentsRead: "none" | "owned" | "public" | "research_only";
  reply: "none" | "native_manual" | "api_after_approval" | "provider_after_approval" | "approved_automation";
  mediaBytes: "none" | "transient" | "owned_original";
  aiInput: "denied" | "explicit_consent" | "approved_use_case";
  evidencePreservation: "denied" | "transient" | "approved";
  report: "denied" | "operational" | "approved_analytics";
  retentionDays: number | null;
  attributionRequired: boolean;
  approvalRequired: boolean;
};
```

Эффективная policy вычисляется из platform policy, provider contract, tenant
configuration и конкретного connection. Всегда побеждает наиболее строгое
ограничение.

### 5.1 Предварительно скомпилированный routing plan

Выбор collector/publisher не выполняется заново для каждого запроса и не поручается
ИИ. При подключении платформы, provider subscription, изменении scenario или
обновлении capability registry backend компилирует tenant-specific
`SourceRoutePlan`.

Ключ маршрута:

```text
organizationId
+ monitoringSubject/scenario
+ platform
+ capability: DISCOVER_POSTS | READ_OWNED_COMMENTS | READ_EXTERNAL_COMMENTS |
               READ_THREAD | REPLY_OWNED | REPLY_EXTERNAL | READ_MEDIA
+ contentScope: OWNED | TAGGED | BRANDED | MENTIONED | PUBLIC | AD
```

Маршрут хранит:

- `primaryAdapter`;
- упорядоченные `fallbackAdapters`;
- подтверждённый `capabilityProofId` и срок его действия;
- допустимый content scope;
- connection/sender identity;
- budget, rate limit и freshness target;
- failover conditions;
- reply mode;
- policy/contract version;
- причину выбора и время последней компиляции.

Пример предварительной конфигурации:

```text
Instagram READ_OWNED_COMMENTS     → META_GRAPH
Instagram READ_EXTERNAL_COMMENTS  → SPRINKLR (TAGGED/BRANDED/MENTIONED)
Instagram candidate post comments  → APIFY_FALLBACK only if approved, read-only
Instagram REPLY_OWNED             → META_GRAPH
Instagram REPLY_EXTERNAL          → SPRINKLR when provider proof matches scope,
                                    otherwise MANUAL

Facebook READ_OWNED_COMMENTS      → META_GRAPH
Facebook candidate post comments → licensed provider when contract-tested,
                                    otherwise approved APIFY_FALLBACK/read-only
Facebook REPLY_EXTERNAL           → provider when proof matches exact object type,
                                    otherwise MANUAL

TikTok READ_OWNED_COMMENTS        → TIKTOK_BUSINESS
TikTok READ_EXTERNAL_COMMENTS     → SPRINKLR for qualifying @mentions
TikTok candidate video comments    → approved APIFY_FALLBACK/read-only
TikTok REPLY_EXTERNAL             → SPRINKLR for qualifying @mentions,
                                    otherwise MANUAL
```

Таким образом, если прямой API не поддерживает external comments, но tenant
подключил проверенного provider, provider автоматически становится primary для
этой capability. На каждом cron/webhook/search run orchestrator читает готовый
план и запускает adapter; LLM не принимает инфраструктурное решение.

Routing plan пересобирается только при событии:

- подключение/отключение account или provider;
- изменение тарифа, scopes или договора;
- появление/истечение capability proof;
- изменение source policy или scenario;
- ручное действие администратора;
- platform/provider incident, требующий управляемого failover.

Временная ошибка не меняет маршрут навсегда. Circuit breaker использует заранее
разрешённый fallback. Если fallback не определён, run получает `DEGRADED`/`BLOCKED`,
а не выбирает произвольный scraper. После восстановления primary автоматически
возвращается согласно сохранённой failback policy.

Перед активацией сценария UI показывает итоговую карту: что собирается напрямую,
что через provider, что через Apify read-only, где доступен reply и где останется
manual task. Администратор подтверждает provider расходы и scopes один раз.

## 6. Объекты мониторинга вместо набора строк

Добавить:

- `MonitoringSubject` — `COMPANY`, `PERSON`, `BRAND`, `PRODUCT`, `ORGANIZATION`,
  `TOPIC`, `EVENT`;
- `MonitoringSubjectAlias` — имя, транслитерация, склонение, handle, hashtag,
  domain, typo и negative alias;
- `MonitoringSubjectRelation` — бренд компании, должность личности, продукт бренда,
  конкурент, представитель;
- `MonitoringSubjectSource` — конкретные accounts/pages/channels/domains;
- `SocialReplyIdentity` — разрешённая для subject platform connection/page/profile,
  приоритет, язык, signature и допустимые owned/external reply modes;
- `MonitoringVisualReference` — одобренный логотип, упаковка или иной визуальный
  эталон с правами использования.

У объекта также хранятся языки, география, обязательный контекст, exclusions,
чувствительные категории, assigned AI agent и reply/legal policies.

Короткое или неоднозначное имя не принимается по одному совпадению. Требуется
дополнительный сигнал: handle, организация, должность, связанный продукт, домен,
контекстное слово или визуальный reference.

## 7. Ingest и ранняя релевантность

Все collectors сначала записывают нормализованный `IngestEnvelope` в временное
хранилище. Он содержит organization, adapter, provider item ID, acquisition mode,
content kind, external IDs, timestamps, URL, author, text, минимальный raw payload,
policy snapshot и `purgeAt`.

Pipeline:

```text
discover/fetch
→ normalize envelope
→ cheap exact rules
→ subject/context match
→ lightweight classifier только для неоднозначных результатов
→ accept / review / reject
→ ingest accepted SocialMention
→ purge envelope
```

Для rejected observation постоянно не сохраняются текст, username, URL, изображение
или embedding. Разрешается короткоживущий HMAC fingerprint, чтобы не оплачивать
повторную обработку идентичного provider item.

Состояния relevance:

- `ACCEPTED` — есть достаточное соответствие объекту;
- `REVIEW` — неоднозначное совпадение ожидает проверки;
- `REJECTED` — не соответствует запросу;
- `POLICY_DENIED` — обработка запрещена source policy;
- `DELETED_AT_SOURCE` — источник сообщил удаление.

## 8. Retention и удаление

Начальные defaults, которые tenant может только ужесточить, если платформа требует
меньший срок:

| Данные | Default |
| --- | --- |
| Provider transit и raw envelope | 24 часа |
| Ошибочный импорт | до 72 часов |
| Неоднозначный review result | 7 дней |
| Rejected HMAC metadata | 14 дней |
| QA sample | 7–14 дней, по умолчанию выключен |
| Accepted raw payload | 30 дней |
| Нормализованное operational mention | 180 дней, настраиваемо |
| Accepted media bytes | 30–90 дней по policy |
| Legal candidate без подтверждения | 30 дней |
| Legal evidence под hold | до audited release, но platform policy имеет приоритет |
| Агрегированная аналитика без исходного контента | 24 месяца |

Deletion workflow удаляет или ставит tombstone для DB rows, evidence, media,
thumbnails, OCR, transcripts, embeddings, AI traces, drafts, cache и provider
datasets. Отдельный ledger гарантирует повторное удаление после восстановления
backup. Legal hold не даёт бессрочного права нарушить обязательный platform deletion.

## 9. Каноническая модель публикаций и комментариев

Расширить `SocialMention`:

- `contentKind`: `POST`, `MENTION`, `COMMENT`, `REPLY`, `REVIEW`;
- `postExternalId`;
- `parentExternalId`;
- `threadExternalId`;
- `replyToExternalId`;
- `depth`;
- `canonicalUrl`;
- `parentPostUrl`;
- `contentVersion`;
- `publishedAt`, `editedAt`, `deletedAtSource`;
- `acquisitionMode`, `policySnapshotId`;
- `retentionClass`, `purgeAt`.

Добавить `SocialMentionVersion`, чтобы edit не создавал независимое упоминание и
юридическое evidence сохраняло историю.

## 10. Дедупликация и кластеризация

Порядок:

1. `organizationId + platform + stable externalId` — строгая идентичность.
2. Platform-specific canonical comment URL — строгая идентичность только когда URL
   действительно указывает на комментарий.
3. URL родительской публикации не участвует в уникальности комментария.
4. Provider item ID хранится как evidence identity, а не всегда как content identity.
5. `normalized text + author + day`, similarity и cross-source совпадения создают
   `MentionCluster`, но не hard-merge.

Это сохраняет несколько одинаковых комментариев одного автора и одновременно
показывает оператору возможные копии или координированную кампанию.

## 11. Мультимедийное обнаружение

Google Images или иной web/image search используется только как вторичный,
преимущественно human-triggered discovery lead. Основной discovery идёт через
разрешённые platform adapters, monitored accounts, hashtags, topics и known URLs.

Каскад обработки:

1. Метаданные, caption, author, hashtags, URL и доступные комментарии — 100%.
2. OCR разрешённой thumbnail/cover — 100% кандидатов с доступным изображением.
3. 6–8 репрезентативных кадров — ориентировочно 5% кандидатов.
4. ASR или platform-provided transcript — ориентировочно 1% кандидатов.
5. Полный multimodal анализ — 0,1–0,5%, только при высоком ожидаемом value.

Добавить `MediaObservation` и `MediaSignal` с типами `COVER_OCR`, `FRAME_OCR`,
`ASR`, `PLATFORM_CAPTION`, `LOGO_MATCH`, `MANUAL_NOTE`. Сигнал хранит временной
интервал/кадр, confidence, provider, model version, language и policy/retention.

Face recognition по умолчанию запрещён. Для личностей используются имя, речь,
контекст, verified accounts и ручные visual references; биометрическое сопоставление
требует отдельной правовой и продуктовой процедуры.

### 11.1 Бюджетный ориентир

При текущих публичных тарифах Google ориентир выглядит так:

| Уникальные видео | Только cover OCR | Рекомендуемый каскад | Наивный полный video OCR, 1 мин/видео |
| ---: | ---: | ---: | ---: |
| 10 000 | около $13.50 | около $19.80 | около $1 350 |
| 100 000 | около $148.50 | около $211.50 | около $14 850 |
| 1 000 000 | около $1 498.50 | около $2 128.50 | около $149 850 |

В оценку не входят acquisition/provider fees, storage, CPU/GPU, egress и LLM.
Тарифы перепроверяются перед реализацией:

- <https://cloud.google.com/vision/pricing>
- <https://cloud.google.com/video-intelligence/pricing>
- <https://cloud.google.com/speech-to-text/pricing>

## 12. ИИ-агент объекта мониторинга

Каждый `MonitoringSubject` может ссылаться на настроенного social-monitoring агента.
При генерации черновика сохраняется immutable `AgentRunSnapshot`:

- subject и aliases version;
- agent ID и configuration version;
- фактически использованные model, temperature и prompt hash;
- knowledge base document IDs/versions;
- reply policy version;
- source policy snapshot;
- mention, thread и content version;
- retrieved facts с provenance;
- language, tone и risk classification;
- output, confidence и blocked/escalation reasons.

В долговременную память агента допускаются только:

- утверждённые профили объектов и факты;
- aliases и exclusions;
- утверждённые playbooks;
- человеческие исправления, явно помеченные как reusable;
- опубликованные или утверждённые ответы и результат их обработки.

Запрещено обучать память на rejected raw feed, неподтверждённых обвинениях,
удалённом контенте, лишних PII или embeddings, срок хранения которых закончился.

## 13. Полуавтоматические ответы

ИИ создаёт `DRAFT` и может предложить:

- текст ответа;
- язык и тон;
- краткое объяснение;
- использованные факты;
- риск и причину обязательного согласования;
- вариант «не отвечать»;
- эскалацию в PR, support, security или legal.

Agent не владеет токеном и не выбирает произвольный профиль. Он получает список
разрешённых `SocialReplyIdentity` для объекта и предлагает identity. Backend
повторно проверяет связь subject → tenant connection → platform account. Если
`engagementMode = API_REPLY` или `PROVIDER_REPLY`, approved draft поступает в
outbox с direct или provider publisher adapter. Если доступен только
`OPEN_NATIVE`/`COPY_DRAFT`, создаётся `ManualEngagementTask` с permalink, approved
text и ожидаемой identity; сотрудник публикует его нативно и вручную подтверждает
результат. При возможности collector позднее сопоставляет найденный ответ по
external ID/author/text, но отсутствие read-back не считается отправкой.

Автоматизация браузера с пользовательскими cookies не используется как скрытая
замена отсутствующему publishing API: она ненадёжна, создаёт риск блокировки
аккаунта и нарушает границу хранения credentials.

Автопубликация запрещена для legal candidates, threats, doxxing, minors, medical,
financial, political, regulatory, personal-data и low-confidence cases. На первом
релизе все категории требуют человеческого утверждения.

## 14. Outbound outbox и безопасность

Добавить `OutboundSocialReply` со state machine:

```text
PENDING
→ APPROVED
→ QUEUED
→ SENDING
→ SENT
  | FAILED
  | CANCELED
  | RECONCILIATION_REQUIRED
```

Только один service может ставить reply в outbox. Только отдельный worker вызывает
direct platform publisher или подтверждённый engagement-provider adapter. Provider
не обходит те же approval, idempotency, audit и kill-switch проверки. Переходы
выполняются compare-and-set и защищаются lease.

Перед вызовом platform API worker повторно проверяет:

- global environment kill switch;
- tenant live-send flag;
- platform и connection live-send flag;
- current source/reply policy, а не snapshot времени создания draft;
- ownership/capability и sender identity;
- approver role и approval timestamp;
- immutable approved text hash;
- отсутствие legal hold или обязательной эскалации;
- существование target post/comment/thread;
- rate limit, tenant budget и quiet hours;
- idempotency key и отсутствие уже подтверждённой отправки;
- свежесть access token;
- content version: если исходный комментарий изменён, approval инвалидируется.

Timeout после provider request не считается автоматическим `FAILED`: сначала
выполняется reconciliation, чтобы retry не опубликовал дубль.

Текущий отдельный `send_live` путь из AI drafts должен быть закрыт в первом PR и
перенаправлен на единый, изначально выключенный enqueue boundary.

## 15. Юридические и репутационные кандидаты

Добавить `SocialLegalCandidate`; ИИ-классификация не создаёт финальный кейс.
Поддерживаемые категории:

- possible insult/harassment;
- potentially false factual statement/defamation;
- unsupported accusation;
- credible threat;
- doxxing/stalking;
- impersonation;
- phishing/scam;
- counterfeit;
- trademark/copyright;
- confidential leak;
- regulatory/customer complaint;
- coordinated attack.

Candidate states:

```text
DETECTED → TRIAGE_PENDING
→ CONFIRMED | DISMISSED | MONITOR | NEEDS_MORE_EVIDENCE | INVALIDATED
→ ATTACHED_TO_CASE | NEW_CASE
```

Case states:

```text
DRAFT → OPEN → INVESTIGATING → ACTION_APPROVAL_REQUIRED
→ RESOLVED → CLOSED → REOPENED
```

Legal hold является отдельным флагом/объектом, а не состоянием case.

Один кейс содержит множество evidence items. Добавить:

- `SocialLegalCaseEvidence`;
- `SocialLegalCaseEvent`;
- `SocialLegalActionDraft`;
- `SocialLegalApproval`.

Раздел «Юр. кейсы» получает четыре режима:

- `Кандидаты` — новые сигналы для triage;
- `Кейсы` — подтверждённые расследования;
- `Отчёты` — evidence package и хронология;
- `Правила` — категории, thresholds, маршрутизация и retention.

Формулировка ИИ должна быть вероятностной: «потенциально ложное фактическое
утверждение», а не «это клевета». Подтверждение юристом обязательно.

## 16. Отчёты и аналитика

Отчёты строятся SQL-агрегациями, а не загрузкой ограниченного набора упоминаний в
Node.js. Обязательные dimensions:

- subject;
- content kind: post/mention/comment/reply/review;
- platform;
- acquisition mode и provider;
- owned/external;
- language;
- sentiment, risk и legal category;
- source coverage state;
- день, неделя, месяц.

Комментарий является отдельным разрезом, но сохраняет связь с родительской
публикацией и thread. Legal reports используют фактический `publishedAt/occurredAt`,
а не `case.createdAt`.

Coverage report показывает:

- configured/eligible/active/degraded/blocked source counts;
- last successful and last complete collection;
- expected и фактическую глубину истории;
- read-comments и reply capability;
- official/connected/licensed/fallback mode;
- rate/quota/budget exhaustion;
- долю rejected, review и accepted результатов;
- стоимость одного нового релевантного упоминания.

## 17. Multi-tenant и RLS

Все новые таблицы содержат `organizationId` и покрываются fail-closed RLS.
Дочерние связи используют составные unique/FK вида
`(organizationId, parentId)`, чтобы невозможно было связать evidence, candidate,
case, draft или outbound reply с объектом другой организации даже при ошибке
application code.

Webhook routing для общего внешнего page/account ID должен поддерживать явный
fan-out всем разрешённым tenant connections вместо `findFirst`. Telegram cursor
принадлежит connection, а не tenant-wide collector. Collector run получает
атомарный claim/lease и fencing token.

## 18. Наблюдаемость и эксплуатация

Метрики:

- fetched, normalized, policy-denied, rejected, review и accepted items;
- external ID collision и cluster rate;
- collector latency, freshness, pagination completeness и cursor lag;
- provider/API errors по типу;
- Apify/provider spend, budget blocks и cost/accepted unique;
- OCR/ASR funnel и стоимость на ступень;
- AI draft latency, acceptance/edit/rejection/escalation rates;
- outbox queue age, send attempts, duplicates prevented и reconciliation count;
- purge backlog и deletion failures.

Alerts создаются на истёкший collector lease, coverage degradation, schema drift,
budget exhaustion, purge SLA violation и любой live-send policy mismatch.

## 19. Порядок реализации

Последовательность обязательна. Следующий PR начинается после миграций, targeted
tests и path-scoped commit предыдущего.

### PR 1 — Safety и каноническая identity

- закрыть прямой `send_live` из AI drafts;
- создать единый disabled enqueue boundary;
- добавить content/post/thread/parent/reply/version поля;
- сохранить регрессионный тест: parent post URL не дедуплицирует comments;
- заменить hard fuzzy merge на clustering;
- добавить tenant-coherent composite relations для затронутых моделей;
- добавить collector lease/claim;
- покрыть повторную доставку webhook/poller и create race.

#### Фактический статус PR 1 — VERIFIED (2026-07-11)

IMPLEMENTED:

- прямые publisher-вызовы удалены из manual reply и AI draft routes; legacy
  `send_live` отклоняется, а единственный enqueue boundary остаётся fail-closed;
- `SocialMention` получил canonical content/thread/comment identity, immutable
  `SocialMentionVersion` и явное разделение comment permalink/parent post URL;
- URL родительского поста не дедуплицирует comments, а явно подтверждённый
  comment permalink может участвовать в URL-tier; text+author+day создаёт только
  cluster;
- затронутые tenant relations переведены на composite organization FK;
- collector получил атомарный claim, expiry lease и fencing version; потерявший
  claim worker не может записать source health;
- live-send остаётся выключенным и после миграции не активируется.

VERIFIED:

- Prisma schema `validate` и `generate`;
- migration replay на PostgreSQL 16 + pgvector от схемы до PR1, затем
  `migrate diff`: `No difference detected`;
- populated backfill: version 1, canonical comment fields, legacy collector
  fencing и очистка cross-tenant optional link подтверждены SQL-проверкой;
- `npm run typecheck:social`;
- targeted ESLint для изменённых routes, UI, libraries и tests;
- social/monitoring regression suite: 47 файлов, 260 тестов;
- `git diff --check`.

Известные repo-level gaps, существовавшие до PR1:

- общий `npm run typecheck` включает около 3 700 root-файлов и завершился OOM
  при лимитах Node 4 и 6 ГБ; для PR1–PR6 добавлен воспроизводимый модульный
  `typecheck:social`, общий memory gap не маскируется как PASS;
- чистый replay всех исторических migrations останавливается до PR1 на
  `20260406200000_phase4_enterprise_features`, потому что она обращается к ещё
  не созданной `ai_interaction_logs`; SQL PR1 поэтому отдельно проверен против
  актуальной схемы непосредственно перед PR1 и на populated baseline.

### PR 2 — Observation buffer и collectors

- добавить `IngestEnvelope` и `RejectedObservationFingerprint`;
- провести все collectors через normalize/relevance boundary;
- добавить purge jobs и deletion ledger foundation;
- официальная YouTube pagination: threads и полный replies pass;
- официальный VK comments adapter при подтверждённых scopes;
- Meta owned comments и webhook fan-out;
- Telegram discussion collection и connection-level cursor;
- X official/licensed adapter boundary без scraper fallback;
- licensed data-provider и engagement-provider adapter contracts;
- добавить versioned `ProviderCapabilityProof`, `SourceRoutePlan` и deterministic
  route compiler;
- компилировать default provider routes при настройке tenant и исполнять их без
  LLM/provider selection на каждом run;
- Apify async orchestration, budgets, schema pin и degraded status;
- показать acquisition mode и coverage в Sources UI.

#### Фактический статус PR 2 — VERIFIED (2026-07-11)

IMPLEMENTED:

- добавлены tenant-scoped `IngestEnvelope`, rejected HMAC fingerprint,
  provider capability proof, persisted source route plan, provider run, deletion
  ledger и connection cursor; все связи с tenant-owned parents используют
  composite organization FK;
- единая observation boundary создаёт rejected/policy-denied строки уже без text,
  author, URL и raw payload; sentiment/AI enrichment запускается только после
  `ACCEPTED`, а transient raw очищается retention job;
- deterministic compiler выбирает official/connected, затем verified licensed
  provider, затем approved read-only Apify fallback и в конце manual; X scraper
  запрещён, одинаковые физические маршруты нескольких scenarios выполняются один
  раз;
- реализованы полная pagination YouTube threads/replies, VK top-level/reply thread,
  Telegram delivered discussions с connection cursor, X recent-search boundary,
  Meta webhook fan-out и TikTok Business API v1.3 comments/replies;
- TikTok Display API и TikTok Accounts/Business API разведены: Business OAuth
  использует отдельный purpose-encrypted token и refresh flow, проверяет
  `video.list`/`comment.list`, создаёт DRAFT proof и остаётся blocked до явного
  подтверждения capability;
- старый synchronous Apify execution удалён; actor runs асинхронны, имеют
  idempotency, daily/monthly/per-run budget, build/schema metadata, webhook и
  polling reconciliation, schema-drift degradation, fresh-discovery reuse и
  dataset deletion retries;
- Sources UI показывает capability, acquisition mode, adapter и честную границу
  external comments; настройки TikTok отдельно предлагают Display и Business
  OAuth.

VERIFIED:

- Prisma `validate`, свежий client `generate` и schema diff с локальной
  PostgreSQL 16 + pgvector: `No difference detected`;
- populated migration backfill создаёт fail-closed `BLOCKED` placeholder и
  `NO_ACTION`, пока runtime compiler не проверит credentials/proofs;
- RLS smoke под `NOSUPERUSER NOBYPASSRLS`: tenant читает только свою строку,
  cross-tenant INSERT отклонён; у всех семи новых таблиц включены `ENABLE RLS`,
  `FORCE RLS` и tenant policy;
- `npm run typecheck:social`, `npm run i18n:check`, targeted ESLint и
  `git diff --check`;
- social/TikTok/YouTube regression suite: 60 файлов, 312 тестов.

ОСТАЮТСЯ ВЫКЛЮЧЕННЫМИ ДО ВНЕШНЕГО ПОДТВЕРЖДЕНИЯ:

- TikTok Accounts API требует approved app, account-holder authorization URL,
  client credentials и вручную VERIFIED capability proof;
- licensed providers и Apify не запускаются без tenant token, allowlist/contract
  proof и утверждённого бюджета;
- никакой collector/provider proof не включает live reply; outbound остаётся
  закрытым до PR 6.

### PR 3 — Subjects, relevance, retention и comment reports

- добавить subject/alias/relation/source models и UI;
- добавить `SocialReplyIdentity` и явное сопоставление subject с подключёнными
  platform pages/profiles;
- мигрировать существующие keywords/hashtags/scenarios без потери;
- реализовать context/exclusion matching и ambiguous review;
- добавить `SocialMentionSubjectMatch` с reason/confidence;
- включить pre-persistence relevance filter;
- завершить retention/purge по всем типам данных;
- построить SQL-агрегации с отдельным comment/reply разрезом;
- добавить coverage и cost reports.

#### Фактический статус PR 3 — VERIFIED (2026-07-11)

IMPLEMENTED:

- добавлены tenant-scoped объекты мониторинга для компаний, личностей, брендов,
  продуктов, организаций, тем и событий; алиасы, отрицательные алиасы, источники,
  типизированные связи и reply identities защищены composite organization FK и
  RLS;
- существующие scenarios backfill-ятся в `TOPIC` subjects вместе с aliases и
  source links; legacy scenario продолжает работать через сохранённый
  `legacyScenarioId`;
- pre-persistence relevance gate проверяет aliases, required context, exclusions,
  неоднозначные короткие совпадения и owned-source trust до sentiment/AI; rejected
  observation остаётся scrubbed, а принятое сопоставление сохраняет reason,
  confidence и версию aliases;
- UI получил отдельный раздел `Объекты`: company/person/brand/product, aliases,
  контекст, исключения, источники, связи, разрешённые owned reply profiles и
  привязка social-monitoring agent; связь с аккаунтом не включает external reply;
- retention job очищает evidence raw через 30 дней и tombstone-ит mention через
  180 дней, учитывает legal hold, source deletion и deletion ledger;
- analytics строит tenant-scoped SQL rollups с отдельными posts/comments/replies,
  provider phase costs, cost per accepted и фактическим coverage route plan.

VERIFIED:

- Prisma `validate`, свежий client `generate`, migration apply и schema diff с
  локальной PostgreSQL 16 + pgvector: `No difference detected`;
- populated legacy backfill: subject, пять aliases и source link; RLS smoke под
  `NOSUPERUSER NOBYPASSRLS` отклоняет cross-tenant insert, все шесть новых таблиц
  имеют `ENABLE RLS`, `FORCE RLS` и tenant policy;
- `npm run typecheck:social`, `npm run i18n:check`, targeted ESLint и
  `git diff --check`;
- social/observation/provider regression suite: 63 файла, 381 тест;
- production `next build --webpack` завершился с кодом 0; остаются repo-level
  warnings `libheif` dynamic require и standalone trace copy для существующего
  dashboard manifest;
- browser smoke: объект, алиасы, источник, owned reply identity, связанный
  ИИ-агент и сохранение связи `BRAND_OF` отображаются; external sends выключены.

### PR 4 — Multimedia discovery

- выделить общий Vision/OCR provider из существующего Google Vision adapter;
- добавить visual references, media observations и signals;
- cover OCR, budgeted frame sampling и ASR cascade;
- использовать platform-provided transcript, если policy разрешает;
- добавить ручной `DiscoveryLead` из URL/image-search результата;
- добавить tenant/provider budgets и cost observability;
- не включать face matching.

#### Фактический статус PR 4 — VERIFIED (2026-07-11)

IMPLEMENTED:

- добавлены tenant-scoped `DiscoveryLead`, `VisualReference`,
  `MediaObservation`, `MediaSignal`, `MediaProcessingRun` и
  `MediaProcessingPolicy`; связи с source, subject и mention используют
  composite organization FK, а все новые таблицы защищены forced RLS;
- общий Google Vision OCR client вынесен из platform-specific кода: URL
  проверяется до DNS и после resolve, private/link-local/loopback/test ranges,
  redirects сверх лимита и oversized payload блокируются до provider call;
- каскад сначала использует бесплатный platform transcript, затем budgeted
  cover OCR, предоставленные/репрезентативные кадры, ASR и только после отдельной
  настройки multimodal; отсутствующий provider, нулевой budget или пустой набор
  разрешённых стадий завершаются fail-closed;
- raw text, который не прошёл subject/context/exclusion matching, не становится
  `SocialMention`: media lead после полного отрицательного прохода получает
  `VALIDATED`, а положительный OCR/ASR/transcript match повышается в обычное
  упоминание вместе с immutable signal и subject match;
- ручной URL/image-search lead, visual references, очередь обработки, расходы и
  tenant policy доступны в отдельной вкладке `Медиа`; платные этапы по умолчанию
  выключены и имеют daily/monthly/per-observation reservation limits;
- observation retention расширен на discovery leads, media payloads/signals,
  processing snapshots и cost ledger; face matching и biometric templates
  намеренно отсутствуют;
- исправлен общий Prisma nested-create первой версии нового mention: tenant ID
  наследуется через composite parent relation, а недопустимый duplicate
  `organizationId` больше не ломает реальное создание упоминания.

#### URL asset resolution extension — IMPLEMENTED (2026-07-12)

- ручная проверка на сайте теперь принимает обычную ссылку на ролик и до
  создания observation выполняет fail-closed asset resolution;
- YouTube и TikTok используют бесплатный официальный oEmbed для title/author/
  thumbnail; Instagram/Facebook используют Meta oEmbed только при наличии
  `META_OEMBED_ACCESS_TOKEN`;
- прямые публичные video/audio URL передаются в ASR без локального `ffmpeg`;
  Whisper повторно проверяет DNS и отклоняет private/reserved resolution до
  скачивания;
- полноценные frames/audio/transcript для platform post URL принимаются только
  от allowlisted HTTPS resolver по контракту
  `SOCIAL_MEDIA_ASSET_RESOLVER_ENDPOINT` +
  `SOCIAL_MEDIA_ASSET_RESOLVER_ALLOWED_HOSTS`; отсутствие resolver показано в
  UI как capability blocker, а не как успешно выполненная проверка;
- Apify discovery payload теперь сохраняет доступные video/cover/audio/frame/
  transcript fields в нормализованном `sourceMetadata`, после чего применяется
  тот же subject-scoped OCR/ASR pipeline;
- экран показывает фактическую готовность OCR, ASR, metadata и external
  extraction без вывода credentials, автоматически запускает processable
  observation и опрашивает очередь до terminal state.

VERIFIED:

- Prisma `validate`, свежий client `generate`, migration apply и schema diff с
  локальной PostgreSQL 16 + pgvector: `No difference detected`;
- у всех шести новых таблиц подтверждены `ENABLE RLS`, `FORCE RLS` и tenant
  policy; cross-tenant INSERT под `NOSUPERUSER NOBYPASSRLS` отклонён;
- positive database e2e: бесплатный platform transcript с alias и required
  context создаёт signal и `SocialMention`, переводит lead в `INGESTED`, run
  завершается `SUCCEEDED` с фактической стоимостью `$0`;
- negative database e2e: transcript без required context не создаёт mention и
  переводит полностью обработанный lead в `VALIDATED`, не оставляя вечный
  `QUEUED`;
- `npm run typecheck:social`, `npm run i18n:check`, targeted ESLint,
  `git diff --check`; social/observation/provider suite: 67 файлов, 396 тестов;
- production `next build --webpack` завершился с кодом 0; остаются repo-level
  warnings `libheif` dynamic require и standalone trace copy для существующего
  dashboard manifest;
- browser smoke: вкладка `Медиа` не создаёт horizontal overflow, показывает
  нулевой budget/fail-closed policy, а ручная TikTok-находка создаётся через API
  `201` и остаётся `BLOCKED` без платного вызова, пока media policy выключена.

### PR 5 — Legal candidates и subject-bound agent drafts

- добавить candidate/evidence/event/action/approval models;
- мигрировать существующие manual cases к many-evidence contract;
- реализовать `Кандидаты / Кейсы / Отчёты / Правила`;
- добавить probabilistic AI classification и human triage;
- связать subject с social-monitoring agent;
- сохранять полный agent/model/prompt/knowledge/policy snapshot;
- генерировать варианты ответа, «не отвечать» и routing recommendation;
- вычислять `engagementMode` и создавать `ManualEngagementTask` для external
  Instagram/Facebook/TikTok comments без direct или provider reply capability;
- оставить отправку выключенной.

#### Фактический статус PR 5 — VERIFIED (2026-07-11)

Реализовано:

- добавлены tenant-scoped `SocialLegalCandidate`, immutable
  `SocialLegalEvidence`, `SocialLegalEvent`, `SocialLegalAction`,
  `SocialLegalApproval`, `SocialLegalPolicy` и `ManualEngagementTask`;
- существующие кейсы мигрируются в promoted candidates с evidence snapshot и
  migration event, а `SocialLegalCase` связан с subject/candidate;
- UI разделён на `Кандидаты / Кейсы / Отчёты / Правила`, отдельно показывает
  очередь ручных взаимодействий и явно называет AI-классификацию
  вероятностной подсказкой, а не юридическим выводом;
- `autoPromote=false` и `requireHumanReview=true` зафиксированы одновременно в
  API validation и DB CHECK: ИИ не может самостоятельно создать юридический
  кейс;
- subject принимает только активный `AiAgentConfig` того же tenant с
  `agentType=social`; draft использует assigned agent либо активный
  organization fallback;
- каждый draft сохраняет binding и версии agent/model/prompt, masked prompt
  digest, knowledge/policy snapshot, content version, reply alternatives,
  routing recommendation и `engagementMode`;
- owned identity, provider/manual/no-reply режимы разделены; для external
  Instagram/Facebook/TikTok comment без подтверждённой reply capability
  создаётся ручная задача с permalink вместо ложной имитации отправки;
- approve и dry-run не выставляют `sentAt` и не переводят draft в `sent`;
  `enqueue_live` остаётся закрыт fail-closed boundary из PR 1;
- active candidate добавлен в legal hold operational retention, при этом
  source deletion по-прежнему удаляет operational content, сохраняя отдельный
  immutable legal snapshot.

VERIFIED:

- миграция применена к локальной PostgreSQL 16; Prisma schema diff:
  `No difference detected`;
- у всех семи новых таблиц подтверждены `ENABLE RLS`, `FORCE RLS` и tenant
  policy; cross-tenant INSERT под `NOSUPERUSER NOBYPASSRLS` отклонён;
- database e2e: ручной кандидат имеет `HUMAN_REVIEW`, до явного promotion
  кейсов `0`, после него `1`, evidence `1`, event `1`, action alternatives `3`;
  policy в БД остаётся `autoPromote=false`, `requireHumanReview=true`;
- `pnpm typecheck:social`, `pnpm i18n:check`, targeted ESLint,
  `git diff --check`; social/observation/provider suite: 68 файлов, 401 тест;
  PR5 targeted suite: 8 файлов, 53 теста;
- production `next build --webpack` завершился с кодом 0 после передачи
  build-only `NEXTAUTH_SECRET`; после финального tenant-assignee guard повторный
  build был остановлен на compile без ошибки из-за параллельного `next build` в
  другом checkout и длительного system I/O-wait, а сам guard повторно проверен
  typecheck, ESLint и тестами; остаются repo-level warnings `libheif`, Sentry,
  `metadataBase` и standalone trace copy;
- browser smoke на локальной БД: четыре legal tabs доступны, Candidates явно
  требует human promotion, Rules показывает зафиксированный human gate,
  external tasks описаны как ручные; horizontal overflow отсутствует
  (`scrollWidth=viewport=1280`);
- платные AI/provider вызовы и внешние отправки в PR 5 не выполнялись.

### PR 6 — Approved outbound outbox

- добавить `OutboundSocialReply` и immutable approval;
- реализовать direct и provider publisher adapters;
- реализовать worker, CAS transitions, lease и idempotency;
- реализовать reconciliation неизвестного результата;
- повторно проверять current policies и content version;
- добавить global, tenant, platform и connection kill switches;
- добавить role separation и полный audit trail;
- провести controlled sandbox/canary verification;
- live-send включается отдельно для каждого tenant/platform после release review.

#### Фактический статус PR 6 — VERIFIED (2026-07-12)

IMPLEMENTED:

- добавлены tenant-scoped `SocialOutboundPolicy`, `OutboundSocialReply`,
  append-only approval и transition events; migration backfill оставляет каждый
  tenant и connection закрытыми (`liveEnabled=false`, emergency stop включён,
  разрешённых платформ нет);
- application routes только создают deterministic idempotent `PENDING` request;
  единственная publisher boundary вызывается worker-ом после отдельного approval,
  CAS claim/lease и повторной проверки всех текущих gates;
- direct publisher разрешён только для owned source и явно подключённой sender
  identity; provider publisher требует exact provider key, действующий
  `VERIFIED` contract/sandbox capability proof и разрешённый reply endpoint;
- global, tenant, platform, channel, connection и subject-identity gates работают
  fail-closed; дополнительно проверяются content/draft version и hash, token
  expiry, legal review, forbidden topics, quiet hours и rate limit;
- ambiguous network/provider outcome никогда не повторяется автоматически:
  строка переходит в `RECONCILIATION_REQUIRED`; только подтверждённый readback или
  admin resolution переводит её в `SENT`, а `NOT_SENT` возвращает в retry path;
- requester не может одобрить свой request ни в service, ни на уровне PostgreSQL
  trigger; approvals/events доступны tenant-приложению только на INSERT/SELECT;
- вкладка «Ответы» показывает закрытые release gates, outbox states и действия
  только подходящему admin/manager, который не является автором request;
- production deploy атомарно устанавливает ежеминутный outbox cron через общий
  `cron-trigger.sh`; local `flock` не допускает overlap одного endpoint, а CAS
  lease/idempotency остаются correctness boundary внутри worker;
- live флаги, connection capability и tenant release не включались; платные
  provider calls и реальные внешние отправки не выполнялись.

VERIFIED:

- isolated replay SQL PR6 на временном клоне актуальной PostgreSQL 16 и Prisma
  diff: `No difference detected`; полный replay всей исторической цепочки всё ещё
  останавливается на существующем до PR1 дефекте
  `20260406200000_phase4_enterprise_features`/`ai_interaction_logs`;
- production migration role под `FORCE RLS` без bypass видел `0` из 75
  `collector_runs`; поэтому каждая migration PR1–PR6 теперь явно включает
  session-level `app.rls_bypass=on` до backfill и сбрасывает его в `off` в конце;
  первый PR1 deploy полностью откатился (`applied_steps_count=0`, новых колонок
  нет) и был штатно отмечен `--rolled-back` перед повторным применением;
- отдельная forward-only RLS hardening migration добавляет trusted bypass в
  policies PR3–PR6, чтобы cross-tenant cron действительно видел work queue;
  tenant smoke по-прежнему видит только свою policy (`1/1/0` для tenant A/B/
  отсутствующего tenant), а approvals/events сохраняют только INSERT/SELECT;
- DB security smoke: self-approval отклонён trigger-ом; tenant-role видит свои
  approval/event, но UPDATE approval и DELETE event возвращают `0`; cross-tenant
  защита и `ENABLE/FORCE RLS` сохранены;
- database e2e без внешней сети: `PENDING` → отказ self-approval → approval вторым
  admin → `QUEUED` → один вызов injected sandbox adapter → `SENT`; повторный
  enqueue возвращает существующую строку и не вызывает publisher второй раз;
- `pnpm typecheck:social`, `pnpm i18n:check`, targeted ESLint,
  `git diff --check`; social regression suite: 66 файлов, 338 тестов, один
  opt-in DB test пропущен в общем run и отдельно прошёл с `PR6_DB_E2E=1`;
- deploy/cron shell scripts прошли `bash -n`; installer дважды применён к fake
  crontab и сохранил ровно один managed block, один outbox schedule и постороннюю
  crontab строку;
- browser smoke на локальной fixture DB: outbox card доступна во вкладке
  «Ответы», live показывает disabled, пустая очередь не содержит approval actions,
  horizontal overflow отсутствует (`scrollWidth=clientWidth=1280`);
- production `next build --webpack` завершился с кодом 0; остаются repo-level
  warnings `libheif`, Sentry, `metadataBase`, Edge `node:async_hooks`, CSP nonce
  hydration и standalone trace copy, не созданные PR6.

## 20. Критерии завершения

Работа считается законченной, когда:

- каждая платформа имеет протестированную capability/source policy;
- каждый активный scenario имеет сохранённый `SourceRoutePlan`, а collector не
  выбирает provider динамически через ИИ;
- UI не обещает чужие comments там, где их нельзя легально и стабильно получить;
- UI отдельно показывает read capability, reply capability и sender identity;
- при отсутствии direct API CRM пробует только contract-tested
  `PROVIDER_REPLY`, затем честно переходит к manual task;
- YouTube/VK используют официальные comments APIs, X — официальный или
  лицензированный канал, Telegram — только доступные discussions;
- Apify никогда не запускается вместо доступного более приоритетного adapter;
- rejected content действительно удаляется по SLA;
- comment/reply identity сохраняет thread и versions без ложных URL-дублей;
- один legal case объединяет несколько evidence items;
- AI agent создаёт воспроизводимый draft со snapshot;
- owned comments публикуются только от явно подключённой identity, а external
  comments без direct/provider publishing capability получают permalink/manual
  task вместо имитации send;
- ни один application route не вызывает publisher напрямую;
- duplicate external send предотвращается idempotency и reconciliation;
- RLS и composite tenant relations протестированы;
- отчёты строятся SQL-агрегациями и показывают acquisition/coverage gaps;
- стоимость acquisition, multimedia и AI измеряется на новый релевантный результат;
- runbooks описывают provider outage, schema drift, token expiry, purge failure и
  emergency kill switch.

## 21. Автономное выполнение

Рекомендуемый goal для реализации:

> Полностью автономно реализуй Social Monitoring V2 согласно
> `docs/social-monitoring-v2-architecture-plan.md`. Соблюдай последовательность
> PR1→PR6 и не начинай следующий этап, пока текущий не реализован, не проверен и не
> закоммичен. Не обходи официальные API скрейпингом там, где это нарушает ToS.
> Apify используй только как маркированный fallback после official, connected и
> licensed sources. Не включай живую отправку до реализации outbox, idempotency,
> reconciliation, повторной проверки policies и kill switches. Не затрагивай
> посторонние изменения. На каждом этапе обновляй план, выполняй миграции и целевые
> проверки, делай path-scoped commit и продолжай все независимые задачи. Внешний
> блокер документируй с доказательством и не подменяй выдуманной реализацией.

Этот goal закрепляет последовательность, но source of truth остаётся данным
документом: изменения требований сначала вносятся сюда, затем в код.
