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

## Fresh read-only receipt — 2026-10-19 00:35 Baku

This supersedes the earlier statement that this task did not inspect runtime;
all earlier historical observations remain historical. Protected main-only
[inventory 39163966627](https://github.com/rashadoni/leaddrive-v2/actions/runs/39163966627)
completed SUCCESS at deployed/current-main
`226dde0e77c0c36a4de991bb703ba8f8416c5a64`. Observation was
2026-10-18T20:35:36Z (2026-10-19 00:35 Baku). The inspected script exactly
matched main blob `931e21e3795979fdea7785f22e16e46f94cf5b8b`.

- Host total/available RAM: 12247544/9852636 KiB; swap 0.
- App filesystem total/available: 206900281344/175302717440 bytes.
- PostgreSQL 16.15: readOnly=on; wal_level=replica; max slots/senders=10;
  max_slot_wal_keep_size=-1; slots/active slots/retained slot WAL=0;
  event_outbox publication absent; databaseBytes=502995991.
- Four inspected backup/secrets/runtime-files/log timers inactive; backup
  configuration present, restore verification NOT PERFORMED.
- Cumulative WAL=18067188472 with reset 2026-09-04T12:58:40.679899+02:00.
  This is not a peak/outage budget. Table estimates are not exact counts.

These are actual source-host capacity/settings observations, not an allocation,
Kafka broker inventory, TLS handshake, archive receipt or topology proof.
The source is currently not CDC-ready. No PostgreSQL, firewall, service,
consumer, slot, offset or replay mutation was made. No unchanged diagnostic
retry is needed. Production activation remains BLOCKED.

## Fresh isolated verification — 2026-10-19

[Synthetic CDC 39164115388](https://github.com/rashadoni/leaddrive-v2/actions/runs/39164115388)
passed on preparation checkpoint `814b80107e9bdd55c7979965a4d6619382f333e0`:
62/62 safety tests, SQL/WAL guards, 8/8 source-envelope transport and cold
restart, followed by scoped cleanup. This strengthens transport evidence only;
fixture TLS remains NOT PROVEN, business projection and production activation
NOT RUN. [PR checks 39164115435](https://github.com/rashadoni/leaddrive-v2/actions/runs/39164115435)
also completed its typecheck gate successfully. Static gate's final result is
recorded in the append-only session journal and the linked run.

## Existing-resource inventory — 2026-10-19 01:09 Baku

This is the follow-up inventory requested after the preparation checkpoint,
not a new resource allocation or permission to repurpose another application.

| Resource | Actual observation | Allocation / independence verdict |
|---|---|---|
| remote-alt development host, read-only via contabo-admin loopback | 8 logical CPU; total/available RAM 24608564/14768148 KiB; swap 8388604 KiB entirely free; root and worktree filesystem total/available 622945865728/217913540608 bytes | Shared development/runtime host, not allocated to Kafka. Root, worktree, Docker/containerd and session mounts map to one 599-GiB partition on one 600-GiB disk. Paths/mounts are not independent disks or failure domains |
| remote-alt runtime presence | 18 running Docker containers; zero running image matches for Kafka/Debezium/Schema Registry/Redpanda; zero matching systemd units; zero listeners on 9092/9093/8081/8083 | Scoped absence only: remote services, renamed images/units and nonstandard ports are not excluded. Do not infer that this host is empty or available for stress tests |
| remote-alt networking | 8 bridges, 17 veth, 1 Ethernet and 1 loopback interface. All 8 RFC1918 IPv4 addresses belong to bridges. No tunnel interface kind observed. Route to registered production uses a global source and gateway | Docker/bridge networking is not evidence of private inter-host connectivity; no TLS/private route receipt obtained. No firewall/public-port scan performed |
| LeadDrive registered production | Protected read-only Actions receipt39163966627 above; fresh direct alias inspection attempt failed public-key authentication before remote commands | Preserve Actions as the supported evidence source. No alternate key/account/retired host attempted; no repeated identical diagnostic dispatch. Capacity is shared with the app and not allocated to Kafka |
| Registry's separate client fanum host | Registry entry only, no inspection or capacity allocation | Client resource excluded from Kafka capacity; ownership of an SSH alias or registry entry is not permission to repurpose it |
| GitHub standard Linux worker | Existing isolated CDC passed in the prior section | Ephemeral test runner, not a durable production broker, archive or independently placed Kafka failure domain |
| Mac / other unlisted resources | No live resource allocation, always-on capacity or failure-domain attestation supplied in this task | Unknown; no guessed destination or borrowed key |

At most two relevant persistent host contexts have evidence here. Even if both
were allocated and independently attested, a three-domain contract would still
need at least one additional independent domain. In fact **zero Kafka
production failure domains are currently allocated and attested**. Distinct IPs
alone do not prove independent racks/power/network/storage/provider failures.
Neither a directory under `/mnt` nor three brokers on remote-alt closes this gap.

The catalog expands to 86 topics and **1416 logical partitions / 4248 replica
copies at RF=3**, excluding Connect/Kafka internal topics: events588 + replay588
+ quarantine162 + control78. These are arithmetic template counts, not measured
live partitions or a recommendation to create them. Disk capacity cannot be
approved without per-family measured ingress, tenant skew, retention/compaction,
replication/recovery headroom and index/segment overhead. Do not turn the free
filesystem snapshot into an approved retention budget.

### What can be tested now

| Drill | Available representative environment | Result / next dependency |
|---|---|---|
| Offline admission checks and synthetic SQL/WAL guards | Repository tests and isolated GitHub Linux CI | Already PASS on814b80107; no executable/config changes in this resource follow-up, so no unchanged heavy rerun needed |
| Snapshot/streaming, source-envelope integrity and cold Connect restart | Disposable single-broker CI fixture | Already PASS8/8; scope remains synthetic transport, not HA/TLS/DR |
| Physical host/domain loss, controller quorum and replica placement | No three allocated independent domains | NOT RUN / BLOCKED; one-worker container failure can test process behavior but cannot certify physical failure independence |
| Existing private network/TLS/ACL and alert-delivery tests | No existing Kafka service identities/endpoints/CA/monitoring target supplied | NOT RUN / BLOCKED; installing/configuring services or changing firewall is outside this task |
| Finite source WAL/disk emergency and invalidated-slot recovery | No approved peak/outage budget or representative authorized drill target | NOT RUN / BLOCKED; production settings remain replica WAL/cap-1, and production WAL/slot/replay changes are prohibited |
| Immutable event-archive retention/rehydration/off-provider loss | No allocated independent event archive with retention/key-custody receipt | NOT RUN / BLOCKED; application backup-file presence is insufficient |

No representative additional infrastructure drill can currently certify A4
without the missing allocation/evidence or actions explicitly forbidden by the
request. This is a concrete dependency result, not a proposal to purchase or
install anything. Keep the gate closed and retain the completed source/CI
receipts. Closing it requires facts from the resource/provider owner: identified
existing hosts plus allocated capacity, independently verifiable failure
boundaries, private routing/service identity ownership, archive allocation and
an authorized isolated drill target. No provider panel or account credentials
were accessed or requested here.

## Hosting recommendation requested by owner — 2026-10-19

Owner asked to propose hosting rather than asking them to invent the resource
map. This authorizes research/recommendation only: no purchase, subscription,
installation, production-routing change or relaxation of the no-spend gate.
Current application production remains the registered Contabo host and the
existing Actions release route. Proposed hosts below have no addresses,
credentials, allocation, attestation or activation evidence yet.

**Preferred cost-conscious candidate:** a new dedicated Kafka environment on
Hetzner Cloud across Falkenstein/fsn1, Nuremberg/nbg1 and Helsinki/hel1, plus an
independently administered Backblaze B2 immutable archive/copy. Hetzner documents
three locations in eu-central and a private Network spanning those locations;
Networks are free. This makes multi-location placement feasible, but does not
prove rack/power/host independence, meet a multi-provider live failover SLA, or
supply measured Kafka latency/IOPS. See [locations](https://docs.hetzner.com/cloud/general/locations/)
and [Networks FAQ](https://docs.hetzner.com/networking/networks/faq/).

The repository architecture requires separate KRaft controller and broker
roles for self-managed critical environments. A conservative initial bill of
materials is therefore **8 VMs**, not a three-container/three-combined-node
shortcut: one broker and one controller per location; two Connect/Registry
workers spread across two locations outside the application host. Select node
sizes after load/retention measurement and resource-reserve review. Example
catalog-price arithmetic, not an orderable quote or approved sizing:

| Proposed role | Example plan/count | Listed monthly compute, excluding VAT/IPv4 |
|---|---|---:|
| Broker | 3 x CX43 | 3 x EUR15.99 = EUR47.97 |
| Controller | 3 x CX23 | 3 x EUR5.49 = EUR16.47 |
| Connect/Registry worker | 2 x CX33 | 2 x EUR8.49 = EUR16.98 |
| Compute subtotal | 8 VMs | EUR81.42 |

Sources: [official price adjustment](https://docs.hetzner.com/general/infrastructure-and-availability/price-adjustment/),
[plan specifications/stock](https://www.hetzner.com/cloud/cost-optimized/),
[Primary IP pricing](https://docs.hetzner.com/cloud/servers/primary-ips/overview/).
Eight optional public IPv4s would add EUR4/month (EUR0.50 each), yielding
EUR85.42 before taxes, archives, additional disks, egress and operations. Public
IP allocation does not permit public broker/Connect/Registry listeners. An
approved encrypted private overlay would still be needed to connect the
Contabo source to the proposed private Kafka network.

**Stock limitation:** the public cost-optimized page currently marks these CX
plans unavailable. The EUR81.42/EUR85.42 arithmetic is a price-list floor, not a
promise that this configuration can be bought now. Do not order eight machines
in one location, collapse controller/broker roles, or switch to a more expensive
family without an approved quote and measured capacity. New per-location stock
and the complete invoice must be checked in the owner's provider account.
Operations approval is separately required for self-managed Kafka. Shared-vCPU
plans have variable performance; local NVMe capacity is not a 90-day retention
approval, and losing one location must be tested under representative load.

For off-provider archival, [Backblaze B2 pricing](https://www.backblaze.com/cloud-storage/pricing)
starts at USD6.95/TB/month on the published pricing page; region, stored bytes,
retained versions and egress determine the actual bill. [Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock)
supports COMPLIANCE retention and1–3000 days, so >=400 days is a feasible
configuration to review and prove, not an enabled guarantee. Encryption,
independent keys/account custody, manifests, restore/rehydration, archive lag
and any primary archive copy remain implementation/evidence dependencies.
Neither broker RF3 nor an archive alone closes the separate second-cluster DR
requirements in architecture section13.1; those resources/operations are not
included in the compute subtotal.

**Free evaluation alternative:** [Aiven free Kafka](https://aiven.io/docs/products/kafka/free-tier/kafka-free-tier)
includes Registry but limits topics to5 with2 partitions each, fixed retention,
no managed Connect or SLA, and idle shutdown. [Aiven pricing](https://aiven.io/pricing/kafka)
shows Free USD0 and Developer USD35/month; Developer is capped at20 topics /
100 partitions with3-day retention. Neither fits LeadDrive's86-topic catalog
or the90-day event-retention/HA/private-network/archive requirements. They can
be considered only for a separate synthetic prototype, not production A4.
For managed production operations, Aiven Professional is the alternative to
request a target-specific multi-zone/private-network/Connect quote for; no
unsupported fixed price or plan capability is assumed.

**Contabo comparison:** [Private Networking documentation](https://docs.contabo.com/docs/network-services/private-networking/)
describes a per-instance add-on confined to one region. It does not by itself
establish three independent sites or cross-region private Kafka connectivity.
Do not assume the currently running Contabo hosts gain that capability for free.

Recommendation: retain the no-cost verified CI contour now. If a new budget is
approved, obtain actual stock/placement and a complete Hetzner+B2 quote for the
8-VM topology, compare it with a managed Aiven Professional quote, and commission
only after the existing gates/drills. No resource has been ordered or activated.

### Budget refinement: 6 versus 8 VMs

The8-VM proposal above isolates Connect/Registry from brokers; that isolation is
an operational design choice, not a literal8-VM requirement in the repository
contract. A leaner pilot candidate is3 dedicated broker-role VMs plus3 separate
controller-role VMs, with the two Connect/Registry workers colocated on two of
the broker VMs (still outside the application/PostgreSQL host and spread across
locations). The controller and broker roles remain on separate VMs. This ties
transport/service capacity to broker capacity, so measured CPU/RAM/IO/GC reserve
and failover/rebalance under a node/site loss must be proven before accepting
it; no sizing approval is implied.

At the same published, currently unavailable CX prices:3CX43 +3CX23 gives
EUR64.44/month compute, or EUR67.44 with6optionalIPv4. The8-VM variant gives
EUR85.42 with8IPv4 and separates those workers. Both exclude taxes, storage/
archive, traffic, operations and second-cluster DR. Start comparison from the
6-VM pilot candidate when cost is the main constraint; choose8only if worker
isolation/capacity evidence justifies the extra cost. Neither is a purchase
recommendation at unavailable stock, a quote for every domain at full load, or
an authorization to weaken activation gates. Sources and all availability/
private-network/operations caveats in the preceding section apply unchanged.

## Admission follow-up verified — 2026-10-19

Source checkpoint `e55bbd2b452d35cb042796ffc9240c9453dc5fa7` additionally rejects
placeholder receipt IDs, padded self-approval, arbitrary credential-role keys
and empty secret-manager locations. The CLI regression proves a malformed
reference is blocked without echoing it. [Full required PR gates](https://github.com/rashadoni/leaddrive-v2/actions/runs/39167043668)
PASS on that exact source, including static27m52s and typecheck13m40s; unit
baseline remains18known failing files with no new failures.
[Explicit synthetic CDC](https://github.com/rashadoni/leaddrive-v2/actions/runs/39167127117)
also PASS62/62safety, raw8/8envelopes and cold restart. The automatic draft-event
CDC check was skipped; it is not relabelled as passing. No live activation,
resource allocation, operator identity or secret/receipt existence is proven
by these offline guards. Hosting remains a proposal only.
