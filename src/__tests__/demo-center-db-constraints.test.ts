/**
 * The demo tables' CHECK constraints against the code that writes them, on a
 * real Postgres.
 *
 * Why this exists: from 2026-09-20 to 2026-09-24 no demo link could be issued
 * on prod. Scenario grants were written with `moduleIds` = '{}', and the
 * database demanded 1..19 modules; the guided player's `journey.*` events were
 * outside the event-type allow-list. Every unit test was green, because every
 * one of them mocks Prisma — a mock accepts any row, a CHECK does not.
 *
 * Here every demo migration is replayed into a scratch database and the REAL
 * issuing path runs against it: the public form's `autoIssueDemoGrant`, which
 * calls `issueDemoGrant`, which writes the request claim, the grant, and its
 * ISSUED and SENT events. Only the e-mail provider and the sales-organisation
 * lookup (tables outside the demo migrations) are stubbed.
 *
 * Runs in CI's `static-checks` («Demo Center database constraints gate»),
 * where `DEMO_CENTER_TEST_DATABASE_URL` points at the job's Postgres service.
 * Without it the suite is skipped — and with `DEMO_CENTER_DB_GATE=required`
 * a missing URL fails instead of skipping, so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { NextRequest } from "next/server"
import { Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.DEMO_CENTER_TEST_DATABASE_URL
if (!adminUrl && process.env.DEMO_CENTER_DB_GATE === "required") {
  throw new Error("DEMO_CENTER_TEST_DATABASE_URL is required by the Demo Center database constraints gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.DEMO_CENTER_TEST_DATABASE_URL
  if (!admin) return null
  const name = `demo_center_ck_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL when first imported,
  // which happens after the scratch database exists (dynamic import below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const mail = vi.hoisted(() => ({
  sendDemoAccessEmail: vi.fn<(input: { to: string; token: string }) => Promise<{ success: boolean; messageId: string }>>(
    async () => ({ success: true, messageId: "ci-message" }),
  ),
  sendDemoRequestNotification: vi.fn<(input: { requestId: string }) => Promise<{ success: boolean; messageId: string }>>(
    async () => ({ success: true, messageId: "ci-owner" }),
  ),
}))
vi.mock("@/lib/demo-center/email", () => mail)
// The issuer lives in the sales organisation's users table, which is not a
// demo table; the grant only records the id.
vi.mock("@/lib/demo-center/sales-org", () => ({
  inDemoSalesOrganization: async () => ({ organizationId: "org-sales", value: [{ id: "user-manager", role: "manager" }] }),
  // No sales organisation configured: the lead link must say so on the request.
  resolveDemoSalesOrganization: async () => null,
}))

const ROOT = process.cwd()
const DEMO_TABLES = ['"demo_requests"', '"demo_grants"', '"demo_access_events"', '"demo_phone_verifications"', '"demo_whatsapp_threads"', '"demo_social_connections"']

// Resolved like any import, so it works from a git worktree without its own node_modules.
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function execute(url: string, args: string[], input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, "db", "execute", "--url", url, ...args], {
    input,
    encoding: "utf8",
    env: process.env,
  })
  if (result.status !== 0) {
    throw new Error(`prisma db execute ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/** Every migration that touches a demo table, in the order `migrate deploy` applies them. */
function demoMigrations(): string[] {
  const dir = path.join(ROOT, "prisma/migrations")
  return readdirSync(dir)
    .sort()
    .map((name) => path.join(dir, name, "migration.sql"))
    .filter((file) => existsSync(file) && DEMO_TABLES.some((table) => readFileSync(file, "utf8").includes(table)))
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("demo tables on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass

  beforeAll(async () => {
    // One statement per call: a multi-statement script runs as one implicit
    // transaction, and DROP/CREATE DATABASE refuse to run inside one.
    execute(adminUrl!, ["--stdin"], `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    execute(adminUrl!, ["--stdin"], `CREATE DATABASE "${scratch!.name}"`)
    const migrations = demoMigrations()
    // The first one creates the tables; a filter that found none would test nothing.
    expect(migrations.length).toBeGreaterThanOrEqual(8)
    for (const file of migrations) execute(scratch!.url, ["--file", file])
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
  }, 120_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) execute(adminUrl!, ["--stdin"], `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  async function storedRequest(email: string) {
    return bypass(() =>
      prisma.demoRequest.create({
        data: {
          name: "Nigar Əliyeva",
          company: "Xəzər Logistika MMC",
          email,
          emailNormalized: email,
          emailDomain: email.split("@")[1],
          locale: "az",
          consentAt: new Date(),
        },
        select: { id: true, name: true, company: true, email: true, emailNormalized: true, locale: true },
      }),
    )
  }

  it("issues the link the public form sends by itself: grant, ISSUED and SENT stored, request fulfilled", async () => {
    const { autoIssueDemoGrant } = await import("@/lib/demo-center/auto-issue")
    const request = await storedRequest("form@example.az")

    expect(await autoIssueDemoGrant({ request })).toBe("issued")

    const grants = await bypass(() => prisma.demoGrant.findMany({ where: { requestId: request.id } }))
    expect(grants).toHaveLength(1)
    expect(grants[0]).toMatchObject({ status: "SENT", moduleIds: [], liveCallEnabled: false })
    expect(grants[0].scenarioId).toBeTruthy()
    const events = await bypass(() => prisma.demoAccessEvent.findMany({ where: { grantId: grants[0].id }, orderBy: { occurredAt: "asc" } }))
    expect(events.map((event) => event.eventType)).toEqual(["ISSUED", "SENT"])
    const stored = await bypass(() => prisma.demoRequest.findUniqueOrThrow({ where: { id: request.id } }))
    expect(stored.status).toBe("FULFILLED")
  })

  it("issues a module playlist the admin picks, and a re-issue revokes the earlier link", async () => {
    const { issueDemoGrant } = await import("@/lib/demo-center/issue-grant")
    const { PROSPECT_TO_CLOSED_WON } = await import("@/lib/demo-center/journey")
    const request = await storedRequest("admin@example.az")
    const options = { moduleIds: ["crm", "sales"], linkValidDays: 7, sessionDurationMinutes: 120, inactivityMinutes: 30, locale: "az", liveCallEnabled: false }

    const first = await issueDemoGrant({ request, options, actorUserId: "user-admin" })
    const second = await issueDemoGrant({ request, options: { ...options, moduleIds: [], scenarioId: PROSPECT_TO_CLOSED_WON.scenarioId }, actorUserId: "user-admin" })
    if (!first.ok || !second.ok) throw new Error(`issue failed: ${JSON.stringify({ first, second })}`)

    // By id, not by time: both grants can land in the same millisecond.
    const status = async (id: string) => (await bypass(() => prisma.demoGrant.findUniqueOrThrow({ where: { id } }))).status
    expect(await status(first.grantId)).toBe("REVOKED")
    expect(await status(second.grantId)).toBe("SENT")
  })

  it("confirms an address once: the button marks the request and the owner hears about it a single time", async () => {
    // Owner, 2026-10-18: the demo opens after the prospect follows the link
    // mailed to the request's address, and only then is he told about it.
    const { autoIssueDemoGrant } = await import("@/lib/demo-center/auto-issue")
    const { POST: confirm } = await import("@/app/api/v1/public/demo-access/[token]/confirm/route")
    const request = await storedRequest("confirm@example.az")
    expect(await autoIssueDemoGrant({ request })).toBe("issued")
    const mailed = mail.sendDemoAccessEmail.mock.calls.find(([input]) => input.to === "confirm@example.az")
    if (!mailed) throw new Error("no link was mailed")
    const token = mailed[0].token

    const press = () => confirm(
      new NextRequest(`http://localhost:3000/api/v1/public/demo-access/${token}/confirm`, { method: "POST" }),
      { params: Promise.resolve({ token }) },
    )
    const toldOwner = () => mail.sendDemoRequestNotification.mock.calls.filter(([input]) => input.requestId === request.id).length

    expect(toldOwner()).toBe(0)
    expect((await press()).status).toBe(200)
    // Pressed again before the session starts — a second tab, a double click.
    expect((await press()).status).toBe(200)

    expect(toldOwner()).toBe(1)
    const stored = await bypass(() => prisma.demoRequest.findUniqueOrThrow({ where: { id: request.id } }))
    expect(stored.emailConfirmedAt).not.toBeNull()
    const grant = await bypass(() => prisma.demoGrant.findFirstOrThrow({ where: { requestId: request.id } }))
    expect(grant).toMatchObject({ status: "OTP_VERIFIED", sessionStartedAt: null })
    expect(grant.verifiedAt).not.toBeNull()
    const events = await bypass(() => prisma.demoAccessEvent.findMany({ where: { grantId: grant.id, eventType: "EMAIL_CONFIRMED" } }))
    expect(events).toHaveLength(2)
  })

  it("lets one solved bot check in once: the same solution sent again stores nothing", async () => {
    const { createHash } = await import("node:crypto")
    const { POST } = await import("@/app/api/v1/public/demo-requests/route")
    const { issueDemoFormChallenge } = await import("@/lib/demo-center/form-challenge")
    const challenge = issueDemoFormChallenge(Date.now() - 30_000)
    let number = 0
    while (createHash("sha256").update(`${challenge.salt}${number}`).digest("hex") !== challenge.challenge) number += 1
    const body = JSON.stringify({
      name: "Nigar Əliyeva",
      company: "Xəzər Logistika MMC",
      email: "replay@example.az",
      locale: "az",
      consent: true,
      challenge: { ...challenge, number },
    })
    const send = () => POST(new Request("http://localhost:3000/api/v1/public/demo-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    }))

    expect((await send()).status).toBe(201)
    expect((await send()).status).toBe(201) // the same answer, so a script learns nothing

    const rows = await bypass(() => prisma.demoRequest.findMany({ where: { emailNormalized: "replay@example.az" } }))
    expect(rows).toHaveLength(1)
    expect(rows[0].formChallengeSalt).toBe(challenge.salt)
  })

  it("still refuses a grant that is both a scenario and a playlist, or neither", async () => {
    const request = await storedRequest("invalid@example.az")
    const base = {
      requestId: request.id,
      tokenHint: "abcd",
      locale: "az",
      watermark: "ci",
      linkExpiresAt: new Date(Date.now() + 86_400_000),
      createdBy: "user-admin",
    }
    const token = (digit: string) => digit.repeat(64)
    await expect(bypass(() => prisma.demoGrant.create({ data: { ...base, tokenHash: token("a"), moduleIds: ["crm"], scenarioId: "any-scenario", scenarioVersion: 1 } }))).rejects.toThrow()
    await expect(bypass(() => prisma.demoGrant.create({ data: { ...base, tokenHash: token("b"), moduleIds: [] } }))).rejects.toThrow()
  })

  it("stores every event type the demo code writes", async () => {
    const { REPORTED_JOURNEY_EVENTS } = await import("@/lib/demo-center/journey")
    const { writtenDemoEventTypes } = await import("./helpers/demo-event-types")
    const { autoIssueDemoGrant } = await import("@/lib/demo-center/auto-issue")
    const request = await storedRequest("events@example.az")
    await autoIssueDemoGrant({ request })
    const grant = await bypass(() => prisma.demoGrant.findFirstOrThrow({ where: { requestId: request.id } }))

    const types = new Set([...writtenDemoEventTypes(), ...REPORTED_JOURNEY_EVENTS])
    expect(types.has("journey.step_completed")).toBe(true)
    const refused: string[] = []
    for (const eventType of types) {
      await bypass(() => prisma.demoAccessEvent.create({ data: { grantId: grant.id, eventType } })).catch(() => refused.push(eventType))
    }
    expect(refused).toEqual([])
  })

  /** A grant row in a given state, written straight to the table (every state CHECK applies). */
  async function grantInState(requestId: string, tokenDigit: string, state: Record<string, unknown>) {
    const now = Date.now()
    return bypass(() =>
      prisma.demoGrant.create({
        data: {
          requestId,
          tokenHash: tokenDigit.repeat(64),
          tokenHint: "abcd",
          moduleIds: [],
          scenarioId: "prospect-to-closed-won",
          scenarioVersion: 1,
          locale: "az",
          watermark: "ci",
          linkExpiresAt: new Date(now + 7 * 86_400_000),
          createdBy: "user-admin",
          ...state,
        },
      }),
    )
  }

  function session(lastSeenMinutesAgo: number, hashDigit: string) {
    const now = Date.now()
    return {
      status: "ACTIVE",
      sessionHash: hashDigit.repeat(64), // unique per grant
      sessionStartedAt: new Date(now - 90 * 60_000),
      sessionLastSeenAt: new Date(now - lastSeenMinutesAgo * 60_000),
      sessionExpiresAt: new Date(now + 60 * 60_000),
      inactivityMinutes: 30,
      verifiedAt: new Date(now - 95 * 60_000),
    }
  }

  it("counts a walked-through story as completed, and a tab closed an hour ago as no longer active", async () => {
    const { demoCenterCounters } = await import("@/lib/demo-center/admin-counters")
    const before = await demoCenterCounters()
    // One live grant per request (a unique index), so one request each.
    const requestFor = async (tag: string) => (await storedRequest(`counters-${tag}@example.az`)).id

    await grantInState(await requestFor("now"), "1", session(2, "1")) // on the screen right now
    await grantInState(await requestFor("idle"), "2", session(65, "2")) // idle past its 30 minutes, not yet swept
    const walked = await grantInState(await requestFor("walked"), "3", session(1, "3"))
    await bypass(() => prisma.demoAccessEvent.create({ data: { grantId: walked.id, eventType: "journey.completed" } }))
    await grantInState(await requestFor("module"), "4", { status: "COMPLETED", completedAt: new Date() }) // the module player's ending

    const after = await demoCenterCounters()
    expect(after.activeSessions - before.activeSessions).toBe(2)
    expect(after.completed - before.completed).toBe(2)
  })

  it("keeps one WhatsApp thread per grant, for an Azerbaijani mobile, with the code the demo page shows", async () => {
    const { demoWhatsAppCode } = await import("@/lib/demo-center/demo-whatsapp")
    const grant = await grantInState((await storedRequest("whatsapp-thread@example.az")).id, "6", session(1, "6"))
    const thread = (data: Record<string, unknown>) =>
      bypass(() => prisma.demoWhatsAppThread.create({ data: { grantId: grant.id, phoneE164: "+994501234567", code: demoWhatsAppCode(grant.id), ...data } }))

    await expect(thread({ grantId: grant.id, phoneE164: "+79161234567" })).rejects.toThrow() // not an Azerbaijani mobile
    await expect(thread({ code: "LD-zz" })).rejects.toThrow() // not a code the page could show
    await expect(thread({ expiresAt: new Date() })).rejects.toThrow() // a day to answer in, without the proof
    await expect(thread({ closedAt: new Date() })).rejects.toThrow() // closed, and no one knows why
    await expect(thread({ aiReplies: 51 })).rejects.toThrow()

    const stored = await thread({})
    expect(stored.code).toMatch(/^LD-[0-9A-F]{6}$/)
    await expect(thread({})).rejects.toThrow() // one thread per grant
    // The agent's claim on a reply: counted in the row, never past the cap the code checks.
    const claimed = await bypass(() =>
      prisma.demoWhatsAppThread.updateMany({ where: { id: stored.id, aiReplies: { lt: 10 } }, data: { aiReplies: { increment: 1 }, lastAiReplyAt: new Date() } }),
    )
    expect(claimed.count).toBe(1)

    // The thread goes with its grant.
    await bypass(() => prisma.demoGrant.delete({ where: { id: grant.id } }))
    expect(await bypass(() => prisma.demoWhatsAppThread.count({ where: { id: stored.id } }))).toBe(0)
  })

  it("keeps the demo's ticket on a proven thread in ticket mode, and one ticket to one thread", async () => {
    const { demoWhatsAppCode } = await import("@/lib/demo-center/demo-whatsapp")
    const make = async (tag: string, digit: string) => {
      const grant = await grantInState((await storedRequest(`ticket-${tag}@example.az`)).id, digit, session(1, digit))
      return bypass(() => prisma.demoWhatsAppThread.create({ data: { grantId: grant.id, phoneE164: "+994701234567", code: demoWhatsAppCode(grant.id) } }))
    }
    const thread = await make("a", "9")
    const set = (data: Record<string, unknown>) => bypass(() => prisma.demoWhatsAppThread.update({ where: { id: thread.id }, data }))
    await expect(set({ ticketModeAt: new Date() })).rejects.toThrow() // not proven yet
    await set({ provenAt: new Date() })
    await expect(set({ ticketId: "ticket-1" })).rejects.toThrow() // a ticket without the press
    await set({ ticketModeAt: new Date(), ticketId: "ticket-1" })
    const other = await make("b", "c")
    await bypass(() => prisma.demoWhatsAppThread.update({ where: { id: other.id }, data: { provenAt: new Date(), ticketModeAt: new Date() } }))
    await expect(bypass(() => prisma.demoWhatsAppThread.update({ where: { id: other.id }, data: { ticketId: "ticket-1" } }))).rejects.toThrow()
  })

  it("holds a prospect's Facebook Page connection to what the release can undo", async () => {
    const { encryptToken } = await import("@/lib/secure-token")
    const { demoSocialCode, demoSocialTokenPurpose } = await import("@/lib/demo-center/demo-social-connection")
    const grant = await grantInState((await storedRequest("social-page@example.az")).id, "d", session(1, "d"))
    const now = new Date()
    let seq = 0
    const connection = (data: Record<string, unknown> = {}) => {
      seq += 1
      const id = `social-${seq}`
      return bypass(() =>
        prisma.demoSocialConnection.create({
          data: {
            id, grantId: grant.id, appConfigId: "cc-meta-app", code: demoSocialCode(grant.id),
            createdAt: now, expiresAt: new Date(now.getTime() + 8 * 3_600_000),
            ...data,
          },
        }),
      )
    }
    const cipher = (kind: "user" | "page") => encryptToken("EAAG-token", demoSocialTokenPurpose("social-x", kind))
    const wiped = { scrubbedAt: now, releaseRequestedAt: now, releaseReason: "day_over", unsubscribeOutcome: "removed", grantRevokeOutcome: "kept_by_design" }

    await expect(connection({ userTokenCipher: "EAAG-plaintext" })).rejects.toThrow() // a token that is not ciphertext
    await expect(connection({ pageTokenCipher: "EAAG-plaintext", pageId: "123" })).rejects.toThrow()
    await expect(connection({ pageTokenCipher: cipher("page") })).rejects.toThrow() // a Page token without its Page
    await expect(connection({ pageId: "../me" })).rejects.toThrow() // not a Page id
    await expect(connection({ pageId: "123", linkedInstagramId: "ig-account" })).rejects.toThrow() // not Meta's number
    await expect(connection({ ...wiped, pageId: "123" })).rejects.toThrow() // wiped, and still naming the Page
    await expect(connection({ ...wiped, userTokenCipher: cipher("user") })).rejects.toThrow() // wiped, and still holding a token
    await expect(connection({ ...wiped, linkedInstagramId: "17841400000000001" })).rejects.toThrow() // wiped, and still naming the Instagram account
    await expect(connection({ ...wiped, grantRevokeOutcome: null })).rejects.toThrow() // wiped, and no record of what became of the grant
    await expect(connection({ ...wiped, unsubscribeOutcome: null })).rejects.toThrow() // wiped, and no one knows what Meta answered
    await expect(connection({ expiresAt: new Date(now.getTime() + 25 * 3_600_000) })).rejects.toThrow() // more than a day
    await expect(connection({ releaseRequestedAt: now, releaseReason: "bored" })).rejects.toThrow() // a reason the code does not have
    await expect(connection({ releaseReason: "day_over" })).rejects.toThrow() // a reason with no moment the release was asked for
    await expect(connection({ unsubscribeOutcome: "maybe" })).rejects.toThrow()
    await expect(connection({ grantRevokeOutcome: "maybe" })).rejects.toThrow()
    await expect(connection({ grantRevokeOutcome: "revoked" })).rejects.toThrow() // the release never revokes the person's grant
    await expect(connection({ grantRevokeOutcome: "kept_shared" })).rejects.toThrow()
    await expect(connection({ aiReplies: 21 })).rejects.toThrow()
    await expect(connection({ releaseError: "meta_190: Error validating access token for Nigar" })).rejects.toThrow() // Meta's text
    await expect(connection({ code: "LD-zz" })).rejects.toThrow()
    await expect(connection({ platform: "instagram" })).rejects.toThrow() // not yet

    const live = await connection({
      pageId: "123", linkedInstagramId: "17841400000000001", pageTokenCipher: cipher("page"), userTokenCipher: cipher("user"),
      releaseError: "meta_190_460", pendingPages: [{ id: "123", name: "Xəzər" }],
    })
    await expect(connection()).rejects.toThrow() // a second live connection for the same grant
    const other = await grantInState((await storedRequest("social-page-2@example.az")).id, "e", session(1, "e"))
    await expect(connection({ grantId: other.id, pageId: "123" })).rejects.toThrow() // a second live connection for the same Page

    // Once the first one is wiped, the Page and the grant are free again.
    await bypass(() =>
      prisma.demoSocialConnection.update({
        where: { id: live.id },
        data: { ...wiped, pageId: null, linkedInstagramId: null, pageTokenCipher: null, userTokenCipher: null, pendingPages: Prisma.DbNull },
      }),
    )
    const again = await connection({ grantId: other.id, pageId: "123" })
    await connection({ ...wiped, grantId: null, grantRevokeOutcome: "no_token" }) // a wiped row that never held a user token
    await connection()

    // A message once: Meta's repeated delivery is refused, and the text has a limit.
    await bypass(() => prisma.demoSocialMessage.create({ data: { connectionId: again.id, direction: "inbound", text: "Salam", externalId: "m_1" } }))
    await expect(bypass(() => prisma.demoSocialMessage.create({ data: { connectionId: again.id, direction: "inbound", text: "Salam", externalId: "m_1" } }))).rejects.toThrow()
    await expect(bypass(() => prisma.demoSocialMessage.create({ data: { connectionId: again.id, direction: "inbound", text: "x".repeat(1001) } }))).rejects.toThrow()
    await expect(bypass(() => prisma.demoSocialMessage.create({ data: { connectionId: again.id, direction: "sideways", text: "x" } }))).rejects.toThrow()

    // Deleting the grant keeps the connection, so its binding at Meta can still be undone.
    await bypass(() => prisma.demoGrant.delete({ where: { id: other.id } }))
    const kept = await bypass(() => prisma.demoSocialConnection.findUniqueOrThrow({ where: { id: again.id } }))
    expect(kept.grantId).toBeNull()
    expect(kept.pageId).toBe("123")
    expect(await bypass(() => prisma.demoSocialMessage.count({ where: { connectionId: again.id } }))).toBe(1)
  })

  it("stores the Page connection's events in the access trail", async () => {
    const { autoIssueDemoGrant } = await import("@/lib/demo-center/auto-issue")
    const request = await storedRequest("social-events@example.az")
    await autoIssueDemoGrant({ request })
    const grant = await bypass(() => prisma.demoGrant.findFirstOrThrow({ where: { requestId: request.id } }))
    for (const eventType of ["SOCIAL_CONNECTED", "SOCIAL_PROVEN", "SOCIAL_AI_REPLIED", "SOCIAL_RELEASED", "SOCIAL_RELEASE_INCOMPLETE"]) {
      await bypass(() => prisma.demoAccessEvent.create({ data: { grantId: grant.id, eventType } }))
    }
    await expect(bypass(() => prisma.demoAccessEvent.create({ data: { grantId: grant.id, eventType: "SOCIAL_SOMETHING" } }))).rejects.toThrow()
  })

  it("decides a welcome under one lock: a phone's week holds across demos, and a failed send gives the claim back", async () => {
    const { sendDemoWhatsAppWelcome } = await import("@/lib/demo-center/demo-whatsapp")
    const phone = "+994551234567"
    const welcome = async (tag: string, digit: string) => {
      const grant = await grantInState((await storedRequest(`welcome-${tag}@example.az`)).id, digit, { ...session(1, digit), liveCallEnabled: true })
      const result = await sendDemoWhatsAppWelcome({ grant, requestPhone: phone, requestName: "Nigar Əliyeva", consent: true })
      const row = await bypass(() => prisma.demoWhatsAppThread.findUniqueOrThrow({ where: { grantId: grant.id } }))
      return { result, row }
    }
    // No sales line in this database: the send fails, and the claim is given back.
    const first = await welcome("a", "7")
    expect(first.result).toEqual({ ok: false, code: "failed" })
    expect(first.row.welcomeSentAt).toBeNull()

    // A welcome that went to this phone yesterday holds its week for every other demo.
    await bypass(() => prisma.demoWhatsAppThread.update({ where: { id: first.row.id }, data: { welcomeSentAt: new Date(Date.now() - 86_400_000) } }))
    const second = await welcome("b", "8")
    expect(second.result).toEqual({ ok: false, code: "cooldown" })
    expect(second.row.welcomeSentAt).toBeNull()
  })

  it("records on a fresh request that no sales organisation is configured for its lead", async () => {
    const { ensureDemoProspectLead } = await import("@/lib/demo-center/prospect-lead")
    const request = await storedRequest("lead-link@example.az")
    await grantInState(request.id, "5", session(1, "5"))

    expect(await ensureDemoProspectLead(request.id)).toEqual({ status: "UNCONFIGURED" })
    const stored = await bypass(() => prisma.demoRequest.findUniqueOrThrow({ where: { id: request.id } }))
    expect(stored.leadLinkStatus).toBe("UNCONFIGURED")
  })
})
