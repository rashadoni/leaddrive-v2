/**
 * A customer's WhatsApp messages and the Service Desk tickets they land on, on a
 * real Postgres with the production row-level security.
 *
 * Found by a review on 2026-10-18, each one a wrong ticket for a real message:
 *  - a reply to a ticket `waiting` for the customer (or `escalated`) skipped
 *    it and opened a second WA- ticket;
 *  - the webhook tried to reopen an old resolved ticket BEFORE looking for an
 *    open one, so with both, the message reopened the old one — and each next
 *    message the next older one;
 *  - two deliveries from one phone at the same moment both found nothing and
 *    opened two tickets;
 *  - a reopened ticket kept its pending closure request, and the customer's
 *    old «confirm» link then closed the ticket their reply had just reopened.
 *
 * The real intake, reopen helper and public closure route run against a
 * scratch database built from schema.prisma. Every tenant table gets the
 * production `tenant_isolation` policy (scripts/rls/enable-batch-*.sql) except
 * the ones production still leaves without RLS, and the application connects
 * as a role the policies apply to: a query that loses its tenant reads nothing
 * and writes nothing, as it would in production. That matters here: the
 * per-phone lock lives in a transaction, and inside one the RLS context is
 * marked in-transaction, so global Prisma calls must be put back under the
 * tenant explicitly. Only outbound side effects (workflows, webhooks,
 * notifications, contact events, fetch) are stubbed.
 *
 * Set WHATSAPP_TICKET_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   WHATSAPP_TICKET_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («WhatsApp ticket path database gate»), where
 * `WHATSAPP_TICKET_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.WHATSAPP_TICKET_TEST_DATABASE_URL
if (!adminUrl && process.env.WHATSAPP_TICKET_DB_GATE === "required") {
  throw new Error("WHATSAPP_TICKET_TEST_DATABASE_URL is required by the WhatsApp ticket path database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.WHATSAPP_TICKET_TEST_DATABASE_URL
  if (!admin) return null
  const name = `whatsapp_ticket_${process.pid}`
  const role = `whatsapp_ticket_app_${process.pid}`
  // A password for a role that lives only as long as this scratch database.
  const password = `scratch-${process.pid}`
  const adminDb = new URL(admin)
  adminDb.pathname = `/${name}`
  const app = new URL(adminDb.toString())
  app.username = role
  app.password = password
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the database and the role exist (dynamic imports below).
  process.env.DATABASE_URL = app.toString()
  return { name, role, password, adminDbUrl: adminDb.toString() }
})

vi.mock("@/lib/workflow-engine", () => ({ executeWorkflows: vi.fn(async () => undefined) }))
vi.mock("@/lib/webhooks", () => ({ fireWebhooks: vi.fn(async () => undefined) }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/contact-events", () => ({ trackContactEvent: vi.fn(async () => undefined) }))

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")

/** Tenant tables production still has without RLS (docs/rls-rollout-runbook.md). */
const NO_RLS_IN_PRODUCTION = [
  "advisor_playbooks", "advisor_signal_snapshots", "business_hours", "channel_connections",
  "conversation_flows", "conversation_flow_runs", "leaderboard_config", "leaderboard_snapshots",
  "loyalty_redemptions", "loyalty_rewards", "message_snippets", "team_queues", "ticket_categories",
  "ticket_closure_requests",
]

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

const sql = (url: string, statement: string) => prismaCli(["db", "execute", "--url", url, "--stdin"], process.env, statement)

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "whatsapp-ticket-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const ORG = "org-wa"
const OTHER_ORG = "org-other"
const CONTACT = "contact-aysel"
const PHONE = "994501234567"

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("WhatsApp messages and their tickets on a real Postgres with RLS", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let tenant!: typeof import("@/lib/rls-context").runWithTenant
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let ensureInboundWhatsAppTicket!: typeof import("@/lib/inbox/whatsapp-inbound-ticket").ensureInboundWhatsAppTicket
  let createClosureRequest!: typeof import("@/lib/ticketing/closure-requests").createTicketClosureRequestForTicket
  let answerClosureLink!: typeof import("@/app/api/v1/public/ticket-closure/[token]/route").POST
  let sequence = 0

  beforeAll(async () => {
    sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(adminUrl!, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.adminDbUrl },
    )
    const excluded = NO_RLS_IN_PRODUCTION.map((table) => `'${table}'`).join(", ")
    sql(scratch!.adminDbUrl, `
      CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS;
      GRANT USAGE ON SCHEMA public TO "${scratch!.role}";
      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}";
      GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}";
      DO $rls$
      DECLARE t text;
      BEGIN
        FOR t IN
          SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'organizationId' AND table_name NOT IN (${excluded})
        LOOP
          EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
          EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
          EXECUTE format($policy$CREATE POLICY tenant_isolation ON public.%I
            USING ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')
            WITH CHECK ("organizationId" = current_setting('app.org_id', true) OR current_setting('app.rls_bypass', true) = 'on')$policy$, t);
        END LOOP;
      END
      $rls$;`)

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      throw new Error(`unexpected outbound request to ${String(input instanceof Request ? input.url : input)}`)
    })
    prisma = (await import("@/lib/prisma")).prisma
    ;({ runWithTenant: tenant, runWithRlsBypass: bypass } = await import("@/lib/rls-context"))
    ensureInboundWhatsAppTicket = (await import("@/lib/inbox/whatsapp-inbound-ticket")).ensureInboundWhatsAppTicket
    createClosureRequest = (await import("@/lib/ticketing/closure-requests")).createTicketClosureRequestForTicket
    answerClosureLink = (await import("@/app/api/v1/public/ticket-closure/[token]/route")).POST

    for (const id of [ORG, OTHER_ORG]) {
      await bypass(() => prisma.organization.create({ data: { id, name: `Tenant ${id}`, slug: id } }))
    }
    await bypass(() => prisma.contact.create({
      data: { id: CONTACT, organizationId: ORG, fullName: "Aysel Məmmədova", phone: `+${PHONE}` },
    }))
  }, 300_000)

  afterAll(async () => {
    vi.unstubAllGlobals()
    await prisma?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  }, 60_000)

  beforeEach(async () => {
    // Comments and closure requests go with their tickets (ON DELETE CASCADE).
    await bypass(() => prisma.ticket.deleteMany({}))
    await bypass(() => prisma.auditLog.deleteMany({}))
  })

  /** A WhatsApp ticket of Aysel's as an earlier message, or the team, left it. */
  async function seedTicket(status: string, extra: { contactId?: string | null; phone?: string } = {}) {
    const n = ++sequence
    return bypass(() => prisma.ticket.create({
      data: {
        id: `tk-${n}`,
        organizationId: ORG,
        ticketNumber: `WA-SEED-${n}`,
        subject: `Earlier question ${n}`,
        status,
        source: "whatsapp",
        tags: ["whatsapp", "inbound_whatsapp", "auto_created"],
        sourceMeta: { phone: extra.phone ?? PHONE },
        contactId: extra.contactId === undefined ? CONTACT : extra.contactId,
        requesterPhone: `+${extra.phone ?? PHONE}`,
        resolvedAt: status === "resolved" || status === "closed" ? new Date(Date.now() - 86_400_000) : null,
        closedAt: status === "closed" ? new Date(Date.now() - 86_400_000) : null,
      },
    }))
  }

  /** One inbound text, as the webhook hands it over: inside the organization's tenant scope. */
  function customerWrites(text: string, phone = PHONE, channelMessageId = `cm-${++sequence}`) {
    return tenant(ORG, () => ensureInboundWhatsAppTicket({
      organizationId: ORG,
      waPhone: phone,
      senderName: "Aysel Məmmədova",
      messageText: text,
      contactId: phone === PHONE ? CONTACT : null,
      leadId: null,
      companyId: null,
      channelMessageId,
      reopenResolved: true,
    }))
  }

  const allTickets = () => bypass(() => prisma.ticket.findMany({
    where: { organizationId: ORG },
    orderBy: { createdAt: "asc" },
    include: { comments: { orderBy: { createdAt: "asc" } }, closureRequests: true },
  }))

  const ticket = (id: string) => bypass(() => prisma.ticket.findUniqueOrThrow({
    where: { id },
    include: { comments: { orderBy: { createdAt: "asc" } }, closureRequests: true },
  }))

  /** The customer opens the link from the closure request and presses a button. */
  async function pressClosureLink(token: string, action: "confirm" | "reject") {
    const res = await answerClosureLink(new NextRequest(`http://localhost/api/v1/public/ticket-closure/${token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    }), { params: Promise.resolve({ token }) })
    expect(res.status).toBe(200)
    return (await res.json()).data as { status: string }
  }

  /** The team marks a ticket resolved: the request and its link, as the status change makes them. */
  async function requestClosure(ticketId: string) {
    const resolved = await bypass(() => prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } }))
    const request = await tenant(ORG, () => createClosureRequest({ orgId: ORG, ticket: resolved, requestedBy: null }))
    return request.token
  }

  it("runs as a role the tenant policies apply to", async () => {
    await seedTicket("open")
    expect(await tenant(OTHER_ORG, () => prisma.ticket.count())).toBe(0)
    expect(await tenant(ORG, () => prisma.ticket.count())).toBe(1)
  })

  it("puts the reply to a ticket waiting for the customer on that ticket, and hands it back to the team", async () => {
    const waiting = await seedTicket("waiting")

    const result = await customerWrites("Here is the order number: 4417")

    expect(result).toMatchObject({ ticketId: waiting.id, created: false, commentAdded: true, reopened: false })
    const tickets = await allTickets()
    expect(tickets).toHaveLength(1)
    expect(tickets[0].status).toBe("open")
    expect(tickets[0].comments.map((c: { comment: string }) => c.comment)).toEqual(["[Клиент (WhatsApp)] Here is the order number: 4417"])
    const audit = await bypass(() => prisma.auditLog.findMany({ where: { organizationId: ORG, entityId: waiting.id } }))
    expect(audit).toEqual([expect.objectContaining({
      action: "update",
      oldValue: { status: "waiting" },
      newValue: { status: "open", via: "whatsapp", reason: "customer_reply" },
    })])
  })

  it("adds a message to an escalated ticket and leaves it escalated", async () => {
    const escalated = await seedTicket("escalated")

    const result = await customerWrites("Any news?")

    expect(result).toMatchObject({ ticketId: escalated.id, created: false })
    const tickets = await allTickets()
    expect(tickets).toHaveLength(1)
    expect(tickets[0].status).toBe("escalated")
    expect(tickets[0].comments.map((c: { comment: string }) => c.comment)).toEqual(["[Клиент (WhatsApp)] Any news?"])
  })

  it("puts a message on the open ticket even when an older one of the customer's is resolved", async () => {
    const old = await seedTicket("resolved")
    const current = await seedTicket("in_progress")

    const result = await customerWrites("Still waiting for the courier")

    expect(result).toMatchObject({ ticketId: current.id, reopened: false })
    expect((await ticket(current.id)).comments.map((c: { comment: string }) => c.comment)).toEqual(["[Клиент (WhatsApp)] Still waiting for the courier"])
    const untouched = await ticket(old.id)
    expect(untouched).toMatchObject({ status: "resolved", reopenCount: 0 })
    expect(untouched.comments).toEqual([])
  })

  it("reopens the latest closed ticket once, and keeps the conversation there", async () => {
    const older = await seedTicket("closed")
    await bypass(() => prisma.ticket.update({ where: { id: older.id }, data: { updatedAt: new Date(Date.now() - 7 * 86_400_000) } }))
    const latest = await seedTicket("closed")

    const first = await customerWrites("The problem is back")
    const second = await customerWrites("It started again this morning")

    expect(first).toMatchObject({ ticketId: latest.id, reopened: true, created: false })
    expect(second).toMatchObject({ ticketId: latest.id, reopened: false, created: false })
    const reopened = await ticket(latest.id)
    expect(reopened.status).toBe("open")
    expect(reopened.reopenCount).toBe(1)
    expect(reopened.comments.map((c: { comment: string }) => c.comment)).toEqual([
      "[Клиент (WhatsApp)] The problem is back",
      "[Клиент (WhatsApp)] It started again this morning",
    ])
    expect(await ticket(older.id)).toMatchObject({ status: "closed", reopenCount: 0 })
    expect(await allTickets()).toHaveLength(2)
  })

  it("opens one ticket, not several, for messages that arrive at the same moment", async () => {
    const phone = "994551112233"
    const texts = Array.from({ length: 8 }, (_, i) => `Message ${i + 1}`)

    const results = await Promise.all(texts.map((text) => customerWrites(text, phone)))

    const tickets = (await allTickets()).filter((t: { sourceMeta: unknown }) => (t.sourceMeta as { phone?: string }).phone === phone)
    expect(tickets).toHaveLength(1)
    expect(results.filter((r) => r.created)).toHaveLength(1)
    expect(new Set(results.map((r) => r.ticketId))).toEqual(new Set([tickets[0].id]))
    expect(tickets[0].comments.map((c: { comment: string }) => c.comment).sort()).toEqual(texts.map((t) => `[Клиент (WhatsApp)] ${t}`).sort())
  })

  it("cancels the closure request when the customer's reply reopens the ticket, so the old link closes nothing", async () => {
    const resolved = await seedTicket("resolved")
    const token = await requestClosure(resolved.id)

    const reply = await customerWrites("No, it is not fixed")
    expect(reply).toMatchObject({ ticketId: resolved.id, reopened: true })
    expect((await ticket(resolved.id)).closureRequests).toEqual([
      expect.objectContaining({ status: "canceled", canceledAt: expect.any(Date), confirmedAt: null }),
    ])

    const answer = await pressClosureLink(token, "confirm")

    expect(answer.status).toBe("canceled")
    expect(await ticket(resolved.id)).toMatchObject({ status: "open", closedAt: null })
  })

  it("does not let an old link close or bounce a ticket the team has taken back", async () => {
    // A path that reopens without cancelling the request (a macro, a bulk edit):
    // the confirmation itself must notice the ticket is no longer resolved.
    const confirmLater = await seedTicket("resolved")
    const confirmToken = await requestClosure(confirmLater.id)
    const rejectLater = await seedTicket("resolved")
    const rejectToken = await requestClosure(rejectLater.id)
    await bypass(() => prisma.ticket.updateMany({ where: { id: { in: [confirmLater.id, rejectLater.id] } }, data: { status: "in_progress", resolvedAt: null } }))

    expect((await pressClosureLink(confirmToken, "confirm")).status).toBe("canceled")
    expect((await pressClosureLink(rejectToken, "reject")).status).toBe("canceled")

    expect(await ticket(confirmLater.id)).toMatchObject({ status: "in_progress", closedAt: null })
    expect(await ticket(rejectLater.id)).toMatchObject({ status: "in_progress", reopenCount: 0 })
    for (const id of [confirmLater.id, rejectLater.id]) {
      expect((await ticket(id)).closureRequests).toEqual([expect.objectContaining({ status: "canceled", confirmedAt: null, rejectedAt: null })])
    }
  })

  it("still closes a resolved ticket on confirmation, and returns one on rejection", async () => {
    const toClose = await seedTicket("resolved")
    const toReturn = await seedTicket("resolved")

    expect((await pressClosureLink(await requestClosure(toClose.id), "confirm")).status).toBe("confirmed")
    expect((await pressClosureLink(await requestClosure(toReturn.id), "reject")).status).toBe("rejected")

    expect(await ticket(toClose.id)).toMatchObject({ status: "closed", closedAt: expect.any(Date) })
    expect(await ticket(toReturn.id)).toMatchObject({ status: "open", resolvedAt: null, reopenCount: 1 })
  })
})
