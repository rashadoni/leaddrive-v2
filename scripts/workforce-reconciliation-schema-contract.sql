-- Additive catalog-only observation of the exact dormant C12 table.
-- No business rows, identities, expressions or ACL values leave this query.
-- This does not replace the existing migration metadata gate or authorize it.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
SET LOCAL search_path = pg_catalog, public;

WITH
target AS (
  SELECT c.* FROM pg_catalog.pg_class c
  WHERE c.oid = pg_catalog.to_regclass('public.workforce_reconciliation_tenant_states')
),
columns(position,name,type_oid,typmod,not_null,default_expr) AS (VALUES
  (1,'organizationId','pg_catalog.text'::regtype,-1,true,NULL::text),
  (2,'attemptToken','pg_catalog.uuid'::regtype,-1,false,NULL::text),
  (3,'lastAttemptAt','pg_catalog.timestamp'::regtype,3,false,NULL::text),
  (4,'lastCompletedAt','pg_catalog.timestamp'::regtype,3,false,NULL::text),
  (5,'dueAt','pg_catalog.timestamp'::regtype,3,true,'CURRENT_TIMESTAMP'),
  (6,'consecutiveFailures','pg_catalog.int4'::regtype,-1,true,'0'),
  (7,'lastOutcome','pg_catalog.text'::regtype,-1,true,'''NEVER''::text'),
  (8,'examinedCount','pg_catalog.int4'::regtype,-1,true,'0'),
  (9,'mismatchCount','pg_catalog.int4'::regtype,-1,true,'0'),
  (10,'durationMs','pg_catalog.int4'::regtype,-1,true,'0'),
  (11,'updatedAt','pg_catalog.timestamp'::regtype,3,true,'CURRENT_TIMESTAMP')
),
expected_checks(definition) AS (VALUES
  ('CHECK ((("consecutiveFailures" >= 0) AND ("consecutiveFailures" <= 1000)))'),
  ('CHECK ((("examinedCount" >= 0) AND ("examinedCount" <= 100000)))'),
  ('CHECK ((("mismatchCount" >= 0) AND ("mismatchCount" <= 1000000)))'),
  ('CHECK ((("durationMs" >= 0) AND ("durationMs" <= 3600000)))'),
  ('CHECK (("lastOutcome" = ANY (ARRAY[''NEVER''::text, ''RUNNING''::text, ''MATCHED''::text, ''MISMATCH''::text, ''INCOMPLETE''::text, ''FENCED_OUT''::text, ''VERSION_EXHAUSTED''::text, ''UNKNOWN''::text])))')
),
constraints AS (
  SELECT k.* FROM pg_catalog.pg_constraint k WHERE k.conrelid = (SELECT oid FROM target)
),
policies AS (
  SELECT p.* FROM pg_catalog.pg_policy p WHERE p.polrelid = (SELECT oid FROM target)
),
policy_expression(value) AS (VALUES
  ('(("organizationId" = current_setting(''app.org_id''::text, true)) OR (current_setting(''app.rls_bypass''::text, true) = ''on''::text))')
),
table_indexes AS (
  SELECT i.*,c.relname,c.relam,am.amname FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class c ON c.oid=i.indexrelid
  JOIN pg_catalog.pg_am am ON am.oid=c.relam
  WHERE i.indrelid=(SELECT oid FROM target)
)
SELECT pg_catalog.json_build_object(
  'readOnly',pg_catalog.current_setting('transaction_read_only')='on',
  'repeatableRead',pg_catalog.current_setting('transaction_isolation')='repeatable read',
  'postgres16',pg_catalog.current_setting('server_version_num')::integer BETWEEN 160000 AND 169999,
  'ordinaryTable',COALESCE((SELECT relkind='r' AND NOT relispartition AND relpersistence='p' FROM target),false),
  'columnShape',COALESCE((SELECT count(*)=11 AND bool_and(
    a.attnum=c.position AND a.atttypid=c.type_oid AND a.atttypmod=c.typmod
    AND a.attnotnull=c.not_null AND a.attidentity='' AND a.attgenerated=''
    AND a.attcollation=CASE WHEN c.type_oid='pg_catalog.text'::regtype THEN 'pg_catalog."default"'::regcollation::oid ELSE 0 END)
    FROM columns c JOIN pg_catalog.pg_attribute a ON a.attrelid=(SELECT oid FROM target)
      AND a.attname=c.name AND a.attnum>0 AND NOT a.attisdropped),false)
    AND (SELECT count(*)=11 FROM pg_catalog.pg_attribute WHERE attrelid=(SELECT oid FROM target) AND attnum>0 AND NOT attisdropped),
  'defaults',COALESCE((SELECT bool_and(pg_catalog.pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM c.default_expr)
    FROM columns c LEFT JOIN pg_catalog.pg_attribute a ON a.attrelid=(SELECT oid FROM target) AND a.attname=c.name AND NOT a.attisdropped
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum),false)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attrdef a JOIN pg_catalog.pg_depend d
      ON d.classid='pg_catalog.pg_attrdef'::regclass AND d.objid=a.oid
      WHERE a.adrelid=(SELECT oid FROM target) AND NOT (
        d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=a.adrelid)),
  'primaryKey',EXISTS (SELECT 1 FROM constraints k JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
    WHERE k.contype='p' AND k.conkey=ARRAY[1]::smallint[] AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
      AND i.indisprimary AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnkeyatts=1 AND i.indnatts=1 AND i.indpred IS NULL AND i.indexprs IS NULL),
  'foreignKey',EXISTS (SELECT 1 FROM constraints k JOIN pg_catalog.pg_class r ON r.oid=k.confrelid
    JOIN pg_catalog.pg_attribute a ON a.attrelid=r.oid AND a.attname='id' AND NOT a.attisdropped
    JOIN pg_catalog.pg_index i ON i.indexrelid=k.conindid
    WHERE k.contype='f' AND r.oid=pg_catalog.to_regclass('public.organizations') AND r.relkind='r'
      AND a.atttypid='pg_catalog.text'::regtype AND a.attnotnull AND a.attcollation='pg_catalog."default"'::regcollation
      AND k.conkey=ARRAY[1]::smallint[] AND k.confkey=ARRAY[a.attnum]::smallint[]
      AND k.confdeltype='c' AND k.confupdtype='a' AND k.confmatchtype='s'
      AND k.convalidated AND NOT k.condeferrable AND NOT k.condeferred
      AND k.conpfeqop=ARRAY['pg_catalog.=(text,text)'::regoperator]::oid[]
      AND k.conppeqop=k.conpfeqop AND k.conffeqop=k.conpfeqop
      AND i.indrelid=r.oid AND i.indisunique AND i.indisvalid AND i.indisready
      AND i.indnatts=1 AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum AND i.indpred IS NULL AND i.indexprs IS NULL
      AND (SELECT count(*)=4 AND bool_and(t.tgisinternal AND t.tgenabled='O' AND NOT t.tgdeferrable AND NOT t.tginitdeferred
        AND p.pronamespace='pg_catalog'::regnamespace AND p.proname IN ('RI_FKey_check_ins','RI_FKey_check_upd','RI_FKey_cascade_del','RI_FKey_noaction_upd'))
        FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid WHERE t.tgconstraint=k.oid)),
  'checks',(SELECT count(*)=7 FROM constraints)
    AND COALESCE((SELECT count(*)=5 AND bool_and(k.convalidated AND NOT k.connoinherit
      AND pg_catalog.pg_get_constraintdef(k.oid)=ANY(ARRAY(SELECT definition FROM expected_checks))) FROM constraints k WHERE k.contype='c'),false)
    AND NOT EXISTS (SELECT definition FROM expected_checks EXCEPT SELECT pg_catalog.pg_get_constraintdef(oid) FROM constraints WHERE contype='c')
    AND NOT EXISTS (SELECT 1 FROM constraints k JOIN pg_catalog.pg_depend d
      ON d.classid='pg_catalog.pg_constraint'::regclass AND d.objid=k.oid
      WHERE k.contype='c' AND NOT (d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=k.conrelid)),
  'rls',COALESCE((SELECT relrowsecurity AND relforcerowsecurity FROM target),false),
  'policy',(SELECT count(*)=1 FROM policies)
    AND COALESCE((SELECT bool_and(p.polname='tenant_isolation' AND p.polcmd='*' AND p.polpermissive
      AND p.polroles=ARRAY[0]::oid[]
      AND pg_catalog.pg_get_expr(p.polqual,p.polrelid)=(SELECT value FROM policy_expression)
      AND pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)=(SELECT value FROM policy_expression)) FROM policies p),false)
    AND NOT EXISTS (SELECT 1 FROM policies p JOIN pg_catalog.pg_depend d
      ON d.classid='pg_catalog.pg_policy'::regclass AND d.objid=p.oid WHERE NOT (
        (d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=p.polrelid AND d.refobjsubid IN (0,1))
        OR (d.refclassid='pg_catalog.pg_proc'::regclass AND d.refobjid='pg_catalog.current_setting(text,boolean)'::regprocedure))),
  'indexes',(SELECT count(*)=2 FROM table_indexes)
    AND COALESCE((SELECT bool_and(i.amname='btree' AND i.indisvalid AND i.indisready
      AND i.indpred IS NULL AND i.indexprs IS NULL AND i.indnkeyatts=i.indnatts
      AND (SELECT array_agg(k.attnum ORDER BY k.n) FROM unnest(i.indkey::smallint[]) WITH ORDINALITY k(attnum,n))
        =CASE WHEN i.indisprimary THEN ARRAY[1]::smallint[] ELSE ARRAY[5,3,1]::smallint[] END
      AND (i.indisprimary OR (i.relname='wf_reconciliation_due_attempt_org_idx' AND NOT i.indisunique))
      AND (SELECT bool_and(o=0) FROM unnest(i.indoption::smallint[]) o)
      AND (SELECT bool_and(op.opcdefault AND op.opcintype=a.atttypid AND op.opcmethod=i.relam AND op.opcnamespace='pg_catalog'::regnamespace AND col=a.attcollation)
        FROM unnest(i.indkey::smallint[],i.indclass::oid[],i.indcollation::oid[]) k(attnum,opclass,col)
        JOIN pg_catalog.pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
        JOIN pg_catalog.pg_opclass op ON op.oid=k.opclass)) FROM table_indexes i),false),
  'noUserTriggers',NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid=(SELECT oid FROM target) AND NOT tgisinternal)
);
ROLLBACK;
