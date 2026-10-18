# Офсайт-бэкапы LeadDrive CRM в Backblaze B2

Состояние на 2026-10-19. Документ описывает, что подготовлено в B2 для
существующего пайплайна из [BACKUP_RUNBOOK.md](BACKUP_RUNBOOK.md), что ещё не
сделано и почему. **Данные LeadDrive пока НЕ защищены через B2:** в bucket нет ни
одного бэкапа, и ни одно восстановление из него не выполнялось.

B2 — независимый от Contabo провайдер и аккаунт. Это не снимает gate Kafka A4:
независимые failure domains для самой платформы событий и остальные
инфраструктурные гарантии этим не доказываются.

## Что есть в B2

| что | значение | как проверено |
|---|---|---|
| аккаунт | регион данных **EU Central**, двухфакторный вход включён | My Settings в консоли |
| оплата | **способа оплаты нет** — бесплатный уровень | Billing: «Enter a payment method», счёт $0.00 |
| лимиты расходов | все caps = **$0**: хранение 10 ГБ, скачивание 1 ГБ/сутки, транзакции B и C по 2 500/сутки | Caps & Alerts |
| bucket | `leaddrive-prod-backups`, id `f41e6de91ed35b1aa41e011e`, создан 2026-10-19 | список buckets |
| доступ | **Private**; анонимный GET по friendly- и S3-адресу → `401` | `curl` с dev-бокса |
| шифрование | SSE-B2 по умолчанию, `AES256 (SSE-B2)` на загруженном файле | детали файла в консоли |
| версии | B2 хранит все версии; удалить версию может только ключ с `deleteFiles` | настройка bucket |
| lifecycle | одно правило: префикс `leaddrive-b2-synthetic-check` — скрыть через 1 день, удалить ещё через 1 | диалог Lifecycle, перечитан после сохранения |
| Object Lock | **выключен** (причина ниже) | `Object Lock: Disabled` |
| S3 endpoint | `https://s3.eu-central-003.backblazeb2.com`, регион `eu-central-003` | консоль; с прода доступен (анонимно `403`) |
| ключи | только master key; ограниченных ключей **нет** | Application Keys |

Синтетическая проверка: через консоль загружены два файла по 65 КБ без клиентских
данных (`leaddrive-b2-synthetic-check-20261019.bin` и `…-v2-…`). У второго
содержимое детерминированное; SHA1, который хранит B2, совпал с SHA1, посчитанным
на dev-боксе (`e6ea2d18…02321`). Скачивание обратно через ограниченный ключ
**не выполнено** — ключей ещё нет. Оба файла уберёт lifecycle-правило.

## Почему Object Lock пока выключен

В B2 Object Lock можно включить и на существующем bucket, но выключить уже
нельзя, а пайплайн требует ещё и default retention `COMPLIANCE` ≥ 14 дней — всё,
что попадёт в bucket после этого, удалить досрочно не сможет никто. Включать это
стоит в день commissioning, когда пишет настоящий writer, а не сейчас.

Объём, который будет зажат (расчёт ниже), к 13-му месяцу ~30–45 ГБ. Худший случай
«передумали и хотим всё удалить»: хранить зажатое до конца срока (до 400 дней для
monthly) — порядка **$4–5 суммарно** по цене $6.95/ТБ·мес. На бесплатном уровне
(без карты) это не деньги, а риск: заполненные 10 ГБ остановят все новые бэкапы.

## Объём и стоимость

Замер на проде 2026-10-19 (только чтение):

| что бэкапится | сейчас | рост |
|---|---|---|
| БД `leaddrive_v2` | 480 МБ живьём; `pg_dump -Fc` 43,1 МБ | дамп +0,35 МБ/сутки (38,6 → 43,1 МБ за 13 дней) |
| `/etc/leaddrive` | ~9 КБ (tgz) | — |
| `uploads` | 75 МБ, 132 файла | +57 МБ за последний месяц |
| `help-videos` | 267 МБ | — |
| логи (`leaddrive-v2-logs`, nginx, postgresql) | ~50 МБ на диске | не измерен |

Пайплайн пишет по одному объекту за прогон: daily 16 дней, weekly 63, monthly 400
— в установившемся режиме ~39 объектов на поток. Runtime-файлы снимаются целиком
каждую ночь.

| поток | через 2 месяца | через 13 месяцев |
|---|---|---|
| БД | ~1–1,5 ГБ | ~3–4,5 ГБ |
| runtime-файлы (uploads + help-videos) | ~10 ГБ | ~25–40 ГБ |
| секреты, логи | < 0,5 ГБ | ≤ 1 ГБ (логи — оценка) |
| **итого** | **~12 ГБ** | **~30–45 ГБ** |

Цена B2: хранение $6.95/ТБ·мес (первые 10 ГБ бесплатно), загрузка и API-вызовы
бесплатно, скачивание бесплатно до 3× среднего объёма за месяц. Итого
**~$0.01/мес** на втором месяце и **до ~$0.25/мес** к концу года. Одна тренировка
восстановления (~1 ГБ) укладывается в бесплатное скачивание.

Вывод: **бесплатных 10 ГБ хватит на 3–4 недели** работы пайплайна в нынешних
настройках — ночной полный снимок runtime-файлов съедает их первым. Дальше два
пути, оба — решение владельца:

1. добавить карту и поставить cap хранения, например **$0.05/сутки** (это потолок
   ~215 ГБ, ≈ $1.5/мес максимум) — тогда пайплайн работает как спроектирован;
2. остаться бесплатно и сократить runtime-снимки (например, только weekly/monthly)
   — это правка пайплайна отдельным PR.

## Ключи

Веб-консоль B2 даёт ключам только пресеты «Read and Write», «Read Only»,
«Write Only». Писателю пайплайна нужно больше, чем Write Only (HEAD, Object Lock
retention), и меньше, чем Read and Write (без удаления), поэтому ключи создаются
через API скриптом [`scripts/backup/b2-create-backup-keys.py`](../scripts/backup/b2-create-backup-keys.py):

| ключ | права (все — только на bucket `leaddrive-prod-backups`) | где хранится |
|---|---|---|
| `leaddrive-prod-backup-writer` | `listBuckets`, `readBucketEncryption`, `readBucketRetentions`, `writeFiles`, `readFiles`, `readFileRetentions`, `writeFileRetentions` | `/etc/leaddrive/backup.env` на проде, только в ходе commissioning |
| `leaddrive-prod-backup-restore` | `listBuckets`, `readBucketEncryption`, `readBucketRetentions`, `listFiles`, `readFiles`, `readFileRetentions` | офлайн: менеджер паролей владельца / машина тренировки восстановления |

Ни у одного нет `deleteFiles`, `bypassGovernance`, прав на ключи и настройки
bucket. Скрипт спрашивает master key без эха, печатает только key ID и права,
секреты пишет в два файла 0600 в новом каталоге 0700.

После создания — [`scripts/backup/b2-verify-backup-keys.sh`](../scripts/backup/b2-verify-backup-keys.sh):
загружает 9 МиБ случайных байт теми же вызовами AWS CLI, что и
`postgres-backup.sh` (multipart, sha256 в метаданных, `head-object`), скачивает
ключом восстановления и сравнивает побайтно, затем проверяет запреты: writer не
удаляет и не листает, restore-ключ не пишет и не удаляет. Заодно выясняет, принимает
ли B2 контрольные суммы AWS CLI ≥ 2.23 по умолчанию (на проде стоит 2.36.40); если
нет — скрипт скажет, что нужен `AWS_REQUEST_CHECKSUM_CALCULATION=when_required`.

Действие владельца (5 минут, на Маке с `aws` CLI v2 или на dev-боксе):

1. Консоль B2 → Application Keys → «Generate New Master Application Key».
   Старый master key при этом перестанет работать; им ничего не пользуется
   (до 2026-10-19 в аккаунте не было ни bucket, ни других ключей).
2. ```bash
   python3 scripts/backup/b2-create-backup-keys.py --bucket leaddrive-prod-backups --out ~/leaddrive-b2-keys
   ```
3. ```bash
   bash scripts/backup/b2-verify-backup-keys.sh ~/leaddrive-b2-keys/writer.env ~/leaddrive-b2-keys/restore.env
   ```
4. `restore.env` перенести в менеджер паролей и удалить файл; `writer.env`
   держать до commissioning.

## Совместимость пайплайна

Все S3-вызовы пайплайна (`s3 cp` с метаданными, `head-object`,
`get/put-object-retention`, `get-object-lock-configuration`) у B2 есть. Мешали
три проверки, которые требовали endpoint вида Hetzner `https://<region>.your-objectstorage.com`:
`scripts/server-deploy.sh` (recovery-point gate деплоя),
`scripts/backup/commission-production-backup.sh` и
`scripts/backup/report-production-readiness.sh`. Hetzner выведен, поэтому они
теперь принимают только endpoint B2 своего региона
(`object_storage_endpoint_matches_region`), а
`scripts/backup/object-storage-endpoint.test.mjs` держит три копии одинаковыми и
проверяет, что подделки вида `…backblazeb2.com.example.net` не проходят.

На проде в `/etc/leaddrive/backup.env` переменных `BACKUP_S3_ENDPOINT`,
`BACKUP_S3_REGION`, `BACKUP_S3_BUCKET` сейчас нет вовсе; `aws` 2.36.40 и `age` на
хосте установлены. Значения для B2 — в [`ops/backup/backup.env.example`](../ops/backup/backup.env.example).
Вписывает их владелец в ходе commissioning, не эта сессия.

## Что нашлось попутно (прод не менялся)

- **Рабочий суточный бэкап лежит открытым для всех локальных пользователей прода.**
  `/var/backups/leaddrive` — `0755`, дампы и `etc-leaddrive-*.tgz` — `0644`. В tgz
  лежит весь `/etc/leaddrive`, включая `app.env` (на месте он `0600`). Любая
  учётная запись на хосте читает полный дамп в обход RLS и все секреты. Починка
  (действие владельца): `chmod 700 /var/backups/leaddrive && chmod 600 /var/backups/leaddrive/*`
  и `umask 077` в начале `/usr/local/sbin/leaddrive-backup.sh`.
- **Загруженные файлы тенантов (`uploads`, 75 МБ) и `help-videos` не бэкапит
  ничто.** Суточный скрипт берёт только БД и `/etc/leaddrive`; runtime-снимок есть
  лишь в некоммиссионированном пайплайне.
- Офсайт-копия сейчас одна — dev-бокс `75.119.156.234`, тот же провайдер Contabo.
  Каталог `~/leaddrive-backups` там `0755` (`rsync -a` перезаписывает `chmod 700`
  из скрипта), но домашний каталог `0750`, и посторонних групп у него нет.

## Восстановление — подготовлено, не выполнено

Изолированное восстановление из B2 возможно только после первого настоящего
объекта, то есть после commissioning. Порядок уже описан в
[BACKUP_RUNBOOK.md](BACKUP_RUNBOOK.md), раздел «4. Независимо восстановить exact
versions»: `aws s3api get-object` ключом из `restore.env` (те же
`BACKUP_S3_ENDPOINT/REGION/BUCKET`), расшифровка офлайн-ключом age, затем
`scripts/backup/verify-offline-backup.sh` в одноразовый scratch PostgreSQL.
Рабочая база целью восстановления не бывает никогда.

## NOT RUN и блокеры

| что | почему | кто снимает |
|---|---|---|
| ограниченные ключи writer/restore | секрет B2 показывает один раз; эта сессия ключи не принимает и не хранит | владелец, шаги выше |
| upload/download ограниченными ключами, проверка запретов | нет ключей | `b2-verify-backup-keys.sh` после создания ключей |
| Object Lock + default `COMPLIANCE` 14 дней | необратимо; включать в день commissioning | владелец, в ходе commissioning |
| lifecycle для `postgres/`, `runtime-files/`, `secrets/`, `logs/` | нужен вместе с Object Lock | commissioning |
| карта / cap хранения | финансовое решение | владелец (сумма выше) |
| `backup.env` на проде, таймеры, commissioning | изменение production; age-ключ офлайн | владелец через workflow `Commission production backup` |
| изолированное восстановление из B2 | в bucket нет бэкапов | после commissioning |
