/** Insert-only fictional data for native Route & Field acceptance.
 * No route publication, visit/workday facts, password repair or notifications.
 */
import fs from "node:fs"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { Prisma, PrismaClient } from "@prisma/client"
import { APP, databaseUrlFromEnv, readRootFile } from "./mtm-attendance-demo-verification"

export const RF = Object.freeze({
  id: "route-field-acceptance-v1", slug: "route-field-acceptance",
  marker: "route-field-native-acceptance:fictional:v1",
  origin: "https://app.leaddrivecrm.org", state: "/var/lib/leaddrive-route-field-acceptance",
})
export const RF_OWNER = Object.freeze({ id: "rf-owner-user-v1", email: "owner@route-field-acceptance.example.invalid",
  name: "RF QA fictional CRM owner", role: "admin" })
export const RF_AGENTS = [
  { id: "rf-manager-v1", email: "manager@route-field-acceptance.example.invalid", name: "RF QA fictional manager", role: "MANAGER", managerId: null },
  { id: "rf-agent-v1", email: "agent@route-field-acceptance.example.invalid", name: "RF QA fictional field employee", role: "AGENT", managerId: "rf-manager-v1" },
  { id: "rf-other-agent-v1", email: "other@route-field-acceptance.example.invalid", name: "RF QA outside-scope field employee", role: "AGENT", managerId: null },
] as const
export const RF_CUSTOMERS = [
  { id: "rf-gps-place-v1", code: "RF-QA-GPS", name: "RF QA fictional GPS place", managingManagerId: RF_AGENTS[0].id },
  { id: "rf-no-gps-place-v1", code: "RF-QA-NO-GPS", name: "RF QA fictional place without coordinates", managingManagerId: RF_AGENTS[0].id },
  { id: "rf-other-place-v1", code: "RF-QA-OTHER", name: "RF QA fictional outside-scope place", managingManagerId: null },
] as const
type Db = Pick<PrismaClient, "$transaction">
function fail(code: string): never { throw new Error(code) }
export function assertRouteFieldOwner(org: { id: string; slug: string; settings: unknown } | null) {
  if (!org || org.id !== RF.id || org.slug !== RF.slug || !org.settings || typeof org.settings !== "object"
    || (org.settings as Record<string, unknown>).routeFieldAcceptanceOwner !== RF.marker) fail("RF_FIXTURE_NOT_OWNED")
}
async function owner(tx: Prisma.TransactionClient) {
  const found = await tx.organization.findMany({ where: { OR: [{ id: RF.id }, { slug: RF.slug }] },
    select: { id: true, slug: true, settings: true, isActive: true, modules: true, addons: true }, take: 2 })
  if (found.length > 1) fail("RF_FIXTURE_NOT_OWNED")
  if (found[0]) assertRouteFieldOwner(found[0])
  return found[0] ?? null
}
export async function prepareRouteFieldFixture(db: Db, passwordHash: string) {
  if (passwordHash.length !== 60 || !/^\$2[aby]\$12\$[./A-Za-z0-9]{53}$/.test(passwordHash)) fail("RF_FIXTURE_PASSWORD_INVALID")
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${RF.id}, true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${RF.marker}))`
    if (await owner(tx)) return false
    await tx.organization.create({ data: { id: RF.id, slug: RF.slug, name: "Route Field Native Acceptance (fictional)",
      plan: "enterprise", addons: ["mtm"], modules: { mtm: true, "route-field": true }, features: ["mtm", "route-field"],
      settings: { routeFieldAcceptanceOwner: RF.marker }, provisionedBy: RF.marker } })
    await tx.user.create({ data: { ...RF_OWNER, organizationId: RF.id, passwordHash, preferredLanguage: "az",
      hiddenModules: [], totpEnabled: false, smsAuthEnabled: false, require2fa: false } })
    for (const agent of RF_AGENTS) await tx.mtmAgent.create({ data: { ...agent, organizationId: RF.id,
      passwordHash, canPlanOwnRoutes: true, canSelfPublishRoutes: agent.role === "MANAGER" } })
    for (const [index, customer] of RF_CUSTOMERS.entries()) {
      await tx.mtmCustomer.create({ data: { ...customer, organizationId: RF.id, objectType: "PHARMACY",
        address: "Fictional native acceptance fixture", latitude: null, longitude: null, geofenceRadius: 250 } })
      await tx.mtmCustomerAgentAssignment.create({ data: { id: `rf-assignment-${index + 1}-v1`, organizationId: RF.id,
        customerId: customer.id, agentId: RF_AGENTS[index === 2 ? 2 : 1].id, source: "RF_QA_FIXTURE" } })
    }
    await tx.mtmTask.create({ data: { id: "rf-task-v1", organizationId: RF.id, agentId: RF_AGENTS[1].id,
      customerId: RF_CUSTOMERS[0].id, title: "RF QA fictional visit checklist" } })
    await tx.mtmSetting.createMany({ data: [
      { organizationId: RF.id, key: "attendanceEnabled", value: true },
      { organizationId: RF.id, key: "timezone", value: "Asia/Baku" },
      { organizationId: RF.id, key: "attendanceEmployeeRemindersEnabled", value: false },
      { organizationId: RF.id, key: "attendanceManagerAlertsEnabled", value: false },
    ] })
    return true
  }, { isolationLevel: "Serializable", timeout: 15000 })
}
export async function readRouteFieldFixture(db: Db) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRaw`SELECT set_config('app.org_id', ${RF.id}, true)`
    const org = await owner(tx)
    assertRouteFieldOwner(org)
    const modules = org?.modules as Record<string, unknown> | null
    if (!org?.isActive || modules?.mtm !== true || modules?.["route-field"] !== true || !org.addons.includes("mtm")) fail("RF_FIXTURE_CHANGED")
    const users = await tx.user.findMany({ where: { organizationId: RF.id },
      select: { id: true, email: true, isActive: true, passwordHash: true, role: true }, take: 2 })
    if (users.length !== 1 || users[0].id !== RF_OWNER.id || users[0].email !== RF_OWNER.email
      || users[0].role !== "admin" || !users[0].isActive) fail("RF_FIXTURE_CHANGED")
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: RF.id },
      select: { id: true, email: true, userId: true, role: true, status: true, managerId: true, passwordHash: true }, take: 5 })
    // The real User activation trigger may add the owner's office card. It
    // must never be converted to a field role or confused with test agents.
    const seeded = agents.filter(agent => RF_AGENTS.some(expected => expected.id === agent.id))
    const automatic = agents.filter(agent => !RF_AGENTS.some(expected => expected.id === agent.id))
    if (seeded.length !== 3 || seeded.some(agent => !RF_AGENTS.some(expected => expected.id === agent.id
      && expected.email === agent.email && expected.role === agent.role && expected.managerId === agent.managerId)
      || agent.userId !== null || agent.status !== "ACTIVE") || automatic.length > 1
      || automatic.some(agent => agent.userId !== RF_OWNER.id || agent.role !== "EMPLOYEE")) fail("RF_FIXTURE_CHANGED")
    const customers = await tx.mtmCustomer.findMany({ where: { organizationId: RF.id }, select: { id: true, code: true }, take: 4 })
    if (customers.length !== 3 || customers.some(customer => !RF_CUSTOMERS.some(expected => expected.id === customer.id
      && expected.code === customer.code))) fail("RF_FIXTURE_CHANGED")
    return { users, agents: seeded, customers: customers.length }
  }, { timeout: 15000 })
}
const CODES = new Set(["RF_FIXTURE_NOT_OWNED", "RF_FIXTURE_CHANGED", "RF_FIXTURE_PASSWORD_INVALID",
  "RF_FIXTURE_REVISION_INVALID", "RF_FIXTURE_FILE_UNSAFE", "RF_FIXTURE_CREDENTIAL_MISMATCH", "RF_FIXTURE_FAILED"])
export function routeFieldFailure(error: unknown) {
  return { version: 1, status: "FAIL", code: error instanceof Error && CODES.has(error.message) ? error.message : "RF_FIXTURE_FAILED" }
}
export function validateRouteFieldEvidence(value: unknown) {
  const row = value as Record<string, unknown>
  if (!row || typeof row !== "object") fail("RF_FIXTURE_FAILED")
  if (row.status === "FAIL") {
    if (Object.keys(row).sort().join() !== "code,status,version" || row.version !== 1 || !CODES.has(String(row.code))) fail("RF_FIXTURE_FAILED")
  } else if (Object.keys(row).sort().join() !== "agents,artifactSha,created,customers,status,tenant,users,version" || row.version !== 1
    || row.status !== "PASS" || row.tenant !== RF.slug || row.users !== 1 || row.agents !== 3 || row.customers !== 3
    || typeof row.created !== "boolean" || typeof row.artifactSha !== "string" || row.artifactSha.length !== 40
    || !/^[a-f0-9]{40}$/.test(row.artifactSha)) fail("RF_FIXTURE_FAILED")
  return row
}
export async function runRouteFieldFixture(sha: string) {
  if (process.getuid?.() !== 0 || !/^[a-f0-9]{40}$/.test(sha) || readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail("RF_FIXTURE_REVISION_INVALID")
  const response = await fetch(`${RF.origin}/api/v1/public/build-info`, { redirect: "error", signal: AbortSignal.timeout(10000) })
  if (!response.ok || (await response.json()).artifactSha !== sha) fail("RF_FIXTURE_REVISION_INVALID")
  process.env.DATABASE_URL = databaseUrlFromEnv(readRootFile("/etc/leaddrive/app.env", 65536))
  const bcrypt = createRequire(`${APP}/package.json`)("bcryptjs") as typeof import("bcryptjs")
  const { makeScriptPrisma } = await import(pathToFileURL(`${APP}/scripts/_rls.mjs`).href)
  const db: PrismaClient = await makeScriptPrisma({ orgId: RF.id })
  try {
    const existing = await db.$transaction(async tx => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return owner(tx) })
    const file = `${RF.state}/credential.json`
    if (existing && !fs.existsSync(file)) fail("RF_FIXTURE_CREDENTIAL_MISMATCH")
    if (!fs.existsSync(RF.state)) fs.mkdirSync(RF.state, { mode: 0o700 })
    const directory = fs.lstatSync(RF.state)
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o777) !== 0o700) fail("RF_FIXTURE_FILE_UNSAFE")
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ marker: RF.marker, password: randomBytes(48).toString("base64url") }), { mode: 0o600, flag: "wx" })
    const saved = JSON.parse(readRootFile(file, 1024, true))
    if (saved.marker !== RF.marker || typeof saved.password !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(saved.password)) fail("RF_FIXTURE_FILE_UNSAFE")
    const created = await prepareRouteFieldFixture(db, await bcrypt.hash(saved.password, 12))
    const snapshot = await readRouteFieldFixture(db)
    for (const account of [...snapshot.users, ...snapshot.agents]) if (!account.passwordHash
      || !await bcrypt.compare(saved.password, account.passwordHash)) fail("RF_FIXTURE_CREDENTIAL_MISMATCH")
    if (readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail("RF_FIXTURE_REVISION_INVALID")
    return { version: 1, status: "PASS", artifactSha: sha, tenant: RF.slug, created, users: 1, agents: 3, customers: snapshot.customers }
  } finally { await db.$disconnect(); delete process.env.DATABASE_URL }
}
if (process.argv[2] === "--prepare-route-field-fixture") {
  void runRouteFieldFixture(process.argv[3]).then(value => process.stdout.write(JSON.stringify(validateRouteFieldEvidence(value)) + "\n"))
    .catch((error: unknown) => { process.stdout.write(JSON.stringify(routeFieldFailure(error)) + "\n"); process.exitCode = 1 })
} else if (process.argv[2] === "--validate-route-field-output") {
  try { process.stdout.write(JSON.stringify(validateRouteFieldEvidence(JSON.parse(fs.readFileSync(0, "utf8")))) + "\n") }
  catch { process.stderr.write("Invalid RF fixture evidence; raw output withheld\n"); process.exitCode = 1 }
}
