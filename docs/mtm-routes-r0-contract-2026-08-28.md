# MTM «Маршруты» — R0: обратимый contract baseline

**Статус:** реализовано без миграции данных. Этот R0 checkpoint был создан до
решений владельца из раздела 15; актуальные решения 15.1–15.5 записаны в
основном плане и не меняют его compatibility boundary.

## Граница R0

R0 не меняет `MtmRoute`, `MtmRoutePoint`, `MtmVisit`, их state machines,
идемпотентность или compatibility URLs. Это server-first additive split
исторического MTM entitlement на две runtime capability:

- `route-field` — маршруты, визиты, полевые задачи и связанные Route & Field
  API;
- `workforce-hrm` — рабочий день, табель и HRM decisions.

Старый `mtm` читается как совместимый grant обеих возможностей. Новые
одобрения/enable записывают только отдельный ключ capability. Явный `false`
от soft-disable имеет приоритет над старым `mtm`, не удаляет историю и не
требует migration/backfill. Rollback — удалить split key/восстановить его в
`features` и `modules`; данных домена R0 не меняет.

## Four-mode contract

| Комплектация | Навигация | Exact API boundary | Mobile bootstrap |
| --- | --- | --- | --- |
| Ни одной | Route & Field скрыт | proxy возвращает 403 до handler | 403 `TENANT_CAPABILITY_DISABLED` |
| Только Routes | routes/visits и собственная полевая смена | Route & Field разрешён, HRM 403 | route manifest и минимальное own-workday состояние; без HRM stream |
| Только HRM | Route & Field не показывается | HRM разрешён, Route & Field 403 | HRM manifest и workday; route target/sync streams отсутствуют |
| Обе | обе области доступны по своим permission/scope | каждый handler проверяет свою capability | оба module flags и полный v1 route stream |

Edge proxy допускает сессию с любой из двух capability только в compatibility
namespace `/api/v1/mtm/*`. Это не является авторизацией к mixed endpoints:
каждый переклассифицированный Route & Field/HRM handler выполняет точный
tenant gate внутри RLS. Не классифицированные commercial/mixed endpoints до
решения владельца сохраняют старый `mtm` gate.

## Golden flows, зафиксированные R0

1. Admin включает/soft-disable только Route & Field, не меняя исторический
   `mtm` и не включая Workforce HRM.
2. Routes-only web/API-key и mobile caller проходит route wrapper после
   стандартного RBAC/RLS, может начать/завершить только собственную полевую
   смену для GPS и запуска маршрута, а HRM endpoint получает canonical 403.
3. HRM-only mobile caller получает bootstrap и workday, но не получает route
   targets или route sync stream.
4. Legacy MTM tenant продолжает видеть обе capability, пока один из split keys
   явно не выключен.
5. Session с двумя soft-disabled capability блокируется ещё в edge proxy.

### Route-only field session

Route & Field использует существующую каноническую `MtmAgentWorkday` state
machine как минимальную **полевую смену**: только собственные `START` и
`FINISH`, факт активной смены в bootstrap, привязка GPS и обязательное условие
начала маршрута. Это не включает Workforce HRM: нет HRM requests, attendance
add-ons, snapshots, timesheets, team/manager data или workforce sync stream.
Если у тенанта включён Workforce, его tenant write fence и attendance-политики
остаются авторитетными для той же state machine.

Проверки находятся в `tenant-capabilities`, `tenant-capability-access`,
`lib-with-mtm-rls-auth`, mobile bootstrap/auth, navigation и middleware tests.

## Baseline и открытые решения

R0 не заявляет новый performance baseline: он требует representative tenant
и измерения p95/API/outbox age, которых нет в локальном чистом worktree.
Нагрузочная проверка отмечается `NOT RUN` до bounded runner/production-like
fixture. Решения 15.1–15.5 теперь зафиксированы в основном плане; они не
разрешают неявно менять legacy `mtm` gate, state machines, production rollout
или R0 four-mode contract.
