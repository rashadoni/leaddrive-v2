# AAC: подключение подготовленного конструктора к CRM и очереди

Состояние (14.10.2026, Claude Code): хранилище пакетов, транзакционный capture, worker, операторское урегулирование и runtime security log реализованы в `src/lib/integrations/customer-receiver/runtime/` и проверены на настоящем PostgreSQL (`customer-receiver-runtime-postgres.test.ts`). Пункты 1–4, 6–8 раздела «Требования» и раздел «Worker» закрыты кодом; подключение к реальным путям записи CRM (таблица ниже) — следующий этап, interval-dispatcher не реализован. Отправка выключена по умолчанию и не разрешена этим состоянием. Исходный план ниже сохранён без изменений.

## Обнаруженные пути изменения

Лексический снимок находится в `docs/evidence/customer-receiver-builder-2026-10-14/crm-capture-candidates.json`. Он показывает кандидатов в `src/app/api` и `src/lib`; это не доказательство полного охвата. Dynamic dispatch, nested writes, raw SQL, scripts и внешние DB writers требуют отдельной проверки.

| Группа | Примеры путей | Требуемая граница |
| --- | --- | --- |
| Компании и контакты | `companies/route.ts`, `companies/[id]/route.ts`, `contacts/route.ts`, `contacts/[id]/route.ts` | Мутация + версия + разрешённый snapshot + queue pointer в одной tenant-транзакции |
| Сделки и конвертация | `crm-commands/deal/create-deal.ts`, `update-deal.ts`, `crm-commands/lead/convert-lead-to-deal.ts` | Не отправлять из post-commit notification/webhook; использовать transaction и effect collector |
| Массовые действия | `companies/bulk`, `contacts/bulk`, `deals/bulk`, `contacts/bulk-delete` | Однозначные версии каждой записи и bounded batch; rollback не оставляет частичной очереди |
| Inbox / внешнее создание контактов | `web-chat-contact.ts`, `inbox/chatwoot-inbound.ts`, публичные и messaging webhook routes | Tenant устанавливается из проверенной входной связи, не из произвольного org в payload |
| Workflow / AI / code modules | `workflow-engine.ts`, `ai/tool-executor.ts`, `code-modules/[id]/execute` | Одна transaction-aware граница записи; произвольное выполнение не может обойти capture |
| Производные изменения | Продукты сделки, lifecycle/engagement, ownership handover | Событие создаётся только если меняются разрешённые для передачи поля; пароль/notes не попадают в snapshot |
| Custom fields и сторонние импорты | Требуют дополнительной проверки actual writer | Registered definitions, own-tenant values, событие при изменении экспортируемого custom value |

Удаление не превращается автоматически в ERP delete: начальный receiving contract описывает создание/обновление. Удалённая или отвязанная запись должна дать диагностический результат, а не неявный destructive запрос.

## Требования к транзакционному capture

1. Approved runtime binding задаётся оператором отдельно от session draft API. Он связывает tenant, integration ID, TEST/PROD, точную revision профиля, подтверждённый receiving contract и secret references. Draft/import не активирует binding.
2. Version allocation, business mutation и Outbox пишутся одной tenant-транзакцией. Existing CRM event source profile B пока planned; его нельзя объявить реализованным из-за наличия чистого mapper.
3. Existing `appendDomainEvent` выделяет aggregate version и согласованно пишет DomainEvent/EventOutbox. Нельзя обновить `event_aggregate_heads` как отдельный счётчик: deferred coherence constraints требуют соответствующего события и Outbox.
4. Identity, revision и версия catalogue фиксируются при подготовке. Payload сериализуется один раз; повтор использует те же bytes, event ID, destination, checksum и key. Изменение draft после capture не меняет уже подготовленную отправку. Коррекция создаёт новое событие.
5. Profile selection mode `manual` не означает автоматический отбор. `on_change` и `interval` пока являются настройками; dispatcher должен явно применять их разные правила. Empty filter никогда не превращается в «все записи».
6. Связанный customer snapshot и необходимая версия клиента проверяются в tenant scope. Сделка/контакт не отправляется до durable receipt нужной версии клиента. Статус HTTP сам по себе не снимает зависимость.
7. Ограниченные личные payloads должны храниться отдельно от неизменяемого event/effect ledger с согласованным TTL и incident hold. В существующем EffectOutbox payload неизменяем и удаляется только whole-tenant cascade. Поэтому текущий строгий enqueue helper нельзя считать готовой реализацией временного хранения персональных пакетов; отдельный storage design/migration необходим до подключения.
8. При replay/shadow никакие внешние sends не разрешаются. Capture и dispatch должны использовать existing execution-mode fences; клиентский boolean не заменяет reviewed replay policy.

## Worker и доказательства попыток

Existing EffectOutbox guards определяют протокол, который worker должен соблюдать:

- Claim атомарно выбирает due pending запись в tenant scope; lease owner/token/expiry/request ID и increment attempt count фиксируются в БД. Несколько workers не получают одну отправку.
- До сетевого вызова отдельная committed transaction добавляет `EffectAttempt(outcome=started)` с точной lease/request identity. Ошибка этой записи запрещает send.
- После вызова terminal attempt evidence и transition эффекта фиксируются одной транзакцией. Success хранит durable API receipt, не придуманное ERP completion.
- Expired lease без started допускает безопасное возвращение pending. Started или потерянное подтверждение требует `reconciliation_required`; автоматический слепой resend запрещён.
- После reconciliation переходы требуют immutable decision evidence и dedicated `leaddrive_effect_operator` role. Обычный worker не обходится произвольным UPDATE статуса или подменой роли.
- Confirmed retry сохраняет frozen body/key. Rate limit, distributed concurrency, retry window, backpressure и unresolved dependency ограничиваются по runtime binding. Значения в draft сами не запускают планировщик.
- Credentials загружаются только server-side по secret references. Их нельзя записывать в ChannelConfig profile, audit, EffectAttempt evidence, manifest или receiver error log. OAuth выдача/refresh и Key Vault ещё не подключены.

## Проверки до активации

| Проверка | Критерий |
| --- | --- |
| Rollback / crash | Нет queue без CRM commit; нет сетевого вызова без committed started |
| Tenant / environment | Чужой tenant/TEST-PROD mismatch не читает source, payload, receipt или credentials |
| Concurrency | Один claimant; монотонные версии; draft CAS и frozen revisions не теряются |
| Dependency | Неподтверждённая версия клиента блокирует дочернюю запись |
| Timeout / lost receipt | Reconciliation вместо слепого resend; durable idempotency проверена клиентом |
| Privacy / retention | Только approved catalogue; raw response/secrets не логируются; purge/hold проверены |
| Actual DB | PostgreSQL triggers/RLS/role grants проверены actual adapter, а не mock store |
| Actual connection | Private route, CA/hostname/mTLS/OAuth, source IP и receipt API проверены совместно |
| Security sources | Inventory отражает реальные collected/missing/failed источники; builder export не объявляется «все логи» |

## Точка подключения заказчика

Перед первой передачей реальных данных нужны confirmed receiving API и lookup/dedup semantics, тестовый private endpoint, сертификаты/CA, OAuth issuer/scopes/audience и безопасные secret references; для будущего Azure — tenant/environment owner, регион и утверждённая сеть. Внутренний ERP API/adapter остаётся на стороне AAC.

Это не означает, что сейчас осталось только получить адрес сервера. Наш следующий этап — реализация и PostgreSQL-верификация capture/worker/storage, затем подключение утверждённого контура. User authorization на подготовку позволяет продолжать этот этап, но не включает незаметную активацию реальной передачи или production deploy.
