# Workforce C4 — encrypted evidence and derived assessments

> **Checkpoint:** `WF-C4-006` — 2026-08-30
>
> **Scope:** storage, separation and bounded purge primitives. No mobile/API
> capture endpoint is enabled by this checkpoint.

## Delivered behaviour

`WorkforceAttendanceEvidence` is an append-only row for exactly one canonical
workday event or site transition. It stores a tenant-bound payload HMAC,
redacted receipt, canonical raw envelope encrypted with the existing
column-bound tenant AES-GCM helper, and a fixed capture-based 30-day raw
expiry/one-way `rawPurgedAt` marker. It never creates latitude/longitude
database columns.

`WorkforceEvidenceAssessment` is a separate append-only derived ledger. It
stores verdict/reason/policy/revision and optional derived distance/accuracy,
but no ciphertext or raw coordinates. A report projection selects only the
assessment and redacted evidence identity; it cannot select raw ciphertext.
After due purge, the receipt and assessment continue to exist while
`rawEnvelopeCiphertext` is set to `NULL`.

The database requires exactly one subject (event or site transition), tenant-
scoped foreign keys, unique operation reference, RLS, and append-only guards.
Evidence can be modified only by the single expired-ciphertext purge path;
assessments cannot be mutated or deleted.

## Boundaries

- Raw encryption uses the established server-only `TENANT_PII_MASTER_KEY`
  helper and column-bound AAD. Key lifecycle, backup/restore proof, legal
  hold and scheduled operational purge belong to C10/C12.
- This creates no employee evidence endpoint, no background capture and no
  report UI. C9 mobile/C8 web are still required before real evidence arrives.
- A derived verdict is not identity proof, payroll approval or discipline.
  Review/timesheet policy remains C6/C11 work.

## Verification

```text
npx vitest run src/__tests__/workforce-evidence-storage.test.ts \
  src/__tests__/workforce-evidence-envelope.test.ts \
  src/__tests__/workforce-geofence-evaluation.test.ts \
  src/__tests__/migration-workforce-evidence-assessments.test.ts \
  --pool=forks --maxWorkers=1

4 files passed, 13 tests passed

DATABASE_URL='postgresql://unused:unused@127.0.0.1:5432/unused?schema=public' \
  npx prisma validate --schema=prisma/schema.prisma
PASS

npx eslint [targeted evidence-storage/test paths]
PASS

git diff --check
PASS
```

## Not run

- `prisma generate`: **NOT RUN** — shared-host heavy gate unavailable; run in
  GitHub CI/approved worker before creating a deployable artifact.
- Full TypeScript check, production build, browser E2E, Android, scheduled
  purge drill and load: **NOT RUN** — heavy/external gates belong to GitHub
  CI, approved worker or an authorized controlled pilot.
