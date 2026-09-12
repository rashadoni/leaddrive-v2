# PostgreSQL TLS and scratch maintenance plan

Status: a maintenance window is approved only for the source client TLS change
described below. Scratch, PostgreSQL, firewall, VPS, Docker, systemd services,
backup, restore, deploy, and Kafka changes remain unauthorized.

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
   address without printing that value; and
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
the new certificate identity, the exact reviewed systemd unit and backup script,
an inactive service and timer, and the backup's own nonblocking lock. Extended
attributes are a stop condition so an atomic replacement cannot silently drop
an ACL or security label. It then creates a root-only sealed snapshot, atomically
installs the public source CA, and atomically changes only `PGHOST`,
`PGHOSTADDR`, `PGSSLMODE`, and `PGSSLROOTCERT`. A failed post-write TLS check
automatically restores the snapshot. Workflow output is a single schema-gated
enum line and contains no raw configuration or certificate identity.

No PostgreSQL restart is part of this path. If any decision result is not
positive, certificate re-issuance and DNS correction need a separate reviewed
maintenance plan; whether a reload is sufficient must be proved against the
installed PostgreSQL version before execution.

Rollback is the workflow's separate `rollback` operation. It refuses to act if
the current files do not match the recorded post-change hashes, restores the
exact pre-window environment and prior CA state atomically, and retains the
root-only snapshot as evidence.

## Scratch decision

The backup contract requires a disposable, isolated loopback PostgreSQL
cluster on the configured scratch port, with storage separate from production.
It must never be a database created inside the production/source cluster. A
Docker or custom systemd definition is not implied by the port alone.

The audit distinguishes an existing separate PostgreSQL cluster, Docker,
Compose, custom systemd, multiple conflicting definitions, and no definition
in the reviewed locations. It also reports a separate `present`, `absent`, or
`unknown` probe state for each mechanism so an incomplete inspection cannot be
mistaken for absence. It does not start or create any of them.

After a separately confirmed maintenance window, provision exactly one
mechanism. Prefer a dedicated disposable PostgreSQL cluster because that is the
reviewed backup contract. Bind it to loopback only, use separate encrypted or
disposable storage and a separate verifier role, and keep it stopped outside a
controlled restore drill. A service manager may supervise that separate
cluster, but it does not turn the source cluster into an acceptable scratch
target.

The scratch CA must come from the independently provisioned scratch cluster's
own trust chain. Do not copy or reuse the source certificate or source CA. Pin
its separately approved fingerprint before setting scratch `verify-full`.

Rollback is limited to stopping the scratch mechanism created in that window,
removing only its disposable data and CA after evidence retention, and proving
that the source endpoint and all disabled recovery timers were unchanged.

## Explicit exclusions

This plan does not authorize backup commissioning, deploy, restore, Kafka
consumers, offset reset, replay, production SQL, firewall changes, VPS power
operations, or any service start. Each requires its own explicit authorization;
production or database changes additionally require maintenance-window
confirmation.
