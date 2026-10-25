# Критичный аудит изолированного ролевого стенда

Дата: 2026-10-25, Asia/Baku. Объём — новый стенд PR #1032, а не повторный
release всего раздела встреч. Hosted stand40175047313 завершён SUCCESS:
15/15 browser cases, реальная полная сборка и отдельная БД. Проверенная версия
head39ec68f1d0f7b640e8437d57b74ad7f5c3f06c27, merge50f205317e4d7d4ea155a786586f01c181ed7d60.
Квитанция: [result.json](evidence/result.json), происхождение и проверенный ZIP
digest: [artifact-metadata.json](evidence/artifact-metadata.json).
Все5 обязательных source contexts и дополнительный booking-role-browser SUCCESS;
[source-checks.json](evidence/source-checks.json) сохраняет точные run/job URLs.
Online Booking PostgreSQL27/27PASS. Unit gate прошёл существующий baseline:
18 failing files /18baseline, новых0. Type gate:1334 diagnostics,64 gated pairs
/64baseline, новых gated defects0; compiler exit2 не скрывается. Общий label-gated
build SKIPPED, не считается доказательством; actual full cold bundle выполнен
отдельным стендом. Baselines/правила не ослаблялись.

## Что именно доказывает проверка

Настоящий production bundle, credentials/session handlers, PostgreSQL и native
Chromium работают на одном одноразовом hosted runner. Данные вымышленные;
API, session и BookingAccess не мокируются. Ожидаемый scope задан независимо
через известные записи: сотрудник — одна собственная встреча, координатор —
своя и явно назначенная, manager без grant — только своя. Чужая организация
содержит реально существующую отрицательную контрольную запись.

Проверяются оба представления на непустом дне, карточка, сохранение периода,
Task → точная Meeting, отсутствие чужой ссылки и смена реальной сессии после
навигации. Последнее не доказывает мгновенную инвалидацию во второй открытой
вкладке. Авторизация через настоящий callback не является проверкой формы входа.

## Критический проход по границам

- До первого SQL изменения проверяются hosted runner, opt-in, loopback,
  точные БД/роли и согласованность адресов. SQL повторяет проверку имени БД.
  `contents: read`, без production environment/secrets и сохранённых Git credentials.
- Приложение подключено как NOSUPERUSER/NOBYPASSRLS; tenant-таблицы FORCE RLS.
  Фактический отрицательный контроль требует ноль строк без tenant context
  при наличии подготовленных записей через административное соединение.
- Booking-таблицы используют настоящие forward migrations и монотонное включение
  guard. Остальная пустая схема создаётся Prisma; полного исторического replay нет.
- Приложению не выдаются права записи Booking/Task. Допускаются только login
  metadata и личные favorites/recents синтетических пользователей. До/после
  сравниваются хэши семи бизнес-таблиц; пользовательские UI-настройки исключены явно.
- Browser runtime пропускает только чтение того же origin и два точных обычных
  UI/диагностических запроса: PUT preferences и log-only POST CSP report.
  Остальные попытки изменений/внешних запросов блокируются и делают итог FAIL.
  Это контроль browser traffic, не общий сетевой firewall серверного процесса.
  Provider credentials и worker jobs стенду не передаются.
- Секреты не сохраняются в JSON/screenshots/storageState/raw app logs.
  Квитанция связывает head SHA, проверенный merge SHA, build-info и хэши исходников.
  Само наличие загруженного артефакта или PREPARING-контекста не означает PASS.
- Первый неуспешный прогон сохранён в журнале. Для обычного onboarding overlay
  предусмотрен штатный Escape, без force click, подмены DOM или изменения auth.
  В финальном прогоне toursDismissed=0: overlay не потребовал этого обработчика,
  поэтому его фактическое срабатывание не объявляется проверенным.

Фактическая финальная квитанция подтверждает сотрудник1 / координатор2 /
manager-без-grant1, точный Task → Meeting, существующие отрицательные контроли,
смену сессии с навигацией и неизменность семи бизнес-таблиц. Неожиданных browser
запросов0; обычных UI preference PUT5, локальных log-only CSP POST16.
ZIP SHA256 проверен, все16 source bindings сверены с candidate Git и рабочими
файлами. Chromium145.0.7632.6. Cold build8m31s, peakRSS10,793,060KiB — причина
оставлять этот gate hosted, не запускать на постоянном dev Contabo.

## Замечание P2 — неполное покрытие path triggers

Место: `.github/workflows/booking-role-sandbox.yml:6`, `pull_request.paths`.
Workflow реагирует на Booking, часть Task, schema и свои исходники, но изменение
только `src/components/sidebar.tsx`, `src/lib/nav-items.ts`, страницы `/meetings`,
общего `src/lib/auth.ts` или `src/lib/with-rls.ts` не запускает его автоматически.
В текущем PR workflow запущен и проверяет эти зависимости в составе настоящего
bundle; проблема касается автоматического повторения на будущих узких PR.

Влияние: регрессия общего меню/авторизации может не получить этот дополнительный
browser gate. Обязательные общие source checks остаются включены.
Рекомендация: отдельно согласовать расширение узкого path filter на перечисленные
зависимости с учётом стоимости полного hosted build; после принятия workflow в
main доступен также явный workflow_dispatch. Не расширять права и не менять
базовые проверки ради экономии времени. Это P2 поддержки теста, не доказанный
дефект прав доступа приложения.

## Замечание P2 — encrypted-key bootstrap не покрыт fixture

Место: `scripts/booking/role-browser-evidence.mjs:76` (seed),
`scripts/ci/fixtures/booking-role-sandbox.sql:18` (write allowlist).
В cleanup-логе PostgreSQL фактически обнаружен отказ INSERT в tenant_data_keys.
Стенд не подготовил tenant key ring; readonly app role правильно не имеет права
создать его. Настоящий `preloadTenantDataKeys` перехватывает bootstrap failure
как best-effort (`src/lib/crypto/tenant-data-keys.ts:142`), поэтому проверенные
legacy/plaintext роли/связи продолжают работать и15cases проходят.

Влияние: текущий положительный результат нельзя переносить на чтение encrypted
PII, создание ключей или новую запись с шифрованием. Это установленный пробел
fixture, не доказанный production-дефект и не «чистые логи без ошибок».
Для отдельного crypto acceptance нужны заранее созданные wrapped test keys и
encrypted synthetic rows на административной стадии с явными assertions;
расширять runtime права приложения ради подавления сообщения нельзя.

## Предупреждения сборки и граница runtime

Build завершён SUCCESS, но содержит ENOENT warning при копировании traced
`(dashboard)/page_client-reference-manifest.js` в `.next/standalone`. Этот стенд
запускает настоящий compiled app через `next start`, а не `.next/standalone/server.js`.
Поэтому runtime браузера доказан, а совместимость отдельного standalone entrypoint
этим run не сертифицируется. Предупреждения Sentry без auth token ожидаемы:
в стенд намеренно не передаются production provider secrets. Raw app logs
не публикуются. Эти факты не скрываются общим зелёным статусом.

## Проверка UI по пяти направлениям audit

| Направление | Доступное доказательство | Граница |
| --- | --- | --- |
| Доступность | Настоящие кнопки/links, labelled regions и aria-busy/pressed участвуют в тесте | Полный keyboard/focus/contrast/axe, срабатывание Escape-обработчика — NOT RUN |
| Производительность | Полный cold bundle PASS hosted; scope проверен на 5 встречах | Load, Web Vitals, большие списки и worker throughput — NOT RUN |
| Темизация | Стенд использует существующее приложение без нового CSS/темы | Новый dark-mode прогон — NOT RUN |
| Адаптивность | Текущий viewport 1440×1000 | Mobile/zoom/browser matrix в этом стенде — NOT RUN |
| Визуальные анти-паттерны | Оба финальных screenshots просмотрены: календарь показывает 2 встречи на26Oct; карточка задачи содержит Open meeting без перекрывающего тура | Не выдавать этот проход за полный новый дизайн-аудит |

Суммарный балл /20 не выставлен: перечисленные направления не измерены полностью.
Оценивать их по успешному role test означало бы выдать неизвестное за проверенное.
Предыдущие component/mobile/dark проверки остаются отдельными историческими
доказательствами и не называются свежим полным browser acceptance.

## Оставшиеся границы

Live production сотрудник/ограниченный координатор, public create/cancel,
Google/почта/внешняя доставка, encrypted PII/key bootstrap, standalone entrypoint,
revocation без навигации, полный migration replay,
accessibility/load/DR — **NOT RUN** в этом стенде по его изолированному scope.
Положительный синтетический результат дополнит, но не заменит переданный
production admin-smoke и будущую live ролевую приёмку. Старые I-03/I-04/I-06/
I-12/I-13 из предыдущего аудита этим PR не объявляются закрытыми.

В новом исходнике стенда блокирующих дефектов P0/P1 после критического прохода
не установлено; отмечены2P2 пробела покрытия. Стенд прошёл полный hosted PASS
и обязательные source checks на точной проверяемой версии. Production merge
или deploy не входит в задачу.

## Дополнительный review — 2026-10-25

Итог выше «2P2» относится к первому проходу и superseded в части общего числа:
[повторное ревью точного PR](review-20261025.md) добавило3P2 — owner identity
после фильтра «Мои», draft snapshot race и отсутствие прямых403 checks у двух
административных GET API. Две маленькие Node-диагностики подтвердили конкретные
контрпримеры assertions/gate. Итого5P2 покрытия/надёжности, не пять доказанных
ошибок приложения. Исходник и исторический15/15PASS не изменялись; production
release по этому review не разрешён.
