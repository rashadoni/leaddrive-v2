# ISMS-04. Ввод резервного копирования в строй (закрытие F-09)

| | |
|---|---|
| Документ | ISMS-04 |
| Закрывает | План закрытия F-09 (P1) и F-36; на новом хосте контроль ещё не закрыт |
| Контроли | 8.13 «Резервное копирование», 8.24 «Криптография», 5.29, 5.30 |
| Исполнитель | владелец + инженер (дублёр) |
| Оценка | 1 день подготовки + учение 2–3 часа |
| Текущий production | `13.140.132.245` |
| Статус на 2026-09-05 | **NO-GO: автоматические PostgreSQL backup-и и Fund/event-platform cutover не сертифицированы** |

---

## 0. Текущий статус после переноса хоста — NO-GO

Read-only проверка нового production-хоста `13.140.132.245` выполнена
2026-09-05 workflow run
[`33960218044`](https://github.com/rashadrahimov/leaddrive-v2/actions/runs/33960218044)
на SHA `d94f648ccf39fd1080e2c5254124972a82f36c0e`. Проверка завершилась
`failure` и зафиксировала три машинных блокера, не раскрывая значения
`/etc/leaddrive/backup.env`:

| Проверка нового хоста | Факт на 2026-09-05 | Решение |
|---|---|---|
| Платформа | Ubuntu 24.04, x86_64 | Совместима с зафиксированным installer contract |
| Backup env, DB/restore роли и systemd contract | Файл ограничен по правам; обязательные поля заданы; scratch host/port отделён от source; service использует отдельного пользователя, canonical env и unit без drop-in | Предварительные статические проверки прошли |
| Public age recipient | Настроен, значение в журнал не выводилось | Само наличие recipient не доказывает существование или читаемость private identity |
| Шифрование PostgreSQL archive | `BACKUP_ENCRYPTION=off` | **STOP: новый архив может уйти открытым** |
| Инструменты | `age` и `aws` отсутствуют; Ubuntu candidate `age` — `1.1.1-1ubuntu0.24.04.3`, пакет `awscli` отсутствует | **STOP: ставить непроверенный/устаревший candidate нельзя; нужны pinned и проверенные binaries** |
| Backup timer | `loaded`, `enabled`, `active`; последний service result — `exit-code`, status `2` | **STOP: active timer не является доказательством работающего backup; до commissioning он должен оставаться выключенным** |
| Object Lock на фактическом bucket | Endpoint и credential-поля настроены, но live query не выполнился без AWS CLI | **NOT PROVED на новом хосте** |
| Offline signing trust | `BACKUP_OFFLINE_ALLOWED_SIGNERS` ещё не зарегистрирован; GitHub environment `production` не имеет required reviewers или deployment branch policy | **STOP: нет машинно проверяемого независимого подписанта и второго approval** |
| Две копии age identity | Принятого signed key-custody evidence для нового хоста нет | **STOP** |
| Зашифрованные DB + secrets + runtime candidates | Нет принятого host-bound evidence трёх exact object versions/ciphertext SHA-256 | **STOP** |
| Независимый restore + PII/runtime read | Нет подписанного доказательства decrypt трёх archives, внутренних checksums, isolated scratch restore, tenant/RLS canary, runtime inventory и чтения PII с восстановленным `TENANT_PII_MASTER_KEY` | **STOP** |
| Off-host recovery catalog/trust anchor | Нет exact COMPLIANCE-locked catalog version и независимого pinned signer trust root | **STOP** |
| Enterprise DR | Один bucket/provider/регион; нет WAL/PITR, full authority restore и application-consistent media recovery | **NO-GO для enterprise GA** |

`machine_ready=no` означает именно NO-GO, а не «backup временно менее удобен».
Обычный deploy, наличие старых объектов или `active` timer не закрывают этот
статус. До выполнения всех пунктов ниже нельзя считать F-09/F-36 закрытыми,
включать автоматические database/secrets/runtime timers или запускать необратимый
Fund/event-platform cutover. Даже после `machine_ready=yes` отдельное поле
`enterprise_ga_ready=no` остаётся NO-GO для corporate launch до закрытия
PITR/second-provider/full-authority/runtime-consistency gates.

### 0.1. Что требуется для снятия NO-GO

Все стадии должны выполняться из exact current `main` SHA, сериализоваться с
production deploy и оставлять PII-free evidence. Private age identity,
offline signing private key и восстановленные secrets запрещено передавать на
production, в GitHub Actions, репозиторий или журнал.

1. Зарегистрировать **публичный** Ed25519 signing key независимого оператора в
   `BACKUP_OFFLINE_ALLOWED_SIGNERS`; включить required reviewer и main-only
   deployment policy для GitHub environment `production`.
2. При выключенных трёх timers установить pinned `age` и AWS CLI, проверить их версии,
   hashes/signature, root ownership и versioned paths.
3. Отдельно прочитать обе offline-копии age identity, каждой расшифровать probe и
   подписать key-custody evidence зарегистрированным ключом второго оператора.
4. Переключить PostgreSQL backup на `age`, повторно доказать live Object Lock и
   оставить все timers выключенными.
5. Создать новые, относящиеся к `13.140.132.245`, зашифрованные candidates базы,
   recovery-set secrets и runtime media; связать каждый с exact object key,
   version ID, размером и ciphertext SHA-256.
6. На изолированной offline restore-машине скачать именно эти versions,
   расшифровать DB, secrets и runtime archives, проверить manifests/checksums,
   authority/RLS catalog и runtime inventory, выполнить scratch data restore и
   tenant canary, затем доказать чтение хотя
   бы одной реально зашифрованной PII-колонки ключом из восстановленного secrets
   snapshot.
7. Подписать PII-free archive-restore evidence независимым оператором, сохранить
   исходный signed bundle по неизменяемой ссылке и проверить подпись/все bindings
   при commissioning. Только отдельная стадия certification после этого может
   опубликовать immutable recovery catalog и включить все три timers.
8. Повторить read-only readiness. Закрытие допускается только при
   `machine_ready=yes`, успешных encrypted runs, трёх `enabled/active` timers
   и повторно проверяемом signed evidence для нового хоста.

Отсутствие второго человека, signer key, одной из копий, secrets/runtime archive или
PII-значения для контрольного чтения не разрешается заменять строкой
«подтверждено владельцем»: это остаётся явным blocker-ом.

## 0a. Историческое evidence старого хоста — не текущий production-контроль

Следующие факты были получены 2026-08-24/25 на прежнем production-хосте
`46.224.171.53`. Они сохраняются как incident/audit history, но **не переносятся**
на `13.140.132.245`: toolchain, env, systemd state, локальные markers и
возможность расшифровки должны быть доказаны заново на новом хосте.

На старом хосте журнал systemd подтверждал:

- таймер `leaddrive-postgres-backup.timer` — `active` и `enabled`;
- ночной прогон 2026-08-25 02:28 выполнил полный цикл: снятие source canary под
  ролью `leaddrive_backup` (NOSUPERUSER BYPASSRLS) → custom-format dump →
  выгрузка ролей и грантов **без хешей паролей** → восстановление в одноразовую
  scratch-БД → сверка canary → `restore canary passed` → шифрование offline age
  recipient → загрузка в `s3://leaddrive-prod-backups/postgres/daily/2026/08/` →
  проверка → Object Lock до 2026-09-10;
- недельный прогон 2026-08-24 02:19 заблокирован до 2026-10-26 — многоуровневое
  удержание работает.

Это исторически доказывало scratch restore дампа перед загрузкой, но не
расшифровку уже загруженного age archive и не восстановимость secrets. Поэтому
даже для старого хоста это evidence нельзя повышать до полного disaster-recovery
proof.

Реализация в репозитории: `scripts/backup/postgres-backup.sh`,
`scripts/backup/postgres-restore-canary.sh`, `scripts/backup/canary.sql`,
`scripts/backup/bootstrap-backup-role.sql`,
`scripts/backup/{snapshot-secrets,snapshot-runtime-files,verify-age-key-custody,verify-offline-backup}.sh`,
соответствующие три systemd service/timer пары и `docs/BACKUP_RUNBOOK.md`.

## 1. Первоначальная оценка F-09 на старом хосте

Этот раздел — хронология. Его формулировка была опровергнута расследованием в
разделе 1a и не описывает текущий production.

Этап 2 runbook выполнен наполовину: age-получатель существует и настроен на
сервере, копии шифруются. Но собственное условие Go/No-Go из runbook —

> «второй уполномоченный оператор может расшифровать тестовый архив без участия
> автора процедуры»

— **не выполнено**, и требование «сохранить private identity минимум в двух
независимых защищённых местах» тоже. Приватный ключ существует в одном
экземпляре у одного человека.

**Следствие.** Копии есть, они проверены, они защищены от удаления — и при
недоступности владельца не расшифровываются. Object Lock гарантирует, что архив
переживёт кого угодно; отсутствие второго экземпляра ключа гарантирует, что
прочитать его будет некому.

---

## 1a. Историческое расследование 2026-08-26 — раздел выше был мягче правды

Формулировка «приватный ключ существует в одном экземпляре» оказалась неверной в
худшую сторону: **приватного ключа не существовало вообще** (F-50). Поиск на
проде и на dev-боксе не нашёл ничего, владелец подтвердил. То есть ни один архив,
созданный до 2026-08-26, никогда не мог быть прочитан.

Не всплывало это потому, что ночная проверка говорила правду не о том:
`postgres-backup.sh` восстанавливает дамп в одноразовую базу и сверяет canary на
строке 218, а шифрует на строке 262. Расшифровкой не занимается ни один скрипт.
Проверялось качество дампа, а не читаемость архива. **«Копия сделана» и «копию
можно прочитать» — разные утверждения, и подтверждалось только первое.**

**Историческое состояние прежнего хоста на 2026-08-27:**

| Условие runbook | Состояние |
|---|---|
| Приватный ключ существует | ✅ создан 2026-08-26, в ОЗУ сервера, оттуда снят и стёрт (`shred`) |
| Ключ подходит к recipient на сервере | ✅ проверено расшифровкой вне сервера, сверка побайтно |
| Ключа нет на боевой машине | ✅ проверено поиском по значению: 0 файлов |
| Минимум два независимых места | 🟡 владелец сохранил на несколько внешних дисков 2026-08-27; **читаемость самих копий не подтверждена** |
| Учение: расшифровать реальный архив | ⛔ не проводилось никогда |
| Второй оператор может расшифровать | ⛔ не выполнено (владелец работает один) |

**Граница.** Всё, зашифрованное до 2026-08-26 17:14 UTC, нечитаемо навсегда, и
Object Lock не позволяет это даже удалить.

Из этой истории нельзя делать вывод, что identity или её копии доступны сейчас.
Файл на диске и рабочий ключ — разные вещи: копия может быть обрезана, оказаться
на том же failure domain или быть нечитаемой. Ручной probe ниже годится для
диагностики конкретной копии, но сам по себе не является принимаемым
commissioning evidence:

```
age -r <recipient с сервера> <<< "проверка" > /tmp/probe.age
age -d -i /Volumes/<ДИСК>/leaddrive-backup-identity.txt /tmp/probe.age
```

Вывод `проверка` означает только, что эта копия открыла этот probe. Для снятия
NO-GO обе копии проверяются отдельно, результат подписывает зарегистрированный
независимый оператор, а evidence связывается с exact recipient SHA-256 и UTC
timestamp.

## 2. Установить факт существования ключа — только offline

Наличие зашифрованных объектов **не доказывает существование private identity**:
для шифрования достаточно публичного recipient. Уполномоченный оператор должен
offline получить private identity (`AGE-SECRET-KEY-...`), вывести из неё
recipient и сверить его SHA-256 с reviewed recipient нового хоста. Сам private
key, его значение и точный recovery path в этот документ не вносятся.

Если приватная часть утрачена, все существующие архивы нечитаемы: тогда нужен
новый ключ (`age-keygen -o leaddrive-backup-identity.txt`), замена recipient в
`backup.env` и явная отметка, с какой даты старые архивы недоступны.

## 3. Разместить два экземпляра

Требование runbook — «минимум в двух независимых защищённых местах». Для
компании из пяти человек рабочая схема:

| Экземпляр | Где | Кто достаёт |
|---|---|---|
| 1 — рабочий | ваш менеджер паролей | владелец |
| 2 — аварийный | запечатанный конверт в запираемом месте в офисе | инженер (дублёр) |

Конверт подписывается и опечатывается так, чтобы **вскрытие нельзя было
скрыть**. Это и есть контроль: не запрет доступа, а невозможность
воспользоваться им незаметно. На конверте — дата, содержимое одной строкой, без
самого ключа.

Хранить оба экземпляра на одном ноутбуке или в одном облаке нельзя: это один
экземпляр с точки зрения отказа.

## 4. Настроить сервер

В `/etc/leaddrive/backup.env` внести **только публичный recipient**:

```
BACKUP_AGE_RECIPIENT=age1...
```

Проверить остальные обязательные переменные, которые требует скрипт:
`PGHOST`, `PGDATABASE`, `PGUSER`, `PGPASSFILE`, `BACKUP_EXPECTED_DB_ROLE`,
`BACKUP_S3_ENDPOINT`, `BACKUP_HEALTHCHECK_URL`.

Права на файл — только root. Перед включением timers пройти commissioning
разделы
`docs/BACKUP_RUNBOOK.md`, включая Object Lock и роль БД.

## 5. Первый запуск и включение timers — NO-GO на новом хосте

Исторический запуск прежнего хоста не удовлетворяет этому этапу. На
`13.140.132.245` последний зафиксированный service run завершился с exit status
`2`, при этом старый database timer оставался `enabled/active`. Это неисправное состояние, а не
успешный control.

### Только read-only справка

```
systemctl is-enabled leaddrive-postgres-backup.timer \
  leaddrive-secrets-snapshot.timer leaddrive-runtime-files-snapshot.timer
systemctl is-active leaddrive-postgres-backup.timer \
  leaddrive-secrets-snapshot.timer leaddrive-runtime-files-snapshot.timer
journalctl -u leaddrive-postgres-backup.service \
  -u leaddrive-secrets-snapshot.service \
  -u leaddrive-runtime-files-snapshot.service -n 100 --no-pager
```

Jobs запускать и timers включать **только** через reviewed four-stage workflow
после signed custody и независимого DB + secrets + runtime + RLS + PII drill.
Ручные `systemctl start/enable` запрещены: они обходят exact-main hash pins,
durable timer-state journal и evidence binding.

## 6. Учение с дублёром — то, ради чего всё делалось

Это и есть Go/No-Go из runbook и главное свидетельство для аудитора.

Условия: **вы не участвуете и не подсказываете**. Инженер работает сам, со
своим экземпляром ключа, по письменной инструкции.

Шаги для инженера:

1. вскрыть конверт, зафиксировать точные UTC date/time и evidence reference;
2. получить signed `candidate.env` и exact version IDs зашифрованных database,
   secrets и runtime snapshots, не выбирая объект по слову «latest»;
3. до расшифровки сверить три ciphertext SHA-256 с candidate;
4. скопировать inputs/helpers на отдельный encrypted/ephemeral scratch без
   reflink и расшифровать три staged объекта своим экземпляром age identity;
5. проверить внутренние manifests/checksums и наличие восстановленного
   `/etc/leaddrive/app.env` внутри secrets snapshot, не выводя его содержимое;
6. восстановить дамп в одноразовую scratch-БД **на отдельном offline host и
   loopback endpoint**, никогда не на production/source cluster;
7. сверить tenant canary и RLS/FORCE RLS catalog с database archive, проверить
   owner records ключевых таблиц и runtime file inventory;
8. **расшифровать хотя бы одну PII-колонку на восстановленной базе** ключом
   `TENANT_PII_MASTER_KEY` именно из восстановленного secrets snapshot (F-36).
   Шаги 1–7 доказывают, что дамп восстановится. Только этот шаг доказывает, что
   восстановленные данные читаемы;
9. сформировать и подписать PII-free evidence отдельным Ed25519 signing key.
   Evidence должно содержать hashes трёх ciphertexts, authority/runtime
   catalogs, candidate, recipient и manifests, результаты
   decrypt/checksum/scratch/tenant/RLS/PII checks, operator ID и UTC timestamp.
   `FULL_AUTHORITY_RESTORE_STATUS=not_tested` остаётся честным до отдельного
   superuser cluster drill; private keys, secret values, tenant IDs и PII в
   evidence запрещены;
10. certification публикует candidate/evidence/signature/allowlist как exact
    COMPLIANCE-locked recovery catalog. Его coordinates и signer public-key hash
    записываются также в независимый ISMS trust store.

После учения:

- ключ помещается в **новый** опечатанный конверт, старый уничтожается;
- signed bundle и recovery-catalog coordinates сохраняются в утверждённом
  независимом evidence/trust store, а в этот
  документ вносится только ссылка, digest, дата, исполнитель, результат, RTO и
  замечания;
- другой уполномоченный человек запускает certification и проверяет подпись;
  workflow actor не может одновременно считаться offline-оператором.

Время выполнения — это ваш фактический RTO для сценария потери данных. Его надо
знать числом, а не предполагать.

### 6.1. Отдельные enterprise gates

F-09/F-36 machine foundation и enterprise DR — разные решения. До
`enterprise_ga_ready=yes` запрещено обещать корпоративным клиентам 3-2-1,
cross-region или sub-dump RPO. Требуются: PostgreSQL WAL/PITR и watermark drill;
вторая immutable replica в другом provider/account/регионе; full restore
roles/owners/ACL/default privileges с reissued credentials; согласованная
DB/media generation с tombstone reconciliation; утверждённый recovery для
runtime operational state и root-only pgpass/CA. Детальная процедура и
классификация путей находятся в `docs/BACKUP_RUNBOOK.md`.

## 7. Что записать после закрытия

Внести в закрытую запись контроля (не в Git): владельца ключа и recovery path.
В `docs/BACKUP_RUNBOOK.md` и журнал ниже разрешено внести только PII-free
evidence reference/digest, host, exact candidate, дату учения, RTO, дату
следующего учения и условия ротации. Ни private identity, ни signing private key,
ни содержимое восстановленного secrets snapshot не коммитятся.

## 8. Журнал учений

| Дата | Исполнитель | Результат | Затраченное время | Замечания |
|---|---|---|---|---|
| 2026-08-24/25 | прежний production | Исторический partial pass | не зафиксировано | `46.224.171.53`: dump + scratch canary + upload/Object Lock; не является evidence нового хоста и не доказывает archive decrypt/secrets/PII |
| 2026-09-05 | GitHub Actions read-only diagnostic | **NO-GO** | < 1 мин | `13.140.132.245`, run `33960218044`: encryption off; `age`/`aws` отсутствуют; старый DB timer active при последнем exit status 2; DB/secrets/runtime candidates, operator/signed restore/catalog evidence отсутствуют |

---

## Приложение. Почему нельзя проще

Возражение «зачем конверт, если можно просто дать ключ инженеру» разбивается о
то, что ключ расшифровывает **все данные всех арендаторов**. Постоянный доступ
к ним у человека, который не работает с CRM, — это новый риск, который вы
создадите, закрывая старый. Опечатанный конверт даёт доступ тогда, когда он
нужен, и оставляет след, когда им воспользовались.


## Историческое отключение шифрования архива (решение владельца, 2026-08-28)

На прежнем release владелец принял решение выгружать архивы БД без шифрования;
там это было реализовано переключателем `BACKUP_ENCRYPTION`. В текущем reviewed
контуре plaintext/off upload удалён: поддерживается только `age`, любое другое
значение hard-fail до upload.

Эта запись сохраняет историю принятого риска на прежнем хосте. **Она не является
разрешением продолжать unencrypted backup после переноса** и не отменяет текущий
NO-GO: corporate/multi-tenant и Fund/event-platform cutover требуют `age` и
signed DB + secrets + runtime + RLS + PII recovery drill.

Запись сделана потому, что это **отключение контроля, а не изменение процедуры**.
Возражение было высказано до применения: архивы содержат данные клиентов, и в
таком виде их защищает только доступ к бакету. Решение подтверждено владельцем.

Что при этом НЕ меняется: Object Lock (COMPLIANCE, ≥14 дней) остаётся, проверка
размера и SHA-256 после загрузки остаётся, снимки секретов и логи по-прежнему
шифруются своими ключами.

Что меняется в оценке рисков: раньше утечка содержимого бакета означала набор
нечитаемых файлов, теперь — читаемую копию базы. Соответственно доступ к бакету
из второстепенного контроля становится основным.

Возврат к шифрованию на новом хосте выполняется только reviewed commissioning
stage после signed key-custody evidence; ручное удаление переменной не заменяет
проверку. Архивы, выгруженные за время действия старого решения, останутся
открытыми: Object Lock запрещает их перезапись.
