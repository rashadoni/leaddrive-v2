# Workforce C4 — QR station/site binding

> **Checkpoint:** `WF-C4-004` — 2026-08-30
>
> **Scope:** QR v2 security contract and immutable station lifecycle. This is
> not a mobile scanner release or proof that a QR scan identifies a person.

## Delivered behaviour

A newly created Workforce QR station must name a tenant Workforce site, an
immutable same-site geofence revision, optional Workforce-local area label and
an effective window. The database checks tenant FKs and a trigger checks that
the selected revision belongs to that site and covers the full station window.
The binding is immutable: changing a station's site/revision means disable it
and create a separately auditable successor.

QR wire protocol `wa2` signs all of the following under the tenant-scoped
server HMAC:

- tenant (through the signing domain), station ID, site ID and geofence
  revision ID;
- exact `START`/`PAUSE`/`RESUME`/`FINISH` action;
- random nonce, issue time and bounded expiry.

Server verification rejects a token for another tenant, action, station/site
binding, revision, inactive/effectively unavailable station, expiry or replay.
Only the tenant-bound nonce fingerprint is retained by the pre-existing proof
ledger; raw QR tokens and nonces are never persisted.

## Safe legacy boundary

The migration is additive. Old station rows are retained for audit but have
no invented site/revision. They cannot issue or verify v2 QR until an admin
creates a bound successor. `wa1` tokens are not accepted. This fail-closed
cutover is deliberate: guessing an old display's physical site would weaken
the evidence contract.

## Boundaries

- A QR proves that a client saw a fresh signed token; it does not prove the
  named employee, non-relay proximity or a disciplinary fact.
- C4-005 chooses when QR is required with other methods. C5 continues device
  lifecycle/attestation and C9 supplies the mobile scanner.
- No Route customer, route or customer geofence relation was added. `areaLabel`
  is a Workforce-local descriptive context, not Route data or new geometry.

## Verification

```text
npx vitest run src/__tests__/workforce-attendance-security.test.ts \
  src/__tests__/workforce-attendance-management.test.ts \
  src/__tests__/workforce-attendance-trust.test.ts \
  src/__tests__/api-workforce-attendance.test.ts \
  src/__tests__/migration-workforce-qr-site-binding.test.ts \
  --pool=forks --maxWorkers=1

5 files passed, 22 tests passed

DATABASE_URL='postgresql://unused:unused@127.0.0.1:5432/unused?schema=public' \
  npx prisma validate --schema=prisma/schema.prisma
PASS

npx eslint [targeted QR station/security/trust/API/test paths]
PASS

git diff --check
PASS
```

## Not run

- `prisma generate`: **NOT RUN** — `codex-heavy-run` shared-host gate is not
  available; run it in GitHub CI/approved worker before a deployable artifact.
- Full TypeScript check, production build, browser E2E, Android and load:
  **NOT RUN** — heavy gates belong to GitHub CI/approved worker.
- Physical station display/scanner/relay test: **NOT RUN** — requires C9
  mobile build and the approved physical pilot, not a mocked web route.
