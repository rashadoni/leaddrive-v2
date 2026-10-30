BEGIN;
SET LOCAL app.rls_bypass = 'on';
SELECT id AS company_id FROM organizations WHERE slug=:'slug' AND "isActive" FOR SHARE \gset
SELECT pg_advisory_xact_lock(hashtextextended('identity-registry:' || :'company_id',0));
SELECT set_config('app.org_id',:'company_id',true);
-- Capture the locked old value in a separate statement. A sibling modifying
-- CTE does not guarantee that a locking SELECT runs before the upsert.
SELECT COALESCE((SELECT value FROM mtm_settings WHERE "organizationId"=:'company_id' AND key='identityAuthV1' FOR UPDATE),'null'::jsonb) AS previous_value \gset
WITH changed AS (INSERT INTO mtm_settings(id,"organizationId",key,value,description,"updatedAt")
 VALUES (:'setting_id',:'company_id','identityAuthV1','{"version":1,"enabled":true}'::jsonb,'Explicit reviewed identity opt-in',CURRENT_TIMESTAMP)
 ON CONFLICT ("organizationId",key) DO UPDATE SET value=EXCLUDED.value,"updatedAt"=EXCLUDED."updatedAt"
 WHERE mtm_settings.value IS DISTINCT FROM EXCLUDED.value RETURNING id)
 INSERT INTO mtm_audit_logs(id,"organizationId",action,entity,"entityId","metadataKind","oldData","newData")
 SELECT :'audit_id',:'company_id','IDENTITY_COMPANY_ENABLED','mtm_setting',id,'identity_runtime',
 NULLIF(:'previous_value'::jsonb,'null'::jsonb),jsonb_build_object('enabled',true,'sourceSha',:'sha','githubOperator',:'operator') FROM changed;
COMMIT;
