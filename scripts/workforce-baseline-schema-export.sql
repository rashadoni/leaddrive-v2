-- Catalogs plus explicitly selected migration metadata only. No application rows.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';
SET LOCAL TIME ZONE 'UTC';
SET LOCAL search_path = pg_catalog;
-- Refuse unsupported relations before evaluating the ledger or any view body.
DO $guard$
BEGIN
  IF (SELECT relkind FROM pg_class WHERE oid=to_regclass('public._prisma_migrations')) IS DISTINCT FROM 'r'
    OR row_security_active('public._prisma_migrations'::regclass)
    OR (to_regclass('public.api_keys') IS NOT NULL
      AND (SELECT relkind FROM pg_class WHERE oid=to_regclass('public.api_keys')) IS DISTINCT FROM 'r')
    OR EXISTS (SELECT 1 FROM pg_inherits
      WHERE inhrelid IN (to_regclass('public.api_keys'),to_regclass('public._prisma_migrations'))
        OR inhparent IN (to_regclass('public.api_keys'),to_regclass('public._prisma_migrations'))) THEN
    RAISE EXCEPTION 'WORKFORCE_BASELINE_RELATION_REFUSED';
  END IF;
END
$guard$;
WITH target AS (SELECT to_regclass('public.api_keys') AS oid),
columns AS (
  SELECT a.attnum AS position, a.attname AS name, format_type(a.atttypid,a.atttypmod) AS type,
    a.attnotnull AS "notNull", a.attidentity AS identity, a.attgenerated AS generated,
    a.attcollation=ty.typcollation AS "defaultCollation",
    CASE WHEN d.oid IS NULL THEN 'NONE'
      WHEN pg_get_expr(d.adbin,d.adrelid) IN ('true','false','now()','CURRENT_TIMESTAMP')
        THEN pg_get_expr(d.adbin,d.adrelid) ELSE 'OMITTED' END AS "defaultKind",
    CASE WHEN d.oid IS NOT NULL THEN encode(sha256(convert_to(pg_get_expr(d.adbin,d.adrelid),'UTF8')),'hex') END AS "defaultSha256"
  FROM pg_attribute a JOIN target t ON a.attrelid=t.oid JOIN pg_type ty ON ty.oid=a.atttypid
  LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum
), constraints AS (
  SELECT c.contype AS kind, ns.nspname AS schema, rel.relname AS relation,
    ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
    rns.nspname AS "referenceSchema", rr.relname AS "referenceRelation",
    ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute a ON a.attrelid=c.confrelid AND a.attnum=k.num ORDER BY k.ord) AS "referenceColumns",
    c.confupdtype AS "onUpdate", c.confdeltype AS "onDelete", c.confmatchtype AS "matchType",
    c.condeferrable AS deferrable, c.condeferred AS deferred, c.convalidated AS validated,
    c.conrelid=t.oid AS "onTarget",
    encode(sha256(convert_to(pg_get_constraintdef(c.oid,true),'UTF8')),'hex') AS "definitionSha256"
  FROM pg_constraint c CROSS JOIN target t JOIN pg_class rel ON rel.oid=c.conrelid
  JOIN pg_namespace ns ON ns.oid=rel.relnamespace
  LEFT JOIN pg_class rr ON rr.oid=c.confrelid LEFT JOIN pg_namespace rns ON rns.oid=rr.relnamespace
  WHERE c.conrelid=t.oid OR c.confrelid=t.oid
    OR (c.contype='p' AND c.conrelid IN (SELECT confrelid FROM pg_constraint WHERE conrelid=t.oid AND contype='f'))
), indexes AS (
  SELECT i.indisprimary AS "primary", i.indisunique AS "unique", i.indisvalid AS valid, i.indisready AS ready,
    am.amname AS method,
    ARRAY(SELECT a.attname FROM unnest(i.indkey) WITH ORDINALITY k(num,ord)
      LEFT JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.num ORDER BY k.ord) AS columns,
    i.indexprs IS NOT NULL AS expressions, i.indpred IS NOT NULL AS predicate,
    encode(sha256(convert_to(pg_get_indexdef(i.indexrelid),'UTF8')),'hex') AS "definitionSha256"
  FROM pg_index i JOIN target t ON i.indrelid=t.oid JOIN pg_class ix ON ix.oid=i.indexrelid
  JOIN pg_am am ON am.oid=ix.relam
), policies AS (
  SELECT p.polcmd AS command,p.polpermissive AS permissive,
    cardinality(p.polroles) AS "roleCount",
    ARRAY(SELECT encode(sha256(convert_to(role_id::text,'UTF8')),'hex') FROM unnest(p.polroles) role_id ORDER BY role_id) AS "roleReferences",
    encode(sha256(convert_to(COALESCE(pg_get_expr(p.polqual,p.polrelid),'') || E'\n' || COALESCE(pg_get_expr(p.polwithcheck,p.polrelid),''),'UTF8')),'hex') AS "definitionSha256"
  FROM pg_policy p JOIN target t ON p.polrelid=t.oid
), triggers AS (
  SELECT tg.tgenabled AS enabled, tg.tgisinternal AS internal, tg.tgnargs AS "argumentCount",
    encode(sha256(convert_to(pg_get_triggerdef(tg.oid,true),'UTF8')),'hex') AS "definitionSha256",
    encode(sha256(convert_to(pg_get_functiondef(tg.tgfoid),'UTF8')),'hex') AS "functionSha256"
  FROM pg_trigger tg JOIN target t ON tg.tgrelid=t.oid
), acl AS (
  SELECT encode(sha256(convert_to(x.grantee::text,'UTF8')),'hex') AS "roleReference",
    x.privilege_type AS privilege,x.is_grantable AS grantable
  FROM pg_class c JOIN target t ON c.oid=t.oid CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl,acldefault('r',c.relowner))) x
), ledger AS (
  SELECT migration_name AS name,checksum,started_at AS "startedAt",finished_at AS "finishedAt",
    rolled_back_at AS "rolledBackAt",applied_steps_count AS "appliedSteps"
  FROM public._prisma_migrations ORDER BY migration_name,id LIMIT 5001
)
SELECT jsonb_build_object(
  'format','workforce-baseline-catalog-v1',
  'observedAt',transaction_timestamp(),
  'serverVersion',current_setting('server_version_num'),
  'encoding',current_setting('server_encoding'),
  'inRecovery',pg_is_in_recovery(),
  'databaseFingerprint',encode(sha256(convert_to(current_database(),'UTF8')),'hex'),
  'collationFingerprint',(SELECT encode(sha256(convert_to(datcollate || E'\n' || datctype,'UTF8')),'hex') FROM pg_database WHERE datname=current_database()),
  'apiKeysExists',t.oid IS NOT NULL,
  'apiKeysRelationKind',(SELECT relkind FROM pg_class WHERE oid=t.oid),
  'ledgerRelationKind',(SELECT relkind FROM pg_class WHERE oid='public._prisma_migrations'::regclass),
  'ledgerVisibilityVerified',NOT row_security_active('public._prisma_migrations'::regclass),
  'rls',(SELECT jsonb_build_object('enabled',relrowsecurity,'forced',relforcerowsecurity,
    'ownerReference',encode(sha256(convert_to(relowner::text,'UTF8')),'hex')) FROM pg_class WHERE oid=t.oid),
  'columns',COALESCE((SELECT jsonb_agg(columns ORDER BY position) FROM columns),'[]'::jsonb),
  'constraints',COALESCE((SELECT jsonb_agg(constraints) FROM constraints),'[]'::jsonb),
  'indexes',COALESCE((SELECT jsonb_agg(indexes) FROM indexes),'[]'::jsonb),
  'policies',COALESCE((SELECT jsonb_agg(policies) FROM policies),'[]'::jsonb),
  'triggers',COALESCE((SELECT jsonb_agg(triggers) FROM triggers),'[]'::jsonb),
  'acl',COALESCE((SELECT jsonb_agg(acl) FROM acl),'[]'::jsonb),
  'ledger',COALESCE((SELECT jsonb_agg(ledger) FROM ledger),'[]'::jsonb)
) FROM target t;
ROLLBACK;
