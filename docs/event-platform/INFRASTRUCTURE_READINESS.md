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

## Owner excludes Hetzner; lower-cost candidate — 2026-10-19

Owner explicitly rejected Hetzner and requested cheaper hosting. This supersedes
the preferred-provider recommendation above; old research remains as history,
not an active procurement option. No budget or purchase was authorized.

**Current candidate: OVHcloud VPS**, subject to target-specific stock/placement,
capacity and networking verification. The [official Ireland/euro page](https://www.ovhcloud.com/en-ie/vps/)
currently lists VPS-1 from EUR3.81/month excluding VAT (2vCore/4GB/40GBNVMe) and
VPS-2 from EUR7.21 (4vCore/8GB/75GBNVMe). Three VPS-2 broker VMs plus three
VPS-1 controller VMs give an arithmetic **EUR33.06/month compute floor**.
This candidate has less broker RAM/disk than the preceding CX43 example; the
price reduction is not a like-for-like performance guarantee or an approved
86-topic/90-day retention budget. Consider only a measured small-pilot candidate
until CPU/RAM/IOPS/retention/failover headroom are proven. Shared Connect/Registry
workers still need measured reserve and location spread outside app/source host.

The public Configure link selects `pricing=upfront12`; therefore the advertised
monthly-equivalent floor must not be presented as confirmed month-to-month
billing. Verify commitment, upfront payment, renewal price, account/billing
country, selected site and stock in an actual quote. No checkout/order/account
was created. The aggregate floor excludes VAT, archive, extra storage,
private-network/overlay setup, operations and second-cluster DR.

Require three explicitly selected independent sites with provider evidence,
not three copies in one default location. OVH's product FAQ distinguishes VPS
from Public Cloud with native private vRack; the menu's vRack link does not prove
that these cheap VPS plans include it. A permitted encrypted private overlay is
a candidate design, not configured evidence or a waiver of the private-endpoint
rule. No public broker listeners or source firewall changes are approved.

netcup's [current regular VPS catalogue](https://www.netcup.com/en/server/vps)
shows higher regular pricing and term/site selection conditions for this
comparison, so it is not preferred here. Contabo's current pages and cached
legacy Cloud VPS10 listings disagree; current main VPS fetch was403, while
new Core materials advertise term-dependent starting prices. Do not reuse the
old EUR4.50 price as a verified new-order quote. Contabo can be compared later
using the owner's exact billing/region quotation, not guessed checkout totals.

The independent archive remains a separate requirement/cost. Existing B2
research above is a candidate, not an enabled archive. Overall A4 stays NO-GO
until all original evidence gates are satisfied. No hosting purchase, provider
migration, registry change or production installation follows from this note.

## Owner refocus: protect LeadDrive CRM only — 2026-10-19

Owner clarified: «мне нужен только проект leaddrivecrm зашиитить и всё».
Interpret in the original calculation/data-recovery context: protect this CRM's
data and derived calculations, without repeating payments/sends or losing
unaffected tenants' work. Earlier cluster estimates were for this one product,
not multiple projects, but buying Kafka infrastructure is not the product's
protection outcome. **Pause hosting selection/procurement as the immediate
path.** Previous vendor comparisons remain historical proposals; no new paid
resource is selected or ordered. No change to the existing Kafka HA gate.

Use existing PostgreSQL/source/deployment assets for the next product-focused
work, coordinated by the original delivery chat and its recovery/operator tracks:

1. Establish a current verified LeadDrive recovery point covering DB, required
   files, secrets/keys and operating state; restore into an isolated permitted
   target and verify integrity plus actual recovery timing. A dump file or
   inactive timer is not acceptance. An independent copy/custody remains an
   explicit dependency if existing resources cannot prove it.
2. Prove Fund correction from immutable PostgreSQL events into a new, isolated
   calculation version, preserving unaffected tenants/data and fencing all
   external effects. Review the database-only containment procedure in the
   existing projection recovery runbook. No execution or live read-pointer
   change is authorized by this clarification.
3. Extend measured write/history/idempotency/rebuild coverage to other CRM
   aggregates one domain at a time using the existing adoption inventory.
   Do not report the whole product protected from the Fund pilot or topic list.

The existing [event recovery audit](../../.github/workflows/event-recovery-audit.yml)
is source-only, read-only and has no added server prerequisite. Latest completed
[receipt39107488591](https://github.com/rashadoni/leaddrive-v2/actions/runs/39107488591)
SUCCESS was created2026-10-18T07:23:37Z, on24ce6e9c031fc465fe55b6c36f4d6d81306f3ce2.
This is a historical Fund/event-authority receipt, not a new audit of current
main226dde0e7, a full app restore receipt or protection of all domains. No audit
was redispatched and no backup/restore/service mutation ran in this follow-up.

Kafka delivery/HA/DR remains optional future infrastructure work for the owner
to commission after the original prerequisites; this note neither changes its
contract nor claims PostgreSQL alone supplies multi-host resilience. Product
protection work can progress without activating Kafka or buying a cluster.
Current no-install/no-production-WAL-slot-consumer-offset-replay/no-merge-deploy
and no-spend limits remain in force. This is a scoped priority clarification,
not permission to bypass recovery/operator evidence or activate a repair.

## Owner decision: self-managed Kafka on Contabo + OVHcloud — 2026-10-23

This supersedes the 2026-10-19 pause on hosting selection. The owner compared
Confluent Cloud with self-managed servers for the full catalog and chose
self-managed («Да, делай Kafka на своих серверах Contabo по полной схеме»).
The contract in this file and in architecture §13 is unchanged: three failure
domains, separate KRaft roles, private listeners, a mirrored DR cluster and a
>=400-day immutable archive. Nothing is ordered or activated by this note.

**Why not Confluent.** Basic is billed by elastic units of 30 partitions and 20
client connections (first unit free, then USD0.14/unit-hour, about USD100 per
month). The catalog's 1416 partitions need about 48 units, close to the Basic
maximum of 50 and 1500 partitions; Basic is also one zone and offers no
cluster mirroring. Standard (250 partitions per unit, USD0.75/unit-hour) is
about USD3300/month for the primary cluster alone. Source:
[cluster types](https://docs.confluent.io/cloud/current/clusters/cluster-types.html),
[pricing](https://www.confluent.io/confluent-cloud/pricing/).

**Why two providers.** The source host and this dev box both geolocate to
Contabo Hub Europe (Lauterbourg FR). Contabo's ordering offers one European
Union region and one United Kingdom region, so Contabo alone gives two
European failure domains. The third primary domain and the DR cluster are on
OVHcloud (Frankfurt, Warsaw); the owner excluded Hetzner on 2026-10-19.

The machine-readable plan is [`topology.v1.json`](../../ops/event-platform/topology.v1.json);
`scripts/event-platform/topology.test.mjs` (pr-checks) rejects a plan that
loses min.insync.replicas or controller quorum on one site loss, puts a DR host
on a primary site, colocates broker and controller roles, uses the web host,
exposes a public listener, or records addresses/credentials before hosts exist.

| Cluster / site | Hosts | Example plan |
|---|---|---|
| Primary, Contabo EU | broker, controller, Connect+Registry | VPS 20, VPS 10, VPS 10 |
| Primary, Contabo UK | broker, controller, Connect+Registry | VPS 20, VPS 10, VPS 10 |
| Primary, OVHcloud Frankfurt | broker, controller | VPS-2, VPS-1 |
| DR, OVHcloud Warsaw | 3 brokers, 3 controllers, mirror worker | 3 x VPS-2, 4 x VPS-1 |
| Monitoring, OVHcloud Warsaw | alerting outside the production site | VPS-1 |

Estimated monthly cost from third-party price trackers after the 2026 price
increases (not a quote): primary about EUR57, DR about EUR51, monitoring about
EUR6, archive about EUR2, **about EUR115/month for 16 hosts**, before setup fees
and location surcharges seen at checkout. Load is small (whole-database mean WAL
about 3 KB/s), so disk and CPU are sized for headroom, not throughput.

Ordering happens in two steps, each only after the preceding gate passes:

1. Primary 8 hosts — after the install automation passes a disposable
   multi-node drill in GitHub CI (TLS, ACL negatives, one-site loss).
2. DR 7 hosts + monitoring — after the primary passes its live site-loss drill.

PostgreSQL `wal_level=logical` needs a planned restart of the production
database and stays a separately requested window. Fund remains the first
canary; other domains follow the existing A7 order.

### Install automation and disposable drills — 2026-10-23

`scripts/event-platform/cluster/` renders and installs the plan above:
`render.mjs` (node configs, WireGuard mesh, per-role nftables, ufw rules for
the source host), `pki.sh` (per-cluster CA; CN = Kafka principal),
`host-bootstrap.sh` and `provision.sh` (operator workflow; inventory, CA and
public addresses stay on the operator workstation, never in Git).

[Drill 39937668732](https://github.com/rashadoni/leaddrive-v2/actions/runs/39937668732)
ran the exact rendered production files (uid 10001, TLS 1.3, mTLS between
nodes, SCRAM clients) on one disposable runner:

- network namespaces with the real kernel WireGuard/nftables: 18 of 18
  allow/deny expectations, including Kafka/Connect/PostgreSQL closed on public
  addresses and per-role overlay ports;
- six nodes (3 controllers, 3 brokers): plaintext, foreign CA, missing client
  certificate, wrong SCRAM password, topic creation, foreign group, writes to
  replay and writes by a read-only identity all refused with Kafka's own
  authorization/authentication errors;
- 86 catalog topics / 1416 partitions created; finance events RF3, minISR 2,
  unclean election off, 90-day retention, three distinct replicas per partition;
- one site stopped mid-write: 4000/4000 acks=all records acknowledged, controller
  quorum kept a leader; second site stopped: no record acknowledged; after
  recovery all 5000 acknowledged records present with no duplicates; cold
  restart kept topics, ACLs and credentials.

One runner is one failure domain: this proves configuration and Kafka
behaviour, not the independence of the real sites, which the live site-loss
drill on ordered hosts must show. Connect/Debezium, Registry, the DR mirror and
monitoring are the next slices; ordering step 1 (primary 8 hosts) is now open.
