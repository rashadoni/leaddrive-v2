# Workforce C4 — evidence-envelope contract

> **Checkpoint:** `WF-C4-001` — 2026-08-30
>
> **Scope:** validation, canonicalisation and redaction only. This checkpoint
> does not collect production location, evaluate a geofence, accept QR/device
> proof, or decide employee presence.

## Delivered contract

`WorkforceEvidenceEnvelopeSchema` is a strict version-1 wire contract for one
evidence capture. It requires:

- capture source (`LOCATION`, `QR`, `DEVICE`, `KIOSK` or `MANUAL`), capture
  instant, operation/session references and app platform/version/build;
- opaque device/session/method references rather than hardware serials,
  advertising IDs, session tokens, raw QR or signature material;
- for `LOCATION`, an explicit availability result plus a complete coordinate,
  accuracy, provider and mock-provider declaration when available;
- no coordinate fields for a non-location source, no hidden mock/provider data
  when location is unavailable, and method/device references where their
  source requires them.

Canonical hashing uses a server-supplied, tenant-bound HMAC key. The receipt
contains source, availability/provider/mock flags and a 64-character digest,
but never reversible latitude, longitude or accuracy. There is no fallback to
an organisation ID or client-provided value as the HMAC secret.

## Boundaries

- C4-002 will evaluate a valid `LOCATION` envelope against a snapshotted
  geofence; this schema does not call a distance function.
- C4-003 decides accuracy/freshness/mock-policy outcomes. The schema preserves
  the facts needed to explain that outcome without treating them as a verdict.
- C4-004/C5 continue to validate QR/device cryptography in their dedicated
  flows. A generic envelope is not a QR or key verification bypass.
- C4-006/C10 will define append-only evidence persistence, assessment storage,
  retention and key-provider lifecycle. No raw envelope is persisted here.

## Verification

```text
npx vitest run src/__tests__/workforce-evidence-envelope.test.ts \
  --pool=forks --maxWorkers=1

1 file passed, 3 tests passed

npx eslint src/lib/workforce/evidence-envelope.ts \
  src/__tests__/workforce-evidence-envelope.test.ts
PASS

git diff --check
PASS
```

## Not run

- Full TypeScript check, production build, browser E2E, Android and load:
  **NOT RUN** — heavy gates belong to GitHub CI/approved worker.
- Key-provider integration and persistence/retention drill: **NOT RUN** — they
  are explicit C4-006/C10 work, not simulated by a local static test.
