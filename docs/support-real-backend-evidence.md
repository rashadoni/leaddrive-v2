# Support real backend evidence — prepared, not executed

This test-only harness addresses five evidence gaps: macro persistence, escalation-rule persistence, portal resource ownership, AI settings audit/role/tenant boundaries, and Portal Users password/revocation/audit. Application files remain unchanged. The dedicated test-only workflow now runs on pushes to the explicitly authorized evidence branch.

## Current evidence boundary

The 10 real API/database cases are **NOT RUN**. Static review and local pure unit tests are not acceptance evidence for those cases. Real execution is restricted to a fresh GitHub-hosted Linux runner with disposable PostgreSQL; do not run Next or a database on the persistent Contabo host.

The harness uses actual Next development routes, credential/portal authentication, Prisma, a fresh candidate schema, synthetic tenants and users, and explicit fixture RLS. There is no auth, Prisma, route, or HTTP-response mock. It requires a restricted application database role and aborts before mutations if the role/RLS preflight fails.

## Case inventory

1. Restricted role, forced fixture RLS, and tenant isolation.
2. Macro create, fresh authenticated read, update, delete, denied role, foreign tenant.
3. Escalation create, duplicate rejection, update, delete, denied role, foreign tenant.
4. Portal own-ticket access and persisted idempotent reply; same-tenant sibling and foreign ownership denials.
5. Portal upload/download, owner-only attachment access, denied deletion with preserved bytes, and reply binding.
6. AI switch persistence, exact actor/audit projection, denied role and foreign tenant invariance.
7. Portal Users denied role and foreign contact mutation.
8. Password hash replacement, old password/token revocation, new authentication and disablement.
9. Persisted Portal Users audit with the authenticated actor.
10. Recovery-token expiry, successful single consumption, password persistence and replay refusal.

The audit case deliberately requires the real persisted AuditLog record. Static review currently finds that Portal Users writes a details field absent from the candidate Prisma AuditLog schema; its catch path reports auditRecorded=false. Existing mocked tests can hide this defect. This remains a potential real-run failure, not a runtime-confirmed result; do not weaken the assertion.

## Authorized hosted execution

The owner explicitly authorized publication and these ten isolated cases on 2026-10-04. The dedicated workflow checks out the exact push SHA on an ephemeral ubuntu-24.04 runner, uses Node 20 and npm ci, and creates a disposable PostgreSQL 16/pgvector container bound only to loopback with a generated password. Its branch fence excludes main. The workflow uploads only the sanitized receipt and removes its container with an always-run cleanup step. No production environment or repository secret is referenced. Playwright APIRequestContext needs no browser installation. Do not use a production database, existing service database, self-hosted runner, PR merge checkout or persistent development host.

Required environment, using disposable credentials only:

- CI=true; GITHUB_ACTIONS=true; RUNNER_ENVIRONMENT=github-hosted.
- SUPPORT_BACKEND_EVIDENCE=fresh-postgres-v1.
- SUPPORT_BACKEND_HEAD_SHA and GITHUB_SHA must both equal git rev-parse HEAD.
- GITHUB_WORKSPACE must equal the clean checkout; RUNNER_TEMP must exist.
- SUPPORT_BACKEND_ADMIN_URL must be a postgres/postgresql URL with username postgres, a generated nonempty password, explicit port, host 127.0.0.1 and database /postgres, without query or fragment.
- NODE_ENV must not be production. Auto-loaded .env files are refused.

Invoke node scripts/support-backend-evidence.mjs. The harness generates Prisma, creates its own support_backend_evidence database (refuses an existing one), creates a random non-superuser/non-BYPASSRLS role, seeds synthetic fixtures, runs a loopback Next development server, executes the cases once, and cleans up only its own resources. Child commands have deadlines and owned process groups receive TERM then KILL if necessary.

Only upload artifacts/support-backend/receipt.json. Raw application/setup logs remain under private RUNNER_TEMP and can contain synthetic authentication material; do not publish them. The receipt contains sanitized fixed error codes, exact SHA attribution, all expected case outcomes, cleanup status and blocked outbound-attempt count. Overall PASS requires all 10 cases, cleanup PASS and zero blocked outbound attempts. Failure or absent cases cannot become PASS.

A narrowly constructed child environment excludes ambient SMTP/provider/cloud/proxy credentials. The Node transport guard blocks non-loopback sockets, DNS and UDP. Fresh organization settings have no external transports configured. This is a fixture fence, not a substitute for runner-level network isolation or production security testing.

## Explicit exclusions

No production bundle/build, full production migration replay, escalation scheduler, external AI/telephony, email or reset-link delivery, real customer/HR data, macro category persistence, closure-token expiry/confirmation, complete role/localization/browser matrix, or production Redis rate-limit validation. Public rate limits use unchanged development memory fallback. These exclusions remain separate acceptance work.

## Permitted local verification

node --test scripts/ci/tests/support-backend-evidence-guards.test.mjs scripts/ci/tests/support-backend-evidence-process.test.mjs

These tests exercise pure context/environment guards, loopback-only transport behavior, actual local refusal before dependencies load, private child logging, nonzero exit, spawn failure, deadlines and process termination. They do not connect to PostgreSQL or start Next.
