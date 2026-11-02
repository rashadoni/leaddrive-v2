# Подготовка безопасного выпуска встреч — журнал

## 2026-10-24 — Возобновление по «начинай»

- Продолжение задачи из отдельного worktree `leaddrive-booking-workspace-architecture-20261024`, draft PR #1023, проверенный source `91dd1edc2a3fbe889e42ecc1477760dcdeb645fa`.
- Пользователь просит выполнять согласованную работу без промежуточных подтверждений и отчитаться в конце.
- Повторный штатный SSH через `leaddrive-prod` отклонён: publickey. Ключи, authorized_keys и production не изменены.
- Выделен отдельный чистый worktree/branch `codex/booking-release-preflight-20261024` от `origin/main` (`64356065f3878a547bdd5fa87cbf9f789f1f92a2`), чтобы инструмент инвентаризации можно было доставить независимо от опасной миграции feature PR.
- План safety lane: подготовить ограниченный read-only inspector через существующие protected GitHub Actions/SSH; проверить его отрицательные сценарии; оформить этапы совместимого выпуска. Не снимать DB guard и не выдавать старый main за совместимый откат.
- Текущая маршрутизация: `rashadoni/leaddrive-v2`, production `13.140.132.245:/opt/leaddrive-v2`, только `main` → Actions. Проверки/сборки — hosted Linux; на Contabo только узкие последовательные проверки.

## 2026-10-24 — Инструмент и протокол подготовлены

- Public build-info фактически отвечает: `artifactSha=64356065f3878a547bdd5fa87cbf9f789f1f92a2`; он совпадает с исходным main. Это подтверждение версии, не inventory данных.
- Добавлены read-only SQL, генератор удалённого скрипта с повторным использованием reviewed static env/libpq helper и строгий sanitizer. Workflow только explicit dispatch на main, protected production environment, pinned SSH и serialization `production-deploy`.
- Локальные узкие проверки: 7 unit tests PASS, один PostgreSQL acceptance NOT RUN на Contabo (нет psql/изолированной службы; обязан запускаться в disposable hosted PostgreSQL16 job). Внешний CI не подменяется локальным пропуском.
- Plan A/B в `docs/booking-release-cutover-plan.md` перечисляет исполняемые условия fence/drain, совместимого backend A и exact-artifact rollback. Контроллер и этап A ещё не реализованы; I-05 остаётся открытым. DB guards не ослаблены.
