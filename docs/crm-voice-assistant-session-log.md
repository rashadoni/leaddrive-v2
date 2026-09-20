# Журнал работы над голосовым ассистентом CRM

Дата начала: 2026-09-19
Статус: активный, дополняемый журнал
Связанная дорожная карта: [crm-voice-assistant-roadmap.md](./crm-voice-assistant-roadmap.md)

## Правило сохранения

- Не удалять предыдущие записи из этого файла.
- Новые решения, изменения требований, реализованные этапы, PR и деплои добавлять в конец журнала.
- Если приложение Codex сворачивает длинную историю, этот файл остаётся постоянной историей проекта.
- Голосовые подтверждения и фоновые звуки не считаются подтверждением CRM-действия. Для каждой записи в CRM пользователь должен явно нажать кнопку подтверждения в интерфейсе.

## Исходные требования пользователя

1. Найти существующего голосового ассистента внутри CRM, который запускается кнопкой микрофона.
2. Спроектировать возможность создавать голосом лиды, сделки и задачи, а также заполнять карточки лидов.
3. Добавить шумоподавление: фоновая музыка и звон не должны прерывать разговор с ассистентом.
4. Не переносить решение из PBX как готовую задачу: работа ведётся именно с AI-ассистентом внутри CRM.
5. Оформить последовательную дорожную карту и сохранить её в репозитории.
6. Продолжать реализацию по этапам, выполнять push и deploy без дополнительного подтверждения в рамках этой задачи.
7. Любое действие, которое записывает данные в CRM, должно требовать отдельного явного нажатия кнопки. Голосовое «да» не является разрешением на запись.
8. Не терять и не убирать историю всей сессии; поддерживать этот журнал как постоянную запись.

## Выполненные этапы

### Аудит голосового ассистента и аудиоканала

- Найден существующий голосовой модуль CRM, его кнопка микрофона, обработка распознавания и маршрут запросов.
- Отдельно исследована проблема локального шума и прерывания разговора.
- Подготовлена и сохранена общая дорожная карта проекта.

### Канонические CRM-команды

Для будущего голосового слоя подготовлены серверные команды:

- создание задачи — PR #228;
- создание лида — PR #230;
- обновление лида — PR #231;
- создание сделки — PR #233;
- конвертация лида в сделку — PR #236.

Эти команды являются серверной точкой применения правил CRM. Голосовой ассистент не должен напрямую писать в базу или обходить проверки доступа.

### Фундамент безопасных намерений

- Добавлена модель `AiActionIntent`.
- Добавлены состояния жизненного цикла, срок действия, ревизии, идемпотентность и защита от повторного выполнения.
- Добавлено связывание подтверждения с хешем нормализованного payload.
- Добавлены ограничения базы данных, tenant-bound внешние ключи и RLS.
- Сырые аргументы инструмента не содержат запись микрофона или полный транскрипт.
- Добавлены архитектурное описание и автоматические тесты.

PR: #238
Merge commit: `b39216a58a7e26822201ac628ddd78417346d746`
Production artifact: `67e3f28007184377ff0914438ad4f60d4a32c069`

Проверки production после деплоя:

- `/api/v1/ping` вернул `{"ok":true}`;
- `/api/v1/public/build-info` подтвердил ожидаемый `artifactSha`;
- миграция, RLS-проверки, атомарный deploy и штатные smoke-тесты прошли успешно.

## Текущее состояние

Фундамент `AiActionIntent` находится на production. Новый механизм пока не выполняет CRM-записи: draft API, commit API и доступные модели инструменты записи ещё не подключены. Это намеренное безопасное состояние.

## Следующий этап

1. Закрытый реестр разрешённых действий.
2. API создания и обновления черновика намерения без записи в CRM.
3. Карточка предпросмотра изменений в интерфейсе.
4. Явное подтверждение нажатием кнопки.
5. Commit API с повторной проверкой пользователя, tenant, прав, TTL, ревизии и payload hash.
6. Подключение канонических команд создания лида, сделки, задачи и обновления карточки.

## Дополнение 2026-09-19: сохранение истории

Пользователь обратил внимание, что приложение Codex свернуло большую часть диалога. Зафиксировано постоянное правило: не удалять старые записи журнала и дополнять его после каждого существенного этапа.

По дополнительному требованию пользователя правило перенесено в глобальный
контракт `/home/codex-alt/.codex/AGENTS.md`, действующий для всех задач Codex на
хосте `remote-alt`. Глобальное правило требует создавать append-only журнал для
каждой нетривиальной или продолжающейся задачи, обновлять его после существенных
этапов и никогда не стирать старые записи. Автоматическое сворачивание истории в
интерфейсе Codex остаётся функцией приложения и не управляется агентом.

## Продолжение 2026-09-19: реестр действий и draft API

По команде пользователя «продолжай» начат следующий срез Phase 5.

Реализовано в рабочей ветке:

- закрытый runtime-frozen реестр ровно пяти действий: создание задачи, создание
  лида, обновление лида, создание сделки и конвертация лида в сделку;
- привязка каждого действия к канонической команде, схеме, RBAC/tenant-модулю,
  разрешениям полей, риску, TTL, dedupe policy и preview renderer;
- same-origin session-only endpoint
  `POST /api/v1/ai/voice/actions/draft`;
- повторная проверка voice gate, роли, модулей, полей, владельца активной
  voice-сессии, видимости target-записи и её `updatedAt`;
- idempotent replay, конфликт при повторном использовании ключа с другим
  payload и защита одного активного root intent;
- предупреждения о возможных дублях лидов и сделок;
- структурированный preview с translation keys и before/after для обновления;
- целевые unit/API тесты.

Сохранённый рубеж безопасности: draft endpoint не импортирует и не вызывает
исполняемые CRM-команды. Commit API, модельные write-tools и голосовое
подтверждение отсутствуют. Новый draft всегда остаётся неподтверждённым и сам по
себе не меняет CRM.

Точка остановки этой записи: реализация и первичные целевые тесты готовы;
документация обновляется, после чего следуют финальные проверки, commit, PR, CI,
merge и production deploy.

## Продолжение 2026-09-19: завершение draft API и жизненный цикл черновика

Первый срез завершён через PR #239. Полный CI прошёл, PR слит в `main` merge
commit `7cb5de3aa0dbbddb1064e92ac578f8bce4cf26ba`. Production workflow
`35464733335` запущен для этого точного SHA; на момент этой записи quality и
security gates уже прошли, production artifact ещё собирается.

Не дожидаясь сборки, начат следующий безопасный срез Phase 5:

- `PATCH /api/v1/ai/voice/actions/:id` для редактирования только
  неподтверждённого receipt по ожидаемой ревизии;
- `GET /api/v1/ai/voice/actions/active` для восстановления одного активного
  root receipt текущего пользователя и voice-сессии;
- `POST /api/v1/ai/voice/actions/:id/cancel` для безопасной отмены до
  исполнения;
- повторная проверка tenant/user/session, voice gate, текущих разрешений,
  видимости и версии target-записи;
- compare-and-swap для edit/cancel, безопасный replay идентичного edit и
  повторной отмены;
- пересчёт нормализованного payload hash, preview, duplicate warnings и TTL
  после редактирования;
- строгие request envelopes, same-origin JSON guard для мутаций и раздельные
  per-user rate limits.

Важная граница сохраняется: commit endpoint по-прежнему отсутствует, команды
CRM не вызываются, лиды/сделки/задачи не изменяются. Целевой регрессионный набор
на этом рубеже: 6 файлов, 35 тестов — успешно; targeted ESLint и
`git diff --check` — успешно.

Точка остановки этой записи: код, тесты и документация lifecycle-среза готовы
локально; далее нужны checkpoint commit, push, PR, CI, merge и отдельный
production deploy этого нового среза.

## Итог 2026-09-19: lifecycle API на production

Первый draft API с закрытым реестром действий успешно опубликован:

- PR #239;
- merge SHA `7cb5de3aa0dbbddb1064e92ac578f8bce4cf26ba`;
- deploy workflow `35464733335` — успешно;
- независимые `/api/v1/ping` и `/api/v1/public/build-info` подтвердили этот SHA.

Следующий lifecycle-срез также полностью завершён:

- PR #240;
- checkpoint commits `d17177ef6` и `ad7d637f6`;
- CI: secret scan, scope, runner policy, static checks и полный typecheck —
  успешно;
- merge SHA `ca30f24f59aa072fb2951358eeaa4d0e0843a8a2`;
- deploy workflow `35466531731` — успешно;
- независимый `/api/v1/ping` вернул `{"ok":true}`;
- независимый `/api/v1/public/build-info` подтвердил
  `artifactSha=ca30f24f59aa072fb2951358eeaa4d0e0843a8a2`.

На production теперь доступны безопасные операции с receipt: создать draft,
получить активный, отредактировать неподтверждённый по revision-CAS и отменить.
Ответ active receipt защищён `Cache-Control: private, no-store`.

Точка остановки: I1.1, I1.2, I1.3, I1.4, I1.6, I1.7, I1.8 и I1.9
завершены. Commit endpoint отсутствует, подтверждение через UI ещё не
реализовано, CRM-записи голосом не выполняются.

Следующее действие: спроектировать и реализовать только серверную безопасную
цепочку commit — I1.5, I1.10–I1.15 — с обязательным UI confirmation proof,
повторной проверкой всех прав/target revision, execution lease, идемпотентным
результатом и immutable event ledger. До готовности этого контура write-tool
для модели не открывать.

## Продолжение 2026-09-19: confirmation-proof foundation

Начат следующий safety-lane этап commit-контура. Аудит канонических CRM-команд
показал, что они используют собственные транзакционные границы и запускают
побочные эффекты. Поэтому простой CAS-переход intent в `executing` пока
недостаточен: авария после CRM-записи, но до сохранения receipt-result, создаёт
неопределённый результат и риск дубля при retry.

Реализован первый безопасный срез без CRM-записи:

- модель и миграция append-only `AiActionIntentEvent`;
- tenant-bound composite foreign keys, forced RLS и только SELECT/INSERT
  application policies;
- database-триггеры, запрещающие прямые UPDATE, DELETE и TRUNCATE;
- закрытый словарь lifecycle-событий и проверки revision/hash/JSON shape;
- `POST /api/v1/ai/voice/actions/:id/confirmation`;
- 256-bit одноразовый proof token сроком 60 секунд, хранимый только как
  domain-separated SHA-256 hash;
- повторная проверка receipt revision/payload hash, целостности normalized
  payload, роли, модулей, полей, активной voice-сессии, target visibility и
  target `updatedAt`;
- `private, no-store`, same-origin JSON guard и отдельный rate limit.

Проверки на текущем рубеже: Prisma schema validate — успешно; целевой набор 7
файлов/43 теста — успешно; targeted ESLint и `git diff --check` — успешно.

Точка остановки этой записи: confirmation proof и база event ledger готовы
локально. Commit endpoint всё ещё отсутствует, `confirmedAt` не меняется,
канонические CRM-команды не вызываются. Далее: checkpoint/PR/CI/deploy этого
фундамента, затем атомарная интеграция остальных lifecycle events и устранение
crash ambiguity до включения I1.5.

## Итог 2026-09-19: confirmation proof на production

Confirmation-proof foundation завершён и развёрнут:

- основной checkpoint `34e09912d`;
- type-fix тестового mock `62d9e001d`;
- PR #243;
- первый CI выявил один новый `TS2339` только в типизации test mock; runtime,
  migration и static gates были зелёными;
- повторный CI: scope, secret scan, runner policy, static checks и полный
  typecheck — успешно;
- merge SHA `df65ee2bb1c33cd73c23465687809ee316c03c0f`;
- deploy workflow `35470189884` — успешно;
- независимый `/api/v1/ping` вернул `{"ok":true}`;
- независимый `/api/v1/public/build-info` подтвердил
  `artifactSha=df65ee2bb1c33cd73c23465687809ee316c03c0f`.

На production теперь есть append-only event-ledger foundation и endpoint
выдачи короткоживущего confirmation proof. Голосовая CRM-запись всё ещё
невозможна: commit endpoint отсутствует, intent не переходит в `executing`,
канонические команды не вызываются.

Точка остановки: I1.14 выполнен частично — таблица, RLS, immutability и событие
`confirmation_proof_issued` готовы, но остальные lifecycle transitions ещё не
пишутся атомарно. Следующее действие: адаптировать канонические команды и
receipt-result к атомарной/idempotent execution boundary, затем реализовать
single-use proof consumption, CAS claim, lease recovery и commit endpoint.

## Продолжение 2026-09-20: атомарный ledger draft lifecycle

Закрыт следующий участок I1.14 без включения CRM-записей:

- `drafted` создаётся в одной транзакции с новым `AiActionIntent`;
- `draft_updated` создаётся в одной транзакции с revision-CAS обновлением;
- `cancelled` создаётся в одной транзакции с CAS-отменой;
- `expired` создаётся в одной транзакции с TTL-CAS переходом;
- проигравший CAS не оставляет ложного события;
- прежнее массовое TTL-обновление без forensic evidence заменено на
  идентифицированный переход единственного активного root intent;
- event metadata ограничена состоянием/ревизией/причиной и не содержит raw
  payload, аудио, transcript или секреты.

Проверки текущего дерева:

- 8 целевых test files / 49 tests — успешно;
- targeted ESLint — успешно;
- `git diff --check` — успешно;
- полный `npm run typecheck` и `npm run build` — NOT RUN локально по host
  contract; полный typecheck должен выполнить GitHub CI.

Точка остановки этой записи: draft/update/cancel/expiry lifecycle теперь
пишется атомарно в immutable ledger, но I1.14 ещё не завершён. Commit endpoint
отсутствует, proof не потребляется, состояния `executing`/`succeeded`/`failed`
не включены, CRM-команды не вызываются.

Следующее действие: checkpoint commit, push, PR и CI/deploy этого среза. После
этого — устранение crash ambiguity между канонической CRM-командой и сохранением
receipt-result, затем single-use proof consumption, execution CAS/lease и
commit endpoint.

CI PR #244: static checks и полный unit baseline прошли. Первый typecheck gate
обнаружил один новый `TS2339` только в чтении `mock.calls` нового unit-теста;
production-код ошибок не добавил. Проверка события переписана через типобезопасный
`toHaveBeenCalledWith`, без изменения runtime-поведения. Далее нужен повторный
CI этого fix-коммита.

## Итог 2026-09-20: атомарный draft ledger на production

Срез полностью завершён и развёрнут:

- основной checkpoint `27cab7ab0`;
- type-safe test fix `681f8e5fc`;
- PR #244;
- повторный CI: scope, secret scan, runner policy, static checks, полный unit
  baseline и defect-shaped typecheck — успешно;
- merge SHA `921aa9d3406dc37e0e8716de11c82d3d6cd3ecae`;
- deploy workflow `35476428436` — успешно, включая quality/security gates,
  immutable artifact, atomic production switch и post-deploy smoke;
- независимый `/api/v1/ping` вернул `{"ok":true}`;
- независимый `/api/v1/public/build-info` подтвердил точный
  `artifactSha=921aa9d3406dc37e0e8716de11c82d3d6cd3ecae`.

На production события `drafted`, `draft_updated`, `cancelled` и `expired`
теперь атомарны с изменением intent. Голосовая CRM-запись всё ещё выключена:
commit endpoint отсутствует, confirmation proof не потребляется, execution
lease и terminal result ещё не реализованы.

Точка остановки: следующий технический риск — crash ambiguity между успешной
канонической CRM-командой и сохранением receipt-result. Следующее действие —
сделать command/result boundary идемпотентной и восстановимой для пяти команд,
а затем включать single-use proof consumption, execution CAS/lease и commit
endpoint.

## Продолжение 2026-09-20: атомарная execution boundary

Устранено crash ambiguity между CRM-записью и сохранением результата intent:

- пять канонических команд принимают внутренний transaction context;
- CRM-мутация, переход intent в `succeeded`, минимальный result receipt и
  immutable-событие `succeeded` выполняются в одной транзакции;
- terminal compare-and-swap привязан к tenant, user, revision, payload hash,
  lease token и неистёкшему lease;
- при проигранном CAS или ошибке команды вся CRM-мутация откатывается;
- после успешного commit повтор с тем же lease возвращает сохранённый результат
  и не вызывает команду повторно;
- workflows, notifications, webhooks, scoring, audit helpers и rollups
  откладываются до успешного завершения транзакции.

Важные ограничения сохранены: executor внутренний, API-маршрута commit нет,
confirmation proof ещё не потребляется, execution claim/recovery ещё не
реализованы, write-tool модели не добавлен. Надёжная повторная доставка внешних
побочных эффектов остаётся отдельной задачей transactional outbox (C1.12).

Проверки текущего дерева: targeted ESLint — успешно; 5 целевых test files / 228
tests — успешно. Полный typecheck/build локально не запускались по host
contract и должны пройти в GitHub CI.

Точка остановки этой записи: код, unit/regression tests и архитектурная
документация execution boundary готовы локально. Следующее действие —
checkpoint commit, push, PR, полный CI, merge и production deploy. После этого
можно реализовывать атомарное single-use proof consumption + execution claim и
lease recovery до появления commit endpoint.

## Итог 2026-09-20: execution boundary на production

Срез полностью завершён и развёрнут:

- checkpoint commit `aaa176df8`;
- PR #245;
- PR CI: scope, secret scan, runner policy, static checks, полный unit baseline
  и defect-shaped typecheck — успешно;
- merge SHA `a7f6c2654ffe1b3fb1f80df1e8b303c515dae19d`;
- deploy workflow `35479290362` — успешно, включая quality/security gates,
  production build, SHA-bound artifact, атомарный deploy и post-deploy smoke;
- независимый `/api/v1/ping` вернул `{"ok":true}`;
- независимый `/api/v1/public/build-info` подтвердил точный
  `artifactSha=a7f6c2654ffe1b3fb1f80df1e8b303c515dae19d`.

На production теперь присутствует внутренняя атомарная command/result boundary
для всех пяти канонических CRM-команд. Голосовая CRM-запись по-прежнему
выключена: commit endpoint отсутствует, proof не потребляется, execution claim
и lease recovery ещё не включены, write-tool модели отсутствует.

Точка остановки: следующий безопасный срез — атомарно потребить single-use
confirmation proof, выполнить compare-and-swap claim в `executing` и добавить
lease recovery/terminal failure semantics. Только после их проверки можно
подключать commit endpoint; UI-кнопка и model write-tools остаются отдельными
последующими этапами.

## Коррекция маршрутизации 2026-09-20

Пользователь подтвердил, что прежний GitHub-владелец и прежний production-host
больше не существуют и не должны использоваться ни в правилах, ни в активной
документации, ни в deploy-контрактах.

Исправлено:

- глобальный host contract указывает `rashadoni/leaddrive-v2` и
  зарегистрированный Contabo-host `13.140.132.245`;
- системный `codex-project-context` распознаёт текущего GitHub-владельца, а
  сохранённые backup-копии глобальных правил больше не содержат прежний маршрут;
- SSH alias `leaddrive-prod` больше не направлен на выведенный из эксплуатации
  адрес;
- активные файлы репозитория не содержат прежних GitHub/IP-значений;
- deploy допускает только зарегистрированный host или заполнение
  отсутствующего/пустого `SHARED_SERVER_IP`; неизвестный target отклоняется;
- исторические документы сохраняют смысл свидетельств без удалённого адреса,
  а GitHub-ссылки переведены на текущего владельца.

Проверки на этой точке: `bash -n scripts/server-deploy.sh`, `node --check
scripts/ci/test-event-platform-assets.mjs` и `git diff --check` — успешно.
Целевые контрактные тесты запускаются следующим действием.

Точка остановки: незакоммиченная повторная проверка execution-доступа в
`src/lib/ai/voice/action-draft.ts` сохранена отдельно от коррекции маршрута.
После отдельного checkpoint коррекции продолжается proof consumption +
execution claim/lease recovery.

## Продолжение 2026-09-20: proof consumption и execution lease

Реализован внутренний, пока не доступный через HTTP слой выполнения:

- проверка confirmation-event, exact intent/revision/payload hash и
  domain-separated token hash с constant-time comparison;
- unused proof истекает через 60 секунд, но уже использованный proof можно
  безопасно повторить после TTL и получить сохранённый claim;
- перед первым claim повторяются active voice session, role/module/field
  permissions, record filter, target visibility/version и payload integrity;
- proof consumption, CAS `awaiting_confirmation -> executing`, UUID lease,
  `confirmation_consumed` и `execution_claimed` атомарны;
- competing proof не может получить lease, а конкурентный retry того же proof
  возвращает claim победителя;
- recovery меняет только точную истёкшую lease после повторной авторизации;
  потерянный recovery-response повторяется по хешу прежней lease без новой
  ротации и без сохранения сырого прежнего токена в event data;
- terminal failure требует ограниченный uppercase error code, опциональный
  безопасный текст до 500 символов и атомарно пишет `failed` event;
- public commit endpoint и model write-tool по-прежнему отсутствуют, поэтому
  голос ещё не может изменить CRM.

Добавлены defect-shaped тесты на first claim, proof expiry/token mismatch,
same-proof replay, competing proof, concurrent CAS retry, lease recovery,
recovery replay/concurrency, active-lease rejection, terminal failure/replay и
повторную проверку execution access. Сырые lease capabilities дополнительно
убраны из immutable events: ledger получает только domain-separated hashes.
На текущей точке 3 целевых файла / 31 тест и расширенный voice/command набор
9 файлов / 69 тестов, targeted ESLint и `git diff --check` проходят.

Точка остановки: код и документация внутреннего claim/lease/failure слоя готовы
локально, но ещё не закоммичены. Параллельно cleanup PR #247 ожидает завершения
полного static-check/typecheck. Следующее действие — расширенный targeted test
gate, затем завершить/развернуть #247 и отдельным checkpoint провести новый
execution slice через PR/CI/deploy.

## Итог 2026-09-20: routing cleanup и execution claim на production

Коррекция маршрута завершена отдельно:

- checkpoint `44ed4ce6c`;
- PR #247, merge SHA `3401b98c02e035437f3acba2f05401cea5d1dd42`;
- все PR checks, включая static/unit baseline и typecheck, успешны;
- deploy workflow `35494290654` успешен;
- независимый ping вернул `{"ok":true}`, public build-info подтвердил точный
  artifact SHA `3401b98c02e035437f3acba2f05401cea5d1dd42`.

Внутренний execution claim/lease/failure срез также завершён:

- checkpoint `5de7d3c02`;
- PR #248, merge SHA `3e49f16f3db104daeda09cdc98bce0c8316332c9`;
- локально: targeted ESLint, `git diff --check`, 9 voice/command test files и
  69 tests — успешно;
- PR CI: scope, secret scan, runner policy, static checks/full unit baseline и
  typecheck — успешно;
- deploy workflow `35495445690` успешен, включая quality/security gates,
  production build, SHA-bound artifact, atomic server deploy и post-deploy
  smoke;
- независимый ping вернул `{"ok":true}`, public build-info подтвердил точный
  artifact SHA `3e49f16f3db104daeda09cdc98bce0c8316332c9`.

Текущее состояние: на production есть внутренние single-use proof consumption,
CAS claim, retry-safe lease recovery, bounded terminal failure и атомарная
command/result boundary для пяти CRM-команд. Голосовой помощник всё ещё не
может изменять CRM, потому что публичный commit endpoint и model write-tools
отсутствуют.

Точка остановки: I1.10-I1.14 закрыты на внутренней границе. Следующее действие —
I1.5 + I1.15: session-only same-origin commit endpoint с per-user/per-tenant/
per-action rate limits, который композиционно вызывает claim, executor и
безопасную классификацию terminal/retriable ошибок. Только после его отдельной
проверки можно подключать UI-кнопку; model write-tools остаются ещё более
поздним отдельным этапом.

## Продолжение 2026-09-20: session-only commit adapter

Реализованы I1.5 и I1.15:

- добавлен `POST /api/v1/ai/voice/actions/:id/commit` со строгим proof body;
- endpoint принимает только аутентифицированную браузерную сессию,
  same-origin `application/json` и повторно проверяет voice pilot gate;
- bearer/API-key, cross-origin, лишние authority-поля и некорректные ID/proof
  отклоняются до execution claim;
- отдельные минутные buckets ограничивают пользователя (20), tenant (200) и
  конкретный intent (10);
- adapter композиционно вызывает single-use proof claim, возвращает сохранённый
  terminal result, восстанавливает только точную истёкшую lease и выполняет
  canonical command через атомарную command/result boundary;
- контролируемые `CrmCommandError` и повреждённые stored-action состояния
  переводятся в bounded `failed`; неизвестные database/process ошибки не
  финализируются и возвращают `COMMIT_RETRY_REQUIRED`/503 для безопасного retry;
- confirmation token и execution lease не возвращаются клиенту и не попадают в
  лог; ответы помечены `Cache-Control: private, no-store`;
- Gemini Live tool contract проверен отдельным регресс-тестом: commit и пять
  канонических CRM write-команд модели не выдаются.

Добавлен отдельный API regression suite. На этой точке 3 целевых файла / 29
тестов для claim/executor/commit прошли; обновлённый commit suite — 8/8;
targeted ESLint и `git diff --check` прошли. Полный build/typecheck локально не
запускались по Contabo host contract и должны выполняться в GitHub CI.

Расширенный pre-commit gate: 6 файлов / 45 тестов для commit, draft lifecycle,
claim, executor, tool wiring и Gemini provider fence — успешно.

Точка остановки: код, тесты и документация I1.5/I1.15 готовы локально и ещё не
закоммичены. Следующее действие — checkpoint commit, push, PR, полный CI, merge,
production deploy и независимый smoke. После deploy следующий продуктовый
срез — U1.1-U1.3: session-scoped receipt store, desktop receipt panel и mobile
bottom sheet; endpoint не должен подключаться к UI без явной кнопки
подтверждения, model write-tool не добавляется.

Первый CI run PR #249 (`35497372979`) прошёл scope, secret scan, runner policy
и полный static/unit baseline, но blocking typecheck выявил один новый TS2345 в
новом тесте: hoisted mock `checkRateLimit` был выведен TypeScript как функция
без аргументов, а test-specific implementation принимал key. Production-код не
затронут. Mock получил явную сигнатуру `(key, config)`, после чего целевые
проверки и CI должны быть повторены без изменения typecheck baseline.

## Итог 2026-09-20: session-only commit adapter на production

I1.5 и I1.15 завершены и развернуты:

- основной checkpoint `e5162c478` добавил browser-session-only commit endpoint,
  строгий proof contract, replay/recovery, terminal/retriable error handling,
  три rate-limit scope и отдельный regression suite;
- checkpoint `e4f94d6ac` исправил только TypeScript-сигнатуру hoisted mock,
  обнаруженную первым blocking typecheck;
- локально повторно прошли 6 voice/command test files / 45 tests, отдельный
  commit suite 8/8, targeted ESLint и `git diff --check`;
- повторный PR CI `35498152909` прошёл scope, runner policy, secret scan,
  полный static/unit baseline и typecheck;
- PR #249 слит в `main`, merge SHA
  `ffcbaa3a427c514deacc478dc3296b331f0fab27`;
- исходный deploy run `35498959331` был отменён concurrency-механизмом после
  следующего merge PR #250, а не из-за ошибки кода или production deploy;
- следующий актуальный run `35499744499` собрал и развернул `main` с нашим
  изменением; quality/security, production build, immutable artifact, atomic
  deploy, встроенные public/revision/feature smoke и artifact retention прошли;
- независимый public ping вернул `{"ok":true}`, build-info подтвердил активный
  artifact SHA `a9891d6cb6d46ea56e8177eb6dfe298da4ec21bf`;
- анонимный POST к новому commit route получил `307` на login, то есть
  production middleware не пропускает вызов без браузерной сессии;
- повторный поиск подтвердил, что устаревшие `rashadrahimov/leaddrive-v2` и
  `46.224.171.53` в репозитории отсутствуют.

Текущее состояние: защищённая серверная commit boundary для пяти канонических
CRM-команд находится на production, но голосовой помощник ещё не вызывает её:
receipt UI не реализован, явная пользовательская кнопка подтверждения не
подключена, model write-tools по-прежнему намеренно отсутствуют.

Точка остановки: backend I1.5/I1.15 развернут и независимо проверен. Следующее
действие — U1.1-U1.3: session-scoped receipt store, desktop receipt panel и
mobile bottom sheet, затем подключение явной кнопки подтверждения к commit
endpoint без выдачи write-tool самой модели.

## Пакет продолжения в Codex Cloud — 2026-09-20

Проверенная исходная точка:

- GitHub: `rashadoni/leaddrive-v2`; устаревшие repository/host references
  `rashadrahimov/leaddrive-v2` и `46.224.171.53` использовать запрещено;
- в Codex Cloud рабочий путь должен быть `/workspace/leaddrive-v2`;
- production содержит PR #249, merge
  `ffcbaa3a427c514deacc478dc3296b331f0fab27`; активный более новый artifact
  `a9891d6cb6d46ea56e8177eb6dfe298da4ec21bf` также содержит этот merge;
- полный контекст этой сессии находится в remote branch
  `origin/codex/crm-voice-assistant-roadmap`, checkpoint `9f17130e8`;
- новую реализацию следует начинать с чистого актуального `origin/main` в новой
  ветке `codex/crm-voice-receipt-ui`, а этот журнал читать из указанной
  continuity-ветки; не переносить старую feature branch поверх нового main.

Непосредственный следующий срез — только U1.1-U1.3, в shadow mode:

1. Добавить client intent/receipt store, жёстко привязанный к текущей
   аутентифицированной voice session.
2. Восстанавливать активный receipt через
   `GET /api/v1/ai/voice/actions/active?voiceSessionId=...` при reconnect/reload
   настолько, насколько требуется store foundation.
3. Сделать компактную desktop-панель рядом с существующим assistant orb.
4. Сделать responsive mobile bottom sheet, сохраняя контекст CRM-страницы.
5. Покрыть store, session isolation, desktop/mobile rendering и отсутствие
   скрытого commit целевыми тестами.

Ограничения этого среза:

- не добавлять Gemini/model `commit_*` или другие прямые write-tools;
- не считать голосовое «да» подтверждением;
- пока не вызывать commit endpoint из store автоматически и не выполнять write
  при появлении receipt;
- не доверять model-supplied IDs, tenant/user/permissions;
- не превращать обычный receipt в full-screen modal;
- сохранить текущий noise fix: локальный RMS остаётся только UI-индикатором и
  не останавливает ответ;
- scope остаётся CRM browser assistant; PBX/SIP сюда не относится.

Следующие срезы после U1.1-U1.3:

- U1.4-U1.13: поля/warnings/defaults, update diff, ambiguity, duplicate flow,
  явные create/save/keep/cancel, edit/retry/open/recovery, restore, terminal
  states, RU/AZ/EN и accessibility;
- V1.1-V1.10: proposal-only Gemini tools, server-side entity resolution,
  candidate tokens, ambiguity и prompt-injection hardening; commit tool всё
  равно запрещён;
- T1/L1/L2/LF1/L3/D1/D2: поочерёдные product/action slices и отдельные
  shadow/canary gates для task, lead create/update/form assist/custom fields,
  deal и lead conversion;
- C1.9-C1.14: оставшиеся отмеченные roadmap command-layer parity/permission/
  side-effect/outbox проверки; часть поведения уже могла появиться в поздних
  slices, поэтому перед отметкой нужна проверка кода и тестовых доказательств;
- P0.1-P0.3, P0.5-P0.12: продуктовые правила, allow-lists, browser matrix,
  privacy, flags, SLO/stop conditions до реального rollout;
- A1.2/A1.6/A1.7/A2.9 и A3.1-A3.15: реальные consented audio fixtures,
  browser/device matrix, baseline и measurement-driven audio hardening;
- Q1-Q4: action-specific security/quality gates, затем полный regression gate;
- M1.1-M1.10 только после стабильных single actions;
- R1.1-R1.15: flags, telemetry, shadow -> admin canary -> limited cohort и
  независимые kill switches.

Готовый стартовый запрос для Codex Cloud:

> Продолжи CRM voice assistant в `rashadoni/leaddrive-v2`. Работай в Cloud из
> `/workspace/leaddrive-v2`. Сначала прочитай `AGENTS.md`,
> `docs/crm-voice-assistant-roadmap.md` и журнал из
> `origin/codex/crm-voice-assistant-roadmap` checkpoint `9f17130e8`. Создай
> чистую ветку `codex/crm-voice-receipt-ui` от актуального `origin/main`.
> Реализуй только U1.1-U1.3 в shadow mode: session-scoped receipt store,
> desktop anchored receipt panel и responsive mobile bottom sheet. Не добавляй
> model commit/write-tool, не выполняй CRM write автоматически и не используй
> spoken confirmation. Добавь целевые тесты, проверь responsive/accessibility
> foundation, обнови roadmap и append-only session journal, сделай checkpoint
> commit. Push/deploy разрешены, но production deploy только через обычный
> reviewed main -> GitHub Actions flow. Не используй устаревшие
> `rashadrahimov/leaddrive-v2` или `46.224.171.53`.
