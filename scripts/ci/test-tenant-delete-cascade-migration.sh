#!/usr/bin/env bash
set -euo pipefail

MIGRATION_NAME="20260827090000_tenant_delete_cascades"
MIGRATION_FILE="prisma/migrations/$MIGRATION_NAME/migration.sql"
ARTIFACT_STATE_FILE="prisma/verification/tenant-delete-cascade-artifact-state.sql"
TEST_DATABASE_URL="${TENANT_CASCADE_TEST_DATABASE_URL:-}"
TEST_CONFIRM="${TENANT_CASCADE_TEST_CONFIRM:-}"

[ -n "$TEST_DATABASE_URL" ] || {
  echo "TENANT_CASCADE_TEST_DATABASE_URL is required" >&2
  exit 1
}

if [[ ! "$TEST_DATABASE_URL" =~ ^postgres(ql)?://[^/@]+@((127\.0\.0\.1)|(localhost)):[0-9]+/tenant_cascade_test$ ]]; then
  echo "refusing to run tenant-cascade integration test against a non-local database" >&2
  exit 1
fi
[ "$TEST_CONFIRM" = "drop-local-tenant-cascade-test-schema" ] || {
  echo "tenant-cascade test confirmation sentinel is missing" >&2
  exit 1
}

database_name=$(psql "$TEST_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT current_database();")
[ "$database_name" = "tenant_cascade_test" ] || {
  echo "refusing to reset an unexpected database" >&2
  exit 1
}

[ -f "$MIGRATION_FILE" ] || {
  echo "migration file is missing" >&2
  exit 1
}
[ -f "$ARTIFACT_STATE_FILE" ] || {
  echo "tenant-cascade catalog fence is missing" >&2
  exit 1
}

cleanup_test_role() {
  psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
    -c "DROP OWNED BY tenant_cascade_limited; DROP ROLE IF EXISTS tenant_cascade_limited;" \
    >/dev/null 2>&1 || true
}

read_artifact_state() {
  psql "$TEST_DATABASE_URL" -X -qAtF '|' -v ON_ERROR_STOP=1 \
    -c "BEGIN TRANSACTION READ ONLY;" \
    -f "$ARTIFACT_STATE_FILE" \
    -c "COMMIT;"
}

cleanup_test_role
trap cleanup_test_role EXIT

mapfile -t TARGET_TABLES < <(
  sed -nE "s/^[[:space:]]+'([a-z0-9_]+)'[,]?$/\1/p" "$MIGRATION_FILE"
)

[ "${#TARGET_TABLES[@]}" -eq 73 ] || {
  echo "expected 73 tenant-cascade targets, found ${#TARGET_TABLES[@]}" >&2
  exit 1
}

psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
CREATE TABLE organizations (id text PRIMARY KEY);
INSERT INTO organizations (id) VALUES ('live-tenant');
SQL

for table_name in "${TARGET_TABLES[@]}"; do
  [[ "$table_name" =~ ^[a-z0-9_]+$ ]] || {
    echo "unsafe migration target name" >&2
    exit 1
  }
  psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
    "CREATE TABLE \"$table_name\" (id text PRIMARY KEY, \"organizationId\" text);" \
    >/dev/null
done

psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
INSERT INTO additional_sales (id, "organizationId")
VALUES ('valid-row', 'live-tenant'), ('historical-orphan', 'deleted-tenant');
SQL

# This is the load-bearing RED/GREEN assertion: the old migration validates the
# historical row and fails with 23503. The corrected migration must install
# future enforcement without silently deleting or moving that unknown row.
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE" >/dev/null

orphan_count=$(psql "$TEST_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM additional_sales WHERE id = 'historical-orphan';")
[ "$orphan_count" = "1" ] || {
  echo "historical orphan was rewritten or removed" >&2
  exit 1
}

if psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  "INSERT INTO additional_sales (id, \"organizationId\") VALUES ('new-orphan', 'missing-tenant');" \
  >/dev/null 2>&1; then
  echo "new orphan insert unexpectedly succeeded" >&2
  exit 1
fi

psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  "DELETE FROM organizations WHERE id = 'live-tenant';" >/dev/null
valid_count=$(psql "$TEST_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM additional_sales WHERE id = 'valid-row';")
[ "$valid_count" = "0" ] || {
  echo "tenant delete did not cascade" >&2
  exit 1
}

constraint_state=$(psql "$TEST_DATABASE_URL" -X -AtF '|' -v ON_ERROR_STOP=1 -c \
  "SELECT count(*)::text,
          count(*) FILTER (WHERE NOT c.convalidated)::text
     FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = r.relnamespace
    WHERE n.nspname = 'public'
      AND r.relname = ANY (ARRAY[$(printf "'%s'," "${TARGET_TABLES[@]}" | sed 's/,$//')])
      AND c.contype = 'f'
      AND c.confrelid = 'public.organizations'::regclass
      AND c.confdeltype = 'c'
      AND c.confupdtype = 'c';")
[ "$constraint_state" = "73|73" ] || {
  echo "unexpected tenant-cascade constraint state: $constraint_state" >&2
  exit 1
}

artifact_state=$(read_artifact_state)
[ "$artifact_state" = "73|73|73|0|73" ] || {
  echo "tenant-cascade catalog fence returned an unsafe state: $artifact_state" >&2
  exit 1
}

# The orphan audit is evidence only when the executing role can see every
# tenant. Prove that its privilege guard rejects a normal RLS-bound role, then
# prove that the privileged run emits aggregates without leaking fixture IDs.
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
CREATE ROLE tenant_cascade_limited NOLOGIN;
GRANT USAGE ON SCHEMA public TO tenant_cascade_limited;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO tenant_cascade_limited;
SQL

if psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 \
  -c "SET ROLE tenant_cascade_limited;" \
  -f scripts/rls/audit-orphan-tenant-rows.sql >/dev/null 2>&1; then
  echo "orphan audit unexpectedly accepted an RLS-bound role" >&2
  exit 1
fi

orphan_audit=$(psql "$TEST_DATABASE_URL" -X -qAtF '|' -v ON_ERROR_STOP=1 \
  -f scripts/rls/audit-orphan-tenant-rows.sql 2>/dev/null)
[ "$orphan_audit" = "additional_sales|1" ] || {
  echo "privileged orphan audit returned unexpected aggregate evidence" >&2
  exit 1
}
if [[ "$orphan_audit" == *historical-orphan* || "$orphan_audit" == *deleted-tenant* ]]; then
  echo "privileged orphan audit exposed tenant-row identifiers" >&2
  exit 1
fi

# A retry must be a no-op, not create duplicates or expose historical rows.
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -f "$MIGRATION_FILE" >/dev/null
retry_count=$(psql "$TEST_DATABASE_URL" -X -At -v ON_ERROR_STOP=1 -c \
  "SELECT count(*) FROM pg_constraint c
     JOIN pg_class r ON r.oid = c.conrelid
    WHERE r.relname = ANY (ARRAY[$(printf "'%s'," "${TARGET_TABLES[@]}" | sed 's/,$//')])
      AND c.contype = 'f'
      AND c.confrelid = 'public.organizations'::regclass;")
[ "$retry_count" = "73" ] || {
  echo "migration retry changed the constraint count" >&2
  exit 1
}

# A catalog key is not operational if PostgreSQL's internal action triggers are
# disabled. In particular, a disabled organizations-side trigger makes tenant
# deletion stop cascading even though pg_constraint still says CASCADE.
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE public.organizations DISABLE TRIGGER ALL;" >/dev/null
disabled_trigger_state=$(read_artifact_state)
[ "$disabled_trigger_state" = "73|73|0|73|0" ] || {
  echo "tenant-cascade catalog fence missed disabled FK triggers" >&2
  exit 1
}
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 -c \
  "ALTER TABLE public.organizations ENABLE TRIGGER ALL;" >/dev/null
[ "$(read_artifact_state)" = "73|73|73|0|73" ] || {
  echo "tenant-cascade catalog fence did not recover after enabling FK triggers" >&2
  exit 1
}

# A same-name key with the wrong delete action must not pass the structural
# fence. Keep this after the idempotency assertion so the migration itself is
# still tested against the reviewed, exact state.
psql "$TEST_DATABASE_URL" -X -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
ALTER TABLE public.additional_sales
  DROP CONSTRAINT "additional_sales_organizationId_fkey";
ALTER TABLE public.additional_sales
  ADD CONSTRAINT "additional_sales_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES public.organizations(id)
  ON DELETE NO ACTION ON UPDATE CASCADE NOT VALID;
SQL

unsafe_artifact_state=$(read_artifact_state)
[ "$unsafe_artifact_state" = "73|73|72|1|72" ] || {
  echo "tenant-cascade catalog fence missed an incompatible key" >&2
  exit 1
}

echo "tenant-cascade migration integration passed (73 constraints; historical row preserved)"
