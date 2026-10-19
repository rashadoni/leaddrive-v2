# A3 — резервные копии и доказуемое восстановление

Дата подготовки: 2026-10-19 (Asia/Baku). База: main
`226dde0e77c0c36a4de991bb703ba8f8416c5a64`. **A3 OPEN / recovery NOT PROVED.**
Это пакет подготовки, не commissioning и не разрешение на activation.
Общую поставку координирует сессия «Проверить защиту Kafka-консюмера».

## Три разных уровня доказательств

| Уровень | Достаточное evidence | Что не доказывает |
|---|---|---|
| Реализация | Reviewed SHA скриптов и тесты защит | Наличие свежего backup или доступного ключа |
| Backup | Успешный run, время source snapshot, exact object version/size/ciphertext SHA-256, проверенный retention | Decrypt, восстановление после потери host/account |
| Recovery | Независимый exact-version download, decrypt, checksums, isolated restore, сверка данных/RLS/PII/runtime и проверенная подпись | PITR/full authority/host-loss, если они отдельно не испытаны |

## Ограниченная подготовка и существующие проверки

Не менять commissioning/verifier и их pinned hashes ради нового чеклиста.
Использовать [BACKUP_RUNBOOK](../BACKUP_RUNBOOK.md) и текущие reviewed helpers:

| Контроль | Реализация | Обязательное доказательство оператора |
|---|---|---|
| Шифрование | `postgres-backup.sh`, secrets/runtime snapshot; offline age | Реальный encrypted run и decrypt каждой exact version; две читаемые независимые копии identity, без private keys на production/Actions |
| Независимость | Object Lock и version-bound recovery catalog | Provider/account/region/failure-domain inventory; credentials и signer trust root доступны независимо от host и bucket. Один bucket не является off-provider copy |
| Scratch | `postgres-restore-canary.sh`, `verify-offline-backup.sh` | Другой system identifier и endpoint; disposable/encrypted storage; loopback для offline drill; NOSUPERUSER CREATEDB; cleanup подтверждён. Наличие scratch/pgpass/CA недостаточно |
| Целостность | Ciphertext SHA до decrypt, внутренние manifests/checksums, source/restored canary, migration ledger, RLS/FORCE RLS, PII proof | Полный успешный receipt именно этих bytes, exact candidate/main/helper binding; никакие PII/секреты не публикуются |
| Регулярность | `report-production-readiness.sh` | Свежий полный отчёт и реальные успешные service runs. Успех diagnostic job сам по себе не означает machine_ready=yes |

Малые проверки подготовки: `node --test scripts/backup/pgpass-contract.test.mjs`,
`node --test scripts/backup/libpq-pgpass.test.mjs`,
`node --test scripts/backup/object-lock-diagnostic.test.mjs`,
`node scripts/ci/test-event-platform-assets.mjs`, `bash -n` backup helpers.
Запускать последовательно после проверки ресурсов. Они не обращаются к реальному
backup как доказательству восстановления и не закрывают recovery gate.

## Приёмка Farah Rahimova — ожидается, не заменяется Codex

Названный проверяющий — Farah Rahimova. Фактическое согласие, полномочия,
независимость и signer principal ещё должны быть подтверждены; имя в документе
не является назначением ключа, подписью или approval. Не создавать от её имени
receipt, signing key, synthetic success либо запись «подтверждено».

Перед separately authorized drill оператор предоставляет Farah PII-free пакет:

1. Reviewed main/helper SHA, candidate digest и время, точные immutable object
   versions, hashes, sizes, retention horizons и ссылки на исходные receipts.
2. Карту отказов source/scratch/storage/key custody; отдельный публичный signer
   trust anchor, pinned вне storage account. Private keys остаются у хранителей.
3. Результат независимого скачивания/decrypt и восстановления с canary,
   migrations, RLS/PII/runtime проверками, уничтожением scratch и измеренными
   snapshot/restore timestamps, RPO/RTO и ограничениями scope.
4. Подписанный bundle существующего verifier. Проверить detached signature,
   зарегистрированный principal, отличие от requester/исполнителя, exact SHA и
   freshness по runbook. Строка OFFLINE_OPERATOR сама не доказывает личность.
5. Собственное решение Farah с датой, scope, ссылкой/digest проверенного bundle,
   перечнем исключений и approve/reject. Техническая подпись другого оператора
   не заменяет её решение; её решение без успешного drill не заменяет recovery.

До получения обоих видов evidence статус independent confirmation — **PENDING**.
Никаких сообщений Farah из этой задачи не отправлено.

## Незакрытые границы

- PostgreSQL logical dump не доказывает WAL/PITR; RPO нельзя объявлять меньше
  измеренного интервала между пригодными recovery points.
- Canary с no-owner/no-privileges не доказывает full roles/owners/ACL restore;
  `FULL_AUTHORITY_RESTORE_STATUS=not_tested` сохраняется до отдельного DBA drill.
- Нужны независимая immutable replica, operational-state/credential authority,
  согласованность DB/media, hydration capsule и signed log cursor discontinuity
  для host-loss; v3 catalog сам по себе replacement host не восстанавливает.
- Kafka archive/offset reconciliation и all-module recovery не доказаны этими
  PostgreSQL helpers. Не менять offsets и не запускать replay для проверки A3.

Следующий шаг координатора: оценить свежий read-only report, согласовать
конкретные недостающие prerequisites и отдельный изолированный drill с Farah.
В этой задаче backup/restore/commissioning/timer activation не запускаются.

## Свежая read-only проверка — 2026-10-19 00:26 Asia/Baku

[Run 39163236284](https://github.com/rashadoni/leaddrive-v2/actions/runs/39163236284)
на exact main выше: **failure**, `machine_ready=no enterprise_ga_ready=no
issues=24 enterprise_gaps=9 operator_attestation_required=yes`.

- Шифрование PostgreSQL backup **explicitly off**. Pinned age 1.3.2 и AWS
  CLI 2.36.40 присутствуют; public recipient принимает encryption, но это не
  доказывает decrypt/private-key custody.
- Passfiles читаются service user, CA permissions проходят; scratch host/port
  отделён от source. Authentication, system identity и фактический restore
  этим отчётом не проверялись.
- Live recovery units расходятся с running artifact; runtime-files timer
  `not-found`, три остальных `disabled/inactive`. Fresh successful runs и
  MemorySwapMax=0 не подтверждены для всех четырёх jobs.
- Genesis anchor/evidence roots отсутствуют либо небезопасны; plaintext runtime
  workspace отсутствует/не tmpfs. Точная причина в каждой группе не установлена.
- Live Object Lock query: `unknown_failure`. Не объявлять bucket unlocked,
  credentials неверными или провайдера недоступным без отдельной диагностики.
- PITR/full authority/off-provider copy и прочие перечисленные DR gates open.

Эти 24/9 заменяют старые 23/9 только для текущего readiness snapshot. Отчёт не
доказывает отсутствия всех возможных backup и не выполняет restore.

При проверке обнаружены устаревшие инструкции ISMS-04 про три timers и
включение при certification; в этом PR они исправлены: текущий runbook требует четыре timers и отдельную normal-deploy
activation ceremony. Обязательный GitHub independent review в setup/stop conditions runbook также
исправлен согласно актуальному `docs/DEPLOYMENT.md`: required reviewers сняты. Не возвращать GitHub reviewer gate в рамках A3;
независимый recovery signer и решение Farah остаются отдельными требованиями.

## Обновление A3 — 2026-10-19 12:25 Asia/Baku

Ранний запрет на commissioning в этой задаче superseded последующим явным
разрешением владельца и одобрением отдельного ограниченного
[owner-operated режима](A3_OWNER_OPERATED_RECOVERY_PROPOSAL.md).
Это подготовка разовой зашифрованной копии и технического scratch drill;
независимый Farah/two-offline/enterprise gate не заменён. Владелец отдельно
выбрал оставить доставку исходной сессии «Проверить защиту Kafka-консюмера»;
её удержание main/runtime остаётся в силе.

| Уровень доказательства | Фактическое состояние |
|---|---|
| Код backup/restore | Отдельный owner namespace, exact-main/signature/hash/version binding, source/scratch identity и полный data verifier; наличие кода не означает backup |
| Проверка ключа | Mac random canary PASS, private identity не передавалась в production/Actions; fresh main-bound commissioning receipt ещё NOT RUN |
| Scratch-инструменты | Mac ARM64 networkless PostgreSQL/pinned age/no-swap positive+negative PASS; FileVault latest On |
| B2 передача тестовых байтов | Multipart writer/HEAD/byte-identical restore GET PASS, это синтетика |
| Restore write ACL | Peer PR913 сообщает curl controls PASS на1e3ccaf70: PUT200/GET200 и restore PUT403/AccessDenied; AWS CLI255/connection_closed остаётся отдельным неуспехом |
| Bucket retention | Peer UI сообщает Object Lock Enabled/default14Days; API COMPLIANCE и retention точных версий не подтверждены |
| Production readiness | Последний shared report39214985498 наfbfae3961: machine_ready=no,25issues/9gaps; canonical encryption off, endpoint/units/workspace gaps |
| Реальная зашифрованная копия | NOT RUN этой сессией |
| Реальный isolated restore | NOT RUN; нет archive restore receipt, измеренного RPO/RTO или PITR proof |
| Farah Rahimova | Согласие/полномочия/независимый signer/её решение не получены; не подменять owner proof |
| Две offline media | Не выполнено; Mac/один USB/online administrative copy не переименованы в две независимые offline copies |

Наff9cc4188 прошли type/runner/scan/scope,13 реальных synthetic owner tests,
профильные maintenance tests, hosted PG password-file и tenant проверки.
Static job39218257966 завершилась CANCELLED по подтверждённому лимиту30min;
даже сообщение baseline о PASS не делает отменённый required check успешным.
Подготовлен ограниченный бюджет45min без изменения тестов/условий baseline;
полная проверка нового SHA ещё обязательна. Build A3 scope-SKIPPED/NOT RUN.

Статус A3: **OPEN/NO-GO**. Следующий шаг исходного координатора: принять
финальные source checks, снять согласованный hold, подтвердить private writer
configuration/API COMPLIANCE, затем выполнить fresh owner proof, одну
зашифрованную копию и реальный scratch restore. Kafka/offsets/replay не менять.
