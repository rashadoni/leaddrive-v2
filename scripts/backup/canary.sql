\set ON_ERROR_STOP on
\set QUIET 1
\pset tuples_only on
\pset format unaligned
\pset fieldsep '\t'
\set QUIET 0

-- The application policies intentionally accept app.rls_bypass for trusted
-- cross-tenant jobs.  The source connection is still required by
-- postgres-backup.sh to use a real NOSUPERUSER BYPASSRLS database role.  This
-- setting is also needed when the same query runs against the restored scratch
-- database, where the verifier owns the restored tables but FORCE RLS applies.
SELECT set_config('app.rls_bypass', 'on', false) AS rls_canary_context \gset

WITH anchor AS (
  -- Pick a tenant that is known to contain at least one user.  Choosing the
  -- lexicographically first organization could select an empty tenant and turn
  -- the anchor check into a false sense of safety.
  SELECT u."organizationId" AS id
  FROM users u
  GROUP BY u."organizationId"
  ORDER BY count(*) DESC, u."organizationId"
  LIMIT 1
), metrics AS (
  SELECT
    'organizations'::text AS metric,
    count(*)::bigint AS row_count,
    coalesce(sum((('x' || substr(md5(id), 1, 15))::bit(60)::bigint)::numeric), 0)::text AS id_fingerprint,
    coalesce(min(id), '')::text AS anchor_id
  FROM organizations

  UNION ALL

  SELECT
    'users',
    count(*)::bigint,
    coalesce(sum((('x' || substr(md5(id || chr(31) || "organizationId"), 1, 15))::bit(60)::bigint)::numeric), 0)::text,
    coalesce(min(id), '')::text
  FROM users

  UNION ALL

  SELECT
    'contacts',
    count(*)::bigint,
    coalesce(sum((('x' || substr(md5(id || chr(31) || "organizationId"), 1, 15))::bit(60)::bigint)::numeric), 0)::text,
    coalesce(min(id), '')::text
  FROM contacts

  UNION ALL

  SELECT
    'deals',
    count(*)::bigint,
    coalesce(sum((('x' || substr(md5(id || chr(31) || "organizationId"), 1, 15))::bit(60)::bigint)::numeric), 0)::text,
    coalesce(min(id), '')::text
  FROM deals

  UNION ALL

  SELECT
    'anchor_users',
    count(*)::bigint,
    coalesce(sum((('x' || substr(md5(u.id || chr(31) || u."organizationId"), 1, 15))::bit(60)::bigint)::numeric), 0)::text,
    coalesce((SELECT id FROM anchor), '')::text
  FROM users u
  WHERE u."organizationId" = (SELECT id FROM anchor)

  UNION ALL

  SELECT
    'anchor_contacts',
    count(*)::bigint,
    coalesce(sum((('x' || substr(md5(c.id || chr(31) || c."organizationId"), 1, 15))::bit(60)::bigint)::numeric), 0)::text,
    coalesce((SELECT id FROM anchor), '')::text
  FROM contacts c
  WHERE c."organizationId" = (SELECT id FROM anchor)

  UNION ALL

  SELECT
    'anchor_deals',
    count(*)::bigint,
    coalesce(sum((('x' || substr(md5(d.id || chr(31) || d."organizationId"), 1, 15))::bit(60)::bigint)::numeric), 0)::text,
    coalesce((SELECT id FROM anchor), '')::text
  FROM deals d
  WHERE d."organizationId" = (SELECT id FROM anchor)
)
SELECT metric, row_count, id_fingerprint, anchor_id
FROM metrics
ORDER BY metric;
