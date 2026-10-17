# Kafka implementation baseline — 2026-10-17

This is an evidence snapshot, not activation authorization or all-module readiness.

| Boundary | Evidence | Result |
|---|---|---|
| Source/release | `rashadoni/leaddrive-v2`, main `9ead36ce7ef64cb16d521acad9bc3b210812a3c9`; required checks pr-scope/static-checks/typecheck/runner-policy/scan, enforce_admins | Verified by GitHub API; no policy change |
| Production artifact | [Deploy 39066347230](https://github.com/rashadoni/leaddrive-v2/actions/runs/39066347230), public build-info exact full SHA above | Successful deployment; public ping returned `{"ok":true}` |
| Event authority | [Daily read-only audit 39012564333](https://github.com/rashadoni/leaddrive-v2/actions/runs/39012564333), SHA `00aa422c52b02f183cb5a3d2674f41df2aca5c2b` | Successful existing Fund/database audit; not a fresh Kafka drill or all-module recovery test |
| Fund integration | [Write-path inventory](WRITE_PATH_INVENTORY.md) | Concrete events and synchronous v1 projection; Kafka SDK has no active broker worker; Fund GET does not consume generic read pointer |
| PostgreSQL/Kafka capacity | New exact-SHA aggregate inventory in [PR 860](https://github.com/rashadoni/leaddrive-v2/pull/860) | Pending merged delivery and actual inspection; development-host memory/disk are not production sizing evidence |
| Backup recovery commissioning | [Read-only readiness run 39069172504](https://github.com/rashadoni/leaddrive-v2/actions/runs/39069172504), main SHA above | **FAIL:** `machine_ready=no enterprise_ga_ready=no issues=26 enterprise_gaps=9 operator_attestation_required=yes` |
| Test infrastructure | [Draft PR 861](https://github.com/rashadoni/leaddrive-v2/pull/861) | Fixture and static checks prepared; real stack smoke NOT RUN while draft |

## Confirmed backup prerequisite failures

The existing sanitized `backup-readiness` workflow found missing pinned age/AWS
tools, live recovery units that differ from the artifact, missing/unsafe evidence
and log-genesis anchors, disabled/inactive DB/secrets/log timers, a missing
runtime-files timer, and failed/stale/missing run evidence for several runners.

These findings describe the **commissioned encrypted recovery program**. They
do not establish that every other backup mechanism or historical copy is absent.
Those copies must be inventoried and restore-tested independently. An existing
scratch cluster or local dump does not satisfy the signed off-host recovery gate.

The validator also reports separate enterprise gaps: WAL/PITR commissioning,
independent storage failure domains, full PostgreSQL authority restore,
application-consistent media, clean-host evidence hydration, signed log-cursor
recovery, and retention/schema-conformance proofs. Configured single-provider
storage is not proof of Kafka's required three failure domains or off-provider
immutable event archive.

## Remediation sequence

1. Use the existing SHA-bound commissioning workflow to install its pinned
   public toolchain and perform the already-reviewed 400-day log-policy
   preparation. This stage uploads no customer backup, accepts no private key,
   enables no Kafka worker and creates no new provider subscription.
   [Run 39069469912](https://github.com/rashadoni/leaddrive-v2/actions/runs/39069469912)
   failed before tool installation at the connection-file ownership check.
   Workflow cleanup succeeded; no backup, restore or Kafka operation ran.
2. Resolve the contradictory password-file policy first: the scratch provisioner
   creates a service-owned `0600` libpq file; commissioning/deploy/source-runner
   checks still require root ownership and group-readable modes that libpq
   ignores. Source-file ownership remains unverified. Collect metadata only,
   align all consumers in a reviewed change with regression tests and updated
   helper hashes, and retry the bounded preparation once. Do not blindly chown
   credentials or enable timers to make the output green.
3. Establish actual offline-key custody, independently signed decrypt/restore
   evidence and valid candidate/catalog bindings through the existing recovery
   program. Do not turn a September screenshot or a generated operator name
   into a current attestation. Current evidence/operator availability remains
   unverified and can require owner participation.
4. Complete the test-stack/CDC/Fund replay work on synthetic data while the
   production gates remain explicit. Close restore, topology and archive gates
   before production Kafka activation.

Operational details and subsequent receipts are appended to the
[session journal](../kafka-readiness-session-log.md). This baseline never
substitutes for a fresh SHA-bound preflight at activation.
