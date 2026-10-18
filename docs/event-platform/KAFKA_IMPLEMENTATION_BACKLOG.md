# Kafka: задачи до запуска и защиты всех модулей

Актуальное состояние — в последних датированных дополнениях. Начальные
таблицы и прежние pending/PLANNED сохраняются как история, а не как текущий
вердикт; успешную поставку кода нельзя приравнивать к активации Kafka.

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

## Обновление evidence и статусов — 2026-10-18

Исходный план и прежние снимки выше сохранены. Эта секция уточняет только
подтверждённые результаты; строки каталога не становятся «внедрёнными» от
наличия схемы, зелёного CI или таблицы. Ответственный за текущую реализацию
и доставку — root-сессия Kafka; эксплуатационные роли K0.4 этим не назначены.

### Фактические receipts

- Текущий main и production artifact:
  `3cdca2db68823dde281526837fce5ac3aa0af280`;
  [deploy 39076392003](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076392003)
  SUCCESS, public SHA и ping сверены root.
- [Read-only inventory 39079029627](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079029627)
  SUCCESS, наблюдение `23:27:25 UTC`. Точные RAM/disk/PG/файловые данные и
  ограничения приведены в [обновлённом baseline](READINESS_BASELINE.md).
  Все восемь ожидаемых таблиц присутствуют с FORCE RLS, но EstimatedRows=0
  не является exact count. Единственный WAL counter 17852077336 с 4 сентября
  не доказывает WAL/сутки, скорость событий или peak.
- Production PostgreSQL по-прежнему `wal_level=replica`, slot WAL cap `-1`,
  slots=0, outbox publication отсутствует. Logical WAL/restart **NOT DONE**.
- На всех трёх точных HEAD прошли пять required checks и реальные basic/CDC
  jobs. На момент этой записи PR866/867/868 ещё **НЕ MERGED**:

| PR / HEAD | Required checks SUCCESS | Basic SUCCESS | CDC SUCCESS |
|---|---|---|---|
| [866](https://github.com/rashadoni/leaddrive-v2/pull/866) / `12bfbe398e52f2830de8bfa8b9b7ea99fb20b89e` | [39077023050](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077023050) | [39077023226](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077023226) | [39077023158](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077023158) |
| [867](https://github.com/rashadoni/leaddrive-v2/pull/867) / `6c97dbec345745b6bc07a915e78c04a3b9f8a866` | [39076938861](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076938861) | [39076938829](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076938829) | [39076938841](https://github.com/rashadoni/leaddrive-v2/actions/runs/39076938841) |
| [868](https://github.com/rashadoni/leaddrive-v2/pull/868) / `572b3ed36e0bdff668a2bc2e13b0b84a101940bb` | [39077546346](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077546346) | [39077546339](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077546339) | [39077546451](https://github.com/rashadoni/leaddrive-v2/actions/runs/39077546451) |

Pure Fund Vitest выполнен в required suite PR868. Это не прежние 56 Node
tooling checks и не только синтаксическая проверка. Typecheck gate SUCCESS
не означает отсутствие всех TS diagnostics: действует существующий baseline.
Synthetic CDC доказал raw-envelope parity восьми записей и cold restart;
четыре mismatch legacy expanded-режима — выявленный транспортный дефект,
а не допустимое искажение business payload. Исправление шаблона проверено
на стенде, но ещё не доставлено этими PR в main/production.

### Гранулярная карта завершённого scope и открытых частей

`verified (bounded)` означает доказанный узкий результат в указанном
окружении, а не закрытие всей строки K-ID. `in-progress / partial` сохраняет
все неподтверждённые критерии исходной таблицы.

| K-ID | Статус подтверждённой части | Что остаётся |
|---|---|---|
| K0.1 | verified (bounded): текущий main/artifact/ping, read-only таблицы/RLS, exact-head CI receipts | Перед mutation повторять актуальный SHA/preflight; полный аудит всех прав и модулей этим не выполнен |
| K0.2 | in-progress / partial: [Fund](WRITE_PATH_INVENTORY.md) и [ограниченный non-Fund inventory](NON_FUND_WRITE_PATH_INVENTORY.md) | Остальные writers/домены NOT INSPECTED; Warehouse/Accounting только своим card-by-card процессом |
| K0.3 | in-progress / partial: фактические RAM/disk и один cumulative WAL sample | Скорости/peaks, точные counts, tenant skew, backlog budget, RPO/RTO не измерены |
| K0.4 | planned / open decisions | Фактическое дежурство, независимые операторы, доступные failure domains; без новой платной подписки до отдельного решения |
| K1.1–K1.2 | in-progress / partial: production resource snapshot и pinned disposable fixture | Выбор независимых production failure domains, sizing, upgrade/rollback proof |
| K1.3 | verified (bounded, disposable CI): PostgreSQL/Kafka/Connect/Registry поднимаются и проходят smoke | Это single-broker RF1 dev-стенд, не production HA или полноценный staging |
| K1.4–K1.6 | planned / not commissioned | Production quorum/реплики/quotas, TLS/ACL/rotation, live RF3/minISR2 каталог не доказаны |
| K1.7–K1.8 | in-progress / partial: internal test topics, outbox transport, исправленная JSON-сериализация и CI workflow | Registry compatibility enforcement и platform production delivery/live preflight ещё не приняты |
| K2.1 | in-progress / partial: PG/RLS/WAL inventory, private pgpass contract и свежая service readability обоих pgpass/CA | Это не TLS handshake, парольная аутентификация или restore receipt; свежий backup verdict ожидается |
| K2.2–K2.3 | planned / NOT DONE на production | WAL budget и bounded slot policy, logical setting/restart/rollback ещё не выполнены |
| K2.4 | verified (bounded, disposable CI): SQL role/publication guards и негативные ordinary-SQL проверки | Trusted REPLICATION principal не является абсолютной изоляцией от всех DB данных; production роль/connector ещё не активированы |
| K2.5 | planned / production NOT DONE | verify-full, live credentials/rotation и постоянная production slot/connector identity не испытаны; тестовый sslmode не доказательство TLS |
| K2.6 | verified (bounded, synthetic transport): snapshot → streaming, точные восемь source envelopes, headers/key/order | Реальные Fund API commands и production concurrent workload не участвовали |
| K2.7 | in-progress / partial: cold restart с сохранением тестовой истории и cleanup PASS | Длительный outage, WAL exhaustion/invalidated slot и recovery policy не испытаны |
| K3.1–K3.8 | planned / prerequisites in progress | Kafka archive sink/off-provider immutable copy, reconciliation, alerts, PITR/DR и независимый drill не закрыты; backup-file fix не заменяет их |
| K4.1–K4.3 | planned DB/broker adapter; partial reuse контрактов | Явная DB transaction, full-envelope PG hash, per-build inbox/checkpoint, роль и broker ack ещё не реализованы |
| K4.4 | verified (bounded): pure deterministic Fund balance reducer + реальные Vitest | DB fold/dedupe, shadow integration и полный rebuild ещё не реализованы; reducer сам не обеспечивает event-ID дедупликацию |
| K4.5–K4.8 | planned / NOT IMPLEMENTED в новом scope | Broker generation/high-water, retries/quotas/effect adapters, release/runtime smoke worker |
| K5.1–K5.8 | planned / существующие primitives не равны controller | Operator API, планы/approvals, DB shadow, catch-up/promotion/rollback и offset exception не испытаны |
| K6.D.1–K6.D.8 | in-progress / partial inventory только названных цепочек | Ни Finance целиком, ни остальные 26 доменов не объявляются мигрированными; source adoption/effects/legacy retirement требуют отдельных receipts |
| K7.1–K7.3 | in-progress / partial: pure Fund fixtures и synthetic transport assertions | Нет сквозного Fund worker/DB/Broker crash-rebalance/tenant-isolation drill |
| K7.4–K7.8 | planned / NOT RUN | Ошибочный reducer → исправленный rebuild, effects/UNKNOWN, DR, promotion/rollback под нагрузкой и независимый оператор |
| K8.1–K8.8 | planned / production activation NOT DONE | Нет Kafka canary, live Fund worker, production replay/promotion, расширения tenant/domain или Kafka operational receipt |

### Следующий ограниченный шаг и условия остановки

Свежий inventory подтвердил оба pgpass: service UID/GID, mode 0600,
regular/canonical, один link, readable=yes; обе CA readable=yes. Все четыре
timer inactive, но enabled states и полный verdict ещё ожидаются от queued
[backup-readiness 39079208286](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079208286).
Не считать inactive равным disabled. Установка tools оставит четыре timer
disabled/inactive: перед запуском нужны свежие состояния и подтверждённый scope,
с учётом описанных в журнале частичных записей/rollback-ограничений.

Параллельно подготовлен только план restricted Fund shadow DB adapter, без
реализации: immutable createdAt grant candidate, build/controller row lock,
полный PG-jsonb hash, per-build inbox, duplicate/new/older offset cases и
broker partition high-water/generation. Реальные PostgreSQL role/race tests
пока NOT RUN. P1 в целом ещё не закрыт; P2–P5 тем более не достигнуты.

### Дополнение: readiness завершился, подготовка tools только в очереди

Позднейший результат заменяет отметку queued для backup-readiness выше:
[39079208286](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079208286)
FAILURE именно по commissioned-program gate —
`machine_ready=no enterprise_ga_ready=no issues=26 enterprise_gaps=9 operator_attestation_required=yes`.
Успешный inventory этим не отменяется, отсутствие всех других backup не доказано.

Ubuntu 24.04 x86_64 подтверждён, оба pgpass private/readable contract PASS,
CA guards PASS и service readability подтверждена отдельно. Все восемь
canonical ops scripts/pins совпадают с artifact `3cdca2`. Свежие timer states:
DB/secrets/log — `loaded:disabled:inactive`; runtime-files —
`not-found:not-found:inactive`. Отсутствующий timer не считается установленным.
Age/AWS отсутствуют, unit drift/evidence/genesis/stale-runner gaps сохраняются;
статус K2.1/K3.6 остаётся частичным, не verified recovery.

Root поставил единственный
[install-tools 39079299803](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079299803)
на reviewed `3cdca2`; необязательные custody/candidate/evidence fields пусты.
На этой отметке run QUEUED, а не SUCCESS. Backup/restore/Kafka activation
не выполнялись. Следующее действие — прочитать его фактический receipt;
failure может включать частичные config/tools изменения, а не полный rollback.

### Следующее обновление: tools установлены, три PR merged, deploy ожидается

Новые факты заменяют queued-install и NOT MERGED выше, не удаляя историю:

- [Install-tools 39079299803](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079299803)
  SUCCESS на `3cdca2`: age 1.3.2/AWS CLI 2.36.40 с provenance/pins, миграция
  persistent locks. Timer остаются disabled, encryption не изменён.
  DB backup/restore/Kafka не запускались.
- [Post-readiness 39079476339](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079476339)
  FAILURE: `machine_ready=no issues=22 enterprise_gaps=9 operator_attestation_required=yes`.
  Toolchain теперь PASS. Проверка S3 Object Lock стала исполнимой, но результат
  read не удалось подтвердить; точная причина UNKNOWN. Это **не** доказательство
  отсутствия Object Lock, и нельзя угадывать причину по одному failed check.
- DB/secrets/log timer disabled/inactive, runtime-files timer not found;
  CA/service credential file contracts корректны. Unit/evidence/genesis и
  другие reported recovery gaps остаются. Подзадача установки tools имеет
  receipt, но K2.1/K3.6 в целом остаются in-progress / partial.

| PR | Нормальный merge в main после зелёных checks |
|---|---|
| [866](https://github.com/rashadoni/leaddrive-v2/pull/866) | `90eaf1625e114fc3ba6f229c4b9618938ebc7c79` |
| [867](https://github.com/rashadoni/leaddrive-v2/pull/867) | `97f00bd6b1914e87e3b7b3acdc285eaea7d430ba` |
| [868](https://github.com/rashadoni/leaddrive-v2/pull/868) | `7a1cf49e15a10fb1fa03523f9d6dedd07b3574fd` |

Чужой concurrent PR869 уже попал в main как `85dd493fa` до этих merge;
Kafka-задача его не merge-ила и сохраняет изменения без редактирования.
Текущий main — `7a1cf49e15a10fb1fa03523f9d6dedd07b3574fd`, но
[deploy 39079668201](https://github.com/rashadoni/leaddrive-v2/actions/runs/39079668201)
ещё pending. Последний проверенный public artifact — `3cdca2`;
production-доставка `7a1cf49e` пока **НЕ подтверждена**. K8.2 не закрывается
одним merge; актуальные deploy/public SHA/ping должен сверить root.

Статусы остальных K-ID не расширены: K1/K2 synthetic tests и K4.4 pure reducer
теперь merged, но restricted Fund shadow DB adapter **PLANNED / NOT IMPLEMENTED**,
K4.1–K4.3 и реальные DB/role/race tests ещё впереди. Production logical WAL,
restart, TLS/HA/archive, operator replay, consumer activation и all-module
adoption остаются открытыми. Следующая ограниченная реализация — DB adapter;
root независимо продолжает final deploy и existing recovery prerequisites.

### Подтверждённая поставка и текущий узкий blocker — 2026-10-18 00:52 UTC

Это обновление заменяет pending-deploy / PLANNED-adapter выше, сохраняя историю.

- K0.1: поставка предыдущих трёх PR подтверждена deploy39079668201 SUCCESS,
  точным publicSHA `7a1cf49e15a10fb1fa03523f9d6dedd07b3574fd`, ping и
  structural postconditions. Последующий текущий main
  `fa738db91d5e9a7621f86f113a305db4cafba582` также выложен через
  deploy39080638658 SUCCESS и сверён с publicSHA/ping. Это поставка кода,
  не активация Kafka/worker и не новый deep replay Fund.
- K0.3/K2.1: свежий read-only inventory39083640492 SUCCESS на том же main,
  наблюдение00:41:05UTC. PG16.15, wal_level=replica, slot cap-1, slots0,
  outbox publication absent; все8 таблиц RLS+FORCE. Четыре recovery timers
  inactive; pgpass0600/CA0640 service-readable. Точные числа и пределы
  интерпретации — в [baseline](READINESS_BASELINE.md). Logical restart,
  restore, ключи/подписи и независимое хранилище не подтверждены.
- K4.2/K4.3: IN-PROGRESS, не PLANNED — PR871 содержит неактивный SQL adapter
  с настоящим COMMIT factory, tenant/build/fence lock, PG full-envelope hash,
  атомарными shadow/inbox/checkpoint. Нет вызывающего broker worker/ack и
  production установки ролей. Приложение/source/active v1/pointer/effects
  этим адаптером не изменяются.
- Реальный PG gate39083337348 на0917e6227: **8/9 PASS**. Уже подтверждены
  исходный source guard, два tenant/независимый RLS, точные суммы/parity,
  дубли/монотонные checkpoints, tampering, SQL/deferred-COMMIT rollback,
  запреты прав и настоящий controller race. Конкурентный INSERT принудительно
  даёт1commit/1reject; точная Prisma wrapper shape неизвестна. До доказанного
  целого transaction retry эта часть K4.2 НЕ закрыта и merge заблокирован.
- Typecheck того же run SUCCESS по существующим gates: наши5 Fund TS-файлов
  без диагностик; общие1326 advisory /64 gated пары=baseline64, не глобальный
  чистый TypeScript. Synthetic CDC39083337253 SUCCESS на том же SHA.
- Диагностический draft3da0223f5 даёт только обезличенные structural facts,
  не разрешает произвольные SQL/unique errors и не меняет runtime isolation.
  Новый PG/TS proof ещё NOT RUN. Очередь: завершить этот gate и обычную
  поставку; затем отдельный ограниченный read-only Object Lock diagnostic
  для K2.1/K3.2/K3.6. Не повторять commissioning и не включать timers ради
  зелёного отчёта. K4 broker/rebalance/replay и K8 остаются NOT ACTIVATED.

### Fund SQL: реальный gate закрыт в узком scope — 2026-10-18 02:09 UTC

Заменяет прежние partial8/9, unknown-error и unmerged-PR871, сохраняя историю.

- На final `f504f1353df3902d72d021e00cf515ca1e74e1d0`
  [full39087214329](https://github.com/rashadoni/leaddrive-v2/actions/runs/39087214329)
  SUCCESS; пять required checks фактически SUCCESS. Reducer43/43, shadow
  control-flow78/78; реальные PostgreSQL10/10 с независимыми restricted LOGIN,
  RLS, full-envelope hash, SQL/COMMIT rollback и controller race. Конкурентный
  losing connection повторяется через НОВЫЙ factory после проверки winner и
  source/counts; arbitrary23505 не принимается за успех.
- Наши Fund TS-файлы без диагностик, общие1326 advisory/64 gated пары=64;
  общий unit baseline18=18. AutomaticCDC39087214341/stack39087214349 SUCCESS
  на том же head. Обновлённый immutable Connect image реально проверен,
  но owned long-term image retention/signature этим не доказаны.
- PR871 нормально merged02:09:27UTC, main merge
  `287047e2e7fd63a6265b646851aa74384715d4ad`. Его deploy и public exact SHA/
  ping/structural smoke ещё PENDING: один merge не является K8 delivery receipt.
- K4.2/K4.3 — verified bounded DB increment, не закрытые целиком K-ID.
  Нет broker caller/ack, assignment/generation/global-partition fence, live
  role provisioning, source/active/effect writes или production activation.
  K4.5–K4.8, replay, HA/archive/DR и остальные модули остаются открытыми.
- Следующая отдельная задача K2.1/K3.2/K3.6: безопасно классифицировать причину
  existing Object Lock read failure без raw stderr, секретов и runtime writes.
  Не включать timers, не менять credentials/retention и не запускать повторный
  commissioning ради диагностического результата.

### Подтверждённая поставка Fund SQL — 2026-10-18

- [Deploy39089075829](https://github.com/rashadoni/leaddrive-v2/actions/runs/39089075829)
  полностью SUCCESS на merge287047e2e7fd63a6265b646851aa74384715d4ad,
  runtime02:42:32Z, финальный этап02:42:54Z. Root отдельно сверил exact public
  artifactSha и ok=true ping; revision/login/assets smoke и structural
  event/Fund/RLS/ownership/exact-money postconditions прошли. Это заменяет
  предыдущий PENDING delivery, но не является новым deep replay или worker.
- Release gate повторил121/121 unit и10/10 real PostgreSQL; общий baseline18=18.
  K4.2/K4.3 имеют проверенную и слитую неактивную DB-часть. Broker caller/ack,
  generation/high-water и production role provisioning остаются отдельными
  открытыми задачами. K8 activation и защита всех27 доменов НЕ объявляются.
- После поставки один read-only inventory39091217812 запущен на текущем
  main/artifact; его свежий runtime verdict ещё pending. Следующий draftPR872
  — ограниченная классификация Object Lock failure без изменения runtime.
  Его local10/10 safety tests не заменяют будущие full required gates.

### Свежий postflight на поставленном SHA — 2026-10-18 02:45 UTC

- Inventory39091217812 SUCCESS на287047e2, observed02:45:50Z. PG16.15,
  readOnly=on, wal_level=replica, slots0/active0/retainedWAL0, publication
  отсутствует; source CDC не настроен/не стримит. Наличие произвольных внешних
  broker/Connect/consumer процессов этот aggregate inventory не проверяет.
- Все8 event-таблиц RLS+FORCE; estimatedRows0 не exact count. Четыре recovery
  timers inactive; restore NOT PERFORMED. Файлы pgpass/CA private/canonical и
  service-readable; masked owner CA не выводится из предположений.
- Числа RAM/disk и новый cumulative WAL sample записаны в baseline. Это всё
  ещё не утверждённые peak/day/slot/outage budgets. K2.2/K2.3, независимый
  recovery/immutable archive, broker runtime и K8 activation остаются открытыми.
- Следующий PR872 остаётся report-only: закончить final-head required gates,
  обычную поставку и диагностировать existing Object Lock failure; не менять
  policy/ключи, timers или source ради зелёного readiness.

### Диагностика прошла gates и merged — 2026-10-18 03:17 UTC

Это заменяет прежний draft/pending CI для PR872, не runtime-статус Kafka.
На frozen3a6be7bf7 full39091474520 SUCCESS: пять actual required SUCCESS,
диагностика10/10, Fund121/121, real PostgreSQL10/10, общий baseline18=18.
Typecheck64 gated пары=64 baseline, свои Fund TS без ошибок; глобально
остаются1326 advisory diagnostics. Отдельный pgpass39091475113 SUCCESS30/30
с реальной libpq-аутентификацией.

PR872 normally merged03:17:20Z как ce71dacf9a413facda602fb433963e1cbe79412b.
Automatic deploy39093089774 ещё PENDING. K2.1/K3.2/K3.6 получают безопасный
инструмент выяснения причины, но не подтверждение восстановления/retention.
До whole-deploy SUCCESS и exact publicSHA/ping новая live-диагностика не
запускается. Ключи/policy/timers/source/consumers/offset/replay не изменялись;
K8 и all-module readiness по-прежнему NOT ACTIVATED / NOT VERIFIED.

### PR872 доставлен; recovery verdict остаётся красным — 2026-10-18 03:48 UTC

Deploy39093089774 whole SUCCESS03:46:02Z на ce71dacf9a413facda602fb433963e1cbe79412b.
Root сверил exact public artifactSha/ping, quality diagnostic10/Fund121/realPG10,
baseline18=18 и фактические structural/revision/login/assets postconditions.
Это заменяет предыдущий pending delivery, но не закрывает K2.1/K3.2/K3.6.

Единственный protected read-only readiness39094842540 FAILURE03:48:00Z:
machine_ready=no, issues22, enterprise_gaps9, operator_attestation_required=yes.
ObjectLock=service_error; конкретная причина/отсутствие lock/неверные ключи
этим НЕ доказаны. Tools/program-set PASS, encryption OFF; DB/secrets/log
timers disabled/inactive, runtime-files timer absent; unit/evidence/genesis/
MemorySwapMax/fresh-run gaps открыты. Никакого backup/restore/replay не было.

Следующий ограниченный исходный change — различить документированные service
error classes и неизвестный формат без raw code/body/секретов. Не повторять
старый report вслепую и не менять доступы/retention/таймеры ради зелёного gate.
K8 activation, независимое восстановление, HA и all-module coverage не готовы.

### K0.3/K2.2: измерен интервал WAL, не peak budget — 2026-10-18 04:11 UTC

Один новый protected read-only inventory39096218310 SUCCESS на deliveredce71
добавил вторую точку с тем же reset:02:45:51.420078→04:11:39.529597UTC,
17891881657→17907414978bytes. Рост15533321bytes (14.81MiB), среднее около
3017bytes/s за5148.109s. Точные receipts/ограничения сохранены в baseline.
Это WAL всего PostgreSQL-кластера за интервал с выкладкой, не event rate,
пик/сутки/tenant skew и не согласованный лимит слота/простоя. K0.3/K2.2
остаются partial; source всё ещё replica/slots0/publication absent/cap-1.
Restore не выполнялся; четыре recovery timers inactive; activation не было.

### PR873 доставлен; новый recovery report ожидается — 2026-10-18 04:54 UTC

Следующий report-only change завершён: PR873 actual five required SUCCESS на
a222b769f2cd773e80177b7e8403591f721e1d7f, normal merge24ce6e9c031fc465fe55b6c36f4d6d81306f3ce2.
Deploy39096745285 whole SUCCESS04:52:25Z: diagnostic/freshness12/12,
Fund121/121, realPG10/10, baseline18=18; runtime structural ledger/RLS/
ownership/exact-money/Fund и ping/revision/login/assets подтверждены. Root
независимо сверил public exact24ce artifactSha и успешный ping.

Исправлена ложная свежесть пустой даты и добавлены фиксированные service
категории без раскрытия сырых ошибок. Это не исправление storage policy или
свидетельство backup/restore. K2.1/K3.2/K3.6 по-прежнему открыты. После whole
delivery запущен ровно один protected read-only readiness39098707822 на24ce;
его новый verdict PENDING, предыдущий завершённый остаётся22issues/9gaps.
Не запускать старый report повторно ради зелёного результата; не включать
timers/шифрование, не менять ключи/retention и не начинать source CDC/replay
на основании одного merge/deploy. K4 broker worker и K8 activation не закрыты.

### Новый фактический verdict и граница следующего шага — 2026-10-18 04:55 UTC

Readiness39098707822 завершён FAILURE04:55:37Z на exact24ce; full SUMMARY:
machine_ready=no, issues23, enterprise_gaps9, operator_attestation_required=yes.
Это заменяет pending/22issue выше; appdeploy39096745285 остаётся SUCCESS.
ObjectLock=service_error_format_unrecognized: CLI254, ожидаемый точный формат
ошибки не распознан. Причина, права/ключи, регион, HTTP status и наличие lock
не установлены. Не делать предположительные policy/key изменения/новый retry.

Runtime-files freshness теперь FAIL вместо прежнегоPASS; исходная скрытая
метадата отдельно не проверена. Все4 freshness и4 MemorySwapMax FAIL, шифрование
OFF; три таймера disabled/inactive, четвёртый отсутствует. Tools/file guards/
immutable program PASS.23 FAIL-строки включают агрегирующие проверки, это не
23 независимых задачи. K2.1/K3.2/K3.6, topology/archive/DR и K8 остаются NO-GO.

Следующая эксплуатационная операция требует отдельного подтверждённого scope:
закрытая диагностика storage и настоящее подтверждение custody/восстановления
с независимым ответственным. Исторический Mac/Drive copy receipt и AI не
заменяют подписанный drill. Платные услуги/новые ресурсы не заказывались.
Программный остаток P1/K4 тоже явно открыт: broker worker, assignment/high-water,
restricted runtime provisioning, интегрированный rebuild и read cutover ещё не
сделаны. Инвентарь Payments/OTP не означает миграцию их application writers;
покрытие всех модулей и100% здесь не объявляются.

### K0.4: второй человек назван владельцем — 2026-10-18

Владелец ответил на вопрос о втором ответственном и назвал человека в чате.
Прежняя формулировка «ответ не получен» заменяется этим фактом; персональное
имя не публикуется в этом открытом репозитории. K0.4 остаётся partial: согласие
самого проверяющего, фактическое участие, привязка лично контролируемого
подписывающего ключа и проверенной identity ещё не подтверждены. Имя не даёт
доступ, не является approval/signature и не доказывает custody/restore.

Далее — согласовать участие и поддерживаемую независимую машину для уже
описанного offline canary/custody, затем отдельного exact-version scratch
restore. Storage/candidate prerequisites проверяются до соответствующей
операции. Не генерировать подпись от имени человека и не передавать private
keys/пароли в чат, GitHub или production. Последний23/9 NO-GO остаётся
историческим operational verdict; в этом ходе runtime не перепроверялся.

### K4.1/K4.5: partition coordinator — implementation in progress

Added inactive `partition-processor.ts` and `fund-shadow-worker.ts`. One
assignment owns the complete ordered partition stream across admitted tenants.
Each actual SQL COMMIT precedes its broker acknowledgement. A tenant-local
checkpoint is never a broker resume/commit position: an old duplicate can
return a newer tenant checkpoint while other tenants still need processing.
The worker holds a snapshot of the trusted tenant/build/database routing plan.
Unknown tenants/types, poison records, uncertain acknowledgement, invalid
delivery boundaries or revoked membership stop the assignment without skipping.
There is one in-flight batch, with bounded record/byte counts and no hidden
queue or automatic retry. Legitimate numeric holes in Kafka offsets are allowed;
the driver must supply every record from the unfiltered ordered broker fetch.

The broker port must bind cluster/group/member/generation/topic/partition to
the original assignment, disable auto-commit and reject stale membership at
the broker, including the race after a local liveness check. A local token is
not a durable database lease. Already-running SQL can commit after revoke; the
coordinator withholds acknowledgement and the inbox makes replay repeatable.
Changing the routing/build plan requires a separately governed group/history
plan; do not reuse a group's advanced offsets to initialize a new build.

This increment does not create a Kafka connection, production entrypoint,
worker deployment, runtime credentials, durable assignment fence or activation.
Real group join/rebalance/retention-gap and integrated Kafka+restricted-PG
tests remain open. New control-flow and real PostgreSQL coordinator tests are
prepared; execution receipts must be appended before claiming verification.
The existing recovery NO-GO and independent restore prerequisites are unchanged.

Protocol references: [Apache Kafka consumer offsets](https://kafka.apache.org/41/javadoc/org/apache/kafka/clients/consumer/KafkaConsumer.html)
and [Kafka group/offset protocol](https://kafka.apache.org/41/design/protocol/).
The commit position denotes the next record to consume; it is not the
maximum checkpoint returned by any tenant callback.

### K4 coordinator verified and merged; release pending — 2026-10-18 10:59 UTC

PR877 source1cfdb3ed passed actual189/189 focused units,14/14 restricted-PG
tests and all5 protected checks in39119897984. Synthetic CDC39119897962
also passed raw8/8 and cold restart, independently of the new worker port.
Normal merge produced133654f4a064adcbb81b6458d05f80b8b7423dec. Production
release is still pending at this entry. The above implementation-in-progress
label is superseded for this inactive coordinator only, not for all K4.

Real broker membership/retention integration, connected worker entrypoint,
runtime provisioning/release, recovery and activation remain open. No actual
consumer group, production offsets or data replay was started by this change.

### K4 coordinator delivered; activation still separate — 2026-10-18 11:32 UTC

PR877 release39121398342 attempt1 whole SUCCESS11:31:59Z on merged
133654f4a064adcbb81b6458d05f80b8b7423dec. Release gates repeated189/189 focused
unit and14/14 actual restricted-PG cases; baseline18=18. Immutable artifact
12135041765 and its SHA-256 are recorded in the session journal. Runtime
structural/Fund postconditions and public revision/ping/login/assets passed.
Root independently confirmed exact public133654 and ping/login/CSS/JS at11:32.
This supersedes the release-pending entry, for this inactive component only.

One exact-SHA aggregate inspection via the registered production alias was
rejected by SSH authentication before executing the script. Fresh source
WAL/slot/timer inventory is NOT RUN. Current-main readiness was not dispatched
against a mismatched artifact or allowed to replace another release's pending
production operation; foreign39123362068 was building and remains untouched.
The previously recorded recovery23/9 NO-GO is historical and not superseded
by app health. Broker driver, actual rebalance/retention integration, runtime
provisioning, independent restore, read cutover and K8 activation remain open.
Consumer activation, offsets and replay were not changed by PR877.

### K4 broker driver: real failure drill, final revision pending — 2026-10-18

PR880 adds an inactive Apache Kafka4.3.1 classic/EAGER Java bridge plus a
bounded private-pipe adapter for the existing partition coordinator. Actual
broker run39128688023 SUCCESS12:52:29UTC on sourcea094193d41331810bcc74220365ac5c414042d0c:
13 scenarios passed, including expired membership, concurrent takeover,
retention and topic recreation during database-callback work, restart,
transaction holes and pre-send/post-commit acknowledgement uncertainty.
Fixture cleanup passed. Database effects in this fixture are simulated;
the independent restricted-PostgreSQL gate remains mandatory.

Final review then reproduced a header-name BOM normalization defect. The
local correction preserves the exact identifier and passes89 adapter tests.
PR880 returned to draft; updated exact-head checks/broker proof, normal merge
and production artifact verification are still pending at this entry. Do not
infer that the old passing run certifies the revised source or an active worker.

This advances K4 implementation, not all K4/K8 admission. Combined actual
Kafka+restricted-DB failure testing, runtime entrypoint/provisioning,
durable lifecycle/leases, protected broker topology/ACLs and full-history
coverage, independently verified recovery, monitoring and separately governed
activation/read-cutover remain open. No production consumer/offset/replay,
source WAL/slot, recovery commissioning or new service purchase occurred.

### K4 combined broker + SQL drill prepared — 2026-10-18 13:41 UTC

PR880 final source7ec815288af3465428ec6694d60d7b47b7bbaecf passed all five
actual protected checks and broker39129612814 (13 scenarios); normal merge
produced e1e50cb5032f21f5f6295006420126ede28a52d5. Automatic deploy39131091042
is still in progress. This supersedes the earlier final-revision-pending entry,
but is not yet the app's production receipt or installation of a Java worker.

The next isolated branch prepares six real Kafka + restricted PostgreSQL
scenarios: tenant interleaving/restart/exact parity, hold before real COMMIT,
deferred COMMIT rejection, pre-send ACK loss, committed receipt loss and stale
member takeover after actual SQL COMMIT. Shared SQL fixture preserves the
existing14 real-PG tests, actual three migrations and restricted grants/RLS.
New control-flow tests22/22 pass locally; actual combined integration is
NOT RUN until the dedicated GitHub gate executes on the frozen source.

This uses an exact-byte synthetic outbox producer, not Debezium; it does not
close the full CDC-to-rebuild, runtime packaging/lifecycle, broker HA/TLS/ACL,
full-history, independent recovery, or production activation/read-cutover
tasks. No real offsets, source data, consumers or recovery services changed.

### PR880 app release confirmed — 2026-10-18 14:11 UTC

Deploy39131091042 whole SUCCESS14:09:15Z on e1e50cb5032f21f5f6295006420126ede28a52d5;
immutable artifact12138947773, runtime Fund/structural postconditions and root's
independent exact public SHA/ping/login/CSS/JS checks passed. This supersedes
the preceding release-pending entry. Java worker packaging/installation and
Kafka activation did not occur; encrypted recovery/log shipping remain inactive.

The prepared combined-test branch now has327/327 local control-flow tests and
11/11 script/contract guards passing. Actual combined broker+SQL execution is
still NOT RUN until its forthcoming frozen-source GitHub gate returns.

### K4 combined Kafka + restricted PostgreSQL verified — 2026-10-18 15:33 UTC

PR883 source92aa3c5d380625dfbb86d85bbbea22d600f8d934 passed actual combined
run39139978362/job117712215441 (SUCCESS15:32:34Z): strict generated-client
ES2017 compilation,53 fixture tests, real migrations,13 broker scenarios and
all6 combined cases. This supersedes the preceding NOT RUN for the bounded
combined drill, not for all K4. Exact ordering/parity, no pre-COMMIT ACK,
deferred COMMIT rollback, durable-inbox ACK loss, receipt loss and actual stale
member fencing after committed SQL are now exercised together. Test cleanup
passed. The earlier takeover failure and corrected private-pipe lifecycle are
preserved in the append-only session journal rather than hidden by a retry.

Mandatory PR gates and normal production delivery remain pending at this entry.
Exact outbox fixture publication is not Debezium. Full CDC-to-rebuild, governed
worker packaging/lifecycle, HA/TLS/ACL, independent recovery, all modules and
production activation/replay/read-cutover remain open and unperformed.

### PR883 verified and merged; release pending — 2026-10-18 15:39 UTC

All five actual protected contexts on92aa3c5d passed; required PR39139978372
includes280 focused and14 real-PG tests, unchanged18-file/64-pair baselines.
Separate combined39139978362 (13+6), CDC39139978367 and stack39139978571 all
SUCCESS. Normal exact-head merge producedf41ba03328b5aeda9c06f5e5baf27437683d255b
at15:38:55Z. Automatic application release remains pending at this entry; no
Java-worker installation, Kafka consumer activation or data replay occurred.

### PR883 delivered and independently verified — 2026-10-18 16:13 UTC

Automatic release39141430405 whole SUCCESS on
f41ba03328b5aeda9c06f5e5baf27437683d255b. Quality repeated280 focused and14
real restricted-PG tests with unchanged18-file baseline; actual full build
and immutable artifact12141838839 succeeded. Production structural/RLS/Fund
postconditions and public exact SHA/ping/login/assets passed; root repeated
public checks16:12:32Z. This supersedes the preceding release-pending entry.

The completed bounded proof is13 actual broker scenarios plus6 combined
broker/restricted-SQL scenarios, not all K4/K8. Production recovery remains
plain/uncommissioned, its four timers stopped and off-box log shipping
inactive according to the actual release log. Java-worker packaging/service,
full CDC-to-rebuild, governed lifecycle/promotion, HA/TLS/ACL, independent
recovery, all-module adoption and specifically authorized activation remain
open. One current-SHA read-only aggregate inventory39143994149 is pending;
it cannot certify restoration or activate consumers/replay.

### Fresh runtime inventory after PR883 — 2026-10-18 16:14 UTC

Inventory39143994149 SUCCESS16:13:30Z on exactf41ba033; pending above is
superseded for inspection only. PostgreSQL160015 is still wal_level=replica,
max_slot_wal_keep_size=-1, slots0/active0, intended outbox publication absent.
All8 expected event/projection tables exist with forced RLS. Planner row
estimates are not exact history counts. The4 scoped recovery timers are
inactive; restore verification NOT PERFORMED. Present passfiles/CAs do not
prove recovery. Earlier23/9 readiness totals were not rerun; do not relabel
them as fresh evidence or this successful inventory as activation readiness.

Next bounded software work is K4.1/K4.8 worker entrypoint/artifact and graceful
stop/restart admission, plus separate full Debezium-to-restricted-SQL proof.
No production startup/automatic replay follows from those preparations.
Production CDC/source maintenance, recovery commissioning, independently
verified restore/approval, HA/TLS/ACL, lifecycle/promotion and all-module
adoption remain open. No subscriptions/resources were purchased.

### K4.1/K4.8 lifecycle prerequisite in progress — 2026-10-18

Next dedicated branch prepares owned-child supervision (private bounded pipes,
EOF/TERM/KILL, actual-close evidence, sanitized failures) and a finite bridge
session (intake deadline, immediate stop/ACK fence, SQL settlement before client
release, no automatic restart). The combined CI drill is extended from6 to8
scenarios: stop during SQL and after actual COMMIT, then resume from unchanged
broker offset without duplicate shadow effects. At this entry the new actual
integration is NOT RUN, pending the frozen-source GitHub gate.

These are prerequisites, not a complete standalone production entrypoint.
Direct-child tests use tiny Node children; existing CI Java uses its established
container-specific reaping harness. Immutable worker packaging, governed config
admission, direct-JVM lifecycle composition, full Debezium-to-SQL rebuild,
independent recovery, HA/TLS/ACL, all-module adoption and authorized activation
remain open. No production service, WAL/slot, offset/replay or backup action is
performed by preparing these modules.

### Lifecycle bounded proof verified; release still pending — 2026-10-18 18:08 UTC

PR889 exact sourcedbba7c0f16075c17b91a9b8d6685a3cf1e47eb2d passed
broker run39151613583/job117746248594: generated-client strict types,
113 fixture/lifecycle tests,13 broker cases plus all8 real restricted-SQL
combined scenarios. Both new stop/restart cases preserve durable inbox, fence
ACKs and release owned connections only after SQL settlement. Prior NOT RUN
is superseded for this scoped integration proof only. Separate synthetic CDC
39151613585 passed, but full CDC-to-rebuild/direct-JVM runtime composition is
still open. Mandatory static-checks and normal merge/release remain pending;
no production consumer, replay or recovery commissioning occurred.

### Corrected lifecycle source verified and merged — 2026-10-18 18:58 UTC

Superseding the preceding pending-source receipt: PR889 final source
`ea6d16965fdafdf5f0245f6bd88ed3485311edbf` passes all5 mandatory checks,
actual Next/generated-client strict types,113 fixture/lifecycle tests,
13 broker cases and8 combined restricted-SQL cases (run39154321016).
Full typecheck report contains zero diagnostics in the task-owned files;
three previously advisory NODE_ENV test errors were corrected before merge,
and strict CI now includes the real Next ambient declaration to prevent return.
No full-suite/type diagnostic baselines were weakened.

Ordinary merge SHA `4cbdece263fa78d67f763fc32f7c03b17035c9b4` at18:58:04Z;
automatic application release39156579615 is pending build/quality/smoke.
This does not package/install/activate the separate worker. Next smallest
inactive prerequisite is governed launch/config admission and immutable worker
manifest, followed by actual direct-JVM lifecycle composition. Full Debezium
to restricted-SQL rebuild, infrastructure HA/TLS/ACL, recovery evidence and
independent confirmation, operator lifecycle/promotion and other domain
adoption remain open. No production consumers, offset/reset/replay or backup
commissioning was performed by this delivery.

### PR889 application release verified — 2026-10-18 19:29 UTC

Release39156579615 SUCCESS; production job117766465860 completed19:27:57Z.
Actual standalone artifact and independent public build-info both identify
`4cbdece263fa78d67f763fc32f7c03b17035c9b4`. Public ping, login, hashed CSS/JS
and structural event-platform/RLS postconditions passed. Existing Fund
cutover receipt was reused; no fresh deep rebuild is claimed.

The inactive lifecycle prerequisite is delivered as source/application release,
not a separately packaged or active Kafka/JVM service. K4.1/K4.8 overall,
full CDC-to-SQL composition, independent recovery and governed activation
remain open. A single fresh aggregate read-only inventory is pending; no
consumer/offset/replay, WAL/slot, timer or recovery mutation was performed.

### Fresh inventory after delivered lifecycle slice — 2026-10-18 19:31 UTC

Read-only39158980732 SUCCESS on exact deployed4cbdece263fa, observed19:29:40Z:
source wal_level=replica, slots0/active0, outbox publication absent, WAL slot
cap=-1. All8 inspected tables retain RLS+FORCE RLS; estimated rows are not
exact counts. Four scoped recovery timers remain inactive; restore verification
was not performed. About85% host memory/filesystem available is not HA proof.
No source/runtime/backup mutation followed this successful inventory.

The delivered prerequisite does not complete K4.1/K4.8 or production readiness.
Next source slice is offline governed launch/config admission and immutable
worker binding, reusing current Fund scope/build and activation contracts.
Offline validation must not claim actual broker metadata, artifact bytes,
authenticated independent approval or real recovery. Existing secret-manager
references remain authoritative; arbitrary local credential files are not a
replacement. Actual direct JVM composition, full CDC-to-SQL proof and the
previously listed activation/all-domain gaps remain open.

## Семь этапов автономного выполнения — поручение владельца 2026-10-18

Владелец поручил записать все семь этапов, выполнять их автономно по порядку
и разделять подготовку на несколько сессий, когда это ускоряет работу.
Разрешённый обычный маршрут изменений: отдельная ветка → GitHub PR → все
обязательные и относящиеся к изменению проверки → merge → GitHub production
workflow → фактический artifact SHA, ping и проверка поведения. Готовность
этапа отмечается только по его результату и сохранённым доказательствам.
Подготовка независимых частей может идти параллельно; тяжёлые интеграционные
испытания и production-операции координируются последовательно. Платные
ресурсы не приобретаются. Фактическое независимое подтверждение восстановления
и существующие эксплуатационные ограничения сохраняются.

| Этап | Работы по порядку | Условие завершения | Текущий статус |
|---|---|---|---|
| A1. Проверяемый отдельный обработчик | A1.1 Проверка плана запуска, tenant/build/role/group/version и secret references; A1.2 SHA-привязанный пакет, проверка его файлов и ограниченный прямой запуск JVM; A1.3 Сборка и реальные stop/restart испытания | Проверенный пакет и конфигурация запуска; настоящий управляемый JVM вместе с Kafka и restricted SQL; корректная остановка до/после COMMIT, отсутствие двойного применения | В РАБОТЕ; lifecycle prerequisite PR889 уже доставлен, A1 целиком ещё не завершён |
| A2. Полная цепочка событий | A2.1 Реальный Debezium из разрешённого outbox; A2.2 Kafka → Fund shadow SQL; A2.3 Полная история, повреждённый расчёт, дубли, остановка и повторный запуск для двух synthetic tenants | Один сквозной результат на реальных CDC/Kafka/SQL, точные суммы и watermarks; source/другой tenant/внешние эффекты не изменены | ОЖИДАЕТ; отдельные transport и consumer proofs не засчитываются как A2 |
| A3. Резервирование и доказанное восстановление | A3.1 Сверка существующего recovery-контракта и пригодности scratch; A3.2 Проверенные зашифрованные копии БД, секретов и runtime; A3.3 Восстановление в изолированную среду и независимое подтверждение; A3.4 Включение расписаний после выполнения их условий | Свежая восстанавливаемая копия, измеренные RPO/RTO, подписи/receipts, доставленные alerts; исходная база не заменена | ОЖИДАЕТ; четыре scoped timers неактивны по inventory39158980732 |
| A4. Production-инфраструктура | A4.1 Инвентарь уже доступных независимых ресурсов и бюджет; A4.2 Broker/Connect/Registry deployment; A4.3 TLS, ACL, private routes, RF/minISR; A4.4 Retention/archive/WAL budgets и согласованное CDC-обслуживание | Подтверждённая topology и отказоустойчивость по действующему контракту; отсутствие неподтверждённых расходов; ограниченная нагрузка и сохранность истории | ОЖИДАЕТ; source logical CDC не commissioned |
| A5. Управление и аварийные действия | A5.1 Authenticated operator admission и жизненный цикл build/lease; A5.2 Мониторинг и фактически доставленные тревоги; A5.3 Promotion/catch-up/rollback и выполнение runbook | Воспроизводимые drills, сохранённые evidence, рабочие alerts и возврат версии без потери новых данных | ОЖИДАЕТ |
| A6. Production-пилот Fund | A6.1 Проверка A1–A5 и фактических approval/recovery evidence; A6.2 Разрешённый ограниченный canary; A6.3 Parity под новыми событиями и проверка остановки/возврата | Фактически работающий ограниченный поток Fund, сверка по организациям, ноль повторных внешних действий и подтверждённый rollback | ОЖИДАЕТ; consumers/replay не включены предыдущей выкладкой |
| A7. Все остальные модули | Для каждого домена выполнить K6.D.1–K6.D.8 из существующей матрицы 27 domainId; разделить историческую миграцию, source facts, projections и effects; пройти canary/rollback каждой волны | Отдельная приёмка всех write paths, tenant isolation, корректировок, rebuild и effects по каждому домену | ОЖИДАЕТ; Fund не означает готовность всей Finance или остальных модулей |

В каждом этапе: реализация → узкие проверки → реальные относящиеся к нему
интеграционные проверки → обычная доставка → проверка результата → запись
receipt и следующей точки. Не объявлять A1 завершённым по одному parser-тесту,
A2 по двум раздельным smoke, A3 по наличию файла или A6 по успешному merge.
Промышленная активация допускается только после фактического выполнения её
условий; отсутствующие доказательства нельзя заменять именами или true в JSON.

### A5/A7 operator preparation — 2026-10-19

На main226dde0e7 отдельная operator-readiness ветка добавляет inactive
read-back verifier доставки десяти monitoring alarms и
[KAFKA_OPERATOR_READINESS.md](./KAFKA_OPERATOR_READINESS.md): A5 boundary audit,
27-domain source/projection/effect/idempotency/rebuild/evidence map и точную
очередь следующей работы. Это не authenticated operator API и не activation.
Boolean monitoring flags остаются недостаточным доказательством доставки;
provider adapter/real challenge/ack receipts ещё NOT RUN.

A1/A2 подготовлены отдельно в codex/kafka-worker-admission-20261018,
e298057d94804417d38fb105d960721bae6fc1cc; здесь не дублируются. Новые реальные
integration checks ещё NOT RUN. Общая доставка остаётся исходной сессии
«Проверить защиту Kafka-консюмера». Никаких production mutations, consumer
startup, offset/replay, sends, merge или deploy эта подготовка не выполняет.

### A5 inactive authenticated DB admission prepared — 2026-10-19

Draft PR894 extends the bounded operator preparation with a private SQL schema
outside production migrations: trusted named-login mapping, immutable Fund
plan/hash, independent approval, one-time consume, controller-bound generation,
revoke and deferred transaction-end lease check. There is no HTTP/runtime
executor, business-table grant, read-pointer switch or Kafka operation.

Actual isolated PG16 run39164468500 on ab0aff696 passed13/13 admissions/races
and28/28 receipt units. Later role/expiry/deferred-fence hardening needs its
own exact-source receipt; see the append-only operator journal for updates.
A passing control-schema fixture does not close K5 catch-up/promotion/rollback,
K7 full-domain recovery, actual delivered monitoring or K8 activation.

The existing scanner flags historical ordinary README prose as generic-api-key;
no scanner policy/check/history was altered to bypass it. PR remains draft,
without merge/deploy. Original A1/A2 PR891 and integration scheduling remain
 owned by the originating session; this branch neither starts nor reruns them.

### A1/A2 exact synthetic software proofs obtained — 2026-10-19

Superseding the earlier pending integration receipts only, NOT runtime gates:
actual direct-JVM/Kafka/restricted-SQL lifecycle passed in39164817267 on
source1d526a126, with verified client-only candidate bound to checked-out merge
SHA3b4fde212f. Corrected full canonical app-role SQL → Debezium snapshot/WAL
cold restart → Kafka → restricted Fund SQL passed BOTH jobs of39169379400 on
267507fcca5c59d5b19cb80652485a1b985b1fae. Exact two-tenant decimal parity,
post-COMMIT ACK loss/redelivery, synthetic bad old shadow and corrected NEW
build/group full-history rebuild passed; source/active/effects/third tenant,
old bad builds and old group unchanged. External sends NONE. Historical buggy
binary NOT CLAIMED. Full-CDC drill uses its existing container bridge; the
separate direct-JVM lifecycle proof is not relabeled as that same drill.

PR891 remains draft pending FINAL-source protected and feature checks, normal
merge and release. Earlier frozen A5 admission snapshot passed17 actual PG
cases; later A5 evidence collectors are held separately for concrete negative
controls. These proofs do not commission a production worker, logical CDC,
HA/TLS/ACL, independent recovery/Farah confirmation, real alerts/controller,
Fund canary or27-domain adoption. A3/A4 and activation remain NO-GO.


### A5/A7 operator preparation — 2026-10-19

На main226dde0e7 отдельная operator-readiness ветка добавляет inactive
read-back verifier доставки десяти monitoring alarms и
[KAFKA_OPERATOR_READINESS.md](./KAFKA_OPERATOR_READINESS.md): A5 boundary audit,
27-domain source/projection/effect/idempotency/rebuild/evidence map и точную
очередь следующей работы. Это не authenticated operator API и не activation.
Boolean monitoring flags остаются недостаточным доказательством доставки;
provider adapter/real challenge/ack receipts ещё NOT RUN.

A1/A2 подготовлены отдельно в codex/kafka-worker-admission-20261018,
e298057d94804417d38fb105d960721bae6fc1cc; здесь не дублируются. Новые реальные
integration checks ещё NOT RUN. Общая доставка остаётся исходной сессии
«Проверить защиту Kafka-консюмера». Никаких production mutations, consumer
startup, offset/replay, sends, merge или deploy эта подготовка не выполняет.

### A5 inactive authenticated DB admission prepared — 2026-10-19

Draft PR894 extends the bounded operator preparation with a private SQL schema
outside production migrations: trusted named-login mapping, immutable Fund
plan/hash, independent approval, one-time consume, controller-bound generation,
revoke and deferred transaction-end lease check. There is no HTTP/runtime
executor, business-table grant, read-pointer switch or Kafka operation.

Actual isolated PG16 run39164468500 on ab0aff696 passed13/13 admissions/races
and28/28 receipt units. Later role/expiry/deferred-fence hardening needs its
own exact-source receipt; see the append-only operator journal for updates.
A passing control-schema fixture does not close K5 catch-up/promotion/rollback,
K7 full-domain recovery, actual delivered monitoring or K8 activation.

The existing scanner flags historical ordinary README prose as generic-api-key;
no scanner policy/check/history was altered to bypass it. PR remains draft,
without merge/deploy. Original A1/A2 PR891 and integration scheduling remain
owned by the originating session; this branch neither starts nor reruns them.

### A5 recovery manifest and synthetic pointer composition verified — 2026-10-19

Operator PR894 source5ad987e953d28c36eedb9bc022eb194abb9973ab passed dedicated
run39165969550/job117788865931:64/64 offline gates and24/24 actual isolated PG
cases, cleanup PASS. Added exact-byte recovery manifest/parity checks and
private synthetic pointer promotion/retained rollback/race/expiry composition.
This advances inactive A5 preparation only: no real Fund read-pointer wiring,
worker/consumer startup, actual delivered alerts, restore or27-domain adoption.
K5 real controller integration and K7 runtime/domain proof remain open.
Historical README scan false positive still blocks delivery; existing scanner
policy/history and A1/A2 checks have not been altered. Merge/deploy not performed.

### A5 actual-schema read-only Fund evidence verified — 2026-10-19

Operator branch source465d9b9750cecddf11657145d0cb4d0e7d8233e0 passed own
run39167881109/job117794570853:91 unit gates,24 operator PG and10 reader PG,
cleanup PASS. Reader reuses real foundation/Fund/replay migrations and canonical
reducer, bounded independent inventory, restricted FORCE-RLS/no-write login,
READ ONLY/RepeatableRead, hashes/state/inbox/checkpoint parity and exact money4.
No consumer, actual offsets/replay, live pointer or production change occurred.

A5 actual cutover remains open: Fund GET still reads Fund rather than generic
pointer; shadow worker requires running while SDK promotion sets promoted;
command-side currentBalance and intentional correction/drift policy require
an explicit contract; final snapshot→promotion write barrier and authentic
stop/soak/restore/alert receipts are unproved. Exact source references and next
steps are appended to KAFKA_OPERATOR_READINESS.md. A7 map remains27/27 with
Fund-only implementation and no whole-domain safety claim. PR891 latest draft
headf47224e2b is not certified by older passing runs; its checks are untouched.

### Operator preparation: canary result boundary

Inactive pure Fund canary result validation is prepared (23 focused cases).
This is not a read adapter or activation. See KAFKA_OPERATOR_READINESS.md's
ordered lifecycle table for the seven remaining integration/evidence steps;
A1/A2 ownership and every domain's missing evidence remain unchanged.

### Inactive canary read adapter continuation

A transactional restricted Fund reader now follows the pure canary contract;
no API/runtime wiring is active. Actual-schema hosted proof covers pointer and
source-head boundaries separately from authenticated control authority. Final
lifecycle, real admission/pointer composition, source barrier, financial correction
policy and authentic operational evidence remain open in the readiness map.

### Independent stop read-back and lifecycle preparation

A bounded inactive read-back composition now follows a recovery close-receipt
reference to independently pinned observer data, including lease/process and
final checkpoint equality. No actual stop producer or operational evidence
exists in this preparation. The readiness map specifies the compatible terminal
canary lifecycle; continuous promoted processing still needs its own writer/
checkpoint design. Final barrier, authenticated pointer executor, real observers,
challenge consumption, correction authority, restore/soak/alerts remain open.

### Durable observer challenge preparation

Inactive stop-challenge storage now binds authenticated observer claims to one
stop request/lease/process and supports exact one-time acceptance with deferred
COMMIT checks. This prepares the persistence gap only. Physical stop observation,
trusted challenge delivery, historical evidence reader, final source barrier,
real pointer executor and genuine operational receipts remain open. No domain
protection or business integration is activated by this contract.

### Tenant source-barrier primitive

Inactive kernel and disposable guard attachment prepare a transaction-scoped
source lock, with exact installation-profile and lease checks. This does not
close final source verification or promotion: frozen source reads/reducer proof,
authenticated pointer CAS and worker/broker/physical-observer evidence still need
one restricted composition. Shared event tables are fenced per tenant, not
claimed migrated for every domain. No runtime integration is active.


### Current-main reconciliation and isolated final transition preparation

Current upstream421260026 includes original-session A1/A2 PR891; exact2936f4c2
CDC run39170670645 passed both cdc-smoke and full-cdc-fund. Earlier pending
A1/A2 statements are historical. This branch preserves upstream admission tests
unchanged and adds its own shadow/final-transition fixture steps.

New fixture-only composition joins same-snapshot canonical material hash, fresh
source barrier, authenticated admission, actual build/promotion-event/pointer CAS
and deferred finalization. Full worker evidence and exact checkpoint→inbox
positions are required; newer-offset duplicates need an independent position
receipt before collector certification. No domain G evidence set closes.

Next runtime slice is trusted verifier/evidence registration with independent
provenance and bounded query design, followed by physical observer/broker/soak,
application canary/rollback, lifecycle/correction and independent restore/alarm
drills. The 27-domain writer/effect/rebuild map remains the acceptance queue;
topic presence never establishes protection. Hosted results and NOT RUN gates
are recorded in docs/kafka-operator-readiness-session-log.md.
