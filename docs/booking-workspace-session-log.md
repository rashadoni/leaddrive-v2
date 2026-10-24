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
