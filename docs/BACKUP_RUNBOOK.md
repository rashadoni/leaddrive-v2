# Production backup runbook

Этот runbook реализует защищённый backup foundation. Его цель — не просто
получить успешный exit code `pg_dump`, а доказать, что FORCE RLS не скрыл данные,
дамп, секреты и runtime-файлы читаются вне production, а точные зашифрованные
версии и recovery catalog действительно защищены Object Lock.

Это ещё не enterprise 3-2-1/PITR: все object copies пока находятся в одном
B2 bucket/регионе/account failure domain (хранилище — Backblaze B2,
см. [B2_OFFSITE_BACKUP.md](B2_OFFSITE_BACKUP.md)), PostgreSQL WAL archive не
commissioned, а полный суперпользовательский restore ролей/owners/ACL ещё не
прошёл независимый drill. `backup-readiness` поэтому может показать
`machine_ready=yes`, но всегда сообщает `enterprise_ga_ready=no` до закрытия
этих отдельных P1 gates. Kafka не заменяет ни один из них.

**Важно о границе текущего контура:** `recovery-catalog/v3` — это
COMPLIANCE-locked каталог доказательств для уже подготовленного production host,
а не самодостаточный image для подъёма чистого replacement host. Он намеренно не
содержит private keys или secrets, а также пока не содержит полный локальный
custody/marker chain и не разрешает повторно использовать committed log genesis
без его живого cursor/discontinuity ceremony. Не запускать
`deployment_mode=recovery-bootstrap` на чистом host с импортированным committed
anchor: это должно остановиться fail-closed. Полный host-loss protocol описан
ниже как enterprise NO-GO, а не как обещанная возможность.

**До прохождения этой ceremony host работает в plain-режиме recovery-гейта.**
`scripts/server-deploy.sh` читает `BACKUP_ENCRYPTION` из
`/etc/leaddrive/backup.env`: `age` — полный ceremony-гейт ниже; любое другое
значение — plain-режим, где Fund cutover получает обычный `pg_dump -Fc`,
восстановленный в одноразовую canary-базу и сверенный по числу строк
`funds`, `fund_transactions` и применённых миграций. Проверяемая точка
восстановления — root-only дамп рядом со standalone-бэкапом, он обязателен;
копия в `/var/backups/leaddrive` кладётся дополнительно и best-effort: если её
записать не удалось, деплой пишет warning и продолжает на локальной точке.
Офсайт здесь обеспечивает суточный backup-таймер, а не cutover. Plain слабее и честно
пишет об этом в лог деплоя, но это не обход: режим выбирается из состояния
host, а не из артефакта или входа workflow, и стадия 2 этой ceremony
переключает его сама. Причина разделения — 2026-09-05…07, когда
некоммиссионированный host спрашивали о commissioned evidence и 102 смерженных
коммита стояли недоставленными за гейтом, который ничего не защищал. Подробнее —
[DEPLOYMENT.md](DEPLOYMENT.md), раздел «Recovery-point gate».

Этот runbook предназначен для потери или повреждения источника данных. Он не
используется как штатный способ исправить ошибочный расчёт одного consumer или
проекции: откат общей multi-tenant БД удалит корректные записи других модулей и
tenant-ов после точки backup. Для логической ошибки используйте versioned shadow
rebuild из неизменяемых событий по
[`event-platform/PROJECTION_RECOVERY_RUNBOOK.md`](event-platform/PROJECTION_RECOVERY_RUNBOOK.md).

## Границы безопасности

- Приложение продолжает работать под `NOSUPERUSER NOBYPASSRLS` ролью.
- Только отдельная `leaddrive_backup` роль получает `BYPASSRLS`; у неё нет
  членства в других ролях и есть только `CONNECT`, `USAGE` схемы и `SELECT`.
- Backup runner получает только публичный age recipient. Ключ расшифровки не
  хранится на production-сервере, в CI, репозитории или object-storage account.
- S3 writer — bucket-restricted application key B2 без `deleteFiles` и
  `bypassGovernance` (точный список прав — в
  [B2_OFFSITE_BACKUP.md](B2_OFFSITE_BACKUP.md)). Отдельный read-only restore key
  хранится вне production и используется только на drill. Master application
  key B2 остаётся offline admin и на production не попадает.
- Незашифрованный dump существует только на production tmpfs с `umask 077` и
  удаляется trap-обработчиком при любом исходе. Offline decrypt выполняется на
  отдельном encrypted/ephemeral mount; входы и helper programs сначала
  копируются туда без reflink и после этого используются только staged copies.
- Scratch restore выполняется отдельной `NOSUPERUSER CREATEDB` ролью на другом
  host/port. Production-база никогда не является целью restore.

## Что проверяет каждый запуск

1. Фактическая DB-роль совпадает с `BACKUP_EXPECTED_DB_ROLE`, имеет
   `BYPASSRLS`, но не `SUPERUSER`, и не наследует другие роли.
2. Source canary видит ненулевые `organizations` и `users`, а также считает и
   fingerprint-ит IDs вместе с tenant assignment в `organizations`, `users`,
   `contacts`, `deals` и в tenant anchor, гарантированно содержащем пользователя.
3. `pg_dump` завершился, размер выше порога, а `pg_restore --list` содержит data
   entries и владельцев всех четырёх обязательных таблиц.
4. Dump полностью восстановлен в одноразовую scratch-БД; source и restored
   canary совпадают байт-в-байт. Несовпадение блокирует upload.
5. В пакет входят custom dump с owner/ACL metadata, canary, dump list,
   `authority.tsv` (roles, memberships, owners, ACL, RLS/FORCE RLS, policies,
   default ACL и settings), SHA-256 и globals без password hashes. Authority
   снимается из той же MVCC snapshot; повторный catalog после `pg_dumpall`
   обязан совпасть, иначе run отвергается. Весь tar шифруется `age` до выхода с
   runner.
6. Bucket заранее имеет default `COMPLIANCE` retention не меньше 14 дней.
   После upload проверяются размер, SHA-256 metadata, version ID, mode и срок.
   Первый успешный запуск месяца получает monthly tier, первый ещё не покрытый
   запуск ISO-недели — weekly; локальные markers не обновляются до полного
   успеха. Поэтому пропуск первого календарного дня не теряет monthly copy.
7. Отдельные encrypted jobs создают exact-version snapshots трёх recovery-set
   secret files и двух runtime media roots (`uploads`, `help-videos`). Runtime
   tree с symlink, hardlink, special file или nested mount отвергается.
8. Только после всех проверок отправляется success ping внешнему dead-man
   monitor. Любая ошибка отправляет `/fail` и возвращает non-zero.

## Однократная подготовка — выполнять строго по порядку

### 1. Подготовить Object Storage

Хранилище — Backblaze B2, bucket `leaddrive-prod-backups` в `eu-central-003`
(создан 2026-10-19, private, SSE-B2). Что уже сделано и что осталось — в
[B2_OFFSITE_BACKUP.md](B2_OFFSITE_BACKUP.md); пункты ниже — требования, которые
этот bucket должен выполнить до первого upload.

1. Bucket `leaddrive-prod-backups` должен быть private и иметь Object Lock
   (в B2 включается и на существующем bucket, но выключить его нельзя).
2. До первого production upload задать default retention `COMPLIANCE`, 14 дней.
   Это закрывает короткое окно между multipart upload и индивидуальным
   продлением weekly/monthly объекта.
3. Master application key B2 считать offline admin и не размещать на
   production.
4. Writer и restore key создаёт `scripts/backup/b2-create-backup-keys.py`
   (веб-консоль B2 даёт только пресеты rw/ro/wo, нужного набора среди них нет).
   Writer: upload/multipart, `Head/GetObject`, чтение lock config и get/put
   retention; без delete и bypass-governance. После создания —
   `scripts/backup/b2-verify-backup-keys.sh`: реальные allow и deny операции.
5. Restore key — read-only, хранится офлайн. Не размещать его на production
   runner.
6. Настроить lifecycle cleanup после окончания retention для daily/weekly/monthly
   prefixes (B2: `daysFromUploadingToHiding` = retention + 1,
   `daysFromHidingToDeleting` = 1). Сначала проверить на тестовом prefix: Object
   Lock должен блокировать раннее удаление.

Go/No-Go: `get-object-lock-configuration` показывает `Enabled`,
`COMPLIANCE`, `Days >= 14`; writer не может удалить тестовый locked object.

#### Read-only диагностика отказа Object Lock

Существующий `Inspect production safely` / `backup-readiness` проверяет
конфигурацию одним read-only CLI-вызовом `GetObjectLockConfiguration` без
авторетраев. Параметры, bucket, ключи, request IDs и исходный stderr не выводятся.
Сохраняется максимум 16 KiB в памяти приватного pipe; лишние данные дренируются,
но не сохраняются. CLI ограничен 45 секундами с принудительной остановкой через
ещё 5 секунд; классификатор отдельно ограничен 55+5 секундами. Это не новая
операция commissioning и не разрешение менять bucket policy, retention или key.

При отказе отчёт даёт только фиксированную `diagnostic`-категорию:

- `access_denied` — сервис сообщил отказ доступа; наличие/отсутствие Object
  Lock этим **не установлено**. Не менять credentials по одной такой строке.
- `credentials_rejected`, `bucket_not_found`, `lock_configuration_missing`,
  `operation_unsupported` — распознана конкретная ошибка сервиса для именно
  этой операции.
- `auth_request_rejected`, `request_time_rejected`, `routing_rejected`,
  `request_rejected`, `bucket_state_rejected`, `provider_failure`, `throttled`
  — распознан документированный публичный S3 code в точном CLI-envelope
  `GetObjectLockConfiguration`. Это описание ответа, не подтверждение
  фактического HTTP status или корневой причины. Нельзя автоматически менять
  region, часы, ключи или policy по одной такой категории.
- `service_code_unrecognized` — формат и операция распознаны, code неизвестен;
  `service_error_format_unrecognized` — CLI254, но ожидаемый формат не распознан.
  Сам code, его hash и тело никогда не выводятся. Прежний общий `service_error`
  в историческом receipt не устанавливает ни один из этих новых диагнозов.
- `tls_error`, `endpoint_unreachable` — распознан локальный формат ошибки
  клиента; это не точная диагностика причины DNS/маршрута/сертификата.
- `request_timeout`, `process_killed`, `cli_usage_error`,
  `cli_configuration_error`, `unknown_failure` — выполненной проверки нет.
- `invalid_response`, `oversized_response`, `unavailable` — надёжного
  диагностического результата нет; readiness остаётся fail-closed.

Только нулевой CLI exit и одна корректная строка `Enabled / COMPLIANCE / Days
>= 14` дают положительный bucket-default check. Вывод, похожий на успех при
ненулевом exit, не принимается. Это **не** proof exact-version retention,
delete-deny, независимого restore, включённых timers или enterprise GA.
Минимум 14 дней относится к backup bucket, не заменяет требование immutable
event archive на 400 дней. Конкретную исправляющую операцию готовят отдельно
после проверки действительного endpoint/provider и соответствующих полномочий.

Публичные коды и семантика CLI сверены с
[S3 error responses](https://docs.aws.amazon.com/AmazonS3/latest/developerguide/ErrorResponses.html)
и [AWS CLI return codes](https://docs.aws.amazon.com/cli/latest/topic/return-codes.html).
Неизвестный ответ не расширяет allowlist автоматически и не запускает retry.

#### Свежесть результата службы — не доказательство восстановления

`last successful run is fresh` требует `LoadState=loaded`, `Result=success`,
`ExecMainStatus=0` и непустой, успешно разобранный положительный timestamp.
Пустая/пробельная дата не передаётся в GNU date: его значение по умолчанию
может означать сегодняшнюю полночь, а не реальный запуск. Частичный stdout
неуспешного `systemctl`/`date` отбрасывается. Существующие пределы давности и
допуск будущего времени 300 секунд не расширяются; `MemorySwapMax=0`
проверяется независимо. Отсутствующий unit не является успешным запуском;
disabled timer не равен отсутствующему service. Даже положительная метадата
службы не заменяет exact-version backup, decrypt/restore или custody receipt.

### 2. Создать ключ шифрования

1. На офлайн/административной машине сгенерировать age identity.
2. Сохранить private identity минимум в двух независимых защищённых местах.
3. В `/etc/leaddrive/backup.env` поместить только публичный recipient.
4. Выполнить тест encrypt/decrypt и записать владельца ключа и recovery path.

Go/No-Go: второй уполномоченный оператор может расшифровать тестовый архив без
доступа к production-серверу.

### 3. Создать database roles

Подключиться как database owner/managed admin и выполнить:

```bash
psql "$DIRECT_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -v backup_role=leaddrive_backup \
  -f scripts/backup/bootstrap-backup-role.sql
```

Роль создаётся `NOLOGIN`. В интерактивном `psql` выполнить `\password
leaddrive_backup`, затем:

```sql
ALTER ROLE leaddrive_backup LOGIN;
```

Пароль сохранить только в `/etc/leaddrive/backup.pgpass` с mode `0600`.
Создать на отдельном scratch PostgreSQL роль `leaddrive_restore_verifier` как
`LOGIN NOSUPERUSER CREATEDB NOCREATEROLE NOINHERIT` и отдельный pgpass.

Go/No-Go: backup role показывает `rolsuper=f`, `rolbypassrls=t`, `rolcanlogin=t`,
membership count `0`; app-role остаётся `rolbypassrls=f`.

### 4. Подготовить runner

1. Создать системного пользователя `leaddrive-backup` без shell и домашнего
   каталога; не запускать job под root или app user.
2. Установить из проверяемых источников PostgreSQL 16 client, AWS CLI v2, age,
   `curl`, `flock` и стандартные GNU tools. Зафиксировать версии.
   AWS CLI binary проверять подписью AWS CLI Team и pinned fingerprint из
   официальной документации, а container images запускать по digest, не по
   плавающему tag.
3. Скопировать `ops/backup/backup.env.example` в
   `/etc/leaddrive/backup.env`, заполнить значения и выставить
   `root:leaddrive-backup 0640`. Оба pgpass-файла должны принадлежать
   `leaddrive-backup:leaddrive-backup` и иметь приватный mode `0600`
   (проверки допускают также `0400`). Libpq игнорирует pgpass с доступом
   группы/остальных, поэтому `root:leaddrive-backup 0440/0640` не подходит.
   Родительский каталог остаётся под управлением root, без права записи у
   service user. CA-файлы остаются root-owned и доступны сервису для чтения;
   их нельзя проверять по правилам секретного pgpass. Автономный offline
   verifier использует свой отдельный pgpass, принадлежащий вызывающему
   пользователю, с теми же приватными правами.
   Для source TLS `PGHOST` задаёт имя, проверяемое сертификатом, а обязательный
   числовой `PGHOSTADDR` — отдельно проверенный сетевой маршрут к тому же
   endpoint. Не подменять `verify-full` режимом без проверки имени.
4. Создать внешний monitor с окном 26 часов и реальным каналом оповещения.
5. Убедиться, что firewall разрешает runner только private DB/scratch endpoints,
   DNS, B2 S3 endpoint (`s3.eu-central-003.backblazeb2.com`) и monitor endpoint.

Scratch cluster должен совпадать с source не только по major PostgreSQL, но и
по extensions и системной collation. До первого canary:

1. Снять `SELECT extname, extversion FROM pg_extension ORDER BY extname` на
   source и обеспечить те же версии в scratch image. Например, dump с
   `vector 0.6.0` нельзя проверять на обычном `postgres:16` без pgvector.
2. Не переиспользовать data volume между images с разными libc/collation.
   После смены base image пересоздать только пустой scratch volume и убедиться,
   что `datcollversion = pg_database_collation_actual_version(oid)`.
3. Extensions, которые restore создаёт или комментирует, должны уже находиться
   в template scratch-БД и принадлежать `leaddrive_restore_verifier`. Для
   untrusted extension разрешено временно дать verifier `SUPERUSER` только в
   изолированном scratch cluster при выключенном timer, создать extensions от
   его имени и немедленно вернуть `NOSUPERUSER`.
4. После bootstrap снова доказать: verifier — `NOSUPERUSER CREATEDB
   NOCREATEROLE`, source backup role — `NOSUPERUSER BYPASSRLS`, app role —
   `NOSUPERUSER NOBYPASSRLS`.

### 5. Репетиция без Object Storage

```bash
sudo -u leaddrive-backup \
  BACKUP_ENV_FILE=/etc/leaddrive/backup.env \
  /usr/local/lib/leaddrive-v2/ops/current/backup/postgres-backup.sh --local-canary
```

Этот режим делает dump и полный scratch restore, но не шифрует и не загружает
архив. Проверить, что scratch-БД удалена и plaintext dump не остался.

### 6. Первый upload и независимое восстановление

На текущем production `13.140.132.245` этот этап выполняется только четырьмя
защищёнными workflow stages ниже. Ручной `systemctl start/enable` не создаёт
принимаемого evidence и запрещён: database backup без соответствующего secrets
snapshot не доказывает, что восстановленные PII и integration tokens читаются.

## Шифрование архива

Production upload поддерживает только `BACKUP_ENCRYPTION=age`. Отсутствующее
значение также безопасно трактуется как `age`; `off`, plaintext и любое другое
значение завершают database, secrets и runtime jobs с non-zero **до upload**.
Обхода для emergency/risk acceptance нет: открытый архив customer data не
является допустимым recovery point.

Снимки БД, recovery-set secrets, runtime media и логов шифруются до записи в
Object Storage. Private identity остаётся вне production/GitHub/B2; на
сервере есть только публичный recipient.

## Commissioning после переноса production

Текущий production — `13.140.132.245`. Доказательства, systemd-state и локальные
markers выведенного из эксплуатации прежнего хоста являются историей инцидента, а не
контролем нового сервера. Незашифрованные старые объекты также нельзя
«дошифровать задним числом»: новый контроль начинается с первого нового
`.tar.age` version, который реально расшифрован вне production.

Production commissioning выполняет только dispatch-only workflow
`Commission production backup`. Он привязан к точному текущему `main`, использует
закреплённый SSH host key, сериализован с deploy и принимает только PII-free
подписанные evidence bundles. Private age identity, private Ed25519 signing key,
restore credential и расшифрованный `app.env` запрещено передавать в GitHub,
production, тикет или этот документ.

### 1. Защитить GitHub environment

До первой изменяющей стадии владелец репозитория обязан:

1. ограничить environment `production` веткой `main`;
2. сверить действующий release contract в `docs/DEPLOYMENT.md`: обязательный
   GitHub required reviewer снят; независимый offline signer и проверка его
   evidence остаются обязательными и не заменяются workflow actor;
3. добавить environment secret `BACKUP_OFFLINE_ALLOWED_SIGNERS` ровно в формате
   OpenSSH allowed-signers:

   ```text
   independent.operator ssh-ed25519 AAAA...
   ```

Публичную строку получают `ssh-keygen -y -f <offline-signing-key>`. Private key
не загружается. Principal до 80 символов — это значение workflow-поля
`offline_operator`; оно должно отличаться от `github.actor`.

### 2. Доказать две offline-копии age identity

На независимой машине checkout должен находиться на exact `MAIN_SHA`, а `age` и
`age-keygen` — быть ровно версии `1.3.2`. Две identity-копии должны находиться
на разных filesystem devices вне root filesystem **и на физически разделённых
offline-носителях/failure domains**. `st_dev` доказывает только разные
filesystems, поэтому оператор отдельно подписывает точную physical-media
attestation. Scratch — третий отдельный зашифрованный или ephemeral mount,
принадлежащий оператору и закрытый для group/other. Identity не печатается и
не попадает в evidence.

```bash
export OFFLINE_SCRATCH_ROOT=/mnt/ephemeral-recovery

scripts/backup/verify-age-key-custody.sh \
  /media/key-copy-1/leaddrive.agekey \
  /media/key-copy-2/leaddrive.agekey \
  "$RECIPIENT_SHA256" \
  "$EVIDENCE_REF" \
  independent.operator \
  /media/operator-signing/evidence_ed25519 \
  ./key-custody.env \
  "$MAIN_SHA" \
  TWO_PHYSICALLY_SEPARATE_OFFLINE_MEDIA_CONFIRMED
```

Go/No-Go: обе filesystem-distinct копии вывели один ожидаемый recipient,
независимо расшифровали новый случайный canary и не изменили content hash во
время проверки; оператор отвечает за истинность signed physical separation.
Созданные `key-custody.env`, `.sig`, `.bundle.tar` и `.bundle.b64` не содержат
ключи, пути к ним или plaintext canary.

### 3. Commissioning: шесть стадий и два deployment mode

Каждый dispatch привязан к точному `MAIN_SHA` на момент запуска; full candidate
и его certification обязаны использовать один и тот же SHA. Root anchor
сохраняет SHA bootstrap как исторический факт, поэтому обычное изменение `main`
само по себе не даёт права создать второй bootstrap: после committed anchor это
запрещено. Перед full candidate и его certification runner сравнивает current
`recovery program set` с digest в anchor. App-only изменение `main` допустимо
только при byte-identical recovery program set — тогда full candidate создают и
certify заново на новом SHA. Изменение recovery-byte после committed genesis —
**hard stop**: существующая цепочка не продолжается и не «начинается заново».
Нужен отдельный рассмотренный supersession/reanchor protocol; он пока не
реализован. Незаполненные поля workflow должны оставаться пустыми. Ни один шаг
не принимает private age/signing key.

Перед шестью recovery-стадиями выполняется отдельная подготовительная операция
`configure-monitoring-urls` с confirmation
`CONFIGURE_BACKUP_MONITORING_ON_13_140_132_245`. Она получает четыре разные
Healthchecks.io URL только из GitHub environment secrets
`BACKUP_HEALTHCHECK_URL`, `SECRETS_HEALTHCHECK_URL`,
`RUNTIME_FILES_HEALTHCHECK_URL`, `LOG_SHIP_HEALTHCHECK_URL`, атомарно заменяет
только эти четыре значения в root-only `/etc/leaddrive/backup.env` и не
запускает backup, timer, Kafka consumer или replay. Операция отказывается
работать, если любой recovery service активен, любой recovery timer не
`disabled/inactive`, URL отсутствует, повторяется или не является точным
`https://hc-ping.com/<uuid>`.

Отдельная одноразовая подготовка создаёт изолированный restore scratch до
установки backup tools. Workflow `Provision isolated PostgreSQL restore
scratch` запускается только с актуального `main`, operation `apply` и
confirmation
`PROVISION_ISOLATED_POSTGRES_RESTORE_SCRATCH_ON_13_140_132_245`. Он создаёт
отдельный PostgreSQL 16 на `127.0.0.1:55432`, собственные CA/passfile и
ограниченную роль `leaddrive_restore_verifier`, проверяет `verify-full` и
отличающийся от source system identifier, затем оставляет cluster остановленным.
Workflow не устанавливает пакеты, не запускает backup/restore и не меняет
Kafka. При ошибке после snapshot новый cluster удаляется, а три клиентских
файла восстанавливаются байт-в-байт. Обратная операция требует confirmation
`ROLLBACK_ISOLATED_POSTGRES_RESTORE_SCRATCH_ON_13_140_132_245` и отказывается
работать при drift.

Если preflight возвращает `source-role-present` после прерванной старой
попытки, не продолжать `apply`. Одноразовая операция `cleanup-source-role` с
confirmation
`REMOVE_ACCIDENTAL_SCRATCH_VERIFIER_ROLE_FROM_SOURCE_ON_13_140_132_245`
удаляет только зарезервированную роль `leaddrive_restore_verifier`. Перед
удалением она повторно связывает соединение с source system identifier и
портом, требует точный ожидаемый набор ограниченных атрибутов роли и
отсутствие memberships, role settings и любых shared dependencies. Любое
отклонение завершает операцию без изменений; `REASSIGN OWNED` и `DROP OWNED`
не выполняются.

1. `install-backup-tools` — confirmation
   `INSTALL_PINNED_BACKUP_TOOLS_AND_EXTEND_LOG_RETENTION_ON_13_140_132_245`.
   Стадия выключает **все четыре** recovery timer, устанавливает закреплённые
   age `1.3.2` и AWS CLI `2.36.40`, а затем делает единственную разрешённую
   монотонную миграцию `LOG_SHIP_RETENTION_DAYS`: пустое/старое `365` → `400`.
   Любое другое значение ниже 400 — stop, а не неявное исправление.
2. `activate-backup-encryption` — confirmation
   `ENABLE_AGE_BACKUPS_ON_13_140_132_245`. Передать recipient SHA-256,
   `TWO_READABLE_OFFLINE_COPIES_AND_INDEPENDENT_DECRYPT_CONFIRMED`, reference,
   timestamp/principal из подписанного custody evidence и `.bundle.b64` без
   перевода строки. Стадия проверяет подпись, Object Lock и atomically
   устанавливает `BACKUP_ENCRYPTION=age`; timer остаются выключенными.
3. `run-bootstrap-backup` — confirmation
   `CREATE_BOOTSTRAP_BACKUP_ON_13_140_132_245`. Получается кандидат формата 2
   с scope `log-genesis-bootstrap-only`: точные DB/secrets/runtime версии уже
   independently restorable, но log genesis ещё **не** существует. Сохранить
   candidate SHA-256; timer остаются выключенными.
4. На независимом offline host проверить этот bootstrap-кандидат обычным
   (12-argument) `verify-offline-backup.sh`, затем вызвать
   `certify-bootstrap-restore` с confirmation
   `CERTIFY_BOOTSTRAP_RESTORE_ON_13_140_132_245`. Возникает ограниченный
   подписанный сертификат `/etc/leaddrive/backup-evidence/bootstrap-offline-restore-current.env`.
   Он доказывает только исходный restore, не имеет права утверждать log replay.
5. Запустить GitHub Actions `Deploy to Production` с
   `deployment_mode=recovery-bootstrap` (без `recovery_sha` и
   `bootstrap_resume_sha`) с текущего `main`. Этот отдельный SHA-bound режим
   не заменяет приложение, не запускает Prisma/Fund/Kafka/PM2 и не
   принудительно включает обычные DB/secrets/runtime timer. Он возвращает их к
   точному состоянию до bounded ceremony, устанавливает immutable operations
   release, создаёт PENDING → COMMITTED root log-genesis anchor и после точной
   проверки запускает log-ship timer.

   После сбоя сверять **оба** durable record — `activation.journal` и anchor:

   - `activation.journal phase=genesis-pending` и anchor отсутствует, `PENDING`
     или `COMMITTED`: **не** запускать normal или новый initial bootstrap. До
     dispatch извлечь SHA **только read-only** из journal (когда anchor отсутствует,
     поля `BOOTSTRAP_DEPLOY_SHA` ещё нет):

     ```bash
     sudo awk -F= '
       $1 == "phase" { phase = $2 }
       $1 == "release_root" { release_root = $2 }
       END {
         prefix = "/usr/local/lib/leaddrive-v2/ops/releases/"
         if (phase != "genesis-pending" || index(release_root, prefix) != 1) exit 1
         sha = substr(release_root, length(prefix) + 1)
         if (length(sha) != 40 || sha !~ /^[0-9a-f]+$/) exit 1
         print "BOOTSTRAP_DEPLOY_SHA=" sha
       }
     ' /usr/local/lib/leaddrive-v2/ops/activation.journal
     ```

     Команда должна вывести ровно один full SHA; иначе hard stop. Из текущего
     `main` dispatch `deployment_mode=recovery-bootstrap-resume` с
     `bootstrap_resume_sha=<этот SHA>`. Actions заново строит и передаёт ровно
     исторический artifact и release-bound controller этого SHA; сервер требует
     тот же journal, active immutable operations release и совпадающий SHA anchor.
     Сначала operator подтверждает отдельный job `Approve historical
     bootstrap-resume build` в protected `production` environment. Этот
     approval создаёт Actions deployment record, но не даёт server mutation;
     он только разрешает checkout/test/build исторического SHA. Перед SCP и
     host ceremony затем требуется обычный отдельный approval job `Deploy to
     production & post-deploy smoke`.
   - Нет journal, а anchor `PENDING`: hard stop и reviewed incident protocol.
     Bare PENDING anchor не является основанием создать новый baseline или
     выполнить resume/normal deploy.
   - Нет journal, а anchor `COMMITTED`: bootstrap уже завершён. Не выполнять
     resume; продолжить только с full candidate → offline certification →
     normal reviewed deploy.

   Если хотя бы один факт не подтверждён, остановиться. Ручное создание anchor,
   подмена artifact или `systemctl enable` запрещены.
6. `run-verified-backup` — confirmation
   `CREATE_FULL_RECOVERY_BACKUP_ON_13_140_132_245`. Кандидат формата 3 с scope
   `full-recovery` захватывает exact first log object, root anchor и hash
   ограниченного bootstrap-сертификата. После offline full verification
   вызвать `certify-offline-restore` с confirmation
   `CERTIFY_FULL_RECOVERY_ON_13_140_132_245`. Появляется marker формата 4 и
   catalog v3 (восемь файлов: full evidence, bootstrap evidence/marker,
   root anchor и independent signer allowlist). Это catalog валидации, **не**
   clean-host hydration capsule. Все timer по-прежнему
   disabled. Только затем normal reviewed deploy этого SHA повторно проверяет
   всю цепочку и атомарно активирует recovery timers.

Первую стадию можно запустить так (для остальных безопаснее GitHub UI, чтобы
проверить все evidence fields):

```bash
gh workflow run commission-production-backup.yml --ref main \
  -f operation=configure-monitoring-urls \
  -f expected_main_sha="$MAIN_SHA" \
  -f confirmation=CONFIGURE_BACKUP_MONITORING_ON_13_140_132_245

gh workflow run provision-postgres-restore-scratch.yml --ref main \
  -f operation=apply \
  -f expected_main_sha="$MAIN_SHA" \
  -f confirmation=PROVISION_ISOLATED_POSTGRES_RESTORE_SCRATCH_ON_13_140_132_245

gh workflow run commission-production-backup.yml --ref main \
  -f operation=install-backup-tools \
  -f expected_main_sha="$MAIN_SHA" \
  -f confirmation=INSTALL_PINNED_BACKUP_TOOLS_AND_EXTEND_LOG_RETENTION_ON_13_140_132_245
```

До mutation workflow fsync-журналирует исходные `load/enabled/active` states
всех четырёх timer. При non-zero, signal или crash он восстанавливает точное
прежнее состояние. Успешные commissioning stages сознательно commit-ят timer
как disabled/inactive; только server deployment после полного сертификата
может их включить. Не исправлять сбой ручным `systemctl enable`: устранить
причину и повторить bounded stage с тем же approved SHA.

### 4. Независимо восстановить exact versions: bootstrap и полный chain

Restore operator использует отдельный read-only Object Storage credential и
скачивает **version ID из candidate**, никогда `latest`:

```bash
aws s3api get-object \
  --endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION" \
  --bucket "$BACKUP_S3_BUCKET" --key "$DATABASE_OBJECT_KEY" \
  --version-id="$DATABASE_OBJECT_VERSION_ID" ./database.tar.age

aws s3api get-object \
  --endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION" \
  --bucket "$BACKUP_S3_BUCKET" --key "$SECRETS_OBJECT_KEY" \
  --version-id="$SECRETS_OBJECT_VERSION_ID" ./secrets.tar.age

aws s3api get-object \
  --endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION" \
  --bucket "$BACKUP_S3_BUCKET" --key "$RUNTIME_FILES_OBJECT_KEY" \
  --version-id="$RUNTIME_FILES_OBJECT_VERSION_ID" ./runtime-files.tar.age
```

Все три ciphertext SHA-256 сверяются **до** decrypt. Для bootstrap candidate
формата 2 использовать 12-argument invocation ниже. Он допустим только до
`certify-bootstrap-restore`; нельзя передать в него candidate v3. Сохранить
PII-free exact `candidate.env` и проверить его опубликованный SHA-256; не
перепечатывать поля вручную. Scratch files располагаются на
отдельном encrypted/ephemeral mount. PostgreSQL — одноразовый изолированный
loopback cluster с `NOSUPERUSER CREATEDB` verifier и disposable либо encrypted
storage; production/source endpoint запрещён без исключений.

```bash
export OFFLINE_SCRATCH_ROOT=/mnt/ephemeral-recovery
export OFFLINE_DATABASE_STORAGE_ATTESTATION=DISPOSABLE_OR_ENCRYPTED_SCRATCH_CLUSTER_CONFIRMED
export VERIFY_PGHOST=127.0.0.1
export VERIFY_PGPORT=55432
export VERIFY_PGUSER=leaddrive_restore_verifier
export VERIFY_PGPASSFILE=/secure/restore.pgpass
export VERIFY_PGMAINTENANCE_DB=postgres
export VERIFY_PGSSLMODE=disable

scripts/backup/verify-offline-backup.sh \
  ./database.tar.age \
  ./secrets.tar.age \
  ./runtime-files.tar.age \
  ./candidate.env \
  /media/key-copy-2/leaddrive.agekey \
  "$CANDIDATE_SHA256" \
  "$RECIPIENT_SHA256" \
  "$EVIDENCE_REF" \
  independent.operator \
  /media/operator-signing/evidence_ed25519 \
  ./archive-restore.env \
  "$MAIN_SHA"
```

Verifier создаёт private non-reflink staging copies входов и reviewed helpers,
а затем использует только их. Он расшифровывает три архива, проверяет DB
`SHA256SUMS`, authority catalog, secrets manifest, exact `app.env` и runtime
inventory, делает data restore/canary, сравнивает RLS/FORCE RLS catalog и читает
хотя бы одну реальную AES-GCM PII-колонку с
`TENANT_PII_MASTER_KEY` из восстановленного secrets snapshot. Он также
доказывает восстановление `NEXTAUTH_SECRET`; если в базе есть поддерживаемый
зашифрованный integration token, тот обязан расшифроваться. Если такого token
нет, evidence честно записывает `not_applicable_no_persisted_ciphertext`, а не
притворяется успешным token drill. `DATABASE_AUTHORITY_CATALOG_STATUS` означает
только capture/binding, а `FULL_AUTHORITY_RESTORE_STATUS=not_tested` честно
фиксирует, что globals, roles, owners и ACL ещё не восстановлены полным cluster
drill. Значения, tenant/row IDs и secrets не попадают в output.

Go/No-Go: `.bundle.b64` подписан зарегистрированным независимым оператором;
timestamp не предшествует candidate; database/secrets/runtime ciphertext hashes,
candidate, recipient, exact main и все helper hashes совпадают.

Для **full-recovery candidate формата 3** дополнительно скачать точную версию
первого immutable log object и перенести PII-free root anchor по защищённому
каналу из `/etc/leaddrive/backup-evidence/log-evidence-genesis.env`. Перед
проверкой сверить его SHA-256 и bytes с `LOG_GENESIS_ANCHOR_*` candidate; нельзя
подменять его «текущим» anchor или создавать заново.

```bash
aws s3api get-object \
  --endpoint-url "$BACKUP_S3_ENDPOINT" --region "$BACKUP_S3_REGION" \
  --bucket "$OBJECT_BUCKET" --key "$LOG_GENESIS_OBJECT_KEY" \
  --version-id="$LOG_GENESIS_OBJECT_VERSION_ID" ./log-genesis.tar.gz.age

scripts/backup/verify-offline-backup.sh \
  ./database.tar.age \
  ./secrets.tar.age \
  ./runtime-files.tar.age \
  ./log-genesis.tar.gz.age \
  ./log-evidence-genesis.env \
  ./candidate-v3.env \
  /media/key-copy-2/leaddrive.agekey \
  "$CANDIDATE_SHA256" \
  "$RECIPIENT_SHA256" \
  "$EVIDENCE_REF" \
  independent.operator \
  /media/operator-signing/evidence_ed25519 \
  ./archive-restore.env \
  "$MAIN_SHA"
```

Full verifier требует `RETENTION_DAYS >= 400`, расшифровывает и проверяет
архив log genesis, `RANGES.tsv`, cursor, manifest, checksum и binding к root
anchor. Его evidence связывает full candidate с ограниченным bootstrap
certificate; отсутствие или расхождение любого из них — hard stop.

### 5. Recovery catalog, trust anchor и честная host-loss граница

После `certify-offline-restore` catalog **v3** лежит в content-addressed
`recovery-catalog/v3/archive-restore/...` Object Lock object. Он содержит ровно
восемь файлов: full `candidate.env`, `evidence.env`, signature, root log anchor,
bootstrap marker, bootstrap evidence, bootstrap signature и
`offline-allowed-signers`. Записать в ISMS/incident vault его bucket, key,
version ID, SHA-256 и фактический `retain-until`; exact DB/secrets/runtime/log
versions должны жить не меньше этого срока. Скопированный внутрь catalog
allowlist **не может заверить сам себя** после полной потери хоста/account.
SHA-256 allowlist и публичный Ed25519
ключ должны быть отдельно pinned как минимум в GitHub `production` environment
и в независимом offline/ISMS trust store. Ни private keys, ни secrets туда не
копируются.

Catalog v3 сам по себе **не** является восстановлением replacement host. В нём
нет bootstrap candidate v2, `key-custody.env` и его signed pair, а также full
`offline-restore-current.env`: эти локальные файлы нужны `server-deploy.sh`
для bootstrap/normal validation. Кроме того, committed root anchor не является
многоразовым токеном: на новом host отсутствует живой
`/var/lib/leaddrive-log-ship/log-ship-offsets`, и `ship-logs.sh` сознательно
отказывается придумывать или обнулять cursor. Это защищает от тихой потери
аудит-логов.

До enterprise GA нужен отдельный immutable PII-free
`recovery-hydration/v1` capsule **после** публикации v3 catalog (полный marker
нельзя положить обратно в v3: он содержит coordinates самого catalog). Capsule
должен включать только данные для атомарного восстановления evidence root:

- `key-custody.env`, его evidence и signature;
- bootstrap marker, candidate v2, evidence и signature;
- full marker, candidate v3, evidence и signature;
- committed log-genesis anchor и `offline-allowed-signers`.

Его exact bucket/key/version/SHA-256/size и SHA-256 allowed-signers должны
быть pinned **вне** object-storage account — минимум в GitHub `production`
environment и независимом offline/ISMS vault. Hydrator обязан принимать только
внешне pinned regular tar, проверить digest/size до чтения, exact member set,
отсутствие link/device/PAX entries и все detached signatures; извлекать только
whitelisted files в fresh root-only staging без `source`/`eval`, после чего
атомарно публиковать evidence root. В capsule нельзя включать executable code,
private age identity, private signing key или секреты.

Даже после такого hydration capsule host-loss остаётся NO-GO, пока не появится
отдельный two-person signed discontinuity/reseed protocol для log cursor. Он
должен сохранить связь с предыдущим immutable anchor и явно зафиксировать
потерянный/неизвестный логовый интервал; нельзя заменять его новым пустым
cursor или ручным `systemctl enable`.

До enterprise GA создать вторую immutable replica database/secrets/runtime/logs
и recovery catalog в другом provider/account/регионе с отдельными restore
credentials и quarterly exact-version restore drill. Object Lock в одном
bucket защищает от удаления версий, но не от общей потери provider/account;
текущий контур не называть 3-2-1 или cross-region DR.

### 6. Полный PostgreSQL authority/PITR gate

Текущий offline canary восстанавливает данные без owners/privileges, сравнивает
tenant data и RLS/FORCE RLS definitions и привязывает полный `authority.tsv`.
Он намеренно **не** заявляет full authority restore: `globals.sql` не содержит
password hashes, а его применение требует изолированного superuser workflow.

До multi-tenant enterprise GA независимый DBA обязан в новом disposable
cluster:

1. проверить extensions/collation/major version и применить passwordless
   `globals.sql` как cluster admin;
2. восстановить dump **без** `--no-owner/--no-privileges`;
3. заново создать/rotate app, migration, backup и restore credentials из
   независимого корпоративного secret authority, не из production disk;
4. сравнить полный roles/memberships/database/schema/relation/function owner,
   ACL/default ACL/settings/RLS catalog с подписанным `authority.tsv`;
5. выполнить запросы под app-role для двух tenant-ов и доказать allow/deny
   isolation, затем уничтожить scratch cluster;
6. подписать evidence с `FULL_AUTHORITY_RESTORE_STATUS=passed` новой reviewed
   версией verifier. До реализации и прохождения этого шага статус остаётся
   `not_tested` и enterprise gate — NO-GO.

Также требуется PostgreSQL WAL archive/PITR в отдельном failure domain.
Механизм архива описан в разделе «WAL-архив и восстановление на точку»
ниже и доказан репетицией в CI; он снимает RPO, но не отдельный failure
domain и не независимую проверку authority, поэтому гейт остаётся открыт. Drill
должен восстановить произвольную точку между logical dumps, затем согласовать
DB transaction/outbox LSN, immutable event-store IDs, Kafka/archive watermarks и
provider receipts. Пока WAL/PITR не commissioned, допустимый RPO равен интервалу
logical backup; Kafka, особенно пока transport пассивен, не возвращает все
записи после последнего dump.

### 7. Host-loss inventory

| Путь/данные | Текущий статус | Recovery authority |
|---|---|---|
| PostgreSQL data | encrypted logical dump + authority catalog | exact Object Lock version; PITR ещё open |
| `/etc/leaddrive/{app,backup,migration}.env` | encrypted snapshot | exact Object Lock version |
| `/var/lib/leaddrive-v2/uploads` | offsite-копия есть, когда поставлен `leaddrive-uploads-offsite` (см. «Копия файлов клиентов»); сама церемония по-прежнему не commissioned | каждый файл отдельным объектом, зашифрован age на ключ владельца. Восстановление — его ключом, независимо от базы. Не application-consistent generation. **`uploads/call-recordings` в копию не входит** по решению о 90 днях |
| `/var/lib/leaddrive-v2/help-videos` | мастера в объектном хранилище с 2026-11-02 | `scripts/help-videos/assets-sync.sh`, манифест `video/player/masters.sha256` |
| `/etc/leaddrive/{backup.pgpass,restore-verifier.pgpass,managed-postgres-ca.crt,restore-postgres-ca.crt}` | намеренно не архивируются | reissue/rotate из managed DB control plane, PKI и независимого secret authority; пока такой authority не оформлен — enterprise NO-GO |
| `/var/lib/leaddrive-v2/state` | operational backfill/provider sentinels, не архивируются этим job | перед GA либо отдельный encrypted operational-state snapshot, либо reviewed deterministic reconstruction с доказательством безопасного повторного запуска |
| `/var/lib/leaddrive-v2/recovery/event-platform-fund-v1` | временная критичная rollback evidence первого Fund cutover | cutover запрещён без отдельной immutable копии; удалить/retire только после approved burn-in |
| `/var/lib/leaddrive-v2/checkout-archive` | deployment cache, не customer-data authority | реконструировать только из immutable reviewed Git SHA/artifact; не использовать как data backup |
| application logs | отдельный encrypted versioned shipper | forensic copy; clean-host continuation запрещена без signed discontinuity/reseed protocol |

Runtime snapshot читает живое mutable tree. Сравнение content inventory до/после
отсекает замеченные изменения, но не создаёт атомарную generation БД+файлы и не
доказывает удаления/tombstones. Для enterprise media DR нужен versioned object
store с immutable object IDs + tombstone/reconciliation ledger либо write fence
и filesystem/database-coordinated snapshot.

### 8. Финальная проверка и Fund cutover

После `certify-offline-restore` **не** использовать обычный `backup-readiness`
как pre-deploy GO gate: он намеренно считает все disabled timer неисправным
состоянием. Первый normal reviewed deploy — это activation ceremony: он допускает
только согласованное состояние «все четыре timer disabled», повторно проверяет с
диска preserved evidence, Ed25519 signatures, candidate и toolchain, а затем
атомарно активирует schedules.

Сразу после успешного normal deploy dispatch `Inspect production safely` →
`backup-readiness`, чтобы зафиксировать activation status. Четыре timer уже
должны быть `loaded/enabled/active`, но на первом запуске
`machine_ready=no` **ожидаем**, пока новые systemd service units не завершат
свои обычные runs: database/runtime — не старше 26 часов, secrets — не старше
8 дней. Это activation-pending, а не разрешение игнорировать настоящий failure.
После этих успешных runs повторный `backup-readiness` обязан дать
`machine_ready=yes issues=0`; только тогда deployment можно объявить
recovery-operational.

Если artifact содержит Fund cutover, его safety gate остаётся внутри normal
deploy и проверяет полный независимый certificate **до** cutover. Не выдавать
post-deploy scheduler freshness за его предварительное условие. Поле
`enterprise_ga_ready=no` ожидаемо, пока открыты перечисленные выше
authority/PITR/second-failure-domain/runtime gates; его нельзя интерпретировать
как разрешение enterprise launch.

## WAL-архив и восстановление на точку (PITR)

Логический дамп раз в сутки означает ровно одно: авария теряет всё, что
записано после прошлой ночи. Для телефонной линии это заказы целого дня.
WAL-архив убирает эту дыру — восстановиться можно на любую секунду внутри
окна хранения.

**Что сделано.** pgBackRest пишет WAL непрерывно. Репозиторий зашифрован
`aes-256-cbc`, `archive-push` асинхронный, так что медленная выгрузка не
задерживает коммиты.

**Бэкапы снимает таймер, а не человек.** `leaddrive-wal-backup.timer` раз в
сутки в 01:10 UTC запускает `wal-archive-backup.sh`; тот смотрит в репозиторий
и сам решает: полный бэкап, если полного нет, он нечитаем или старше
`WAL_FULL_INTERVAL_DAYS` (7 суток), иначе разностный. Решение по возрасту, а не
по дню недели, поэтому ночь, которую сервер пролежал, полный бэкап задерживает,
но не пропускает (`Persistent=true` добивает пропущенный запуск при загрузке).

Важно, чего планировщик НЕ делает: он никому не докладывает. Об успехе и
провале судит сторож, читая состояние репозитория, — и у него на это два
независимых срока. «Свежий бэкап старше 48 часов» ловит остановку целиком, а
«полный старше двух интервалов» — случай, когда разностные идут, а полные
падают: тогда свежесть сохраняется, а цепочка воспроизведения растёт молча.
Задача, которая отчитывалась бы о своём успехе сама, была бы ровно той
проверкой, что зеленеет на собственном сбое.

**Чего это НЕ закрывает.** Гейт 6 остаётся открытым: репозиторий лежит у того
же провайдера, что и дампы (отдельный bucket — это не отдельный failure
domain), и независимая проверка authority/ownership силами DBA не выполнялась.
Закрыт только RPO.

**Отдельный bucket обязателен, и без Object Lock.** pgBackRest сам удаляет
устаревшие бэкапы и WAL. В bucket дампов, где ключ лишён права удаления и
стоит compliance-retention, `expire` молча не сработает и репозиторий будет
расти, пока не кончится диск или терпение. Неизменяемая цепочка дампов при
этом не трогается: она остаётся защитой от шифровальщика, а WAL-репозиторий —
это низкий RPO, другая задача.

**`wal_level` не трогать.** На проде он `logical` — его держит CDC-слот
Kafka. Архиву достаточно `replica`, а `logical` его уже включает, поэтому
установщик уровень не пишет, а только проверяет; прописать туда `replica`
значило бы выключить логическое декодирование ровно тем рестартом, который
нужен архиву.

**Размер, измеренный на проде 2026-11-01, после включения.** База 585 МБ, и
первый полный бэкап лёг в репозиторий как **76,2 МБ** — сжатие и шифрование
дают 7,7x, поэтому прежняя оценка «несколько сотен мегабайт на базовые копии»
оказалась втрое пессимистичной: три полных бэкапа — около 230 МБ. WAL пишется
примерно 370 МБ в сутки до сжатия, при трёх полных окно восстановления около
трёх недель. Спул после включения пустой (16 КБ), то есть выгрузка успевает за
записью; `pg_wal` на диске 145 МБ. На диске прода 164 ГБ свободно, предел
очереди в 16 ГиБ его не угрожает.

**Размен, который нужно знать.** `WAL_ARCHIVE_QUEUE_MAX` — предел очереди в
спуле. Когда он превышен, pgBackRest ВЫБРАСЫВАЕТ сегменты и отвечает успехом:
база продолжает работать, а непрерывность PITR рвётся до следующего полного
бэкапа. Это сознательный выбор — остановленный Postgres хуже дыры в архиве, —
но он обязан быть громким. Сторож поднимает такую ситуацию как критическую,
и ответ на неё один: починить репозиторий и сразу снять полный бэкап.

**Файлы.**

| Что | Где |
|---|---|
| Настройки | `ops/backup/wal-archive.env.example` → `/etc/leaddrive/wal-archive.env` |
| Установка и проверка настроек | `scripts/backup/wal-archive-install.sh` |
| Сторож (раз в 5 минут, Telegram) | `scripts/backup/wal-archive-check.sh`, `ops/systemd/leaddrive-wal-check.*` |
| Доказательство PITR | `scripts/backup/wal-pitr-drill.sh`, workflow `WAL PITR drill` |
| Инварианты обвязки | `scripts/backup/wal-archive-contract.test.mjs` (в `static-checks`) |

**Репетиция — не формальность.** `wal-pitr-drill.sh` поднимает временный
кластер с теми же настройками, пишет две строки с интервалом в полторы
секунды, уничтожает каталог данных, восстанавливается на момент между ними и
требует, чтобы первая строка вернулась, а вторая — нет. Он гоняется на каждом
изменении этих файлов и раз в неделю по расписанию. Две ошибки он уже нашёл:
pgBackRest сравнивает время цели с точностью до секунды (строка, записанная в
ту же секунду, что и конец бэкапа, по времени не восстанавливается), а при
`log-level-console=warn` команда `info` не печатает вообще ничего — сторож
принял бы пустой ответ за здоровый репозиторий.

### Порядок включения

Порядок важен: шаг 2 обязан пройти ДО мержа, иначе ночной
`snapshot-secrets.sh` не найдёт файл из своего фиксированного набора и упадёт.

1. Завести отдельный bucket под репозиторий, **без Object Lock**, и ключ к
   нему с правом записи и удаления. Ключи дампов не переиспользовать.
2. Положить на прод `/etc/leaddrive/wal-archive.env` (0600 root) по шаблону;
   `WAL_REPO_CIPHER_PASS` — `openssl rand -hex 32`.
3. `apt-get install pgbackrest` на проде (нужен ≥ 2.46).
4. `wal-archive-install.sh` без аргументов — он только расскажет, что
   изменится. Затем `--apply`.
5. Перезапустить PostgreSQL в тихий час: `archive_mode` подхватывается только
   рестартом. `archive_command` и `archive_timeout` — перечитыванием.
6. Первый полный бэкап: `pgbackrest --stanza=leaddrive --type=full backup`,
   затем `pgbackrest --stanza=leaddrive check`.
7. Включить таймеры на проде: `systemctl enable --now
   leaddrive-wal-backup.timer leaddrive-wal-check.timer`. Юниты лежат в релизе
   (`ops/current/systemd/`), но в `/etc/systemd/system` их кладёт не деплой, а
   этот шаг — один раз; дальше ExecStart следует за указателем `current`, и
   каждый деплой обновляет сам скрипт. Затем сторож на dev-боксе:
   `bash scripts/backup/install-wal-watch.sh`.
8. Сверить фактический размер репозитория с оценкой выше и записать сюда
   стоимость хранения за первый месяц.

**Выполнено на проде 2026-11-01** (шаги 1–6): рестарт 19:20 UTC, 12 секунд
простоя базы; `wal_level` остался `logical`, CDC-слот Kafka переподключился
сам. Первый полный бэкап — 588,3 МБ базы, 6463 файла, 46 секунд, 76,2 МБ в
репозитории. `pgbackrest check` протолкнул и прочитал сегмент обратно,
`pg_stat_archiver` без единого отказа. Шаг 7 — после деплоя, который принесёт
скрипты в `ops/current`.

### Тревоги идут с dev-бокса (решение владельца 2026-11-01)

Токен бота живёт на dev-боксе, рядом со сторожами Kafka и телефонной линии, и
владелец решил не копировать его на прод: «с dev-бокса по ssh». Поэтому
`WAL_ALERT_COMMAND` на проде остаётся пустым, и работа поделена так:

- **Прод решает, что не так.** `leaddrive-wal-check.timer` раз в пять минут
  гоняет проверку рядом с данными и оставляет вердикт, его формулировку и
  счётчик двух подряд плохих прогонов в
  `/var/lib/leaddrive-wal-archive/check-state.json`. Файл пишется через
  временный и `os.replace`: читатель, поймавший файл на середине записи, увидел
  бы битый JSON и счёл это аварией.
- **Dev-бокс решает, доставлять ли.** `ld-wal-watch` (таймер пользователя раз в
  десять минут, ставит `scripts/backup/install-wal-watch.sh`) только **читает**
  этот файл по ssh и пересылает формулировку прода в Telegram через
  `~/bin/notify-telegram`. Проверку он не запускает повторно — два драйвера
  бились бы за `flock` проверки, а прогон, не взявший лок, выходит с нулём, и
  сторож прочитал бы это как здоровье.
- **Гистерезис живёт в одном месте.** Прод уже выждал два прогона, прежде чем
  поставить `shouldAlert`, поэтому авария архива пересылается сразу. То, что
  видно только с dev-бокса — ssh не ответил, состояние не разбирается, — ждёт
  своих двух прогонов, чтобы одна плохая минута сети молчала.
- **Молчание прода — тоже авария.** Остановившийся таймер оставляет последний
  вердикт на месте, поэтому просроченное «ok» читалось бы как здоровье вечно:
  состояние старше 20 минут (четыре пропущенных прогона) — тревога само по
  себе. Критичное напоминается раз в час, предупреждение говорится один раз,
  «снова в порядке» — только если до этого что-то сказали.

**Коды выхода проверки: 0, 10 и 20 — и это не придирка.** 1 ноября 2026,
через минуту после установки, сторож на проде умирал молча на каждом прогоне, а
systemd докладывал «успешно». Причина: `grep -rhc 'queue exceeded'` не находил
ничего — потому что ронять WAL не приходилось, — выходил с кодом 1, `pipefail`
превращал это в падение конвейера, а `set -e` убивал скрипт до того, как он
что-либо напечатал или записал. Чем здоровее был прод, тем вернее его сторож
был мёртв. А `SuccessExitStatus=0 1 2` в юните не отличал падение с кодом 1 от
предупреждения, поэтому `OnFailure` не срабатывал, и при пустом
`WAL_ALERT_COMMAND` не узнал бы никто.

Отсюда правило: **вердикт — это 10 (предупреждение) и 20 (авария), а 1, 2, 127
и любой другой код означают, что сломался сам сторож**, и юнит обязан считать
это отказом. И второе: каждый конвейер, где команда законно возвращает
ненулевой код, когда ничего не нашла, обязан быть закрыт `|| true` внутри
подстановки — это проверяет тест `no pipeline in the watch can kill it on its
own silence`.

Самое важное из этого случая — не про bash. У сторожа было 37 проверок, и ни
одна его не запускала: все сверяли текст скрипта. Теперь есть тест, который
исполняет сторожа на подставных `psql` и `pgbackrest` и требует строку
`SUMMARY` и записанный файл состояния. Проверка, которая не запускает то, что
проверяет, доказывает только, что мы написали то, что собирались написать.

Чего эта схема не закрывает: пока dev-бокс выключен, за архивом не смотрит
никто. У сторожа линии та же дыра закрыта запасным сторожем на хосте OVH;
здесь запасного нет, и это отдельная задача.

### Артефакт релиза лежит рядом с архивом (2026-11-01)

Замер пути восстановления показал, что данные — не узкое место. Незаменимого
меньше гигабайта: база 585 МБ (76,2 МБ в репозитории), загрузки клиентов 85 МБ,
данные линии 28 МБ, секреты. Это минуты. Узким местом было приложение:
**артефакт сборки хранился только в GitHub Actions, `retention-days: 30`**, и
через 31 день после последнего деплоя восстанавливать было нечего — прод не
собирает себя намеренно (`scripts/deploy.sh` и `server-build-deploy.sh` падают
нарочно). То есть восстановление зависело от доступности GitHub, а блокировка
Actions по биллингу у владельца однажды уже случалась.

Теперь артефакт кладёт сам прод: Step 9b в `server-deploy.sh` вызывает
`release-artifact-upload.sh` **после** всех проверок здоровья, базы и ключа PII
и **до** Step 10, который удаляет тарбол. Поэтому в бэкапе лежит не «то, что
собралось», а то, что реально отвечало на запросы.

- **Тот же bucket и те же ключи, что у WAL** (`WAL_ARTIFACT_PREFIX=artifacts`).
  pgBackRest ограничен своим `repo1-path` и в этот префикс не смотрит; ключ там
  уже имеет запись и удаление; Object Lock на bucket нет, поэтому отсечение
  старых копий дойдёт до освобождения места — но **не сразу: у bucket включено
  версионирование**, и удаление артефакта лишь скрывает версию, а байты
  остаются, пока их не уберёт правило bucket (`NoncurrentVersionExpiration`,
  1 день, и сметает их суточный проход B2). За день с десятком деплоёв
  скрытого накапливается больше, чем живого, и место это считается — см.
  «Квота хранилища общая» ниже. Один bucket и один набор ключей
  открывают и историю базы, и работающее приложение — меньше движущихся частей
  в тот час, когда это нужно. Неизменяемый bucket дампов остаётся тем, чем был:
  копией, которую не достанет шифровальщик. Префикс, равный `repo1-path`,
  скрипт отвергает: отсечение артефактов внутри репозитория удалило бы WAL.
- **Выгрузка перечитывает объект.** Размер и `sha256` из метаданных сверяются с
  локальными; расхождение — отказ, а не «загружено». Иначе усечённый артефакт
  обнаружился бы в худший момент.
- **Указатель `artifacts/current.env`** называет SHA, размер, `sha256` и время
  приёмки. Восстановление читает его, а не угадывает по времени файлов.
- **Провал выгрузки деплой не роняет** — релиз здоров, это копия. Но и молча не
  проходит: сторож проверяет, что в bucket есть артефакт для живого SHA, и
  предупреждает, если его нет дольше `WAL_ARTIFACT_GRACE_SECONDS` (30 мин —
  деплой кладёт копию через минуты после подмены, и тревога в этом окне была бы
  шумом). Судит состояние, а не отчёт самой задачи.

**Достать артефакт:** `release-artifact-restore.sh` без аргументов берёт тот,
что прод принял последним, сверяет с указателем и проверяет `gzip -t`;
`--sha <SHA>` — конкретный, `--list` — что вообще есть. Скрипт только читает:
ни `rm`, ни `mv`, ни записи в bucket, и распаковку оставляет оператору, чтобы
битая загрузка не затёрла живой релиз сама.

Проверено круговым рейсом в `release-artifact-contract.test.mjs`: выгрузка и
восстановление прогоняются на подставном `aws` поверх настоящего каталога, и
тест требует побайтового совпадения. Отдельно проверено, что усечённый объект,
подменённый `sha256` и подгнившая копия в bucket дают отказ, а отсечение
оставляет свежие и не трогает указатель.

### Квота хранилища общая, а скрытые версии её занимают (2026-11-03)

2026-11-03 с 06:14 прод перестал отправлять WAL: B2 отвечал 403
`AccessDenied — Cannot upload files, storage cap exceeded`. Это не ошибка
pgBackRest и не сеть — исчерпана **квота хранилища аккаунта**, а делят её
четверо: WAL-архив, артефакты релиза, мастера справочных видео и копия файлов
клиентов (всё это один bucket `leaddrive-wal-archive`), плюс второй bucket с
ночными дампами (`leaddrive-prod-backups`; ключ на боксе умеет только писать,
так что из прода его не перечислить — считать придётся ключом с Мака).

Что занимало место: живых артефактов 0,86 ГиБ (пять релизов и указатель), а
**скрытых версий — 6,05 ГиБ**. 2 ноября деплои шли десяток раз, и до выноса
мастеров видео из git каждый тарбол весил 430 МБ.
`release-artifact-upload.sh` старые отсекает — но в версионированном bucket
удаление лишь скрывает версию, а байты ждут суточного прохода B2 по правилу
`NoncurrentVersionExpiration = 1 день`. День деплоёв обгоняет это правило.

Чем это видно и чем кончается:

- **Сторож сказал сам**: `🔴 WAL-архив: archive_command is failing …
  pgbackrest check failed`. Ради этого он и стоит — красное пришло в Telegram
  через четверть часа после начала.
- **Данные не теряются, пока цела очередь.** Сегменты копятся в `pg_wal`
  (183 × 16 МБ ≈ 2,9 ГиБ, растёт ~1 ГиБ/час); диска на проде свободно 162 ГиБ,
  поэтому срок даёт не диск, а `archive-queue-max` (16 ГиБ): **исчерпав её,
  pgBackRest начинает ОТБРАСЫВАТЬ WAL и отвечать «успех»** — PITR получит
  молчаливый разрыв. От начала инцидента это примерно 13 часов.
- Тем же отказом ломаются ещё два пути: копия файлов клиентов и ночной дамп в
  B2 (в 04:18 того же дня — HTTP 503), а следующий деплой не сможет положить
  артефакт.

Как разбирать в следующий раз. Причина пишется в лог Postgres целиком —
`tail /var/log/postgresql/postgresql-16-main.log`, строка `<Error><Code>`;
`pgbackrest check` про квоту не говорит ничего, его подсказка про остановленную
stanza сбивает с пути. Занятое место считать **по версиям, а не по текущим
объектам**: `aws s3api list-object-versions` против `s3 ls` — 6,9 ГиБ против
0,86. Освободить место сразу можно только снятием скрытых версий
(`IsLatest=false`); это удаление в бакете бэкапов, то есть слово владельца, как
и поднятие квоты в Caps & Alerts, которое доступно только ему.

### Справочные видео: мастера в хранилище (шаги 1 и 2, 2026-11-01 и 11-02)

`video/player` было 265 МБ отслеживаемых файлов (132 файла: 66 клипов и
66 постеров), и видео с обоями занимали 541 МБ из 1,34 ГиБ истории git: каждая
перезапись добавляла копию навсегда. Те же 265 МБ ехали внутри каждого
артефакта и лежали на проде **трижды** — в старом чекауте, в релизе и в
runtime-каталоге (проверено: это разные иноды, не симлинки). Ни один из этих
байтов не нужен, чтобы поднять сервис.

**Подписанных ссылок здесь нет, и это решение владельца.** Файлы отдаёт само
приложение (`/api/help-videos/[file]`) за `requireAuth`, потоком с диска, с
поддержкой Range. Отдать браузеру подписанный URL значило бы сделать каждый
файл предъявительской ссылкой на время её жизни. Поэтому в хранилище лежат
**мастера**, а байты, которые смотрит человек, остаются на диске прода: кто
может смотреть — не меняется ни на строку.

`scripts/help-videos/assets-sync.sh` работает в обе стороны и идемпотентен, так
что перехода «в один день» не требуется:

| в хранилище | на диске | что делает |
|---|---|---|
| есть манифест | чего-то не хватает или испортилось | подтягивает недостающее, сверяя sha256 |
| есть манифест | всё перечисленное на месте | ничего (лишние файлы не трогает) |
| манифеста нет | файлы есть | публикует набор и манифест |
| манифеста нет | ничего нет | отказ: пустой манифест сделал бы все подтягивания молчаливым ничем |

Манифест выгружается **последним**: пока его нет, подтягивание не начинается,
поэтому прерванная публикация не может быть прочитана как полный набор.
Пустой каталог манифестом не становится — иначе пустой «полный» набор сделал
бы все будущие подтягивания молчаливым ничем.

**Шаг 1 (2026-11-01).** Деплой публикует мастера после проверок здоровья —
Step 9c. Намеренно не там, где видео копировались в runtime-каталог: та копия
шла с остановленным PM2, и 265 МБ в этом окне добавляли бы минуты простоя на
каждом деплое. Провал публикации деплой не роняет и отдачу не задевает.

**Шаг 1 на проде не сработал ни разу, и это выяснилось только сутки спустя.**
`deploy.yml` не кладёт `scripts/help-videos/` в бандл — туда копируются
`scripts/*.sh` верхнего уровня и перечисленные подкаталоги, и этого нового
среди них не было. Поэтому Step 9c на каждом деплое печатал последней строкой
`WARNING: …/assets-sync.sh is missing; help-video masters were NOT published`,
а в хранилище не появилось ни одного мастера. Шаг, который о своём провале
сообщает предупреждением в самом конце деплоя, равен отсутствующему шагу:
теперь наличие скрипта, манифеста и версии в артефакте проверяет и `deploy.yml`
при сборке, и `validate_release_owned_operations_artifact` на хосте — вторая
проверка роняет деплой, как и для скриптов бэкапа.

**Шаг 2 (2026-11-02).** Видео больше нет ни в дереве, ни в артефакте. В
репозитории остался `video/player/masters.sha256` — манифест набора в той же
форме `sha256  имя`, что и манифест в хранилище. Теперь по нему, а не по
содержимому чьего-то рабочего дерева, отвечают на вопрос «существует ли клип»:
и генератор доступности (`npm run help-video:sync`), и тесты демо и справки.
`.gitignore` закрывает `video/player/*.mp4` и `*.jpg`, чтобы перезапись не
вернула 265 МБ в историю.

Подтягивание идёт **до** остановки PM2, пока старый релиз ещё отвечает, —
значит, простоя оно не стоит вообще, а прежняя копия 265 МБ с остановленным
PM2 из деплоя ушла. Отдельного staging-каталога нет намеренно: скрипт ставит
файл под итоговым именем только после сверки sha256, а `install` — атомарное
переименование внутри того же каталога, и читатель, уже открывший старый файл,
продолжает читать его. Staging-копия означала бы вторые 265 МБ на том же диске
без выигрыша.

`--expect` закрепляет набор: манифест в bucket обязан побайтово совпасть с тем,
с которым собран релиз, иначе не скачивается ничего. Сверка каждого файла этого
не ловит — она доказывает, что байты соответствуют манифесту, который ей дали,
а не что манифест правильный. На публикации тот же флаг значит другое: выгрузить
ровно набор релиза и ничего кроме. Не «каталог обязан совпасть» — прод хранит
клипы всех релизов, которые когда-либо отдавал, и строгое равенство отказало бы
ровно на первой публикации, оставив bucket пустым навсегда.

Строка SUMMARY несёт `help-videos=<что вышло>`:

| значение | что это значит |
|---|---|
| `none` | всё, что перечислено в хранилище, уже на диске |
| `pull` | что-то пришло — **только тогда** чистится кэш Cloudflare: URL с тем же `?v=` сменил тело, и это единственный случай, которого Cloudflare не видит сам |
| `no-manifest` | для этой версии в хранилище ещё ничего нет. Так выглядит первый деплой после шага 2: мастера публикуются ниже, после проверок здоровья, из runtime-каталога |
| `failed` | подтянуть не удалось. Релиз здоров, справка отдаёт то, что уже лежит на диске |
| `deferred-pre-cutover` | на хосте ещё не прошёл runtime-cutover `help-videos`; подтягивание отложено до публикации, иначе cutover отказался бы объединять каталоги |
| `no-storage-config` | нет `/etc/leaddrive/wal-archive.env` |

**Перезапись клипа теперь кончается публикацией, а не коммитом.** Порядок:
положить файлы в `video/player/`, обновить `masters.sha256`
(`sha256sum` в порядке `LC_ALL=C`), поднять `HELP_VIDEO_ASSET_VERSION` в
`src/content/help/video-assets.ts`, прогнать `npm run help-video:sync` и
опубликовать мастера под новой версией — с хоста, где есть ключи bucket:

```
scripts/help-videos/assets-sync.sh --version <новая> \
  --dir <каталог с новыми мастерами> --expect <путь>/masters.sha256
```

Если версию поднять, а мастера не опубликовать, прод останется на прежних
байтах: подтягивание скажет `no-manifest`, публикация из runtime-каталога
упрётся в `--expect` (там старый набор) и напишет WARNING. Это видно в
SUMMARY и ничего не ломает.

Что уже окупилось на этапе написания: тест нашёл в фильтре имён запрет
заглавных букв, из-за которого публиковались только постеры — `VOICE` в
именах заглавными. Теперь шаблон имён берётся как у маршрута отдачи, и
отдельный тест сверяет, что две копии этого шаблона не разошлись.

### Восстановление на точку

```
pgbackrest --stanza=leaddrive --type=time \
  --target="2026-11-01 17:05:00+00" --target-action=promote restore
```

Цель задаётся с точностью до секунды и должна быть строго позже конца
выбранного полного бэкапа. Ключ от репозитория лежит в
`/etc/leaddrive/wal-archive.env`, а при потере хоста — внутри
age-зашифрованного снимка секретов. **Значит, восстановление по-прежнему
упирается в закрытую часть age-ключа владельца:** без неё WAL-архив так же
нечитаем, как дампы. Вторая офлайн-копия этого ключа — отдельная задача, и она
важнее всего остального в этом разделе.

## Копия файлов клиентов (2026-11-02)

База возвращается из объектного хранилища, а файлы, на которые она ссылается,
до этого не возвращались никуда: договоры, вложения задач и тикетов, фото и
документы MTM, медиа чатов лежали только на одном диске прода плюс
пред-деплойная копия на том же диске. Закрывает это
`scripts/backup/uploads-offsite-mirror.sh` — таймер
`leaddrive-uploads-offsite` раз в сутки, 05:20 UTC.

**Почему не `snapshot-runtime-files.sh`, написанный ровно для этого.** Он часть
церемонии: ему нужен commissioned `/etc/leaddrive/backup.env`
(`BACKUP_AGE_RECIPIENT`, `BACKUP_S3_*`, healthcheck), он складывает **полный**
tar дерева в tmpfs и требует там 110 % свободного места, а его юнит — один из
четырёх, которые деплой намеренно держит остановленными. Растущее дерево файлов
клиентов нельзя каждую ночь архивировать в память.

**Как сделано вместо этого:**

- **по файлу, а не по дереву**: уходит то, что появилось с прошлого прогона,
  поэтому первый догон можно размазать по ночам, а обычная ночь дешёвая;
- **потоком через age прямо в bucket**: ни открытого, ни зашифрованного
  временного файла на диске прода не появляется, поэтому упавший прогон не
  оставляет за собой копию чужого договора;
- **на ключ владельца**, так что восстановление требует только его ключа, а не
  базы, к которой файлы относятся;
- **на ключах, которые на хосте уже есть** — `/etc/leaddrive/wal-archive.env`,
  тот же файл, которым пользуются pgBackRest, копия артефакта релиза и мастера
  справочных видео. Ни церемонии, ни второго bucket, ни нового ключа;
- **прогон ограничен** (`--max-bytes`, по умолчанию 2 ГиБ, и `--max-seconds`,
  30 минут). Порог проверяется ПЕРЕД файлом, иначе файл больше ночного бюджета
  не уехал бы никогда;
- **из bucket ничего не удаляется**: файл, удалённый на проде, в копии
  остаётся — это и есть бэкап.

**Чего в копии нет намеренно: `uploads/call-recordings`.** У записей звонков
свой срок — 90 дней, и его держит крон; копия, живущая вечно, молча отменила бы
это решение, а lifecycle на один префикс — настройка, которую этот скрипт
сделать не может. Отдельный вопрос владельцу, а не решение по умолчанию.

**Порядок включения.** Программа приезжает с каждым деплоем в
`/usr/local/lib/leaddrive-v2/ops/current/backup/`, как остальные скрипты
бэкапа. На проде, под root, один раз:

```
bash /usr/local/lib/leaddrive-v2/ops/current/backup/uploads-offsite-mirror.sh --plan
bash <ops>/backup/uploads-offsite-install.sh --recipient age1…
systemctl start leaddrive-uploads-offsite.service   # первый догон, можно повторять
bash <ops>/backup/uploads-offsite-install.sh --check
```

`--plan` ничего не отправляет и говорит, сколько там файлов и байтов.
Получатель — публичный age-ключ владельца, тот же, которым шифруется ночной
дамп; он пишется в `/etc/leaddrive/uploads-offsite.env` (root, 0600).

**На проде два age-получателя, и перепутать их — значит сделать копию, которую
нечем открыть.** Ключ владельца держит скрипт ночного бэкапа хоста
(`/usr/local/sbin/leaddrive-backup.sh`): его закрытая часть есть только на Маке
владельца. Второй, `BACKUP_AGE_RECIPIENT` из `/etc/leaddrive/backup.env`, —
дев-боксовый: его закрытый ключ лежит на dev-боксе рядом с копиями бэкапов,
поэтому шифровать им копию бессмысленно (то же правило — в `CLAUDE.md`,
«Прод и деплой»). Измерено 2026-11-02: в этих двух файлах лежат именно эти два
разных ключа. Поэтому установку проще звать обёрткой, которая берёт ключ только
из скрипта бэкапа и отказывается, если его там не один:

```
# с Мака, обёртка живёт на dev-боксе (scripts/ops/uploads-offsite-remote.sh)
ssh remote-dev /home/rashad/bin/leaddrive-uploads-offsite --show-key   # какой ключ откуда
ssh remote-dev /home/rashad/bin/leaddrive-uploads-offsite --plan       # объём
ssh remote-dev /home/rashad/bin/leaddrive-uploads-offsite --install    # поставить
ssh remote-dev /home/rashad/bin/leaddrive-uploads-offsite --run-now    # первый прогон
```

**Включено на проде 2026-11-02 и проверено:** первый прогон унёс все 148 файлов
(91 614 221 байт, 5 мин 48 с процессорного времени), второй прогон отправил
ноль — журнал не даёт отправлять дважды, — и сторож на боксе сам сказал «копия
файлов клиентов свежая».

### Что на диске лежит открытым, и почему это не остаток бэкфилла

Первый `--plan` напечатал `pending_unsealed=36`, и это прочли как «бэкфилл
шифрования не добежал». Проверка 2026-11-03 показала обратное: бэкфилл
`tenant-file-encryption-backfill` на проде **закончен** — 112 файлов клиентов
из 112 запечатаны, `wouldSeal=0`, `ownerUnknown=0`. 36 — это всё, что в дереве
не несёт конверта `LDFE`, а таких видов три:

| сколько | где | что это |
| --- | --- | --- |
| 25 | `logos` (4), `email-images/<org>` (1), `social-logos/<org>` (4), `social-media-previews/<org>` (16) | открыто **намеренно**: раздаётся без входа, приложение их не шифрует (`src/lib/crypto/tenant-file-locations.ts`, список с причинами — `tenant-file-readers-guard.test.ts`) |
| 2 | `.gitkeep` в корне и в `contracts/` | пустые заглушки, 0 байт |
| 9 | `mtm-golden/cmpjtfpxs000050bpob3dlnex/golden-*.jpg` | **сироты снятой функции**: эталонные фото планограмм (июнь 2026, организация Mars Overseas Baku). Код вырезан вместе с переносом планограмм в LeadShelf (`cfa4d098e`, `12c8e994d`), файлы остались. В работающем бандле прода строки `mtm-golden` нет вовсе — ни один путь приложения их не читает и не пишет |

Само число было ещё и неправильно устроено: оно считалось **по очереди на
отправку**, а не по дереву, поэтому на следующий день после первого прогона
читалось бы `0` — «всё запечатано» — над деревом из открытых файлов. Теперь
счёт идёт по всему дереву и разделён на три: `plain_public`, `plain_empty` и
`plain_unexpected` — последнее и есть «файл клиента лежит открытым там, где не
должен». Он попадает в состояние (`offsite_plain_unexpected`), и сторож о нём
предупреждает; в журнале прогона названы каталоги. Это единственная проверка,
которая смотрит на диск: `tenant-file-readers-guard.test.ts` доказывает, что
код шифрует то, что пишет, и ничего не говорит о том, что уже лежит.

**Девять сирот удалены 2026-11-03** по слову владельца («Удали»): файлы сняты
с прода вместе с пустым каталогом `uploads/mtm-golden/`, девять `.age` — из
копии в хранилище. Перед удалением записан перечень — путь, размер, время,
`sha256` — в `/root/mtm-golden-removed-20261103.txt` на проде; самих байтов
больше нет нигде, в этом и было решение. После удаления прогон копии печатает
`plain_public=25 plain_empty=2 plain_unexpected=0`, и сторож сказал «прод снова
в порядке». **Ожидаемое состояние теперь — `plain_unexpected=0`:** другое число
значит, что открытым лёг новый файл клиента, а не старый остаток.

**Сторож видит эту копию**: `host-health-watch.mjs` читает
`/var/lib/leaddrive-uploads-offsite/state` (плоский `key=value`, чтобы не
разбирать JSON по ssh) и тревожит, если копия не делалась 30 ч (предупреждение)
или 50 ч (авария), а также если прогон сам сказал `crit`. Пока файла состояния
нет, сторож молчит: копия стоит не на каждом хосте, и открытая дырка записана
здесь, а не кричит каждые пять минут.

Поведение закреплено `scripts/backup/uploads-offsite-contract.test.mjs`
(гейт в `static-checks`): заглушка `age` там обратимая (base64), поэтому тест
сверяет **байты, которые уехали, с байтами на диске**, а не только факт
вызова; круговой проход настоящим age проверяется под
`LEADDRIVE_OWNER_AGE_INTEGRATION=1` и прогнан руками 2026-11-02.

## Почему четыре таймера стоят, и что из этого следует (2026-11-02)

Сторож с бокса показал на проде: `leaddrive-postgres-backup.timer` и
`leaddrive-secrets-snapshot.timer` — `disabled`,
`leaddrive-runtime-files-snapshot.timer` — `not-found`, `leaddrive-log-ship`
включён и работать не может. Это **не авария и не недосмотр**, у всех четырёх
одна причина, и она в коде деплоя.

**Причина одна: подсистема бэкапов на этом хосте не commissioned.**
`event_platform_recovery_gate_mode` в `scripts/server-deploy.sh` читает
`/etc/leaddrive/backup.env`: если там `BACKUP_ENCRYPTION=age` — режим
`commissioned`, иначе `plain`. В `plain` деплой **не устанавливает** восемь
юнитов подсистемы вовсе («установить их на хосте, который никогда не был
commissioned, значит поставить на часы четыре таймера, чьих программ нет и чья
offsite-цель больше не существует, — каждое срабатывание было бы гарантированным
отказом и ежедневной ложной тревогой») и гасит их, если они на хосте уже есть.

Отсюда и разница в состояниях: два `disabled` — это юниты, доставшиеся от
прежней, commissioned жизни хоста (до переезда с Hetzner), а
`runtime-files-snapshot` на этом хосте не устанавливался никогда.

**Включать их руками нельзя, и дело не только в правилах.** Деплой намеренно
падает, если найдёт любой из четырёх запланированным на таком хосте
(`is still scheduled on a host where the backup subsystem is not
commissioned`). То есть ручное `systemctl enable` ломает следующий деплой —
и при этом ничего не бэкапит, потому что off-site цель той эпохи не существует.

**Что из этого НЕ следует.** Бэкапов нет — неверно. База и секреты уезжают
живой цепочкой, и она к этим юнитам отношения не имеет: прод age-шифрует
ночной дамп и архив `/etc/leaddrive` ключом владельца и rsync-ит `*.age` на
dev-бокс, оттуда `leaddrive-b2-mirror` (таймер на боксе, 04:19) копирует их в
приватный bucket ключом только на запись и сам тревожит в Telegram, если
источник старше 30 часов. Плюс pgBackRest с 2026-11-01: WAL и
полные/разностные бэкапы в B2. То есть у базы и секретов три места, а
`leaddrive-postgres-backup` и `leaddrive-secrets-snapshot` добавили бы к этому
не сохранность, а **доказуемость** (immutable версии, Object Lock, evidence,
сертификация) — это цель ISO 27001, а не условие восстановления.

**Что из этого следует, и это единственное важное.**
`leaddrive-runtime-files-snapshot` — единственный из трёх, который ничего не
дублирует: он уносит `/var/lib/leaddrive-v2/uploads` и `help-videos`. В
`uploads` лежат договоры, вложения задач и тикетов, фото и документы MTM, медиа
чатов и **записи звонков** (`uploads/call-recordings/<orgId>/`). Этих байтов нет
нигде, кроме прода и локальной пред-деплойной копии на том же диске. База
вернётся из B2 — файлы, на которые она ссылается, не вернутся. Таблица
host-loss выше это обещала; теперь в ней написано, как есть.

Чем это закрывается, когда владелец решит: у `snapshot-runtime-files.sh` есть
режим `--owner-operated <age1…>`, которому нужен только публичный ключ
владельца, а не вся церемония. Два вопроса перед включением — размер `uploads`
на проде (записи звонков растут непрерывно, 90 дней хранения) и то, что файлы
клиентов **уже зашифрованы на диске** ключом организации с 2026-10-22, поэтому
копия может оказаться дешевле полного ночного tar. Ни того, ни другого не
измерить из сессии, у которой нет чтения прода.

## Сторож трёх вещей, которых никто не стерёг (2026-11-02)

Три пункта из этого же документа долго оставались без сторожа: **главная
страница снаружи, свежесть вчерашнего бэкапа и место на диске.** У WAL-архива
сторож свой, у линии и станции — свои, а это замечали в тот день, когда уже
поздно. Теперь есть `scripts/backup/host-health-watch.mjs`: таймер
`ld-host-watch` на dev-боксе раз в 5 минут, Telegram через
`~/bin/notify-telegram`, ставит `scripts/backup/install-host-watch.sh`.

**На проде для этого не установлено ничего.** Страница берётся по HTTPS тем же
путём, которым до неё доходит человек (Cloudflare → nginx → приложение), а
бэкапы и диск читаются одним read-only вызовом ssh. У WAL-проверки есть свой
скрипт на проде, потому что там её уже гоняет пятиминутный таймер и два
погонщика боролись бы за его лок; `systemctl show` и `df` состояния не держат,
так что второму скрипту на проде просто нечего было бы делать.

Что именно проверяется:

- **Страница.** `/` → 307 → `/login`, код 200, и в теле должна быть разметка
  приложения (`/_next/static/`). Одного кода 200 мало: страница ошибки на
  границе отдаёт 200 с чужим телом, и сторож, который смотрит только код,
  называет это здоровьем. Дольше 6 с — предупреждение (норма 0,3–1,0 с).
  Если страница не открылась, сторож спрашивает `/api/v1/ping` и говорит
  разное: «прод не отвечает снаружи» или «приложение живо, страница — нет».
- **Бэкапы — двумя способами, потому что их делают двое.** Расписание, которое
  у нас есть, — pgBackRest (`leaddrive-wal-backup`), и оно проверяется по
  юниту: есть ли таймер, включён ли он, чем кончился последний запуск и как
  давно он был. Так видно то, чего по файлам не видно вовсе: **таймера нет или
  он выключен — расписания не существует.** Ловушка, на которую это написано:
  `systemctl show -p Result` отдаёт `success` и для юнита, который никогда не
  запускался, и для юнита, которого вообще нет, — поэтому «ни разу не
  отработал» определяется по пустой отметке времени, а не по результату.
  А бэкап, на который владелец опирается, делает скрипт хоста
  (`/usr/local/sbin/leaddrive-backup.sh`, с 2026-10-23), и его расписание не
  наше, — поэтому он проверяется по тому, что оставляет: возраст самого свежего
  `*.dump.age` и `etc-leaddrive-*.tgz.age` в `/var/backups/leaddrive`
  (30 ч — предупреждение, 50 ч — авария). Если под шаблон не попало ничего,
  тревога называет **самый свежий файл, который там есть**: сторож, который
  ищет не то имя, должен сказать это так, чтобы было что починить, а не пугать
  словами «бэкапа нет». Возраст в обоих случаях считается по часам прода
  (`date -u +%s` в том же вызове), иначе уехавшие часы бокса давали бы ночную
  ложную тревогу.
- **Четыре юнита церемонии намеренно не watched.** Замерено на проде
  2026-11-02: `leaddrive-postgres-backup` и `leaddrive-secrets-snapshot` —
  `disabled`, `leaddrive-runtime-files-snapshot` не установлен,
  `leaddrive-log-ship` включён и работать не может, пока не достроена
  журнальная эвиденция этого рунбука. Это задокументированное состояние хоста,
  у которого recovery gate идёт в plain mode, а не авария; сторож, который
  краснеет на осознанной дырке, краснеет всегда — и его перестают читать.
  Вернуть каждый в список в тот же день, когда его активацию достроят: Stop
  conditions выше требуют, чтобы все четыре были `loaded`, `enabled`, `active`
  — и пока это не так, гейт закрытым считать нельзя.
- **Место — по файловым системам, в гибибайтах.** 15 ГиБ — предупреждение,
  6 ГиБ — авария; процент только вторым, более тугим порогом (10 % и 5 %).
  Процент сам по себе неверен с двух концов: 10 % от 20 ТБ — это 2 ТБ и будить
  никого не надо, а 10 % маленького диска уходят за ночь. Несколько
  наблюдаемых путей на одной файловой системе дают одну тревогу, а не четыре.

Доставка общая с WAL-сторожем (`scripts/backup/watch-delivery.mjs`): **каждая
тревога ждёт второго прогона** — все вердикты этот сторож выносит сам, и одна
плохая минута сети не должна никого будить; авария напоминает о себе раз в час,
предупреждение говорится один раз, «снова в порядке» — один раз. Сам сторож
упал — об этом скажет `ld-host-watch-failed.service`, не чаще раза в 6 часов.

Чего он не покрывает: если упадёт сам dev-бокс (он в том же Contabo, что и
прод), эти тревоги не придут. У линии для этого есть запасной сторож в OVH,
который просыпается, когда пульс бокса стареет; для этого сторожа такого
дубля пока нет.

## Регулярные проверки

- Ежедневно: dead-man success не старше 26 часов; последние database и
  runtime-media objects имеют version ID и действующий COMPLIANCE retention.
- Еженедельно: успешен secrets snapshot; его exact version и metadata видимы;
  проверить отсутствие grant/config drift.
- Каждые **28 дней или раньше**: создать новый full candidate, выполнить
  independent exact-version DB + secrets + runtime + log decrypt/data/RLS/PII
  restore drill и `certify-offline-restore`; недостаточно просто скачать
  старый catalog. Full evidence имеет 35-дневное operational freshness окно,
  а эта ceremony заново продлевает exact genesis payload до catalog horizon.
  Bootstrap certificate — долгоживущий исторический genesis record (его
  signature/scope/candidate/allowlist всё равно перепроверяются), поэтому
  новый bootstrap после committed genesis запрещён.
- После migration owner/schema или изменения crypto/helper code: повторить
  default privileges, dump list и signed restore drill.
- Ежеквартально: ротация S3/DB credentials с overlap. Age recipient ротировать
  только после proof, что старые retained versions всё ещё читаются старым
  escrowed key.

## Stop conditions

Не включать timers, не запускать Fund cutover и не считать F-09/F-36 закрытыми,
если выполняется хотя бы одно:

- app-role или backup-role — superuser; app-role имеет `BYPASSRLS`;
- source canary пустой, restore canary не совпал или source DB identity не та;
- scratch PostgreSQL не loopback/disposable/encrypted либо совпадает с source;
- bucket/version не имеет действующий `COMPLIANCE` Object Lock;
- private age/signing key оказался на production, в Actions или репозитории;
- две identity-копии не на независимых носителях или хотя бы одна не decrypt-ит;
- DB, secrets и runtime objects не связаны exact version ID и ciphertext SHA-256;
- recovered secrets snapshot не открыл реальную PII-колонку;
- evidence не подписан trusted independent Ed25519 principal или его reviewed
  code/main/candidate binding не совпадает;
- recovery catalog exact version не читается либо signer trust anchor существует
  только внутри того же catalog/bucket;
- пытаются считать v3 catalog clean-host backup либо запускать bootstrap с
  committed anchor без approved signed discontinuity/reseed protocol;
- GitHub `production` environment не ограничен точной deployment branch policy
  `main`; независимое signed recovery evidence отсутствует или не прошло проверку;
- любой из четырёх timer не `loaded`, `enabled`, `active` после полного normal
  deployment (не после commissioning certification).

Дополнительно не объявлять multi-tenant enterprise GA, пока хотя бы одно:

- `FULL_AUTHORITY_RESTORE_STATUS` не `passed` в отдельно reviewed drill;
- PostgreSQL PITR/WAL archive и watermark reconciliation не испытаны;
- нет второй immutable replica в независимом provider/account/регионе;
- runtime media не имеют согласованной DB/object generation и tombstone ledger;
- operational state и все host-loss credentials/CA не имеют утверждённого
  backup либо детерминированного rebootstrap authority;
- Kafka, archive и consumer recovery остаются passive для заявленного модуля.

## Отдельный owner-operated technical proof — 2026-10-19

Владелец отдельно разрешил режим без независимого проверяющего:
[owner-operated recovery](operations/owner-operated-recovery.md).
Его отдельный Actions workflow создаёт одноразовый encrypted data candidate и
проверяет подписанный результат настоящего isolated restore владельцем.
Это не fallback текущей ceremony: другой scope, signature namespace, signer
allowlist и каталог evidence. Канонический recipient/env и schedules не меняются;
independent/enterprise/Kafka readiness этим не закрываются. Для обеих схем
шифрование, целостность и изоляция scratch обязательны.
