# Social Monitoring — план готовности к клиентам

Статус: **source of truth для коммерческой готовности и платного пилота**.

Дата baseline: 2026-07-12.

Этот документ не заменяет целевую архитектуру
[`social-monitoring-v2-architecture-plan.md`](./social-monitoring-v2-architecture-plan.md).
Архитектурный план отвечает на вопрос «как устроена система», а этот документ —
«что ещё нужно доказать и включить, прежде чем брать деньги у клиентов».

Текущая последовательность provider POC, discovery/enrichment routing,
comments/media coverage и доказательства 90% зафиксирована в
[`social-monitoring-provider-routing-roadmap.md`](./social-monitoring-provider-routing-roadmap.md).

Исторический журнал выполненных этапов остаётся в
[`social-monitoring-roadmap.md`](./social-monitoring-roadmap.md) и не является
актуальным backlog.

## 1. Коммерческий вердикт

Техническое ядро продукта уже существует. Переписывание с нуля не требуется.
Перед продажей необходимо доказать четыре свойства:

1. заявленные источники действительно собирают данные с измеримой полнотой и
   задержкой;
2. нерелевантный шум, дубли и расходы находятся под контролем;
3. оператор понимает ограничения источника и безопасно работает с AI-черновиками;
4. команда умеет подключить, сопровождать, тарифицировать и удалить данные клиента.

Первый коммерческий релиз — **платный управляемый пилот**, а не unrestricted GA.
Пилот работает в режиме `draft-first`; live-ответы по умолчанию выключены.

## 2. Что уже реализовано

Следующие возможности считаются реализованными в коде, но некоторые ещё требуют
production canary или внешних credentials:

- multi-tenant модели и RLS для объектов, источников, наблюдений, evidence,
  юридических сущностей и outbound workflow;
- `MonitoringSubject`, aliases, relations, source bindings, reply identities и
  visual references;
- единый ingest, каноническая модель post/comment/reply, version history,
  evidence и non-destructive clustering;
- source route plan с приоритетом official/connected/licensed/Apify/manual;
- official и provider adapters, async Apify boundary и capability proof;
- атомарный collector claim/lease, cursor state и source readiness diagnostics;
- временные observations, relevance gate, retention/purge и deletion ledger;
- отдельный media pipeline: metadata, cover/frame OCR, transcript/ASR и budgets;
- отдельный social AI agent, immutable draft snapshot и ручная approval-модель;
- legal candidates, cases, evidence, events, actions, approvals и reports;
- durable outbound outbox с approval separation, CAS, lease, idempotency,
  reconciliation и многоуровневыми kill switches;
- production UI для сценариев, объектов, источников, media, упоминаний, ответов,
  AI agent, юридических кейсов и настроек;
- локализованные AZ/RU/EN интерфейсы и значительный regression suite.

Наличие адаптера не считается доказательством production-покрытия. Рабочей
возможность становится только после sandbox/production proof с реальным payload,
измеренной задержкой и зафиксированным договорным правом использования данных.

## 3. Обещание первого продукта

Пилот продаётся со следующим обещанием:

> LeadDrive отслеживает согласованные объекты и источники в пределах явно
> показанного покрытия, отделяет релевантные упоминания от шума, собирает evidence,
> классифицирует риск и готовит AI-черновики для утверждения человеком.

Нельзя обещать:

- «все комментарии во всех соцсетях»;
- гарантированное обнаружение контента из закрытых/недоступных аккаунтов;
- официальный reply capability только потому, что scraper вернул comment ID;
- юридическую квалификацию, вынесенную AI;
- автоматическую публикацию без отдельного release review;
- бессрочное хранение platform content;
- стабильность best-effort scraper на уровне официального API.

## 4. Уровни готовности

### L0 — техническая демонстрация

Интерфейс и тестовые данные работают, но реальная полнота и эксплуатация не
доказаны. Этот уровень уже пройден.

### L1 — платный управляемый пилот

- 1–3 клиента;
- заранее согласованные объекты и платформы;
- draft-first;
- ручной контроль coverage и инцидентов;
- измеряемая стоимость и качество;
- ограничения являются частью договора/онбординга.

### L2 — общий коммерческий запуск

- повторяемый self-service onboarding;
- тарифы и usage enforcement;
- формализованный support/SLA;
- резервные маршруты для критических источников;
- доказанный retention/deletion и incident process.

### L3 — выборочные live-ответы

Включается только после отдельного controlled canary для конкретного tenant,
platform, identity и content class. Не является условием первого пилота.

## 5. Честная карта платформ для пилота

Каждая строка в клиентском coverage contract должна содержать дату проверки,
account/source, read scope, reply scope, historical depth, cadence/latency,
provider, retention и стоимость.

| Платформа | Пилотный read path | External comments | Reply из CRM |
| --- | --- | --- | --- |
| Facebook | Official для подключённых Pages | Только одобренная capability/provider или маркированный best-effort fallback | Owned Page после proof; external — provider proof либо manual task |
| Instagram | Official для подключённых professional accounts | Provider/Apify best-effort в разрешённых публичных сценариях | Owned media после proof; external — provider proof либо manual task |
| TikTok | Connected Business/Organic capability, provider webhook | Нет универсального коммерческого API; provider/Apify только после proof | Только подтверждённая owned/partner capability; иначе manual task |
| YouTube | Data API для найденных/известных video IDs | Official comments API для доступных видео | OAuth channel, только когда API подтверждает возможность ответа |
| Telegram | Доступные bot/account discussions | Только чаты/discussions, к которым identity имеет доступ | Только от identity с правом писать в discussion |
| VK | Official API для доступных объектов | Official comments API в пределах token/privacy limits | После отдельного create-comment capability proof |
| X | Official paid API или licensed provider | В пределах оплаченного search/provider contract | User OAuth и подходящий тариф/capability; иначе manual task |

Apify не является универсальным обязательным primary. Для external
Instagram/Facebook/TikTok он может быть настроенным fallback по умолчанию только
если конкретный actor, target и использование данных прошли policy review.

## 6. Release gates платного пилота

Числовые пороги ниже являются начальными целями. Владелец продукта может изменить
их до подписания пилота, но после этого они становятся частью acceptance contract.

### 6.1 Безопасность

- [ ] 0 успешных cross-tenant read/write в RLS integration suite.
- [ ] Все новые tenant-owned таблицы имеют `ENABLE RLS`, `FORCE RLS` и composite
  tenant relations там, где есть parent/child связь.
- [ ] Секреты хранятся только за encrypted/env boundary и редактируются в API/UI.
- [ ] Live send глобально выключен; tenant/platform/connection gates выключены.
- [ ] Security review не имеет открытых P0/P1 уязвимостей.
- [ ] Backup restore и deletion replay проверены на отдельной среде.

### 6.2 Сбор и свежесть

- [ ] 100% активных sources показывают readiness, last success, last complete run,
  текущий blocker и следующий шаг.
- [ ] Scheduler dispatch/claim не запускает один source параллельно.
- [ ] Не менее 98% ожидаемых runs за 14 дней завершаются либо дают
  классифицированный upstream/policy error; зависшие `RUNNING` отсутствуют.
- [ ] Webhook P95 ingestion latency не превышает 5 минут.
- [ ] Polling P95 freshness не превышает `2 × configured cadence + 5 минут`.
- [ ] Pagination/cursor canary подтверждает отсутствие систематической потери
  страниц на каждом заявленном connector.
- [ ] Provider outage становится видимым оператору не позднее 5 минут после
  detection.

### 6.3 Качество

- [ ] Существует versioned gold dataset минимум из 500 размеченных единиц по
  согласованным языкам и платформам.
- [ ] Recall релевантных результатов не ниже 90% на gold dataset.
- [ ] Precision принятого feed не ниже 90%.
- [ ] Stable external ID не создаёт hard duplicates.
- [ ] Доля операторски подтверждённых дублей ниже 1%.
- [ ] Text/author/day и semantic similarity создают cluster, но никогда не
  уничтожают самостоятельные комментарии.
- [ ] AI legal false statement никогда автоматически не становится финальным
  юридическим выводом или кейсом.

### 6.4 Эксплуатация и стоимость

- [ ] Измеряются provider, OCR, ASR, LLM, storage и egress расходы по tenant.
- [ ] Известна стоимость одного нового принятого релевантного упоминания.
- [ ] Budget exhaustion блокирует платный вызов до его выполнения.
- [ ] Есть runbooks для provider outage, token expiry, rate limit, purge failure,
  queue backlog и emergency stop.
- [ ] Назначены owner и support channel пилота.
- [ ] Production smoke и rollback procedure воспроизводимы.

### 6.5 Privacy и договор

- [ ] Подготовлены Terms, Privacy Notice, DPA и список subprocessors.
- [ ] Для каждого provider подтверждены export, AI processing, retention,
  deletion и attribution rights.
- [ ] Tenant может запросить export и deletion.
- [ ] Retention policy отображается до запуска источника.
- [ ] Legal hold не используется как способ нарушить обязательное platform
  deletion.

Пилот получает `GO` только после прохождения всех обязательных пунктов 6.1–6.5.

## 7. Обязательная последовательность работ

Каждый этап завершается evidence в этом документе, targeted tests, path-scoped
commit и push. Следующий этап начинается только после проверки предыдущего.

### CR-0 — Baseline и клиентский coverage contract

Цель: превратить технические возможности в честный продаваемый scope.

Задачи:

- [x] Создать machine-readable capability inventory по platform/scope/adapter.
  (`src/lib/social/capability-inventory.ts` — статическая платформенная матрица +
  чистый `computeCapabilityInventory`.)
- [x] Для production tenant снять readiness snapshot без вывода секретов.
  (Выполнено 2026-07-12 на production tenant `brandprotection` (SHA `88ddf52bc`)
  авторизованной admin-сессией: `GET /api/v1/social/coverage-contract` → 200,
  payload secret-free (version/generatedAt/org/summary/rows); 22 capability
  rows: `CONFIGURED` 16, `BLOCKED` 3, `IMPLEMENTED` 3, `PRODUCTION_VERIFIED` 0,
  `SANDBOX_VERIFIED` 0. «Карта покрытия» в UI показывает те же числа.)
- [x] Зафиксировать, какие official/provider/Apify routes реально настроены.
  (Assembler считает статус из proofs, подключённых аккаунтов, скомпилированных
  route plans и provider config источников.)
- [x] Добавить дату истечения capability proof и договорной проверки.
  (В инвентарь выведены `verifiedAt`/`sandboxVerifiedAt`, `expiresAt` с флагом
  `expired` и `contractVersion`.)
- [x] Сформировать шаблон coverage contract для клиента.
  (`docs/social-monitoring-coverage-contract-template.md`.)
- [x] Добавить UI/export, показывающий read, reply, sender identity, latency,
  historical depth и limitation.
  (`CoverageInventoryCard` во вкладке «Источники → Статус» + Markdown-экспорт из
  того же endpoint.)
- [x] Разделить статусы `IMPLEMENTED`, `CONFIGURED`, `SANDBOX_VERIFIED`,
  `PRODUCTION_VERIFIED`, `BLOCKED`.
- [x] Убрать или переписать любые утверждения UI, которые обещают больше
  подтверждённого покрытия.
  (Аудит socialMonitoring i18n и help-контента: вводящих в заблуждение обещаний
  «все комментарии/весь интернет/гарантия» не найдено; честная лестница статусов
  и заметка о выключенной live-отправке добавлены в панель покрытия.)

Acceptance:

- для каждой заявленной платформы существует capability row с proof timestamp;
- UI и API не называют source ready без credentials и proof;
- клиентский coverage document генерируется из тех же данных, что UI.

Статус: **VERIFIED** — код-часть закрыта и проверена; production readiness
snapshot реального tenant снят 2026-07-12 (см. пункт выше и Evidence log).

### CR-1 — Collector reliability и операционный контроль

Цель: ни один источник не молчит незаметно и не создаёт неконтролируемые повторы.

Задачи:

- [x] Проверить claim/lease/fencing во всех collector entrypoints.
  (Аудит: атомарный claim + `runClaimToken`/`runClaimVersion` fencing; потерявший
  claim worker не перезаписывает source-health — PR1. Fenced только terminal
  health-write; mid-run ingest защищён dedupe.)
- [x] Проверить cursor ownership и pagination completeness каждого adapter.
  (Аудит: Telegram владеет connection-level cursor; route-plan comment-адаптеры
  проходят страницы в пределах run и сообщают `coverageClass`; legacy YouTube
  теперь проходит все `nextPageToken`, использует successful-run watermark и не
  сдвигает его при ошибке промежуточной страницы.)
- [x] Ввести классификацию transient/permanent/policy/auth/budget ошибок.
  (`collector-error-classifier.ts` — единый `classifyCollectorError`.)
- [x] Добавить exponential backoff и jitter там, где их ещё нет.
  (Circuit breaker: экспоненциальный backoff + детерминированный ±25% jitter;
  due-spacing уже был экспоненциальным.)
- [~] Добавить terminal quarantine/dead-letter path для невосстановимых payloads.
  (AUTH/POLICY/PERMANENT quarantine маршрут в `BLOCKED` fail-closed; полноценная
  dead-letter таблица payload-ов — follow-up.)
- [x] Добавить replay одного run/source без повторного billable provider fetch.
  (`POST /api/v1/social/ingest-envelopes/:id/replay` повторно проводит только
  сохранённый и ещё не purged `IngestEnvelope` через текущий relevance gate;
  provider/collector не вызываются, исходные idempotency key, route/run/provider
  provenance и policy snapshot сохраняются. Обычный `REVIEW` не повышается:
  replay разрешён только для `ACCEPTED` без mention или
  `mention_persistence_failed`.)
- [~] Добавить daily/monthly USD budget для платных routes.
  (`paid-route-budget.ts` и Apify budget guard реализованы и протестированы, но
  по решению владельца battle mode не ограничивается деньгами. Enforcement
  включается только `SOCIAL_MONITORING_ENFORCE_USD_BUDGETS=1`; до SaaS pricing
  provider routes остаются открытыми, а usage ledger продолжает считать расход.)
- [x] Добавить circuit breaker и controlled failback для provider routes.
  (Class-aware circuit breaker + `fallbackAdapters`/`selectedAdapterForPlan`.)
- [ ] Добавить SLO metrics, dashboards и alerts. (Runtime/infra — не сделано.)
- [~] Добавить synthetic canary sources без клиентских данных.
  (Подход описан в runbook §8; создание источника — per-tenant конфигурация без
  нового кода; 14-дневный прогон — runtime.)
- [x] Создать runbooks и owner rotation.
  (`docs/social-monitoring-collector-runbooks.md`.)

Acceptance:

- 14-дневный canary проходит gates раздела 6.2; → `NOT RUN` (runtime/prod).
- stale leases автоматически освобождаются без двойного ingest; → DONE
  (`reapStaleMonitoringSourceLeases` вызывается перед due-source cron; точный
  token/version/expiry CAS + fencing, а mention dedupe исключает дубль ingest).
- replay не создаёт дубль и сохраняет evidence provenance; → DONE (tenant-scoped
  stored-envelope replay, исходный idempotency key, current relevance re-check,
  provider-free unit/API regression tests).
- provider/auth/budget failure имеет понятный operator action; → DONE
  (`operatorAction` классификатора + runbooks).

Статус: **PARTIAL** — код-примитивы reliability (классификация, class-aware
circuit breaker + jitter, quarantine, runbooks) реализованы и проверены;
остаются только runtime/infra-gated пункты (14-дневный canary, SLO
dashboards/alerts), перечисленные в runbook «Открытые пункты».

### CR-2 — Quality evaluation и feedback loop

Цель: доказать полноту поиска, а не только технический ingest.

Задачи:

- [~] Создать anonymized/versioned gold dataset AZ/RU/EN.
  (Формат `GoldDataset` + версионирование готовы; синтетический seed на 15
  единиц; реальный ≥500-элементный размеченный dataset — BLOCKED на
  owner-provided labels.)
- [x] Включить posts, comments, replies, captions, OCR и transcripts.
  (`GoldContentKind` покрывает все виды; seed включает POST/COMMENT/REPLY/OCR/
  CAPTION.)
- [x] Покрыть aliases, транслитерации, склонения, опечатки, омонимы,
  отрицательные aliases, сарказм и короткие неоднозначные имена.
  (`GoldChallenge` таксономия + seed по каждому кейсу; per-challenge разбивка.)
- [x] Нормализовать латиницу/кириллицу независимо от locale-sensitive ASCII `I`,
  сохранив азербайджанские символы и provenance версии matcher.
  (`normalizeSubjectTerm` использует стабильный Unicode lowercase;
  `subject_relevance_v2`; uppercase OCR `ACME ROBOTICS` совпадает с mixed-case
  alias `Acme Robotics`.)
- [x] Добавить offline evaluator для exact/context/classifier stages.
  (`relevance-evaluator.ts` → `evaluateGoldDataset`; чистое ядро вынесено в
  `decideSubjectRelevance`.)
- [x] Разделить false negative discovery и false negative relevance.
  (`falseNegativeType: discovery | relevance` per item + агрегаты.)
- [x] Добавить операторские действия `релевантно`, `нерелевантно`, `дубль`,
  `не тот объект`, `пропущенный риск`.
  (`SocialRelevanceFeedback` + tenant-scoped write API; повторная оценка обновляет
  одну текущую строку `(tenant, mention, subject)`, не раздувая метрики кликами.
  UI: секция «Качество мониторинга — <subject>» в меню карточки упоминания;
  mentions GET отдаёт `subjectMatches` + `relevanceFeedback`, выбранная оценка
  показывается галочкой и переживает перезагрузку. Browser-proof на локальной
  fixture-БД: toast «Оценка сохранена», строка RELEVANT/ACCEPTED/
  `subject_relevance_v2` в БД, weekly report `relevant=1`.)
- [~] Хранить feedback с model/prompt/rules version.
  (Для текущего rule-based relevance path сохраняется фактический
  `matcherVersion` match-а либо текущая версия matcher; model/prompt versions
  остаются неприменимы, пока classifier не сохраняет их в match provenance.
  Mention/subject/platform/relevance snapshots связаны composite tenant FK.)
- [x] Не добавлять rejected feed в долговременную память агента.
  (Rejected observation остаётся scrubbed по PR2/PR3; feedback-таблица не хранит
  text, raw payload, prompt, embedding или reusable-memory content.)
- [x] Добавить weekly quality report по tenant/subject/platform.
  (`GET /api/v1/social/relevance-feedback`: SQL rollup по неделе, subject,
  platform и relevanceStatus с relevant/false-positive/duplicate/missed-risk
  rates.)

Acceptance:

- автоматически рассчитываются recall, precision, duplicate rate и review rate;
  → recall/precision/review rate считает evaluator; duplicate rate измеряется на
  dedup-слое ingest (не в relevance evaluator).
- достигнуты gates раздела 6.3; → механизм `evaluateRelevanceGates` есть; на
  реальных данных `NOT RUN` (нужен owner gold dataset).
- изменение rules/model не выпускается при ухудшении согласованного порога;
  → gate-функция готова для CI-гейта; подключение к release-процессу — follow-up.

Статус: **PARTIAL** — offline evaluator, gold-формат, FN-разделение, gate-проверка,
операторский feedback-loop и weekly SQL quality report реализованы и проверены;
реальный размеченный gold dataset остаётся `BLOCKED` на owner-provided labels.

### CR-3 — Реальные connectors и provider canary

Цель: активировать только доказанное покрытие.

Задачи:

- [ ] Провести official canary Facebook/Instagram owned comments.
- [ ] Провести official canary YouTube comments и reply capability.
  (Safe implementation: официальный hybrid collector поддерживает keyword/
  subject search → найденные videoId → полную пагинацию comments/replies,
  внешний channel watchlist по UC id/`@handle`/URL и прямой video URL. Реальный
  API-key/OAuth canary и quota evidence остаются owner/runtime-gated. Direct
  reply publisher использует официальный `comments.insert`, только для
  observation с `commentThread.canReply=true`, OAuth `youtube.force-ssl`,
  отдельной approved identity и всех PR6 outbox gates. Reconnect сбрасывает
  connection live/capability proof; sandbox send/read-back всё ещё NOT RUN.)
- [ ] Провести Telegram discussion canary на доступной тестовой группе.
- [ ] Провести VK read/reply capability canary, если платформа входит в тариф.
- [ ] Подтвердить оплачиваемый X route либо явно исключить X из пилота.
- [ ] Провести TikTok Business/Organic read canary для подключённого account.
- [ ] Для external Instagram/Facebook/TikTok выбрать primary licensed provider
  либо documented best-effort Apify actor.
- [ ] Для каждого Apify actor проверить ToS/policy, schema drift, pagination,
  duplicates, latency, стоимость и webhook authenticity.
- [ ] Проверить fallback/failback без одновременного двойного billable fetch.
- [ ] Не включать provider reply без отдельного sandbox send/read-back proof.

Acceptance:

- каждый продаваемый route имеет capability proof с sample run;
- каждый неподтверждённый route показывается как `BLOCKED`/`BEST_EFFORT`;
- стоимость и freshness известны для каждого route;
- external comment ID не превращается автоматически в publishing permission.

Владелец требуется только для выдачи credentials, оплаты/договора, входа во
внешний кабинет и разрешения sandbox action.

### CR-4 — Media providers, каскад и retention

Цель: production-анализировать обложки, кадры и речь с ограниченной стоимостью.

Задачи:

- [ ] Настроить OCR provider и synthetic smoke.
- [ ] Настроить ASR provider и synthetic smoke.
- [ ] Выбрать/реализовать allowlisted asset extractor для platform URLs.
- [ ] Проверить direct video/audio URL flow без SSRF/private-network доступа.
- [ ] Зафиксировать max bytes, duration, frame count, timeout и egress limits.
- [ ] Настроить cover-first cascade и tenant budgets.
- [ ] Добавить cost reservation/reconciliation для каждого платного stage.
- [ ] Проверить purge media bytes, thumbnails, frames, OCR и transcripts.
- [ ] Проверить source deletion propagation и deletion ledger replay.
- [ ] Запретить face recognition без отдельного продукта и legal review.

Acceptance:

- cover OCR, frame OCR и ASR проходят controlled test;
- отключённый/исчерпанный provider fail-closed и не теряет исходный lead;
- rejected media удаляется по policy;
- dashboard показывает funnel и фактическую стоимость каждого stage.

### CR-5 — AI-agent production evaluation

Цель: безопасный и воспроизводимый draft-first workflow.

Задачи:

- [~] Создать versioned evaluation set для ответов AZ/RU/EN. (Формат
  `AiGateEvalSet` + версионирование + синтетический seed на 20 единиц; реальный
  evaluation set ответов — owner-provided.)
- [ ] Проверить subject-agent binding и organization fallback. (Реализовано в
  PR5; отдельная production-проверка — follow-up.)
- [ ] Проверить provenance фактов и knowledge versions. (Snapshot реализован в
  PR5; production-проверка — follow-up.)
- [x] Добавить/проверить prompt-injection resistance для untrusted social text.
  (Категория `prompt_injection` в `classifySocialAiTopic` + offline-покрытие.)
- [x] Проверить forbidden topics, PII, threats, legal, medical, financial,
  political и low-confidence gates. (Классификатор расширен до 9 категорий;
  offline evaluator меряет block recall/precision по каждой; low-confidence
  gate — в draft-service.)
- [ ] Измерять draft acceptance, edit distance, rejection и escalation. (Нужны
  живые draft-данные — owner/runtime.)
- [ ] Проверить regenerate history и approval invalidation при edit source/draft.
  (Реализовано в PR5; production-проверка — follow-up.)
- [ ] Добавить operator preview: identity, engagement mode, limitations и context.
  (Реализовано в PR5.)
- [ ] Проверить manual task flow для `OPEN_NATIVE`/`COPY_DRAFT`. (Реализовано в
  PR5.)
- [x] Live send оставить выключенным. (Не включался.)

Acceptance:

- AI никогда не получает provider token; → сохранено (PR5/PR6 boundary).
- каждый draft воспроизводим по immutable snapshot; → сохранено (PR5 snapshot).
- forbidden/high-risk cases не могут пройти без человека; → усилено: gate
  расширен на threats/political/financial/injection, offline-покрытие доказано.
- оператор видит, от чьего имени и каким способом предполагается ответ; → PR5.
- draft quality report доступен владельцу продукта; → offline gate-report есть;
  quality report по живым draft-данным — follow-up.

Статус: **PARTIAL** — offline gate-evaluator, расширенные safety-категории и
prompt-injection resistance реализованы и проверены; живая draft-quality оценка
(acceptance/edit distance) и реальный evaluation set остаются owner/runtime-gated.

### CR-6 — Legal, privacy и data lifecycle

Цель: использовать юридический раздел как evidence workflow, а не как AI-судью.

Задачи:

- [ ] Провести legal review категорий и пользовательских формулировок.
- [ ] Проверить human-only promotion candidate → case.
- [ ] Добавить evidence package export: manifest, hashes, timestamps, provenance,
  versions и chain-of-custody events.
- [ ] Разделить operational copy и immutable legal snapshot.
- [ ] Проверить source edit/delete и invalidation workflow.
- [ ] Реализовать tenant export/delete request orchestration.
- [ ] Проверить purge во всех DB/object storage/cache/embedding/AI trace слоях.
- [ ] Провести restore-then-delete replay test.
- [ ] Подготовить Terms, Privacy, DPA, subprocessor list и retention schedule.
- [ ] Зафиксировать country/tenant-specific legal overrides.

Acceptance:

- AI-кандидат не создаёт финальный кейс без human action;
- evidence package воспроизводим и содержит provenance;
- deletion request имеет audit trail и завершается во всех слоях;
- юридические документы одобрены ответственным специалистом.

### CR-7 — Onboarding, support и клиентский UX

Цель: подключение нового клиента повторяется без участия разработчика в каждом
шаге.

Задачи:

- [ ] Создать onboarding wizard: subject → aliases/exclusions → sources →
  connected identities → policy → test → confirmation.
- [ ] Добавить permission/scopes diagnostics.
- [ ] Добавить preflight, который не активирует source при `BLOCKED` readiness.
- [ ] Добавить demo/sandbox tenant без live sends.
- [ ] Подготовить platform limitation help и provider disclosure.
- [ ] Добавить first-run checklist и success criteria.
- [ ] Подготовить admin/operator/legal role guides.
- [ ] Добавить support intake с correlation/source/run IDs.
- [ ] Подготовить incident communication templates и status page process.
- [ ] Провести onboarding rehearsal человеком, не участвовавшим в разработке.

Acceptance:

- новый пилотный tenant подключается по runbook без изменения кода;
- заблокированный scope/credential имеет конкретное исправление;
- оператор может обработать mention, draft и legal candidate по инструкции;
- support получает достаточно идентификаторов без запроса секретов.

### CR-8 — Usage, себестоимость и коммерческие лимиты

Цель: ни один клиент не создаёт неизвестный или неограниченный расход.

Задачи:

- [~] Определить billable units: subjects, sources, accepted mentions,
  provider runs/items, OCR frames, ASR minutes, AI calls, storage и retention.
  (`SOCIAL_BILLABLE_UNITS` фиксирует измеримые units; `STORAGE_GB_DAY` и
  `RETENTION_GB_DAY` явно `UNAVAILABLE`, пока нет durable byte-day counters.)
- [x] Реализовать tenant usage ledger и daily/monthly rollups.
  (`monitoring-rollups.ts` строит tenant-scoped derived ledger по day/unit/
  dimension с daily/monthly totals; raw payload/текст в usage не попадают.)
- [~] Сопоставлять provider invoice с internal reservations/actuals.
  (Internal actual и reserved maximum exposure разделены; реальный invoice
  reconciliation остаётся BLOCKED на owner/provider invoice.)
- [~] Добавить soft warning и hard budget gates.
  (Код hard gates сохранён, но USD enforcement намеренно выключен владельцем до
  этапа SaaS pricing. Media сохраняет технические per-observation ограничения;
  soft-warning thresholds требуют будущих коммерческих лимитов.)
- [ ] Определить pilot price и включённые лимиты.
- [~] Рассчитать gross margin на low/base/high usage scenarios.
  (`calculateSocialMonitoringMargin` готов, но не подставляет тариф или
  multipliers: без owner rate card возвращает `UNCONFIGURED`.)
- [~] Запретить unlimited media/provider usage.
  (В battle mode остаются технические `maxItems`, timeout, quota/rate-limit и
  cadence, но денежный cap отключён по решению владельца. Storage/retention
  byte-day enforcement невозможен до добавления счётчиков.)
- [~] Добавить internal cost dashboard и клиентский usage summary.
  (Tenant analytics API уже возвращает ledger, costs, exposure и margin status;
  отдельный UI/dashboard не реализован.)
- [ ] Определить overage, grace и suspension policy.
- [~] Проверить race-safe enforcement при параллельных workers.
  (Non-Apify reservation сериализована advisory lock; Apify legacy
  check-then-create ещё требует аналогичной атомарности.)

Acceptance:

- расход объясняется до provider invoice;
- hard limit блокирует новый платный вызов без потери уже найденного lead;
- известна себестоимость пилотного клиента и worst-case exposure;
- тариф не обещает неподтверждённое platform coverage.

### CR-9 — Pilot release и 30-дневное доказательство

Цель: получить доказательства на реальном, ограниченном клиентском scope.

Задачи:

- [ ] Выбрать 1–3 design partners и письменно согласовать coverage.
- [ ] Провести security/privacy/commercial release review.
- [ ] Включить sources сначала в shadow mode.
- [ ] Сравнить результаты с ручной контрольной выборкой.
- [ ] После quality review включить operator feed и AI drafts.
- [ ] Live sends оставить выключенными.
- [ ] Еженедельно проверять quality, freshness, cost и support incidents.
- [ ] Зафиксировать missed mentions и root causes.
- [ ] Провести backup/restore и incident game day.
- [ ] По итогам 30 дней принять `GO`, `EXTEND` или `NO-GO` по каждому platform
  route и всему продукту.

Acceptance:

- пройдены gates раздела 6;
- нет необъяснённых silent gaps;
- качество и стоимость находятся в договорных пределах;
- клиент понимает ограничения и подтверждает ценность workflow;
- существует подписанный launch decision record.

## 8. После пилота

### P1 — общий коммерческий запуск

- [ ] Резервный provider для критических платных routes.
- [ ] Self-service тарифы, usage enforcement и invoicing integration.
- [ ] Scheduled/white-label reports и клиентские alerts.
- [ ] Webhook/API export для enterprise клиентов.
- [ ] SSO/SAML и расширенные audit/export controls.
- [ ] Формализованные SLA, support tiers и status page.
- [ ] Повторяемый onboarding без участия разработчика.
- [ ] Capacity/load tests на планируемое число tenants/sources.
- [ ] Disaster recovery с утверждёнными RPO/RTO.

### P2 — контролируемые live-ответы

- [ ] Выбрать одну owned platform и один low-risk content class.
- [ ] Провести provider sandbox send/read-back.
- [ ] Провести internal canary с emergency stop owner.
- [ ] Включать только tenant/platform/connection/subject allowlist.
- [ ] Требовать двух разных людей для request и approval.
- [ ] Сверять provider result через reconciliation.
- [ ] Автоматически выключать route при policy/capability drift.
- [ ] Публиковать клиенту полный audit.

Автопубликация без человека рассматривается только после отдельного набора
качества, нескольких месяцев безопасных approved sends и нового risk review.

### P3 — расширение продукта

- [ ] Дополнительные licensed providers и регионы.
- [ ] Competitor/campaign benchmarking.
- [ ] Продвинутая detection координированных атак.
- [ ] Предиктивная viral/risk аналитика.
- [ ] Enterprise data residency и customer-managed keys при наличии спроса.

## 9. Задачи, требующие владельца

Claude/Codex должен продолжать остальные независимые задачи, но остановиться на
конкретной операции, если требуется:

- API key, client secret, token или вход во внешний кабинет;
- оплата тарифа или подписание provider contract;
- принятие ToS/DPA или юридическое решение;
- выбор pilot price, SLA, retention или country policy;
- подключение реальной страницы/профиля клиента;
- sandbox/live действие от имени реального аккаунта;
- предоставление размеченных клиентских данных;
- необратимое удаление production data;
- включение любого live-send flag.

Отсутствие одного внешнего решения не блокирует независимые code/tests/docs задачи
других этапов. Блокер фиксируется evidence, route остаётся `BLOCKED`, работа
продолжается по безопасным независимым пунктам.

## 10. Правила автономной работы Claude/Codex

1. Прочитать корневой `AGENTS.md`, этот документ и
   `social-monitoring-v2-architecture-plan.md` полностью.
2. Работать от актуального чистого `origin/main` в отдельном worktree.
3. Перед изменением проверить фактическое состояние: checkbox не является
   доказательством реализации, а наличие кода не является production proof.
4. Выполнять этапы CR-0 → CR-9 по порядку.
5. Не повторять уже реализованный архитектурный PR1–PR6.
6. Один logical slice — один path-scoped commit; не использовать `git add .` или
   `git add -A`.
7. После каждого slice обновлять checkbox и добавлять evidence: commit, тесты,
   migration/browser/runtime proof и известные ограничения.
8. Не сохранять секреты, cookies, access tokens или production payloads в git,
   prompts, fixtures, screenshots и logs.
9. Не выполнять платный provider call без budget/authorization.
10. Не включать live sends и не обходить API browser automation/scraping.
11. Не называть route production-ready без реального proof.
12. Если проверка не выполнена, писать `NOT RUN`/`BLOCKED`, а не `passed`.
13. После завершения этапа самостоятельно переходить к следующей независимой
    задаче; обращаться к владельцу только по правилам раздела 9.

## 11. Проверки по умолчанию

Выбирать минимальный набор по риску и дополнять targeted tests этапа:

```bash
pnpm typecheck:social
pnpm i18n:check
pnpm test -- --run src/__tests__/<target>.test.ts
git diff --check
```

Для schema/RLS изменений дополнительно:

```bash
pnpm prisma validate
pnpm prisma generate
```

Использовать фактические Prisma scripts проекта, если package scripts отличаются.
Migration replay, cross-tenant RLS и production deploy выполняются по процедурам
`AGENTS.md`, [`DEPLOYMENT.md`](./DEPLOYMENT.md) и
[`clients/registry.json`](../clients/registry.json).

UI изменения проверяются в `/social-monitoring` на desktop и narrow viewport.
После запрошенного production deploy сначала проверяется `/api/v1/ping`, затем
source/readiness/feature-specific smoke. Проверка не должна создавать mention,
provider spend или внешний reply без явной необходимости и разрешения.

## 12. Evidence log

Добавлять записи только после фактической проверки.

| Этап | Статус | Commit/PR | Проверки | Ограничения/следующий шаг |
| --- | --- | --- | --- | --- |
| Baseline architecture PR1–PR6 | VERIFIED | См. `social-monitoring-v2-architecture-plan.md` | Schema/RLS/tests/build/browser evidence записаны в архитектурном плане | Live flags не включены; реальные provider sends не выполнялись |
| Codex readiness continuation (задачи HANDOFF №1–4) | VERIFIED (safe implementation) | draft PR #304, ветка `codex/social-readiness-continue-20260712` | Aggregate verification: 90 test files PASS, 1 skipped; 546 tests PASS, 1 skipped; `typecheck:social` PASS; translation parity PASS (RU/AZ missing=0, extra=0); PII columns lint PASS (61 columns / 19 routes); CR-8 ledger SQL executed on empty local pgvector PostgreSQL PASS; `git diff --check` clean | Проверены только безопасные code paths без paid/live provider calls. External credentials, pricing, invoices, owner rate card, реальные data/canary и legal decisions не имитировались и остаются BLOCKED/NOT RUN в соответствующих CR |
| YouTube hybrid discovery + gated replies | VERIFIED (safe implementation) / NOT RUN (live canary) | draft PR #304, commits `061d855ae`, `f7543c949`, `662ecac28` | Aggregate social selection: 91 test files PASS, 1 skipped; 554 tests PASS, 1 skipped; targeted YouTube discovery/watchlist/manual URL tests 5/5 PASS; outbound/OAuth/capability tests 50/50 PASS; open battle-mode/budget regression 29/29 PASS; `typecheck:social`, targeted ESLint, RU/EN/AZ parity, PII lint и `git diff --check` PASS | Keyword/subject `search.list` → video posts → all comment/reply pages, external channel `UC`/`@handle`/URL watchlist и direct video URL реализованы. `comments.insert` publisher закрыт `youtube.force-ssl`, `canReply`, identity, approval и PR6 gates. Денежные caps отключены владельцем до SaaS pricing; остаются quota/maxItems/cadence/rate limits. Live flag не включался, API key/OAuth/quota/sandbox send-readback и browser UI после deploy — `NOT RUN` |
| YouTube discovery/reply критический code review + pagination guard | VERIFIED (safe implementation) / NOT RUN (live canary) | draft PR #304, ветка `codex/social-readiness-continue-20260712` (review commit) | Критический ревью hybrid discovery + gated reply путей по списку рисков (tenant/RLS, дубли, pagination loops, quota amplification, неверный channel/video ID, ответ не в тот thread, истёкшие OAuth, external reply без `canReply`/`allowExternalReply`, обход approval/outbox, мутация текста после approval, resend после unknown). ПОДТВЕРЖДЕНО безопасным: enqueue `idempotencyKey` dedup; separate-approver; approval-hash re-check (`sha256(replyText)`) блокирует мутацию; `evaluateOutboundReplyGates` энфорсит `allowExternalReply && youtubeCanReply` для external YouTube; publisher `network_error → outcome UNKNOWN → RECONCILIATION_REQUIRED` без авто-ретрая (нет дубля), `reconcile` без `externalReplyId` остаётся UNKNOWN; OAuth callback под `runWithTenant`, reconnect сбрасывает `outbound{LiveEnabled,Capability,VerifiedAt}`; UC-ID валидируется `^UC[\w-]{20,}$`; comment/reply пагинация ограничена монотонным `foundCount<maxItems`. НАЙДЕНО+ИСПРАВЛЕНО (1): `search.list` цикл не имел repeated-token guard (в отличие от legacy `pollYouTubeAccount`) → на all-duplicate странице `videoIds`/`foundCount` не растут, а провайдер, повторяющий `pageToken`, крутит цикл до исчерпания квоты (quota amplification). Добавлен `seenSearchPages` guard + `rawStats.searchPageTokenRepeated` + регресс-тест. Verification: 91 файл / 555 тестов PASS, 1 skipped; `typecheck:social` PASS; RU/EN/AZ parity PASS; PII lint PASS; `git diff --check` clean | Live flag не включался; реальные YouTube API key/OAuth/quota canary и sandbox send/read-back — `NOT RUN` до owner credentials; paid/live provider calls не выполнялись |
| Fresh-database migration chain | PARTIAL (replay repaired; schema parity debt remains) | draft PR #304, ветка `codex/social-readiness-continue-20260712` | Изолированный PostgreSQL 16 + pgvector: все 311 migrations применены с нуля, `prisma migrate status` — up to date; regression tests 22/22 PASS; Prisma validate/generate PASS. Исправлены отсутствующие prerequisite tables/columns, FK order в health и qualified ChannelConfig backfill | `prisma migrate diff` после успешного replay всё ещё показывает исторический drift от прежнего `db push`: 45 отсутствующих таблиц, отсутствующие legacy-поля/FK/indexes и многочисленные различия имён/defaults. Fresh install уже не падает на migration replay, но его нельзя объявлять schema-equivalent/DR-ready до отдельной идемпотентной baseline/catch-up migration и повторного `No difference detected` |
| CR-0 | VERIFIED (impl) | ветка `claude/leaddrive-v2-autonomous-0btdk4` (capability inventory + coverage-contract API/UI + template) | `typecheck:social` PASS; `i18n:check` PASS (parity); social suite 86 файлов / 530 тестов PASS, 1 skipped (PR6 opt-in DB); targeted ESLint PASS; `git diff --check` clean | Production readiness snapshot реального tenant `NOT RUN` (deploy/prod-gated); `next build --webpack` — webpack-компиляция и пререндер 773/773 статических страниц прошли ✓, финальный standalone-copy упал на `EMFILE` из-за sandbox-лимита `nofile=4096` (hard), не дефект кода — на прод-сервере с бóльшими лимитами шаг проходит; клиент только type-import из `capability-inventory`, серверный код в bundle не попадает |
| CR-1 | PARTIAL | ветка `claude/leaddrive-v2-autonomous-0btdk4` (error classifier + class-aware circuit breaker + runbooks); ветка `codex/social-readiness-continue-20260712` (generic replay + opt-in paid-route budget guard + stale-lease reaper + YouTube pagination) | Базовые reliability checks: `typecheck:social` PASS; social suite 88 файлов / 548 тестов PASS, 1 skipped. Replay: 3 test files / 30 тестов PASS. Budget guard и open battle-mode покрыты тестами. Reaper: 2 / 14 PASS. YouTube pagination: 1 / 7 PASS. Targeted ESLint PASS; `typecheck:social` PASS; `git diff --check` clean | Generic replay не делает provider fetch; reaper fenced; YouTube watermark не двигается на partial pagination. По решению владельца USD enforcement выключен до SaaS pricing (`SOCIAL_MONITORING_ENFORCE_USD_BUDGETS=1` включает сохранённый guard). 14-дневный canary/SLO dashboards/alerts остаются runtime-gated |
| CR-2 | PARTIAL | ветка `claude/leaddrive-v2-autonomous-0btdk4` (offline evaluator); ветка `codex/social-readiness-continue-20260712` (normalization + feedback/RLS/weekly report) | Normalization: 3 файла / 23 теста PASS. Feedback slice: 4 файла / 27 тестов PASS; Prisma validate/generate PASS; migration replay + schema diff `No difference detected`; `NOSUPERUSER NOBYPASSRLS` same-tenant INSERT PASS, cross-tenant INSERT rejected; RLS context gaps 0; `typecheck:social` PASS; targeted ESLint PASS; `git diff --check` clean | Реальный ≥500-элементный gold dataset остаётся BLOCKED на owner-provided labels; живые quality thresholds NOT RUN |
| CR-3 | BLOCKED (external) | — | — | Каждая задача (official canary FB/IG/YouTube/Telegram/VK/TikTok, платный X route, licensed provider/Apify выбор) требует credentials, provider/договор или owner-authorized sandbox action (§9). Безопасная инфраструктура готова: capability-proof модель + verify-роут (PR2), deterministic route compiler, honest coverage inventory (CR-0) — фиксируют proof и держат непроверенные routes `BLOCKED`/`BEST_EFFORT` без имитации. Разблокирует владелец |
| CR-4 | BLOCKED (external) | — | — | OCR/ASR provider keys + budget и allowlisted asset resolver — owner-gated (§9). Безопасная база готова (PR4): SSRF-hardened Vision client, cover-first cascade, tenant budgets/reservation, purge + deletion ledger, face matching отсутствует. Production provider proof разблокирует владелец |
| CR-5 | PARTIAL | ветка `claude/leaddrive-v2-autonomous-0btdk4` (offline AI-gate evaluator + расширенные safety-категории) | `typecheck:social` PASS; gate-тесты 10 PASS; broad social suite 99 файлов / 658 тестов PASS, 1 skipped; targeted ESLint PASS; `git diff --check` clean | Расширены forbidden gates (9 категорий вкл. threats/political/financial/injection); живая draft-quality (acceptance/edit distance) и реальный evaluation set — owner/runtime-gated |
| CR-6 | BLOCKED (external) | — | — | Юридический review категорий/формулировок + Terms/Privacy/DPA/subprocessors — owner/legal-gated (§9). Безопасная база готова (PR5): candidate/case/evidence/event/action/approval модели, human-only promotion, immutable legal snapshot |
| CR-7 | PARTIAL | — | — | Onboarding wizard, checklist, role-структура и preflight readiness реализованы (PR3/PR5 + CR-0 coverage inventory); onboarding rehearsal не-разработчиком и support/status-page процесс — owner-gated |
| CR-8 | BLOCKED (external decisions) / PARTIAL (implementation) | ветка `codex/social-readiness-continue-20260712` (derived billable-unit ledger + margin calculator) | 5 test files / 40 тестов PASS; targeted ESLint PASS; `typecheck:social` PASS; empty local pgvector PostgreSQL ledger SQL smoke 1/1 PASS; `git diff --check` clean | Ledger даёт daily/monthly units, actual cost и reserved maximum exposure; margin без owner rate card честно `UNCONFIGURED`. `STORAGE_GB_DAY`/`RETENTION_GB_DAY` — `UNAVAILABLE`. Pilot price/limits/scenario multipliers/overage, реальные invoices и dashboard UI остаются owner/external-gated; Apify reservation race — code follow-up |
| CR-9 | BLOCKED (external) | — | — | Нужны design partners, письменный coverage-договор, security/privacy/commercial release review и 30-дневный canary — целиком owner-gated (§9) |
| CR-0 production snapshot | VERIFIED | prod tenant `brandprotection`, SHA `88ddf52bc` (2026-07-12) | `GET /api/v1/social/coverage-contract` → 200 (authorized admin session, secret-free payload): 22 rows — CONFIGURED 16 / BLOCKED 3 / IMPLEMENTED 3 / PRODUCTION 0 / SANDBOX 0; UI «Карта покрытия» показывает те же числа; `/api/v1/ping` → 200 `{ok,db:ok,orgCount:6}` | Runtime-состояние сборщиков: 31 источник, 30 с ошибками (Apify 402 — payment blocker §9), покрытие `partial`, найдено 24ч 0; лента: 6 постов / 0 комментариев, live-send выключен на каждом уровне UI. Production coverage НЕ заявляется: 0 PRODUCTION/SANDBOX proofs |
| Интеграция #304 → post-#305 main | VERIFIED | ветка `claude/social-monitoring-client-readiness-20260712` (merge `codex/social-readiness-continue-20260712` поверх `88ddf52bc`) | Merge без конфликтов (#305 — cherry-pick подмножества той же ветки; из пересечения semantically new только `usdLimitsConfigured` в route budget + YouTube target help). Повторный прогон на слитом дереве: `typecheck:social` PASS; social suite 91 файл / 560 тестов PASS, 1 skipped; i18n parity PASS; `lint:pii-columns` 61/19 PASS; RLS context gaps 0; `prisma validate`/`generate` PASS; `git diff --check` clean | Backdated repair-миграции идемпотентны (IF NOT EXISTS → checkpoint no-op на прод-БД); правка `20260518120000_health` — no-op для развёрнутых БД (fix-forward `20260519230000` уже в main). Локальный полный migration replay на слитом дереве NOT RUN (выполнен в #304 на 311 миграциях до merge); прод-деплой — решение владельца |

## 13. Стартовый prompt для Claude

```text
Работай в LeadDrive v2 от актуального чистого origin/main.

Source of truth коммерческой готовности:
docs/SOCIAL-MONITORING-CLIENT-READINESS.md

Целевая техническая архитектура:
docs/social-monitoring-v2-architecture-plan.md

Сначала полностью прочитай AGENTS.md и оба документа. Проверь git status,
origin/main и фактическое состояние кода. Архитектурные PR1–PR6 уже реализованы:
не повторяй их.

Выполняй CR-0 → CR-9 строго по порядку, начиная с первого незавершённого пункта.
Каждый logical slice заверши targeted tests, path-scoped commit и evidence-записью
в readiness-плане. Не затрагивай посторонние изменения и не используй git add .

Official/connected/licensed routes имеют приоритет. Apify допускается только как
маркированный best-effort fallback после policy/capability проверки. Не обходи
ограничения платформ browser automation, captcha, proxy или скрытым scraping.

Live sends остаются выключенными. Не выполняй платные вызовы, внешние отправки,
подключение реальных аккаунтов или необратимое удаление без явного разрешения.
Никогда не сохраняй секреты в git или prompt.

Продолжай все независимые задачи автономно. Обращайся к владельцу только когда
нужны credentials, внешний кабинет, оплата/договор, юридическое решение, реальные
клиентские данные, pricing/SLA/retention choice или разрешение sandbox/live action.
Если route нельзя доказать, сохрани evidence, оставь его BLOCKED и продолжай
другие безопасные независимые задачи.
```
