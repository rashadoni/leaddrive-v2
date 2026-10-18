# A4 Kafka infrastructure readiness — 2026-10-19

Verdict: **BLOCKED / NOT ACTIVATED**. Scope is repository preparation without
new spending. Baseline origin/main: `226dde0e77c0c36a4de991bb703ba8f8416c5a64`.
Overall delivery belongs to the original «Проверить защиту Kafka-консюмера» chat.
No runtime inspection, installation or production mutation was performed here.
A4 maps to backlog K0.3/K1/K2.2/K2.7/K3; it does not close those items.

## Evidence versus templates

| Requirement | Actual repository evidence | Missing activation proof |
|---|---|---|
| Resources / failure domains | Registry identifies shared app host 13.140.132.245; remote-alt is a development host. Separate client fanum host is not a capacity allocation. Historical read-only source observations in READINESS_BASELINE | Three independently verified failure domains, broker/controller placement, allocated CPU/RAM/disks/IOPS and headroom under one-domain failure; Connect outside web host |
| Private network / TLS | Connector template requires source verify-full; CI Compose is isolated plaintext | Authorized private host-to-host routing, DNS/SAN/trust/expiry, broker/Connect/Registry TLS handshakes and invalid-certificate rejection |
| ACL / credentials | Separate secret references and intended least privilege in runbook | Effective service identities, negative create/read/write tests, rotation/revocation; references alone are not installed credentials |
| RF / minISR | topics.v1.json specifies RF=3/minISR=2 and no unclean election; CI single broker is RF=1 | Effective domain AND internal-topic configuration, replica placement, controller quorum and fault drill; three containers/endpoints on one VPS are one failure domain |
| Retention / archive | Catalog specifies finite broker retention, including 90-day domain events; gate requires immutable >=400-day off-provider archive | Measured partition/replica storage budget, archive sink/copy/immutability/key custody and rehydration receipts; existing application backups do not prove event archive |
| WAL / emergency stop | Finite example and SQL preparation guard; baseline has historical replica WAL, zero slots and cap -1. Observed cluster mean about 3017 bytes/s is not peak | Approved peak/outage budget, all-slot accounting, checkpoint overshoot, free-space reserve, warning/stop thresholds, tested incident response; current live settings NOT VERIFIED |
| Monitoring | Metric names and boolean evidence fields exist | Running exporters/rules, ownership and delivered test alerts for primary/broker disk, slot bytes, lag/minISR, connector and archive watermark |
| Release / recovery | Application SHA-bound Actions route exists; disposable pinned CI stack has historical synthetic transport receipts | Dedicated reviewed platform release path and live preflight, source restore/PITR and independent archive/HA drills; application deploy is not platform activation |

Read together: [baseline](READINESS_BASELINE.md),
[backlog](KAFKA_IMPLEMENTATION_BACKLOG.md),
[assets/runbook](../../ops/event-platform/README.md),
[CI fixture](../../ops/event-platform/test/README.md),
[deployment](../DEPLOYMENT.md), [registry](../../clients/registry.json).
Historical receipts are preserved as historical; this review did not revalidate
them against today's runtime or dispatch the production inspection workflow.

## Concrete zero-spend deficit

The supplied evidence does not allocate three independent failure domains.
Even if the shared app host and remote-alt were both available, two machines
cannot meet a three-domain contract; neither free capacity nor independent
power/storage/network failure boundaries have been attested. The additional
client registry entry is not permission to repurpose its server. Multiple VPS
names alone also do not prove independent domains. No claim is made that
another unlisted machine cannot exist: an authorized inventory is required.

No verified existing immutable off-provider 400-day event archive or private
Kafka network is allocated. No measured peak/retention/WAL budget or tested WAL
emergency controller exists in the inspected assets. Free software licenses
cannot supply these missing resource and operational guarantees. Keep the gate
closed unless existing owned resources can be explicitly allocated and tested
without new cost; otherwise record the unmet guarantee for an owner decision.
Do not downgrade RF, failure domains, archive or approval gates to get green.

## Bounded next steps for the delivery owner

1. Obtain an authorized inventory of existing machines, shared dependencies,
   resource allocations and free network/archive capabilities. Do not install
   services or alter firewall rules as an inventory shortcut.
2. Measure peak workload/tenant skew and storage needs; approve outage, retention,
   RPO/RTO and response headroom. Account for broker replication and all 86 topics.
3. In an isolated worker/CI environment, prove TLS/negative ACLs, domain loss,
   minISR behavior, alert delivery, WAL threshold/invalidation and recovery.
4. Attach exact target/SHA-bound receipts and obtain the existing distinct
   requester/approver activation record. JSON booleans are claims requiring
   review, not an attestation verifier. Separate authorization is still required
   for any production change, source logical WAL/restart/slot or consumer start.

The validator now rejects non-finite/coerced budgets and inconsistent threshold
relations, and requires explicit topology, ACL, effective replication, disk and
alert-delivery claims. Defaults remain false/zero. It performs no network or
runtime action. Synthetic PASS tests establish admission behavior only.
