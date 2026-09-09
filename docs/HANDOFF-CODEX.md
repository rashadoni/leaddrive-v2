# Хендофф Codex — Social Monitoring readiness

Готовый бриф для автономного продолжения. Источник истины остаётся
[`SOCIAL-MONITORING-CLIENT-READINESS.md`](./SOCIAL-MONITORING-CLIENT-READINESS.md);
этот файл — только точка входа.

## База

Ответвись от ветки `claude/leaddrive-v2-autonomous-0btdk4` (в ней CR-0..CR-5
модули и открыт draft PR #303). Если PR уже смёржен в `main` — ответвляйся от
актуального `origin/main`. Работай в отдельной чистой ветке.

Сначала полностью прочитай: `AGENTS.md`,
`docs/SOCIAL-MONITORING-CLIENT-READINESS.md`,
`docs/social-monitoring-v2-architecture-plan.md`,
`docs/social-monitoring-collector-runbooks.md`.

## Уже сделано — НЕ переделывай, переиспользуй

- **CR-0** — capability inventory + coverage-contract API/UI
  (`src/lib/social/capability-inventory*.ts`,
  `src/app/api/v1/social/coverage-contract/route.ts`,
  `src/components/social/coverage-inventory-card.tsx`).
- **CR-1** — `collector-error-classifier.ts` + class-aware circuit breaker в
  `source-route-plan.ts`.
- **CR-2** — `relevance-evaluator.ts` + `decideSubjectRelevance`
  (`subject-relevance.ts`).
- **CR-5** — `ai-gate-evaluator.ts` + расширенный `classifySocialAiTopic`
  (9 категорий) в `ai-reply-policy.ts`.

Архитектурные PR1–PR6 реализованы — не повторяй.

## Задачи (только безопасные, без внешних решений; строго по одной, по порядку)

1. **Баг нормализации** (быстрый, без миграции). `normalizeSubjectTerm()` в
   `src/lib/social/monitoring-subjects.ts` использует `toLocaleLowerCase("az")` →
   латинская `I` превращается в `ı`, ALL-CAPS латинский текст (OCR) не матчит
   mixed-case алиасы. Почини стабильную нормализацию латиницы/кириллицы, не сломав
   азербайджанские спецбуквы. Регресс-тест (в т.ч. `"ACME ROBOTICS"` → матч
   `"Acme Robotics"`). Сверь subject/relevance тесты.

2. **CR-2.2 — operator feedback loop** (schema-slice, RLS). Tenant-scoped таблица
   `SocialRelevanceFeedback` (`RELEVANT / NOT_RELEVANT / DUPLICATE / WRONG_SUBJECT /
   MISSED_RISK`), хранит `matcherVersion + subjectId + mentionId`, `FORCE RLS`,
   composite `(organizationId, …)` FK, API-роут записи. Rejected feed не попадает в
   долговременную память агента. + weekly quality report (SQL rollup по
   tenant/subject/platform) поверх `relevanceStatus` + feedback.

3. **CR-1 follow-ups** (без внешних решений): generic replay из `IngestEnvelope`
   без нового billable fetch; USD daily/monthly budget fail-closed для не-Apify
   платных адаптеров (X/YouTube/TikTok); выделенный stale-lease reaper; пагинация
   legacy `pollAllYouTube` (сейчас одна страница по 50 — тихая потеря).

4. **CR-8 (код, без выбора цен)**: billable-units ledger + margin-калькулятор
   поверх `monitoring-rollups`. Значения цен/лимитов не придумывай — конфиг владельца.

## Правила

- Один логический slice = один path-scoped commit; НЕ `git add .` / `git add -A`.
- После каждого slice: targeted tests +
  `npx tsc --noEmit -p tsconfig.social-monitoring.json` + `git diff --check`; при
  изменении переводов — `node scripts/check-translations.js`.
- При изменении Prisma/schema/RLS: `prisma validate`/`generate`, миграция по
  процедуре (backfill RLS-таблиц только через DO-блок snapshot/disable/restore,
  образец `20260705152500_..._rls_backfill`), cross-tenant проверка под
  `NOSUPERUSER NOBYPASSRLS`, `python3 scripts/rls/find-context-gaps.py` = 0.
- Evidence log обновляй только после фактической проверки; статусы честно:
  `VERIFIED / PARTIAL / BLOCKED / NOT RUN`.
- НЕ включай live-send флаги; НЕ выполняй платных provider/OCR/ASR/LLM вызовов;
  НЕ храни секреты/токены в git; НЕ удаляй prod data; НЕ пушь в `main` без разрешения.

## Останавливайся и передавай владельцу (не имитируй готовность)

credentials / внешний кабинет, оплата / договор, ToS / DPA, юридическое решение,
pricing / SLA / retention, подключение реального аккаунта, sandbox / live действие,
реальные клиентские данные, необратимое удаление prod data. Зафиксируй evidence,
оставь route `BLOCKED`, продолжай остальные безопасные независимые задачи.

Полный перечень внешних блокеров — в Evidence log readiness-плана (строки CR-3,
CR-4, CR-6, CR-8, CR-9).

## Проверка всего

```bash
npx tsc --noEmit -p tsconfig.social-monitoring.json
node scripts/check-translations.js
npx vitest run social monitoring relevance subject reply triage draft outbound collector
npm run lint:pii-columns
git diff --check
```

Базлайн: 6 файлов / 7 тестов падают давно и не связаны (см. `CLAUDE.md`) — сверяйся
с базлайном, не с нулём.

После каждого этапа: обнови checklist + Evidence log, перечисли изменённые файлы,
path-scoped commit + push в свою ветку, открой/обнови draft PR.
