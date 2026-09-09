# LeadDrive Field — план надёжной синхронизации и масштабирования

> **Статус:** проект целевой архитектуры для подтверждения  
> **Дата:** 2026-08-28  
> **Расчётный горизонт:** 100 tenant-клиентов, 5000 зарегистрированных
> мобильных пользователей, несколько включаемых модулей  
> **Связанные документы:**
> [`mtm-hrm-module-plan-2026-08-28.md`](./mtm-hrm-module-plan-2026-08-28.md),
> [`mtm-routes-module-redesign-plan-2026-08-28.md`](./mtm-routes-module-redesign-plan-2026-08-28.md),
> [`mtm-offline-sync-spec.md`](./mtm-offline-sync-spec.md)

## 1. Решение

LeadDrive должен сохранить одно понятное состояние синхронизации для
пользователя, но внутри выполнять несколько независимых pipeline. Один
недоступный сервис не имеет права останавливать отправку данных другого модуля.

Целевая модель:

```text
Mobile Sync Supervisor
├── Bootstrap / capabilities / config
├── Route & Field reference pull
├── Route & Visit mutation push
├── Workforce / HRM pull + push
├── Media uploads
└── GPS telemetry
```

Каждый pipeline имеет:

- отдельный cursor/checkpoint;
- отдельное состояние, ошибку и backoff;
- собственный capability gate;
- лимит и приоритет;
- независимый retry;
- наблюдаемую давность очереди.

Пользователь видит общий итог и может раскрыть подробности по модулю.

## 2. Доказуемый baseline текущей реализации

### 2.1 На телефоне уже есть сильные основы

- Локальная база использует `expo-sqlite` и SQLCipher, а не WatermelonDB.
- SQLite работает в WAL-режиме.
- Business mutation и запись outbox выполняются локально транзакционно.
- Есть operation IDs, повторная отправка и сохранённые conflict/rejected states.
- Фото имеют отдельную локальную очередь.
- Приложение сохраняет field snapshots и показывает stale/offline данные.
- Серверный `src/app/api/v1/mtm/mobile/sync/push/route.ts` применяет операцию и
  idempotency record в одной транзакции.
- Workday state machine дополнительно защищён advisory lock и `clientEventId`.

### 2.2 Сейчас существуют параллельные механизмы обновления

| Поток | Фактическая реализация | Проблема |
|---|---|---|
| LeadDrive field reads | `FieldProvider` делает отдельные snapshot GET profile/week/messages/tasks/workday | Нет общего cursor и согласованной boundary |
| LeadDrive delta pull | `/api/v1/mtm/mobile/sync/pull` с timestamp, entities, offset | Endpoint есть, но FieldProvider его не использует |
| Field mutations | Общий SQLite outbox, затем `/mtm/mobile/sync/push` или direct route API | Отправка находится в общем run |
| Route mutations | Часть отправляется отдельными direct API через `route-outbox.ts` | Иная семантика конфликтов/повторов |
| GPS | Каждая координата отправляется через mobile location endpoint | Высокочастотный поток смешан с OLTP-контуром |

### 2.3 Риск текущего delta pull

`src/app/api/v1/mtm/mobile/sync/pull/route.ts` использует:

- `since` как timestamp;
- один `offset` одновременно для разных entity;
- один `serverTimestamp` ответа;
- отдельные массивы, имеющие разную длину;
- parent route `updatedAt` для изменений `MtmRoutePoint`.

Такой контракт трудно безопасно пагинировать: cursor нельзя продвигать, пока
все страницы каждой entity не применены. Offset изменяется при конкурентных
записях и не является стабильным курсором. Новый APK не должен начинать
использовать этот endpoint как окончательный sync v2 без исправления протокола.

### 2.4 Устаревшая документация

`docs/mtm-offline-sync-spec.md` исторически описывает WatermelonDB и единый
timestamp pull. Фактическая поддерживаемая мобильная реализация — SQLCipher
SQLite с несколькими потоками. Старая спецификация остаётся историей решений,
но этот документ после утверждения должен стать источником истины для будущей
синхронизации.

## 3. Цели и не-цели

### 3.1 Цели

- Нулевая подтверждённая потеря принятых локально business mutations.
- Partial outage одного домена не блокирует остальные.
- Телефон получает только разрешённый tenant/role/scope и включённые модули.
- Initial sync и delta sync имеют фиксированную, воспроизводимую boundary.
- Повторы безопасны; конфликты объяснимы и восстанавливаемы.
- GPS, media и отчётные нагрузки не мешают интерактивной CRM.
- Один «шумный» tenant не ухудшает работу остальных.
- Старый APK продолжает работать в течение контролируемой миграции.

### 3.2 Не-цели первого этапа

- Немедленное разбиение CRM на множество микросервисов.
- Отдельная PostgreSQL для каждого модуля или клиента.
- Синхронизация всей истории CRM на телефон.
- Универсальный Last-Write-Wins для всех сущностей.
- Бессрочное хранение каждой GPS-координаты и transport log.
- Одновременная замена всех API и UI одним большим релизом.

## 4. Целевая архитектура

```text
                         ┌────────────────────────────┐
                         │ LeadDrive Field APK        │
                         │ SQLCipher + domain outbox  │
                         └─────────────┬──────────────┘
                                       │ HTTPS / versioned contracts
                         ┌─────────────▼──────────────┐
                         │ Field BFF / API adapters   │
                         │ auth, manifest, rate limit │
                         └──────┬────────┬───┘
                                │        │
                ┌───────────────▼─┐  ┌───▼────┐
                │ LeadDrive OLTP  │  │ Queue  │
                │ CRM/Route/HRM   │  │ jobs   │
                └───────┬─────────┘  └───┬────┘
                        │                │
            ┌───────────▼───────┐  ┌────▼────────────────┐
            │ Object storage    │  │ Telemetry storage   │
            │ photos/documents  │  │ GPS raw + rollups   │
            └───────────────────┘  └─────────────────────┘
```

На горизонте 5000 пользователей LeadDrive OLTP может оставаться одной
PostgreSQL с RLS и модульными таблицами. Выделяются не все CRUD-домены, а
потоки с иным профилем нагрузки: GPS ingestion, media и тяжёлые jobs.

## 5. Bootstrap и capability manifest

Первый authenticated запрос возвращает server-authoritative manifest:

```json
{
  "protocol": { "min": 1, "preferred": 2 },
  "tenant": { "id": "...", "timezone": "Asia/Baku" },
  "principal": { "id": "...", "role": "AGENT" },
  "modules": {
    "routeField": { "enabled": true, "scopeVersion": "rf-42" },
    "workforceHrm": { "enabled": false, "scopeVersion": null }
  },
  "streams": ["routes", "visits", "customers", "contacts", "tasks"],
  "policiesVersion": "cfg-203",
  "serverTime": "2026-08-28T12:00:00Z"
}
```

Точные названия полей утверждаются contract-тестом. Обязательные свойства:

- disabled stream вообще не запрашивается;
- manifest проверяется сервером на каждом mutation, а не только клиентом;
- изменение scope version заставляет безопасно пересобрать только затронутый
  stream;
- null/unknown version означает честный legacy/unversioned, а не «актуально»;
- клиент с неподдерживаемой обязательной схемой получает `upgrade_required` до
  опасной записи.

## 6. Pull protocol v2

### 6.1 Почему cursor должен быть непрозрачным

Клиент не должен вычислять `updatedAt > since`, offset или внутренний sequence.
Сервер выдаёт opaque cursor, который кодирует подтверждённую revision и stream.
Формат можно менять без новой версии APK.

### 6.2 Независимые streams

Минимальный набор:

- `routes`;
- `routePoints`;
- `visits`;
- `customers`;
- `contacts`;
- `tasks`;
- `workforce`;
- `notifications`;

Streams могут физически объединяться сервером в один HTTP round-trip, но cursor
и результат каждого остаются независимыми.

### 6.3 Initial snapshot

1. Сервер фиксирует `snapshotId` и `boundaryRevision`.
2. Все страницы читаются в deterministic keyset order до этой boundary.
3. Каждая страница локально применяется транзакцией.
4. Клиент не продвигает committed cursor до `complete: true`.
5. После complete клиент сохраняет cursor одной локальной транзакцией.
6. Изменения после boundary приходят следующим delta pull.

Пример логики ответа:

```json
{
  "stream": "routes",
  "snapshotId": "snap_...",
  "boundary": "opaque-boundary",
  "items": [],
  "tombstones": [],
  "nextPage": "opaque-page-token",
  "complete": false,
  "nextCursor": null
}
```

На последней странице `complete: true` и появляется `nextCursor`.

### 6.4 Delta

- Entity write и запись sync change коммитятся одной серверной транзакцией.
- Порядок определяется monotonic revision, а не временем устройства.
- Пагинация — keyset по revision/id.
- `nextCursor` относится только к полностью возвращённой странице.
- Один stream может продвинуться, даже если другой временно сломан.

### 6.5 Tombstones и потеря scope

Удаление с телефона требуется не только при `deletedAt`:

- агент снят с маршрута;
- закончено назначение клиента/контакта;
- изменена территория;
- модуль отключён;
- объект стал недоступен роли.

Поэтому tombstone содержит причину и revision stream. Tombstones хранятся не
меньше максимального поддерживаемого offline horizon плюс запас. Устройство,
пропустившее retention window, получает controlled stream resnapshot.

### 6.6 Горизонт данных

Сервер возвращает не всю CRM:

- текущий и ближайший утверждённый период маршрутов;
- активный визит и ограниченную историю;
- назначенные/route-scoped клиенты и контакты;
- активные задачи и необходимую историю;
- HRM-период по политике;

Горизонт задаётся policy/manifest и измеряется. Телефон не выбирает произвольно
год данных одним запросом.

## 7. Push protocol и outbox

### 7.1 Envelope

Каждая операция содержит:

```json
{
  "operationId": "uuid",
  "deviceId": "stable-device-id",
  "stream": "workforce",
  "entity": "workday",
  "action": "PAUSE",
  "schemaVersion": 2,
  "expectedVersion": 4,
  "occurredAt": "2026-08-28T12:00:00Z",
  "dependsOn": [],
  "payload": {}
}
```

Tenant и actor не принимаются на доверии из payload: они определяются из
аутентифицированного контекста.

### 7.2 Состояния локального outbox

```text
PENDING → SENDING → APPLIED
             ├──→ CONFLICT
             ├──→ REJECTED
             └──→ PENDING (transient retry)

Невосстановимый локальный media-файл → QUARANTINED
```

- Network/5xx/408/429 не превращают операцию в окончательный отказ.
- 429/503 учитывают `Retry-After`.
- Backoff: exponential + random jitter, с per-pipeline cap.
- `APPLIED` хранится локально ограниченный период для диагностики.
- Logout/account switch блокируется или явно объясняет несинхронизированные
  операции; тихое удаление outbox запрещено.

### 7.3 Идемпотентность

- Идемпотентность scoped минимум tenant + actor/device + operation ID.
- Один operation ID с другим payload возвращает mismatch.
- Applied/conflict result replay идентичен первоначальному.
- Transient server error не pin как окончательный business result.
- Таблица дедупликации имеет retention, архив/partition и мониторинг роста.

### 7.4 Приоритет и порядок

Рекомендуемые классы:

1. `P0`: завершение/восстановление workday, visit check-in/out.
2. `P1`: visit action, route change, task transition, HRM request.
3. `P2`: message receipt, обычное обновление.
4. `P3`: media без причинной зависимости, аналитические события.

Порядок между независимыми streams не нужен. Внутри причинной цепочки
используется `dependsOn`, например:

```text
visit.checkin
  → evidence.upload
    → visit.action.complete
      → visit.checkout
```

Один битый файл не блокирует другой визит, но checkout конкретного визита не
обходит своё обязательное evidence.

### 7.5 Push не зависит от успешного общего pull

Supervisor может обновить auth/manifest, после чего дренирует критический
outbox каждого доступного домена. Коммерческий pull 503 не блокирует Route/HRM
push. Ошибка конфигурации одного stream помечается локально и не завершает весь
цикл раньше независимых операций.

## 8. Матрица разрешения конфликтов

Last-Write-Wins допустим только для явно безвредных полей, например локальной
настройки отображения. Для бизнес-сущностей правила задаются отдельно.

| Сущность/действие | Стратегия |
|---|---|
| Workday transition | Серверный автомат + replay; терминал не откатывается |
| Visit check-in/out | Серверный автомат; актуальный visit state возвращается |
| Visit evidence | Append/idempotent по client evidence ID |
| Route draft metadata | Optimistic concurrency по aggregate version |
| Route point order | Whole-order command + expected route version |
| Route publish | Серверная повторная валидация и version check |
| Task status | Разрешённые переходы; terminal state не откатывается |
| HRM request decision | First valid terminal decision wins; replay result |
| Notification read | Монотонное `unread → read` |
| GPS point | Append/dedupe по client location ID |
| Message receipt | Append/idempotent по message/actor/type |

Conflict UI показывает:

- что пытался сделать пользователь;
- текущее серверное состояние;
- сохранились ли локальные данные;
- допустимые действия: принять сервер, повторить на новой версии, создать запрос,
  открыть объект или обратиться руководителю.

## 9. Локальная база на устройстве

### 9.1 Сохранить

- SQLCipher и integrity check;
- WAL;
- транзакцию optimistic local mutation + outbox;
- отдельное зашифрованное хранение media;
- cache hydration до сетевого refresh;
- account-switch guard при ожидающих данных.

### 9.2 Разделить логически

Предлагаемые локальные группы:

```text
sync_stream_state
domain_outbox
domain_cache_route
domain_cache_workforce
media_outbox
telemetry_outbox
sync_diagnostics
```

Физически они могут оставаться в одном SQLCipher-файле. Важно разделение
транзакций, cursors, cleanup и ошибок, а не создание множества файлов.

### 9.3 Миграции

- Каждая schema migration версионируется и тестируется с реальной предыдущей БД.
- Повреждённый cache можно перестроить, не удаляя outbox/media.
- Destructive cleanup запрещён при несинхронизированных операциях.
- Cursors очищаются только для выбранного stream при resnapshot.
- APK downgrade не должен открывать более новую схему как будто она совместима.

## 10. Серверные sync-примитивы

### 10.1 Transactional change log

Предлагаемый логический контракт таблицы (точное Prisma-имя после design review):

```text
MobileSyncChange
- organizationId
- stream
- revision
- entityType
- entityId
- changeType (UPSERT | TOMBSTONE)
- scopeKey / audience hint
- occurredAt
```

Изменение бизнес-объекта и change record записываются одной транзакцией.
Payload не обязан дублироваться в логе: projection можно собрать по entity,
если retention и consistency гарантированы. Для immutable events допустим
минимальный payload snapshot.

### 10.2 Scope/config revisions

- `scopeVersion` меняется при назначениях, территории, роли и capability.
- `configVersion` меняется при словарях/политиках.
- Клиент пересобирает только затронутые streams.
- Bootstrap сейчас возвращает null versions; до включения v2 должны появиться
  реальные authoritative revisions.

### 10.3 Idempotency records

Текущий `MtmSyncOperation` сохраняется для v1. Для v2 нужны:

- schema version и payload hash;
- device ID;
- stream;
- expiry/archive timestamp;
- индекс `(organizationId, actor/device, operationId)` в соответствии с
  утверждённой глобальностью UUID;
- partition/cleanup job, который не удаляет records раньше максимального retry
  horizon старых APK.

### 10.4 Уведомления и внешние эффекты

Email/push/webhook не отправляются внутри транзакции до commit. Business write
создаёт transactional outbox event; worker отправляет его идемпотентно. Повтор
mobile operation не создаёт второе уведомление.

## 11. GPS: отдельный поток нагрузки

### 11.1 Почему это необходимо

При 5000 активных сотрудников и точке каждые 30 секунд за 8 часов:

```text
960 точек × 5000 = 4 800 000 GPS-точек в день
```

При минутном интервале — 2 400 000 точек в день. Даже если фактическая
активность ниже, это на порядки больше маршрутов и визитов.

### 11.2 Целевой ingestion

- отдельный batch endpoint, например 20–100 точек;
- idempotency по tenant + agent + clientLocationId;
- rate limit и максимальный размер batch;
- быстрый append без тяжёлой аналитики в HTTP request;
- месячные/недельные time partitions;
- отдельная latest-location projection для карты;
- асинхронные остановки, путь, нарушения и rollups;
- tenant-configured retention raw points;
- исключение GPS из общего business sync change log.

### 11.3 Адаптивная частота

Частота является политикой, а не hard-coded константой:

- чаще при движении и активной смене;
- реже при неподвижности;
- прекращается после завершения смены;
- учитывает battery/network policy;
- foreground/background режимы честно показываются руководителю;
- потеря GPS не выдаётся за отсутствие сотрудника.

Конкретные интервалы утверждаются после battery/privacy тестов.

### 11.4 Хранение

- Raw GPS хранится ограниченный срок.
- Затем остаются упрощённый трек, остановки, старт/финиш и вычисленные события.
- Live map читает latest projection, а не `ORDER BY` по всей истории каждого
  агента.
- Исторический отчёт использует partition pruning по tenant/agent/time.

## 12. Media и документы

- Файлы находятся в object storage, не в PostgreSQL rows.
- БД хранит tenant-scoped metadata, checksum, encryption/access policy и статус.
- Upload получает preflight/лимит и idempotent client media ID.
- Большой файл не входит в JSON sync batch.
- Успешный upload ещё не означает applied business action.
- Локальный файл удаляется только после upload + business ACK + server pull
  reconciliation.
- Невосстановимый файл помещается в quarantine с понятным recovery UI.
- Один media failure не блокирует unrelated operations.

## 13. Multi-tenant fairness и защита от sync storm

### 13.1 Утреннее «стадо»

После login/foreground устройство добавляет random jitter. Сервер возвращает
`Retry-After` при перегрузке. Клиент не повторяет запросы каждую секунду.

### 13.2 Лимиты

- per device;
- per user;
- per tenant;
- per stream;
- отдельные лимиты initial snapshot и delta;
- отдельные лимиты GPS/media.

### 13.3 Fair queues

Jobs имеют tenant key и concurrency cap, чтобы один импорт/оптимизация клиента
не заняли все worker slots. Интерактивные mutations приоритетнее отчётов и
пересчётов.

### 13.4 Backpressure

- сервер может уменьшить рекомендуемый page/batch size;
- клиент не запускает параллельно несколько sync одного stream;
- полный resnapshot ограничивается lease;
- cache warming и отчёты не запускаются синхронно из mobile request;

## 14. Безопасность и конфиденциальность

- Tenant и actor берутся из проверенного JWT/mobile auth и RLS context.
- Каждый stream имеет explicit capability/permission gate.
- Projection исключает поля, не требуемые мобильному сценарию.
- Device registration отзывается и имеет last-seen/security audit.
- Refresh/access token rotation не очищает outbox.
- SQLCipher key не хранится открытым значением рядом с БД.
- Media остаётся encrypted at rest и выдаётся scoped signed access.
- GPS собирается только по утверждённой политике и видимому состоянию смены.
- Audit logs и sync diagnostics не должны копировать секреты/полные PII payload.
- Удаление сотрудника/tenant запускает контролируемую retention процедуру, а не
  случайный cascade без export/legal hold проверки.

## 15. Observability и предлагаемые SLO

Перед финальными числами нужен production baseline. Начальные цели:

| Метрика | Цель/alert |
|---|---|
| Подтверждённая потеря business operation | 0 |
| Critical mutation ack, online p95 | ≤ 10 секунд |
| Delta pull до 500 изменений p95 | ≤ 5 секунд |
| API 5xx по stream | alert по error budget, не общий средний |
| Oldest pending critical operation | warning 2 мин, critical 15 мин |
| Initial snapshot completion | измеряется по stream/tenant/device |
| Conflict rate | по entity/code/version клиента |
| Tombstone/resnapshot rate | alert на аномальный рост |
| GPS ingestion lag | отдельный SLO |

Обязательные dimensions:

- tenant;
- stream;
- endpoint/contract version;
- APK version;
- result class;
- queue age bucket;
- payload row/byte count;
- server duration и local apply duration.

Нельзя писать в логи access token, пароль, полный документ или точный GPS
payload без утверждённой защиты.

## 16. План миграции

### S0 — Контракты, baseline и владельцы

- Назначить владельцев Route, Workforce, Media и Telemetry streams.
- Зафиксировать текущие v1 contracts и APK versions.
- Добавить метрики 503/latency/payload/outbox age.
- Зафиксировать реальные retention и offline horizon.
- Обновить документационный source of truth после утверждения этого плана.

**Gate:** измеряется текущая система; нет изменения схемы/клиента.

### S1 — P0 isolation на текущем протоколе

- Разбить `SyncManager.runSync()` на независимые try/catch pipeline.
- Дренировать критический outbox даже при сбое некритического pipeline.
- Не ACK pull до успешной локальной транзакции.
- Показывать общий и per-domain status.
- Добавить exponential backoff + jitter + `Retry-After`.
- Contract test: сбой некритического pipeline, field push success.

**Gate:** 503 одного pipeline больше не блокирует Route/HRM.

### S2 — Capability-driven supervisor

- Bootstrap выдаёт реальные module/scope/config versions.
- Disabled pipeline не стартует.
- Разделить granular permissions.
- Добавить stream state/cursor tables локально.
- Добавить recovery center без очистки outbox.

**Gate:** четыре комплектации клиента вызывают только разрешённые endpoints.

### S3 — Server sync v2 foundation

- Transactional change log и stream revisions.
- Opaque cursor, stable snapshot/keyset pages и tombstones.
- Payload projections и cursor contract tests.
- Старый v1 endpoint продолжает обслуживать старый APK.
- Не подключать новый APK к v2 до chaos/pagination tests.

**Gate:** concurrent writes между страницами не приводят к пропуску/дублю.

### S4 — Route/Visit/Workforce adoption

- Перевести field snapshots на domain streams постепенно.
- Начать с routes/points, затем visits/tasks, затем workforce.
- Каждый stream включается tenant/device cohort flag.
- Сравнивать v1 snapshot и v2 projection read-only до cutover.
- Удалять старый refresh path только после telemetry и supported-version gate.

**Gate:** restart/offline/scope-loss/two-device пройдены на физическом Android.

### S5 — GPS и media isolation

- Batch location ingestion и partitions.
- Latest projection и retention jobs.
- Media dependency graph/quarantine.
- Worker fairness, rate limits и object-storage recovery.

**Gate:** GPS/media нагрузка не ухудшает p95 business mutations.

### S6 — Масштаб, chaos и rollout

- Модель 100 tenants / 5000 users.
- Утренний login/sync storm с jitter.
- 503/timeout/partial response/process death/DB failover scenarios.
- Backup restore и cursor recovery.
- Пилотные cohorts, rollback и постепенное расширение.

**Gate:** SLO выдерживаются; нет P0/P1; rollback реально проверен.

### S7 — Controlled retirement v1

- Посчитать долю старых APK.
- Уведомить и обновить поддерживаемые устройства.
- Перевести v1 в read/compatibility window.
- Архивировать старые idempotency rows только после retry horizon.
- Удаление endpoint/columns — отдельная destructive review и миграция.

**Gate:** неподдерживаемый APK не существует в активном fleet или имеет явное
решение владельца.

## 17. Обязательные тесты

### Protocol

- initial snapshot 0/1/500/501/10 000 rows;
- concurrent create/update/delete во время pagination;
- process death до apply, после apply до cursor commit и после commit;
- повтор страницы и повтор push;
- cursor другого tenant/stream/device;
- истёкший tombstone window → controlled resnapshot;
- scope removed/restored;
- module disabled/enabled без удаления истории;
- schema upgrade/downgrade;
- malformed operation не валит весь batch.

### Failure isolation

- HRM 500, Route работает;
- media 413/422/429/503, unrelated mutations работают;
- GPS backlog, интерактивные mutations работают;
- один corrupt local cache, outbox остаётся;
- один corrupt media file, остальные операции проходят;
- auth lost не удаляет данные;
- server returns `Retry-After` и клиент соблюдает его.

### Conflict and idempotency

- duplicate operation same payload;
- duplicate operation different payload;
- two-device workday transition;
- route reorder on stale version;
- publish race;
- terminal visit/task rollback;
- approval decided twice;
- evidence dependency and checkout;
- notification side effect exactly once.

### Scale/security

- 100 tenant fairness;
- один tenant с массовым initial sync;
- RLS/IDOR каждого stream и tombstone;
- payload byte/row limits;
- rate limit by device/user/tenant;
- GPS partition pruning;
- idempotency/change-log retention;
- backup restore and cursor replay.

## 18. Карта реальных файлов

### LeadDrive repository

- `src/app/api/v1/mtm/mobile/bootstrap/route.ts` — manifest/version baseline.
- `src/app/api/v1/mtm/mobile/sync/pull/route.ts` — текущий timestamp/offset v1.
- `src/app/api/v1/mtm/mobile/sync/push/route.ts` — v1 mutation/idempotency.
- `src/app/api/v1/mtm/mobile/location/route.ts` — GPS ingestion.
- `src/lib/mtm/offline-outbox.ts` — существующие server outbox helpers.
- `src/lib/mtm/workday.ts` — critical state machine.
- `src/lib/mtm/mobile-capabilities.ts` — permissions.
- `src/lib/tenant-capabilities.ts` — tenant module catalog.
- `prisma/schema.prisma` — workday, route, location, sync operation models.
- `prisma/migrations/*mtm*` — additive migration history.

## 19. Совместимость и rollback

- Protocol v1 и v2 имеют отдельные contract tests.
- Server-first additive rollout: новые fields/tables/endpoints до нового APK.
- Новый APK включается cohort flag по tenant/device.
- Dual-read comparison допустим; неконтролируемый dual-write двух авторитетных
  путей запрещён.
- Cursor v2 можно сбросить только для выбранного stream; outbox не очищается.
- При rollback новый APK возвращается к v1 adapter, пока schema compatible.
- Destructive drop/rename выполняется после supported APK census и backup
  restore rehearsal.

## 20. Definition of Done

Синхронизация не считается готовой по unit-тестам одного happy path.

1. Контракт и миграция versioned и документированы.
2. Tenant capability, permission и RLS тестируются вместе.
3. Pagination/concurrency/process-death/partial-outage tests проходят.
4. Physical Android проверен offline → online, background и restart.
5. Метрики позволяют найти tenant, stream, APK и возраст операции без PII leak.
6. Retention/partition/backup/restore runbooks проверены.
7. 503 одного pipeline фактически не блокирует независимый critical push.
8. Старый APK имеет явно определённое окно поддержки и rollback.
9. Нагрузочный прогон выполняется через bounded runner/CI и не заявляется
   пройденным, если не был запущен.
10. Нет подтверждённой потери или тихого удаления business operation.

## 21. Первые безопасные implementation slices

### Slice A — без схемы

1. Добавить per-domain status в существующий supervisor.
2. Изолировать некритические pipeline от Field outbox push.
3. Добавить тест сбой pipeline → field operation applied.
4. Добавить jitter/Retry-After и outbox-age telemetry.
5. Исправить пользовательское сообщение 503 без очистки очереди.

### Slice B — capability manifest

1. Разделить `route-field` и `workforce-hrm`.
2. Вернуть server-authoritative manifest.
3. Не стартовать disabled streams.
4. Добавить four-mode contract matrix.

### Slice C — sync v2 foundation

1. Согласовать stream/cursor/tombstone schema.
2. Добавить transactional change log.
3. Реализовать один read-only pilot stream `routes`.
4. Доказать stable pagination и scope removal.
5. Только после этого подключать cohort нового APK.

Эти slices не следует объединять в один PR: P0 isolation должен доехать раньше
и не зависеть от будущей схемы sync v2.

## 22. Решения владельца перед schema work

1. **Routes v2 решено 2026-08-29:** rolling window 7 локальных календарных
   дней, включая текущий; terminal history вне окна — 0 дней. Это future
   route-only client policy и не утверждает horizon для Visit/Media stream.
2. Срок хранения raw GPS для стандартного и enterprise тарифа?
3. Какие мобильные клиенты действительно используют commercial sync?
4. Допустим ли обязательный update старого APK перед включением sync v2?
5. Нужен ли отдельный юридический регион хранения GPS/media для отдельных
   клиентов?
6. Какие SLO включаются в клиентский договор, а какие остаются внутренними?

### Принятые решения — 2026-08-28

- Гарантированный offline horizon: **7 дней**.
- Raw GPS хранится **30 дней** для standard и enterprise клиентов.
- Commercial остаётся выключенным в Field manifest и не участвует в sync v2.
- Перед включением sync v2 допустимо обязательное обновление старого APK.
  Для S7 принято: immutable `mandatoryUpdateAvailableAt`, привязанный к
  release artifact, запускает первый полный UTC-день со следующего `00:00`;
  затем действуют 90 полных UTC-дней v1 compatibility и 30 последовательных
  полных UTC-дней census. Retirement review возможен только после окончания
  120-го полного UTC-дня и при нуле любых v1 pull/push activity, bootstrap с
  `protocolPreferred: 1` и `unknown`/unsupported APK. `426 upgrade_required` для
  v1 mutations — будущий default-disabled cutover только после отдельного
  доказательства v2 mutation authority и outbox replay; текущий v2 остаётся
  read-only. После фактического `426` schema/endpoints/idempotency rows
  сохраняются неразрушающе ещё минимум 90 дней.
- Отдельный юридический регион для GPS/media не требуется.
 - Все sync SLO — внутренние; договорных обещаний по latency/availability нет.
