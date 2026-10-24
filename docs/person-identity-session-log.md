# Единая учётная запись, Time и Route & Field — журнал

## 2026-10-24 — требование и порядок работы

Владелец обнаружил ошибку занятости номера при добавлении офисного сотрудника после изменения номера пользователя CRM. На экране подтверждено сообщение конфликта; конкретная запись-владелец в production пока не установлена. Сохранённая браузерная сессия API недействительна, разрешённый SSH alias не авторизовал read-only подключение. Нельзя утверждать, что номер точно остался у Тогрула, или менять данные догадкой.

Владелец принял: один человек — одна учётная запись и номер для входа, независимые доступы к Time и Route & Field; пользователь CRM/агент не становится кадровым сотрудником автоматически. Порядок: сначала архитектура, затем аудит, затем критика, затем сообщить конечный вариант и после этого начинать работу. Повторное согласование самой разработки не требуется; отдельного разрешения на выпуск нового auth/security поведения пока нет. Не начинать runtime edits до представления итоговой архитектуры.

Работа выделена из crm-time-app-download в чистый worktree /mnt/HC_Volume_106454338/codex-alt-data/worktrees/crm-person-identity, codex/person-identity, origin https://github.com/rashadoni/leaddrive-v2.git, от актуального main/deployed 6a755bb2329d2f4ff9a1cc9dc2bf5b7900507376. Production: зарегистрированный 13.140.132.245:/opt/leaddrive-v2; выпуск через reviewed PR/main → GitHub Actions immutable artifact, без ручных изменений сервера.

Текущий этап: исходный аудит схемы/User/MtmAgent, OTP/password/session, кадрового создания и enrollment, уникальности номера, триггеров. Production изменения, новые OTP/сообщения и переключение аккаунтов не выполнялись. Работа не использует телефон: отдельная суточная приёмка Time1046 продолжает владеть UIlock и тестовой сетью.

## 2026-10-24 — архитектура, аудит и самокритика завершены до runtime edits

В docs/person-identity-architecture.md сохранены исходная гипотеза, source audit, девять пунктов самокритики, исправленная архитектура B, переходные ограничения и матрица приёмки. Выявлены двойные phone/password, авто-provision технических карточек, общий поиск номера, несовместимость AGENT с явным HR enrollment и общий workday unique. Production-владелец номера не установлен. Не называем source audit независимым review или production-тестом.

Итоговый вариант показан владельцу в чате до кода: каноническая User личность внутри tenant, независимые CRM/Time/Field grants, один login phone claim, явное кадровое/полевое членство, отдельные Time workday и FieldSession, сохранение истории и offline owner. По последнему указанию «и потом начинай работать» начат этап 0: чистый offline preflight снимка, без сетевого/DB доступа и без изменения поведения приложений. Следующие этапы требуют CI/DB/physical gates; security rollout ещё не разрешён отдельно.

## 2026-10-24 — этап 0 реализован и проверен

Добавлены scripts/identity/preflight.mjs, preflight.test.mjs и README. Это отдельный Node20 offline inventory checker: принимает строго ограниченный JSON через stdin, без DB/network/записи, запрещает лишние поля и raw credentials. Выводит только коды проблем, счётчики и позиции строк исходного снимка, не телефоны/имена/ID. Нормализует только явный international формат; национальные номера не угадывает. Распознаёт stale User/Agent phones, кандидаты duplicate claim, cross-tenant/orphan/multiple links, отсутствие canonical account, два источника credentials, active actor при отключённом User, несовместимость field role и attendance. Нулевой список проблем никогда не означает productionVerified/migrationAuthorized.

До проверки: Node20.20.2, availableRAM13679MiB, свободный диск124GB, memoryPSI0. Последовательно выполнен node --test scripts/identity/preflight.test.mjs:16 PASS,0 FAIL,0 SKIP (~0.39s); включая изоляцию tenant, старый номер после изменения CRM, orphan/cross-tenant links, сохранение входного снимка, CLI privacy, invalid/oversized input и запрет credentials. git diff --check PASS. Enum roles/statuses сверены с текущей Prisma schema. Полный build/tsc/browserE2E/Android/productionDB inventory/CI NOT RUN: изменён standalone Node checker, runtime/schema не менялись; heavy gates предназначены для CI, разрешения на новый auth push/deploy пока нет; live snapshot отсутствует. Это не fix production login и не завершение этапов1–5.

Результат: требуемая последовательность архитектура→аудит→самокритика→итоговый вариант соблюдена, первый код начат после представления решения. Документы checkpoint c48db1fc7 сохранены до кода. Следующее: read-only exporter согласованного tenant snapshot с устойчивой транзакцией и preview конфликтов; затем additive identity/grant/claim schema и shadow comparison. Перед production переносом нужны реальная инвентаризация, разрешение security rollout и все gates из архитектуры. Точная остановка — offline preflight проверен на синтетических сценариях, ни один рабочий номер/аккаунт/grant не изменён.

Основная приёмка Time остаётся отдельной задачей с текущим controller1046-v2 и deadline25Oct21:01:16Баку. Эта работа не открывала телефон, не меняла APK/permissions/queue/network и не запускала параллельный Maestro.
