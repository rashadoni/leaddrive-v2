import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { makeRlsTestPrisma } from './_rls.mjs'

// Explicit disposable fixture: never a production migration/recovery entrypoint.
assert.equal(process.env.WF_BULK_TEST, '1')
const target = new URL(process.env.ADMIN_DATABASE_URL)
assert.ok(['postgresql:', 'postgres:'].includes(target.protocol))
assert.equal(target.hostname, '127.0.0.1')
assert.equal(target.pathname, '/workforce_bulk_browser')
assert.equal(target.username, 'postgres')
const password = process.env.WF_BULK_DATABASE_PASSWORD
assert.match(password, /^[a-f0-9]{48}$/)
const db = makeRlsTestPrisma(target.toString())
const sources = []
function source(path) { const bytes=readFileSync(path);sources.push({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});return bytes.toString() }
function exact(text, pattern) { const match=text.match(pattern);assert.ok(match,'Required candidate SQL block missing');return match[0] }
source('scripts/_rls.mjs')
const foundation=source('prisma/migrations/20260828223000_workforce_h3_foundation/migration.sql')
const lifecycle=source('prisma/migrations/20260829114500_workforce_future_only_lifecycle/migration.sql')
const site=source('prisma/migrations/20260830050000_workforce_site_assignments/migration.sql')
const transfer=source('prisma/migrations/20261006150000_workforce_transferred_assignment_window/migration.sql')
const bulkShift=source('prisma/migrations/20260901060000_workforce_bulk_shift_assignment_operations/migration.sql')
const bulkSite=source('prisma/migrations/20260901050000_workforce_bulk_site_assignment_operations/migration.sql')
const tables=['users','mtm_teams','mtm_agents','mtm_audit_logs','workforce_shift_templates','workforce_shift_assignments','workforce_shift_snapshots','workforce_sites','workforce_site_assignments']
const sql=[
 'BEGIN;',
 // These are empty candidate db-push tables. Recreate the two receipt tables
 // with their whole original migrations, including checks/FKs/RLS/triggers.
 'DROP TABLE workforce_shift_assignment_bulk_operations; DROP TABLE workforce_site_assignment_bulk_operations;',
 bulkShift,bulkSite,
 'ALTER TABLE workforce_shift_assignments ADD CONSTRAINT workforce_shift_assignments_effective_range_check CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");',
 'ALTER TABLE workforce_site_assignments ADD CONSTRAINT workforce_site_assignments_date_check CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom");',
 exact(lifecycle,/CREATE OR REPLACE FUNCTION workforce_guard_shift_assignment\(\)[\s\S]*?\$\$;/),
 exact(foundation,/CREATE TRIGGER workforce_shift_assignments_guard[\s\S]*?;/),
 transfer,
 exact(foundation,/CREATE OR REPLACE FUNCTION workforce_reject_immutable_mutation\(\)[\s\S]*?\$\$;/),
 exact(foundation,/CREATE TRIGGER workforce_shift_snapshots_append_only[\s\S]*?;/),
 exact(site,/CREATE OR REPLACE FUNCTION workforce_guard_site_assignment_mutation\(\)[\s\S]*?\$\$;/),
 exact(site,/CREATE TRIGGER workforce_site_assignments_append_only[\s\S]*?;/),
 exact(site,/CREATE OR REPLACE FUNCTION workforce_validate_site_assignment_window\(\)[\s\S]*?\$\$;/),
 exact(site,/CREATE TRIGGER workforce_site_assignments_validate_window[\s\S]*?;/),
 `CREATE ROLE wf_bulk_browser LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;`,
 'GRANT CONNECT ON DATABASE workforce_bulk_browser TO wf_bulk_browser; GRANT USAGE ON SCHEMA public TO wf_bulk_browser; GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA public TO wf_bulk_browser; GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO wf_bulk_browser;',
 ...tables.map(table=>`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY; ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY; CREATE POLICY tenant_isolation ON "${table}" USING ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on') WITH CHECK ("organizationId" = current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true) = 'on');`),
 'COMMIT;',
].join('\n')
try {
 for(const table of [...tables,'workforce_shift_assignment_bulk_operations','workforce_site_assignment_bulk_operations']) { const count=await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${table}"`);assert.equal(count[0].n,0,'Fixture requires all selected tables empty') }
 const applied=spawnSync(process.execPath,['node_modules/prisma/build/index.js','db','execute','--url',target.toString(),'--stdin'],{input:sql,encoding:'utf8'})
 assert.equal(applied.status,0,'Exact selected fixture SQL application failed')
 const policies=await db.$queryRawUnsafe(`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN (${[...tables,'workforce_shift_assignment_bulk_operations','workforce_site_assignment_bulk_operations'].map(t=>`'${t}'`).join(',')}) ORDER BY relname`)
 assert.equal(policies.length,11);assert.ok(policies.every(p=>p.relrowsecurity&&p.relforcerowsecurity))
 const [role]=await db.$queryRawUnsafe("SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname='wf_bulk_browser'");assert.ok(Object.values(role).every(v=>v===false))
 const receipt={status:'PASS',sources,policies,role,scope:'Candidate schema plus whole receipt migrations and exact selected current assignment triggers; not full historical migration replay',schemaPreparation:process.env.WF_BULK_SCHEMA_PREPARATION||'candidate db push on pgvector/pg16'}
 writeFileSync(process.env.WF_BULK_FIXTURE_RECEIPT||'/tmp/hrm-c7-fixture.json',JSON.stringify(receipt,null,2)+'\n')
 console.log(JSON.stringify({status:'PASS',forcedRlsTables:11,sourceBindings:sources.length}))
} finally { await db.$disconnect() }
