# PostgreSQL TLS and scratch maintenance plan

Status: the separately confirmed source environment/CA/passfile maintenance
completed successfully. The source backup client now uses `PGHOST` plus
`PGHOSTADDR` with `verify-full`, its dedicated source CA, and a matching
passfile selector; credential fields were preserved. PostgreSQL and services
were not restarted. The isolated scratch cluster is still absent until its own
workflow is merged and separately confirmed. Backup, restore, deploy, and Kafka
runtime changes are not part of scratch provisioning.

## Read-only decision evidence

The `postgres-san-scratch-audit` view in `Inspect production safely` reads only
the seven allowlisted source route/TLS and endpoint host/port keys from the
root-owned backup environment. It does not source the file, authenticate to
PostgreSQL, issue SQL, start a service, or print a hostname, address, SAN, path,
unit/container name, or configuration value other than the non-secret port.

For the source endpoint it:

1. obtains the currently presented public certificate through a PostgreSQL TLS
   negotiation;
2. compares the single DNS SAN internally with the operating system hostname
   and FQDN;
3. resolves the matched name and compares the result only with loopback and
   addresses actually assigned to local interfaces; and
4. verifies the certificate identity at the currently configured endpoint by
   using the SAN as the TLS server name and the presented self-signed
   certificate as the in-memory trust anchor; and
5. separately repeats the TLS-only connection through the SAN's own DNS
   resolution, without authentication or SQL.

For the configured scratch port it performs bounded, read-only discovery of:

- Debian/Ubuntu PostgreSQL clusters (`pg_lsclusters` and the standard cluster
  configuration tree);
- existing Docker containers and reviewed Compose definitions; and
- existing systemd service definitions that explicitly bind the scratch port.

Only enum states pass the workflow's second output-schema gate. Captured remote
output is never printed unless both result lines match that schema.

## Source TLS decision

Client-only remediation without a PostgreSQL restart has two distinct paths:

- `direct-dns`: the SAN matches the production server name, resolves to a local
  interface, and `verify-full` succeeds through that DNS name;
- `client-hostaddr-required`: certificate identity verification succeeds at
  the current source endpoint, but the direct DNS/listener path does not. This
  is evidence for a future client-only `PGHOST` plus `PGHOSTADDR` design, not
  permission to use it now. The backup scripts and readiness contract must gain
  explicit reviewed support in a separate PR before the maintenance window.

`not-proven` is a stop condition, not permission to change DNS or the server
certificate.

The approved maintenance path is:

1. export the currently presented self-signed public certificate through a
   TLS-only connection and independently compare its approved fingerprint;
2. install that public certificate as a dedicated, root-owned source CA file;
3. atomically change only the source client settings in `backup.env` to use the
   matching DNS name, `verify-full`, and that source CA file; for the
   `client-hostaddr-required` path, first land the separately reviewed,
   fail-closed `PGHOSTADDR` support and bind it to the already classified source
   address without printing that value. If the passfile selector does not
   already match the certificate identity, use only the separately confirmed
   combined operation, which replaces that one selector in the same sealed
   transaction while preserving the credential fields byte-for-byte; and
4. run only TLS/configuration readiness checks; do not start or enable any
   backup or recovery timer.

The dispatch-only `Remediate production PostgreSQL source TLS client` workflow
implements this path. It is bound to the exact current `main` SHA, the protected
production environment, the pinned SSH host key, an operation-specific typed
confirmation, and the production concurrency fence. The streamed script
accepts no hostname, address, path, certificate, or credential input.

Before writing, it observes the certificate twice and requires an identical
fingerprint, a self-signed identity, exactly one DNS SAN equal to the production
server name, local name resolution, and successful in-memory `verify-full`
through the already configured local endpoint. It also requires at least seven
days of certificate validity, server TLS purpose, a matching `.pgpass` entry for
the new certificate identity, any installed backup artifact to match an exact
reviewed script, and an inactive, non-enabled service and timer. If the backup unit is already
commissioned, its exact reviewed bytes and its own nonblocking lock are also
mandatory; the expected pre-commission state may omit the unit and lock.
Extended attributes are a stop condition so an atomic replacement cannot
silently drop an ACL or security label. It then creates a root-only sealed snapshot, atomically
installs the public source CA, and atomically changes only `PGHOST`,
`PGHOSTADDR`, `PGSSLMODE`, and `PGSSLROOTCERT`. A failed post-write TLS check
automatically restores the snapshot. Workflow output is a single schema-gated
enum line, including only an allowlisted preflight failure stage when blocked,
and contains no raw configuration or certificate identity.

The controlled transition accepts an absent or standard libpq TLS mode and an
absent or absolute non-URL starting CA path, then installs both reviewed
`verify-full` and dedicated source-CA settings. Database identity, user and
passfile settings remain mandatory; any service-based connection or password
override remains a stop condition.

The passfile may use either the reviewed root/group-readable authority or the
runbook's private dedicated-service-user authority. The default `apply`
operation only reads and validates it. The separately confirmed
`apply-with-passfile-selector` operation accepts exactly one existing tuple for
the current source host, rewrites only that tuple's host selector, preserves
all remaining bytes and file authority, includes the full pre-change file in
the root-only rollback snapshot, and revalidates the new tuple after the atomic
write. It refuses missing or ambiguous tuples and never emits passfile bytes.
A deployed backup script that does not yet accept the service-user-owned
variant remains uncommissioned until a separate reviewed deployment reconciles
that contract.

No PostgreSQL restart is part of this path. If any decision result is not
positive, certificate re-issuance and DNS correction need a separate reviewed
maintenance plan; whether a reload is sufficient must be proved against the
installed PostgreSQL version before execution.

Rollback is the workflow's separate `rollback` operation. It refuses to act if
the current files do not match the recorded post-change hashes, restores the
exact pre-window environment and prior CA state atomically, and retains the
root-only snapshot as evidence.

## Scratch decision

The current bounded audit found no separate PostgreSQL cluster, Docker
container, or custom systemd definition for the configured scratch port. The
Compose probe was incomplete, so no existing launcher is proven and nothing is
safe to start. The required future mechanism is therefore still a newly
reviewed, dedicated disposable PostgreSQL cluster; Docker/Compose is not
selected merely because an old development example used it.

The backup contract requires a disposable, isolated loopback PostgreSQL
cluster on the configured scratch port, with storage separate from production.
It must never be a database created inside the production/source cluster. A
Docker or custom systemd definition is not implied by the port alone.

The audit distinguishes an existing separate PostgreSQL cluster, Docker,
Compose, custom systemd, multiple conflicting definitions, and no definition
in the reviewed locations. It also reports a separate `present`, `absent`, or
`unknown` probe state for each mechanism so an incomplete inspection cannot be
mistaken for absence. It does not start or create any of them.

The dispatch-only `Provision isolated PostgreSQL restore scratch` workflow is
the selected mechanism. After its own typed maintenance confirmation it creates
exactly one standard Debian PostgreSQL 16 cluster named `leaddriverestore` on
IPv4 loopback port `55432`, using a distinct data directory and a dedicated
`leaddrive_restore_verifier` login. The login is `NOSUPERUSER`, `NOCREATEROLE`,
`NOREPLICATION`, `NOBYPASSRLS`, and has only the `CREATEDB` capability required
by the restore canary. Host authentication permits only TLS/SCRAM access for
that role from loopback and rejects other TCP clients.

The workflow installs no packages and accepts no operator-provided path,
hostname, password, certificate, or port. It refuses an existing cluster,
existing listener, active recovery unit, unavailable source identity, unsafe
file authority, or prior unclosed rollback snapshot. It creates an independent
CA and loopback-IP server certificate, atomically writes only the scratch
client keys in `backup.env`, starts the new cluster only long enough to create
and test the limited verifier role, proves `verify-full` and a system identifier
different from the source, then stops it. Any failure after the snapshot
automatically removes only the newly created cluster and restores the exact
previous environment, scratch passfile, and scratch CA state.

The separate `rollback` operation refuses byte drift, drops only this fixed
cluster, restores the sealed snapshot, and again proves the source-cluster
inventory is unchanged. The cluster's lifecycle during an actual recovery run
is a later reviewed step; provisioning alone never performs a dump or restore.

The scratch CA comes from the newly generated scratch trust chain. The script
compares it with the source CA and refuses equality; the source certificate and
source CA are never copied. The public scratch CA and verifier passfile are
root-owned and readable only by the dedicated backup group.

An existing byte-drifted backup unit is not approved or rewritten by the
source TLS maintenance. The maintenance may treat it only as uncommissioned
when the active backup script is an exact reviewed artifact and both the
service and timer are inactive and non-enabled (or absent) before and after the
atomic client configuration update. Commissioning remains blocked until a
separate reviewed deployment reconciles the exact unit bytes.

Rollback is limited to stopping the scratch mechanism created in that window,
removing only its disposable data and CA after evidence retention, and proving
that the source endpoint and all disabled recovery timers were unchanged.

## Explicit exclusions

Merging the implementation does not itself provision the cluster. The `apply`
dispatch remains a production/database change and requires the exact typed
maintenance confirmation. Provisioning does not authorize backup commissioning,
an actual dump/restore, Kafka consumers, offset reset, replay, firewall changes,
VPS power operations, or application deploy beyond the repository's normal
SHA-bound delivery of this reviewed code.
