/**
 * Signing in to the MTM app with a code sent to WhatsApp — the real request,
 * verify and set-password handlers, then the password form, over a real
 * Postgres.
 *
 * Owner, 2026-10-15, on Personnel → Add employee: «тут нужно сделать, чтоб
 * через WhatsApp приходил OTP-пароль, чтоб сами назначали, а кадровик не
 * занимался этой рутиной… через WhatsApp». HR gives a name and a number; the
 * person gets six digits from LeadDrive's WhatsApp, sets their own password and
 * is signed in. The same works for a field agent who forgot theirs.
 *
 * What a mocked Prisma could not show: which card a number finds (the card's
 * own number, or the linked CRM user's), that the code lives hashed in
 * `otp_codes` under the company, that it works once, that the password lands
 * on the card and signs out older sessions, and that nothing is written into
 * the sending organization's inbox log. The stand-ins: Meta's Graph API (a
 * fake `fetch`) and the rate limiter (limits are not what is tested here).
 *
 * And the way round the code (owner, 2026-10-17: «сделай сброс пароля, у меня
 * нет 3-го номера»): when no code can reach the number, the administrator sets
 * the card's password in «Агенты» — the real PUT handler, with only the
 * browser session stood in — and the app signs in with it.
 *
 * Set MTM_LOGIN_CODE_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_LOGIN_CODE_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («MTM sign-in by WhatsApp code database gate»), where
 * `MTM_LOGIN_CODE_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { hashOneTimeToken } from "@/lib/one-time-token"
import { NextRequest, NextResponse } from "next/server"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_LOGIN_CODE_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_LOGIN_CODE_DB_GATE === "required") {
  throw new Error("MTM_LOGIN_CODE_TEST_DATABASE_URL is required by the MTM sign-in by WhatsApp code database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_LOGIN_CODE_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_login_code_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  process.env.NEXTAUTH_SECRET ||= "fictional-login-code-test-secret-0123456789"
  // LeadDrive's own WhatsApp channel lives in this organization.
  process.env.MTM_LOGIN_CODE_SENDER_ORGANIZATION_ID = "org-login-code-sender"
  return { name, url: url.toString() }
})

// Capture actual server authorize/JWT callbacks while keeping browser cookie
// plumbing outside this database suite. Passwords, Prisma and boundary reads
// remain real; this is not a signed-cookie/browser E2E claim.
const crmAuth = vi.hoisted(() => ({ config: null as any }))
vi.mock("next-auth", () => ({ default: (config: unknown) => {
  crmAuth.config = config
  return { handlers: {}, auth: async () => null, signIn: async () => null, signOut: async () => null }
} }))
vi.mock("next-auth/providers/credentials", () => ({ default: (config: unknown) => config }))

/** The browser session of the organization's administrator, for the card's «Сбросить пароль». */
const webSession = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/api-auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/api-auth")>(),
  getSession: vi.fn(async () => webSession.current),
  requireSessionAuth: vi.fn(async () => webSession.current?.principalType === "session"
    ? webSession.current : NextResponse.json({ error: "Unauthorized" }, { status: 401 })),
}))

vi.mock("@/lib/superadmin-guard", () => ({
  requireSuperAdmin: vi.fn(async () => webSession.current?.principalType === "session" && webSession.current.role === "superadmin"
    ? webSession.current : NextResponse.json({ error: "Forbidden" }, { status: 403 })),
}))

const recoveryMail = vi.hoisted(() => ({ messages: [] as Array<{ organizationId: string; to: string; html: string }> }))
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async (message: { organizationId: string; to: string; html: string }) => {
  recoveryMail.messages.push(message)
}) }))

// Limits are not under test; every request is let through.
vi.mock("@/lib/public-abuse-guard", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/public-abuse-guard")>(),
  consumePublicRateLimit: async () => ({ allowed: true, retryAfterSeconds: 0, unavailable: false }),
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-login-code"
const SENDER = "org-login-code-sender"
const BASE = "http://localhost:3000/api/v1/mtm/mobile/auth"
const STRONG = "Fictional-Pass-2026!"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
}

/** `db push` on any Postgres: the two pgvector columns are left out; nothing here reads them. */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-login-code-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

type Sent = { url: string; authorization: string | null; body: { to: string; template: { name: string; language: { code: string }; components: Array<{ type: string; sub_type?: string; parameters: Array<{ text: string }> }> } } }

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("MTM sign-in by a WhatsApp code on a real Postgres", () => {
  let prisma!: typeof import("@/lib/prisma").prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let requestCode!: typeof import("@/app/api/v1/mtm/mobile/auth/code/route").POST
  let verifyCode!: typeof import("@/app/api/v1/mtm/mobile/auth/code/verify/route").POST
  let setPassword!: typeof import("@/app/api/v1/mtm/mobile/auth/password/route").POST
  let signIn!: typeof import("@/app/api/v1/mtm/mobile/auth/route").POST
  let resetUser!: typeof import("@/app/api/v1/users/[id]/reset-password/route").POST
  let changeOwnPassword!: typeof import("@/app/api/v1/users/me/change-password/route").POST
  let forgotPassword!: typeof import("@/app/api/v1/auth/forgot-password/route").POST
  let redeemPassword!: typeof import("@/app/api/v1/auth/reset-password/route").POST
  let resetTenantUser!: typeof import("@/app/api/v1/admin/tenants/[id]/users/[userId]/reset-password/route").POST
  let updateAgent!: typeof import("@/app/api/v1/mtm/agents/[id]/route").PUT
  let resolveMobileAuth!: typeof import("@/lib/mobile-auth").resolveMobileAuth
  let availability!: typeof import("@/lib/mtm/whatsapp-login-code")
  const sent: Sent[] = []
  let metaAnswers: (() => Response) | null = null
  const ids: Record<string, string> = {}

  const post = (handler: (req: NextRequest) => Promise<Response>, suffix: string, body: unknown) =>
    handler(new NextRequest(`${BASE}${suffix}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
  const ask = (phone: string, language = "az") => post(requestCode, "/code", { organizationSlug: ORG, phone, language })
  const verify = (phone: string, code: string) => post(verifyCode, "/code/verify", { organizationSlug: ORG, phone, code })
  const codeOf = (message: Sent) => message.body.template.components[0].parameters[0].text

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    requestCode = (await import("@/app/api/v1/mtm/mobile/auth/code/route")).POST
    verifyCode = (await import("@/app/api/v1/mtm/mobile/auth/code/verify/route")).POST
    setPassword = (await import("@/app/api/v1/mtm/mobile/auth/password/route")).POST
    signIn = (await import("@/app/api/v1/mtm/mobile/auth/route")).POST
    updateAgent = (await import("@/app/api/v1/mtm/agents/[id]/route")).PUT
    resolveMobileAuth = (await import("@/lib/mobile-auth")).resolveMobileAuth
    await import("@/lib/auth")
    resetUser = (await import("@/app/api/v1/users/[id]/reset-password/route")).POST
    changeOwnPassword = (await import("@/app/api/v1/users/me/change-password/route")).POST
    forgotPassword = (await import("@/app/api/v1/auth/forgot-password/route")).POST
    redeemPassword = (await import("@/app/api/v1/auth/reset-password/route")).POST
    resetTenantUser = (await import("@/app/api/v1/admin/tenants/[id]/users/[userId]/reset-password/route")).POST
    availability = await import("@/lib/mtm/whatsapp-login-code")
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      sent.push({ url, authorization: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) })
      return metaAnswers ? metaAnswers() : new Response(JSON.stringify({ messages: [{ id: `wamid.fixture-${sent.length}` }] }), { status: 200 })
    }))
    await bypass(async () => {
      await prisma.organization.create({ data: { id: SENDER, name: "Fictional platform sender", slug: SENDER } })
      await prisma.channelConfig.create({ data: { organizationId: SENDER, channelType: "whatsapp", configName: "Platform WhatsApp", accessToken: "fixture-sender-token", phoneNumberId: "100200300", isActive: true } })
      await prisma.organization.create({ data: { id: ORG, name: "Fictional pharmacy company", slug: ORG, modules: { "route-field": true, personnel: true } } })
      await prisma.mtmSetting.create({ data: { organizationId: ORG, key: "attendanceEnabled", value: true } })
      // A field agent whose own card has the number, written internationally.
      ids.field = (await prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Fictional field agent", phone: "+994 50 111 00 01", role: "AGENT", passwordHash: await bcrypt.hash("Old-Field-Pass-2026!", 4) } })).id
      // An office employee added before 2026-10-15: the number is on the CRM user only, written the national way.
      const user = await prisma.user.create({ data: { organizationId: ORG, name: "Fictional office employee", email: "office@example.invalid", phone: "0501110002", passwordHash: "!fixture", role: "viewer" } })
      ids.officeUser = user.id
      ids.office = (await prisma.mtmAgent.create({ data: { organizationId: ORG, userId: user.id, name: "Fictional office employee", role: "EMPLOYEE", attendanceParticipant: true } })).id
      // Two people with one number, and a dismissed one.
      for (const name of ["Fictional twin A", "Fictional twin B"]) await prisma.mtmAgent.create({ data: { organizationId: ORG, name, phone: "+994501110003", role: "AGENT" } })
      await prisma.mtmAgent.create({ data: { organizationId: ORG, name: "Fictional dismissed agent", phone: "+994501110004", role: "AGENT", status: "INACTIVE" } })
    })
  }, 300_000)

  afterEach(() => {
    recoveryMail.messages.length = 0
    sent.length = 0
    metaAnswers = null
    availability.resetLoginCodeAvailability()
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
  })

  it("sends six digits from LeadDrive's WhatsApp, in the text and on the copy button, and keeps only their hash", async () => {
    const response = await ask("+994501110001")
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ sent: true, resendAfterSeconds: 60, expiresInSeconds: 600 })
    expect(sent).toHaveLength(1)
    const [message] = sent
    expect(message.url).toBe("https://graph.facebook.com/v21.0/100200300/messages")
    expect(message.authorization).toBe("Bearer fixture-sender-token")
    expect(message.body).toMatchObject({ to: "994501110001", template: { name: "leaddrive_login_code", language: { code: "az" } } })
    const code = codeOf(message)
    expect(code).toMatch(/^\d{6}$/)
    expect(message.body.template.components[1]).toMatchObject({ type: "button", sub_type: "url", parameters: [{ text: code }] })
    await bypass(async () => {
      const stored = await prisma.otpCode.findFirstOrThrow({ where: { organizationId: ORG, phone: "+994501110001", purpose: "mtm_app_login" } })
      expect(stored.codeHash).not.toContain(code)
      expect(await bcrypt.compare(code, stored.codeHash)).toBe(true)
      // A Zeytun employee's number has no business in LeadDrive Inc.'s inbox.
      expect(await prisma.channelMessage.count()).toBe(0)
      const audit = await prisma.mtmAuditLog.findFirstOrThrow({ where: { organizationId: ORG, action: "MOBILE_LOGIN_CODE_SENT" } })
      expect(audit.agentId).toBe(ids.field)
      expect(JSON.stringify(audit.newData)).not.toContain("1110001")
      expect(JSON.stringify(audit.newData)).not.toContain(code)
    })
  })

  it("asks to wait a minute before another code to the same number", async () => {
    const response = await ask("+994501110001")
    const { data } = await response.json()
    expect(data.sent).toBe(true)
    expect(data.resendAfterSeconds).toBeGreaterThan(0)
    expect(data.resendAfterSeconds).toBeLessThanOrEqual(60)
    expect(sent).toHaveLength(0)
  })

  it.each([
    ["a number nobody has", "+994501119999"],
    ["a number two people share", "+994501110003"],
    ["a dismissed person's number", "+994501110004"],
  ])("answers «sent» to %s and sends nothing", async (_label, phone) => {
    const response = await ask(phone)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toEqual({ sent: true, resendAfterSeconds: 60, expiresInSeconds: 600 })
    expect(sent).toHaveLength(0)
  })

  it("takes the right code once, sets the person's own password, signs in, and the password works by number", async () => {
    // A fresh code: the one from the first test is still the live one, so wait it out by retiring it.
    await bypass(() => prisma.otpCode.updateMany({ where: { organizationId: ORG, phone: "+994501110001" }, data: { createdAt: new Date(Date.now() - 120_000) } }))
    await ask("+994 50 111 00 01", "ru")
    expect(sent[0].body.template.language.code).toBe("ru")
    const code = codeOf(sent[0])
    const wrong = code === "000000" ? "111111" : "000000"

    const refused = await verify("+994501110001", wrong)
    expect(refused.status).toBe(400)
    expect((await refused.json()).code).toBe("MTM_LOGIN_CODE_INVALID")
    const accepted = await verify("994501110001", code)
    expect(accepted.status).toBe(200)
    const { data: proof } = await accepted.json()
    expect(proof.agent).toEqual({ name: "Fictional field agent" })
    expect(proof.organizationName).toBe("Fictional pharmacy company")
    const again = await verify("+994501110001", code)
    expect((await again.json()).code).toBe("MTM_LOGIN_CODE_EXPIRED")

    // The setup token is not a session.
    const decoded = jwt.decode(proof.setupToken) as Record<string, unknown>
    expect(decoded.agentId).toBeUndefined()
    expect(decoded.sub).toBe(ids.field)

    const weak = await post(setPassword, "/password", { setupToken: proof.setupToken, password: "short" })
    expect(weak.status).toBe(400)
    expect((await weak.json()).code).toBe("MTM_PASSWORD_WEAK")
    const set = await post(setPassword, "/password", { setupToken: proof.setupToken, password: STRONG })
    expect(set.status).toBe(200)
    const { data: session } = await set.json()
    const claims = jwt.verify(session.token, process.env.NEXTAUTH_SECRET!) as Record<string, unknown>
    expect(claims).toMatchObject({ agentId: ids.field, orgId: ORG, role: "AGENT" })
    expect(session.agent).toMatchObject({ id: ids.field, organizationName: "Fictional pharmacy company" })
    const card = await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: ids.field } }))
    expect(await bcrypt.compare(STRONG, card.passwordHash!)).toBe(true)
    expect(await bcrypt.compare("Old-Field-Pass-2026!", card.passwordHash!)).toBe(false)

    // Once: the password changed, so the token's fingerprint no longer matches.
    const replay = await post(setPassword, "/password", { setupToken: proof.setupToken, password: "Another-Pass-2026!" })
    expect(replay.status).toBe(401)
    expect((await replay.json()).code).toBe("MTM_PASSWORD_SETUP_EXPIRED")

    // From now on the password form, by number, with the company.
    const byNumber = await post(signIn, "", { phone: "050 111 00 01", password: STRONG, organizationSlug: ORG })
    expect(byNumber.status).toBe(200)
    expect((jwt.verify((await byNumber.json()).data.token, process.env.NEXTAUTH_SECRET!) as Record<string, unknown>).agentId).toBe(ids.field)
    expect((await post(signIn, "", { phone: "050 111 00 01", password: "Old-Field-Pass-2026!", organizationSlug: ORG })).status).toBe(401)
    // A number without the company is refused outright.
    expect((await post(signIn, "", { phone: "+994501110001", password: STRONG })).status).toBe(400)
  })

  it("reaches an office employee by the number on their CRM user, and stops when attendance is off", async () => {
    await ask("+994501110002")
    expect(sent).toHaveLength(1)
    const accepted = await verify("+994501110002", codeOf(sent[0]))
    const { data: proof } = await accepted.json()
    const set = await post(setPassword, "/password", { setupToken: proof.setupToken, password: STRONG })
    expect(set.status).toBe(200)
    expect((jwt.verify((await set.json()).data.token, process.env.NEXTAUTH_SECRET!) as Record<string, unknown>)).toMatchObject({ agentId: ids.office, userId: ids.officeUser, role: "EMPLOYEE" })

    await bypass(() => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: ORG, key: "attendanceEnabled" } }, data: { value: false } }))
    try {
      await bypass(() => prisma.otpCode.updateMany({ where: { organizationId: ORG, phone: "+994501110002" }, data: { createdAt: new Date(Date.now() - 120_000) } }))
      sent.length = 0
      const off = await ask("+994501110002")
      expect((await off.json()).data.sent).toBe(true)
      expect(sent).toHaveLength(0)
      expect((await post(signIn, "", { phone: "+994501110002", password: STRONG, organizationSlug: ORG })).status).toBe(401)
    } finally {
      await bypass(() => prisma.mtmSetting.update({ where: { organizationId_key: { organizationId: ORG, key: "attendanceEnabled" } }, data: { value: true } }))
    }
  })

  it("signs in by number with the password the administrator set on the card, and ends the phone's older session", async () => {
    // A manager's card linked to a CRM user, like most managers': no password
    // of its own, and the CRM user's password is the person's, not the admin's.
    const { cardId, userId } = await bypass(async () => {
      const user = await prisma.user.create({ data: { organizationId: ORG, name: "Fictional manager", email: "manager@example.invalid", passwordHash: await bcrypt.hash("Crm-Web-Pass-2026!", 4), role: "manager" } })
      const card = await prisma.mtmAgent.create({ data: { organizationId: ORG, userId: user.id, name: "Fictional manager", email: "manager@example.invalid", phone: "+994501110005", role: "MANAGER" } })
      return { cardId: card.id, userId: user.id }
    })
    expect((await post(signIn, "", { phone: "+994501110005", password: STRONG, organizationSlug: ORG })).status).toBe(401)
    // Signed in on some phone with the CRM password before the reset.
    const before = await post(signIn, "", { phone: "+994501110005", password: "Crm-Web-Pass-2026!", organizationSlug: ORG })
    expect(before.status).toBe(200)
    const oldToken = (await before.json()).data.token as string
    const withToken = (token: string) => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/profile", { headers: { authorization: `Bearer ${token}` } })
    expect(await resolveMobileAuth(withToken(oldToken))).not.toBeNull()

    const reset = (password: string) => updateAgent(
      new NextRequest(`http://localhost:3000/api/v1/mtm/agents/${cardId}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) }),
      { params: Promise.resolve({ id: cardId }) },
    )
    webSession.current = { orgId: ORG, userId: "fictional-admin", role: "admin", email: "admin@example.invalid", name: "Fictional admin", principalType: "session" }
    try {
      const weak = await reset("short")
      expect(weak.status).toBe(400)
      expect((await weak.json()).code).toBe("MTM_PASSWORD_WEAK")
      expect((await reset(STRONG)).status).toBe(200)
    } finally {
      webSession.current = null
    }

    const byNumber = await post(signIn, "", { phone: "050 111 00 05", password: STRONG, organizationSlug: ORG })
    expect(byNumber.status).toBe(200)
    expect(jwt.verify((await byNumber.json()).data.token, process.env.NEXTAUTH_SECRET!) as Record<string, unknown>).toMatchObject({ agentId: cardId, userId, orgId: ORG, role: "MANAGER" })
    expect((await post(signIn, "", { email: "manager@example.invalid", password: STRONG, organizationSlug: ORG })).status).toBe(200)
    // The phone that was signed in before has to sign in again.
    expect(await resolveMobileAuth(withToken(oldToken))).toBeNull()

    const [card, user] = await bypass(() => Promise.all([
      prisma.mtmAgent.findUniqueOrThrow({ where: { id: cardId } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]))
    expect(await bcrypt.compare(STRONG, card.passwordHash!)).toBe(true)
    // The person's own CRM password is untouched.
    expect(await bcrypt.compare("Crm-Web-Pass-2026!", user.passwordHash!)).toBe(true)
    // Who set it is on record; neither the password nor its hash is.
    const audit = await bypass(() => prisma.mtmAuditLog.findFirstOrThrow({ where: { organizationId: ORG, entityId: cardId, action: "AGENT_UPDATE" } }))
    expect(audit.newData).toMatchObject({ passwordHash: "[redacted]" })
    expect(JSON.stringify(audit)).not.toContain(STRONG)
    expect(JSON.stringify(audit)).not.toContain(card.passwordHash!)

    // The code still works for them afterwards: the agent may set their own.
    await ask("+994501110005")
    expect(sent).toHaveLength(1)
    expect((await verify("+994501110005", codeOf(sent[0]))).status).toBe(200)
  })

  it("refuses a real previously valid legacy JWT after authority changes while both old credential fingerprints stay unchanged", async () => {
    const company = "identity-legacy-mobile-boundary"
    const password = "Fictional-Boundary-Pass-2026!", phone = "+994501119991"
    const { userId, cardId } = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional boundary company", slug: company, modules: { "route-field": true, personnel: false } } })
      const hash = await bcrypt.hash(password, 4)
      const user = await prisma.user.create({ data: { organizationId: company, name: "Fictional boundary person", email: "boundary@example.invalid", passwordHash: hash, role: "viewer" } })
      const card = await prisma.mtmAgent.create({ data: { organizationId: company, userId: user.id, name: "Fictional boundary field card", email: "boundary@example.invalid", phone, role: "AGENT", passwordHash: hash } })
      return { userId: user.id, cardId: card.id }
    })
    const response = await post(signIn, "", { phone, password, organizationSlug: company })
    expect(response.status).toBe(200)
    const token = (await response.json()).data.token as string
    const request = () => new NextRequest("http://localhost:3000/api/v1/mtm/mobile/profile", { headers: { authorization: `Bearer ${token}` } })
    expect((await resolveMobileAuth(request()))?.agentId).toBe(cardId)
    const credentials = () => bypass(() => Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, passwordChangedAt: true, isActive: true } }),
      prisma.mtmAgent.findUniqueOrThrow({ where: { id: cardId }, select: { passwordHash: true, userId: true, status: true } }),
    ]))
    const before = await credentials()
    expect((await post(signIn, "", { email: "boundary@example.invalid", password, organizationSlug: company })).status).toBe(200)
    expect((await post(requestCode, "/code", { phone, organizationSlug: company })).status).toBe(200)
    expect(sent).toHaveLength(1)
    const verified = await post(verifyCode, "/code/verify", { phone, organizationSlug: company, code: codeOf(sent[0]) })
    expect(verified.status).toBe(200)
    const setupToken = (await verified.json()).data.setupToken as string
    expect(setupToken).toEqual(expect.any(String))
    sent.length = 0
    await bypass(() => prisma.otpCode.updateMany({ where: { organizationId: company, phone }, data: { createdAt: new Date(Date.now() - 120_000) } }))
    expect((await post(requestCode, "/code", { phone, organizationSlug: company })).status).toBe(200)
    expect(sent).toHaveLength(1)
    const unconsumedCode = codeOf(sent[0])
    sent.length = 0
    // Synthetic authority assumption only, not proof/enrollment or activation
    // tooling: even an incomplete canonical record must not restore old auth.
    await bypass(() => prisma.identityAccount.create({ data: { organizationId: company, userId,
      cutoverAt: new Date(), passwordHash: "!fixture-canonical-boundary" } }))
    expect(await resolveMobileAuth(request())).toBeNull()
    expect((await post(signIn, "", { phone, password, organizationSlug: company })).status).toBe(401)
    expect((await post(signIn, "", { email: "boundary@example.invalid", password, organizationSlug: company })).status).toBe(401)
    expect((await post(setPassword, "/password", { setupToken, password: "Different-Boundary-Pass-2026!" })).status).toBe(401)
    // A still-correct, unconsumed code must not mint setup after cutover.
    const refusedCode = await post(verifyCode, "/code/verify", { phone, organizationSlug: company, code: unconsumedCode })
    expect(refusedCode.status).toBe(400)
    expect((await refusedCode.json()).code).toBe("MTM_LOGIN_CODE_INVALID")
    const liveCode = await bypass(() => prisma.otpCode.findFirstOrThrow({ where: { organizationId: company, phone, usedAt: null }, orderBy: { createdAt: "desc" } }))
    expect(liveCode.attempts).toBe(0)
    // Remove the ordinary cooldown as an alternative explanation for no send.
    await bypass(() => prisma.otpCode.updateMany({ where: { organizationId: company, phone }, data: { createdAt: new Date(Date.now() - 120_000) } }))
    const asked = await post(requestCode, "/code", { phone, organizationSlug: company })
    expect(asked.status).toBe(200)
    expect((await asked.json()).data.sent).toBe(true)
    expect((await post(verifyCode, "/code/verify", { phone, organizationSlug: company, code: "000000" })).status).toBe(400)
    expect(await credentials()).toEqual(before)
    expect(sent).toHaveLength(0)
  })

  it("counts canonical CRM allocations independently from mobile people while preserving legacy disabled seats", async () => {
    const company = "identity-crm-seat-count"
    const userId = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional independent seats", slug: company, maxUsers: 1 } })
      await prisma.user.create({ data: { organizationId: company, name: "Fictional disabled legacy seat", email: "legacy-seat@example.invalid", passwordHash: "!unused", role: "viewer", isActive: false } })
      const mobile = await prisma.user.create({ data: { organizationId: company, name: "Fictional mobile person", email: "mobile-seat@example.invalid", passwordHash: "!unused", role: "admin" } })
      await prisma.identityAccount.create({ data: { organizationId: company, userId: mobile.id, cutoverAt: new Date(), passwordHash: "!canonical-seat-fixture" } })
      await prisma.identityApplicationGrant.create({ data: { organizationId: company, userId: mobile.id, application: "TIME", status: "ACTIVE", role: "EMPLOYEE" } })
      return mobile.id
    })
    const { checkUserLimit } = await import("@/lib/plan-limits")
    const { runWithTenant } = await import("@/lib/rls-context")
    const check = () => runWithTenant(company, () => checkUserLimit(company))
    expect(await check()).toMatchObject({ allowed: false, message: "User limit reached (1/1). Upgrade your plan to add more users." })
    await bypass(() => prisma.organization.update({ where: { id: company }, data: { maxUsers: 2 } }))
    expect(await check()).toEqual({ allowed: true })
    await bypass(() => prisma.identityApplicationGrant.create({ data: { organizationId: company, userId, application: "CRM", status: "ACTIVE", role: "viewer" } }))
    expect((await check()).allowed).toBe(false)
    // Lifecycle/rollout off does not silently deallocate an assigned CRM seat.
    await bypass(() => prisma.organization.update({ where: { id: company }, data: { isActive: false } }))
    expect((await check()).allowed).toBe(false)
    await bypass(() => prisma.identityApplicationGrant.update({ where: { organizationId_userId_application: { organizationId: company, userId, application: "CRM" } }, data: { status: "REVOKED", role: null, version: 2 } }))
    expect(await check()).toEqual({ allowed: true })
    expect(await bypass(() => prisma.user.count({ where: { organizationId: company } }))).toBe(2)
    expect(sent).toHaveLength(0)
  })

  it("keeps legacy card reset and relink atomic and refuses canonical current or new owners", async () => {
    const company = "identity-card-maintenance", oldPassword = "Fictional-Card-Old-Pass-2026!", newPassword = "Fictional-Card-New-Pass-2026!"
    const fixture = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional card maintenance", slug: company, modules: { "route-field": true } } })
      const admin = await prisma.user.create({ data: { organizationId: company, name: "Fictional admin", email: "card-admin@example.invalid", role: "admin", passwordHash: "!unused" } })
      const user = await prisma.user.create({ data: { organizationId: company, name: "Fictional old owner", email: "card-owner@example.invalid", role: "viewer", passwordHash: "!unused" } })
      const card = await prisma.mtmAgent.create({ data: { organizationId: company, userId: user.id, name: "Fictional disabled card", status: "INACTIVE", role: "AGENT", passwordHash: await bcrypt.hash(oldPassword, 4) } })
      const other = await prisma.mtmAgent.create({ data: { organizationId: company, name: "Fictional unlinked card", role: "AGENT" } })
      return { adminId: admin.id, userId: user.id, cardId: card.id, otherId: other.id, oldHash: card.passwordHash }
    })
    const change = (id: string, body: unknown) => updateAgent(new NextRequest(`http://localhost/api/v1/mtm/agents/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), { params: Promise.resolve({ id }) })
    const cardState = () => bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId }, select: { passwordHash: true, status: true, userId: true } }))
    webSession.current = { orgId: company, userId: fixture.adminId, role: "admin", email: "card-admin@example.invalid", name: "Fictional admin", principalType: "session" }
    try {
      await bypass(() => prisma.$executeRawUnsafe(`ALTER TABLE mtm_audit_logs ADD CONSTRAINT identity_fixture_card_audit_fail CHECK ("organizationId" <> 'identity-card-maintenance' OR action <> 'AGENT_UPDATE') NOT VALID`))
      try {
        expect((await change(fixture.cardId, { password: newPassword })).status).toBe(400)
        expect(await cardState()).toEqual({ passwordHash: fixture.oldHash, status: "INACTIVE", userId: fixture.userId })
      } finally { await bypass(() => prisma.$executeRawUnsafe("ALTER TABLE mtm_audit_logs DROP CONSTRAINT identity_fixture_card_audit_fail")) }
      expect((await change(fixture.cardId, { password: newPassword })).status).toBe(200)
      const maintained = await cardState()
      expect(maintained.status).toBe("INACTIVE")
      expect(await bcrypt.compare(newPassword, maintained.passwordHash!)).toBe(true)
      await bypass(() => prisma.identityAccount.create({ data: { organizationId: company, userId: fixture.userId, cutoverAt: new Date(), passwordHash: "!canonical-card-fixture" } }))
      for (const body of [{ password: oldPassword }, { userId: null }]) {
        const refused = await change(fixture.cardId, body)
        expect(refused.status).toBe(409)
        expect((await refused.json()).code).toBe("IDENTITY_CREDENTIAL_FLOW_REQUIRED")
      }
      expect((await change(fixture.otherId, { userId: fixture.userId })).status).toBe(409)
      expect(await cardState()).toEqual(maintained)
      await bypass(async () => {
        expect((await prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.otherId } })).userId).toBeNull()
        expect(await prisma.mtmAuditLog.count({ where: { organizationId: company, action: "AGENT_UPDATE" } })).toBe(1)
      })
    } finally { webSession.current = null }
    expect(sent).toHaveLength(0)
  })

  it("refuses legacy password and OTP through another canonical person's number, including the linked User national alias", async () => {
    const company = "identity-phone-namespace", phone = "+994507778877", national = "0507778877", password = "Fictional-Phone-Namespace-2026!"
    const fixture = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional phone namespace company", slug: company, modules: { "route-field": true } } })
      const legacy = await prisma.user.create({ data: { organizationId: company, name: "Fictional legacy owner", email: "legacy-namespace@example.invalid", phone: national, passwordHash: "!unused", role: "viewer" } })
      const canonical = await prisma.user.create({ data: { organizationId: company, name: "Fictional reviewed canonical owner", email: "canonical-namespace@example.invalid", passwordHash: "!unused", role: "viewer" } })
      const card = await prisma.mtmAgent.create({ data: { organizationId: company, userId: legacy.id, name: "Fictional old alias card", email: "card-namespace@example.invalid", role: "AGENT", passwordHash: await bcrypt.hash(password, 4) } })
      await prisma.identityAccount.create({ data: { organizationId: company, userId: canonical.id } })
      await prisma.identityPhoneClaim.create({ data: { organizationId: company, userId: canonical.id, normalizedPhone: phone, accountVersion: 1, verifiedAt: new Date() } })
      return { cardId: card.id, canonicalId: canonical.id, legacyId: legacy.id }
    })
    const login = (entered: string) => post(signIn, "", { phone: entered, password, organizationSlug: company })
    // A reviewed shadow is not authority and must not switch existing login.
    expect((await login(phone)).status).toBe(200)
    expect((await post(requestCode, "/code", { phone, organizationSlug: company })).status).toBe(200)
    expect(sent).toHaveLength(1)
    const oldCode = codeOf(sent[0])
    // A genuine server-signed pre-cutover capability must also lose the old
    // phone-derived write path. Keep the separate OTP unconsumed for its test.
    const { signPasswordSetupToken } = await import("@/lib/mtm/mobile-login-session")
    const originalCard = await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId } }))
    const oldSetup = signPasswordSetupToken(originalCard)
    await bypass(async () => {
      await prisma.identityAccount.update({ where: { organizationId_userId: { organizationId: company, userId: fixture.canonicalId } },
        data: { cutoverAt: new Date(), passwordHash: "!canonical-namespace-fixture", version: 2, credentialEpoch: 2 } })
      // Remove cooldown as an alternative explanation for the subsequent refusal.
      await prisma.otpCode.updateMany({ where: { organizationId: company, phone }, data: { createdAt: new Date(Date.now() - 120_000) } })
    })
    sent.length = 0
    for (const entered of [phone, national, "+155507778877"]) expect((await login(entered)).status).toBe(401)
    expect((await post(setPassword, "/password", { setupToken: oldSetup, password: "Different-Namespace-Pass-2026!" })).status).toBe(401)
    expect((await post(verifyCode, "/code/verify", { phone, organizationSlug: company, code: oldCode })).status).toBe(400)
    expect((await post(requestCode, "/code", { phone, organizationSlug: company })).status).toBe(200)
    expect(sent).toHaveLength(0)
    // Stable actor/email credentials still identify the old person; the phone
    // conflict does not transfer his card, data or claim to the canonical one.
    expect((await post(signIn, "", { email: "card-namespace@example.invalid", password, organizationSlug: company })).status).toBe(200)
    await bypass(async () => {
      expect((await prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId } })).userId).toBe(fixture.legacyId)
      expect((await prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId } })).passwordHash).toBe(originalCard.passwordHash)
      expect((await prisma.identityPhoneClaim.findUniqueOrThrow({ where: { organizationId_userId: { organizationId: company, userId: fixture.canonicalId } } })).normalizedPhone).toBe(phone)
      expect((await prisma.otpCode.findFirstOrThrow({ where: { organizationId: company, phone }, orderBy: { createdAt: "desc" } })).attempts).toBe(0)
    })
  })

  it("atomically links a proven legacy mailbox owner and rolls back the link when its audit fails", async () => {
    const company = "identity-atomic-email-link", email = "atomic-link@example.invalid", password = "Fictional-Atomic-Link-Pass-2026!"
    const fixture = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional atomic email link", slug: company, modules: { "route-field": true } } })
      const user = await prisma.user.create({ data: { organizationId: company, name: "Fictional proven mailbox owner", email, passwordHash: await bcrypt.hash(password, 4), role: "viewer" } })
      const card = await prisma.mtmAgent.create({ data: { organizationId: company, name: "Fictional unlinked card", email, role: "AGENT" } })
      return { userId: user.id, cardId: card.id }
    })
    const login = () => post(signIn, "", { email, password, organizationSlug: company })
    await bypass(() => prisma.$executeRawUnsafe(`ALTER TABLE mtm_audit_logs ADD CONSTRAINT identity_fixture_link_audit_fail CHECK ("organizationId" <> 'identity-atomic-email-link' OR action <> 'AUTO_LINK') NOT VALID`))
    try {
      expect((await login()).status).toBe(500)
      await bypass(async () => {
        expect((await prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId } })).userId).toBeNull()
        expect(await prisma.mtmAuditLog.count({ where: { organizationId: company, action: { in: ["AUTO_LINK", "MOBILE_LOGIN"] } } })).toBe(0)
      })
    } finally { await bypass(() => prisma.$executeRawUnsafe("ALTER TABLE mtm_audit_logs DROP CONSTRAINT identity_fixture_link_audit_fail")) }
    const admitted = await login()
    expect(admitted.status).toBe(200)
    const data = (await admitted.json()).data
    expect(await resolveMobileAuth(new NextRequest("http://localhost/api/v1/mtm/mobile/me", {
      headers: { authorization: `Bearer ${data.token}` },
    }))).toMatchObject({ agentId: fixture.cardId, userId: fixture.userId, orgId: company })
    await bypass(async () => {
      expect((await prisma.mtmAgent.findUniqueOrThrow({ where: { id: fixture.cardId } })).userId).toBe(fixture.userId)
      expect(await prisma.mtmAuditLog.count({ where: { organizationId: company, action: "AUTO_LINK" } })).toBe(1)
      expect(await prisma.mtmAuditLog.count({ where: { organizationId: company, action: "MOBILE_LOGIN" } })).toBe(1)
    })
    expect(sent).toHaveLength(0)
  })

  it("does not adopt a canonical User through the legacy same-email auto-link", async () => {
    const company = "identity-legacy-email-boundary", email = "unlinked@example.invalid", password = "Fictional-Unlinked-Pass-2026!"
    const cardId = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional unlinked company", slug: company, modules: { "route-field": true } } })
      const user = await prisma.user.create({ data: { organizationId: company, name: "Fictional canonical person", email, passwordHash: await bcrypt.hash(password, 4), role: "viewer" } })
      await prisma.identityAccount.create({ data: { organizationId: company, userId: user.id, cutoverAt: new Date(), passwordHash: "!fixture-canonical-boundary" } })
      return (await prisma.mtmAgent.create({ data: { organizationId: company, name: "Fictional unlinked card", email, role: "AGENT" } })).id
    })
    expect((await post(signIn, "", { email, password, organizationSlug: company })).status).toBe(401)
    await bypass(async () => {
      expect((await prisma.mtmAgent.findUniqueOrThrow({ where: { id: cardId } })).userId).toBeNull()
      expect(await prisma.mtmAuditLog.count({ where: { organizationId: company, action: "AUTO_LINK" } })).toBe(0)
    })
    expect(sent).toHaveLength(0)
  })

  it("rolls back the legacy code password change when its real audit insert fails, preserving the setup capability", async () => {
    const company = "identity-setup-atomic-audit", phone = "+994501119992", password = "Fictional-Atomic-Pass-2026!"
    const cardId = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional atomic setup company", slug: company, modules: { "route-field": true } } })
      return (await prisma.mtmAgent.create({ data: { organizationId: company, name: "Fictional atomic setup card", phone, role: "AGENT", passwordHash: await bcrypt.hash(password, 4) } })).id
    })
    expect((await post(requestCode, "/code", { phone, organizationSlug: company })).status).toBe(200)
    expect(sent).toHaveLength(1)
    const verified = await post(verifyCode, "/code/verify", { phone, organizationSlug: company, code: codeOf(sent[0]) })
    expect(verified.status).toBe(200)
    const setupToken = (await verified.json()).data.setupToken as string
    const before = await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: cardId }, select: { passwordHash: true, userId: true, status: true } }))
    await bypass(() => prisma.$executeRawUnsafe(`ALTER TABLE mtm_audit_logs ADD CONSTRAINT identity_fixture_setup_audit_fail CHECK ("organizationId" <> 'identity-setup-atomic-audit' OR action <> 'MOBILE_PASSWORD_SET_BY_CODE') NOT VALID`))
    try {
      expect((await post(setPassword, "/password", { setupToken, password: "Fictional-Atomic-Changed-2026!" })).status).toBe(500)
      expect(await bypass(() => prisma.mtmAgent.findUniqueOrThrow({ where: { id: cardId }, select: { passwordHash: true, userId: true, status: true } }))).toEqual(before)
    } finally {
      await bypass(() => prisma.$executeRawUnsafe("ALTER TABLE mtm_audit_logs DROP CONSTRAINT identity_fixture_setup_audit_fail"))
    }
    expect((await post(setPassword, "/password", { setupToken, password: "Fictional-Atomic-Changed-2026!" })).status).toBe(200)
    expect((await post(setPassword, "/password", { setupToken, password: "Fictional-Atomic-Changed-2026!" })).status).toBe(401)
  })

  it.each([
    { suffix: "ordinary", role: "viewer", companyActive: true },
    { suffix: "platform", role: "superadmin", companyActive: false },
  ])("fences actual CRM authorize/issue/refresh callbacks after authority for $suffix while preserving legacy credentials", async ({ suffix, role, companyActive }) => {
    const company = `identity-crm-callback-${suffix}`, email = `${suffix}@crm-boundary.invalid`, password = "Fictional-Crm-Callback-2026!"
    const userId = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional CRM boundary company", slug: company, isActive: companyActive } })
      return (await prisma.user.create({ data: { organizationId: company, name: "Fictional CRM boundary person", email, role, passwordHash: await bcrypt.hash(password, 4) } })).id
    })
    const authorize = crmAuth.config.providers[0].authorize, callback = crmAuth.config.callbacks.jwt
    const credentials = { email, password, organizationSlug: company }
    const signedIn = await authorize(credentials)
    expect(signedIn).toMatchObject({ id: userId, role, organizationId: company })
    const token = await callback({ token: { sub: userId, email }, user: signedIn, account: { provider: "credentials" } })
    expect(token).toMatchObject({ sub: userId, role, organizationId: company })
    expect(await callback({ token, user: undefined })).toMatchObject({ sub: userId, role })
    const state = () => bypass(() => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: {
      passwordHash: true, passwordChangedAt: true, isActive: true, loginCount: true, lastLogin: true,
      totpEnabled: true, smsAuthEnabled: true, require2fa: true, twoFactorNonce: true,
    } }))
    const before = await state()
    // Synthetic authority assumption only; platform conversion is not a
    // supported onboarding path. Even malformed authority must refuse fallback.
    await bypass(() => prisma.identityAccount.create({ data: { organizationId: company, userId, cutoverAt: new Date(), passwordHash: "!fixture-crm-canonical" } }))
    expect(await authorize(credentials)).toBeNull()
    expect(await callback({ token: { sub: userId, email }, user: signedIn, account: { provider: "credentials" } })).toBeNull()
    expect(await callback({ token, user: undefined })).toBeNull()
    expect(await state()).toEqual(before)
    expect(sent).toHaveLength(0)
  })

  async function canonicalCrmFixture(suffix: string, mfa: { require2fa?: boolean; totpEnabled?: boolean } = {}) {
    const company = `identity-canonical-crm-${suffix}`, email = `${suffix}@canonical-crm.invalid`
    const password = "Fictional-Shared-Crm-2026!", legacyPassword = "Fictional-Old-Crm-2026!"
    const sharedHash = await bcrypt.hash(password, 12)
    const userId = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, slug: company, name: "Fictional canonical CRM company" } })
      const person = await prisma.user.create({ data: { organizationId: company, email, name: "Fictional canonical CRM person", role: "admin", passwordHash: await bcrypt.hash(legacyPassword, 4), ...mfa } })
      await prisma.identityAccount.create({ data: { organizationId: company, userId: person.id, cutoverAt: new Date(), passwordHash: sharedHash } })
      await prisma.identityPhoneClaim.create({ data: { organizationId: company, userId: person.id, normalizedPhone: "+994507770001", verifiedAt: new Date(), accountVersion: 1 } })
      await prisma.identityApplicationGrant.create({ data: { organizationId: company, userId: person.id, application: "CRM", status: "ACTIVE", role: "viewer" } })
      await prisma.mtmSetting.create({ data: { organizationId: company, key: "identityAuthV1", value: { version: 1, enabled: true } } })
      return person.id
    })
    const authorize = crmAuth.config.providers[0].authorize, callback = crmAuth.config.callbacks.jwt
    const credentials = { email, password, organizationSlug: company }
    const issue = async () => {
      const person = await authorize(credentials)
      expect(person).toMatchObject({ id: userId, role: "viewer", identityCrm: { userId, organizationId: company } })
      const token = await callback({ token: { sub: userId, email }, user: person, account: { provider: "credentials" } })
      expect(token).toMatchObject({ sub: userId, role: "viewer", identityCrm: person.identityCrm })
      return { person, token }
    }
    return { company, userId, email, password, legacyPassword, authorize, callback, credentials, issue,
      scope: { organizationId: company, userId }, grantKey: { organizationId_userId_application: { organizationId: company, userId, application: "CRM" as const } } }
  }

  it("uses canonical shared CRM credentials and grant role in actual Auth.js callbacks, isolating sibling grants", async () => {
    const f = await canonicalCrmFixture("password")
    expect(await f.authorize({ ...f.credentials, password: f.legacyPassword })).toBeNull()
    expect(await f.authorize({ email: f.email, password: f.password })).toBeNull()
    const { person, token } = await f.issue()
    expect(await f.callback({ token: { ...token }, user: undefined })).toMatchObject({ role: "viewer" })
    await bypass(async () => {
      await prisma.identityApplicationGrant.create({ data: { ...f.scope, application: "TIME", status: "ACTIVE", role: "EMPLOYEE" } })
      await prisma.identityAccount.update({ where: { organizationId_userId: f.scope }, data: { version: { increment: 1 } } })
    })
    expect(await f.callback({ token: { ...token }, user: undefined })).toMatchObject({ role: "viewer", identityCrm: token.identityCrm })
    const oldCookie = { ...token }
    delete oldCookie.identityCrm
    expect(await f.callback({ token: oldCookie, user: undefined })).toBeNull()
    expect(await f.callback({ token: { sub: f.userId }, user: person, account: { provider: "google" } })).toBeNull()
    const missingFingerprint = { ...person }
    delete missingFingerprint.sessionFingerprint
    expect(await f.callback({ token: { sub: f.userId }, user: missingFingerprint, account: { provider: "credentials" } })).toBeNull()
    await bypass(() => prisma.identityApplicationGrant.update({ where: f.grantKey, data: { role: "manager", version: 2 } }))
    expect(await f.callback({ token: { ...token }, user: undefined })).toBeNull()
    expect(await f.callback({ token: { sub: f.userId }, user: person, account: { provider: "credentials" } })).toBeNull()
    const promoted = await f.authorize(f.credentials)
    expect(promoted).toMatchObject({ role: "manager", identityCrm: { grantVersion: 2 } })
    expect(await f.callback({ token: { sub: f.userId }, user: promoted, account: { provider: "credentials" } })).toMatchObject({ role: "manager" })
    expect(sent).toHaveLength(0)
  })

  it.each([
    { suffix: "setup", require2fa: true, totpEnabled: false, expected: { needsSetup2fa: true } },
    { suffix: "totp", require2fa: false, totpEnabled: true, expected: { needs2fa: true, twoFactorMethod: "totp" } },
  ])("retains canonical CRM $suffix MFA and rejects browser authority/MFA updates", async ({ suffix, require2fa, totpEnabled, expected }) => {
    const f = await canonicalCrmFixture(suffix, { require2fa, totpEnabled })
    const { token } = await f.issue()
    expect(token).toMatchObject(expected)
    const updated = await f.callback({ token: { ...token }, user: undefined, trigger: "update", session: {
      needs2fa: false, needsSetup2fa: false, role: "superadmin",
      identityCrm: { ...token.identityCrm, grantVersion: 999, credentialEpoch: 999 },
    } })
    expect(updated).toMatchObject({ ...expected, role: "viewer", identityCrm: token.identityCrm })
    const publicSession = await crmAuth.config.callbacks.session({ session: { identityCrm: token.identityCrm, user: { email: f.email, identityCrm: token.identityCrm } }, token: updated })
    expect(publicSession.identityCrm).toBeUndefined()
    expect(publicSession.user.identityCrm).toBeUndefined()
    expect(JSON.stringify(publicSession)).not.toContain('"credentialEpoch"')
    expect(sent).toHaveLength(0)
  })

  it("refuses canonical CRM epoch races, logout-all, opt-out and inactive lifecycle without legacy fallback", async () => {
    const f = await canonicalCrmFixture("revocation")
    const { person, token } = await f.issue()
    await bypass(() => prisma.identityAccount.update({ where: { organizationId_userId: f.scope }, data: { credentialEpoch: { increment: 1 }, version: { increment: 1 } } }))
    expect(await f.callback({ token: { ...token }, user: undefined })).toBeNull()
    expect(await f.callback({ token: { sub: f.userId }, user: person, account: { provider: "credentials" } })).toBeNull()
    const renewed = await f.issue()
    await bypass(() => prisma.user.update({ where: { id: f.userId }, data: { passwordChangedAt: new Date("2030-01-01T00:00:00.001Z") } }))
    expect(await f.callback({ token: { ...renewed.token }, user: undefined })).toBeNull()
    const afterLogout = await f.issue()
    const flag = { organizationId_key: { organizationId: f.company, key: "identityAuthV1" } }
    await bypass(() => prisma.mtmSetting.update({ where: flag, data: { value: false } }))
    expect(await f.authorize(f.credentials)).toBeNull()
    expect(await f.authorize({ ...f.credentials, password: f.legacyPassword })).toBeNull()
    expect(await f.callback({ token: { ...afterLogout.token }, user: undefined })).toBeNull()
    await bypass(() => prisma.mtmSetting.update({ where: flag, data: { value: { version: 1, enabled: true } } }))
    await bypass(() => prisma.organization.update({ where: { id: f.company }, data: { isActive: false } }))
    expect(await f.authorize(f.credentials)).toBeNull()
    expect(await f.callback({ token: { ...afterLogout.token }, user: undefined })).toBeNull()
    await bypass(async () => {
      await prisma.organization.update({ where: { id: f.company }, data: { isActive: true } })
      await prisma.user.update({ where: { id: f.userId }, data: { isActive: false } })
    })
    expect(await f.authorize(f.credentials)).toBeNull()
    expect(await f.callback({ token: { ...afterLogout.token }, user: undefined })).toBeNull()
  })

  it.each(["tenant", "platform"] as const)("keeps %s admin reset of disabled legacy users atomic and refuses canonical credentials", async scope => {
    const company = `identity-admin-credential-${scope}`, initialPassword = "Fictional-Admin-Initial-2026!"
    const { targetId, actorId } = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional credential maintenance company", slug: company, isActive: scope === "tenant", modules: { settings: true } } })
      const actorOrg = scope === "tenant" ? company : SENDER
      const actor = await prisma.user.create({ data: { organizationId: actorOrg, name: "Fictional credential administrator", email: `${scope}-actor@credential.invalid`, role: scope === "tenant" ? "admin" : "superadmin", passwordHash: "!fixture-actor-session" } })
      const target = await prisma.user.create({ data: { organizationId: company, name: "Fictional disabled target", email: `${scope}-target@credential.invalid`, role: scope === "tenant" ? "viewer" : "admin", isActive: false, passwordHash: await bcrypt.hash(initialPassword, 4) } })
      return { targetId: target.id, actorId: actor.id }
    })
    const reset = (password: string) => {
      const url = scope === "tenant" ? `http://localhost:3000/api/v1/users/${targetId}/reset-password`
        : `http://localhost:3000/api/v1/admin/tenants/${company}/users/${targetId}/reset-password`
      const request = new NextRequest(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }, body: JSON.stringify({ password, confirmPassword: password }) })
      return scope === "tenant" ? resetUser(request, { params: Promise.resolve({ id: targetId }) })
        : resetTenantUser(request, { params: Promise.resolve({ id: company, userId: targetId }) })
    }
    const state = () => bypass(() => prisma.user.findUniqueOrThrow({ where: { id: targetId }, select: { passwordHash: true, passwordChangedAt: true, isActive: true, resetToken: true, resetTokenExp: true } }))
    webSession.current = { userId: actorId, orgId: scope === "tenant" ? company : SENDER, role: scope === "tenant" ? "admin" : "superadmin", email: `${scope}-actor@credential.invalid`, name: "Fictional credential administrator", principalType: "session" }
    try {
      const newPassword = "Fictional-Admin-Changed-2026!"
      const accepted = await reset(newPassword)
      expect(accepted.status).toBe(200)
      expect((await accepted.json()).data.isActive).toBe(false)
      const before = await state()
      expect(await bcrypt.compare(newPassword, before.passwordHash)).toBe(true)
      expect(before.isActive).toBe(false)
      await bypass(() => prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD CONSTRAINT identity_fixture_admin_audit_fail CHECK ("organizationId" <> '${company}' OR action NOT IN ('password_reset', 'superadmin_password_reset')) NOT VALID`))
      try {
        expect((await reset("Fictional-Admin-Rollback-2026!")).status).toBe(500)
        expect(await state()).toEqual(before)
      } finally {
        await bypass(() => prisma.$executeRawUnsafe("ALTER TABLE audit_logs DROP CONSTRAINT identity_fixture_admin_audit_fail"))
      }
      await bypass(() => prisma.identityAccount.create({ data: { organizationId: company, userId: targetId, cutoverAt: new Date(), passwordHash: "!fixture-admin-canonical" } }))
      const refused = await reset("Fictional-Admin-Forbidden-2026!")
      expect(refused.status).toBe(409)
      expect((await refused.json()).code).toBe("IDENTITY_CREDENTIAL_FLOW_REQUIRED")
      expect(await state()).toEqual(before)
      expect((await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: company }, select: { isActive: true } }))).isActive).toBe(scope === "tenant")
      expect(sent).toHaveLength(0)
    } finally { webSession.current = null }
  })

  it("keeps own password proof and audit atomic, clears old reset links and refuses canonical legacy changes", async () => {
    const company = "identity-own-password", oldPassword = "Fictional-Own-Initial-2026!", newPassword = "Fictional-Own-Changed-2026!"
    const userId = await bypass(async () => {
      await prisma.organization.create({ data: { id: company, name: "Fictional own password company", slug: company } })
      return (await prisma.user.create({ data: { organizationId: company, name: "Fictional own password person", email: "own@credential.invalid", role: "viewer", passwordHash: await bcrypt.hash(oldPassword, 4), resetToken: hashOneTimeToken("fixture-own-old-link"), resetTokenExp: new Date(Date.now() + 3_600_000) } })).id
    })
    const call = (handler: (request: NextRequest) => Promise<Response>, url: string, body: unknown) => handler(new NextRequest(`http://localhost:3000${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
    const change = (currentPassword: string, nextPassword: string) => call(changeOwnPassword, "/api/v1/users/me/change-password", { currentPassword, newPassword: nextPassword })
    const state = () => bypass(() => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, passwordChangedAt: true, resetToken: true, resetTokenExp: true } }))
    webSession.current = { userId, orgId: company, role: "viewer", email: "own@credential.invalid", name: "Fictional own password person", principalType: "session" }
    try {
      expect((await change("incorrect-current-password", newPassword)).status).toBe(400)
      expect((await change(oldPassword, newPassword)).status).toBe(200)
      const before = await state()
      expect(await bcrypt.compare(newPassword, before.passwordHash)).toBe(true)
      expect(before.resetToken).toBeNull(); expect(before.resetTokenExp).toBeNull()
      expect((await call(redeemPassword, "/api/v1/auth/reset-password", { token: "fixture-own-old-link", password: "Fictional-Own-Replayed-2026!" })).status).toBe(400)
      await bypass(() => prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD CONSTRAINT identity_fixture_own_audit_fail CHECK ("organizationId" <> 'identity-own-password' OR action <> 'password_change') NOT VALID`))
      try {
        expect((await change(newPassword, "Fictional-Own-Rollback-2026!")).status).toBe(500)
        expect(await state()).toEqual(before)
      } finally { await bypass(() => prisma.$executeRawUnsafe("ALTER TABLE audit_logs DROP CONSTRAINT identity_fixture_own_audit_fail")) }
      await bypass(() => prisma.identityAccount.create({ data: { organizationId: company, userId, cutoverAt: new Date(), passwordHash: "!fixture-own-canonical" } }))
      expect((await change(newPassword, "Fictional-Own-Forbidden-2026!")).status).toBe(409)
      expect(await state()).toEqual(before)
      expect(sent).toHaveLength(0); expect(recoveryMail.messages).toHaveLength(0)
    } finally { webSession.current = null }
  })

  it("redeems legacy email links once and refuses issue or redemption after canonical authority", async () => {
    const company = "identity-email-password", email = "email@credential.invalid", oldPassword = "Fictional-Email-Initial-2026!"
    const userId = await bypass(async () => {
      // Recovery does not admit sign-in or reactivate a suspended company.
      await prisma.organization.create({ data: { id: company, name: "Fictional email password company", slug: company, isActive: false } })
      return (await prisma.user.create({ data: { organizationId: company, name: "Fictional email password person", email, role: "viewer", passwordHash: await bcrypt.hash(oldPassword, 4) } })).id
    })
    const call = (handler: (request: NextRequest) => Promise<Response>, path: string, body: unknown) => handler(new NextRequest(`http://localhost:3000/api/v1/auth/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }))
    const ask = () => call(forgotPassword, "forgot-password", { email })
    const tokenOf = (index: number) => {
      expect(recoveryMail.messages[index]).toMatchObject({ organizationId: company, to: email })
      const token = recoveryMail.messages[index].html.match(/reset-password\?token=([a-zA-Z0-9_-]+)/)?.[1]
      expect(token).toEqual(expect.any(String)); return token as string
    }
    const redeem = (token: string) => call(redeemPassword, "reset-password", { token, password: "Fictional-Email-Changed-2026!" })
    expect((await ask()).status).toBe(200)
    expect(recoveryMail.messages).toHaveLength(1)
    const token = tokenOf(0)
    const original = await bypass(() => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, passwordChangedAt: true, resetToken: true, resetTokenExp: true } }))
    await bypass(() => prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD CONSTRAINT identity_fixture_email_audit_fail CHECK ("organizationId" <> 'identity-email-password' OR action <> 'password_reset_by_email') NOT VALID`))
    try {
      await expect(redeem(token)).rejects.toThrow()
      expect(await bypass(() => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, passwordChangedAt: true, resetToken: true, resetTokenExp: true } }))).toEqual(original)
    } finally { await bypass(() => prisma.$executeRawUnsafe("ALTER TABLE audit_logs DROP CONSTRAINT identity_fixture_email_audit_fail")) }
    expect((await redeem(token)).status).toBe(200)
    expect((await redeem(token)).status).toBe(400)
    expect((await ask()).status).toBe(200)
    expect(recoveryMail.messages).toHaveLength(2)
    const outstanding = tokenOf(1)
    const state = () => bypass(() => prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { passwordHash: true, passwordChangedAt: true, resetToken: true, resetTokenExp: true } }))
    const before = await state()
    expect(await bcrypt.compare("Fictional-Email-Changed-2026!", before.passwordHash)).toBe(true)
    expect(before.resetToken).toBe(hashOneTimeToken(outstanding))
    await bypass(() => prisma.identityAccount.create({ data: { organizationId: company, userId, cutoverAt: new Date(), passwordHash: "!fixture-email-canonical" } }))
    expect((await redeem(outstanding)).status).toBe(400)
    recoveryMail.messages.length = 0
    expect((await ask()).status).toBe(200)
    expect(recoveryMail.messages).toHaveLength(0)
    expect(await state()).toEqual(before)
    expect((await bypass(() => prisma.organization.findUniqueOrThrow({ where: { id: company }, select: { isActive: true } }))).isActive).toBe(false)
    expect(sent).toHaveLength(0)
  })

  it("says aloud that codes cannot be sent while the template is missing — to everybody, and withdraws the code", async () => {
    await bypass(() => prisma.otpCode.updateMany({ where: { organizationId: ORG, phone: "+994501110001" }, data: { createdAt: new Date(Date.now() - 120_000) } }))
    metaAnswers = () => new Response(JSON.stringify({ error: { code: 132001, message: "Template name does not exist in the translation" } }), { status: 404 })
    const response = await ask("+994501110001")
    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe("MTM_LOGIN_CODE_UNAVAILABLE")
    // Every language was tried once.
    expect(sent.map((message) => message.body.template.language.code)).toEqual(["az", "ru", "en", "en_US"])
    const latest = await bypass(() => prisma.otpCode.findFirstOrThrow({ where: { organizationId: ORG, phone: "+994501110001" }, orderBy: { createdAt: "desc" } }))
    expect(latest.usedAt).not.toBeNull()
    // For a while, the same answer for a number nobody has: it says nothing about numbers.
    sent.length = 0
    const stranger = await ask("+994501119998")
    expect(stranger.status).toBe(503)
    expect(sent).toHaveLength(0)
  })
})
