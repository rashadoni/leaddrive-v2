#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto"
import { execFileSync, spawn } from "node:child_process"
import { mkdir, mkdtemp, readFile, writeFile, unlink, realpath, open } from "node:fs/promises"
import net from "node:net"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { setTimeout as delay } from "node:timers/promises"
import { validateContext, childEnvironment, sanitizedAuthLogEvidence, sanitizedRedirectEvidence, loopbackApplicationOrigin, publicPostPacer, sanitizedRouteLogEvidence } from "./support-backend-evidence-guards.mjs"
import { runLoggedCommand, stopOwnedProcess } from "./support-backend-evidence-process.mjs"

const root = fileURLToPath(new URL("../", import.meta.url))
const { control: controlURL, databaseName } = validateContext(process.env, root)
const checkedSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim()
if (checkedSha !== process.env.SUPPORT_BACKEND_HEAD_SHA) throw new Error("CANDIDATE_HEAD_MISMATCH")
if (checkedSha !== process.env.GITHUB_SHA) throw new Error("CHECKOUT_CI_SHA_MISMATCH")
if (execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim()) throw new Error("CLEAN_CHECKOUT_REQUIRED")

// Imports with DB/browser dependencies occur only AFTER every environment fence.
let PrismaClient, makeRlsTestPrisma
const { request } = await import("playwright")
const { default: bcrypt } = await import("bcryptjs")
const logTransport = JSON.parse(await readFile(path.join(root, "node_modules/pino-pretty/package.json"), "utf8"))
if (logTransport.version !== "13.1.1") throw new Error("EXACT_FIXTURE_LOG_TRANSPORT_REQUIRED")
const EXPECTED = [
  "restricted-role-and-rls", "macro-persistence", "escalation-persistence",
  "portal-ticket-ownership", "portal-attachment-ownership", "ai-audit-and-roles",
  "portal-user-role-and-tenant-boundary", "portal-password-and-revocation",
  "portal-user-persisted-audit", "portal-recovery-token-consumption",
]
class EvidenceFailure extends Error {}
function check(value, code) { if (!value) throw new EvidenceFailure(code) }
const hash = value => createHash("sha256").update(typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest("hex")
const suffix = randomBytes(8).toString("hex")
const role = "support_backend_" + suffix
const rolePassword = randomBytes(32).toString("hex")
const password = "Fixture!9a-" + randomUUID()
const nextPassword = "Changed!9a-" + randomUUID()
const scratchURL = new URL(controlURL); scratchURL.pathname = "/" + databaseName
const appURL = new URL(scratchURL); appURL.username = role; appURL.password = rolePassword
const privateDir = await mkdtemp(path.join(await realpath(process.env.RUNNER_TEMP), "support-backend-"))
const output = path.join(root, "artifacts/support-backend")
await mkdir(output, { recursive: true })
const receipt = {
  version: 1, candidateHead: process.env.SUPPORT_BACKEND_HEAD_SHA, checkedSha,
  harnessSha256: hash(await readFile(new URL(import.meta.url))), startedAt: new Date().toISOString(),
  runtime: "GitHub-hosted loopback Next dev / PostgreSQL / real HTTP auth and routes",
  fixtureOnlyDependency: { name: "pino-pretty", version: logTransport.version, scope: "Isolated runner transport for unchanged development logger; not a product dependency" },
  expectedCases: EXPECTED, cases: [], status: "RUNNING", cleanup: "NOT_RUN",
  limitations: [
    "Not production build or full migration replay; candidate Prisma schema plus disclosed fixture RLS.",
    "No email/password-link delivery, external AI/telephony, escalation scheduler or real customer data.",
    "Closure-token expiry/confirmation, macro category persistence and complete role/localization/browser matrix NOT RUN.",
    "Public rate limits use unchanged development memory fallback, not production Redis.",
    "No mock Prisma, auth, route handlers or HTTP response fulfillment.",
  ],
}
receipt.publicPostPacing = { minimumIntervalMs: 6100, requests: 0, waitedMs: 0 }
const pacePublicPost = publicPostPacer({ now: () => performance.now(), sleep: delay, evidence: receipt.publicPostPacing })
let control, admin, unscopedApp, server, serverLog
let createdDatabase = false, createdRole = false, stage = "preflight"
const contexts = []
const uploads = []
const rlsTables = ["users", "contacts", "tickets", "ticket_macros", "escalation_rules", "audit_logs", "ticket_attachments", "ticket_closure_requests", "ticket_comments"]
let fixture, origin, adminA, adminB, agentA, portalA, portalSibling, portalB
let portalMutationReceipts = []
const environment = childEnvironment(process.env, {
  NODE_OPTIONS: "--max-old-space-size=6144",
  AUTH_SECRET: randomBytes(32).toString("hex"),
  TENANT_PII_MASTER_KEY: randomBytes(32).toString("hex"),
})
environment.NEXTAUTH_SECRET = environment.AUTH_SECRET
async function save() { await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n") }
async function guardedDDL(client, sql) {
  validateContext(process.env, root)
  check(process.env.SUPPORT_BACKEND_ADMIN_URL === controlURL.href, "CONTROL_TARGET_CHANGED")
  return client.$executeRawUnsafe(sql)
}
async function command(args, env, name) {
  const result = await runLoggedCommand(process.execPath, args, {
    cwd: root, env, logPath: path.join(privateDir, name + ".log"), timeoutMs: 600_000,
  })
  check(result.code === 0 && result.signal === null, "FIXTURE_COMMAND_FAILED")
}
async function snapshotForeign() {
  const org = fixture.foreign.id
  return hash(await Promise.all([
    admin.organization.findUnique({ where: { id: org }, select: { features: true, settings: true, modules: true } }),
    admin.contact.findMany({ where: { organizationId: org }, orderBy: { id: "asc" }, select: { id: true, portalAccessEnabled: true, portalPasswordHash: true, portalVerificationToken: true, portalVerificationExpires: true } }),
    admin.ticketMacro.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
    admin.escalationRule.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
    admin.ticket.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
    admin.ticketComment.findMany({ where: { ticket: { organizationId: org } }, orderBy: { id: "asc" } }),
    admin.auditLog.findMany({ where: { organizationId: org }, orderBy: { id: "asc" } }),
  ]))
}
async function api(context, method, route, expected, body) {
  check(route.startsWith("/api/") && !route.startsWith("//"), "LOCAL_API_PATH_REQUIRED")
  await pacePublicPost(method, route)
  const response = await context.fetch(route, { method, ...(body === undefined ? {} : { data: body }), timeout: 120_000, maxRedirects: 0 })
  if (response.status() !== expected) {
    const payload = await response.json().catch(() => null)
    const allowedCodes = ["MACRO_SAVE_FAILED", "MACRO_INVALID", "MACRO_ASSIGNEE_INVALID", "MACRO_SHORTCUT_CONFLICT"]
    receipt.httpFailures ||= []
    receipt.httpFailures.push({ expected, actual: response.status(), code: allowedCodes.includes(payload?.code) ? payload.code : "OTHER" })
  }
  check(response.status() === expected, "HTTP_STATUS_" + expected + "_GOT_" + response.status())
  return response.json()
}
async function freshContext(headers) {
  const context = await request.newContext({ baseURL: origin, maxRedirects: 0, extraHTTPHeaders: headers })
  contexts.push(context)
  return context
}
async function office(principal) {
  const context = await freshContext()
  const csrf = await api(context, "GET", "/api/auth/csrf", 200)
  check(typeof csrf.csrfToken === "string", "CSRF_MISSING")
  const response = await context.post("/api/auth/callback/credentials", {
    maxRedirects: 0, timeout: 120_000, headers: { "X-Auth-Return-Redirect": "1" },
    form: { csrfToken: csrf.csrfToken, email: principal.email, password, organizationSlug: principal.slug, callbackUrl: origin + "/tickets" },
  })
  check(response.status() === 200, "OFFICE_LOGIN_FAILED")
  const redirect = new URL((await response.json()).url, origin)
  const callbackError = redirect.searchParams.get("error")
  const knownCallbackErrors = ["CredentialsSignin", "Configuration", "CallbackRouteError", "AccessDenied", "MissingCSRF", "UntrustedHost"]
  receipt.authenticationObservations ??= []
  // Read only the same loopback session; never follow the returned redirect.
  const session = await api(context, "GET", "/api/auth/session", 200)
  receipt.authenticationObservations.push({ callbackStatus: response.status(), sameOrigin: redirect.origin === origin,
    errorPresent: callbackError !== null, errorCategory: callbackError === null ? null : knownCallbackErrors.includes(callbackError) ? callbackError : "OTHER",
    redirect: sanitizedRedirectEvidence(redirect.href, origin),
    actualSessionPrincipalAndTenant: session.user?.id === principal.id && session.user.organizationId === principal.organizationId })
  check(redirect.origin === origin && !redirect.searchParams.has("error"), "OFFICE_LOGIN_REDIRECT_INVALID")
  check(session.user?.id === principal.id && session.user.organizationId === principal.organizationId, "REAL_SESSION_MISMATCH")
  return context
}
async function portal(contact, secret = password, expected = 200) {
  const context = await freshContext()
  const body = await api(context, "POST", "/api/v1/public/portal-auth", expected, {
    email: contact.email, password: secret, organizationId: contact.organizationId,
  })
  if (expected !== 200) return null
  check(typeof body.token === "string" && body.token.length > 30 && body.data.contactId === contact.id, "SERVER_PORTAL_TOKEN_MISSING")
  return freshContext({ Authorization: "Bearer " + body.token })
}
async function runCase(id, work) {
  const started = Date.now()
  try {
    await work()
    receipt.cases.push({ id, status: "PASS", elapsedMs: Date.now() - started })
  } catch (error) {
    receipt.cases.push({ id, status: "FAIL", code: error instanceof EvidenceFailure ? error.message : "UNEXPECTED_CASE_ERROR", elapsedMs: Date.now() - started })
  }
  await save()
}
async function setup() {
  await command(["node_modules/prisma/build/index.js", "generate"], environment, "generate")
  ;({ PrismaClient } = await import("@prisma/client"))
  ;({ makeRlsTestPrisma } = await import("./_rls.mjs"))
  control = new PrismaClient({ datasourceUrl: controlURL.href })
  const existing = await control.$queryRawUnsafe("SELECT EXISTS(SELECT 1 FROM pg_database WHERE datname=$1) AS present", databaseName)
  check(existing[0].present === false, "EXISTING_DATABASE_REFUSED")
  await guardedDDL(control, 'CREATE DATABASE "' + databaseName + '"')
  createdDatabase = true
  admin = new PrismaClient({ datasourceUrl: scratchURL.href })
  await guardedDDL(admin, "CREATE EXTENSION vector")
  await command(["node_modules/prisma/build/index.js", "db", "push", "--skip-generate", "--schema", "prisma/schema.prisma"],
    { ...environment, DATABASE_URL: scratchURL.href }, "schema")
  await guardedDDL(control, "CREATE ROLE " + role + " LOGIN PASSWORD '" + rolePassword + "' NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION NOINHERIT")
  createdRole = true
  await guardedDDL(admin, "GRANT CONNECT ON DATABASE " + databaseName + " TO " + role)
  await guardedDDL(admin, "GRANT USAGE ON SCHEMA public TO " + role)
  await guardedDDL(admin, "GRANT SELECT ON ALL TABLES IN SCHEMA public TO " + role)
  await guardedDDL(admin, 'GRANT UPDATE ("lastLogin","loginCount","updatedAt") ON users TO ' + role)
  await guardedDDL(admin, 'GRANT UPDATE (features) ON organizations TO ' + role)
  for (const table of ["contacts", "tickets", "ticket_macros", "escalation_rules", "ticket_attachments", "ticket_comments", "ticket_closure_requests"]) {
    await guardedDDL(admin, "GRANT INSERT, UPDATE, DELETE ON " + table + " TO " + role)
  }
  await guardedDDL(admin, "GRANT INSERT ON audit_logs TO " + role)
  for (const table of rlsTables) {
    const predicate = table === "ticket_comments"
      ? 'EXISTS (SELECT 1 FROM tickets t WHERE t.id="ticket_comments"."ticketId" AND t."organizationId"=current_setting(\'app.org_id\',true))'
      : '"organizationId"=current_setting(\'app.org_id\',true)'
    await guardedDDL(admin, "ALTER TABLE " + table + " ENABLE ROW LEVEL SECURITY")
    await guardedDDL(admin, "ALTER TABLE " + table + " FORCE ROW LEVEL SECURITY")
    await guardedDDL(admin, "CREATE POLICY support_backend_tenant ON " + table + " USING (" + predicate + " OR current_setting('app.rls_bypass',true)='on') WITH CHECK (" + predicate + " OR current_setting('app.rls_bypass',true)='on')")
  }
  // Use the existing unscoped-client fence; never seed through the application role.
  process.env.EVENT_PLATFORM_TEST_DATABASE_URL = scratchURL.href
  unscopedApp = makeRlsTestPrisma(appURL.href)
}
async function seed() {
  const passwordHash = await bcrypt.hash(password, 12)
  const orgs = []
  for (const key of ["a", "b"]) orgs.push(await admin.organization.create({ data: {
    name: "Synthetic Support Backend " + key, slug: "support-backend-" + suffix + "-" + key,
    plan: "enterprise", addons: ["ai"], features: ["crm", "support", "settings", "ai"],
    modules: { crm: true, support: true, settings: true, ai: true }, settings: {},
  } }))
  const [organization, foreign] = orgs
  const people = []
  for (const [key, org, userRole] of [["admin", organization, "admin"], ["agent", organization, "support"], ["foreign", foreign, "admin"]]) {
    const row = await admin.user.create({ data: { organizationId: org.id, email: key + "-" + suffix + "@example.test", name: "Synthetic " + key, role: userRole, passwordHash, require2fa: false, totpEnabled: false, smsAuthEnabled: false } })
    people.push({ ...row, slug: org.slug })
  }
  const contacts = []
  for (const [key, org] of [["owner", organization], ["sibling", organization], ["foreign", foreign], ["recovery", organization], ["expired", organization]]) {
    contacts.push(await admin.contact.create({ data: { organizationId: org.id, fullName: "Synthetic " + key, email: key + "-portal-" + suffix + "@example.test", isActive: true, portalAccessEnabled: true, portalPasswordHash: passwordHash } }))
  }
  const tickets = []
  for (const [index, contact] of contacts.slice(0, 3).entries()) tickets.push(await admin.ticket.create({ data: {
    organizationId: contact.organizationId, contactId: contact.id, ticketNumber: "BACKEND-" + index + "-" + suffix, subject: "Synthetic private ticket " + index, status: "new",
  } }))
  const foreignMacro = await admin.ticketMacro.create({ data: { organizationId: foreign.id, name: "Foreign macro", actions: [{ type: "add_tag", value: "synthetic" }], createdBy: people[2].id } })
  const foreignRule = await admin.escalationRule.create({ data: { organizationId: foreign.id, name: "Foreign rule", triggerType: "resolution_warning", triggerMinutes: 12, level: 1, actions: [{ type: "increase_priority" }], isActive: false } })
  fixture = { organization, foreign, admin: people[0], agent: people[1], foreignAdmin: people[2], contacts, tickets, foreignMacro, foreignRule }
}
async function startApp() {
  const port = await new Promise((resolve, reject) => {
    const socket = net.createServer()
    socket.once("error", reject)
    socket.listen(0, "localhost", () => { const port = socket.address().port; socket.close(() => resolve(port)) })
  })
  origin = loopbackApplicationOrigin(port)
  const networkLog = path.join(privateDir, "outbound.log")
  await writeFile(networkLog, "", { mode: 0o600 })
  serverLog = await open(path.join(privateDir, "app.log"), "wx", 0o600)
  const childEnv = {
    ...environment, DATABASE_URL: appURL.href, AUTH_URL: origin, NEXTAUTH_URL: origin, APP_URL: origin, NEXT_PUBLIC_APP_URL: origin, AUTH_TRUST_HOST: "true",
    SUPPORT_BACKEND_NETWORK_LOG: networkLog,
    NODE_OPTIONS: environment.NODE_OPTIONS + " --import=" + path.join(root, "scripts/support-backend-network-guard.mjs"),
  }
  server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", new URL(origin).hostname, "--port", String(port)],
    { cwd: root, env: childEnv, detached: true, stdio: ["ignore", serverLog.fd, serverLog.fd] })
  server.once("error", () => { receipt.serverSpawnError = true })
  const probe = await freshContext()
  let ready = false
  for (let attempt = 0; attempt < 90; attempt++) {
    check(server.exitCode === null && !receipt.serverSpawnError, "APP_EXITED_BEFORE_READY")
    try {
      const response = await probe.get("/api/v1/ping", { timeout: 5000, maxRedirects: 0 })
      ready = response.status() === 200
    } catch { /* bounded startup probe only; mutations are never retried */ }
    if (ready) break
    await delay(2000)
  }
  check(ready, "APP_READINESS_TIMEOUT")
  adminA = await office(fixture.admin)
  agentA = await office(fixture.agent)
  adminB = await office(fixture.foreignAdmin)
  portalA = await portal(fixture.contacts[0])
  portalSibling = await portal(fixture.contacts[1])
  portalB = await portal(fixture.contacts[2])
}
async function scenarios() {
  const org = fixture.organization.id
  const foreignBefore = await snapshotForeign()
  await runCase("restricted-role-and-rls", async () => {
    const roles = await unscopedApp.$queryRawUnsafe("SELECT rolname,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit FROM pg_roles WHERE rolname=current_user")
    check(roles[0].rolname === role && ["rolsuper","rolbypassrls","rolcreatedb","rolcreaterole","rolreplication","rolinherit"].every(key => roles[0][key] === false), "APP_ROLE_TOO_PRIVILEGED")
    const ownership = await admin.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_class c JOIN pg_roles r ON r.oid=c.relowner WHERE r.rolname=$1", role)
    check(ownership[0].n === 0, "APP_ROLE_OWNS_OBJECTS")
    const membership = await admin.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1", role)
    check(membership[0].n === 0, "APP_ROLE_INHERITS_MEMBERSHIP")
    const policies = await admin.$queryRawUnsafe("SELECT relname,relrowsecurity,relforcerowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relname=ANY($1::text[])", rlsTables)
    check(policies.length === rlsTables.length && policies.every(row => row.relrowsecurity && row.relforcerowsecurity), "RLS_MISSING")
    check(await unscopedApp.ticket.count() === 0, "UNSCOPED_ROLE_READS_TICKETS")
    await unscopedApp.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT set_config('app.org_id',$1,true)", org)
      check(await tx.ticket.count() === 2, "TENANT_FILTER_FAILED")
      check(await tx.ticket.findFirst({ where: { id: fixture.tickets[2].id } }) === null, "RLS_FOREIGN_READ")
    })
  })
  check(receipt.cases.find(result => result.id === "restricted-role-and-rls")?.status === "PASS", "RESTRICTED_ROLE_PREFLIGHT_FAILED")
  await runCase("macro-persistence", async () => {
    const payload = { name: "Synthetic macro", category: "general", actions: [{ type: "add_tag", value: "backend-proof" }] }
    const created = (await api(adminA, "POST", "/api/v1/ticket-macros", 201, payload)).data
    const persisted = await admin.ticketMacro.findUnique({ where: { id: created.id } })
    check(persisted?.organizationId === org && persisted.createdBy === fixture.admin.id && hash(persisted.actions) === hash(payload.actions), "MACRO_NOT_PERSISTED")
    const freshAdmin = await office(fixture.admin)
    check((await api(freshAdmin, "GET", "/api/v1/ticket-macros/" + created.id, 200)).data.id === created.id, "FRESH_CONTEXT_READ_FAILED")
    await api(adminA, "PUT", "/api/v1/ticket-macros/" + created.id, 200, { name: "Updated synthetic macro", isActive: false })
    const updated = await admin.ticketMacro.findUnique({ where: { id: created.id } })
    check(updated.name === "Updated synthetic macro" && updated.isActive === false, "MACRO_UPDATE_NOT_PERSISTED")
    for (const [method, body] of [["GET"], ["PUT", { isActive: true }], ["DELETE"]]) await api(adminA, method, "/api/v1/ticket-macros/" + fixture.foreignMacro.id, 404, body)
    await api(agentA, "POST", "/api/v1/ticket-macros", 403, payload)
    await api(adminA, "DELETE", "/api/v1/ticket-macros/" + created.id, 200)
    check(await admin.ticketMacro.findUnique({ where: { id: created.id } }) === null, "MACRO_DELETE_NOT_PERSISTED")
    check(await snapshotForeign() === foreignBefore, "FOREIGN_STATE_CHANGED")
  })
  await runCase("escalation-persistence", async () => {
    const payload = { name: "Synthetic rule", triggerType: "resolution_warning", triggerMinutes: 19, level: 2, actions: [{ type: "increase_priority" }], isActive: true }
    const created = (await api(adminA, "POST", "/api/v1/escalation-rules", 201, payload)).data
    check((await admin.escalationRule.findUnique({ where: { id: created.id } }))?.organizationId === org, "RULE_NOT_PERSISTED")
    const count = await admin.escalationRule.count({ where: { organizationId: org } })
    await api(adminA, "POST", "/api/v1/escalation-rules", 409, payload)
    check(await admin.escalationRule.count({ where: { organizationId: org } }) === count, "CONFLICT_INSERTED_RULE")
    await api(adminA, "PATCH", "/api/v1/escalation-rules/" + created.id, 200, { name: "Updated rule", isActive: false })
    check((await admin.escalationRule.findUnique({ where: { id: created.id } })).isActive === false, "RULE_TOGGLE_NOT_PERSISTED")
    for (const [method, body] of [["PATCH", { isActive: true }], ["DELETE"]]) await api(adminA, method, "/api/v1/escalation-rules/" + fixture.foreignRule.id, 404, body)
    await api(agentA, "POST", "/api/v1/escalation-rules", 403, payload)
    await api(adminA, "DELETE", "/api/v1/escalation-rules/" + created.id, 200)
    check(await admin.escalationRule.findUnique({ where: { id: created.id } }) === null, "RULE_DELETE_NOT_PERSISTED")
    check(await snapshotForeign() === foreignBefore, "FOREIGN_STATE_CHANGED")
  })
  await runCase("portal-ticket-ownership", async () => {
    const ownPath = "/api/v1/public/portal-tickets/" + fixture.tickets[0].id
    check((await api(portalA, "GET", ownPath, 200)).data.id === fixture.tickets[0].id, "OWN_TICKET_NOT_READABLE")
    for (const ticket of fixture.tickets.slice(1)) {
      const before = await admin.ticketComment.count({ where: { ticketId: ticket.id } })
      const target = "/api/v1/public/portal-tickets/" + ticket.id
      await api(portalA, "GET", target, 404)
      await api(portalA, "POST", target, 404, { comment: "Must not persist", clientRequestId: randomUUID() })
      check(await admin.ticketComment.count({ where: { ticketId: ticket.id } }) === before, "DENIED_COMMENT_PERSISTED")
    }
    const clientRequestId = randomUUID()
    const body = { comment: "Synthetic persisted reply", clientRequestId }
    await api(portalA, "POST", ownPath, 201, body)
    await api(portalA, "POST", ownPath, 200, body)
    check(await admin.ticketComment.count({ where: { ticketId: fixture.tickets[0].id, clientRequestId, comment: body.comment, isInternal: false } }) === 1, "REPLY_NOT_SINGLE_PERSISTED")
    check(await snapshotForeign() === foreignBefore, "FOREIGN_STATE_CHANGED")
  })
  await runCase("portal-attachment-ownership", async () => {
    const content = Buffer.from("Synthetic attachment proof\n")
    const files = []
    for (const [context, ticket] of [[portalA, fixture.tickets[0]], [portalSibling, fixture.tickets[1]], [portalB, fixture.tickets[2]]]) {
      const target = "/api/v1/public/portal-tickets/" + ticket.id + "/files"
      await pacePublicPost("POST", target)
      const response = await context.post(target, { multipart: { file: { name: "proof.txt", mimeType: "text/plain", buffer: content } }, maxRedirects: 0, timeout: 120_000 })
      check(response.status() === 201, "OWN_FILE_UPLOAD_FAILED")
      const file = (await response.json()).data
      uploads.push(file.id)
      const download = await context.get(target + "/" + file.id, { maxRedirects: 0 })
      check(download.status() === 200 && (await download.body()).equals(content), "OWN_FILE_DOWNLOAD_FAILED")
      files.push({ file, ticket, context })
    }
    for (const { file, ticket, context } of files.slice(1)) {
      const target = "/api/v1/public/portal-tickets/" + ticket.id + "/files/" + file.id
      await api(portalA, "GET", target, 404)
      await api(portalA, "DELETE", target, 404)
      const preserved = await context.get(target, { maxRedirects: 0, timeout: 120_000 })
      check(preserved.status() === 200 && (await preserved.body()).equals(content), "DENIED_ATTACHMENT_BYTES_CHANGED")
      const before = await admin.ticketComment.count()
      await api(portalA, "POST", "/api/v1/public/portal-tickets/" + fixture.tickets[0].id, 409, { comment: "Borrowed file forbidden", attachmentIds: [file.id], clientRequestId: randomUUID() })
      check(await admin.ticketComment.count() === before && await admin.ticketAttachment.findUnique({ where: { id: file.id } }) !== null, "DENIED_ATTACHMENT_MUTATED")
    }
    const own = files[0]
    const clientRequestId = randomUUID()
    await api(portalA, "POST", "/api/v1/public/portal-tickets/" + own.ticket.id, 201, { comment: "Owned file reply", attachmentIds: [own.file.id], clientRequestId })
    const comment = await admin.ticketComment.findFirst({ where: { ticketId: own.ticket.id, clientRequestId } })
    check(comment && (await admin.ticketAttachment.findUnique({ where: { id: own.file.id } })).commentId === comment.id, "OWN_FILE_NOT_BOUND")
  })
  await runCase("ai-audit-and-roles", async () => {
    const beforeForeign = await snapshotForeign()
    const where = { organizationId: org, entityType: "organization", entityId: org, entityName: "supportAiDisabled" }
    const beforeCount = await admin.auditLog.count({ where })
    await api(adminA, "PATCH", "/api/v1/settings/ai-features", 200, { feature: "supportAiDisabled", action: "add" })
    check((await admin.organization.findUnique({ where: { id: org } })).features.includes("supportAiDisabled"), "AI_FLAG_NOT_PERSISTED")
    const audit = await admin.auditLog.findFirst({ where, orderBy: { createdAt: "desc" } })
    check(await admin.auditLog.count({ where }) === beforeCount + 1 && audit?.userId === fixture.admin.id && audit.oldValue?.supportAiEnabled === true && audit.newValue?.supportAiEnabled === false, "AI_ACTOR_AUDIT_MISSING")
    check((await api(adminA, "GET", "/api/v1/support/ai-settings", 200)).data.latestChange.id === audit.id, "AI_AUDIT_PROJECTION_MISMATCH")
    await api(agentA, "PATCH", "/api/v1/settings/ai-features", 403, { feature: "supportAiDisabled", action: "remove" })
    check(await admin.auditLog.count({ where }) === beforeCount + 1 && (await admin.organization.findUnique({ where: { id: org } })).features.includes("supportAiDisabled"), "DENIED_AI_CHANGE_PERSISTED")
    await api(adminA, "PATCH", "/api/v1/settings/ai-features", 200, { feature: "supportAiDisabled", action: "remove" })
    check(await snapshotForeign() === beforeForeign && (await api(adminB, "GET", "/api/v1/settings/ai-features", 200)).data.features.includes("supportAiDisabled") === false, "FOREIGN_AI_STATE_CHANGED")
  })
  await runCase("portal-user-role-and-tenant-boundary", async () => {
    const before = await snapshotForeign()
    const ownBefore = hash(await admin.contact.findUnique({ where: { id: fixture.contacts[0].id } }))
    await api(agentA, "GET", "/api/v1/portal-users", 403)
    await api(agentA, "PATCH", "/api/v1/portal-users", 403, { contactId: fixture.contacts[0].id, portalAccessEnabled: false })
    await api(adminA, "PATCH", "/api/v1/portal-users", 404, { contactId: fixture.contacts[2].id, portalAccessEnabled: false })
    check(hash(await admin.contact.findUnique({ where: { id: fixture.contacts[0].id } })) === ownBefore && await snapshotForeign() === before, "DENIED_PORTAL_USER_CHANGE_PERSISTED")
  })
  await runCase("portal-password-and-revocation", async () => {
    const contact = fixture.contacts[0]
    const response = await api(adminA, "PATCH", "/api/v1/portal-users", 200, { contactId: contact.id, administratorPassword: { password: nextPassword, confirmPassword: nextPassword, acknowledged: true } })
    portalMutationReceipts.push({ action: "portal_password_set_by_admin", auditRecorded: response.auditRecorded })
    const changed = await admin.contact.findUnique({ where: { id: contact.id } })
    check(await bcrypt.compare(nextPassword, changed.portalPasswordHash) && !await bcrypt.compare(password, changed.portalPasswordHash) && changed.portalVerificationToken === null && changed.portalVerificationExpires === null, "PASSWORD_CHANGE_NOT_PERSISTED")
    await api(portalA, "GET", "/api/v1/public/portal-tickets/" + fixture.tickets[0].id, 401)
    await portal(contact, password, 401)
    const fresh = await portal(contact, nextPassword)
    await api(fresh, "GET", "/api/v1/public/portal-tickets/" + fixture.tickets[0].id, 200)
    const disabled = await api(adminA, "PATCH", "/api/v1/portal-users", 200, { contactId: contact.id, portalAccessEnabled: false })
    portalMutationReceipts.push({ action: "portal_access_disabled", auditRecorded: disabled.auditRecorded })
    const revoked = await admin.contact.findUnique({ where: { id: contact.id } })
    check(revoked.portalAccessEnabled === false && revoked.portalPasswordHash === null && revoked.portalVerificationToken === null && revoked.portalVerificationExpires === null, "PORTAL_REVOKE_NOT_PERSISTED")
    await api(fresh, "GET", "/api/v1/public/portal-tickets/" + fixture.tickets[0].id, 401)
    await portal(contact, nextPassword, 401)
  })
  await runCase("portal-user-persisted-audit", async () => {
    check(portalMutationReceipts.length === 2, "AUDIT_PREREQUISITE_NOT_COMPLETED")
    for (const item of portalMutationReceipts) {
      check(item.auditRecorded === true, "PORTAL_USER_AUDIT_NOT_RECORDED")
      const rows = await admin.auditLog.findMany({ where: { organizationId: org, entityId: fixture.contacts[0].id, entityType: "contact", action: item.action } })
      check(rows.length === 1 && rows[0].userId === fixture.admin.id, "PORTAL_USER_ACTOR_AUDIT_MISSING")
    }
  })
  await runCase("portal-recovery-token-consumption", async () => {
    const token = randomBytes(32).toString("hex"), expired = randomBytes(32).toString("hex")
    await admin.contact.update({ where: { id: fixture.contacts[3].id }, data: { portalVerificationToken: hash(token), portalVerificationExpires: new Date(Date.now() + 10 * 60_000) } })
    await admin.contact.update({ where: { id: fixture.contacts[4].id }, data: { portalVerificationToken: hash(expired), portalVerificationExpires: new Date(Date.now() - 60_000) } })
    const anonymous = await freshContext()
    const route = "/api/v1/public/portal-auth/set-password"
    const expiredBefore = hash(await admin.contact.findUnique({ where: { id: fixture.contacts[4].id } }))
    await api(anonymous, "GET", route + "?token=" + expired, 400)
    await api(anonymous, "POST", route, 400, { token: expired, password: nextPassword, confirmPassword: nextPassword })
    check(hash(await admin.contact.findUnique({ where: { id: fixture.contacts[4].id } })) === expiredBefore, "EXPIRED_TOKEN_MUTATED_CONTACT")
    await api(anonymous, "GET", route + "?token=" + token, 200)
    await api(anonymous, "POST", route, 200, { token, password: nextPassword, confirmPassword: nextPassword })
    const changed = await admin.contact.findUnique({ where: { id: fixture.contacts[3].id } })
    check(changed.portalVerificationToken === null && changed.portalVerificationExpires === null && await bcrypt.compare(nextPassword, changed.portalPasswordHash), "RECOVERY_TOKEN_NOT_CONSUMED")
    await api(anonymous, "POST", route, 400, { token, password, confirmPassword: password })
    check((await admin.contact.findUnique({ where: { id: changed.id } })).portalPasswordHash === changed.portalPasswordHash, "TOKEN_REPLAY_CHANGED_PASSWORD")
  })
}
try {
  await save()
  stage = "database-setup"; await setup()
  stage = "synthetic-seed"; await seed()
  stage = "real-authentication"; await startApp()
  stage = "real-api-cases"; await scenarios()
} catch (error) {
  receipt.setupFailure = { stage, code: error instanceof EvidenceFailure ? error.message : "UNEXPECTED_HARNESS_ERROR" }
} finally {
  for (const id of EXPECTED) if (!receipt.cases.some(result => result.id === id)) receipt.cases.push({ id, status: "NOT_RUN" })
  const cleanupFailures = []
  try { await stopOwnedProcess(server, 10_000) } catch { cleanupFailures.push("application-stop") }
  await serverLog?.close().catch(() => cleanupFailures.push("application-log"))
  for (const context of contexts) await context.dispose().catch(() => cleanupFailures.push("http-context"))
  try {
    if (admin && uploads.length) {
      const rows = await admin.ticketAttachment.findMany({ where: { id: { in: uploads } }, select: { fileName: true } })
      for (const row of rows) {
        check(/^[a-f0-9]{32}\.txt$/.test(row.fileName), "UNEXPECTED_FIXTURE_FILE")
        await unlink(path.join(root, "public/uploads/tickets", row.fileName))
      }
    }
  } catch { cleanupFailures.push("fixture-uploads") }
  await unscopedApp?.$disconnect().catch(() => cleanupFailures.push("app-db-disconnect"))
  await admin?.$disconnect().catch(() => cleanupFailures.push("admin-db-disconnect"))
  try {
    if (createdDatabase) await guardedDDL(control, 'DROP DATABASE "' + databaseName + '"')
    if (createdRole) await guardedDDL(control, 'DROP ROLE "' + role + '"')
  } catch { cleanupFailures.push("owned-database-and-role") }
  await control?.$disconnect().catch(() => cleanupFailures.push("control-disconnect"))
  try { receipt.authenticationLogEvidence = sanitizedAuthLogEvidence(await readFile(path.join(privateDir, "app.log"), "utf8")) }
  catch { receipt.authenticationLogEvidence = { unavailable: true } }
  try { receipt.routeLogEvidence = sanitizedRouteLogEvidence(await readFile(path.join(privateDir, "app.log"), "utf8")) }
  catch { receipt.routeLogEvidence = { unavailable: true } }
  receipt.cleanup = cleanupFailures.length ? "FAIL" : "PASS"
  receipt.cleanupFailures = cleanupFailures
  try { receipt.outboundBlockedCount = (await readFile(path.join(privateDir, "outbound.log"), "utf8")).split("\n").filter(Boolean).length } catch { receipt.outboundBlockedCount = null }
  receipt.status = !receipt.setupFailure && receipt.cases.length === EXPECTED.length
    && receipt.cases.every(result => result.status === "PASS") && receipt.cleanup === "PASS"
    && receipt.outboundBlockedCount === 0 ? "PASS" : "FAIL"
  receipt.finishedAt = new Date().toISOString()
  await save()
  console.log(JSON.stringify({ status: receipt.status, passed: receipt.cases.filter(row => row.status === "PASS").length, total: EXPECTED.length, cleanup: receipt.cleanup }))
}
if (receipt.status !== "PASS") process.exitCode = 1
