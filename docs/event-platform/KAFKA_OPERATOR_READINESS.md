# A5 operator readiness и A7: карта незакрытых доказательств

Срез: 19 октября 2026: Kafka base421260026, проверенный `origin/main`
9cd84838d (последующие изменения Support/demo/CI не меняют Kafka contracts).
Это подготовка, не разрешение
активации. A5 соответствует K5 backlog; A7 — K7 recovery drills и проверке
полноты K6 по всем доменам. Ни один новый бизнес-consumer не подключён.

## Актуальное состояние (заменяет исторические оценки ниже)

A1/A2 доставлены исходной сессией через PR891 в main421260026. На exact source
2936f4c2 успешны оба задания `cdc-smoke` и `full-cdc-fund` в
[отдельном upstream run39170670645](https://github.com/rashadoni/leaddrive-v2/actions/runs/39170670645).
Это bounded CDC/worker evidence исходной сессии; оно не доказывает production
TLS/ACL, весь Finance или операторскую готовность. Упоминания pending/NOT RUN
A1/A2 ниже — исторические срезы, а не текущее состояние upstream.

Эта ветка добавляет inactive authenticated admission/lease, stop challenge,
canonical snapshot/canary collectors и tenant source barrier. Изолированная
fixture-композиция связывает проверенный snapshot, точный material hash,
свежий barrier, promotion event, pointer CAS и deferred COMMIT admission.
Она не содержит установленного controller или genuine physical-stop/restore/
alarm receipts и не устанавливается миграцией или приложением. Отдельный
inactive verifier теперь проверяет семь signed-purpose attestations, canonical
source/shadow/checkpoints и регистрирует evidence отдельным именованным логином.
Tenant/key-policy, lease и verifier recheck действуют до final COMMIT; реальных
producer/adapter/key provisioning в этом изменении нет. Material capped по
строкам/1MiB, превышение отвергается, производительность больших tenants не доказана. Hosted [run39177477825](https://github.com/rashadoni/leaddrive-v2/actions/runs/39177477825)
на exactbd8f89872 прошёл298/298:214 unit +17 admission +8 shadow +9 stop +
24 actual-schema reader/canary +8 barrier +18 atomic transition/registry/material.
Это заменяет ранние249/297 оценки, сохраняя их в append-only журнале. Signed
claims и ключи fixtures синтетические; реальные operational observations этим
не получены.

Collector проверяет все поля provenance реального worker и точное соответствие
checkpoint lastEventId → inbox topic/partition/offset. Более новый broker offset
для duplicate event без отдельного durable byte/position receipt консервативно
не сертифицируется. Семантика самого worker не изменена.

## A5: проверенные границы и очередь

| Граница | Что действительно есть | Чего нет / приёмка следующего шага |
|---|---|---|
| Authenticated operator admission | Inactive SQL: разные authenticated session identities requester/approver, immutable scope/hash, atomic consume, expiry/revocation и final COMMIT checks | Runtime identity provisioning/JIT, tenant authorization integration и controller endpoint отсутствуют; fixture principals не production identity proof |
| Tenant/build | Worker checks tenant/build/version/SHA/role; A1/A2 worker-admission/artifact contracts уже в main; operator plan дополнительно pins environment/artifact/cluster/topic/group/action/pointer/evidence | Genuine release/artifact/broker identity resolution и domain-specific authorization в controller; форма плана не выдаёт authority |
| Lease/fencing | Inactive durable request generation/lease, fresh token checks, stop challenge и transaction-scoped source barrier | Runtime owner/observer delivery и deployment installation отсутствуют; уже начатую SQL/child нужно наблюдать до реального settlement |
| Stop/restart | Finite owned session/child, upstream bounded CDC worker proof; private one-use observer challenge с deferred acceptance | Physical observer process/SQL/ACK instrumentation, direct-JVM deployed composition, hung child/lost DB и truthful receipt proof |
| Catch-up | Actual-schema readonly canonical collector, full worker provenance, exact checkpoint/inbox positions, recovery manifest gate | Genuine frozen broker end/retention, archive/restore, soak и independent provenance; newer-offset duplicate без byte/position receipt отвергается |
| Promotion | Actual event/pointer guards, restricted canary reader; fixture-only canonical material/barrier/build/event/CAS/settlement composition | Hosted final composition result см. session log; trusted adapter/key provisioning и runtime executor, first-pointer policy и application cutover не реализованы |
| Rollback | Fixture retained build/window + reverse CAS; final expiry rollback и read adapter contract | Genuine retained/caught-up compatibility, workload drill, correction policy и promoted continuous lifecycle |
| External effects | Shadow/replay effect denial, empty active registry, ledger UNKNOWN/lease/attempt contracts; fixture fences effect intents | Live legacy senders обходят общий outbox; all-path API/cron/provider audit и UNKNOWN reconciliation обязательны; projection lease не effect lease |
| Alarm delivery | Inactive verifier десяти read-back/ack receipts с independently pinned authority; unit evidence | Authentic provider read-back adapter, actual rule triggers, delivery/recipient acknowledgement и durable challenge proof; реальных отправок здесь нет |

### Ограниченный компонент этого изменения

`verifyOperatorAlertEvidence(evidence, expected, readReceipt)` принимает только
полный набор gate → receipt ID. Controller обязан независимо задать environment,
releaseSha, changeId, уникальный challengeId, destinationId, responderId,
доверенные UTC now и maxAgeMs (1..86400000). Все десять gate обязательны:
connector failure, outbox age, WAL, free space, under-replication, consumer lag,
schema rejection, quarantine, archive lag, tenant parity.

Для каждого ID доверенный **read-only** adapter читает authoritative receipt:
те же scope/pins/gate/ID, `status=delivered`, `acknowledged=true`, ordered
triggeredAt ≤ deliveredAt ≤ acknowledgedAt ≤ now, trigger не старше policy.
Provider «accepted» не считается доставкой. Дубликаты, отсутствующие gates,
неверные scope, старые/future receipts и adapter errors дают одинаковый
sanitized отказ. Input evidence не содержит URL или callback authority.

Этот verifier — контракт для будущего controller, а не authenticated admission,
не подпись receipt и не защита от поддельного adapter. Controller должен
получать adapter из серверной конфигурации, authentic read-back/ack identity,
секреты из secret manager и свежий одноразовый challenge из durable хранилища.
Повторная offline validation допустима; одноразовое admission consume ещё
предстоит реализовать. Нельзя передавать из HTTP body ни adapter, ни trusted
expected, ни clock. Staging drill должен реально вызвать каждый alert rule,
получить read-back и acknowledgement ответственного, сохранить receipt hashes
и ссылку на exact SHA. Здесь сеть и отправки не вызываются.

Существующий activation preflight и его проверки не изменены: их green всё
ещё не равно A5 readiness. Его unit cases теперь исполняются в isolated operator CI; genuine delivery
этим не доказывается (ранние сведения о ручном запуске superseded).

## A7: правила чтения карты 27 доменов

Источник totality — `src/lib/event-platform/catalog.ts`, не количество строк
большого human catalog: cross-cutting capabilities распределены между доменами.
Источники: `MODULE_EVENT_CATALOG.md`, `NON_FUND_WRITE_PATH_INVENTORY.md`,
`WRITE_PATH_INVENTORY.md`, Prisma schema и реализация `src/lib/event-platform`.
Имена существующих моделей/локальных журналов ниже — реальные записи в коде,
но не доказательство полной immutable history или использования Kafka.
Предлагаемые event families из catalog не переименованы здесь в реализованные.
По вертикалям выполнена сверка schema/catalog; полный аудит каждого writer
**NOT RUN**. Там нельзя утверждать наличие дедупликации или безопасного rebuild.

Для **каждой** строки открыты общие доказательства G:
atomic command/event/outbox; schema/sequence/full history; duplicate/crash до и
после COMMIT/ACK; tenant/build isolation; full shadow rebuild без effects;
per-aggregate count/value/hash/invariants; correction drill; archive watermark /
independent restore; authenticated catch-up/promotion/rollback под нагрузкой.
Fund имеет bounded доказательства части G, не закрытие всего набора.

«Безопасный rebuild» ниже — требование к будущему изолированному пути, не
готовая команда. Запрещено вызывать live API/cron/send/provider tails для rebuild.

| domainId | Реальные факты / наблюдаемый источник | Производное состояние | Внешние эффекты | Идемпотентность: есть / требуется | Безопасный rebuild: граница | Отсутствующие доказательства сверх G |
|---|---|---|---|---|---|---|
| crm | Company/Contact/Task/Activity CRUD, локальный ContactEvent; inspected REST chains в inventory | Связи, timeline, boards/search | Notifications, automation tails | Merge/request keys и atomic canonical receipt ещё нужны; DB row ID не dedupe команды | Версии identity links + shadow views, без hooks | Полный writers/imports/merge inventory; correction links и PII policy |
| sales | Lead/Deal stages, quotes, sequences; send-email chain inspected | Pipeline, forecast, quotas, sequence progress | Offer/email и task creation | send-email route не передаёт effect key; нужен recipient/step key | Recorded stages/commitments → shadow, без sequence runner | Все offer/stage/sequence entrypoints; accepted commitment history |
| contracts | Contract versions/approvals; EsignAuditEvent, ContractApprovalEscalationEvent в schema | Active version, approval queue, renewal | E-sign envelope, reminders | Нужны business approval/envelope keys и provider receipt hash; coverage неизвестно | Immutable signed artifact refs + ordered decisions, без e-sign calls | Все writers, delegated approval order, provider UNKNOWN/reconcile |
| marketing | Campaign sends, JourneyEnrollment, touchpoints; scheduled claim и sourceKey inspected | Audience/journey, attribution, counters | Email/SMS/WhatsApp/Telegram/ad activation | scheduled→sending claim ограничен; manual statuses и per-recipient receipt не покрыты | Consent/versioned inputs → isolated attribution/audience, без sends | Manual/scheduled races, partial delivery, A/B/sequences/tracking completeness |
| loyalty | LoyaltyTransaction/Account/Redemption; partial hook inventory | Points/tier/liability | Fulfilment и notifications | Нужен unique business award/redeem key на всех writers; partial hooks не whole-domain proof | Ordered ledger + formula/policy version, без awards/fulfilment повторно | Ledger immutability/sequence/corrections, expiration, concurrent redeem |
| omnichannel | ChannelMessage, provider ingress и Chatwoot claims; inspected inventory | Conversation/unread/queue/delivery | Messages/read receipts/auto-reply | Chatwoot durable claim/hash/UNKNOWN; Meta и email/SMS partial keys; Telegram whole-handler claim не установлен | Verified ingress receipts → shadow timeline, без webhook/flow replay | Alternate direct sends, missing IDs, downstream crash tails, all transports |
| social | IngestEnvelope, OutboundSocialReplyEvent, SocialLegalEvent, deletion ledger | Mentions/classification/cases/evidence | Crawl, publish, legal/takedown sends | Сохранить existing receipt/evidence/action IDs; all-writer coverage не установлена | Hashed/versioned evidence + recorded classifications, без crawl/publish | Approval/provider capability, immutable evidence, deleted-source/privacy policy |
| voip | CallEvent и call request/callback paths; inventory | Call queue/timeline/usage/consent | Dial, recording retrieval, callbacks | Stable call/effect key + callback scope нужны на всех путях | Recorded lifecycle, encrypted recording refs, без dial | Provider ambiguous start, suppression/consent race и all-path receipts |
| support | Ticket/comments, EntitlementAuditEvent; inspected email intake | SLA clocks, queues, entitlement state | Closure/survey/email/WhatsApp/escalation | Optional comment clientRequestId; missing keys не dedupe; intake tails раньше log check | Deterministic clock inputs/receipts → shadow, без ticket factory hooks | Intake re-delivery order, alternate callers, SLA/jobs/portal, entitlement consume |
| finance | Пять canonical Fund v1 events: opened, transaction-recorded, metadata-updated, archived, reactivated; PaymentWebhookEvent отдельно | Fund balance; invoices/receivables/budgets не покрыты пилотом | Payments/refunds/accounting exports | Fund command receipts/inbox; payments имеют отдельный bounded inventory, не общий effect proof | Fund decimal reducer в isolated build; остальная Finance требует event coverage | Fund reversal/correction, full history и operational proof; upstream bounded CDC receipt выше не покрывает весь Finance; payment UNKNOWN/refund/dual writes |
| analytics | Reports/metrics definitions и queries; canonical facts кроме Fund не установлены | Dashboards/KPI/forecast/report snapshots | Export/report delivery | Нужны build/source watermark и stable export key | Versioned deterministic queries по approved facts, без source writes | Late events, exact history, metric versions, scale/RTO и all-source coverage |
| mtm | Mobile command receipts/sync; MtmAgentWorkdayEvent, workforce events, pharmacy event/points ledger | Route/visits/attendance/timesheet/points | Route notices, reward fulfilment | Сохранить operation/command IDs и policy versions; нет общей Kafka admission | Separate routes/workforce/pharmacy shadow scopes, short-retention location | Все mobile/offline/sync writers, sequence gaps, approvals/corrections, points effect fences |
| health | HealthPatient/Encounter/CarePlan state; canonical events не установлены | Authorized care timeline/views | Clinical integrations/notifications | Unknown; нужны command/receipt keys, consent-bound identity | Reference-only clinical facts + encrypted storage; no provider calls | Writer audit, PHI classification/erasure/legal hold, schema and correction chain |
| insurance | Policy/Claim/PolicyHolder и rating config state; canonical history не установлена | Coverage/exposure/claim status | Settlement/insurer notices | Unknown; policy/claim decision keys + Finance linkage | Versioned policy/rating and ordered decisions → shadow | All writers, rating version, immutable claim chain и settlement reconciliation |
| public-sector | Citizen/PublicSectorLicense/PublicSectorGrant state | Cases/license/grant workflows | Official notices/disbursements | Unknown; authority/decision/disbursement keys required | Authorized statutory facts, no notice/payment repeats | Writer audit, authority chain, statutory retention и legal hold |
| media | MediaConsumptionEvent, subscriber/inventory/ad placement state | Entitlements/delivery/consumption | Ad provider booking/delivery | Provider delivery IDs требуются; all-path coverage неизвестно | Immutable delivery/consumption inputs; separate high-volume retention | Late/duplicate facts, subscription entitlements, partition/scale budget |
| energy | MeterReading, Outage, MeteringPoint state | Latest reading/billing inputs/outage map | Dispatch/customer alerts | Device/provider reading key + correction identity required | Event-time ordered readings with explicit late policy, без dispatch | Writer audit, reading corrections, retention/late data, billing linkage |
| settings | SubscriptionEvent, AuditLog/ComplianceAuditLog, entitlements, metadata/settings | Permissions/routing/active metadata/cache | Invite/provision/install/import/export | Нужны step/request keys на всех provisioning paths; audit row не receipt | Versioned config at occurrence; separate security domain, no provisioning | All writers/jobs, entitlement monotonicity, secret refs, revoke/erasure/hold semantics |
| ai | AiActionIntentEvent, workflow/config and recorded outputs | Action/workflow state, shadow predictions | Billable model calls и approved actions | Preserve intent/action IDs; full automation coverage не установлено | Recorded model outputs/prompt+model+config hashes; no billable calls | Every trigger/job, approval revocation, deterministic inputs, provider UNKNOWN |
| sms-otp | OtpCode issuance/consumption/cleanup; bounded inventory appendix | Short-lived rate limit/challenge state | SMS delivery | One-use consume отдельно от send dedupe; all races не доказаны | Security audit only; никогда не восстанавливать expired/used live OTP | Concurrent verify, expiry/cleanup races, send UNKNOWN; no OTP/secrets in retained facts |
| commerce | Order/reservation state, StockMovement | Stock available/reserved, fulfilment/returns | Shipment/refund/customer sends | Нужны order/saga/stock command keys и provider reconciliation | Signed stock movements + order facts; no fulfil/refund repeats | All stock writers, available invariant, compensations и partial failure |
| data-cloud | UnifiedProfile/ProfileSource/MergeCandidate/Insight, segment memberships | Identity graph/profiles/segments | Audience activation/export | Нужны source cursor/hash/merge keys; canonical coverage unknown | Versioned identity mapping and consent; disposable shadow | Merge undo/corrections, source completeness, downstream effect bypasses |
| education | EducationCourse/Student/Enrollment state | Rosters/capacity/credentials | Enrollment/credential notices | Stable enrollment/credential key required; coverage unknown | Ordered capacity commitments, no notification tails | Writer audit, concurrent capacity, withdrawal/correction, student privacy |
| financial-services | FinancialHousehold/Account/Goal/LifeEvent state | Household/account/goal views | Institution sync | Provider cursor/receipt key + consent needed; not Finance ledger | Recorded restricted provider facts, no institution calls | Writer audit, full provider history, consent/revocation/credential boundaries |
| nonprofit | Donor/Donation/Grant/VolunteerActivity state | Donor/program impact, restricted funds | Tax receipts/disbursement/refund | Donation/payment/receipt keys + Finance links required | Ordered money/restriction facts, no receipt resend | Writer audit, audit correction chain, tax/legal retention и provider reconcile |
| revenue-recognition | PerformanceObligation/RevenueRecognitionSchedule/Entry state | Deferred/recognized balances/schedules | Accounting posting/export | Immutable policy/period/business posting key needed | Versioned contract/policy/currency and reversals, no postings | Writer audit, closed-period adjustment, balanced roll-forward и approvals |
| tpm | TradePromotion/PromotionTactic/TradeSpend; RetailExecutionAudit | Budgets/accrual/settlement/execution | Activation/retailer sends/settlement | Spend/activation/approval business keys needed | Ordered spend/decision history, no retailer/Finance repeats | Writer audit, ledger sequence, evidence hash, approval and settlement UNKNOWN |

Ни одна строка не помечена «защищена Kafka». Для 26 non-Fund доменов
canonical runtime adoption не доказан; Finance покрыт только конкретным Fund
aggregate. Таблица указывает точные неизвестные, а не вымышленные результаты
проверок. Уведомления и integrations относятся к каждому инициатору; inventory
shared senders/legacy dispatch обязателен перед признанием строки готовой.

## Точный порядок следующей работы

1. Isolated actual-schema transition gate завершён: final-COMMIT expiry,
   scoped PG16 privileges, stale material и pointer races, named verifier/key
   revocation и material caps PASS наbd8f89872.
   Это fixture proof, не runtime activation. Upstream A1/A2 проверены отдельно.
2. Inactive verifier/registration и fixed material budget реализованы; exact
   hosted result этой новой фазы см. session log. Runtime требует независимого
   provisioning tenant signers/key policy, named service login и настоящих
   readonly adapters. Controller не может сам регистрировать verified evidence.
3. Реальный authenticated observer: доставить одноразовый stop challenge,
   наблюдать child/SQL/ACK settlement и независимо читать receipt. Подтвердить
   broker cluster/topic/end positions, retention coverage и lag/age soak.
4. Реальный restricted executor должен объединить эти доказательства с final
   source barrier/CAS, canary application read path, retained rollback и явно
   определённым promoted worker lifecycle. Нужны correction/reversal policy,
   drift denial и first-pointer bootstrap policy, не произвольный SQL endpoint.
5. Trusted provider read-back adapter и staging challenge drill для десяти
   alarms; archive/independent restore/resource drills и activation authorization.
6. A7 для каждого из 27 доменов: exhaustive writers/effects → concrete
   schema/atomic append → inbox/effect keys → wrong reducer fixture → correction
   rebuild → exact parity → crash/duplicate/UNKNOWN → restore → operator drill.
   Начинать с денежных/points/stock/entitlement/provisioning путей из backlog.

HA/TLS/ACL, независимый restore, архив, ресурсный бюджет, реальные owners и
отдельное activation authorization остаются обязательными. Нет автоматического
перехода от подготовки к production startup, offset reset или replay.

## Дополнение: inactive durable admission — 2026-10-19

Первоначальный следующий A5 software slice выше теперь подготовлен в
`ops/event-platform/operator/admission.sql` и отдельном integration fixture.
Это уточняет строки admission/lease, но не превращает их в runtime readiness:
в production ничего не установлено, HTTP API и executor отсутствуют.

Именованные TCP DB-logins дают session_user identity; отдельная закрытая
mapping связывает principal/tenant/capabilities/expiry. Неизменный Fund plan
и DB jsonb hash проходят separate approval, one-time consume с generation,
controller-bound lease, assert-current, revoke и settle. Прямые записи/чтение
control tables недоступны операторам. Полная схема и trust boundary —
[operator README](../../ops/event-platform/operator/README.md).

На ab0aff696 реальный isolated PG16 run39164468500 завершился SUCCESS:
13/13 integration и28/28 receipt units, включая actual concurrent consume,
transaction rollback, TCP identities и revoke serialization. Это доказательство
данного неактивного contract, не A1/A2, Kafka, full rebuild или production.
Последующее усиление role/expiry/revocation coverage требует нового receipt.

Открыты: authentic human/JIT provisioning, web adapter при необходимости,
композиция с restricted business SQL и COMMIT/deadline fence, worker lifecycle,
catch-up/final parity, actual read-pointer promotion/rollback и доставленные
alarms. Возврат токена не разрешает автоматический запуск. Общая доставка
остаётся исходной сессии; draft PR894 не предназначен для merge этой сессией.

### Проверенный итог подготовки

Run39164804703/job117785392405 на code source
52c57a3974a5da74842023c553c824316a6a87b3 — whole SUCCESS:
17/17 реальных PostgreSQL сценариев и28/28 receipt units, cleanup PASS.
Проверены live role revoke, principal remap, expiry, конкуренция consume и
actual deferred-COMMIT rejection с rollback settle/audit. Это supersedes
ожидание нового receipt выше для данного code source. После него изменяются
только документы; исполняемые файлы остаются теми же.

Добавлена deferred lease validation; прежнее замечание о её отсутствии
superseded для isolated contract. Будущий executor всё равно обязан сохранять
deferred-mode и same-transaction guard; raw controller SQL не даёт такой
гарантии. Actual business/read-pointer composition и runtime остаются открыты.

Scan остаётся FAIL из-за exact historical prose fingerprint README82 в
6ca3b5e2e; текущая формулировка исправлена, исключения/history rewrite не делались.
Полные static-checks/typecheck/build — NOT RUN (draft). Реальные alerts,
worker/CDC A1/A2 и бизнес-rebuild/promotion/rollback — NOT RUN этой веткой.
A1/A2 PR891 отдельно наблюдался OPEN на1d526a126f с pending интеграциями;
это не успешный receipt и не основание запускать их из этой сессии.

Разрешённая подготовка данной сессии завершена: два inactive компонента,
их доступные доказательства, runbook/backlog и полная карта27 доменов.
Активация и внедрение всех бизнес-интеграций в исходный scope не входят.
Следующий интеграционный шаг принадлежит исходной сессии: получить A1/A2
receipts и затем соединять эти контракты с restricted shadow controller в
изолированном CI, сохраняя запрет на production/consumers/offsets/sends до
отдельного разрешения. Merge/deploy этой ветки не выполняются.

## Autonomous continuation: catch-up gate and isolated transitions

The prior stopping point was premature: more inactive preparation was possible.
`operator-recovery-evidence.mjs` now validates the approved exact-byte receipt
hash against trusted scope/pointer pins; partition completeness/full-history
start/catch-up/archive positions; stop/SQL-settlement/actual-close references;
zero effects/quarantine; per-aggregate count/version/history/state/decimal and
currency parity; and rollback retention/compatibility/write-fence fields.
36 focused local tests pass, including equal aggregate totals with offsetting
wrong balances. This is manifest consistency, not execution of a real rebuild.
The supplied stop/restore/soak references still need authentic evidence producers.
A start timestamp alone does not prove continuous healthy soak telemetry.

`shadow-fixture.sql` is test-only. Its private synthetic builds/pointers/evidence
register is not the application schema. Seven additional PostgreSQL cases compose
actual named-login admission and trusted-manifest registration with atomic
synthetic promotion/rollback, concurrent pointer CAS, metadata/receipt expiry,
revocation and deferred-COMMIT rollback. Only the fixture owner can register
verified evidence; the controller cannot write the pointer/evidence directly.
It grants no actual business privileges and invokes no Kafka, consumer or send.
Actual results for this new source must be recorded after the dedicated CI run.

A source search of non-test `src` at this baseline found `appendDomainEvent`
callers only in the three Finance Fund REST routes (four call sites), and no
non-test caller of the generic enqueueEffect/promotion helpers outside their
SDK definitions. This corroborates the27-domain map's restricted scope; it is
not proof that every indirect/SQL/legacy writer has been exhaustively inspected.
The shared effect SDK's presence therefore cannot protect legacy sender paths.

### Continuation proof and exact remaining boundary

Actual run39165969550/job117788865931, source
5ad987e953d28c36eedb9bc022eb194abb9973ab: whole SUCCESS,64/64 gate tests
and24/24 real PostgreSQL cases; cleanup PASS. This supersedes the pending
fixture result above. The synthetic pointer composition passed; it does not
establish that real Fund readers support this pointer or that production
rebuilds can run. No actual alert/restore/stop evidence was manufactured.

Remaining **software integration**: connect governed identities and evidence
producers to a restricted real Fund shadow controller/read path, verify actual
build/lease/reader contracts, then full CDC/SQL failure/rebuild drills on the
original session's exact worker source. Current task explicitly limits scope
to preparation and leaves shared delivery with that session; it must not be
silently converted into activation or27 new business integrations.

Remaining **external/authorization gates**: trusted human/JIT provisioning,
actual independently read-back stop/soak/restore/alert receipts, production
HA/TLS/ACL and separate activation authorization. Live consumers/replay and
alert sends remain prohibited here, so their receipts cannot be obtained by
continuing fixture work or substituting booleans. No such task is marked done.

Remaining **delivery blocker**: the scan flags one historical README prose
fingerprint. Current wording is corrected. Passing the historical gate would
require an authorized narrow scanner exception or branch history change;
both are outside the present instructions to preserve checkpoints and not
change others' checks. The failing gate remains intact and PR894 stays draft.

Final test-quality correction: run39166310431/job117789862494 on
40a9b05e90ae3182b3fedf58d14f473473cf304f passed64/64 gates and24/24 real PG
cases. Deferred-COMMIT negative tests now first require successful staged SQL,
so an earlier admission error cannot falsely satisfy them. Concurrent loser
reasons are also constrained. Executable contracts are unchanged by subsequent
documentation; authentic operational evidence and shared runtime delivery
remain open as described above.

## Actual-schema read-only evidence — 2026-10-19

Source465d9b9750cecddf11657145d0cb4d0e7d8233e0, run39167881109 /
job117794570853 whole SUCCESS:91/91 unit gates,24/24 operator PG and10/10
real-schema reader PG cases, cleanup PASS. The reader uses the actual three
unchanged migrations and existing canonical Fund reducer. It is not the earlier
replacement shadow-pointer schema and does not run a consumer.

Verified: canonical/outbox hashes and complete independent Fund inventory;
source/head/active-v1/Fund/shadow/inbox/checkpoint parity; exact NUMERIC(18,4);
shadow lastEventId/time; immutable source fingerprints before/after reading;
real READ ONLY refusal25006; checkpoint rewind guard23514 preserved; FORCE RLS,
no-owner/no-write reader profile; partial/whole-aggregate visibility rejection;
and a consistent RepeatableRead snapshot while another canonical writer commits.
The next collection then rejects the now-stale shadow. Source payloads remain
internal and are not included in the returned evidence.

This DB-only producer leaves broker positions and external evidence explicitly
unverified. All inbox/checkpoint seed positions are synthetic. DB MVCC identity
is not a transfer token for a later promotion. Inventory and reducer provenance
are trusted server inputs, not operator-supplied authority. Caps and strict
baseline parity deliberately reject unsupported large/drift-repair scopes.

### Concrete prerequisites for actual Fund cutover

1. Fund list GET in `src/app/api/finance/funds/route.ts` reads
   `prisma.fund.findMany`; detail GET in `funds/[id]/route.ts` reads
   `prisma.fund.findFirst`. Neither resolves `projection_activations`.
   A generic SDK pointer switch therefore does not switch these responses.
   Add and independently verify an explicitly governed canary/versioned read
   path before treating pointer promotion as a delivered read cutover.
2. `consumeFundShadowRecord` in `fund-shadow-consumer.ts` admits only
   `build.mode=shadow`, `build.status=running`. Generic SDK promotion changes
   that status to `promoted`; blindly combining them stops further shadow
   processing. A1/A2 owner must define/test ready/promotion/active/rollback
   lifecycle and durable admission fencing before that composition.
3. Fund transaction commands validate and update `funds.currentBalance`.
   Replacing a GET response alone does not repair command-side balance checks.
   Define correction authority and approved baseline drift for intentional
   repairs; the current reader requires existing Fund/active-v1 parity and is
   not a bypass for that decision. No history rewrite or direct money patch.
4. A read-only audit snapshot does not freeze ongoing writes/new aggregates
   across a later controller transaction. Final source/broker watermark,
   writer/worker settlement and pointer CAS need a real barrier/transaction
   contract, including concurrent command/new-Fund and SQL-COMMIT failure tests.
5. Stop/soak/archive/restore/alert evidence must come from independently trusted
   producers/read-back. Their synthetic references and booleans are not receipts.
   Current prohibitions prevent obtaining real consumer/replay/send evidence here.

A1/A2 current PR891 was observed DRAFT on
f47224e2b250274278e88e72a08b0c7fe5424ae6 with latest heavy jobs skipped.
Older head1d526a126f successes cannot certify it. This session neither modifies
nor schedules those checks; original-session runtime/delivery ownership remains.
These are exact remaining integration tasks, not reasons to mark A5/K7 ready.

## Canary result contract and exact remaining lifecycle sequence

The inactive `operator-fund-canary.mjs` is only a pure result validator. Its
23 tests prove fail-closed scope/shape behavior, not real pointer reads or
operational freshness. No production API imports it. A rollback changing the
pointer requires a newly independently authorized scope; stale opt-in cannot
silently follow a different build or fall back to the legacy balance.

| Order | Required implementation/evidence | Acceptance boundary |
| --- | --- | --- |
| 1 | Restricted reader adapter reads activation/build/Fund rows in one read-only snapshot | Actual migrations, real restricted login/RLS, exact pointer string, missing/foreign rows and concurrent rollback tests; validator alone insufficient |
| 2 | A1/A2 owner reconciles running → verifying → promoted worker lifecycle and lease generation | Authenticated controller, expired/revoked lease and stop races deny writes; promoted worker continuation explicitly specified and tested |
| 3 | Final source barrier and complete aggregate inventory | Writers/new aggregates settled; authenticated broker partition/end evidence and SQL checkpoint settlement bound to the same approved promotion; old MVCC receipt insufficient |
| 4 | Real admission + final verification + generic pointer CAS composition | One transaction and deferred final lease check, stale approval/build/evidence/CAS denial; no arbitrary controller SQL or effects permissions |
| 5 | Canary API opt-in with preserved response contract | Separate authorized activation; Fund list/detail and transaction commands reconciled, no default routing change in this preparation |
| 6 | Retained rollback and correction authority | Explicit money invariants for intentional drift, version-compatible ongoing writes, independent approval and actual restore proof; no synthetic balance corrections |
| 7 | Authentic operational evidence | Actual stop/catch-up/soak, external effects denied, delivered-and-acknowledged alerts independently read back; simulated receipts insufficient |

Steps 2–7 stay with the original delivery session and require its frozen A1/A2
source. Consumers, offsets/replay, provider sends and production mutations are
outside this session's authorization. All 27 domain rows above retain their
individual missing-evidence requirements; this Fund-only contract upgrades none
of the other domains to protected or recoverable status.

## Inactive transactional canary reader continuation

A restricted reader adapter is now prepared in
`scripts/event-platform/operator-fund-canary-reader.mjs`; this supersedes the
prior statement that only a pure validator exists. It is not wired to Fund API.
In one read-only RepeatableRead snapshot it checks exact login, four FORCE-RLS
read-only table profiles (including column grants), the pointer/build contract,
complete visible source-head inventory and per-Fund event/version parity.
A new aggregate or subsequent source write denies stale data rather than using
legacy balances. Monetary correctness still depends on independently verified
reducer/history evidence; matching event IDs alone does not establish it.

The same disposable actual-schema fixture exercises genuine promotion/rollback
constraints, concurrent rollback visibility, stale opt-in rejection, RLS/grants,
read-only enforcement, source lag and new aggregates. Test seed approvals remain
synthetic and are not authentic operational approval evidence. No running worker,
Kafka consumer, broker offset, replay, provider send or production is involved.
The real checkpoint migration also refuses writes for promoted builds: resolving
worker admission alone cannot close lifecycle step2. Authenticated real pointer
mutation composition, final barrier and operational evidence remain unimplemented.

## Stop read-back and bounded lifecycle contract

Inactive `operator-stop-evidence.mjs` adds the missing read-back step beyond a
recovery manifest's bare close-receipt reference. The existing exact-byte
recovery gate runs first; independently pinned stop request/generation/process/
challenge/observer then bind one trusted read-only receipt. It checks exact
scope and broker incarnation, fresh ordered intake/ACK/SQL/checkpoint/child-close
stages, zero outstanding counts and all final next-offset checkpoints. Expected
scope is copied before await; JSON is bounded and adapter errors sanitized.
No observer/receipt producer is installed, and its tests prove validation only.
The result does not certify restore/soak/alert references or consume a challenge.

The compatible bounded lifecycle is a terminal canary snapshot, not a continuing
promoted worker. This specifies future composition; no runtime is wired:

| Phase | Existing state allowed | Required boundary before the next phase |
| --- | --- | --- |
| Shadow processing | running | Current authenticated admission/lease, exact build and effects fence; existing worker/checkpoint guards stay intact |
| Stop and settlement | running, then verifying | Intake and ACK fenced; all SQL settled; final persisted checkpoints observed; actual child close independently read back and pinned to stop request/generation |
| Final verification | verifying, then ready | Source/barrier and full parity rechecked under the actual mutation transaction; fresh independent approval; a historical close record alone does not exclude a later writer |
| Pointer promotion | ready → promoted | Authenticated restricted pointer CAS, deferred final lease validation and exact approved evidence; no checkpoint or shadow-worker continuation after promoted |
| Canary reads | promoted | Exact pinned pointer, complete visible inventory and per-row source head in one restricted snapshot; any subsequent source drift denies the read |
| Retained rollback | promoted retained target | New independent authority and current evidence/barrier, version/retention compatibility and pointer CAS; old scope fails on the next reader snapshot |

A continuous promoted projection requires a separately designed writer/build and
checkpoint lifecycle. Changing either current status guard alone is unsafe and
is not implemented. No source-write freeze is inferred from this table. Until
real barrier/executor/observer composition is proven, neither terminal promotion
nor continuous processing is operationally ready.

## Durable stop challenge continuation

The inactive `stop-challenges.sql` addon now prepares the previously missing
durable one-time challenge store. Separate observer DB logins cannot request,
approve or consume operator admissions, self-register as controllers, replace
receipts or access business tables. One challenge binds one current stop lease,
process and observer principal. Scoped JSON claims are registered once with
server registration time and audit actors; the assigned controller reads them
in a genuine read-only transaction, verifies the prior stop gate, then accepts
the exact stored hash once. Row locks and deferred final lease/challenge/observer
checks protect acceptance and settlement. No runtime installs this contract.

This supersedes only “challenge store absent” as a software-preparation gap.
Real process observation/provenance, challenge delivery, current broker/SQL/ACK
instrumentation, final source barrier, actual pointer executor and later scoped
historical evidence retrieval remain absent. The store authenticates a login's
claim; it cannot establish physical process truth or exclude a later writer.
Mock closed-process data in a real PostgreSQL test is not a completed stop drill.
None of the27 domain rows or G evidence sets is upgraded by this addon.

## Transactional source-write barrier preparation

The inactive source-barrier kernel plus separate fixture attachment now prepare
the missing source-freeze primitive for the Fund control transaction. Shared
transaction advisory locks on six actual source/projection tables prevent a
current controller from acquiring the tenant's exclusive lock while a writer
is active; later participating writes fail while it is held. No business grants,
app wiring, migration or production trigger installation is included.

The private request/generation/backend/xid8 handle is valid only in the acquiring
transaction, and acquisition fails on wrong isolation or incomplete/modified
ALWAYS trigger coverage, including inheritance. Old/new tenant scopes are both
checked. A shared-table guard also affects non-Fund rows for that same tenant;
this is a conservative tenant source boundary, not general adoption of their
domains. Other tenant writers can proceed. Schema-owner DDL stays trusted/frozen.

This supersedes only “source-barrier primitive absent” as a preparation gap.
Final parity/broker/worker evidence, source reads after acquisition, current
build/lease verification and actual pointer CAS have not been composed in one
restricted executor. Read-only snapshots from a prior transaction cannot serve
as that final verification. Physical observer and broker receipts remain absent;
none of the27 domain G evidence sets is closed by this primitive.


### Verifier/material provisioning boundary

The new registry and signed verifier remain inactive. The canonical collector's
nine-table RLS check does not by itself provision ledger access for the separate
material hash: the hosted fixture explicitly adds FORCE RLS/tenant policy on
legacy fund_transactions and a separate SELECT grant to its restricted reader.
The material function separately refuses missing ledger FORCE RLS, inherited
ownership or even column-only DML grants. No production RLS migration or ledger
permission change was made. A future
runtime installation must independently prove this extra boundary and all scoped
source/read-only grants before enabling material certification. Generic app.org_id
context is not tenant authorization. Fixed caps do not prove index/scan/RTO cost.


### External prerequisites and ownership after this preparation

No missing network/physical fact can be replaced by a fixture or signed self-claim.
Original session «Проверить защиту Kafka-консюмера» owns overall delivery.

| Owner | Concrete action, once prerequisites/authorization exist |
|---|---|
| Owner personally | Decide whether to republish a clean-history PR while preserving PR894/checkpoints: the historical prose scan finding cannot be removed by an ordinary follow-up commit and gate/history rewriting is not authorized |
| Owner personally | Approve a named isolated staging tenant/build, independent signers, receipt archive and alert destination, plus explicit permission for real consumers/replay/drill sends; these operations remain forbidden here |
| Original delivery session | Provision the chosen service identities/key policy and configure real readonly DB/receipt/key/archive adapters for createFundEvidenceVerifier; no fixture module may be used |
| Original delivery session | Execute the seven-purpose real acceptance procedure in PROJECTION_RECOVERY_RUNBOOK.md, retaining authentic signed bytes and exact release/manifest/material hashes |
| Owner personally | Choose first-pointer bootstrap, Fund correction/reversal and promoted-worker lifecycle policy; terminal stopped canary is the only currently specified bounded design |
| Original delivery session | After those decisions, implement/verify application cutover and lifecycle/correction drill using the existing guards; keep all27 domains gated by their A7 writer/effect/history evidence |
| Production workflow | Only after separately authorized reviewed merge, release the immutable main artifact through .github/workflows/deploy.yml and verify SHA-bound post-deploy smoke; no feature deployment |

Whole-app static/typecheck/build remain draft-skipped; making PR ready also
triggers separate Kafka/consumer gates and is outside the present no-consumer
boundary. This task does not weaken draft gates, rewrite history, merge red or
activate business integrations to produce a green badge.
