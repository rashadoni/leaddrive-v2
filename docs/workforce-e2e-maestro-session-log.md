# Учёт времени: E2E и Maestro — журнал сессии

## 2026-10-21 — запрос и начало

- Запрос пользователя: сделать E2E и Maestro тесты модуля учёта времени от лица кадровика и сотрудника; пользователь подключает телефон; привлекать его только при неустранимом самостоятельно препятствии.
- Исходная папка `/home/codex-alt/projects/leaddrive-v2` содержит чужие изменения и конфликтующие документы; она не изменяется.
- Создан приложением отдельный worktree `/home/codex-alt/.codex/worktrees/workforce-e2e-maestro/leaddrive-v2`, ветка `codex/workforce-e2e-maestro`, база `092221a2f` из актуального `origin/main`.
- Origin: `https://github.com/rashadoni/leaddrive-v2.git`. Актуальные AGENTS.md, docs/DEPLOYMENT.md и clients/registry.json согласованы: production `13.140.132.245:/opt/leaddrive-v2`, выпуск через PR/main/GitHub Actions. Старые маршруты в исходной папке не используются.
- Активный запрос разрешает создание и запуск тестов, но не содержит отдельного разрешения push/merge/deploy. По переданному пользователем контракту эти действия требуют разрешения для данной задачи.
- Тяжёлые браузерные прогоны/сборки/Android — только GitHub CI либо разрешённый внешний worker. На Contabo только небольшие последовательные проверки.
- План: изучить реальные роли и существующие стенды; добавить повторяемые сценарии и инструкции запуска; выполнить доступные проверки; сохранить точные PASS/FAIL/NOT RUN и препятствия.
- Начальная диагностика: ADB установлен, `adb devices -l` пуст. Maestro не найден. Инструмента управления телефоном или выполнения команд на Mac в текущем чате нет; доступные SSH aliases не содержат Mac/build worker.
- Ресурсы перед диагностикой: ~16 GiB RAM available, 162 GiB disk free, memory PSI avg10=0.00.
- Найдены нативное приложение `apps/workforce-android` и отдельные hosted browser evidence workflows для кадровика и сотрудника. Maestro flow-файлов пока не найдено.

## 2026-10-21 — уточнение активного продукта и запуск проверок

- Уточнение к первичному поиску: Workforce выведен из CRM. Активный продукт — MTM Attendance (`/mtm/attendance`) и React Native приложение `rashadoni/leaddrive-mtm`, package `com.mtmobileapp`. Нативный `apps/workforce-android` не является объектом текущих тестов.
- Существующий E2E `scripts/mtm-attendance-browser-evidence.mjs` проверяет браузер кадровика, роли, мобильный HTTP и настоящие записи в одноразовой PostgreSQL. Запущен новый exact-SHA прогон https://github.com/rashadoni/leaddrive-v2/actions/runs/39556643325 для `092221a2f1a7302458ad0ed050443c1c38e68182`.
- Первый dispatch 39556603199 имел ошибочно набранный head_sha и был отменён; он не является доказательством проверки. Исправленный запуск выше использует SHA, полученный `git rev-parse`.
- Актуальный mobile main `f5d80b618a760347411532250b55e6e80aac74d8`, опубликованный APK `v3.11.49-build710`. Запущен существующий CI emulator workflow в режиме attendance_fixture, только с его отдельными synthetic credentials.
- Пользователь подключил телефон через существующий ADB tunnel localhost:35037. Подключён один Samsung SM-S918B. На телефоне установлен MTM 3.11.42 / 1675. Серийный номер и приватные UI-дампы не публикуются.
- Пользователь попросил команды отдельным копируемым блоком, а не внутри длинного вопроса; это предпочтение сохранено.
- Пользователь предложил отдельное приложение, чтобы завтра ничего не перемешалось. Уточняем: отдельная тестовая копия или самостоятельный продукт. До ответа не меняем идентификатор/релиз и не создаём отметок на устройстве.
- Приватные материалы текущей диагностики: `/mnt/HC_Volume_106454338/codex-alt-data/tmp/mtm-maestro-device-20261021`, mode 0700. Это не артефакт для Git.

## 2026-10-21 — завершение свежих CRM E2E и отдельный мобильный клиент

- CRM run https://github.com/rashadoni/leaddrive-v2/actions/runs/39556643325 SUCCESS, exact source 092221a2f1a7302458ad0ed050443c1c38e68182. Сохранён sanitized manifest docs/workforce-e2e-maestro-evidence.json: 64 PASS / 0 FAIL / 5 NOT_RUN. Реальные credentials roles, изолированная PostgreSQL, browser HR действия, mobile HTTP с DB receipts, idempotency/tenant границы. Это не физический APK.
- NOT_RUN: физические OS permissions, настоящая email доставка, camera/QR/offline replay, overnight soak, все комбинации controls. Не маскируются browser результатами. Production данные этим прогоном не менялись.
- Existing MTM emulator run39556842312 SUCCESS проверил опубликованный 3.11.49 login/theme/tabs/profile/logout на вымышленном field account; отметки/заявки НЕ выполнял.
- По уточнению пользователя «оставь серверную часть а приложение отдельное» реализация перенесена в правильный мобильный repository rashadoni/leaddrive-mtm, worktree /mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-standalone, branch codex/attendance-standalone. Backend остаётся прежним, архивный workforce клиент не возрождается. Мобильный журнал: docs/attendance-standalone-session-log.md в указанном worktree.
- Телефон доступен через существующий remote ADB; официальный Maestro2.11.0 уже обнаруживает Android через локальный relay. Отдельный APK com.leaddrive.attendance собирается hosted CI39559382298; полный Jest/TypeScript PASS, сборка ещё идёт. Рабочий com.mtmobileapp3.11.42/1675 не заменялся и его appdata не очищались.
- Продолжение: получить отдельный APK, установить рядом, войти только в owned fictional office fixture и выполнить Maestro journeys.

## 2026-10-21 — physical standalone test exposed explanations authorization defect

- Separate mobile branch/PR: codex/attendance-standalone, rashadoni/leaddrive-mtm#196. Final APK com.leaddrive.attendance1.0.0/1004, sourcecb08fff installed beside untouched MTM3.11.49/1710; physical onboarding/restart PASS on Samsung S23 Ultra/Android16.
- Guarded encrypted phone-fixture access39564939239 SUCCESS; private credential never committed. Exact office mobile principal and Auth.js fixture admin verified. Initial complete baseline8requests/7inbox; today fresh. Real UI login PASS. Private helpers/evidence under /mnt/HC_Volume_106454338/codex-alt-data/tmp/mtm-maestro-device-20261021.
- Real Maestro employee smoke FAIL: explanations-unavailable. Same valid mobile token: bootstrap200, requests200, explanations401 Unauthorized. Servingd73f9c23; current origin/main91cfef9e also lacks explanations in officeAttendanceMobilePath. Edge allowlist and endpoint already exist; fresh office authentication rejects before handler. This affects existing office mobile clients as well as standalone.
- Added exact GET/POST explanations allowance only. Regression runs actual resolveMobileAuth for own employee and Personnel-only EMPLOYEE/MANAGER/SUPERVISOR/ADMIN; unsupported methods, detail paths and HR decision path stay denied. RED:6failed/27passed beforefix. GREEN:3targeted suites/107PASS afterfix (office auth, general mobile scope, employee API). git diff --check PASS. Existing dependency cache linked via own untracked node_modules symlink, not staged.
- Full build/typecheck/full browser E2E NOT RUN for this server patch on Contabo by host contract. Earlier64-case hosted E2E is evidence for092221a2, not this patch. Source fix ready for review/checkpoint; CRM push/merge/deploy remains unapproved for this active turn. No production mutation has been made.
- A single isolated live HR browser opened the actual fixture request queue; this is a bounded targeted UI check, not a full local browser suite. No HR decision yet. Phone validation/workday/request journeys continue independently. Detailed mobile progress in /mnt/HC_Volume_106454338/codex-alt-data/worktrees/mtm-attendance-standalone/docs/attendance-standalone-session-log.md.
