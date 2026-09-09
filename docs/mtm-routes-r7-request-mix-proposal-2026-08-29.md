# MTM Routes R7 — proposed coverage profile

**Статус:** `PARTIALLY_APPROVED` — владелец утвердил concurrent/rate envelope,
SLO ceiling и классификацию ожидаемых conflicts, но endpoint-level request mix
и write/collision allocation остаются `PROPOSED_UNAPPROVED`; документ не может
использоваться для `--assert-ready` или запуска нагрузки.

**Дата:** 2026-08-29
**Связанный runbook:**
[`mtm-routes-r7-scale-pilot-runbook-2026-08-29.md`](./mtm-routes-r7-scale-pilot-runbook-2026-08-29.md)

## Назначение и граница

Владелец подтвердил, что в крупнейшем tenant-е до 1 000 сотрудников могут быть
одновременно активны, а до 200 из них на пике выполняют отправку или обновление
данных. Это не даёт частоту запросов: сотрудник может ожидать ответ, повторять
операцию или работать offline.

Поэтому этот документ распределяет ровно 200 **scenario slots** только между
существующими обязательными R7 read hot paths. Один slot означает primary read
action одного data-active сценария в точке выборки. Он не равен одновременному
HTTP-запросу, connection или разрешению запускать нагрузку.

## Консервативная гипотеза интенсивности

Владелец утвердил обратимый стартовый профиль, который разделяет число активных
пользователей и arrival rate:

- **обычный пик:** `200` логических send/update-операций в минуту — в среднем
  одна операция на каждого из 200 data-active сотрудников за минуту;
- **короткий burst:** `400` логических операций в минуту не более пяти минут
  после контролируемого ramp-up; это проверяет двукратный всплеск и не
  объявляет его production forecast;
- **параллельность:** до `200` data-active virtual users, отдельно от arrival
  rate, чтобы ухудшение latency не уменьшало заданную интенсивность скрыто.

Логическая операция не всегда равна одному HTTP request: create/publish или
sync batch могут содержать несколько вызовов. Перед `--assert-ready` оператор
раскладывает approved envelope в owner-approved `requestsPerMinute` по
endpoint-ам и задаёт SLO. Без этого approved envelope не запускается. Google
Routes и другие provider calls остаются выключенными, поэтому этот профиль не
добавляет provider cost.

Утверждённый SLO ceiling для каждого path: `p95Ms <= 1000`, `p99Ms <= 2000`,
`maxErrorRate < 0.01`; endpoint profile может быть только строже. Ожидаемые
business conflicts учитываются отдельно от `maxErrorRate`.

## Base-stage coverage proposal

| R7 hot path | API template / основной consumer | Slots | Доля | Почему включён |
| --- | --- | ---: | ---: | --- |
| `planner_candidates_first_page` | `GET /api/v1/mtm/routes/candidates` с `agentId`, `startDate`, `direction`, `period=5_DAYS`, `sort`, `pagination=keyset`, `limit`; `route-builder.tsx` | 25 | 12.5% | Начальная выборка с facets и keyset scope |
| `planner_candidates_next_page` | Тот же endpoint с opaque `cursor` | 10 | 5% | Лишь часть пользователей листает дальше первой страницы |
| `route_list_range` | `GET /api/v1/mtm/routes` с bounded `start`, `endExclusive`, `limit`, `page` | 15 | 7.5% | Неделя/диапазон маршрутов |
| `route_detail_points` | `GET /api/v1/mtm/routes/{routeId}` | 15 | 7.5% | Гидратация деталей и точек выбранного маршрута |
| `team_week` | `GET /api/v1/mtm/week` с `days`, `anchor`, `locale` и scope filters | 20 | 10% | Snapshot крупной команды |
| `visit_list` | `GET /api/v1/mtm/visits?limit=200&range=7d` | 20 | 10% | Список визитов и history range |
| `visit_workspace` | `GET /api/v1/mtm/visits/{visitId}/workspace` | 20 | 10% | Relation-heavy drilldown рабочего места визита |
| `mobile_v1_week` | `GET /api/v1/mtm/mobile/week?start=YYYY-MM-DD` | 35 | 17.5% | Совместимый mobile aggregate |
| `mobile_v1_pull` | `GET /api/v1/mtm/mobile/sync/pull` с legacy mobile JWT, bounded `entities`, `limit`, `offset` | 40 | 20% | Совместимый delta/initial pull |
| **Всего** |  | **200** | **100%** |  |

Таблица намеренно не является JSON input для preflight. Перед запуском оператор
должен преобразовать её и гипотезу интенсивности в owner-approved профиль с
`requestsPerMinute` и SLO для каждого path; просто перенести slot-числа в RPM
нельзя.

`mobile_v1_pull` должен вызываться harness-ом с legacy mobile JWT contract.
Текущий LeadShelf SyncManager использует свой BFF path, поэтому нельзя
приписывать прямой endpoint текущему экрану без явного harness contract.

## Proposed write/collision profile

Ни одна строка ниже не является owner-approved endpoint request mix. Это
обратимый synthetic baseline, который переводит утверждённый logical envelope
в первичный coverage plan, не меняя canonical state machines или compatibility
endpoints. Первый запуск использует sync batches размера `1`, поэтому одна
logical write operation соответствует одному HTTP push; другой размер batch
должен получить отдельное подтверждение.

| R7 hot path | Compatibility endpoint и безопасный fixture contract | Normal logical ops/min | Burst ops/min |
| --- | --- | ---: | ---: |
| `route_draft_create` | `POST /api/v1/mtm/routes`; новый seeded route/date/points на каждую итерацию, только `DRAFT`, без повторного dedupe key | 8 | 16 |
| `route_draft_update` | `PUT /api/v1/mtm/routes/{id}` с текущим `expectedVersion`; обычные updates сериализованы по route/version | 22 | 44 |
| `route_publish` | `POST /api/v1/mtm/routes/{id}/publish` с текущим `expectedVersion`; fresh DRAFT с ≥1 точкой и разрешённым publisher | 10 | 20 |
| `visit_action_direct` | `POST /api/v1/mtm/visits/{id}/actions`; CHECKED_IN scoped visit и явно seeded optional action/result ID | 20 | 40 |
| `web_sync_checkin` | `POST /api/v1/mtm/sync/push`; unique UUID `operationId`, scoped customer, `visits/create` + `kind=checkin` | 20 | 40 |
| `web_sync_checkout` | Тот же web endpoint; active seeded/created visit, UUID `operationId`, `visits/update` + `kind=checkout` | 20 | 40 |
| `web_sync_visit_action` | Тот же web endpoint; active visit, explicit compatible action snapshot, UUID `operationId` | 20 | 40 |
| `mobile_v1_sync_checkin` | `POST /api/v1/mtm/mobile/sync/push` с mobile JWT, stable `clientId`, unique UUID, `visits/create` | 30 | 60 |
| `mobile_v1_sync_checkout` | Тот же mobile v1 endpoint; active scoped visit, unique UUID, `visits/update` → `CHECKED_OUT` | 20 | 40 |
| `mobile_v1_sync_visit_action` | Тот же mobile v1 endpoint; `visitActions/create`, scoped active visit/action, unique UUID | 30 | 60 |
| **Всего** |  | **200** | **400** |

Fixture controller обязан соблюдать lifecycle check-in → action → checkout,
использовать изолированные synthetic tenants/agents и не смешивать test
operation IDs между агентами. В первом run исключены delete/cancel, manager
force check-in, conflict override, Next Action/task creation, media/photos,
messages/HRM, workdays, route IDs/points и Google preview.

### Отдельный collision cohort

Collision — не часть success-path 200/400 и не должен раздувать нормальный
throughput. Минимальный отдельный сценарий: две параллельные `PUT` на fresh
draft route с одним `expectedVersion`; ожидается ровно один success и один
`409 ROUTE_VERSION_CONFLICT`. Он не делает retry с новым semantic operation и
фиксирует idempotency/conflict outcome отдельно от latency SLO.

По решению владельца ожидаемый business conflict не входит в системную error
rate: harness обязан вывести его отдельный count/rate и не учитывать в
`maxErrorRate`. Это относится только к заранее заданным fixture-сценариям;
неожиданный `409` или иной failure остаётся системной ошибкой.

До owner-approved JSON остаются незафиксированными endpoint-level RPM,
распределение read requests относительно writes, batch/payload size и SLO.
Поэтому preflight намеренно не принимает эту таблицу как executable profile.

## V2 boundary

`mobile_v2_route_snapshot` и `mobile_v2_route_delta` исключены из base-stage:
reader default-off и cohort не утверждён. После отдельного решения v2 coverage
должен накладываться на тех же пользователей, а не прибавлять ещё 200; для обоих
streams нужны зарегистрированное устройство, соответствующие credentials,
cohort policy, RPM и SLO.
