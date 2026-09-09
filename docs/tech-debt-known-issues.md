# Known pre-existing tech debt

This file catalogues tech debt that exists **outside the scope of Phase 1** of
the TT gap closure. These issues were present on `main` **before** the Phase 1
work started and are not regressions introduced by it.

Each entry lists: what, where, why it was out of scope, and how to reproduce /
fix.

---

## 1. Pre-existing failing tests (25 failures across 7 files)

Current snapshot: `npx vitest run` reports `25 failed | 1920 passed (1945 total)`.

All failures are concentrated in these 7 files — they were already red on
`main` before any Phase 1 commits, verified by `git stash && npx vitest run ...`:

| File | Failures | Rough cause |
|---|---|---|
| `src/__tests__/api-finance-funds.test.ts` | 1 | Mock shape drift on `prisma.fundTransaction` balance check |
| `src/__tests__/api-invoices-sub.test.ts` | 1 | HTML-act template mock returns wrong header |
| `src/__tests__/api-mtm-misc.test.ts` | 1 | MTM settings upsert expects deprecated key layout |
| `src/__tests__/api-projects-detail.test.ts` | 10 | Project detail routes hit missing auth mocks |
| `src/__tests__/api-projects.test.ts` | ~5 | Same root cause as detail file |
| `src/__tests__/api-tasks.test.ts` | ~5 | Task routes return 401 — auth mock not seeded |
| `src/__tests__/auto-assign.test.ts` | 2 | "least-loaded agent" ordering flips when 2 agents tie |

**Why out of Phase 1 scope:** none of these files touch workflow-engine, SMS,
OTP, or templates. They are legacy test-suite hygiene owed by the teams that
own those modules (finance, invoices, MTM, projects, tasks, auto-assign).

**Reproduce:** `npx vitest run src/__tests__/<file>`. All 7 files fail on a
clean `main` checkout as well.

**Recommendation:** open a dedicated cleanup task per module owner. Do not
block Phase 2–4 on these.

## 2. Pre-existing TypeScript errors

`npx tsc --noEmit` reports errors in the following pre-existing files:

- `next.config.ts` — `hideSourceMaps` is not a valid Sentry option (was a
  typo — should be `sourcemaps`).
- `src/__tests__/api-admin.test.ts`, `api-ai.test.ts`, `api-ai-extras.test.ts`,
  `api-auth-totp.test.ts`, `api-budgeting-cashflow.test.ts`,
  `api-budgeting-forecast.test.ts`, … — Next 16 tightened `RequestInit.signal`
  to `AbortSignal | undefined` (not `| null`), and old test fixtures still
  pass `signal: null`. Mechanical fix across dozens of call sites.
- `src/__tests__/api-ai.test.ts:13,15` — object literal with duplicate keys.

**Why out of Phase 1 scope:** these errors exist across ~30 test files and
`next.config.ts`. Fixing them is a refactor that touches unrelated suites and
risks masking other issues. Phase 1 makes the situation no worse — all new
files (`src/lib/sms.ts`, `src/lib/sms/providers/*`, `src/lib/workflow-templates.ts`,
`src/app/api/v1/auth/sms-otp/**`, `src/app/api/v1/workflows/templates/route.ts`,
`src/app/api/cron/otp-cleanup/route.ts`, `src/app/api/v1/calls/webhook/route.ts`,
`src/app/(dashboard)/settings/workflows/templates/page.tsx`,
`src/components/sms-2fa-card.tsx`, `src/__tests__/lib-sms-otp.test.ts`,
`src/__tests__/lib-workflow-templates.test.ts`,
`src/__tests__/api-calls-webhook-missed.test.ts`) have **0 TS errors**.

**Verification:**
```bash
npx tsc --noEmit 2>&1 | grep -E "lib/sms|workflow-templates|sms-otp|workflows/templates|calls/webhook|otp-cleanup|sms-2fa-card"
# → empty output
```

**Recommendation:** dedicated typecheck cleanup sweep. The Next 16 migration
notes already flag the `signal: null` change — should be a codemod-friendly
transformation.

## 3. Things explicitly NOT built in Phase 1 (flagged as future work)

These are intentionally deferred and should not be confused with debt:

- **Real Twilio smoke test for missed-call** — requires a live Twilio number
  and physical phone call. Documented in `docs/sms-otp.md` under
  "What's not done yet". The synthetic E2E test in
  `src/__tests__/api-calls-webhook-missed.test.ts` covers the call-flow
  logic; the remaining gap is purely Twilio API credentials + telco routing.

- **OTP audit trail table** — current cleanup cron in
  `src/app/api/cron/otp-cleanup/route.ts` keeps used codes for 7 days then
  purges them. If a future compliance requirement needs longer retention, add
  a `otp_audit` table and rewrite the cleanup to move rather than delete.

- **Per-action send_sms config UI** — the template preview modal in
  `src/app/(dashboard)/settings/workflows/templates/page.tsx` allows
  customizing `subject`, `body`, `message`, `title`. Fields like `delay`,
  `assignTo`, `url` are not exposed yet. Add them when a concrete template
  requires customer-facing customization.

- **SMS providers beyond the registered set (Twilio, Vonage, ATL)** — the abstraction in
  `src/lib/sms/providers/types.ts` + registry in `src/lib/sms.ts` is ready.
  AWS SNS, MessageBird, etc. can be plugged in without touching `sendSms` or
  `sendOtp`.
