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

- Quality & security gates production run39655768277 завершён SUCCESS (job119415470360): PostgreSQL attendance184/184, employees32/32, общий unit baseline18 без новых failing files. Сборка перешла к Next standalone; main всё ещё `de44f2a3325dbdc9a89e5fe14b266010cd84dff4`. Точка ожидания: сборка → штатная выкладка → подготовленный read-only smoke.

- Production build job119415470995 завершился SUCCESS. Артефакт `leaddrive-prod-de44f2a3325dbdc9a89e5fe14b266010cd84dff4` размером473936873bytes создан штатным workflow, доставлен в production; job119430788916 перешёл к atomic deploy. Post-deploy smoke ещё не завершён.

## 2026-10-21 — выпущено и проверено на production

- Deploy workflow https://github.com/rashadoni/leaddrive-v2/actions/runs/39655768277 полностью завершился SUCCESS, включая production smoke и retention cleanup. Выпущен merge SHA `de44f2a3325dbdc9a89e5fe14b266010cd84dff4`.
- На `https://app.leaddrivecrm.org` и `https://zeytun.leaddrivecrm.org` ping200/ok и public build-info точно совпали с release SHA.
- Read-only authenticated smoke существующей fictional phone company: до выпуска2 CRM-only записи в employees; после0. Все3 CRM users сохранены; mobile bootstrap прежнего EMPLOYEE успешно работает. HR/personnel данных не изменяли. Sanitized receipt: `/mnt/HC_Volume_106454338/codex-alt-data/tmp/mtm-maestro-device-20261021/personnel-roster-after-sanitized.json`.
- Первое выполнение smoke helper остановилось до авторизации на публичном ping: Python urllib получил403; повторная проверка документированным curl transport дала200 на обоих доменах, после адаптации helper полный smoke PASS. Это ошибка транспорта первого probe, не провал приложения, и она не скрывается.
- Кадровая правка завершена: CRM-only accounts больше не входят в список/поиск/счётчики, явно добавленные HR сотрудники сохраняются по проверенным DB/E2E сценариям. Визуальная проверка реального Zeytun под пользовательской сессией NOT RUN: такой browser session здесь не подключён; deployment SHA и функциональный smoke проверены на общем рабочем сервере через тестовую компанию.
- Следующая часть исходной задачи: возврат к незавершённому полному Maestro offline циклу; сохранённая точка перед реальной свободной датой22октября Asia/Baku (не ранее20:00UTC21октября). Сначала read-only проверка телефона и guard, без подмены времени или новых кадровых записей.

## 2026-10-21 — исходная физическая offline-приёмка завершена

- После успешного production выпуска кадровой правки продолжена исходная задача на отдельном приложении. На реальной дате22октября Asia/Baku полный Maestro START → PAUSE → RESUME → FINISH без интернета, с перезапусками, PASS70.36с. Backend до/после соответствует выпущенному SHA de44f2a3325dbdc9a89e5fe14b266010cd84dff4. На сервере0 новых событий до подключения, затем ровно4 с исходным временем; независимая кадровая проверка VALID, дублей нет. Никакой подмены времени/часового пояса/политик.
- Исходный тестовый аккаунт, сеть и разрешения восстановлены; обе тестовые истории и10заявок сохранены. Mobile evidence checkpoint91cfa78 опубликован в существующей draftPR196, без mobile main merge или публичного выпуска. Полный журнал: /mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-standalone/docs/attendance-standalone-session-log.md. Отчёт: /mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-standalone/docs/evidence/attendance-fresh-day-full-cycle-20261022.json.
- Прежняя точка ожидания наступления реальной даты закрыта этим выполнением. Реальный GPS на площадке и24hphysicalsoak остаются NOT RUN; положительная короткая последовательность не подменяет эти проверки.
- Итог кадровой задачи: исправление выпущено PR974, штатный deploy и функциональный production smoke PASS. Последнее действие: сохранены результаты отдельной физической приёмки. Точная остановка: серверный release завершён, дополнительного deploy для журнала не требуется. Следующее действие: отдельная проверка геолокации после наличия реальной площадки и утверждённой политики; текущий выпуск от неё не зависит.


## 2026-10-22 — развитие по утверждённому плану T01/T02/T17/T03/T06/T04

- Пользователь поручил начать работу и сохранять план. Полныйbacklogисамокритикасохраненывmobileworktree docs/attendance-standalone-session-log.md. T02/T03перваяреализацияужеcheckpoint e05307b/5a924d2,целевые66/79проверокPASS; новыйruntimeнеустановлен,старый1019продолжает24hтест.
- CRMпродолжаетсявэтомrecordedworktree/branch codex/attendance-personnel-directory,originrashadoni/leaddrive-v2. ПрочитаныAGENTS/DEPLOYMENT/clientsregistry,подтверждён13.140.132.245:/opt/leaddrive-v2,Actionsmain. Чистоедеревосодержалотолько5локальныхcheckpointдокументацииповерхпрошлоговыпуска. Выполненобычныйmergeактуальногоorigin/main96c08c4e6,безконфликтов;чужиеизменениянепереписывались.
- Safety-laneпланT17:узкийGETсобственныхотметок,scopedtenant+employee+workday,explicitDTO,историческийGPSтолькопосвоимSTART/FINISH;breakprivacy,действующиеpermissionsиexactAPIallowlist. Толькоread,безновыхтаблиц,безгеолокационныхизмерений. Проверкиauth/другойtenant/чужойдень/выключенныйдоступ/неизвестныйGPS/ошибки/приватныйcacheконтроль.
- T06:доработатьсуществующийToday/очередь,свежестьданныхиконтексткоррекции;T04использоватьсуществующиенастройкиикарточкуготовности. Необъявлятьпустые/неполученныеданныеготовностьюилипрогулом.
- Разрешениенаproductionвыпускпрежнегоrosterfixнепереноситсяавтоматическиновымсервернымфункциям. Сначалаполнаяреализация/проверки/конкретныйобзор;новыйdeployневыполнялся.


### 2026-10-22 — T17, собственные отметки сотрудника

- Начат согласованный этап развития по запросу «начинай работу, запиши план». Полный backlog T01–T17 и порядок находятся в docs/attendance-standalone-session-log.md рабочего дерева mtm-attendance-standalone. Здесь серверная часть T17/T06/T04.
- История согласована с origin/main 96c08c4e6 обычным merge f51566db3 без конфликтов; прежние записи и checkpoint сохранены. Routing: эта папка attendance-personnel-directory, codex/attendance-personnel-directory, origin rashadoni/leaddrive-v2, production 13.140.132.245:/opt/leaddrive-v2, выпуск через reviewed main / GitHub Actions.
- T17: новый read-only GET /api/v2/mtm/mobile/route-field/attendance/marks?workdayId=... возвращает только свои исторические START/FINISH GPS/QR, времена и текущие количества кадровых проверок. Сначала requireAttendanceSelf, затем scoped day и tenant-scoped joins; no-store, private error, лимит 64, RepeatableRead. Секреты, установка, чужие сведения и GPS перерывов не выдаются.
- 3 узких suites / 58 tests PASS. Добавлены настоящие PostgreSQL assertions в существующий location-postgres suite: неизменяемое название филиала, собственные координаты, чужой сотрудник/tenant, QR без токена. PostgreSQL / полный TS / build / browser E2E NOT RUN: тяжёлые проверки должны выполняться в CI. Новые миграции не требуются. Production не менялся.
- Далее T06: существующая очередь получает контекст коррекции и время загрузки. Затем T04: фактическая подготовка сотрудника, с явными неизвестными данными.


### 2026-10-22 — T06/T04 и сквозные проверки первого пакета

- T06: существующая очередь заявок теперь показывает для TIME_CORRECTION факты на момент подачи рядом с предложенными датами/временем, отличает отсутствующий день от старой заявки без снимка, указывает часовой пояс и ведёт к текущему дню сотрудника в табеле. Время загрузки списка не выдаётся за время последнего серверного события. Права/решения/версионная защита не менялись; нового параллельного workflow нет.
- T04: в уже авторизованную RepeatableRead-карточку сотрудника добавлена проекция подготовки: данные для входа, действующий тип графика на сегодня, последняя версия основного филиала и текущие (последние на установку) одобрения/ожидающие запросы. Отзыв и новый запрос не оставляют старое одобрение в счётчике. Телефон и настоящий email равно допустимы; технический @invalid.local не считается контактом. Новых таблиц и фиктивных отметок нет.
- Интерфейс не утверждает, что приглашение доставлено или текущий телефон работает. Подготовка — фактические настройки на указанную дату; первый вход/допуск проверяются на устройстве. Участие и необязательное одобрение показаны отдельно, без ложного общего зелёного статуса. Полный процесс приглашений и многоэтапные согласования не входят в этот пакет.
- Проверки: 65 tests / 3 suites PASS (подготовка, карточка, очередь коррекций), 50 tests / 2 suites PASS (own marks и свежая mobile auth с GET marks), ранее employees API входит в 46 PASS; эти числа пересекаются, не суммировать как уникальные. Targeted ESLint 9 production paths PASS, повтор изменённых preparation-файлов PASS. npm run i18n:check PASS (AZ/RU/EN). git diff --check и node --check browser harness PASS.
- Настоящие PostgreSQL assertions добавлены в действующие suites: свой GPS/QR, чужой сотрудник/tenant, подготовка без workday и новый запрос после отзыва. Browser E2E дополнен собственными marks, подготовкой в карточке, реальной коррекцией из mobile HTTP, сравнением в браузере кадровика и возвратом отказа сотруднику. Это подготовленные, но ещё NOT RUN gates; полный PostgreSQL/browser E2E/build/TypeScript запрещено запускать на Contabo, нужны GitHub CI/worker.
- Ограничение приёмки: мобильная физическая проверка новой версии будет после окончания уже идущего реального суточного теста 1019. Не подменять её прежними PASS. Новый deploy не выполнялся; перед публикацией/выпуском нового пакета требуется разрешение активной задачи по пользовательскому правилу хоста.
- Текущий статус: первый пакет реализован и проверен узко. Последнее действие: уточнён email-вход, добавлены сквозные проверки и завершена локальная верификация. Точная точка остановки: checkpoint до публикации ветки. Следующее действие: hosted gates после разрешения публикации, затем проверяемый поэтапный выпуск.
