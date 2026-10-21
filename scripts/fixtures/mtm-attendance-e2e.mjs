import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { makeRlsTestPrisma } from '../_rls.mjs'

export const databaseName = 'mtm_attendance_e2e'
export const databaseRole = 'mtm_attendance_e2e'
export function requireFixture() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(process.env.CI, 'true')
  assert.equal(process.env.MTM_ATTENDANCE_E2E, '1')
  assert.notEqual(process.env.NODE_ENV, 'production')
  const urls = [process.env.ADMIN_DATABASE_URL, process.env.DATABASE_URL].map(value => new URL(value))
  for (const url of urls) {
    assert.ok(['postgres:', 'postgresql:'].includes(url.protocol))
    assert.ok(['localhost', '127.0.0.1'].includes(url.hostname))
    assert.equal(url.pathname, `/${databaseName}`)
  }
  assert.equal(urls[0].username, 'postgres')
  assert.equal(urls[1].username, databaseRole)
  assert.equal(urls[0].host, urls[1].host)
  assert.equal(process.env.EVENT_PLATFORM_TEST_DATABASE_URL, urls[0].href)
  return { adminURL: urls[0].href, appURL: urls[1].href }
}
const migration = name => readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8')
/** Empty, named CI database ONLY. Never called against an existing tenant. */
export function prepareDatabase() {
  const { adminURL } = requireFixture()
  const sql = value => execFileSync('psql', [adminURL, '-X', '-q', '-v', 'ON_ERROR_STOP=1'], { input: value, stdio: ['pipe', 'pipe', 'pipe'] })
  sql(`DO $$ BEGIN IF EXISTS(SELECT 1 FROM organizations) THEN RAISE EXCEPTION 'Attendance fixture must be empty'; END IF; END $$;`)
  // Prisma pushes the current columns. Recreate only empty fixture tables so
  // the actual migrations restore their checks, immutable triggers and RLS.
  sql(`DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'mtm_attendance_%' LOOP EXECUTE format('DROP TABLE IF EXISTS public.%I CASCADE', t.tablename); END LOOP; END $$;
    DROP TABLE workforce_employment_events; DROP TYPE "WorkforceEmploymentEventKind";
    ALTER TABLE users DROP COLUMN "mtmAttendanceAll";
    ALTER TABLE mtm_agents DROP COLUMN "attendanceParticipant", DROP COLUMN "attendanceExcluded", DROP COLUMN "attendanceIncludedFrom";
    ALTER TABLE mtm_hrm_requests DROP COLUMN "attendanceDetails";
    ALTER TABLE workforce_time_corrections DROP COLUMN "requestHash";
    DROP TABLE workforce_workday_reopens;
  `)
  const applied = []
  const apply = name => { sql(migration(name)); applied.push(name) }
  apply('20260806120000_mtm_rls_coverage_completion')
  apply('20260806160000_mtm_rls_bypass_clause_normalization')
  apply('20260830150000_workforce_employment_history')
  const foundation = migration('20260828223000_workforce_h3_foundation')
  sql(foundation.slice(foundation.indexOf('-- Tenant data ships fail-closed.'), foundation.indexOf('-- A migration runner may own new tables')))
  applied.push('20260828223000_workforce_h3_foundation:retained-RLS-and-immutable-guards')
  apply('20260828224500_workforce_h3_legacy_fact_guard')
  apply('20260828230000_workforce_direct_correction_contract')
  apply('20260915210100_workforce_workday_reopen_ledger')
  for (const name of readdirSync('prisma/migrations').filter(name => /^20261013.*mtm_(attendance_|workday_employee_return)/.test(name)).sort()) apply(name)
  apply('20261014010000_mtm_attendance_utc_guard_clocks')
  apply('20261016180000_personnel_lunch_start')
  apply('20261016210000_mtm_attendance_explanations')
  sql(readFileSync('scripts/rls/enable-batch-5.sql', 'utf8'))
  const password = process.env.MTM_E2E_DATABASE_PASSWORD
  assert.match(password ?? '', /^[a-f0-9]{48}$/)
  sql(`CREATE ROLE ${databaseRole} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT;
    GRANT CONNECT ON DATABASE ${databaseName} TO ${databaseRole}; GRANT USAGE ON SCHEMA public TO ${databaseRole};
    GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO ${databaseRole};
    GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO ${databaseRole};
    DO $$ DECLARE t record; BEGIN FOR t IN SELECT c.relname FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid WHERE c.relnamespace='public'::regnamespace AND c.relkind='r' AND a.attname='organizationId' AND NOT a.attisdropped AND NOT c.relrowsecurity LOOP
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t.relname);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t.relname);
      EXECUTE format('CREATE POLICY attendance_e2e_remaining_tenant ON public.%I USING ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'') WITH CHECK ("organizationId"=current_setting(''app.org_id'',true) OR current_setting(''app.rls_bypass'',true)=''on'')',t.relname);
    END LOOP; END $$;`)
  return applied
}

export async function seedFixture() {
  const { adminURL, appURL } = requireFixture()
  const admin = makeRlsTestPrisma(adminURL)
  const app = makeRlsTestPrisma(appURL)
  const password = `Fixture!${randomUUID()}`
  const passwordHash = await bcrypt.hash(password, 10)
  const slug = `attendance-e2e-${randomUUID().slice(0, 8)}`
  const organization = await admin.organization.create({ data: { name: 'Fictional Attendance E2E', slug, plan: 'enterprise', features: ['crm', 'mtm'], modules: { crm: true, mtm: true, 'route-field': true }, addons: [], settings: { fixtureOnly: true } } })
  const foreignOrganization = await admin.organization.create({ data: { name: 'Fictional Foreign E2E', slug: `${slug}-foreign`, plan: 'enterprise', features: ['crm', 'mtm'], modules: { crm: true, mtm: true, 'route-field': true }, settings: { fixtureOnly: true } } })
  const users = {}
  for (const [name, role, org] of [['admin', 'admin', organization], ['hr', 'sales', organization], ['manager', 'manager', organization], ['employee', 'sales', organization], ['field', 'sales', organization], ['outside', 'sales', organization], ['foreign', 'admin', foreignOrganization]]) {
    users[name] = await admin.user.create({ data: { organizationId: org.id, name: `Fixture ${name}`, email: `${name}-${slug}@example.invalid`, passwordHash, role, preferredLanguage: 'en' } })
  }
  const team = await admin.mtmTeam.create({ data: { organizationId: organization.id, name: 'Fixture managed team' } })
  // Cards precede activation to prove that provisioning preserves field roles.
  for (const [name, role] of [['manager', 'MANAGER'], ['field', 'AGENT']]) {
    await admin.mtmAgent.create({ data: { organizationId: organization.id, userId: users[name].id, name: users[name].name, email: users[name].email, role, teamId: team.id } })
  }
  for (const org of [organization, foreignOrganization]) await admin.mtmSetting.create({ data: { organizationId: org.id, key: 'attendanceEnabled', value: true } })
  // Technical cards still exist for CRM logins. Personnel lists only the
  // explicitly added staff below; admin/hr/outside remain CRM-only controls.
  for (let index = 0; index < 52; index++) await admin.user.create({ data: { organizationId: organization.id, name: `Fixture roster ${String(index).padStart(2, '0')}`, email: `roster-${index}-${slug}@example.invalid`, passwordHash, role: 'sales' } })
  const agents = {}
  for (const [name, user] of Object.entries(users)) agents[name] = await admin.mtmAgent.findFirstOrThrow({ where: { organizationId: user.organizationId, userId: user.id } })
  await admin.mtmAgent.update({ where: { id: agents.employee.id }, data: { teamId: team.id } })
  const personnel = await admin.mtmAgent.findMany({ where: { organizationId: organization.id,
    OR: [{ id: { in: [agents.employee.id, agents.manager.id] } }, { name: { startsWith: 'Fixture roster ' } }] }, select: { id: true, userId: true } })
  assert.equal(personnel.length, 54)
  await admin.mtmAuditLog.createMany({ data: personnel.map(card => ({ organizationId: organization.id,
    actorUserId: users.admin.id, agentId: card.id, entity: 'agent', entityId: card.id,
    action: 'MTM_ATTENDANCE_EMPLOYEE_CREATED', metadataKind: 'mtm_attendance_employment',
    newData: { userId: card.userId, fixtureOnly: true, hireDate: null } })) })
  // Read grants do not confer a reviewer role; exercise grant/revoke via HTTP.
  assert.equal(agents.employee.role, 'EMPLOYEE')
  assert.equal(agents.field.role, 'AGENT')
  assert.equal(await app.user.count(), 0, 'Unscoped restricted RLS client sees no users')
  const rows = await app.$queryRaw`SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user`
  assert.equal(rows[0].name, databaseRole)
  assert.equal(rows[0].rolsuper, false)
  assert.equal(rows[0].rolbypassrls, false)
  await app.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${organization.id}, true)`
    assert.equal(await tx.user.count({ where: { organizationId: foreignOrganization.id } }), 0)
  })
  return { admin, app, password, users, agents, organization, foreignOrganization, team }
}
if (process.argv[2] === 'prepare') {
  const applied = prepareDatabase()
  console.log(JSON.stringify({ status: 'PASS', stage: 'isolated-schema', migrations: applied }))
}
