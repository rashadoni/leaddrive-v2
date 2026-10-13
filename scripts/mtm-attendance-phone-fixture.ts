/** An insert-only, separately owned tenant for physical attendance acceptance.
 * Never repairs another tenant, rewrites a password or touches attendance facts.
 * Credentials stay in a root-only file; the workflow receives counts only. */
import fs from "node:fs"
import { randomBytes } from "node:crypto"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import type { Prisma, PrismaClient } from "@prisma/client"
import { APP, databaseUrlFromEnv, readRootFile } from "./mtm-attendance-demo-verification"

export const PHONE = Object.freeze({
  id: "mtm-attendance-phone-v1", slug: "mtm-attendance-phone",
  marker: "mtm-phone-acceptance:65a932ac-5827-43bb-b974-7e3b32bc518a:v1",
  state: "/var/lib/leaddrive-mtm-attendance-phone", origin: "https://app.leaddrivecrm.org",
})
export const PHONE_USERS = [
  { id: "mtm-phone-admin-v1", email: "admin@mtm-attendance-phone.example.invalid", name: "Fictional phone administrator", role: "admin" },
  { id: "mtm-phone-office-v1", email: "office@mtm-attendance-phone.example.invalid", name: "Fictional office employee", role: "sales" },
  { id: "mtm-phone-field-v1", email: "field@mtm-attendance-phone.example.invalid", name: "Fictional field employee", role: "sales" },
] as const
type Db = Pick<PrismaClient, "$transaction">
function fail(code: string): never { throw new Error(code) }
export function assertPhoneOwner(org: { id: string; slug: string; settings: unknown } | null) {
  if (!org || org.id !== PHONE.id || org.slug !== PHONE.slug || !org.settings || typeof org.settings !== "object"
    || (org.settings as Record<string, unknown>).attendancePhoneOwner !== PHONE.marker) fail("PHONE_NOT_OWNED")
}
async function owner(tx: Prisma.TransactionClient) {
  const found = await tx.organization.findMany({ where: { OR: [{ id: PHONE.id }, { slug: PHONE.slug }] },
    select: { id: true, slug: true, settings: true, isActive: true, modules: true, addons: true }, take: 2 })
  if (found.length > 1) fail("PHONE_NOT_OWNED")
  if (found[0]) assertPhoneOwner(found[0])
  return found[0] ?? null
}
export async function preparePhone(db: Db, passwordHash: string) {
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.org_id', ${PHONE.id}, true)`
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${PHONE.marker}))`
    if (await owner(tx)) return false
    await tx.organization.create({ data: { id: PHONE.id, slug: PHONE.slug, name: "MTM Phone Acceptance (fictional)",
      plan: "enterprise", addons: ["mtm"], modules: { mtm: true, "route-field": true }, features: ["mtm", "route-field"],
      settings: { attendancePhoneOwner: PHONE.marker }, provisionedBy: PHONE.marker } })
    for (const user of PHONE_USERS) await tx.user.create({ data: { ...user, organizationId: PHONE.id, passwordHash,
      preferredLanguage: "ru", hiddenModules: [], totpEnabled: false, smsAuthEnabled: false, require2fa: false } })
    // The real activation trigger creates office cards; field role predates it.
    await tx.mtmAgent.create({ data: { id: "mtm-phone-field-card-v1", organizationId: PHONE.id,
      userId: PHONE_USERS[2].id, name: PHONE_USERS[2].name, email: PHONE_USERS[2].email, role: "AGENT" } })
    await tx.mtmSetting.createMany({ data: [
      { organizationId: PHONE.id, key: "attendanceEnabled", value: true },
      { organizationId: PHONE.id, key: "timezone", value: "Asia/Baku" },
      { organizationId: PHONE.id, key: "attendanceBranchQrEnabled", value: false },
      { organizationId: PHONE.id, key: "attendanceEmployeeRemindersEnabled", value: false },
      { organizationId: PHONE.id, key: "attendanceManagerAlertsEnabled", value: false },
    ] })
    return true
  }, { isolationLevel: "Serializable", timeout: 15000 })
}
export async function readPhone(db: Db) {
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY")
    await tx.$executeRaw`SELECT set_config('app.org_id', ${PHONE.id}, true)`
    const organization = await owner(tx)
    assertPhoneOwner(organization)
    const modules = organization?.modules as Record<string, unknown> | null
    if (!organization?.isActive || modules?.mtm !== true || modules?.["route-field"] !== true
      || !organization.addons.includes("mtm")) fail("PHONE_FIXTURE_CHANGED")
    const users = await tx.user.findMany({ where: { organizationId: PHONE.id }, select: { id: true, email: true, role: true, isActive: true, passwordHash: true }, take: 4 })
    if (users.length !== PHONE_USERS.length || users.some(user => !PHONE_USERS.some(expected => expected.id === user.id
      && expected.email === user.email && expected.role === user.role) || !user.isActive)) fail("PHONE_FIXTURE_CHANGED")
    const agents = await tx.mtmAgent.findMany({ where: { organizationId: PHONE.id }, select: { userId: true, role: true, status: true, attendanceExcluded: true }, take: 4 })
    if (agents.length !== 3 || new Set(agents.map(agent => agent.userId)).size !== 3 || agents.some(agent =>
      !PHONE_USERS.some(user => user.id === agent.userId) || agent.status !== "ACTIVE" || agent.attendanceExcluded
      || agent.role !== (agent.userId === PHONE_USERS[2].id ? "AGENT" : "EMPLOYEE"))) fail("PHONE_FIXTURE_CHANGED")
    const setting = await tx.mtmSetting.findUnique({ where: { organizationId_key: { organizationId: PHONE.id, key: "attendanceEnabled" } } })
    if (setting?.value !== true) fail("PHONE_FIXTURE_CHANGED")
    if (await tx.mtmAttendanceLocationPolicy.count({ where: { organizationId: PHONE.id, enabled: true } })
      || await tx.mtmAttendanceSchedule.count({ where: { organizationId: PHONE.id, enabled: true } })) fail("PHONE_FIXTURE_CHANGED")
    // Preserve all future test facts. Checking never resets the tenant.
    return { users, agents: agents.length }
  }, { isolationLevel: "RepeatableRead", timeout: 15000 })
}
const codes = new Set(["PHONE_NOT_OWNED", "PHONE_FIXTURE_CHANGED", "PHONE_REVISION_INVALID", "PHONE_CREDENTIAL_MISMATCH", "PHONE_FILE_UNSAFE", "PHONE_FAILED"])
export function phoneFailure(error: unknown) {
  return { version: 1, status: "FAIL", code: error instanceof Error && codes.has(error.message) ? error.message : "PHONE_FAILED" }
}
export function validatePhoneEvidence(value: unknown) {
  const row = value as Record<string, unknown>
  if (!row || typeof row !== "object") fail("PHONE_FAILED")
  if (row.status === "FAIL") {
    if (Object.keys(row).sort().join() !== "code,status,version" || row.version !== 1 || !codes.has(String(row.code))) fail("PHONE_FAILED")
    return row
  }
  if (Object.keys(row).sort().join() !== "agents,artifactSha,created,status,tenant,users,version" || row.version !== 1
    || row.status !== "PASS" || row.tenant !== PHONE.slug || row.users !== 3 || row.agents !== 3 || typeof row.created !== "boolean"
    || !/^[a-f0-9]{40}$/.test(String(row.artifactSha))) fail("PHONE_FAILED")
  return row
}
export async function runPhone(sha: string) {
  if (process.getuid?.() !== 0 || !/^[a-f0-9]{40}$/.test(sha) || readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail("PHONE_REVISION_INVALID")
  const response = await fetch(`${PHONE.origin}/api/v1/public/build-info`, { redirect: "error", signal: AbortSignal.timeout(10000) })
  if (!response.ok || (await response.json()).artifactSha !== sha) fail("PHONE_REVISION_INVALID")
  process.env.DATABASE_URL = databaseUrlFromEnv(readRootFile("/etc/leaddrive/app.env", 65536))
  const bcrypt = createRequire(`${APP}/package.json`)("bcryptjs") as typeof import("bcryptjs")
  const { makeScriptPrisma } = await import(pathToFileURL(`${APP}/scripts/_rls.mjs`).href)
  const db: PrismaClient = await makeScriptPrisma({ orgId: PHONE.id })
  try {
    const existing = await db.$transaction(async tx => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return owner(tx) })
    const file = `${PHONE.state}/credential.json`
    if (existing && !fs.existsSync(file)) fail("PHONE_CREDENTIAL_MISMATCH")
    if (!fs.existsSync(PHONE.state)) fs.mkdirSync(PHONE.state, { mode: 0o700 })
    const directory = fs.lstatSync(PHONE.state)
    if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== 0 || (directory.mode & 0o777) !== 0o700) fail("PHONE_FILE_UNSAFE")
    if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ marker: PHONE.marker, password: randomBytes(48).toString("base64url") }), { mode: 0o600, flag: "wx" })
    const saved = JSON.parse(readRootFile(file, 1024, true))
    if (saved.marker !== PHONE.marker || typeof saved.password !== "string" || !/^[A-Za-z0-9_-]{64}$/.test(saved.password)) fail("PHONE_FILE_UNSAFE")
    const created = await preparePhone(db, await bcrypt.hash(saved.password, 12))
    const snapshot = await readPhone(db)
    for (const user of snapshot.users) if (!await bcrypt.compare(saved.password, user.passwordHash)) fail("PHONE_CREDENTIAL_MISMATCH")
    if (readRootFile(`${APP}/.deploy-sha`, 128).trim() !== sha) fail("PHONE_REVISION_INVALID")
    return { version: 1, status: "PASS", artifactSha: sha, tenant: PHONE.slug, created, users: snapshot.users.length, agents: snapshot.agents }
  } finally { await db.$disconnect(); delete process.env.DATABASE_URL }
}
if (process.argv[2] === "--prepare-phone") {
  void runPhone(process.argv[3]).then(value => process.stdout.write(JSON.stringify(validatePhoneEvidence(value)) + "\n"))
    .catch((error: unknown) => { process.stdout.write(JSON.stringify(phoneFailure(error)) + "\n"); process.exitCode = 1 })
} else if (process.argv[2] === "--validate-phone-output") {
  try { process.stdout.write(JSON.stringify(validatePhoneEvidence(JSON.parse(fs.readFileSync(0, "utf8")))) + "\n") }
  catch { process.stderr.write("Invalid phone fixture evidence; raw output withheld\n"); process.exitCode = 1 }
}
