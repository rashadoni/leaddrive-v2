# Разделение кадрового списка и пользователей CRM

## 2026-10-21 — требование и исходное состояние

- Пользователь приложил экран Zeytun → Кадровый учёт → Сотрудники и потребовал: «пользователь срм не должен отображаться в разделе сотрудников». Исправляем состав списка: учётная запись CRM сама по себе не является кадровым добавлением. Сотрудник, созданный кадровиком, также имеет техническую CRM identity для входа в приложение, поэтому фильтр по наличию userId или CRM-роли неверен.
- Предыдущая задача E2E/Maestro не отменена. Её сохранённая точка — полный offline START→PAUSE→RESUME→FINISH на свободной реальной дате, до отключения сети. Журналы: `/home/codex-alt/.codex/worktrees/workforce-e2e-maestro/leaddrive-v2/docs/workforce-e2e-maestro-session-log.md` и `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-standalone/docs/attendance-standalone-session-log.md`.
- Причина: automatic participation создаёт технические EMPLOYEE cards для активных CRM users; список показывал все attendanceParticipant. Изменение касается чтения кадрового списка, не удаляет карточки/учётные записи и не меняет доступы, табели или факты отметок.
- Кадровое происхождение подтверждают прежняя ручная карточка (без даты automatic inclusion), явное CREATED/ENROLLED или записанный HR приём HIRE. Все audit lookup ограничены текущей компанией. Исключённые из учёта и уволенные кадровые сотрудники сохраняются в соответствующих фильтрах. Имя, заполненность должности и CRM-роль не служат критерием.

## 2026-10-21 — изоляция исправления и проверки

- Работа начата в прежнем recorded worktree; checkpoint `77540cc17` сохраняет код, тесты и историю решения. Для отдельного выпуска перенесены только восемь относящихся к исправлению файлов в `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/attendance-personnel-directory`, ветка `codex/attendance-personnel-directory`, от текущего `origin/main=fa5f42d7dbe21277594d3f9a994fcfacb38a6f17`. Старый worktree и история сохранены.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`. Production: `13.140.132.245:/opt/leaddrive-v2`; release через проверенный PR/main и `.github/workflows/deploy.yml`. Read-only public build-info сейчас совпадает с fa5f42d7d; прежний PR970 действительно merged в19b27d, но тот SHA не является текущей live версией. Его сопутствующие изменения не включаются в эту отдельную правку.
- Реализованы серверная фильтрация, пояснение на ru/az/en, UI-регрессия о том, что CRM users не попадают в строки/счётчики, PostgreSQL-регрессии для CRM-only/excluded/явного кадрового добавления, обновлён изолированный browser E2E fixture:54 явных сотрудника и3 CRM-only контрольных пользователя. В браузерный сценарий добавлена проверка отсутствия CRM администратора в поиске.
- На исходном worktree прошли3 targeted suite/44tests, i18n parity, синтаксис2E2E scripts и diff check. После переноса выполняются проверки текущего дерева заново. PostgreSQL/browser E2E и полный TypeScript пока NOT RUN: тяжёлые проверки разрешены только на GitHub CI или выделенном worker, локальный testDB не настроен. Проверки базы и браузера подготовлены, но не выдаются за пройденные.
- Новое разрешение на публикацию/merge/deploy этой правки ещё не получено. Ранее пользователь разрешил выпуск конкретного исправления «Объяснительных»; это не распространяется автоматически на новое изменение. Host contract требует разрешение активной задачи на push/merge/deploy. До вопроса о выпуске готовим проверенный локальный checkpoint.

## 2026-10-21 — локальное исправление готово к публикации

- В отдельном текущем дереве повторно выполнены3suite/44testsPASS; i18n parityPASS (en28081leafkeys, ru/az безпропусков илишнихключей), node--check обоихE2E scriptsPASS, staged diff--checkPASS. Node20.20.2; перед запуском RAM~16GBavailable, disk~151GB, memorypressure0.
- Передаваемое поведение: CRM-only identities не входят в «Сотрудники», поиск и счётчики; явные кадровые сотрудники остаются, включая excluded staff и пользователя с дополнительно выданной рольюCRMadmin. История/доступы/identity не изменяются, миграции не требуются.
- PostgreSQL regression и полный browserE2E/typecheck/build NOT RUN до разрешения на публикацию и CI. Новые код/тесты сохранены локально; production изменение ещё не применено. Требуется согласие на публикацию этого точного изменения и выпуск только после зелёных полных проверок.
- Текущий статус: исправление подготовлено и проверено targeted тестами. Последнее действие: повторная проверка изолированного дерева от currentmain. Точная остановка: передpush/PR/CI. Следующее действие после разрешения: опубликоватьветку, создатьPR, выполнить полныеCI/DB/browserпроверки, устранить найденное, затемmerge/deploy по штатномуworkflow и проверитьproduction.

## 2026-10-21 — выпуск разрешён

- Пользователь ответил на точный состав изменения: «Да, выпустить после всех проверок». Разрешены публикация этой ветки/PR, устранение найденных ошибок, merge только после полных зелёных CI/DB/browser gates и штатный GitHub Actions deploy с post-deploy проверкой. Повторное разрешение на этот состав не требуется.
- Продолжаем из checkpoint44c0edcab. Следующий шаг: push отдельнойветки, draftPR, готовностькпроверке послефинальнойсверкиscope, затемCI. Canonical checkout ипрежниеworktrees не меняются.

## 2026-10-21 — PR опубликован и проверки запущены

- Ветка опубликована, PR https://github.com/rashadoni/leaddrive-v2/pull/974 создан draft и затем переведён в ready после сверки девяти task-owned файлов. Проверяемый head: `48f954fd7d5299c0a4e2c34eb9c6831fdc42799b`.
- Полные PR checks: run `39652501133`; authenticated attendance browser/DB: run `39652501061`. Проверки выполняются на GitHub-hosted Linux; локальный тяжёлый запуск не используется. Все обязательные checks и реальный attendance E2E должны завершиться успешно до merge.
- Повторно сверены root/branch/origin, актуальные AGENTS.md, DELIVERY-ARCHITECTURE, registry и DEPLOYMENT: штатная цепочка PR → main → GitHub Actions → `13.140.132.245:/opt/leaddrive-v2`. Разрешение пользователя действует; новый вопрос о выпуске не требуется.

## 2026-10-21 — промежуточные результаты CI

- В PR checks `39652501133` этап MTM attendance database gate завершён SUCCESS, как и MTM workday return. Это реальный PostgreSQL прогон, включающий изменённый employees regression suite. Браузерный прогон ещё выполняется.
- Required typecheck job `119404572999` завершён SUCCESS по действующему baseline gate: 64 gated pairs совпадают с baseline, новых defect-shaped ошибок нет. Это не чистый `tsc`: compiler exit 2, всего 1332 существующих диагностик. Политика не ослаблялась; сборка проверяется отдельным CI job. Runner policy и secret scan также SUCCESS.

- На 18:40 UTC: десять из тринадцати последних workflow завершились SUCCESS; ещё выполняются PR checks (общий unit baseline), Attendance authenticated E2E и HRM exact-head production build. HRM tenant UI/database job уже SUCCESS. Выпуск/merge ещё не выполнялись.

## 2026-10-21 — все PR gates завершены, PR974 merged

- Все13 последних PR workflow завершились SUCCESS на head `48f954fd7d5299c0a4e2c34eb9c6831fdc42799b`; пять required contexts проверены как SUCCESS от github-actions. Старые cancelled draft runs не использованы как доказательство.
- PostgreSQL attendance:10 suites /184 tests PASS, включая32 employees tests. Полный unit baseline gate PASS:18 ранее известных failing files, без новых; это не чистый прогон всего репозитория.
- Authenticated E2E run `39652501061`:65 PASS,0 FAIL,5 явно NOT RUN (physical APK permissions, external delivery, camera/offline replay, overnight soak, exhaustive combinations). Эти отдельные сценарии не требуются для правки roster и не выдаются за выполненные. Состав списка, исключение CRM-only и поиск подтверждены реальным HTTP/DB/browser. Исходно54 HR сотрудника; после явного HIRE контрольного outside —55.
- Exact-head production build/HRM UI run `39652500908` SUCCESS:1041 pages generated. Просмотрен реальный снимок `employees-ru.png` из E2E artifact12371151377, сохранённый в `/mnt/HC_Volume_106454338/codex-alt-data/tmp/attendance-personnel-974-e2e`. Это тестовая компания, не визуальное доказательство Zeytun.
- За время CI main продвинулся до `cb86d7ea0c43e05ee214e70c09ce27fd53662e85` (PR973 голосовой бюджет демо). Проверен diff: с нашей правкой не пересекается, изменения release workflow только в комментариях. Правила branch protection сохранены.
- По ранее полученному разрешению PR974 merged штатным GitHub merge с expected head: merge SHA `de44f2a3325dbdc9a89e5fe14b266010cd84dff4`. Следующее действие: дождаться штатного deploy и проверить ping/build-info на зарегистрированном production.

## 2026-10-21 — штатный production workflow выполняется

- Deploy run `39655768277` относится к merge SHA `de44f2a3325dbdc9a89e5fe14b266010cd84dff4`. Родители merge проверены: текущий main `cb86d7ea0` и проверенный head `48f954fd7`; чужие изменения сохранены. Сборка ждала штатную очередь предыдущего run39653976118 и началась к18:56UTC. Прямого deploy/копирования не было.
- Подготовлен read-only post-deploy smoke на существующей строго проверенной fictional phone company через `https://app.leaddrivecrm.org`: до выпуска GET employees возвращает2 технических CRM identity, у обеих есть automatic inclusion date и нет employment events. Sanitized before receipt сохранён приватно как `personnel-roster-before.json`; credentials/cookies в журнал не копируются. После совпадения build-info проверяем исчезновение этих CRM-only записей и сохранение mobile bootstrap access.
- До полного окончания deploy результат не объявляется выпущенным; рабочие пользовательские/кадровые данные не изменяются.
