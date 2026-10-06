# Workforce C13-009: provided workday/event fact comparison

This dormant source slice extends accepted head
`2d723e02627d2983db91b1d2360fd7592f886e8b`. It does not run a migration,
read a database, change permissions, activate a cohort or prove staging state.
Canonical accounting remains **82/161 DONE, 79 open, weighted 59%**;
`WF-C13-009` remains PLANNED until its full acceptance evidence exists.

## Missing criterion addressed

The existing reconciliation checks event IDs, tenant/agent scope and workday
links inside one snapshot. That does not detect a changed timestamp, event type
or request hash under the same ID between two snapshots. The new
`compareWorkforceMigrationFacts` compares those supplied facts itself. It does
not accept caller-computed digests as evidence of equality.

The first bounded comparison covers workday date/status/start/pause/finish and
paused seconds, plus event identity, linked workday, canonical journal fields,
schema version, request hash, four provenance timestamps and review state.
It reuses the existing workday correction and event fact projections and the
current enumerated workday wire schema registry (versions 1 through 5).
Nullable legacy values must be explicitly null; missing fields are rejected.

## Input and output contract

Both inputs must declare the same tenant, inclusive UTC workDate interval and
explicit agent cohort, including agents with zero rows. Events belong to scope
through their referenced workday; their instants are not silently date-filtered.
The caller supplies a snapshot marker, capture time, complete/consistent flags
and exact collection counts. These are assertions, **not verified extraction
or historical provenance**. After capture time may not precede before capture.

Bounds are 1,000 agents, 1,000 workdays and 5,000 events per snapshot, plus a
4 MiB budget on each minimized projection. Duplicate IDs/cohort members,
foreign or absent parents, agent mismatches, malformed values, unsupported
schemas and declared partial inputs fail closed with one fixed error code.

Fixed projected fields are ordered by binary ID order and hashed with a v1
domain prefix. Input ordering does not affect comparison. Outputs contain only
counts, equality flags and finite status/coverage labels; no identifiers,
digests, source rows, coordinates, notes, QR/device proof or reasons escape.
Additional raw properties are not serialized. No repair is performed.

`MATCHED_INPUT_FACTS` means equality of the supplied bounded projection only.
Every result declares `comparisonScope: PROVIDED_BOUNDED_FACTS`,
`historicalCompleteness: CALLER_ASSERTED_NOT_VERIFIED` and
`rolloutAcceptance: NOT_ESTABLISHED`, including an empty supplied snapshot.

## Explicit remaining dependencies

- Authorized consistent before/after extraction, freeze/drain boundary and
  authoritative historical schema/ledger provenance, including `api_keys`.
- Approval revision/hash and ordinary report comparison; policy/shift/schedule
  content and correction-ledger preservation. These are explicit NOT_COVERED
  values, not implied by a matching event projection.
- Actual staging zero-unexplained-delta exercise and independent acceptance.
- Signed-device, representative load, rollout, deployment and activation gates.

The comparator does not establish that a snapshot is semantically correct or
that existing corruption is absent: identical corrupt facts can still match.
Existing within-snapshot reconciliation/replay remains a separate prerequisite.
Full-tenant snapshots exceeding the limits require a future proven complete
partition/extractor contract; truncating them is prohibited.

## Read-only operational evidence availability

Existing GitHub refs and workflow metadata were read through the authorized
connector. Selected operational runs `37230421845`, `34709513486` and
`34692180442` returned empty artifact lists. The source workflow emits backup
readiness/inventory through stdout; its only JSON upload is a separate Support
observation and is outside this task. No raw CI logs were read. No collector,
Sentry or cloud-monitoring read capability was exposed in this environment.

This establishes an evidence-access limit, not current production health.
Source configuration and historical ISMS notes cannot prove effective collector
egress, ACL, retention, inherited nginx/PostgreSQL logging or dashboard delivery.
Those production criteria remain NOT_PROVED. No dispatch, SSH, secret access,
retention change or access change was performed.
