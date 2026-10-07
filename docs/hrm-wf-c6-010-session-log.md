# WF-C6-010 — журнал продолжения HRM

Журнал дополняется; прежние результаты и ошибки сохраняются.

## 2026-10-07 — начало реализации на Contabo

- Поручение: продолжить существующий HRM, реализовать ручную HR-классификацию ошибочного срабатывания и исходов апелляции (полностью / частично / отклонена), хранение, API, UI, валидацию, неизменяемый аудит и агрегаты. Частичный исход отдельно; процент только по окончательно рассмотренным классифицированным случаям. Открытые, повторно открытые, неклассифицированные исключены; пустая выборка даёт null. Исправление табеля не доказывает ошибку или удовлетворение апелляции. CASE_RECORDED_AT, роли, tenant isolation, приватность и запрет автоматических кадровых решений сохраняются.
- Авторизация: checkpoint, push собственной ветки, зависимый draft PR, проверки и независимый review. Запрещены merge/deploy/activation/production/access/secrets; Support и HRHub вне задачи.
- Исходный checkout dirty, сохранён без изменений. Новая чистая ветка `codex/hrm-wf-c6-010-recorded-decisions-20261007`, worktree `/mnt/HC_Volume_106454338/codex-alt-data/worktrees/leaddrive-hrm-wf-c6-010-recorded-decisions`, от принятого PR608 SHA `973241bacc296b71fe817d1af11187c32e8126af`.
- Origin `https://github.com/rashadoni/leaddrive-v2.git`; production `13.140.132.245:/opt/leaddrive-v2`; release только GitHub Actions из reviewed main. Пользовательский запрет выпуска приоритетен над standing permission AGENTS.md.
- Live GitHub refs: PR589 `a856a9e533c4f3cec6f2313e69f5be0d5b4d4226` → PR605 `bf6ed11f2bba8c93e828fb044315794b44224741` → PR608 `973241bacc296b71fe817d1af11187c32e8126af`; PR606/609 имеют те же проверочные heads и НЕ предназначены для merge. Main `5d71a9a616f9749a6245e211b4f687af7ef8aa8f`.
- Список чатов: предыдущие HRM-сессии idle; текущий чат единственный active HRM. Чужие процессы и worktrees не останавливались и не изменялись.
- Сохранённая точка: предыдущие облачные попытки закончились ERROR без diff; теперь реализация разрешена на подключённом Contabo. Новые сессии на Mac не запускаются.
- Архив `c123556e7a758b7eb5264137dcaf85504b07e471` отсутствовал в object store: первоначальный cat-file завершился ошибкой. SHA успешно получен fetch; содержимое `docs/evidence/workforce-c12-terminal-973-2026-10-06` доступно через git show, не заменяет текущие проверки.
- Учёт пользователя: 84/161 выполнено, 77 открыто, weighted 60%; C7-007/C8-002 закрыты, C12 partial. Статусы не изменены.
- Safety lane: сначала изучить lifecycle/ledger/authorization, затем добавить явный outcome в immutable ledger и конечный snapshot; после targeted checks независимый review, hosted PostgreSQL/browser/regressions и CI точного финального SHA. Полные сборки, browser E2E, dependency-wide checks на Contabo не запускаются.
- Начальная нагрузка: RAM 12GiB available, диск 283GiB available, memory full avg10 0.97, IO full avg10 0.43. Локальные проверки ещё NOT RUN.

Точка: чистый worktree создан, refs сверены, контракты изучаются. Следующее действие: реализация WF-C6-010.

## 2026-10-07 — реализация и первые проверки

- Добавлены 5 зарезервированных кодов outcome в существующий append-only decision ledger. Lifecycle разрешает одну классификацию срабатывания и один исход апелляции только после RESOLVED; REOPEN сбрасывает текущие классификации без удаления истории. Generic inactive writer отклоняет эти коды.
- Действующий scoped HR_ADMIN обязателен; TEAM_MANAGER, TENANT_ADMIN и AUDITOR не получают новую HR-власть. Повторная проверка живых допусков после case lock; токены principal/org/action/revision, MFA, лимитер и body-only API сохранены.
- Очередь получила отдельный outcomeContext и inline HR-подтверждение с закрытым обоснованием. Причина не включается в API response, отчёт или дополнительный audit metadata. Authoritative immutable audit — сама decision envelope с actor/reason/revision; MtmAuditLog является дополнительной записью, его production append-only не утверждается. Схема и миграции не изменяются.
- Отчёт: независимые выборки classification/appeal, полный/частичный/отклонённый отдельно, исключения unfinished/unclassified/integrity и null процентов. CASE_RECORDED_AT, RR snapshot, linked-correction и время первого решения сохраняются.
- Контекст UI: HR и аналитика из поручения; существующий сдержанный CRM/evidence-led стиль `.impeccable.md`, без переноса разделов или смены дизайна.
- Первые targeted проверки: 5 файлов/90 тестов PASS; очередные 5 файлов/46 тестов PASS. i18n parity PASS (24587 ключей, missing/extra=0 ru/az). Зависимости взяты read-only symlink из существующего cache с идентичным package-lock SHA256 `54c9be2264ef8e1ec5f8b0d9c545ba868c24de938ee0cf3734f4c475e62c816f`; generate в shared cache не выполнялся. RAM перед проверками 15–16GiB available, memory full avg10=0, диск283GiB.
- Во время source inspection независимый агент обнаружил не вставленное поле обоснования: исправлено до browser acceptance; это первоначальный дефект, не успешная проверка UI.
- PostgreSQL/browser/полный compiler/full suite/build: NOT RUN на Contabo согласно workload contract; готовятся hosted gates. Бизнес/эксплуатационные наблюдения NOT RUN и не заменяются синтетикой.
- CI существующего pr-checks ограничен base main и пропускает draft. Зависимая цепочка сохраняется; проверки будут exact-ref dispatch существующего report-browser workflow с дополнительными изолированными gate jobs, без ослабления существующих guards/baseline и без validation PR, способного нарушить цепочку.

Точка: функциональная реализация готова, targeted regression/i18n PASS; дополнительные outcome тесты и hosted verification готовятся. Следующий шаг: review, checkpoint, dependent draft PR и CI точного head.

## 2026-10-07 — расширенные проверки и gate preparation

- Новые semantic/inactive-writer тесты: 2 файла/56 тестов PASS. Scoped source lint PASS; git diff --check PASS.
- Runner policy PASS для 47 workflows. Первая дополнительная YAML-проверка через Node завершилась MODULE_NOT_FOUND (yaml parser отсутствует в cache), сохранена как инструментальная ошибка; повторная проверка штатным Python PyYAML разобрала все5 jobs успешно, dependency не устанавливался.
- Source reviewer первоначально заявил об отсутствии outcome vocabulary в schedule-only whitelist; актуальная source inspection показала существующий spread. Агенту поручена повторная сверка и additive correction результата. Независимо добавлен sequential schedule-only regression, чтобы подтверждать обе независимые dimension.
- Hosted gates опционально запускаются только workflow_dispatch с непустым expected_head: source/regression/PG, full compiler с unchanged blocking gates, bundle build с inert test configuration, отдельный real HR recording browser с disposable PG+Redis. Existing report/browser/draft guards сохранены. Только hosted ephemeral Linux, production secrets не запрашиваются.

- Дополнительные текущие scoped regressions: 4 файла/36 тестов PASS. Исходный schedule-only review finding superseded: независимый агент повторно подтвердил, что актуальный whitelist включает outcome коды; focused sequential test PASS.
- Отдельный browser write fixture использует disposable PG+Redis, exact production decision revision/timestamp/append-only routines и узкие синтетические guard grants. Это проверка API/ledger на синтетических tenants, не production permissions и не operational evidence.
- Подготовка первого checkpoint: production source/UI/API/metrics и тесты реализованы; full hosted review/PG/browser/CI/build ещё PENDING, WF-C6-010 не закрыт и 84/161/60% не изменены.
