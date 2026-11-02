/** Opt-in synthetic PostgreSQL/RLS check. No DATABASE_URL or live connections.
 * Uses isolated @electric-sql/pglite@0.5.11 and typescript@5.9.3 tooling. */
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from "node:fs/promises"
import { dirname, isAbsolute, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { fileURLToPath } from "node:url"
import { randomUUID } from "node:crypto"

const tooling = process.env.ZEYTUN_SQL_TOOLING_DIR
assert(tooling && isAbsolute(tooling), "ZEYTUN_SQL_TOOLING_DIR must name isolated tooling")
assert.equal(process.env.TZ, "UTC")
const requireTool = createRequire(join(tooling, "package.json"))
const ts = requireTool("typescript"), { PGlite } = requireTool("@electric-sql/pglite")
assert.equal(JSON.parse(await readFile(join(tooling, "node_modules/@electric-sql/pglite/package.json"), "utf8")).version, "0.5.11")
const source = fileURLToPath(new URL("../src/lib/", import.meta.url))
const root = await mkdtemp(join(tmpdir(), "zeytun-inbound-sql-")), built = new Set()
let pg
try {
  await writeFile(join(root, "package.json"), '{"type":"commonjs"}')
  await symlink(join(tooling, "node_modules"), join(root, "node_modules"), "dir")
  async function compile(relative) {
    if (built.has(relative)) return
    built.add(relative)
    const input = await readFile(join(source, relative + ".ts"), "utf8")
    const output = ts.transpileModule(input, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    } }).outputText
    const file = join(root, relative + ".js")
    await mkdir(dirname(file), { recursive: true }); await writeFile(file, output)
    for (const match of output.matchAll(/require\("(\.[^"]+)"\)/g)) {
      const dependency = resolve(dirname(join(source, relative)), match[1])
      assert(dependency.startsWith(source))
      await compile(dependency.slice(source.length))
    }
  }
  await compile("voice-agent/pharmacy/zeytun-inbound-host")
  const { createInboundPilotHost } = createRequire(join(root, "package.json"))("./voice-agent/pharmacy/zeytun-inbound-host.js")
  pg = await PGlite.create()
  await pg.exec(`
    CREATE ROLE pilot_reader NOSUPERUSER NOBYPASSRLS;
    CREATE TABLE organizations (id text PRIMARY KEY, "isActive" boolean NOT NULL);
    CREATE TABLE channel_configs (id text PRIMARY KEY, "organizationId" text NOT NULL,
      "channelType" text, "isActive" boolean, settings jsonb);
    CREATE TABLE call_logs (id text PRIMARY KEY, "organizationId" text NOT NULL, "channelConfigId" text,
      "providerCallId" text, provider text, direction text, "callMode" text, status text, "wasAnswered" boolean,
      "endedAt" timestamp(3), "startedAt" timestamp(3), "fromNumber" text, "targetPhoneE164" text, "consentAudit" jsonb);
    GRANT USAGE ON SCHEMA public TO pilot_reader;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO pilot_reader;
    GRANT UPDATE ("consentAudit") ON call_logs TO pilot_reader;
  `)
  for (const table of ["call_logs", "channel_configs"]) await pg.exec(`
    ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY; ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;
    CREATE POLICY tenant_isolation ON ${table}
    USING ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on')
    WITH CHECK ("organizationId"=current_setting('app.org_id',true) OR current_setting('app.rls_bypass',true)='on');
  `)
  const providerCallId = "aaaaaaaa-1111-4111-8111-111111111111"
  for (const org of ["a", "b"]) {
    await pg.query('INSERT INTO organizations VALUES ($1,true)', [org])
    await pg.query('INSERT INTO channel_configs VALUES ($1,$2,\'voip\',true,$3)', ["line-" + org, org, { provider: "asterisk", voiceAgentEnabled: true }])
    await pg.query(`INSERT INTO call_logs VALUES ($1,$2,$3,$4,'asterisk','inbound','ai','in-progress',true,NULL,
      '2026-10-22 12:00:00','994500000001','+994500000001','{"existingConsent":"preserve"}')`, ["call-" + org, org, "line-" + org, providerCallId])
  }
  await pg.query("SELECT set_config('app.org_id','outer',false),set_config('app.rls_bypass','on',false)")
  const database = { $transaction: async (work, options) => {
    assert.deepEqual(options, { isolationLevel: "ReadCommitted", maxWait: 500, timeout: 2500 })
    return pg.transaction(async tx => {
      await tx.exec("SET LOCAL ROLE pilot_reader")
      const role = (await tx.query("SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0]
      assert.deepEqual(role, { rolsuper: false, rolbypassrls: false })
      return work({ $queryRaw: async (strings, ...values) => {
        const sql = strings.reduce((text, part, i) => text + (i ? `$${i}` : "") + part, "")
        const rows = (await tx.query(sql, values)).rows
        assert.deepEqual((await tx.query("SELECT current_setting('app.org_id') AS org,current_setting('app.rls_bypass') AS bypass")).rows[0], { org: "a", bypass: "off" })
        return rows
      } })
    })
  } }
  const config = { version: 1, enabled: true, purpose: "owner_inbound_preview", id: randomUUID(), organizationId: "a",
    channelConfigId: "line-a", testPhoneE164: "+994500000001", issuedAt: "2026-10-22T11:59:00Z", expiresAt: "2026-10-22T12:20:00Z",
    approvalReference: "synthetic", approvedSource: { organizationId: "inspection", scopeKey: "a".repeat(64), catalogVersion: "b".repeat(64) } }
  const privateRoot = join(root, "private"); await mkdir(privateRoot, { mode: 0o700 })
  const configFile = join(privateRoot, "grant.json"); await writeFile(configFile, JSON.stringify(config), { mode: 0o600 })
  const host = createInboundPilotHost({ configFile, snapshotDirectory: privateRoot, runtimeOrganizationId: "a", database })
  const call = await host.loadCall(config, providerCallId)
  assert.equal(call.id, "call-a"); assert.equal(call.startedAt, "2026-10-22T12:00:00.000Z")
  assert(!("consentAudit" in call)); assert(!("contactId" in call))
  assert.equal(await host.claim(config, call), true)
  assert.equal(await host.claim(config, call), true)
  const audits = (await pg.query('SELECT id,"consentAudit" FROM call_logs ORDER BY id')).rows
  assert.equal(audits[0].consentAudit.existingConsent, "preserve")
  assert.equal(audits[0].consentAudit.pharmacyInboundPreview.providerCallId, providerCallId)
  assert.deepEqual(audits[1].consentAudit, { existingConsent: "preserve" })
  assert.equal(await host.claim(config, { ...call, id: "call-b" }), false)
  assert.equal(await host.claim({ ...config, id: randomUUID() }, call), false) // do not replace a prior marker
  await pg.query('UPDATE call_logs SET "endedAt"=now() WHERE id=$1', [call.id])
  assert.equal(await host.claim(config, call), false)
  await pg.query('UPDATE channel_configs SET "isActive"=false WHERE id=$1', [config.channelConfigId])
  assert.equal(await host.loadCall(config, providerCallId), null)
  assert.deepEqual((await pg.query("SELECT current_setting('app.org_id') AS org,current_setting('app.rls_bypass') AS bypass")).rows[0], { org: "outer", bypass: "on" })
  console.log("PASS: real inbound SQL, RLS tenant isolation, exact call marker, preserved consent, idempotence, conflicting grant/closed call/inactive line refusal; outer scope restored")
} finally {
  if (pg) await pg.close()
  await rm(root, { recursive: true, force: true })
}
