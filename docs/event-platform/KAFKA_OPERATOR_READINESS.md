# A5 operator readiness и A7: карта незакрытых доказательств

Срез: 19 октября 2026, `origin/main` 226dde0e7. Это подготовка, не разрешение
активации. A5 соответствует K5 backlog; A7 — K7 recovery drills и проверке
полноты K6 по всем доменам. Ни один новый бизнес-consumer не подключён.

## A5: проверенные границы и очередь

| Граница | Что действительно есть | Чего нет / приёмка следующего шага |
|---|---|---|
| Authenticated operator admission | `projection.ts` требует разные строки requester/approver; SQL проверяет согласованность promotion evidence/pointer | Это не authentication. Нужны две отдельные admissions из доверенных session/JIT identities, tenant permission, срок действия, revocation, request hash и одноразовое atomic consume; тело запроса не задаёт identity. Повтор/конкуренция/отзыв/чужой tenant должны отказать до mutation |
| Tenant/build | Fund shadow worker проверяет tenant, build, version, code SHA, role; restricted SQL/RLS и inbox защищают транзакцию | Отдельный operator scope должен совпадать с неизменным планом, artifact digest, cluster/topic ID, group и диапазоном. A1/A2 `worker-admission.ts`/`worker-artifact.ts` подготовлены только в e298057; не продублированы здесь. Проверка формы плана не выдаёт authority |
| Lease/fencing | Bridge assignment fence; worker-session прекращает intake/ACK и ждёт SQL settlement; effect ledger имеет собственные lease tokens | Нет durable operator/worker ownership lease с CAS generation, expiry/revoke и проверкой перед SQL/pointer switch. Kafka membership не заменяет SQL ownership. Уже начатая SQL может закончиться после revoke; нельзя объявлять stop раньше settlement/actual child close |
| Stop/restart | В main есть finite session, owned child supervisor, без auto-restart; исторический PR889 receipt покрывает два bounded stop/restart сценария | Не доказан standalone direct-JVM production composition. A1/A2 новые реальные integration NOT RUN; их receipts должна получить исходная сессия. Stop при lost DB/child hang/lease expiry требует controller evidence |
| Catch-up | Inbox/checkpoints, deterministic Fund reducer и versioned shadow | Нет end-to-end controller: pinned source/cluster/topic identity, полный диапазон без retention gaps, финальный watermark, lag/age soak, count/value/hash/aggregate parity, tenant isolation. Равные итоги не доказывают равенство истории |
| Promotion | SDK + SQL atomic promotion event/read pointer, request dedupe и независимые identity strings | Authenticated admission, lease race, финальная parity в согласованном fence, реальный canary read path и domain read-pointer integration не доказаны. Общий pointer SDK не делает Fund read cutover готовым |
| Rollback | Runbook определяет переключение pointer с сохранением source events | Нет доказанного controller/read path и нагрузки. Старый build должен быть сохранён и достаточно актуален; проверить совместимость, обратный CAS pointer, effect/write fence и rollback window. Старые таблицы без catch-up не гарантируют безопасный откат |
| External effects | `effects.ts` запрещает shadow/replay effects, registry пуст; SQL ledger, token/attempt и UNKNOWN reconciliation contracts | Live legacy senders обходят общий outbox. Проверять каждый API/cron/provider tail. UNKNOWN никогда не означает automatic resend. Lease projection и lease external effect — разные границы |
| Alarm delivery | Старый activation-preflight проверяет boolean monitoring gates | Новый `operator-alert-evidence.mjs`: отдельный inactive verifier десяти read-back receipts. Не подключён к activation и не отправляет тревоги. Реальная доставка, получатель и authentic provider adapter ещё НЕ ДОКАЗАНЫ |

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
ещё не равно A5 readiness. Новый gate пока также не исполняется автоматически
в CI; его explicit command указан в журнале.

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
| finance | Пять canonical Fund v1 events: opened, transaction-recorded, metadata-updated, archived, reactivated; PaymentWebhookEvent отдельно | Fund balance; invoices/receivables/budgets не покрыты пилотом | Payments/refunds/accounting exports | Fund command receipts/inbox; payments имеют отдельный bounded inventory, не общий effect proof | Fund decimal reducer в isolated build; остальная Finance требует event coverage | Fund reversal/correction, full CDC A1/A2 receipts, history completeness; payment UNKNOWN/refund/dual writes |
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

1. Исходная сессия получает exact-head реальные A1/A2 CDC/worker receipts
   для e298057 lineage; эта ветка их не запускает и не меняет чужие gates.
2. Следующий A5 software slice: durable operator request + две authenticated
   admissions, immutable scope/hash и atomic consume/revoke. Сначала non-production
   restricted-SQL tests: wrong tenant/build/artifact, self-approval, expired/revoked,
   повторный consume и конкурентный lease generation; ни одного live operation.
3. Затем scoped controller stop/settle/lease, catch-up manifest/final parity,
   CAS promotion/read integration, rollback compatibility/window под нагрузкой.
4. Отдельно создать trusted receipt read-back adapter и staging challenge drill
   для десяти alarms; online delivery не выводится из unit fixtures.
5. A7 для каждого домена: exhaustive writers/effects → concrete schema/atomic
   append → inbox/effect keys → wrong reducer fixture → correction rebuild →
   exact parity → crash/duplicate/UNKNOWN → archive restore → operator drill.
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
