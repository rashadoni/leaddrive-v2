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
| ключи | `leaddrive-prod-backup-writer` (`0034ed9e3ba4e1e0000000001`) и `leaddrive-prod-backup-restore` (`…0002`), созданы 2026-10-19, права — таблица ниже | Application Keys, сверено |

Синтетическая проверка: через консоль загружены два файла по 65 КБ без клиентских
данных (`leaddrive-b2-synthetic-check-20261019.bin` и `…-v2-…`). У второго
содержимое детерминированное; SHA1, который хранит B2, совпал с SHA1, посчитанным
на dev-боксе (`e6ea2d18…02321`). Оба файла уберёт lifecycle-правило.

Проверка ограниченных ключей (`b2-verify-backup-keys.sh`, Мак владельца,
AWS CLI 2.38.1, 2026-10-19 ~00:49 UTC) — **0 ошибок**: multipart-загрузка 9 МиБ
writer'ом прошла с контрольными суммами AWS CLI по умолчанию (настройка
`when_required` не нужна); `head-object` вернул размер, sha256 в метаданных и
version id; скачивание restore-ключом побайтно совпало; writer не может удалить
версию и листать bucket, restore-ключ не может удалить (`AccessDenied`) и
записать (вызов отклонён, но S3-код ошибки скрипт не поймал); объект после
попыток удаления на месте. Object Lock на bucket не настроен, как и задумано.

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

Действие владельца (5 минут, на Маке; команды работают из `~`, клон репозитория
не нужен — скрипты берутся с GitHub по точному коммиту):

1. Консоль B2 → Application Keys → «Generate New Master Application Key».
   Старый master key при этом перестанет работать; им ничего не пользуется
   (до 2026-10-19 в аккаунте не было ни bucket, ни других ключей).
2. Скачать оба скрипта; `shasum` должен показать `42ab21b4…78b7` и `f46faced…cff6`:
   ```bash
   mkdir -p ~/leaddrive-b2-tools && cd ~/leaddrive-b2-tools && for f in b2-create-backup-keys.py b2-verify-backup-keys.sh; do curl -fsSLO "https://raw.githubusercontent.com/rashadoni/leaddrive-v2/0920de2c778f0604afe926b1ad8a9aa68d47feff/scripts/backup/$f"; done && shasum -a 256 b2-*
   ```
3. Создать ключи (спросит key ID и ключ из шага 1, ключ не показывается):
   ```bash
   python3 ~/leaddrive-b2-tools/b2-create-backup-keys.py --bucket leaddrive-prod-backups --out ~/leaddrive-b2-keys
   ```
4. Нужен AWS CLI v2:
   ```bash
   command -v aws || brew install awscli
   ```
5. Проверить ключи:
   ```bash
   bash ~/leaddrive-b2-tools/b2-verify-backup-keys.sh ~/leaddrive-b2-keys/writer.env ~/leaddrive-b2-keys/restore.env
   ```
6. `restore.env` перенести в менеджер паролей и удалить файл; `writer.env`
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
  учётная запись на хосте читала полный дамп в обход RLS и все секреты.
  **Исправлено владельцем 2026-10-19 ~00:39 UTC**
  (`chmod 700 /var/backups/leaddrive && chmod 600 /var/backups/leaddrive/*`),
  проверено: каталог `700`, все 42 файла `600`. Новые ночные файлы по-прежнему
  создаются `0644`, но внутри закрытого каталога; `umask 077` в начале
  `/usr/local/sbin/leaddrive-backup.sh` ещё не добавлен.
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
| перенос `restore.env` в менеджер паролей | секреты у владельца на Маке | владелец |
| Object Lock + default `COMPLIANCE` 14 дней | необратимо; включать в день commissioning | владелец, в ходе commissioning |
| lifecycle для `postgres/`, `runtime-files/`, `secrets/`, `logs/` | нужен вместе с Object Lock | commissioning |
| карта / cap хранения | финансовое решение | владелец (сумма выше) |
| `backup.env` на проде, таймеры, commissioning | изменение production; age-ключ офлайн | владелец через workflow `Commission production backup` |
| изолированное восстановление из B2 | в bucket нет бэкапов | после commissioning |

## Уточнение проверки перед запуском — Codex, 2026-10-19

Исторический результат `0 failure(s)` выше не является полным доказательством
ACL: исходный `expect_denied` засчитывал любой ненулевой exit code. На локальной
синтетике воспроизведены ложные PASS при сетевой ошибке, ExpiredToken,
SignatureDoesNotMatch и timeout. Исправленная проверка требует именно
`AccessDenied`; неизвестная причина теперь FAIL. Поэтому отказ записи restore
с пустым кодом нужно повторить исправленным скриптом, а не считать доказанным.
Реальные ключи и production в этой проверке не использовались.

## Уточнение живой проверки 2026-10-19 — A3

Повторный запуск исправленного verifier на Mac владельца подтвердил загрузку,
metadata/version id, побайтное скачивание и три явных `AccessDenied`. Отказ
`restore key upload` остался `unknown`; итог **1 failure**, а не доказанный ACL.
Object Lock вернул `ObjectLockConfigurationNotFoundError`. FileVault на новом
скриншоте уже On; прежний Off остаётся историческим наблюдением в журнале A3.

Для этого конкретного неизвестного отказа подготовлен отдельный
`scripts/backup/b2-restore-write-probe.py`: на Mac он читает только локальный
`restore.env` (owned, 0400/0600, без symlink/hardlink), принимает только B2 endpoint
согласованного региона и bucket `leaddrive-prod-backups`, делает два PutObject
со случайным телом 32 байта в новом synthetic prefix. Сравниваются AWS checksum
режимы `when_supported`/`when_required`. Объекты не удаляются; production archive,
writer credentials, bucket settings, retention и timers не затрагиваются.

Каждый вызов ограничен 45 секундами и 16 КиБ приватного stderr; при timeout
уничтожается группа процессов. Наружу выходит только фиксированная категория,
без raw ответа/ключей. Только exact `AccessDenied` от PutObject с exit254
считается таким отказом. Numeric403, checksum/сетевая ошибка, неизвестный формат
и неожиданно разрешённая запись остаются неуспехом. Это диагностический тест,
он не выдаёт commissioning/restore receipt и не снимает Object Lock gate.

```bash
python3 /path/to/reviewed/b2-restore-write-probe.py \
  "$HOME/leaddrive-b2-keys/restore.env"
```

Реальный результат этой узкой диагностики пока **NOT RUN**; гипотеза о различии
checksum режимов не является установленной причиной неизвестного отказа.
