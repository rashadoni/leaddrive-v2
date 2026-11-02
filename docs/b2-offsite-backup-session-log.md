# Журнал сессии: офсайт-бэкапы LeadDrive в Backblaze B2

Только дописывать. Время — UTC.

Сессия Claude, worktree `.claude/worktrees/leaddrive-backblaze-b2-backups-426412`,
ветка `claude/leaddrive-backblaze-b2-backups-426412` от `origin/main` `226dde0e7`.
Журнал Kafka-сессии (`docs/kafka-infrastructure-readiness-session-log.md` в ветке
`codex/kafka-infrastructure-readiness`, PR #893) не трогался: это чужой worktree с
живой сессией, а её файлы с этой работой не пересекаются.

## 2026-10-18 22:00 — разведка

- `AGENTS.md`, `docs/BACKUP_RUNBOOK.md`, `ops/backup/backup.env.example`,
  `scripts/backup/*` прочитаны. Пайплайн: age + S3 Object Lock COMPLIANCE, тиры
  16/63/400 дней, отдельные потоки БД, секретов, runtime-файлов, логов;
  commissioning только через workflow `Commission production backup`.
- Прод (только чтение): работает один `leaddrive-daily-backup.timer` — `pg_dump`
  + tgz `/etc/leaddrive`, rsync на dev-бокс. Пайплайн из runbook не
  коммиссионирован; в `backup.env` нет `BACKUP_S3_*`. `aws` 2.36.40 и `age` есть.
  Исходящий трафик не ограничен, `s3.eu-central-003.backblazeb2.com` доступен.
- Объём: БД 480 МБ, дамп 43,1 МБ (+0,35 МБ/сутки), `uploads` 75 МБ (+57 МБ/мес),
  `help-videos` 267 МБ, логи ~50 МБ.
- Находка: `/var/backups/leaddrive` 0755, дампы и tgz секретов 0644 — читаемы
  любым локальным пользователем прода. Не исправлялось (прод вне границ).
- Находка: `uploads`/`help-videos` не бэкапит ни один работающий механизм.

## 2026-10-18 22:10 — аккаунт B2 через Chrome владельца

- Доступ к браузеру есть, владелец вошёл. Регион EU Central, 2FA включена,
  способа оплаты нет, все caps $0 (10 ГБ / 1 ГБ в сутки / 2 500 транзакций B и C).
  Buckets нет, ключей кроме master нет. Ничего платного не подключалось.

## 2026-10-18 22:20 — bucket

- Создан `leaddrive-prod-backups` (`f41e6de91ed35b1aa41e011e`): Private, SSE-B2,
  keep all versions, Object Lock выключен (включается позже, необратимо — отложено
  до commissioning, расчёт в `docs/B2_OFFSITE_BACKUP.md`).
- Синтетика через консоль: два файла по 65 КБ без клиентских данных. SHA1 второго
  (детерминированного) в B2 совпал с посчитанным на dev-боксе. Шифрование файла
  `AES256 (SSE-B2)`. Анонимный GET по обоим адресам → 401.
- Lifecycle: правило только для префикса `leaddrive-b2-synthetic-check` (1 + 1 день).

## 2026-10-18 22:40 — ключи

- Веб-консоль даёт только rw/ro/wo; нужный writer (без delete, с retention) — только
  через API master-ключом. Ключи не созданы: секрет показывается один раз, а эта
  сессия секреты не принимает. Написаны `scripts/backup/b2-create-backup-keys.py`
  (создание, секреты только в 0600-файлы) и `scripts/backup/b2-verify-backup-keys.sh`
  (синтетический round-trip + проверка запретов). Логика проверочного скрипта
  прогнана на заглушке `aws`: 7 PASS, секреты в выводе не встречаются.

## 2026-10-18 22:50 — совместимость пайплайна

- Три гейта требовали endpoint Hetzner (`server-deploy.sh`,
  `commission-production-backup.sh`, `report-production-readiness.sh`). Владелец:
  «хетзнера нет больше» — теперь принимается только endpoint B2 своего региона.
- `node --test scripts/backup/object-storage-endpoint.test.mjs` — 4/4;
  `object-lock-diagnostic.test.mjs` — 12/12; vitest по 20 файлам, читающим эти
  скрипты, — 100/100; `test-event-platform-assets.mjs` — OK;
  `check-github-runner-policy.mjs` — OK; `bash -n` всех трёх скриптов — OK.
- `BACKUP_RUNBOOK.md` и `backup.env.example` переведены с Hetzner на B2.

## 2026-10-19 00:40 — первый заход владельца

- Владелец выполнил на Маке `ssh prod "chmod 700 /var/backups/leaddrive && chmod 600 /var/backups/leaddrive/*"`.
  Проверено по SSH (только чтение): каталог `700`, 42 файла `600`.
- Запуск скриптов ключей из `~` на Маке упал «No such file or directory»: на Маке
  нет клона репозитория, а команды в отчёте были с относительными путями. Ключи не
  созданы. Инструкция в `docs/B2_OFFSITE_BACKUP.md` переписана: скрипты
  скачиваются с GitHub по коммиту `0920de2c7` (sha256 сверены с файлами в ветке),
  все пути абсолютные.

## 2026-10-19 00:43 — ключи созданы владельцем

- Владелец сгенерировал новый master key и запустил `b2-create-backup-keys.py` на
  Маке (первая попытка — чужая строка в поле key ID, `401 bad_auth_token`).
- Созданы `leaddrive-prod-backup-writer` (`0034ed9e3ba4e1e0000000001`) и
  `leaddrive-prod-backup-restore` (`0034ed9e3ba4e1e0000000002`), оба только на
  `leaddrive-prod-backups`, без срока. Права в консоли B2 сверены и совпадают с
  задуманными: ни `deleteFiles`, ни `bypassGovernance`. Секреты — в
  `~/leaddrive-b2-keys/{writer,restore}.env` (0600) на Маке; сессия их не видела.
- Подсказка «Next:» в скрипте печатала относительный путь — теперь путь рядом со
  скриптом.

## 2026-10-19 00:49 — проверка ключей

- Владелец поставил `awscli` 2.38.1 (Homebrew) и запустил
  `b2-verify-backup-keys.sh` на Маке. Итог `RESULT: 0 failure(s)`:
  - multipart-загрузка 9 МиБ writer'ом — PASS, контрольные суммы AWS CLI по
    умолчанию B2 принимает (`when_required` не нужен);
  - `head-object` writer'ом: размер, sha256-метаданные, version id — PASS;
  - скачивание restore-ключом побайтно совпало — PASS;
  - writer: удаление версии и листинг — `AccessDenied`, PASS;
  - restore: удаление — `AccessDenied`, запись — отклонена, но код ошибки пустой
    (скрипт не поймал S3-код; отказ есть, причина не зафиксирована);
  - объект на месте после попыток удаления — PASS.
- Object Lock не настроен (`ObjectLockConfigurationNotFoundError`) — как задумано.
- Синтетический объект `leaddrive-b2-synthetic-check/20261018T224905Z-1423031217.bin`
  уберёт lifecycle-правило.

## 2026-10-19 — Codex launch review (separate branch)
- Owner asked to begin review/launch prerequisites after Claude report. Read PR899 exact59ca827200365ec1dccda354e4311fe8aa371f36. Original no-merge/deploy/production-mutation limits remain; no financial authorization inferred.
- Current origin/main4212600260f5ed28b9c2b73e28c363a0fc7d39f3 fetched. Registered production13.140.132.245:/opt/leaddrive-v2, release GitHub Actions main. Existing Kafka branch and Claude worktree preserved. Review branch codex/b2-backup-launch-review in separate managed worktree.
- PR899 draft: pr-scope/runner-policy/scan/postgres-integration PASS; static-checks/typecheck/build/pgpass-contract SKIPPED, not passed. PR body key-creation TODO is stale relative to final docs and owner receipts.
- Before targeted checks: available RAM13.8GiB, disk195GiB free, memory pressure avg10/60=0. No install/build planned.
- Reproduced four false-positive ACL receipts in expect_denied: network error, ExpiredToken, SignatureDoesNotMatch, timeout. Baseline regression2/6 pass, four fail as expected. Fixed to require explicit AccessDenied; no raw stderr/credentials printed. Added six-case behavioral regression.
- Browser/account/secret access absent in this remote session. No live B2 call, production mutation, Object Lock activation, billing change, merge/deploy or recovery performed. Cost cap remains zero per Claude historical receipt; free10GB is bounded by estimated3–4weeks, not sustainable recovery acceptance.
- PASS after fix: denial regression6/6 (including no raw stderr leakage); endpoint/Object Lock tests16/16; bash syntax; diff-check. Added regression to existing required static-checks step. Full typecheck/build NOT RUN locally: no TS/application changes and Contabo workload rule; full GitHub code gates still required before merge. Real key negative permission retest, account budget decision, offline age custody/signed evidence, Object Lock and default retention, production config/timers and isolated restore remain NOT RUN/BLOCKED by missing access/authorization/evidence.
