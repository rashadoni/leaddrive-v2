# PostgreSQL TLS and scratch maintenance plan

Status: planning and read-only evidence only. This document does not authorize
production, PostgreSQL, firewall, VPS, Docker, systemd, backup, restore, or
Kafka changes.

## Read-only decision evidence

The `postgres-san-scratch-audit` view in `Inspect production safely` reads only
the four endpoint host/port keys from the root-owned backup environment. It
does not source the file, authenticate to PostgreSQL, issue SQL, start a
service, or print a hostname, address, SAN, path, unit/container name, or
configuration value other than the non-secret port.

For the source endpoint it:

1. obtains the currently presented public certificate through a PostgreSQL TLS
   negotiation;
2. compares the single DNS SAN internally with the operating system hostname
   and FQDN;
3. resolves the matched name and compares the result only with loopback and
   addresses actually assigned to local interfaces; and
4. performs a second TLS-only connection using that name, hostname checking,
   and the presented self-signed certificate as the in-memory trust anchor.

For the configured scratch port it performs bounded, read-only discovery of:

- Debian/Ubuntu PostgreSQL clusters (`pg_lsclusters` and the standard cluster
  configuration tree);
- existing Docker containers and reviewed Compose definitions; and
- existing systemd service definitions that explicitly bind the scratch port.

Only enum states pass the workflow's second output-schema gate. Captured remote
output is never printed unless both result lines match that schema.

## Source TLS decision

Client-only remediation without a PostgreSQL restart is proven only when all
three results are `yes`: the SAN matches the production server name, that name
resolves to a local interface address, and the TLS-only hostname verification
succeeds. A missing or negative result is a stop condition, not permission to
change DNS or the server certificate.

After a separately confirmed maintenance window, the proven client-only path
is:

1. export the currently presented self-signed public certificate through a
   TLS-only connection and independently compare its approved fingerprint;
2. install that public certificate as a dedicated, root-owned source CA file;
3. atomically change only the source client settings in `backup.env` to use the
   matching DNS name, `verify-full`, and that source CA file; and
4. run only TLS/configuration readiness checks while all backup and recovery
   timers remain disabled.

No PostgreSQL restart is part of this path. If any decision result is not
positive, certificate re-issuance and DNS correction need a separate reviewed
maintenance plan; whether a reload is sufficient must be proved against the
installed PostgreSQL version before execution.

Rollback is to restore the exact pre-window backup environment and remove only
the newly staged public CA file after confirming that no service uses it.

## Scratch decision

The backup contract requires a disposable, isolated loopback PostgreSQL
cluster on the configured scratch port, with storage separate from production.
It must never be a database created inside the production/source cluster. A
Docker or custom systemd definition is not implied by the port alone.

The audit distinguishes an existing separate PostgreSQL cluster, Docker,
Compose, custom systemd, multiple conflicting definitions, and no definition
in the reviewed locations. It does not start or create any of them.

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
