# Shared privacy sinks: bounded source candidate

Accepted parent: `b896cdb35246c22bcaddb176774a5c1b528190f9` (PR589).
Integrated main: `5c7412266c29a53e12963621b090c4f1aee95a3a`.
The accepted fault/fairness archive at evidence commit
`2d7c8c90e7d385f021cb8f13de31c383b005aca4` remains immutable.
This follow-up addresses the explicitly authorized shared-source gaps in
[the earlier privacy audit](workforce-privacy-audit-2026-10-06.md). That audit's
findings describe its own candidate, not this subsequent implementation.
Exact candidate, independent receipts and hosted results are recorded separately.

## Minimum scope and compatibility decisions

| Boundary | Change | Preserved behavior / deliberate diagnostic reduction |
| --- | --- | --- |
| Shared auth/RLS | Three wrapper failure catches and Auth.js login, SMS and refresh catches emit fixed operation labels. Mobile rejection warnings omit agent ID and path. Legacy login warning omits even the masked email. | Same auth responses, permission/tenant checks, handler ordering, downstream rejection identity and SMS retry behavior. No principal/request data passed to the new sink. |
| Prisma audit fallback | Emits only `audit-persist`; no action, entity, identity or raw exception in console. | The full audit database write is unchanged and still tenant-scoped. Existing `logAudit` catch resolves on persistence failure; this patch does not convert it into transactional failure or claim stronger audit durability. |
| Prisma RLS guard | Retains finite model/operation and fixed guidance; drops captured caller stack. Unknown operations collapse to `unknown`. A console failure cannot block the query. | Org-scoped model queries still throw before execution in the existing test guard. Raw queries remain warn-only. Actual production driver/native-engine output is not proved exhaustively. |
| Pino | Fixed-shape event projection before serialization, plus recursive child-binding sanitization before child construction. Only existing application methods are exposed. | Existing Support and Routes observation schemas/counts/status/durations remain. ERP/social free messages become `application log`; arbitrary context, errors, stacks, causes, host/process and request/principal identifiers are dropped. No `setBindings`, raw instance or arbitrary child configuration escape is exposed. |
| Sentry server/edge/client | Shared event/transaction projection and final `beforeEnvelope` filter on the existing transport. Collection options disable identities, cookies, headers, bodies, query parameters, model inputs/outputs, local variables and source context. | Existing DSNs, authentication, destination and transaction sampling rates are unchanged. Only bounded minimized events/transactions survive; IDs/timing and finite type/operation/status/code area remain. Free messages, URLs, custom context/tags, request/user data, breadcrumbs, source snippets and span attributes are dropped. |
| Replay and other Sentry envelope channels | Replay integration removed and both replay rates set to zero. Final envelope boundary drops attachments, replay, sessions, logs, profiles, metrics, check-ins and other unreviewed item types. | This intentionally reduces observability, including session/release-health and profiling channels; it does not claim equivalent diagnostic coverage. Error grouping is coarser because filenames/functions/messages are minimized. Future channels require a separate reviewed contract. |
| Browser error boundary | Logs the fixed `application-render` event instead of the Error. | UI and effect dependency unchanged. Global/request capture continues through the configured Sentry hooks. |

No schema, migration, historical `api_keys` assumption, access grant, credential,
collector, storage retention, shipper, backup or network destination is added or
changed. No new data collection or product feature is introduced.

## Why key-name redaction was insufficient

Pino serializes child bindings before a log-method hook runs. An actual installed
Pino probe found that `child()` resets the parent's bindings formatter: filtering
only the event still leaked a synthetic organization identifier. The corrected
facade sanitizes bindings before every child is constructed. The failing probe
and corrected independent probe are retained as separate evidence.

Sentry event hooks do not cover attachment/Replay/session envelopes. The shared
policy also runs at `Client.sendEnvelope` immediately before its existing
transport. Unsupported item types are discarded rather than recursively scanning
arbitrary data. Values are projected from own data properties, with no getter,
`toJSON` or string coercion. Only finite categorical values, bounded numbers and
explicitly allowed pseudonymous correlation fields survive. This is a reviewed
contract, not a whole-program taint proof or an assertion that correlation IDs
are anonymous. The physical collector can still see transport-level network
metadata; no remote retention/access claim follows from payload minimization.

Locked and installed versions checked: Pino **10.3.1**, Sentry **10.65.0**.
Primary implementation evidence is the lockfile and installed SDK source:
`pino/lib/proto.js` child bindings, Sentry core `Client.sendEnvelope`, envelope
serialization and `DataCollection` options. No dependency version changed.

## Verification and evidence boundaries

New tests exercise real Pino serialization, real Sentry NodeClient processing and
memory transport serialization (events, transactions, attachments and envelope-only
channels), all three runtime configuration registrations, actual auth wrappers,
actual Auth.js callbacks, mobile denial paths and the exported Prisma audit/guard.
Synthetic canaries are local; no real user data, DSN or production collector is
used. Auth/database/provider dependencies are mocked where necessary to isolate
failure behavior. Prisma audit persistence is intercepted; these new tests do
not claim a live database write or complete native driver coverage. Existing
RLS/auth/Support/Routes tests provide separate behavior regressions.

Source-mode Sentry configuration wiring is executed for server/edge/client;
actual browser collector behavior, session Replay and signed devices are not
credited. A hosted Linux production build is requested through the existing
PR label gate, separately from tests and source typing. Its outcome must be read
from current exact-candidate metadata; an old build or skipped job is not PASS.

The scoped parent production compiler is clean. An initial new SpanJSON typing
error and one hostile-fixture typing error were corrected in owned code/tests.
Six lint diagnostics in existing auth/prisma lines are identical to the accepted
parent; no rule or baseline was suppressed. New owned files and other touched
paths pass targeted lint. The terminal receipt records actual final counts and
any broader CI baseline limitations; this document does not promise a clean
whole-repository compiler or test suite.

## Remaining acceptance criteria

- **WF-C10-011 remains PLANNED:** this closes the named bounded shared source
  leaks, not all transitive/framework/native-driver output, marketing analytics,
  historical logs, actual collector payloads, dashboards, ACLs or approved
  retention. Live PM2/nginx/Postgres destinations and encrypted archival retention
  require their own authorized evidence. Existing rotation/shipper files are
  unchanged, and old records have not been deleted or rewritten.
- **WF-C12-002 remains PARTIAL:** actual pipeline aggregation, cardinality,
  release/principal/tenant dimensions, dashboards and paging/SLO delivery remain.
  Support HMACs and Sentry trace/span IDs remain pseudonymous.
- **WF-C12-008 remains PARTIAL:** prior bounded fault/fairness evidence is preserved;
  staging, signed-device, collector and broader operational acceptance still need
  factual access/evidence. No historical `api_keys` schema was invented.
- No merge, deployment, production activation, backup action or security/access
  change is part of this candidate. A source fix is not proof of production rollout.

Canonical ledger unchanged: **82/161 DONE, 79 open, weighted 59%**. No new row
closure or completion credit is claimed. Independent nonoverlapping work can
continue while the named operational boundaries remain blocked.
