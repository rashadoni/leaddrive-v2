# Production backup runbook

Этот runbook реализует защищённый backup foundation. Его цель — не просто
получить успешный exit code `pg_dump`, а доказать, что FORCE RLS не скрыл данные,
дамп, секреты и runtime-файлы читаются вне production, а точные зашифрованные
версии и recovery catalog действительно защищены Object Lock.

Это ещё не enterprise 3-2-1/PITR: все object copies пока находятся в одном
Hetzner bucket/регионе/account failure domain, PostgreSQL WAL archive не
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
- S3 writer создаётся в отдельном Hetzner project и не должен иметь
  `DeleteObject` или право обхода retention. Отдельный restore credential
  хранится вне production и используется только на drill. Same-project key
  остаётся offline policy-admin: у ключей внутри bucket project по умолчанию уже
  есть полный доступ, который одним Allow statement не сузить.
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

1. Bucket `leaddrive-prod-backups` должен быть private и создан с Object Lock.
2. До первого production upload задать default retention `COMPLIANCE`, 14 дней.
   Это закрывает короткое окно между multipart upload и индивидуальным
   продлением weekly/monthly объекта.
3. Сохранённый same-project key считать offline policy-admin и не размещать на
   production. Создать отдельный Hetzner project для production writer key.
4. Bucket policy allowlist-ит principal вида
   `p<writer_project_id>:<writer_access_key>` и только нужный bucket/multipart
   upload, `Head/GetObject`, чтение lock config и get/put retention; явно не
   выдаёт delete и bypass-governance. После policy проверить реальные allow и
   deny операции. Ограничение по ключу отключит listing объектов в Hetzner
   Console — это ожидаемое следствие, не причина возвращать широкие права.
5. Создать ещё один cross-project offline restore key с read-only доступом. Не
   размещать его на production runner.
6. Настроить lifecycle cleanup после окончания retention для daily/weekly/monthly
   prefixes. Сначала проверить политику на тестовом prefix: Object Lock должен
   блокировать раннее удаление.

Go/No-Go: `get-object-lock-configuration` показывает `Enabled`,
`COMPLIANCE`, `Days >= 14`; writer не может удалить тестовый locked object.

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
   `root:leaddrive-backup 0640`. Pgpass-файлы — `root:leaddrive-backup 0640`
   либо принадлежат service user и имеют `0600`.
4. Создать внешний monitor с окном 26 часов и реальным каналом оповещения.
5. Убедиться, что firewall разрешает runner только private DB/scratch endpoints,
   DNS, Hetzner S3 и monitor endpoint.

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
Object Storage. Private identity остаётся вне production/GitHub/Hetzner; на
сервере есть только публичный recipient.

## Commissioning после переноса production

Текущий production — `13.140.132.245`. Доказательства, systemd-state и локальные
markers прежнего хоста `46.224.171.53` являются историей инцидента, а не
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
2. назначить required reviewer, который не запускает свой собственный stage;
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

Также требуется PostgreSQL WAL archive/PITR в отдельном failure domain. Drill
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
| `/var/lib/leaddrive-v2/uploads`, `help-videos` | encrypted content inventory | host-loss copy; не application-consistent generation |
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
- GitHub `production` environment не требует независимого review и `main`;
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
