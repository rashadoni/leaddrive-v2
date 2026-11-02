# Изолированный стенд ролевой проверки встреч

Одноразовый GitHub-hosted Linux job запускает полную production-сборку Next.js
на loopback и отдельную PostgreSQL16 `booking_role_sandbox`. Production-секреты,
environment и сервер не используются. После job база, приложение и случайные
пароли исчезают; остаются только JSON-подтверждение и скриншоты вымышленных
данных. Это воспроизводимый автоматический стенд, не публичный staging URL.

Все пять P2 получили исправления исходника; fresh hosted acceptance пока
ожидается. Карта изменений и текущий допуск: [fixes-20261025.md](fixes-20261025.md).
Предыдущий run ниже — историческое доказательство исходника39ec68f.

## Сценарии

- Настоящие CSRF, credentials callback и проверка session для `sales` сотрудника,
  ограниченного `manager` координатора и `manager` без назначения команды.
- Две тестовые организации, пять принимающих, пять встреч с отдельными задачами.
  Координатору явно разрешено чтение другого принимающего; права управления не
  выданы. Другая команда и другой tenant служат известными отрицательными
  контролями, а не выдуманными несуществующими ID.
- Заполненные список/календарь при одинаковом дне/статусе/scope; фильтр «Мои
  встречи», карточка, сохранение периода, переход к связанной задаче и обратно.
- Отказ доступа к административным вкладкам, чужой карточке и недоступному
  task-link; право читать задачу не расширяет scope встречи.
- Для трёх ограниченных ролей — реальные HTTP403 обоих административных GET API
  без защищённых DTO. «Мои встречи» проверяет точные booking/host ID и UI owner.
- Wrapped tenant keys подготовлены через fenced admin до входа. Runtime не
  может менять ключи; проверяются scoped read, настоящий v2 roundtrip/отказ
  другой организации и отсутствие key-load failure в реальном приложении.
- Смена реальной сессии в том же browser context с повторной навигацией;
  отсутствие прежних прав в API/карточке.
- Хэши бизнес-таблиц до/после; application DB role не может менять эти таблицы.
  Разрешены только стандартные login metadata и личные UI favorites/recents
  вымышленных пользователей; эти изменения отдельно учитываются.
  Снимок включает также tenant_data_keys: всего восемь таблиц.

## Граница изоляции

До любых изменений проверяются `GITHUB_ACTIONS`, `RUNNER_ENVIRONMENT`, opt-in,
точные имена БД/ролей, loopback-адреса и согласованность URL. SQL повторяет
проверку имени базы. Приложение работает как NOSUPERUSER/NOBYPASSRLS, таблицы
tenant принудительно используют RLS. Booking-таблицы создаются фактическими
forward migrations; старые version=0 записи создаются до настоящего монотонного
включения workspace guard. Прочая схема создаётся Prisma в новой пустой БД,
поэтому это не полный replay всех исторических migrations продукта.

Runtime браузера блокирует внешние запросы и попытки бизнес-изменений.
Обычные PUT личных favorites/recents и POST локальной log-only CSP-диагностики
проходят настоящие handlers и отдельно считаются. Если появляется первый тур,
предусмотрено штатное закрытие Escape, без force click/подмены DOM/localStorage.
В историческом прогоне39ec68f этот обработчик не потребовался (toursDismissed=0).
Внешние публичные шрифты также блокируются и отдельно считаются; изображения
могут использовать fallback font. API-ответы и авторизация не мокируются.
Cookie/token/password/raw app logs и storageState в артефакт не попадают.

## Запуск и доказательства

Workflow `.github/workflows/booking-role-sandbox.yml` запускается на готовом PR
по связанным путям, включая меню, auth/RLS, crypto, route wrappers и build inputs.
Отдельный лёгкий job использует живой draft gate репозитория; read-only PR token
не передаётся application job. После принятия workflow в main его можно запускать
через `workflow_dispatch`. На постоянном dev Contabo полный build и browser
прогон не выполняются. Локально разрешены Node fence tests, синтаксис, scoped
lint, YAML/runner policy и whitespace.

Артефакт `booking-role-sandbox-<checked SHA>-<attempt>` хранится 14 дней.
`result.json` указывает head/checked merge SHA, хэши проверенных исходников,
этапы PASS либо конечный FAIL, версию Chromium, снимки бизнес-фактов и ограничения.
`workflow-context.json` при ранней ошибке остаётся PREPARING, это не PASS.
До успешного hosted run стенд считается подготовленным, а не проверенным.

Исторический [hosted run40175047313](https://github.com/rashadoni/leaddrive-v2/actions/runs/40175047313)
завершён SUCCESS: actual cold bundle и15/15 authenticated browser cases.
Candidate39ec68f1d0f7b640e8437d57b74ad7f5c3f06c27, проверенный merge50f205317e4d7d4ea155a786586f01c181ed7d60.
Сохранены [квитанция](evidence/result.json), [метаданные/digest](evidence/artifact-metadata.json),
[календарь координатора](evidence/coordinator-calendar.png) и
[задача сотрудника](evidence/employee-task-link.png). ZIP digest и16 source hashes
сверены; реальные screenshot просмотрены. Первый неуспешный run остаётся в
append-only журнале. Ограничения и P2 по будущим path triggers описаны в
[критичном аудите](critical-audit.md).

Все5 обязательных source contexts и booking-role-browser SUCCESS:
[source-checks.json](evidence/source-checks.json). Online Booking PostgreSQL27/27PASS.
Unit/type gates прошли неизменённые baseline без новых отклонений; существующие
18 failing files /1334 type diagnostics не выдаются за ноль ошибок репозитория.
Это результат исходника39ec68f до текущих исправлений, а не новый PASS.

Этот результат дополнит переданный локальный production admin-smoke. Он не
является приёмкой настоящих production employee/coordinator аккаунтов, live
Google/письма, public create или полного accessibility/load/DR. Смена сессии
проверяется с навигацией, а не как мгновенная cross-tab broadcast-инвалидация.
Broad encrypted-PII route acceptance и запуск standalone entrypoint не подтверждены.
Новая проверка ключей ограничена fixture provisioning/scoped read/v2 primitives
и preload реального приложения. Реальные прежние замечания приведены в аудите. Зелёный role result
не означает отсутствие всех backend/build warnings.

Развёртывание стенда не требует merge/deploy приложения. В этой задаче
production release не выполняется.

Дополнительное [ревью PR от25октября](review-20261025.md) установило ещё3P2
в assertions/draft gate. Исторический15/15PASS не отменяется, но не покрывает
эти контрпримеры. Обновлённый общий итог —5P2 покрытия после двух проходов,
без установленного P0/P1 в проверенном объёме. Исправления теперь внесены;
окончательное закрытие пяти пунктов требует fresh hosted proof.
