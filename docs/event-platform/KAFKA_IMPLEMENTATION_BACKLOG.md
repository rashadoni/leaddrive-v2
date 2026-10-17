# Kafka: задачи до запуска и защиты всех модулей

Дата: 2026-10-17. Статус: план работ; создание этого документа не означает запуск Kafka.
Основание: проверенный `origin/main` `1800e514b757c7bb14dde4ec3caf680941cd4a12`.

Цель: исправлять ошибочный расчёт в выбранном модуле и выбранной организации,
сохраняя правильные изменения остальных клиентов и не повторяя платежи,
письма, звонки или начисления. Готовность измеряется проверяемыми результатами,
а не наличием Kafka или процентом написанного кода.

## Исходная точка и ограничения

- В репозитории есть PostgreSQL event store/outbox/inbox, контракты проекций
  и внешних действий, библиотека обработки событий и конкретный пилот Fund.
  Эти части используются повторно; задачи ниже не требуют их переписать.
- В текущем main Kafka-конфигурации остаются шаблонами. Библиотека consumer
  не имеет рабочего broker adapter и вызывающего её production worker.
- Каталог покрывает 27 доменов; запись в каталоге не доказывает внедрение.
  Конкретная каноническая история реализована для Fund, не для всей Finance.
- Последняя проверка GitHub показала успешный ежедневный event-recovery audit
  за 17 октября, run `39012564333`, на SHA
  `00aa422c52b02f183cb5a3d2674f41df2aca5c2b`. Это статус существующей проверки
  PostgreSQL, не доказательство работы Kafka или нового production replay.
- В README/runbook остались противоречивые исторические описания deployment
  статуса. Перед реализацией требуется актуальная сверка, а не повтор старого
  Fund cutover или использование прежних SHA как текущих.
- Сохраняется предпочтение владельца: без новой платной подписки. Сначала
  проверяются уже доступные машины, диски, сети и CI. Нулевая цена лицензии
  не доказывает наличие свободных ресурсов или независимых зон отказа.
- Действующий activation gate требует минимум три независимые зоны отказа,
  RF=3/minISR=2, отдельный от web-host Connect и независимую архивную копию.
  Три процесса на одном VPS этого не выполняют. Одноузловой учебный стенд
  допустим только как development и не засчитывается production HA.
- Для activation/promotion текущий контракт требует разных requester и
  approver. Это отдельно от GitHub branch protection: в ней обязательного
  второго человека сейчас нет. Второй аккаунт того же владельца и AI-сессия
  не доказывают независимого подтверждения. Нужен фактический второй оператор
  либо отдельно рассмотренное изменение эксплуатационного контракта.
- Development/inspection: remote-alt. Application production:
  зарегистрированный Contabo `13.140.132.245`, `/opt/leaddrive-v2`.
  Изменения: отдельная ветка от актуального main → GitHub PR → обязательные
  checks → merge → `.github/workflows/deploy.yml` → SHA и smoke.
  Для новых Kafka-сервисов сначала добавляется проверяемый GitHub deployment
  path; ручное копирование feature worktree не становится способом выкладки.
- Старый task worktree сохраняет историю. Код новой реализации берётся из
  актуального main; старую ветку целиком не переносить в production.

## 0. Подготовка, общая для восьми пунктов

| ID | Задача | Результат / приёмка |
|---|---|---|
| K0.1 | Сверить main, обязательные checks, workflow, production artifact и текущую схему | Сохранены точные SHA, migrations, read-only postconditions и ссылки на receipts; исторические утверждения помечены как устаревшие |
| K0.2 | Составить карту записывающих API, cron, workers, импортов, legacy dispatchers и provider calls | Для каждого бизнес-изменения определены tenant, источник истины, текущая дедупликация и будущий владелец обработки |
| K0.3 | Измерить события/сек, размер события, WAL/сутки, диски и число tenant | Зафиксированы capacity budget, retention, допустимые задержка, RPO и RTO; значения не подменяются предположениями |
| K0.4 | Назначить ответственных за платформу, БД, домены и аварии; определить доступный бюджет и порядок подтверждения операций | Есть исполнимый маршрут запуска, дежурства и остановки; открытые решения перечислены явно |

Роли ниже — зоны ответственности, не утверждение, что такие сотрудники уже
назначены. Подготовка кода и тестов не ждёт покупки сервиса. Операции,
требующие новых расходов, выбираются после расчёта конкретного варианта.

## 1. Kafka, Connect/Debezium и Schema Registry

Ответственность: платформа/эксплуатация. Зависимости: K0.

| ID | Задача | Результат / приёмка |
|---|---|---|
| K1.1 | Инвентаризировать существующие ресурсы и выбрать размещение development, staging, production | Карта независимых отказов, ресурсы и эксплуатационные затраты; соответствие текущим gates либо конкретный открытый разрыв |
| K1.2 | Подготовить воспроизводимые конфигурации инфраструктуры и версии компонентов | Pinned images/digests, отдельные окружения, документированный upgrade/rollback, отсутствие секретов в Git |
| K1.3 | Поднять изолированный тестовый broker/Connect/Registry | Стенд воспроизводится автоматически; не имеет production credentials, отправок и production topics |
| K1.4 | Описать production brokers и controller quorum, диски, размещение реплик и quotas | План переживает отказ одной предусмотренной зоны; ресурсы и доступность проверяются испытанием |
| K1.5 | Настроить приватные сети, TLS, удостоверения сервисов, ACL и ротацию | Producer не создаёт topics; consumer читает только свой разрешённый набор; неверные credentials и TLS отклоняются |
| K1.6 | Развернуть каталог 27 доменов / 86 topics по согласованным partitions и retention | Текущие шаблоны до 48 partitions на домен пересчитаны по нагрузке; effective configs проверены: RF=3, minISR=2, auto-create выключен, unclean election выключен; шаблоны не остались неотрендеренными |
| K1.7 | Настроить Connect и Registry: internal topics, outbox router, schemas и compatibility | Проверены acks=all/idempotence у source producer, схемы Fund и BACKWARD_TRANSITIVE; несовместимая схема блокируется. Schemaless payload Debezium отдельно валидируется на writer/consumer границах: Registry не проверяет его автоматически |
| K1.8 | Добавить GitHub workflow доставки и live preflight для платформы | Workflow связан с reviewed SHA и правильным окружением; готовность подтверждается живыми проверками, не только JSON с true |

Пункт закрыт, когда staging работает целиком и production-топология подготовлена
к запуску с доказанными ACL/HA. Первое чтение production outbox выполняется
отдельным шагом K8, потому что старт connector может начать snapshot.

## 2. PostgreSQL → Kafka: CDC без потерь

Ответственность: БД и платформа. Зависимости: K0, тестовый стенд K1.

| ID | Задача | Результат / приёмка |
|---|---|---|
| K2.1 | Проверить текущие backup/restore receipts, source TLS, роли, RLS, WAL и replication slots | Состояние подтверждено на текущем host; наличие scratch само по себе не считается успешным восстановлением |
| K2.2 | Рассчитать WAL budget на простой connector, лимиты слотов, запас диска и реакцию на переполнение | Есть пороги предупреждения/остановки, срок допустимого простоя и процедура восстановления после invalidated slot |
| K2.3 | Подготовить изменение `wal_level=logical` и безопасное обслуживание | Точный diff, необходимость restart, проверки до/после и rollback; existing replication consumers учтены |
| K2.4 | Применить least-privilege CDC-role и INSERT-only publication для event_outbox на стенде | Нет публикации произвольных бизнес-таблиц; CDC может читать нужные tenant события, но не писать их |
| K2.5 | Проверить TLS verify-full, секреты и постоянную идентичность connector/slot | Ротация не создаёт второй relay и не теряет offset; секреты не попадают в logs |
| K2.6 | Отработать initial snapshot и переход к streaming при продолжающихся командах | Event IDs, aggregate versions и outbox совпадают; дубликаты допустимы и подавляются, пропуски недопустимы |
| K2.7 | Протестировать остановку/restart, потерю связи и длительный простой CDC | Приложение продолжает атомарные записи; накопление WAL/outbox ограничено политикой и наблюдаемо; recovery не удаляет историю |

Пункт закрыт после сквозной сверки PostgreSQL event → outbox → Kafka на стенде.
Production publication/slot/connector создаются в последовательности K8.

## 3. Архив, мониторинг и аварийное восстановление

Ответственность: эксплуатация/БД; политика данных — владелец домена.
Зависимости: K1–K2 для сквозных испытаний; разработка независима.

| ID | Задача | Результат / приёмка |
|---|---|---|
| K3.1 | Реализовать archive sink с проверяемыми сегментами и manifest | Сохраняются event IDs, hashes, schema versions, topic/partition/offset и origin; crash/retry не создаёт необъяснимых дыр |
| K3.2 | Настроить шифрование, неизменяемость, изолированный доступ и off-provider copy | Проверена политика retention: текущий gate ≥400 дней; ключи восстановимы независимо от production host |
| K3.3 | Проверить классификацию payload, минимизацию PII, удаление по политике и legal hold | Длительное хранение не включается вслепую для медицинских, auth, location и иных ограниченных данных; нужные поля заменены ссылками/защищёнными объектами |
| K3.4 | Реализовать reconciliation и watermarks между event store, Kafka и архивом | Сверяются event IDs/версии/хеши; offset другого кластера не принимается за тот же логический checkpoint |
| K3.5 | Добавить метрики и доставку тревог | Проверены connector failure, outbox age, WAL/disk, replication/minISR, consumer lag, quarantine, archive lag и tenant parity; тестовая тревога доходит до ответственного |
| K3.6 | Закрыть recovery prerequisites PostgreSQL и host | Доказаны restore/PITR, роли/ACL/RLS, восстановление operational state и ключей; записаны достигнутые RPO/RTO и оставшиеся разрывы |
| K3.7 | Подготовить и испытать потерю Kafka/host/зоны и восстановление из архива | Изолированная rehydration, secondary-cluster/failover по принятому контракту, отсутствие двух активных writers, сверка истории |
| K3.8 | Обновить runbook и периодические учения | Есть команды диагностики, pause/resume, эскалация, retention для receipts и регулярная проверка восстановления |

Пункт закрыт успешным восстановлением и доставленными оповещениями.
Зелёный health endpoint и наличие архивного файла отдельно этого не доказывают.

## 4. Реальные Kafka consumers и внешние действия

Ответственность: backend/домен и платформа. Зависимости: K0, K1 staging,
схемы Fund; используется существующий SDK.

| ID | Задача | Результат / приёмка |
|---|---|---|
| K4.1 | Реализовать broker adapter и отдельный worker entrypoint | Consumer действительно подключается, подписывается, сообщает readiness/lag и имеет отдельную release-конфигурацию |
| K4.2 | Связать SDK с настоящей tenant-scoped транзакцией БД | Изменение проекции и inbox commit атомарны; acknowledge только после commit; unique-race и crash дают повторяемый безопасный результат |
| K4.3 | Добавить проверку конкретной схемы, canonical hash и последовательности aggregate | Неизвестный тип, чужой tenant, altered payload, gap и неверная версия не меняют проекцию; PostgreSQL canonical hash не заменяется случайной JSON-сериализацией |
| K4.4 | Реализовать Fund reducer с точной арифметикой и версиями проекций | Полная история воспроизводит каждый Fund по валюте; повторное событие не увеличивает баланс |
| K4.5 | Обработать rebalance, shutdown, stale worker, bounded retries и poison records | Partition не продвигается поверх незавершённых событий; quarantine сохраняет evidence и не превращается в молчаливую потерю события |
| K4.6 | Сделать backpressure, per-tenant quotas и независимые credentials режимов live/shadow/replay | Один шумный tenant не лишает остальных обслуживания; replay не имеет доступа к provider secrets и запрещённым сетевым вызовам |
| K4.7 | Реализовать effect workers и provider adapters для каждого подключаемого действия | Stable business key, lease/fencing, attempts, provider read-back; timeout/UNKNOWN требует reconciliation, автоматическая повторная отправка исключена |
| K4.8 | Добавить deployment, остановку, rollback и runtime smoke worker | Проверяется доставка разрешённого события до проекции; версия worker и consumer group связаны с SHA и схемой |

Первая поставка: только Fund-проекция, без подключения реальных платежей,
писем и звонков. K4.7 закрывается по провайдеру до его включения в live scope;
контракт запрета эффектов в replay действует с самого первого worker.

## 5. Управляемый replay и переключение проекций

Ответственность: backend/платформа. Зависимости: K4, схемы и инварианты домена;
archive source требует K3.

| ID | Задача | Результат / приёмка |
|---|---|---|
| K5.1 | Реализовать operator API/CLI: plan, validate, start, pause, status, promote, abort | Операции по умолчанию dry-run; права и проверки выполняются сервером; используются существующие build/checkpoint/pointer primitives |
| K5.2 | Сделать неизменяемый replay plan | Plan содержит allowlist tenant/aggregate, источник, конечные позиции по partition, event range, schema/reducer SHA и лимиты ресурсов; timestamp один не заменяет границы |
| K5.3 | Реализовать shadow storage и безопасный читатель проекции | Новая версия физически/логически изолирована; source facts неизменяемы; состояние active version не перезаписывается |
| K5.4 | Привязать подтверждения к реально аутентифицированным операторам | Два разных подтверждения связаны с hash плана и сроком действия; смена плана отменяет старое подтверждение |
| K5.5 | Реализовать pause/resume/checkpoints и полный запрет внешних эффектов | После crash replay продолжает ту же сборку; неизменные effect keys не зависят от версии проекции; ноль запрещённых effect attempts |
| K5.6 | Сверять каждую сущность и tenant, догонять live stream и переключать pointer | В момент promotion нет пропусков/двойной обработки на границе; проверены счётчики, суммы, hash и watermark; переключение атомарно |
| K5.7 | Испытать rollback после новых событий и abort | Старая проекция пригодна для возврата по watermark либо безопасно догоняется; сохранения старой таблицы недостаточно; abort не трогает source |
| K5.8 | Подготовить исключительную процедуру исправления missed offsets | Отдельный dry-run/export и проверка неактивной группы; известное покрытие inbox и tenant scope; не применяется для обычного пересчёта новой версией |

Пункт закрыт сценарием: неверный reducer → правильная shadow-версия → сверка →
promotion → новые события → доказанный rollback. Внешних отправок нет.

## 6. Внедрение во всех модулях

Ответственность: владельцы доменов/backend. Зависимости: K0.2 и общие
примитивы; production каждой волны проходит K7–K8 заново для своего scope.

Для каждого домена D создаётся один комплект работ:

| ID | Задача на домен | Приёмка |
|---|---|---|
| K6.D.1 | Определить авторитетные факты, команды, aggregate и profile A/B/C | У текущей таблицы, истории и проекции нет конфликтующих ролей |
| K6.D.2 | Описать versioned schemas, PII, ordering и corrections | Старые события продолжают читаться; ошибки факта исправляются новой записью |
| K6.D.3 | Подключить все write paths к state/event/outbox transaction | API, cron, workers, импорты, mobile sync и legacy paths покрыты инвентарём |
| K6.D.4 | Перенести историю и совместимость | Provenance/checkpoints/parity зафиксированы; недостающая история не выдумывается, начало гарантированного восстановления обозначено |
| K6.D.5 | Реализовать reducer, shadow storage, read path и инварианты | Полный rebuild совпадает по каждой сущности и организации |
| K6.D.6 | Подключить ingress dedupe и внешние эффекты | Повтор provider callback/команды не повторяет бизнес-действие; UNKNOWN сверяется |
| K6.D.7 | Пройти tests/drill, canary и rollback | Изоляция tenant, дубли/crash, correction и ноль replay sends доказаны |
| K6.D.8 | Удалить дублирующий legacy dispatcher после окна совместимости | Не осталось второго источника доставки; evidence и история сохранены, каталог обновлён только для принятого scope |

Матрица покрывает все 27 текущих `domainId`; cross-cutting части входят в
явно указанные строки, а не теряются между модулями.

| domainId | Конкретный scope первой декомпозиции | Приоритет |
|---|---|---|
| finance | Fund corrections/reversal; затем payments/refunds, invoices/bills, budgets, accounting effects | Пилот, затем критический |
| settings | Tenant lifecycle, права, entitlements, provisioning, версии настроек/metadata/builders, security/audit | Критический |
| sms-otp | Факты выпуска/проверки/истечения challenge, one-use consume и dedupe SMS; без OTP/секретов в истории | Критический |
| loyalty | Начисления, списания, expiration, корректировки, tiers, fulfilment | Критический |
| commerce | Orders, reservations, stock movements/warehouse, shipments, returns/refunds | Критический |
| contracts | Версии, approvals, e-sign, execution, renewal и provider receipts | Критический |
| mtm | Mobile receipts/sync, routes, visits, attendance/workforce, pharmacy points/rewards и corrections | Критический → операционный |
| revenue-recognition | Obligations, recognition/reversal, schedules, closed-period adjustments | Критический |
| nonprofit | Donations/grants/disbursements и receipts; затем donor/volunteer/program projections | Критический → отраслевой |
| tpm | Commit/accrue/settle spend, approvals и activation; затем execution/retail audit | Критический → отраслевой |
| omnichannel | Ingress/messages, conversations, consent и delivery receipts; outbound через effect workers | Критический → операционный |
| voip | Call lifecycle, consent, usage, callbacks; dial/recording retrieval как effects | Критический → операционный |
| social | Ingest/evidence, classification, approvals, publishing/legal actions и provider receipts | Критический → операционный |
| ai | Workflow/action history, approval, versioned recorded model outputs; без billable replay calls | Критический → операционный |
| support | Entitlement consumption, ticket lifecycle, SLA clocks, escalation и notifications | Критический → операционный |
| crm | Contacts/companies/merge, tasks/projects/activities, timeline/search | Операционный |
| sales | Leads/deals/stages, quotes/offers, commitments, sequences/quotas/forecast | Операционный |
| marketing | Campaigns/journeys, audiences, consent/suppression, forms, attribution, send intents | Операционный |
| analytics | Versioned reports/KPI/forecasts; read models без изменений source truth | Аналитический |
| data-cloud | Ingress/identity links, profiles, merges, segments и downstream projections | Аналитический |
| health | Patient/encounter/care-plan facts, correction и consent; защищённые ссылки на clinical data | Отраслевой |
| insurance | Policy/rating/claims/decision chain; settlement связан с Finance | Отраслевой |
| public-sector | Cases/licenses/grants, authority, statutory notices и disbursements | Отраслевой |
| media | Entitlements, inventory/ad delivery, subscription и consumption | Отраслевой |
| energy | Meter readings/corrections, outages, service calls и late-event policy | Отраслевой |
| education | Courses/enrollments/capacity/credentials, term и student projections | Отраслевой |
| financial-services | Household/account/goal facts, consent, institution ingress и provider cursors | Отраслевой |

Уведомления, webhooks, app installations и импорты обязательно прикрепляются
к домену-инициатору и общему effect/ingress контракту. Новый модуль сначала
попадает в карту покрытия. Пилот Fund не ставит отметку готовности всем Finance.

## 7. Испытания восстановления вне production

Ответственность: реализация + независимая проверка результата.
Зависимости: K1–K5 и конкретный принятый scope K6.

| ID | Испытание | Условие успеха |
|---|---|---|
| K7.1 | Fixtures для реальных бизнес-инвариантов Fund и минимум двух synthetic tenants | Известны независимые ожидаемые значения; fixtures не повторяют ошибку reducer |
| K7.2 | Дубли, конкурентные consumers, crash до/после DB commit/offset commit, rebalance | Один бизнес-результат, нет потерянных подтверждённых фактов |
| K7.3 | Tenant spoofing, чужой ключ/header, invalid schema/hash, version gap | Отклонение до изменения чужих данных; событие сохранено для расследования |
| K7.4 | Намеренно неверный расчёт в тестовой проекции и full-history replay | Исправлена только выбранная проекция; данные другого tenant и source не изменились |
| K7.5 | Запрет sends, provider timeout/UNKNOWN и reconciliation | Ноль replay-вызовов к реальным провайдерам; live timeout не вызывает слепого повторного платежа |
| K7.6 | Потеря broker/Connect/Registry, слота, архива или диска в тестовой среде | Срабатывают нужные alerts; восстановление имеет явные watermarks и измеренные RPO/RTO |
| K7.7 | Catch-up/promotion/rollback под новыми командами, большой backlog и tenant skew | Нет cutover gap, stale rollback и превышения согласованных ресурсных пределов |
| K7.8 | Оператор, не писавший consumer, выполняет runbook | Повторяемый протокол с SHA, config hashes, counts/checksums и receipts; evidence не содержит клиентских payload/секретов |

Тяжёлые проверки выполняются в GitHub CI или разрешённом build worker,
последовательно по ресурсоёмким фазам. Contabo development остаётся для
редактирования, inspection и небольших targeted checks.

## 8. Первый production canary и расширение

Ответственность: платформа/БД/владелец домена. Зависимости: K1–K5 и K7 для
Fund; K6 всех остальных доменов не блокирует начало пилота.

| ID | Задача | Результат / приёмка |
|---|---|---|
| K8.1 | Собрать change record для точного SHA, окружения, tenant scope и времени | Заполнены реальные activation evidence, restore receipt, approvals и stop/rollback criteria |
| K8.2 | Провести GitHub PR и обязательные checks, поставить runtime при выключенных workers | Совпадают merge/deploy/artifact SHA, `/api/v1/ping`, действующая схема и feature smoke |
| K8.3 | Выполнить согласованные PostgreSQL настройки и включить CDC/archive | Snapshot/streaming/slots проверены; все события, которые попадают в connector, проходят schema/privacy contract; consumer allowlist не означает ограничение CDC snapshot |
| K8.4 | Включить Fund worker в shadow для выбранных tenant | Полная сверка с рабочим расчётом; effect workers остаются вне первого scope; соседние tenant проверяются canary-сравнением |
| K8.5 | Провести ограниченный rebuild и promotion после parity/catch-up | Согласованные суммы, count/hash/watermarks и ноль запрещённых effect attempts; rollback пригоден при свежих событиях |
| K8.6 | Наблюдать в заранее установленном окне и проверить stop procedures | Пороги ошибок/lag/нагрузки заданы до запуска; превышение автоматически останавливает расширение |
| K8.7 | Расширять tenant и domain scope отдельными волнами | Каждая волна имеет K6 + K7 evidence и SHA; effects подключаются только после приёмки конкретного provider adapter |
| K8.8 | Закрыть release receipt и operational ownership | Записаны production SHA, deploy run, smoke, активные groups/topics, archive watermark, показатели восстановления и ответственный за alerts |

Обычный production rebuild создаёт новую проекцию/group. Offset reset из K5.8
остаётся отдельной исключительной процедурой и не нужен для самого включения
Kafka. Исторические оплаченные операции/отправки не переисполняются автоматически.

## Очерёдность и конкретные поставки

| Поставка | Состав | Что можно заявить после приёмки |
|---|---|---|
| P0 | K0, карта ресурсов, устранение противоречий статуса | Известны фактический baseline, scope, ограничения и критерии |
| P1 | K1 test stack, K2 на стенде, K4 Fund, K5 базовый lifecycle | Fund проходит сквозной путь и rebuild вне production |
| P2 | K3 archive/recovery/alerts, K5 promotion/rollback, K7 | Восстановление и запрет эффектов доказаны для пилота; все обязательные backup/DR/archive gates его production activation закрыты до P3 |
| P3 | K1 production topology и K8 Fund | Kafka работает для принятых tenant и Fund scope |
| P4 | K6 критические, операционные, аналитические и отраслевые волны; K7/K8 для каждой | Покрытие расширяется по реально принятым доменам |
| P5 | K3 DR/PITR evidence расширенного all-module scope, K6 legacy retirement, повторный независимый drill | Завершён согласованный all-module recovery scope; обязательные prerequisites пилота не откладываются до этой поставки |

K1 infrastructure, K4 adapter и K5 controller можно разрабатывать параллельно
после общих контрактов K0. Доменные миграции K6 могут готовиться заранее;
живое переключение каждой зависит от своих gates. Не требуется сначала
мигрировать весь продукт, чтобы испытать и запустить Fund.

## Как закрывается задача

Для каждого K-ID сохраняются статус (planned/in-progress/verified/blocked),
ответственный, PR/SHA, test/drill/deploy receipt и оставшийся blocker. Платформа
готова только после P3; «все модули» — после P4/P5 и независимой сверки карты
покрытия. Это выполнение оговорённых сценариев, не обещание защиты от любых
возможных ошибок.

Общие условия приёмки: изменения атомарны; дубли не меняют результат; чужой
tenant недоступен; shadow rebuild детерминирован; replay не отправляет ничего
наружу; события не редактируются; correction и UNKNOWN имеют доказанный путь;
архив/PITR восстановимы; measured RPO/RTO соблюдены; runbook воспроизводим.

На этапе составления плана выполнены только чтение репозитория, декомпозиция
и проверка документации. Runtime tests/build/production activation: NOT RUN —
изменений исполняемого кода и запроса на запуск в этом этапе нет.

## Источники проекта

- [Архитектура](KAFKA_EVENT_SOURCING_ARCHITECTURE.md)
- [Каталог доменов](MODULE_EVENT_CATALOG.md)
- [Runbook](PROJECTION_RECOVERY_RUNBOOK.md)
- [Infrastructure assets и activation prerequisites](../../ops/event-platform/README.md)
- [Preflight](../../scripts/event-platform/activation-preflight.mjs)
- [Machine-readable catalog](../../src/lib/event-platform/catalog.ts)
- [Deployment](../DEPLOYMENT.md) и [delivery contract](../DELIVERY-ARCHITECTURE.md)
- [Журнал задачи](../kafka-readiness-session-log.md)
