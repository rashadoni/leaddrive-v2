# Production database migrations

Production application traffic and Prisma migrations must use different
PostgreSQL roles:

- the application role is `NOSUPERUSER NOBYPASSRLS` and remains subject to
  `FORCE ROW LEVEL SECURITY`;
- the migration role is `NOSUPERUSER BYPASSRLS` and is available only to the
  root-owned deploy process.

This separation is required because a data backfill executed by the
application role without tenant context sees zero rows under `FORCE RLS`.
Adding a `NOT NULL` constraint after such an empty backfill can fail a deploy.

## Provisioning

For the current self-hosted PostgreSQL server, run the audited helper as root:

```bash
ops/migration/provision-self-hosted.sh
```

It generates the password without printing it, installs the root-only env
file, verifies a real password connection and RLS bypass, and rolls back a DDL
ownership probe. It refuses to overwrite an existing role or secret file.

Generate a URL-safe password outside SQL and do not print or commit it. As a
PostgreSQL administrator, create the role and grant membership in the current
object-owning role. Membership is required for `ALTER TABLE`; ordinary table
grants are not sufficient for ownership operations.

```sql
CREATE ROLE leaddrive_migrator
  LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS
  CONNECTION LIMIT 2
  PASSWORD '<generated-password>';

GRANT hermes TO leaddrive_migrator;

ALTER ROLE leaddrive_migrator IN DATABASE leaddrive_v2
  SET lock_timeout = '10s';
ALTER ROLE leaddrive_migrator IN DATABASE leaddrive_v2
  SET statement_timeout = '14min';
ALTER ROLE leaddrive_migrator IN DATABASE leaddrive_v2
  SET idle_in_transaction_session_timeout = '60s';
```

Install [ops/migration/migration.env.example](../ops/migration/migration.env.example)
as `/etc/leaddrive/migration.env`, replace the password, and apply:

```bash
chown root:root /etc/leaddrive/migration.env
chmod 0600 /etc/leaddrive/migration.env
```

Never place `MIGRATION_DATABASE_URL` in `/etc/leaddrive/app.env` (or its
checkout compatibility symlink): PM2 reads that application environment, which
would expose tenant-bypass credentials to the web process.

## Deploy gates

Before replacing the live standalone tree, `scripts/server-deploy.sh` verifies:

1. the migration secret file is root-owned and mode `0600`;
2. application and migration connections use different roles;
3. the application role is `NOSUPERUSER NOBYPASSRLS`;
4. the migration role is `NOSUPERUSER BYPASSRLS` and matches the expected role;
5. the migration role is a member of every owner role for relations in the
   `public` schema;
6. active transactions and live system, collector, and outbound leases reach
   zero during a 60-second quiet-window check.

PostgreSQL `lock_timeout` is the final race-condition guard: if a new request
acquires an incompatible lock after the quiet-window check, the migration
fails quickly and the deploy restores the previous standalone bundle.

Run the exact production preflight without touching the bundle, schema, or
PM2 process:

```bash
DEPLOY_PREFLIGHT_ONLY=1 bash scripts/server-deploy.sh
```

Migrations must connect directly to the writable primary. Do not route Prisma
migrations through PgBouncer transaction pooling or a read replica.

### `btree_gist` preflight for effective-dated Workforce assignments

The Workforce H3 migration uses PostgreSQL's trusted `btree_gist` extension
for a race-safe exclusion constraint over an employee's effective-dated shift
assignments. Before applying that migration, the migration operator must run:

```sql
SELECT name, installed_version, trusted
FROM pg_available_extensions
WHERE name = 'btree_gist';

SELECT has_database_privilege(current_user, current_database(), 'CREATE');
```

Do not apply the migration if the extension is unavailable, or if it is not
installed and the migration role cannot create trusted extensions in the
database. Install the PostgreSQL contrib package and/or grant database `CREATE`
to the migration role through the approved operator workflow, then repeat the
preflight. This check changes neither the schema nor application data.

## Migration design

Prefer expand/contract migrations:

1. add nullable columns or new tables;
2. deploy code that can read both old and new shapes;
3. backfill in bounded batches;
4. validate the invariant;
5. add `NOT NULL`, uniqueness, or removal constraints in a later deploy.

For a known blocking or destructive migration, pause external schedules and
drain application traffic explicitly. A momentary quiet-window check is not a
replacement for a declared maintenance window.

Do not edit an already successful migration. Recover a failed migration only
after verifying whether its SQL transaction rolled back completely, then use
`prisma migrate resolve --rolled-back <migration>` and re-run the corrected
migration.

### Successful tenant-cascade migration

`20260827090000_tenant_delete_cascades` is already successful in production and
is immutable. Its reviewed SHA-256 is
`28e3ceba5dbace8e53b66e4faf304ebad1a1618452bfe9e5b3c7a60e92be0dff`.
Do not edit it and do not run `migrate resolve` for it.

Every deploy performs a read-only preflight before backup and repeats the same
postcondition before PM2 activation. It pins the successful migration hash and
the aggregate-only query
`prisma/verification/tenant-delete-cascade-artifact-state.sql`, requires one
matching successful ledger row and no unresolved migrations, and checks that
all 73 expected tables carry one exact `organizationId -> organizations.id`
key with `ON DELETE CASCADE ON UPDATE CASCADE` and the complete active set of
PostgreSQL referential-integrity triggers. The query reports catalog counts
only; it does not read or emit tenant rows. The number of `NOT VALID` keys may
decrease as separately reviewed validation work completes, but missing,
duplicate, disabled, or incompatible keys block deployment.

Historical orphan review remains a retention decision. Run
`scripts/rls/audit-orphan-tenant-rows.sql` only through a `SUPERUSER` or
`BYPASSRLS` role; the script refuses an RLS-filtered role. Do not delete,
quarantine, or rewrite historical rows as part of deployment.

### GAP-003 contact migration recovery

The first production attempt of
`20260722040000_mtm_contact_master_parity` referenced the Prisma model name
`Organization` instead of its mapped PostgreSQL table `organizations`. The
deploy script contains a one-time, migration-name-scoped recovery guard. It
checks for every table, type, enum value, column, index, and constraint added by
that migration. Automatic `--rolled-back` recovery is allowed only when none of
those artifacts exists; any partial schema aborts the deploy before the Prisma
migration ledger is changed.

## Rotation and removal

Rotate only the migration password, update `/etc/leaddrive/migration.env`, and
run the role preflight before the next deploy. Do not grant `BYPASSRLS` to the
application role. Remove the migration role only after changing the deploy
pipeline and confirming it has no active sessions or owned objects.
