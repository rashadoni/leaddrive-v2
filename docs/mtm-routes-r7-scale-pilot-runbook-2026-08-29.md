# MTM Routes R7 — масштаб, пилот и операционный runbook

**Статус:** R7 scale/pilot gate отложен владельцем; подготовительный контракт
сохранён, gate не пройден.

**Дата:** 2026-08-29
**Связанные документы:**
[`mtm-routes-module-redesign-plan-2026-08-28.md`](./mtm-routes-module-redesign-plan-2026-08-28.md),
[`mobile-sync-scalability-plan-2026-08-28.md`](./mobile-sync-scalability-plan-2026-08-28.md),
[`mtm-routes-r4-provider-boundary-2026-08-28.md`](./mtm-routes-r4-provider-boundary-2026-08-28.md)

Этот документ задаёт воспроизводимый путь к R7, но не заменяет фактические
query-plan, нагрузочный запуск, rollout или человеческое подтверждение.
Он не меняет schema, state machines, compatibility endpoints, tenant/RLS scope
или provider policy.

## Граница текущего среза

Существующие compatibility endpoints остаются каноническими для поддерживаемых
клиентов. Новые v2-журналы изменений и opaque cursors не включают новый client
cohort сами по себе. Нельзя трактовать наличие кода journal/keyset как
доказательство масштабирования или как разрешение на rollout.

Следующее намеренно **не реализовано и не включено** этим срезом:

- `MtmRouteOptimizationJob`, worker, retry/dead-letter или per-tenant fairness;
- автоматическое изменение порядка точек, traffic ETA или durable provider
  result;
- вызов Google Routes, включение tenant travel toggle либо provider budget;
- migration, index или schema cleanup без query-plan evidence;
- deployment, push, pilot cohort или изменение production data.

Это сохраняет R4 boundary: при недоступности provider пользователь продолжает
ручное планирование и v1 sync, а provider result не становится источником
бизнес-факта.

## Состояние R7 gate

| Требование плана | Статус | Что требуется для доказательства |
| --- | --- | --- |
| Workload model: 100 tenants / 5 000 users | DEFERRED BY OWNER | Synthetic dataset и scale/noisy-neighbor load test в текущей поставке не требуются; approved envelope сохранён только для будущей реактивации |
| Keyset и indexes по фактическим query plans | DEFERRED BY OWNER | Candidate catalog имеет keyset path; планы всех hot paths и доказательства индексов не снимались, index не добавлялся |
| Async optimization jobs с fairness | NOT IMPLEMENTED | Google Essentials выбран только для bounded manual preview; решение о fairness, provider calls beyond preview и storage для optimization всё ещё требуется, затем отдельный additive schema/worker review |
| Метрики, SLO и alerts | DEFERRED BY OWNER | Ceiling сохранён для будущей реактивации; endpoint profile, runtime wiring, alerts и наблюдение не требуются в текущей поставке |
| Два пилота и human usability sign-off | DEFERRED BY OWNER | Pilot не требуется в текущей поставке |
| Нет noisy neighbor / P0/P1 | NOT CLAIMED | Только результат нагрузочного запуска, incident review и rollout evidence могут это подтвердить |

## 1. Workload model без выдуманных нагрузок

Зафиксированные планом размеры — это минимальная форма тестового набора, а не
заявление о текущей production-нагрузке:

Владелец явно отложил создание этого набора и выполнение scale/pilot gate в
текущей поставке. Ни один synthetic tenant/user/route/visit не создаётся в
текущем окружении; текст ниже — сохранённый contract для отдельной будущей
реактивации, а не задача к немедленному запуску.

- 100 tenant-ов и 5 000 provisioned users;
- для крупнейшего tenant-а — до 1 000 одновременно активных сотрудников
  (решение владельца от 2026-08-29); это число пользователей, а не
  неподтверждённая частота одновременных HTTP-запросов;
- из них — до 200 сотрудников, одновременно выполняющих операции отправки или
  обновления данных на пике (решение владельца от 2026-08-29). Это также не
  задаёт requests-per-minute: один сотрудник может ожидать ответ, повторять
  операцию либо временно работать offline;
- утверждённый R7 rate envelope: `200` логических send/update-операций в
  минуту как обычный пик и `400`/мин не более пяти минут после контролируемого
  ramp-up. Это не переводится автоматически в HTTP RPM: endpoint allocation и
  SLO всё ещё должны быть owner-approved;
- каталог не менее 1 000 доступных целей для planner;
- team-week представление не менее 500 сотрудников;
- маршруты, точки, визиты, change requests и sync journal распределены между
  tenant-ами неравномерно, чтобы проверить изоляцию noisy-neighbor;
- tenant/RLS context устанавливается тем же application role, что и у
  приложения; bypass role не является доказательством результата.

Для каждого tenant-а набор должен содержать как минимум пустой, малый и крупный
маршрутный scope, route/point updates, потерю назначения с tombstone и активный
visit. Данные — только synthetic или обезличенная восстановленная копия в
изолированной БД; в артефакты не попадают customer names, адреса, device IDs,
полные cursor-ы и provider credentials.

Перед нагрузочным gate всё ещё должны быть подтверждены владельцем:
endpoint-level request mix для этих 1 000 сотрудников, распределение размеров
маршрута, доля offline устройств, period aggregation/alert routing и допустимая
стоимость provider-а. Concurrent/rate envelope и общий SLO ceiling уже
утверждены, но без endpoint allocation и изолированного target-а нельзя честно
запустить arrival-rate сценарий или доказать SLO.

Консервативный non-executable coverage-профиль для уже известных **read** hot
paths лежит в
[`mtm-routes-r7-request-mix-proposal-2026-08-29.md`](./mtm-routes-r7-request-mix-proposal-2026-08-29.md).
Он распределяет 200 scenario slots, но не подменяет собой request mix: не
утверждает RPM, SLO или write/collision-нагрузку и не разрешён для запуска.
Владелец утвердил обратимый rate envelope: `200` логических операций в минуту
и короткий burst `400`/мин до пяти минут. Endpoint-level request mix,
write/collision allocation и SLO этим решением не утверждены.

Base-stage manifest также требует coverage существующих compatibility write
paths: route draft create/update, publish, direct visit action, web sync
check-in/checkout/action и mobile v1 sync check-in/checkout/action. Их
неутверждённый split, fixture lifecycle и collision boundary документированы в
том же proposal; он не меняет эти endpoints и не включает provider calls.

### 1.1 Fail-closed preflight profile

[`scripts/mtm-routes-r7-load-preflight.mjs`](../scripts/mtm-routes-r7-load-preflight.mjs)
закрепляет без выполнения нагрузки только подтверждённый owner envelope:
`100` tenant-ов, `5 000` provisioned users, `1 000` одновременно активных
сотрудников, до `200` одновременных send/update-операций, `200` logical
ops/min normal peak и burst `400` logical ops/min до пяти минут в крупнейшем
tenant-е.
Команда ниже безопасна на Contabo: она не
читает target, не вызывает provider и не запускает k6.

```bash
npm run mtm:r7:preflight
```

Перед heavy-runner/CI оператор обязан подать versioned JSON с request mix и
SLO для всех обязательных hot paths и явно подтвердить isolated
production-like target. Даже `--assert-ready` проверяет только локальные JSON
и environment preflight; он не запускает нагрузку:

```bash
MTM_R7_TARGET_KIND=isolated-production-like \
MTM_R7_ISOLATED_TARGET_CONFIRMATION=confirmed \
MTM_R7_REQUEST_MIX_FILE=/secure/path/request-mix.json \
MTM_R7_SLO_FILE=/secure/path/slo.json \
npm run mtm:r7:preflight -- --assert-ready
```

Request mix должен задать положительный `requestsPerMinute`, а SLO —
`p95Ms`, `p99Ms` и `maxErrorRate` для каждого hot path. Значения намеренно не
выведены из числа concurrent users. Для v2 stage manifest дополнительно
требует snapshot/delta paths и не является разрешением на cohort rollout.
Для каждого path допустимы только более строгие значения, чем утверждённые
ceiling: `p95Ms <= 1000`, `p99Ms <= 2000`, `maxErrorRate < 0.01`.
Оба JSON также должны быть явно помечены `"approvalStatus": "OWNER_APPROVED"`;
это fail-closed защита от случайного запуска proposed-профиля, а не замена
фактическому подтверждению владельца.

Утверждённая политика error rate —
`SYSTEM_ERRORS_EXCLUDE_EXPECTED_BUSINESS_CONFLICTS`: ожидаемый business
conflict (включая documented `409 ROUTE_VERSION_CONFLICT`) записывается
отдельным `outcome` и не расходует `maxErrorRate`. Его нельзя просто скрыть:
отчёт обязан показать count/rate конфликтов отдельно. Неожиданные ошибки и
незадокументированные конфликты остаются системными ошибками.

## 2. Query-plan и index protocol

Полный build/E2E или нагрузочные запросы не запускаются на Contabo. Query-plan
capture выполняется через разрешённый heavy runner либо CI против isolated
production-like PostgreSQL copy.

1. Зафиксировать commit SHA, PostgreSQL version, schema/migration version,
   dataset manifest и application role; проверить RLS с `app.org_id` для
   отдельного малого и крупного tenant-а.
2. Для каждого hot path снять `EXPLAIN (ANALYZE, BUFFERS, SETTINGS, FORMAT
   JSON)` с реальными параметрами scope и keyset cursor. В публикуемом отчёте
   literals заменяются на тип/диапазон, а не копируются PII/cursors.
3. Обязательные paths: catalog candidates (первая и последующая keyset page),
   route list/range, route detail с точками, team-week, visit list/workspace,
   v1 mobile week/pull, route draft create/update, publish, direct visit action,
   web/mobile v1 sync check-in/checkout/action и, после отдельной активации,
   каждый v2 stream snapshot и delta page.
4. Для каждого плана записать estimated/actual rows, loops, planning/execution
   time, shared/local/temp buffers, sort/hash spill, index chosen и tenant size.
5. Добавлять index только при воспроизводимом доказательстве: почему текущий
   plan не ограничен, какой exact predicate/order его использует и как новая
   структура проверена под RLS. Additive migration и rollback plan оформляются
   отдельным safety-lane checkpoint.
6. Повторить capture при конкурентных publish/change decisions и при
   simultaneous крупном candidate/sync tenant-е. Любое ухудшение другого
   tenant-а — failed gate, а не повод увеличить global limit.

Результат не считается пройденным по одному `EXPLAIN` без `ANALYZE`, по
superuser query без RLS или по локальной Contabo базе с нерепрезентативным
объёмом.

## 3. Наблюдаемость и SLO contract

Ниже — обязательная taxonomy для будущего runtime wiring; перечисление не
означает, что метрики уже экспортируются.

| Серия | Назначение | Допустимые dimensions |
| --- | --- | --- |
| `mtm_route_request_duration_ms` | Latency route/visit/planner paths | `operation`, `outcome` |
| `mtm_route_candidate_page_duration_ms` / `mtm_route_candidate_page_rows` | Keyset catalog page | `outcome`, `page_kind` |
| `mtm_route_change_decision_duration_ms` | Publish/change decision path | `operation`, `outcome` |
| `mtm_route_travel_preview_duration_ms` / `mtm_route_provider_failure_total` | Travel preview и controlled provider failures | `provider`, `outcome`, `failure_code` |
| `mtm_mobile_sync_v2_stream_duration_ms` / `mtm_mobile_sync_v2_payload_bytes` | Будущий snapshot/delta stream | `stream`, `phase`, `outcome` |
| `mtm_mobile_sync_v2_tombstone_total` / `mtm_mobile_sync_v2_resnapshot_total` | Scope loss и retention pressure | `stream`, `reason` |
| `mtm_route_optimization_queue_age_seconds` / `mtm_route_optimization_fairness_wait_seconds` | Будущая job queue | `outcome` только после owner-approved job design |

Ни одна metric label не содержит tenant, user, device, route, customer,
coordinate, cursor, operation ID или свободный provider error. Tenant-specific
разбор производится через защищённый audit/log correlation с установленным
tenant context, а не через high-cardinality labels.

Текущая реализация добавляет только Pino structured events с этой allowlist для
travel preview и route-notification outbox. Это полезная безопасная основа для
операционного разбора, но не Prometheus/OpenTelemetry exporter, dashboard или
alert sink. `mobile-sync-scalability-plan` называет tenant одним из необходимых
измерений; до подключения внешнего metric sink должна быть отдельно утверждена
защищённая bounded aggregation/attribution модель. Raw tenant ID нельзя
безусловно перенести в label только ради выполнения этого списка.

`mobile-sync-scalability-plan` предлагает исходные sync SLO, включая p95 delta
pull до 500 changes и age critical outbox operation. Для R7 владелец утвердил
общий ceiling: p95 не более 1 с, p99 не более 2 с и system error rate строго
меньше 1%; endpoint profile может сделать отдельный path только строже. Всё
ещё нужно утвердить period aggregation, alert routing и границы provider
quota/cost. Alert должен срабатывать по stream/outcome и error budget, а не по
усреднённой latency всех tenant-ов. Классификация ожидаемых business conflicts
для error rate также утверждена.

## 4. Provider outage и rollback

R4 расчёт остаётся default-off и transient. При provider timeout, quota/rate
limit, invalid credential или Redis protection failure:

1. Зафиксировать безопасный failure code без credential, точек или полного
   provider response.
2. Не менять route state, point order, published snapshot, visit, sync cursor
   или evidence; не ставить provider error как completed calculation.
3. При подтверждённой проблеме оператор может выключить tenant travel toggle
   либо `GOOGLE_MAPS_ROUTES_EXECUTION_ENABLED=false` через утверждённую
   конфигурационную процедуру. Этот документ не выполняет это действие.
4. Сохранить ручной порядок, manual publish, compatibility sync и
   user-initiated navigation. Пользователь получает честный retry-later status,
   а не автоматически пересобранный маршрут.
5. Не удалять audit/change journal/evidence и не очищать caches с pending
   offline operations. После восстановления provider повторный preview требует
   обычной scope/version проверки.

Поскольку durable provider result и optimization job ещё отсутствуют, rollback
не включает migration/down SQL, queue purge или массовую компенсацию данных.
Если они будут введены, для них нужен отдельный reversible runbook до первого
tenant cohort.

## 5. Pilot и support evidence

Pilot начинается только после подтверждённых query-plan, runtime metric и
security results. Минимум два tenant-а, в каждом — как минимум один агент и
один руководитель; они не должны быть одной и той же наблюдаемой сессией.

Для каждой сессии фиксируются без PII:

- build/SHA, capability/config state, device class, OS, orientation и язык;
- вход через Today, открытие маршрута, resume active visit, обязательное
  evidence, explicit checkout и conflict/permission explanation;
- phone и tablet отдельно, включая landscape, 200% font scale и TalkBack на
  физическом Android; desktop/tablet planner — mouse, keyboard и touch;
- offline → process death → reconnect, потеря назначения и two-device case;
- provider-disabled path и, только если отдельно разрешён, controlled provider
  failure;
- наблюдаемое время/ошибки, support ticket/incident reference и явный
  human sign-off агента и руководителя.

Форма sign-off не допускает «PASS по просмотру кода». Отдельно указываются
found issue, severity, workaround, owner и решение продолжить/остановить cohort.
P0/P1, leakage другого tenant-а, потеря confirmed visit/result или regression
compatibility endpoint немедленно останавливают cohort и запускают incident
разбор; они не маскируются retry или увеличением limit.

## 6. Отложенный gate и будущий безопасный порядок

При отдельной будущей реактивации R7 gate потребуются следующие решения/внешние
доказательства. В текущей поставке эти шаги не выполняются:

1. Владелец утверждает endpoint-level request mix, period aggregation и alert
   routing. Workload envelope, SLO ceiling и error classification уже
   утверждены. Cost/quota для Google manual preview уже ограничены отдельным
   `50/day` pilot contract, но это не является разрешением на rollout.
2. Владелец либо отклоняет async optimization, либо задаёт его fairness policy
   (например, isolation/weight/limit на tenant) и подтверждает, допустимы ли
   provider calls beyond manual preview и durable result storage. Только после
   этого возможны additive `MtmRouteOptimizationJob` schema и worker design.
3. Для v2 Visit/Media stream владелец утверждает offline/history horizon и
   способ выдачи media: metadata-only либо scoped signed access. До решения
   journal остаётся write-side foundation, а новый reader cohort не включается.
   Route-only horizon уже зафиксирован отдельно и не переносится на эти stream.
4. Команда выполняет query-plan/load capture на разрешённом heavy runner/CI и
   прикладывает evidence перед любой index migration.
5. После runtime observability — два пилота и независимые human sign-off.

При реактивации следующий безопасный технический шаг — подготовить isolated
production-like dataset и capture harness вне Contabo. Никакой rollout,
provider execution, schema migration или user-facing promise о R7 готовности
не допускается до выполнения перечисленных gates.
