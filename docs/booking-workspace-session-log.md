# Единый раздел встреч — журнал сессии

## 2026-10-24 — Запрос и начало архитектурной проработки

- Пользователь не нашёл новый раздел онлайн-записи, разработанный Claude.
  Установлено: `Продажи → Онлайн-запись`, путь `/settings/booking`.
- Затем пользователь спросил, куда попадают записи. По реализации создаются
  Booking, лид и задача ответственному; календарь и уведомления выполняются
  отдельно. Скриншот показывает клиентское подтверждение, но не доказывает
  успешное создание связанной задачи или лида.
- Подтверждён разрыв навигации: `/tasks` убран из бокового меню; доски
  фильтруют задачи по подразделению, которого у задачи бронирования нет.
  В настройках онлайн-записи показывается счётчик, но нет журнала встреч.
- Требование пользователя: «думаю его надо как то переделать так как чтоб не
  бегал между разделами». Уточнение: «продумай архитектуру».
- Текущий объём: архитектурный документ и UX-бриф. Реализация, публикация,
  изменение production-данных и отправка сообщений не выполняются.
- Исходный checkout `/home/codex-alt/projects/leaddrive-v2` грязный, ветка
  `fix/reply-matrix-ai-agent-label`; чужие изменения сохранены.
- Документы готовятся в отдельном worktree
  `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-booking-workspace-architecture-20261024`,
  ветка `codex/booking-workspace-architecture-20261024`, база
  `64356065f3878a547bdd5fa87cbf9f789f1f92a2` из свежего `origin/main`.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`. Актуальные
  `AGENTS.md`, `docs/DEPLOYMENT.md` и registry подтверждают production
  `13.140.132.245:/opt/leaddrive-v2` и выпуск через GitHub Actions из main.
- Применяются навыки impeccable и shape для контекста и UX-брифа.
  Существующий `.impeccable.md` задаёт оболочку LeadDrive; специфичные решения
  для встреч оформляются как предложение, не как уже подтверждённый дизайн.
- Следующий шаг: проверить модель данных, права, побочные действия и
  существующую инфраструктуру фоновой обработки; подготовить единый рабочий
  сценарий и этапы безопасного перехода.

## 2026-10-24 — Архитектурный черновик и запрос критического аудита

- Дополнительное требование пользователя: «и после сделай еще критичный аудит».
- Создан `docs/booking-workspace-architecture.md`: один раздел `/meetings`,
  чтение Booking напрямую, список/календарь, панель встречи, страницы записи.
- Предложены версии, идемпотентные команды, сохранённая история, snapshots,
  tenant/own/team права, явные статусы интеграций и возобновляемый worker.
- Подтверждены по исходникам: частичные сбои afterBooking; повторная запись
  после потери ответа; отсутствие надёжного восстановления отмены; различие
  sales-навигации и settings-авторизации; отсутствие исторических snapshots;
  свободное время при ошибке Google; утрата старого buffer между страницами.
- Existing EffectOutbox пригоден как основа, но booking-worker и внешние
  адаптеры ещё необходимо реализовать. Массив post-commit callbacks не является
  долговечной очередью. Kafka не принят как зависимость нового раздела.
- Сценарий «координатор — команда, сотрудник — свои» вынесен вопросом;
  пока используется как отмеченное допущение без выдачи новых прав.
- Архитектура передана отдельному агенту для критического разбора уже готового
  предложения; это отдельная фаза после исследования текущего кода.
- Проверки на этом этапе: только docs diff; кодовые/DB/browser/build проверки
  NOT RUN — код не изменялся, архитектурные свойства ещё не реализованы.
- Следующий шаг: получить замечания, исправить противоречия и сохранить
  отдельный аудит с остаточными рисками и критериями будущей проверки.

## 2026-10-24 — Критический аудит и исправление архитектуры

- Пользователь явно подтвердил сценарий: «Координатор видит встречи команды,
  сотрудник — свои». Модель больше не считается предположением.
- Первый независимый проход нашёл 5 P1 и 3 P2 в черновике `16d80e8fe`.
  Исправлены: Google free/busy без ID, сериализация повторов и recovery secret,
  bootstrap aggregate versions, wildcard RBAC, идентичность старого/нового
  календарного ресурса, ledger retry semantics, удаление Task-зеркала, TTL секрета.
- Повторный независимый проход подтвердил учёт этих восьми пунктов и нашёл
  ещё P1/P2: общие проверки не должны запрещать cancel/outcome после закрытия
  страницы; Google preflight должен идти вне DB locks. Оба пункта уточнены.
- Всего 6 P1 + 4 P2 к предложению, P0 в рамках анализа не обнаружены.
  Это изменения документа, не исправления действующей CRM.
- Создан отдельный `docs/booking-workspace-critical-audit.md`: для каждого
  замечания указан сценарий отказа, источник, изменение плана и будущий gate.
- Официальные Google Freebusy/Events list contracts сверены чтением документации.
  Доступы реальных Google-подключений и данные production не проверялись.
- Team-доступ определён через явные BookingCoordinatorGrant, не через
  произвольное User.department/BoardPermission. Смена ответственного сохраняет
  старую и новую calendar binding до сверки; оба решения включены в документ.
- Пользователю представлен готовый UX-бриф и отправлен отдельный запрос его
  подтверждения согласно shape. Подтверждение модели команды уже получено;
  подтверждение названия/композиции на момент записи этого пункта ещё ожидается.
- Реализация остаётся за границей текущей задачи. Первый следующий рабочий этап
  — A: журнал Booking, карточка, права и единая навигация; B/C требуют описанных
  интеграционных и миграционных gates, но не блокируют проектирование этапа A.

## 2026-10-24 — Подтверждение владельца и остановка на документации

- Пользователь ответил на полный UX-бриф: «Да, зафиксировать этот вариант».
  Согласованы название/расположение «Продажи → Встречи и запись», список/календарь,
  действия внутри карточки и вкладка страниц записи. Предыдущая запись об
  ожидании подтверждения выше теперь устарела; она сохранена для истории.
- Документы обновлены как согласованная концепция. Код, БД и production не
  менялись. Push/PR/merge/deploy в этой архитектурной задаче не выполнялись.
- Перед финальной docs-проверкой: RAM available 13916 MiB, свободно 130443 MiB,
  memory PSI avg10/60/300 = 0.00. Выполняется только `git diff --check`.
- Кодовые тесты, PostgreSQL integration, browser, i18n и build — NOT RUN:
  изменена только документация, новых кодовых свойств ещё нет для проверки.
- Итоговый результат: согласованная архитектура и отдельный критический аудит
  с 10 разобранными замечаниями. Точка остановки: документы подготовлены,
  реализация этапа A не начата. Следующее действие: по запросу перейти к этапу A.
- Финальная проверка всех трёх task-owned документов:
  `git diff --cached --check` — PASS. Черновик сохранён checkpoint `16d80e8fe`;
  исправления после аудита и согласование сохраняются отдельным следующим
  checkpoint-коммитом в той же ветке.

## 2026-10-24 — Продолжение до реализации

- Пользователь потребовал доводить работу до конца без остановок перед каждым
  следующим этапом и отчитаться в конце. Продолжается согласованный единый
  раздел встреч, а не новый цикл проектирования/подтверждений.
- Возобновлён сохранённый worktree/ветка, checkpoint `9162f6ea1`; рабочее дерево
  перед продолжением чистое. `codex-project-context` подтвердил ту же маршрутизацию.
- Порядок реализации: единый журнал/карточка/календарь и страницы записи,
  серверная область own/team/org, затем команды и связанные проверки надёжности.
  Логические единицы сохраняются checkpoint-коммитами; тяжёлые gates — в CI.
- Согласованные название, расположение, модель команды и UX повторно не спрашиваются.

## 2026-10-24 — Первый рабочий слой раздела встреч

- Реализованы `/meetings`, список с серверной пагинацией, календарь с полными
  дневными счётчиками и отдельной пагинированной повесткой дня, панель встречи.
- Страницы записи перенесены в компонент того же раздела; старый URL сохранён
  как redirect. Уведомления новых броней ведут в карточку встречи.
- Добавлены session-only scope bookings, собственная/командная/tenant область,
  явные BookingCoordinatorGrant и администраторский интерфейс выдачи/отзыва.
  Wildcard viewer/reviewer и API-key principals не обходят эту границу.
- Добавлена расширяющая миграция grants и индексов; существующие встречи и
  права сотрудников миграция не переписывает. Переводы AZ/RU/EN синхронны.
- Проверки: Prisma validate PASS (с фиктивным URL, без подключения к БД);
  targeted access/notification tests 134/134 PASS; translation parity 28560
  ключей, missing=0/extra=0 PASS. Scoped ESLint первоначально обнаружил
  set-state-in-effect; экран переведён на существующий TanStack Query.
- Полный compiler/build/PostgreSQL/browser на этой точке NOT RUN; тяжёлые
  проверки будут на CI. Следующая работа: команды в карточке и проверки
  транзакций, повторов, интеграций и старых записей, затем browser-проверка.

## 2026-10-24 — Команды, история и сохраняемая обработка

- Добавлены ручная запись, перенос/смена принимающего, отмена, результат и
  исправление результата внутри панели встречи. Запросы получают стабильный
  idempotency key; публичное подтверждение защищено отдельным recovery secret.
- Добавлены Booking.version, snapshots, encrypted response/delivery storage,
  calendar bindings, чувствительные пояснения отдельно от immutable events.
  События и intents записываются атомарно с Booking через существующую platform.
- Уточнение реализации относительно первичного плана: старые строки остаются
  явно неадаптированными с version=0; первая команда атомарно создаёт import
  baseline + head, затем изменение. Это не выдаётся за исходное создание и не
  требует массового backfill перед появлением журнала. Старые отсутствующие
  связи Lead/Task автоматически не дублируются.
- Добавлен bounded worker, cron registration, независимые CRM/Google/email/push
  intents, истечение response payload, сохранность активных delivery secrets.
  UNKNOWN не повторяется автоматически; operator script использует отдельную
  DB identity и evidence, по умолчанию работает как dry-run. Скрипт не запускался.
- Task-зеркала защищены DB trigger для всех writers. Новый host FK и связи
  новых моделей tenant-aware; миграции расширяющие и транзакционные, конфликты
  старых интервалов/ссылок должны остановить gate вместо изменения данных.
- Доступ к чужому host проверяется до внешнего calendar call; отключённый Sales
  закрывает новые публичные записи. Закрытие формы не препятствует отмене.
- Реальные PG-тесты расширяются потерей ответа, параллельным replay, командами,
  RLS под непривилегированной ролью, UNKNOWN и операторской сверкой. Они ещё
  NOT RUN на этой точке; full build/typecheck также NOT RUN на Contabo.
- Локально targeted tests 146/146 PASS (7 files): доступ, request identity,
  cross-page buffers, identity-aware Google intervals и notification taxonomy.
  Prisma validate после добавления note relation потребовал composite unique;
  он добавлен, последующая проверка PASS. Scoped ESLint выявил ненужную ручную
  memoization; она убрана без отключения правила, финальная проверка идёт.
- Следующая работа: завершить PG/browser evidence, исправить найденное в
  проверках, checkpoint, затем полный compiler/DB/build на разрешённом CI.

## 2026-10-24 — Завершение интерфейса и проверка в браузере

- Добавлена самостоятельная последующая задача через существующую форму задач
  поверх карточки. Это сохраняет обязательные поля/настройки организации;
  задача не становится зеркалом и не меняет Booking.version. Уточнён UX-документ.
- Исправлены найденные при проверке расхождения: snapshot на странице отмены,
  восстановление подтверждения после закрытия формы, повторная загрузка context,
  обновление часов/календаря, сброс редактора после изменения версии встречи.
- Согласованы поисковые условия списка/календаря; тест PG теперь проверяет
  211 строк без потерь на пагинации и полный дневной счётчик.
- Уточнён tenant-aware FK страницы и фиксированный search_path task guard.
  Исправлен выбор Google account: standalone google-calendar имеет приоритет
  перед SSO google; внешняя занятость читается с запасом на перерывы у границ дня.
- Браузер: реальный BookingWorkspace в изолированном Vite harness, mocked API,
  только синтетические данные. PASS: список, календарь, detail, перенос/отмена/
  результат, ручная запись, обычная задача, страницы, grants, восстановление
  после ошибки context; 1440/390px, светлая/тёмная тема, без horizontal overflow
  и runtime errors. Это component proof, не production/authenticated E2E.
- Evidence: docs/booking-workspace/evidence/*.png и browser-result.json.
  Скриншоты desktop detail/mobile calendar просмотрены непосредственно.
- Последние targeted unit checks: 7 файлов, 146/146 PASS; Prisma validate PASS
  после composite page FK. Полные compiler/build и реальные PG пока NOT RUN;
  далее запускаются на GitHub-hosted Linux, не на persistent Contabo host.
- Root/branch/origin подтверждены codex-project-context; production остаётся
  13.140.132.245:/opt/leaddrive-v2, релиз только reviewed main → GitHub Actions.
- Draft PR #1023 создан и прикреплён к чату. Дальше: checkpoint, hosted gates,
  исправление реальных замечаний и заключительный критический аудит.
- Финальная UI-проверка также собирает console errors, не только pageerror:
  обнаружены отсутствовавшие во всех локалях booking.saving; ключ добавлен
  AZ/RU/EN. Повтор после исправления PASS без console/page errors.
- Кнопкам раздела/карточки задана минимальная высота 44px; проверены Tab внутри
  панели и закрытие Escape. Vite остановлен после финального browser run.
- Последние scoped ESLint, translation parity (28611 keys) и diff whitespace
  проходят; source code готов к внешним gates. Полный build запрашивается
  через штатную метку production-build на PR, без запуска на Contabo.

## 2026-10-24 — Финальный критический разбор, второй проход

- Replay ручной записи теперь повторно проверяет текущий scope/grant; staff
  response не раскрывает customer cancel capability. Добавлен реальный PG-сценарий
  создания → replay → отзыв grant → запрет повторного replay.
- Identity завершается после полученного успеха; потеря/ошибка ответа сохраняет
  ту же попытку. Targeted suite после изменения: 147/147 PASS.
- Обнаружена граница client cache истории: ключ не включал identity/privacy.
  Она добавлена и проверена на реальном компоненте: смена пользователя с общим
  QueryClient и скрытыми телефонами не показывает предыдущий note. Browser PASS.
- В booking выделена типизированная граница generated PrismaClient поверх
  существующего RLS proxy; runtime-клиент и transaction injection сохранены.
- Read-only inventory production не выполнен: штатный leaddrive-prod alias
  указывает на разрешённый 13.140.132.245, но сервер отверг public key.
  Другие credentials/retired targets не использовались; production не менялся.
- Отдельный implementation audit фиксирует UI 17/20, исправленные дефекты,
  release gate по production inventory и остаточные P2/P3 без ложного PASS.
- Hosted run 40084671778 на a5ea772d0 ещё выполняется; локальные исправления
  второго прохода будут проверены следующим exact-SHA запуском, а не выданы
  за проверенные старым run.

## 2026-10-24 — Первый полный CI и исправления

- Run 40084671778 / a5ea772d0: production standalone build PASS.
  PostgreSQL gate FAIL из-за uuid=text в raw lock effect_outbox; UUID cast
  добавлен. Fixture 211 cancelled rows исправлен: cancelledAt обязателен.
- Typecheck завершился полностью; defect gate FAIL на двух новых парах:
  тест навигации не задавал plan, staff create передавал unknown attribution.
  Контракты исправлены, host reassignment использует проверяемый relation connect.
  Baselines и обязательные gates не менялись и не ослаблялись.
- Расширен DB guard источника истины: deferred trigger проверяет финальные
  Booking/head и факты события; canonical update требует новой версии, новые
  version=0 записи от старого writer не могут коммититься. Legacy reads остаются
  доступны; первая команда адаптирует их в общей транзакции.
- PostgreSQL proof теперь применяет полностью оригинальную online-booking
  миграцию и обе реальные forward-миграции в пустой scratch DB. Извлечение
  отдельных фрагментов DDL заменено проверкой реального пути обновления.
  Legacy fixtures явно представляют pre-cutover rows, только в scratch.
- Эти изменения после первого run ещё не подтверждены им; сохраняется новый
  checkpoint и запускается следующий exact-SHA CI.

## 2026-10-24 — Второй DB-прогон и завершение совместимости

- ebb907b5a / run 40086178208: реальный PG — 18/19 PASS, включая полные forward
  миграции, deferred Booking/head guard, foreign projection rejection, own/team,
  concurrent create/replay/cancel/reschedule, legacy import и FORCE RLS.
- Единственное красное ожидание требовало cleanup сразу после operator decision,
  хотя заблокированный pending intent отложен до следующей минуты. Тест теперь
  моделирует наступивший cron tick через availableAt pending intent; UNKNOWN
  attempt остаётся terminal и не повторяется.
- Важная поправка миграции: старые buffer поля нельзя сбрасывать в ноль. Новые
  поля заполняются из текущего известного page.bufferMinutes; это derived
  legacy metadata, не восстановленная историческая настройка. Тест сохраняет
  настоящую pre-migration строку и проверяет перерыв после forward upgrade.
- All-day Google interval без достоверной зоны теперь fail-closed; добавлен
  тест. Targeted unit: 148/148 PASS. После успешного effect очищается старый
  transient lastError, чтобы UI не показывал ложное внимание к завершённой работе.
- Implementation audit прямо фиксирует production NO-GO: нет production inventory
  из-за штатного SSH publickey denial, а cutover требует совместимого rollback
  artifact и дренирования старого writer. Эти gates не заменены зелёным UI/build.
- Текущий source готов к следующему CI checkpoint; ожидание exact-SHA compiler
  второго run продолжается, чтобы исправить его фактические замечания вместе.
- Run 40086178208 / ebb907b5a: production build PASS, typecheck gate PASS.
  Полный compiler log дополнительно просмотрен: diagnostics для booking,
  book routes, booking-pages и booking tests отсутствуют. Исторический baseline
  остального проекта не расширялся.
- Исправлена семантика outcome после Google reconnect: прошедшая completed/
  no_show встреча сохраняет desired state исторических bindings вместо удаления
  события из-за нового preferred account. Добавлен настоящий PG-сценарий.
- Проверки последнего source: scoped ESLint/diff PASS; targeted unit 148/148 PASS.
  Следующий checkpoint закрывает тест следующего cron tick, legacy buffer,
  неизвестную all-day timezone, transient error UI и сохранность календарной истории.

## 2026-10-24 — Полный прогон 6cfcf3c65 и связанные регрессии

- Run 40087646771: production standalone build PASS, typecheck gate PASS,
  реальный booking PostgreSQL — 21/21 PASS. Все последующие database gates
  также прошли. Secret scan, runner policy и pr-scope PASS.
- Общий baseline gate нашёл 4 новых красных файла: module-catalog MAP drift,
  raw PrismaClient в operator script и два coverage-теста голосового помощника
  после переименования settings_booking → meetings. Baseline не изменён.
- Исправлены реальные зависимости: backfill MAP зеркалит permission alias,
  голосовой справочник описывает новое рабочее место. Voice aggregates явно
  pending: generic tenant-wide reader не получает обход own/team BookingAccess.
- Operator script использует общий makeScriptPrisma с явными orgId и operator
  URL; новая override-возможность запрещает отсутствие tenant scope и не меняет
  web DATABASE_URL. Отдельный unit proof проверяет connection_limit=1, tenant
  GUC, отсутствие bypass и неизменность web connection; настоящего подключения нет.
- Проверены 4 ранее падавших файла + новый scope test: 57/57 PASS. В сумме с
  последними 148/148 booking/notification tests — 205 targeted tests в 12 файлах.
  Scoped lint, JS syntax и diff whitespace PASS. Новый exact-SHA полный run нужен
  после checkpoint этих исправлений; предыдущий красный gate не обходится.

## 2026-10-24 11:40 UTC — Итог реализации и критического аудита

- Финальный проверенный source/remote head:
  91dd1edc2a3fbe889e42ecc1477760dcdeb645fa.
- GitHub run 40089486704 / PR checks #3106: pr-scope, static-checks,
  typecheck и production standalone build PASS. Отдельные runner policy
  40089486918 и secret scan 40089486797 на том же SHA PASS.
- Настоящий booking PostgreSQL: 21/21 PASS. Общий unit baseline gate PASS:
  ровно прежние 18 failing files, новых нет; baseline не менялся.
- Targeted checks: 148 основной контур + 57 проверки связанных registry/RLS
  зависимостей = 205/205 PASS в 12 файлах. Финальный compiler log проверен:
  diagnostics для booking/book routes/booking-pages/tests/_rls отсутствуют.
- UI fixture browser proof с реальными компонентами PASS; scope и ограничения
  описаны в evidence/README.md. Production/authenticated E2E, live Google/email/
  push и production migration NOT RUN; они не подменяются fixture proof.
- PR #1023 обновлён итоговым описанием и всеми validation references, затем
  возвращён в draft. Exact source head подтверждён ответом GitHub, не изменён.
  PR прикреплён к чату. Merge/deploy не выполнялись; production не изменён.
- Архитектура и реализация подготовлены; implementation audit 17/20 по
  проверенному UI. Release NO-GO: I-01 — production data inventory не выполнен
  из-за штатного SSH publickey denial; I-05 — нужен совместимый rollback artifact
  и проверенный cutover со старого writer. Нельзя выдавать старый main за
  совместимый rollback или снимать DB guard ради выпуска.
- Этот завершающий docs-only checkpoint сохраняется в task worktree локально
  без нового push: source 91dd1edc2 и его зелёные exact-SHA checks остаются
  неизменными. Финальные результаты также опубликованы в PR body.
- Точная остановка: проверенный код в draft PR, перед production preflight и
  подготовкой/согласованием безопасного release cutover. Следующее действие:
  восстановить штатную возможность read-only inventory, проверить старые данные,
  подготовить совместимый rollback/cutover; только затем допускать релиз по
  документированному main → GitHub Actions маршруту.

## 2026-10-24 — Продолжение подготовки выпуска по «начинай»

- Пользователь поручил продолжить с сохранённой точки без промежуточных согласований.
- Штатный SSH повторно отклонён по publickey; credential/authorized_keys изменения не выполнялись. Public build-info подтверждает работающий artifactSha `64356065f3878a547bdd5fa87cbf9f789f1f92a2`, а не feature source.
- Для получения inventory без выкладки feature создан отдельный clean-main worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-booking-release-preflight-20261024`, branch `codex/booking-release-preflight-20261024`, PR https://github.com/rashadoni/leaddrive-v2/pull/1024 (прикреплён к чату).
- Инструмент использует существующий protected Actions SSH route, exact source/deployed SHA, read-only libpq/SQL, timeouts, allowlisted aggregate evidence и проверку неотфильтрованной RLS identity. Нет изменения данных/провайдерских отправок.
- CI source-validation `40092136260` на `303b6905c525bfb726e5b2307dae8a0f477cecfd`: 8/8 PASS, включая SQL на disposable PostgreSQL16, конфликты и реальный запрет INSERT в read-only transaction. Первоначальная ошибка подключения fixture исправлена, gate не ослаблен.
- Full required checks PR #1024 ещё выполняются; инструмент пока не в main и inventory не запускался. PR #1023 остаётся draft/NO-GO, feature source и его exact-SHA CI не менялись.
- Подробный append-only журнал продолжения: `docs/booking-release-preflight-session-log.md` в новом worktree. План A/B: `docs/booking-release-cutover-plan.md`; это план, не реализованный cutover/controller или готовый rollback artifact.

## 2026-10-24 12:29 UTC — I-01 закрыт фактической production inventory

- PR #1024 принят squash только после всех пяти required GitHub checks и дополнительного PostgreSQL source-validation PASS. Main SHA `cb1c604e274d75cfde10534b94978ce293f8f121`; feature #1023 не merged.
- Explicit main dispatch `40094038543`, production-inventory job `120872601701`: SUCCESS через штатный protected Actions SSH (локальный SSH ключ не менялся).
- Sanitized artifact `12560530704`, digest `sha256:a68bc4f8b0771f5c7ce560c07aa9f14fc8facc0c894a62492d2dea8bf95b7033`; копия результата `docs/booking-workspace/evidence/production-inventory-20261024.json`.
- Наблюдение `2026-10-24T12:29:14.599Z`, deployed artifact `64356065f3878a547bdd5fa87cbf9f789f1f92a2`: 2 Booking; host/page/task/lead связи корректны; duplicate Task, пересечения и неверные интервалы — 0; отсутствующие Task/Lead — 0; btree_gist установлен; роль BYPASSRLS, транзакция READ ONLY.
- I-01 закрыт для этого наблюдения. Перед фактической миграцией повторяется свежая проверка; результат не означает разрешения изменять/чинить данные.
- Автоматический deploy инструментального main запущен run `40094028286`; пока checks/build in progress, новой версии приложения на production ещё не подтверждено. Старые customer Booking не изменялись, провайдерские отправки не делались.
- Следующая фаза: реализовать совместимый backend A с отложенной строгой проверкой legacy writer, admission/rollback защитой и отдельным включением UI B. I-05 остаётся открытым до проверенного кода, а не только плана A/B.

## 2026-10-24 — Начата исполняемая подготовка совместимого backend A

- Новый task-owned worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-booking-backend-compatibility-20261024`, branch `codex/booking-backend-compatibility-20261024`; объединён с current main `cb1c604e274d75cfde10534b94978ce293f8f121`. Origin/production/release route прежние, canonical checkout не трогается.
- Уточнение плана A/B: A защищает положительные canonical версии, но сохраняет совместимость version=0 в первоначальном расширении; B отдельной миграцией запрещает legacy writer целиком. Положительную версию нельзя понизить до 0. Новый UI у A скрыт, backend понимает полный контракт B. До применения миграций production обе версии SQL можно разделять; после применения переписывать их нельзя.
- Admission должен отвергать pre-A retained recovery после расширения схемы, даже если canonicalCount=0 (защита от гонки). Внутренний auto-rollback первого A может вернуть legacy только после остановки нового writer и доказательства отсутствия canonical записей/строгого B guard. После canonical write — только backend A/B, иначе fail-closed.
- Эти условия ещё реализуются/проверяются. До их PASS I-05 остаётся открыт, пользовательский feature release не разрешён.

## 2026-10-24 — Backend A: разделение схемы и сценариев проверки

- Подготовлены immutable phase `compatibility`, скрытие workspace A с сохранением прежнего редактора страниц записи и навигации. Метка «Встречи и запись» для B вынесена в отдельный ключ nav (предыдущий source менял только navDesc).
- Expand SQL допускает никогда не канонизированные version=0, защищает положительные версии/их Task mirrors и отвергает downgrade. Строгий B guard пока только CI fixture, не production migration.
- PostgreSQL acceptance расширен: сначала реальный legacy writer после expand, затем точный B guard и весь контур backend A. Дополнительный rollback-transaction сценарий проверяет невозможность downgrade под реальной A функцией.
- Написаны pure admission/rollback правила, schema/SHA-bound marker и emitted current-main admission без исполнения исторического controller. Node: 8/8 PASS локально; дополнительный реальный release-state PostgreSQL test NOT RUN на Contabo и включён в hosted gate. Runtime controller/workflow admission ещё подключаются.
- Инструментальный main `cb1c604e274d75cfde10534b94978ce293f8f121` уже отвечает точным SHA в public build-info и ping={ok:true}; deploy run 40094028286 дошёл до post-deploy smoke (финальный SUCCESS ещё не перечитан). Новый booking backend/UI на production не устанавливался.

## 2026-10-24 — Исполняемый переход A/B и критический аудит гонок

- Superseded: предварительный вариант с отдельной строгой DDL-миграцией B и CI fixture заменён одной схемой A/B и monotonic activation metadata. Старый fixture удалён только из task-owned подготовки, ещё не применённой к production. Это сохраняет один recovery DB profile для A/B и не требует снимать/менять guards при откате.
- Новая глобальная таблица release metadata имеет SELECT-only доступ web role, FORCE RLS, проверку SHA/time, однонаправленный update и запрет DELETE/TRUNCATE. Активация B выполняется migration identity, под блокировками Bookings/Tasks, с SHA первого включения. A/B используют одинаковый backend.
- Найдена и устранена логическая гонка раннего rollback: остановка Node не гарантирует завершение PostgreSQL COMMIT. Proof теперь ждёт table writers и читает следующий READ COMMITTED snapshot; repeatable-read default роли явно переопределяется. В hosted test добавлен настоящий поздний COMMIT и попытка legacy rollback; на Contabo этот PostgreSQL case NOT RUN.
- Закрыты особенности expand окна: старые Page PATCH автоматически повышают version, old INSERT сохраняет текущий известный buffer. Положительный Booking нельзя понизить в 0 даже до включения B. FK ON UPDATE приведены к Prisma cascade contract.
- Deployment controller проверяет predecessor до live replacement, дренирует/сохраняет пустой PM2 dump перед rollback proof и перед первым стартом writer. Rejected rollback сохраняет candidate bytes, а не перезаписывает их legacy backup. Точный current-main admission исполняется перед retained recovery SCP.
- Local checks: Node pure/controller cases 12 PASS, PostgreSQL case NOT RUN (hosted gate добавлен); event-platform assets PASS; scoped ESLint PASS; i18n parity 28613 keys PASS; shell syntax/diff PASS. Первые 151 targeted unit выявили 3 phase/navigation расхождения; исправлены настоящие nav/voice registry entries и фазовый контракт теста, повтор этих 15 cases PASS. Полный hosted source gate и production build A/B ещё нужны.
- Инструментальный deploy `40094028286` final SUCCESS; current production SHA `cb1c604e274d75cfde10534b94978ce293f8f121`, ping PASS. Booking backend A/B пока не deployed.

## 2026-10-24 — Готов source для hosted проверки A

- Все 151 целевых unit cases в 12 файлах повторно PASS на текущей фазе A. Новые pure/controller Node cases: 13 PASS; четырнадцатый actual PostgreSQL case NOT RUN на Contabo и обязателен в hosted checks. Scoped ESLint, Prisma validate (synthetic URL без подключения), event-platform assets, i18n, YAML parse, shell syntax, diff PASS.
- PostgreSQL scenario теперь проверяет настоящий поздний COMMIT и отказ legacy rollback после ожидания, включая необычный repeatable-read default роли. Отдельные проверки закрывают root activation без SHA, web UPDATE, деактивацию, DELETE/TRUNCATE и повтор включения.
- Добавлены read-only post-deploy/recovery proofs: live artifact SHA, mode, expanded storage и canonical count. Synthetic customer записи и provider sends для smoke не требуются.
- Actual log инструментального deploy подтверждает plain recovery mode; encrypted/offline commissioning не активна. Существующая политика normal releases не менялась, сертификат полной DR не заявляется.
- Новый аудит и protocol описывают фактический code path; I-05 до hosted acceptance и реального A artifact ещё не закрывается. Следующие действия: checkpoint/push A, PR с production-build gate; проверить результаты; подготовить B как смену immutable UI phase с тем же backend.

## 2026-10-24 — Подготовлен B поверх compatibility backend A

- Backend A опубликован в PR https://github.com/rashadoni/leaddrive-v2/pull/1026, source `d7235866e3bb8b489883738c888763afc7e8af1b`; production-build label включён. Hosted gates ещё выполняются.
- За время подготовки в main другим task уже принят #1025 (Time download). Текущий main `6a755bb2329d2f4ff9a1cc9dc2bf5b7900507376` объединён в A без удаления/переписывания чужих изменений. Неизменны origin, registered production и Actions release path.
- Исходная feature branch продолжена fast-forward к A с сохранением всех checkpoint commits; B меняет только `src/lib/booking/release-phase.json` на workspace и дополняет этот журнал. Backend, schema, migrations и marker storage contract A/B одинаковы.
- Новый label nav.bookingWorkspace действительно содержит «Встречи и запись»; navDesc и voice keys синхронизированы с immutable phase. В A старый редактор доступен администратору, B открывает согласованный workspace сотрудникам/координаторам с own/team access.
- PR #1023 становится stage B и остаётся зависимым от #1026: сначала нужны зелёные exact-source checks и actual immutable A artifact с успешным production smoke, затем включение B. Старый writer не используется после canonical данных/активации.

## 2026-10-24 15:03 UTC — Первая hosted проверка A выявила гонку тестового writer

- Run `40104161255`, source `d7235866e3bb8b489883738c888763afc7e8af1b`: typecheck PASS; static-checks FAIL в новом Node PostgreSQL acceptance, до application booking suite. Baseline не менялся, красный gate не обходится.
- Ошибка: тест начинал synchronous polling до завершения передачи SQL фоновому psql. Он не доказывал начало транзакции и не увидел table lock. Добавлены awaited stdin completion, независимая pg_locks readiness и explicit проверка exit status/read-only drain ответа.
- Production drain дополнительно ограничен current database OID, чтобы одинаковые relation OID в другом DB/clone не давали ложную занятость.
- Для короткой обратной связи существующий protected preflight workflow дополнен отдельным synthetic release-contract PostgreSQL run на PR paths. Он дополняет full static-checks, не заменяет его; production доступ по-прежнему только explicit main dispatch.

## 2026-10-24 15:23 UTC — PostgreSQL выявил deferred guard legacy deletion

- Быстрые A/B preflight runs `40105790196` / `40105835276`: 8 inspector + 14 release-contract tests PASS, без пропусков; настоящие late-COMMIT, permissions и monotonic mode подтверждены.
- Full A static run `40105790154` остановился при bootstrap 22 application PostgreSQL cases: deferred INSERT guard не учитывал legacy insert/delete внутри одной транзакции. Это дефект совместимости A, а не повод разнести тест по транзакциям или убрать gate.
- Добавлено узкое исключение только для исчезнувших never-canonical version-zero row events при выключенном B. Любой queued positive version и любое удаление в strict mode всё ещё отвергается. До B activation добавлены реальные попытки positive/delete и positive/zero/delete с обязательным rollback, плюс проверка сохранности legacy row.
- Fresh inventory dispatch `40106579218` привязан к фактически выложенному current main `6a755bb2329d2f4ff9a1cc9dc2bf5b7900507376`; Time deploy `40102027380` SUCCESS, build-info exact match. Чужой PR не merged этой задачей.
- Авторизация сохраняется: согласованный пользователем список UX и поручение довести до конца без промежуточных подтверждений, затем «начинай». Перед выпуском список повторён в чате; новые пользовательские функции сверх согласованного варианта не добавляются. Пять required checks и реальный A artifact до B обязательны.

## 2026-10-24 15:26 UTC — Свежая production inventory и очередь preflight

- Main dispatch `40106579218` / job `120909848143`: SUCCESS. Наблюдение `2026-10-24T15:24:25.153Z` exact source/deployed `6a755bb2329d2f4ff9a1cc9dc2bf5b7900507376`: по-прежнему 2 Booking, все проверяемые нарушения 0; btree_gist установлен; READ ONLY и RLS unfiltered подтверждены.
- Artifact `12564134205`, digest `sha256:bda5c31e1f9c44548c17d2920b0b5af63d14bf83eaac852692ef3530d49d26db`; allowlisted копия сохранена отдельным `production-inventory-20261024-1524.json`, прежнее наблюдение не перезаписывается.
- Audit выявил отсутствие общей concurrency у нового inspector workflow. Добавлена отмена obsolete synthetic PR runs; operational dispatch имеет уникальную группу и прежнюю production-deploy сериализацию, поэтому не отменяет действующую production проверку/выкладку. Production данные и controller admission этим не меняются.
- Следующее действие: полный hosted CI на финальном source A/B; затем verified immutable A до активации B.

## 2026-10-24 15:51 UTC — 22/22 booking PostgreSQL PASS; исправляется смежный fixture

- Sources A `43f7046fa6428d879ade240a646e486bfa4e796f`, B `1549643479ad02fcf33de90391ae5719ccb842c9`: реальные Online booking database gate PASS на обоих, в том числе восстановленная legacy insert/delete совместимость и отрицательные positive/delete обходы; typecheck PASS на обоих. Production standalone A PASS; B ещё собирается. Общие static checks продолжаются.
- Дополнительный Workforce restore evidence оказался красным на обоих heads при подготовке disposable schema, до API/browser тестов. Причина подтверждена log job `120910614123`: Prisma требует blanket data-loss override для новых redundant composite unique keys `(organizationId,id)` у booking_pages/bookings на непустом fixture.
- Override не добавляется. По существующему campaign-fixture образцу две redundant uniqueness гарантии (id уже primary key) создаются явно только в disposable runtime alignment после исторического before/after proof. Настоящие production миграции, guard, base-row receipts и последующий Prisma refusal gate сохраняются.
- Требуется новый полный exact-source CI и успешный дополнительный restore evidence. Предыдущие зелёные результаты относятся к прежним SHA; за новый PASS не выдаются.

## 2026-10-24 16:13 UTC — Текущие A/B gates и свежая inventory сохранены без изменения CI head

- Remote sources A `1f589578a912631b9fb1f8ca3dd4ff2ff2b0d210` (#1026), B `4cbdab6b7c16259e99dfdc36f5dca08c0e5607b4` (#1023). B относительно A меняет только immutable phase JSON и прежнюю запись журнала; backend и migrations идентичны.
- Required PR runs A `40108730548`, B `40108740060`: typecheck и actual Online booking database gate PASS на обоих; production standalone A PASS, B ещё in progress. Общие static-checks ещё выполняются, поэтому merge не сделан. Source-validation/secret/runner checks также перечитываются перед merge.
- Исправленный дополнительный Workforce restore evidence PASS на обоих: A `40108730621` / job `120915771571`, B `40108740132` / job `120915798666`. Исторический migration proof, real PostgreSQL restore tests, авторизованный API и rendered browser evidence выполнены; blanket data-loss override не добавлен.
- Fresh inventory `40110215470`, artifact `12566352184`, digest `sha256:c944f10e78bb37dc5941ba87753453ec324e3d5cbfb36c19eb6cf1349c85f1fe`: наблюдение `2026-10-24T16:10:30.904Z`, exact current main/deployed `6a755bb2329d2f4ff9a1cc9dc2bf5b7900507376`. По-прежнему 2 Booking; все checked violations 0; btree_gist установлен, read-only/unfiltered true. Копия сохранена новым evidence file, старые не перезаписаны.
- Baseline public GET страницы `/book/leaddrive-test-yazilis` и её public API: HTTP 200/200, bodies discarded, без бронирований и provider sends.
- Уточнение времени предыдущего заголовка «15:51 UTC»: source-fix checkpoint фактически сделан около 15:49 UTC. Старый заголовок сохраняется как история.
- Этот docs/evidence-only checkpoint остаётся локальным: remote A/B heads и их текущие CI не перезаписываются/не перезапускаются. При merge B проверять remote `4cbdab6b7...`, а не последующий локальный journal commit.
- Точная текущая остановка: ожидание оставшихся полных CI/build результатов, production всё ещё `6a755bb...`; backend A/B ещё не installed. Следующее действие: после зелёных пяти required checks и build принять A **merge commit**, штатно выложить и сохранить проверенный immutable A artifact; только после этого принять/выложить B.
## 2026-10-24 16:30 UTC — Full baseline выявил два integration contract расхождения

- A `40108730548` и B `40108740060` завершили source build, typecheck, 22 application PostgreSQL и все отдельные DB gates успешно, но final unit-baseline FAIL: 20 failing files против прежних 18. Новые: cron-trigger-lock-contention и nav-items. Baseline не меняется.
- Normal booking post-deploy proof ошибочно имел implicit success dependency: сбой соседнего smoke пропустил бы его. Условие приведено к существующему `!cancelled() && deploy_atomic.outcome == success && normal`, так что каждый smoke независимо собирает evidence, а общий job остаётся красным при любой ошибке.
- Переводы намеренно содержат обе immutable phase подписи. Nav coverage теперь требует ровно один правильный активный booking entry и ровно единственную inactive-phase подпись среди orphan keys; любые прочие orphan/missing keys всё ещё отвергаются. Само production меню и права этим не меняются.
- Дополнительный restore evidence уже PASS на обеих версиях после безопасного fixture alignment. Требуется повтор полного exact-source CI после этих узких исправлений; предыдущие source SHA не выдаются за новые зелёные.
- После исправления проверен весь найденный узкий набор workflow/navigation contract tests: 201/201 PASS в 20 файлах, один worker. Scoped ESLint, runner policy, YAML parse и diff PASS. Полный suite/build локально не запускались по host contract.

## 2026-10-24 16:32 UTC — Исправления baseline включены в B

- Journal-only merge conflict разрешён сохранением обеих append-only записей (16:13, затем 16:30); исходный текст истории не удалялся.
- Superseded: локальный checkpoint `39e35a810` теперь публикуется в составе нового B merge, поэтому новый source B будет отличаться от A только phase flag и docs/evidence. Предыдущий remote `4cbdab6b7...` больше не является кандидатом после push; новый head требуется проверить заново.
## 2026-10-24 16:38 UTC — Закрывается исходный сценарий поиска раздела

- Сверка согласованного требования «находить по старому и новому названию» выявила UI-пробел: sidebar/Cmd+K/launcher искали текущую подпись, и «Онлайн-запись» не находила новое «Встречи и запись».
- Добавлены переведённые search aliases двух booking labels и единый matcher в трёх существующих поисках. Обработка выполняется только после accessibleNavItems: alias не выдаёт доступ и не создаёт второй пункт/устаревшую ссылку. Существующие поиски групп, Support sections и прочие aliases сохранены.
- Подсказка нового пункта AZ/RU/EN теперь описывает назначение раздела. Unit discovery проверяет оба имени в трёх языках, ровно один правильный текущий URL и отсутствие результата для viewer/reviewer.
- Это исправление исходной findability задачи; новая функциональная область не добавляется. Требуется новый source CI/build из-за client search компонентов; baseline и guards сохраняются.
- Discovery/navigation/access + deploy contract: 84/84 PASS в 3 целевых файлах. i18n parity 28630 keys PASS. Scoped lint нашёл прежнюю render-time ref mutation в уже затронутом AppLauncher; обновление ref перенесено в useEffect, подписка/клавиатурное действие сохранены. Lint повторяется без исключения правила.
- Повтор lint после ref fix выявил прежний synchronous query reset effect того же компонента. Query reset перенесён в guarded prop-change state adjustment до commit, чтобы при открытии не отображались прежние результаты; без async обхода lint или ослабления правил.

## 2026-10-24 16:47 UTC — Реальная browser-проверка поиска и режима B

- A source `a299c6458` включает translated search aliases и lint-safe launcher lifecycle. B получил тот же код с сохранением workspace phase; единственный journal conflict разрешён сохранением обеих append-only записей. Backend/schema одинаковы.
- На реальном AppLauncher/LauncherPrefsProvider в изолированном Vite: оба названия находят один правильный пункт; Enter записывает переход `/meetings`; открытие из parent и по клавиатуре очищает поиск; 1440/390px без overflow; JS/console errors 0, external requests 0. Preferences API перехвачен локально, реальные CRM-данные не запрашивались/не менялись.
- Evidence: `menu-search-browser-result.json`, `menu-search-desktop.png`, `menu-search-mobile.png`; observed `2026-10-24T16:45:37.285Z`. Скриншоты просмотрены. Task-owned preview process остановлен по проверенному PID/command path.
- Это component UI proof, не authenticated production E2E. Source B после checkpoint/push требует полного exact-head CI. Предыдущий `2d11a88d9...` superseded; production по-прежнему `6a755bb...`, ни A, ни B не выпущены.
