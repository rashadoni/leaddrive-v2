# WF-C13-003 — mobile wire-schema compatibility contract

## Accepted boundary

The authenticated mobile bootstrap now advertises one server-owned,
independently versioned Workforce wire-schema registry:

- bootstrap response schema `1`;
- workday request schemas `1`, `2`, `3` and `4`, with `4` preferred;
- workday response schema `1`;
- evidence-envelope schema `1`;
- site-transition request schema `1`.

The registry derives its values from the parsers' exported constants. Supported
request versions are enumerated, not represented as an open numeric range, so
deploying a future parser cannot silently claim compatibility with an older
client. Schema support is separate from transport protocol selection, exact
device-cohort enrollment and Android release policy.

The previously delivered release contract supplies the structured
`UPDATE_REQUIRED`, `CLIENT_TOO_NEW`, invalid-policy and drain-before-update
responses. It is inert until a minimum Android version is deliberately
configured, preserving legacy clients while allowing a later signed-client
rollout to fail closed.

## Verification

- Targeted ESLint passed for the registry, bootstrap, site-transition source
  and both contract tests.
- Targeted Vitest passed: 3 files / 39 tests covering the bootstrap projection,
  exact schema registry, additive migration/transport compatibility and the
  site-transition parser.
- `git diff --check` passed.
- `NOT RUN` locally: full typecheck/build, browser E2E and Android checks; the
  repository CI/heavy or physical-device lanes own those gates.
- `NOT RUN`: native consumption, package/signing/distribution and offline
  outbox migration. They remain separate C9/C14 tasks and are not claimed by
  this server compatibility task.

## Status

The v4 request is additive: it binds action-time location source metadata to
the immutable request digest while preserving the v1-v3 digest shapes and
legacy facts. Location collection remains policy-controlled and foreground
only; support for the wire shape does not activate collection for a tenant.

WF-C13-003 is **DONE** at its Backend acceptance boundary: every deployed
Workforce request/response/evidence schema has an explicit advertised version,
and the structured forced-upgrade decision exists. Native behavior remains
honestly open under WF-C9-001/C9-003..014 and WF-C14-004.
