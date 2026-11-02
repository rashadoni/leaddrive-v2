/**
 * The demo's real Service Desk ticket, read back for the demo page on a real
 * Postgres with the product's row-level security on `tickets` and an
 * application role that cannot bypass it.
 *
 * Owner, 2026-10-18: the WhatsApp connection works for ticketing in the demo,
 * a ticket opening only on the prospect's own press. The demo page shows that
 * ticket — read through the one door into the sales organisation
 * (src/lib/demo-center/sales-org.ts) by the id the demo's thread keeps. Under
 * FORCE RLS a read outside that door returns nothing at all, silently; a mock
 * would accept any read, so this runs the real `demoWhatsAppState` against
 * real rows.
 *
 * Set DEMO_WHATSAPP_TICKET_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   DEMO_WHATSAPP_TICKET_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («Demo WhatsApp ticket database gate»), where
 * `DEMO_WHATSAPP_TICKET_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.DEMO_WHATSAPP_TICKET_TEST_DATABASE_URL
if (!adminUrl && process.env.DEMO_WHATSAPP_TICKET_DB_GATE === "required") {
  throw new Error("DEMO_WHATSAPP_TICKET_TEST_DATABASE_URL is required by the demo WhatsApp ticket database gate")
}

const SALES = "org-demo-sales"
const OTHER = "org-other-tenant"

const scratch = vi.hoisted(() => {
  const admin = process.env.DEMO_WHATSAPP_TICKET_TEST_DATABASE_URL
  if (!admin) return null
  const name = `demo_wa_ticket_${process.pid}`
  const role = `demo_wa_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  process.env.DEMO_LEAD_ORGANIZATION_ID = "org-demo-sales"
  return { name, role, password, adminScratch: adminScratch.toString() }
})

// Meta's API is not called: the sender is the sales organisation's own number.
vi.mock("@/lib/demo-center/whatsapp-number", () => ({
  demoWhatsAppSender: async () => ({
    organizationId: "org-demo-sales",
    channelConfigId: "cc-sales",
    phoneNumberId: "100200300",
    waNumber: "994105313065",
    displayNumber: "+994 10 531 30 65",
  }),
  demoWhatsAppConversationId: async () => null,
}))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

function sql(url: string, statement: string) {
  prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)
}

/** The schema as `db push` can build it on any Postgres: the pgvector columns are left out (nothing here reads them). */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "demo-wa-ticket-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const PHONE = "+994501234567"

describe.skipIf(!scratch)("the demo's WhatsApp ticket on a real Postgres under row-level security", () => {
  let admin!: PrismaClient
  let app!: typeof import("@/lib/prisma").prisma
  let grant!: { id: string; createdAt: Date; status: string; liveCallEnabled: boolean; liveWhatsAppEnabled: boolean; sessionExpiresAt: Date | null }

  beforeAll(async () => {
    const control = adminUrl!
    sql(control, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(control, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    // The product's own policy on tickets (prisma/migrations/20260709120000_rls_tickets).
    sql(scratch!.adminScratch, readFileSync(path.join(ROOT, "prisma/migrations/20260709120000_rls_tickets/migration.sql"), "utf8"))
    sql(control, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(control, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)

    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    await admin.organization.createMany({ data: [{ id: SALES, name: "LeadDrive Inc.", slug: "leaddrive" }, { id: OTHER, name: "Other", slug: "other" }] })
    const now = Date.now()
    const request = await admin.demoRequest.create({
      data: { name: "Nigar Əliyeva", company: "Xəzər Logistika MMC", email: "nigar@example.az", emailNormalized: "nigar@example.az", emailDomain: "example.az", phone: PHONE, locale: "az", consentAt: new Date() },
    })
    grant = await admin.demoGrant.create({
      data: {
        requestId: request.id, tokenHash: "a".repeat(64), tokenHint: "abcd", moduleIds: [], scenarioId: "prospect-to-closed-won", scenarioVersion: 1,
        locale: "az", watermark: "ci", linkExpiresAt: new Date(now + 7 * 86_400_000), createdBy: "user-admin",
        status: "ACTIVE", sessionHash: "b".repeat(64), sessionStartedAt: new Date(now - 60_000), sessionLastSeenAt: new Date(now),
        sessionExpiresAt: new Date(now + 3_600_000), inactivityMinutes: 30, verifiedAt: new Date(now - 60_000), liveWhatsAppEnabled: true,
      },
      select: { id: true, createdAt: true, status: true, liveCallEnabled: true, liveWhatsAppEnabled: true, sessionExpiresAt: true },
    })
    app = (await import("@/lib/prisma")).prisma
  }, 240_000)

  afterAll(async () => {
    await app?.$disconnect()
    await admin?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  async function ticket(organizationId: string, number: string) {
    const row = await admin.ticket.create({
      data: { organizationId, ticketNumber: number, subject: "[WhatsApp müraciəti] Kassa çeki çap etmir", status: "open", tags: ["whatsapp", "demo", "demo_whatsapp"] },
      select: { id: true },
    })
    // One after another, as the webhook writes them.
    const at = Date.now() - 60_000
    await admin.ticketComment.createMany({
      data: [
        { ticketId: row.id, comment: "[Клиент (WhatsApp)] Kassa çeki çap etmir", isInternal: false, createdAt: new Date(at) },
        { ticketId: row.id, comment: "Müştəri VIP-dir, tez baxın", isInternal: true, userId: "agent-1", createdAt: new Date(at + 1_000) },
        { ticketId: row.id, comment: "[Da Vinci Bot] Printer siyahıda görünürmü?", isInternal: false, createdAt: new Date(at + 2_000) },
      ],
    })
    return row.id
  }

  async function threadOn(ticketId: string | null) {
    await admin.demoWhatsAppThread.deleteMany({ where: { grantId: grant.id } })
    const { demoWhatsAppCode } = await import("@/lib/demo-center/demo-whatsapp")
    const now = Date.now()
    await admin.demoWhatsAppThread.create({
      data: {
        grantId: grant.id, phoneE164: PHONE, code: demoWhatsAppCode(grant.id),
        provenAt: new Date(now - 120_000), expiresAt: new Date(now + 3_600_000), ticketModeAt: new Date(now - 60_000), ticketId,
      },
    })
  }

  it("enforces the policy for the application's role: with no tenant context, tickets are not there at all", async () => {
    await ticket(SALES, "WA-0901")
    // A raw count with no context: the guard only warns on raw queries, the database answers.
    const rows = await app.$queryRaw<{ count: bigint }[]>`SELECT count(*)::bigint AS count FROM tickets`
    expect(Number(rows[0].count)).toBe(0)
  })

  it("reads the demo's ticket through the sales organisation's door, in its customer's view", async () => {
    const id = await ticket(SALES, "WA-0902")
    await threadOn(id)
    const { demoWhatsAppState } = await import("@/lib/demo-center/demo-whatsapp")
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE, company: "Xəzər Logistika MMC" })
    expect(state.ticketMode).toBe(true)
    expect(state.ticket).toMatchObject({ number: "WA-0902", status: "open" })
    expect(state.ticket!.subject).not.toContain("[WhatsApp")
    // The internal note is not the customer's to see; the prefixes are the team's.
    expect(state.ticket!.messages.map((message) => [message.author, message.text])).toEqual([
      ["customer", "Kassa çeki çap etmir"],
      ["assistant", "Printer siyahıda görünürmü?"],
    ])
    expect(state.ticket!.messageCount).toBe(2)
    expect(JSON.stringify(state.ticket)).not.toMatch(/agent-1|VIP|994501234567/)
  })

  it("never shows another organisation's ticket, whatever id the thread holds", async () => {
    const foreign = await ticket(OTHER, "WA-0903")
    await threadOn(foreign)
    const { demoWhatsAppState } = await import("@/lib/demo-center/demo-whatsapp")
    const state = await demoWhatsAppState({ grant, requestPhone: PHONE })
    expect(state.ticket).toBeNull()
  })

  it("starts ticket mode once, on the proven thread", async () => {
    await threadOn(null)
    await admin.demoWhatsAppThread.updateMany({ where: { grantId: grant.id }, data: { ticketModeAt: null } })
    const { startDemoWhatsAppTicketMode } = await import("@/lib/demo-center/demo-whatsapp")
    const first = await startDemoWhatsAppTicketMode({ grant, requestPhone: PHONE })
    expect(first.ok).toBe(true)
    const row = await admin.demoWhatsAppThread.findUniqueOrThrow({ where: { grantId: grant.id } })
    expect(row.ticketModeAt).not.toBeNull()
    await startDemoWhatsAppTicketMode({ grant, requestPhone: PHONE })
    expect((await admin.demoWhatsAppThread.findUniqueOrThrow({ where: { grantId: grant.id } })).ticketModeAt).toEqual(row.ticketModeAt)
  })
})
