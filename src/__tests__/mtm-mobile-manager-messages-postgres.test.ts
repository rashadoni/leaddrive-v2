/**
 * «Komandaya yaz» — a manager writes to the team from the phone — read off
 * the tables after the real handlers ran on a real Postgres.
 *
 * Until 2026-10-17 only the web workspace wrote to field employees. The
 * phone's entry, /api/v1/mtm/mobile/manager/messages, may reach exactly the
 * team «Komanda» shows: the manager's scope (`resolveAgentScope`), ACTIVE
 * cards, not the manager. What is asked here is what the tables hold after a
 * send, including after a refused one: a mocked Prisma answers the scope
 * queries with whatever the test hands it, so it cannot show that an employee
 * of another team — or another company — gets nothing. The last block reads
 * the employee's own inbox through the real read handler.
 *
 * The stand-ins: who is calling (the mobile token) and nothing else; push is
 * not configured in tests, so no request leaves.
 *
 * Set MTM_MANAGER_MESSAGES_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55499:5432 postgres:16
 *   MTM_MANAGER_MESSAGES_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55499/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM manager writes to the team database gate»), where
 * `MTM_MANAGER_MESSAGES_DB_GATE=required` turns a missing URL into a failure
 * so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_MANAGER_MESSAGES_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_MANAGER_MESSAGES_DB_GATE === "required") {
  throw new Error("MTM_MANAGER_MESSAGES_TEST_DATABASE_URL is required by the MTM manager messages database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_MANAGER_MESSAGES_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_manager_messages_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database exists (dynamic imports below).
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

/** Whose phone is calling. */
const caller = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))

vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  const mock = makeMobileAuthMock()
  mock.resolveMobileAuth.mockImplementation(async () => caller.current)
  return mock
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-team-messages"
const OTHER_ORG = "org-elsewhere"
const URL_TEAM = "http://localhost:3000/api/v1/mtm/mobile/manager/messages"
const URL_INBOX = "http://localhost:3000/api/v1/mtm/mobile/messages"

// The manager's team; one more team in the company that is not theirs; one
// employee who left; one card of another company.
const MANAGER = "agent-manager"
const AYSEL = "agent-aysel"
const ELVIN = "agent-elvin"
const LEFT = "agent-left"
const OTHER_TEAM = "agent-other-team"
const OTHER_COMPANY = "agent-other-company"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/**
 * The schema as `db push` can build it on any Postgres. Two knowledge-base
 * tables carry a pgvector column; the pull-request database has that extension
 * and a plain `postgres:16` does not. Nothing here reads those columns.
 */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-manager-messages-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("a manager writes to the team from the phone, on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let listTeam!: typeof import("@/app/api/v1/mtm/mobile/manager/messages/route").GET
  let send!: typeof import("@/app/api/v1/mtm/mobile/manager/messages/route").POST
  let inbox!: typeof import("@/app/api/v1/mtm/mobile/messages/route").GET
  let sequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    const route = await import("@/app/api/v1/mtm/mobile/manager/messages/route")
    listTeam = route.GET
    send = route.POST
    inbox = (await import("@/app/api/v1/mtm/mobile/messages/route")).GET

    await bypass(async () => {
      for (const id of [ORG, OTHER_ORG]) {
        await prisma.organization.create({ data: { id, name: id, slug: id, modules: { mtm: true, "route-field": true } } })
      }
      await prisma.mtmTeam.create({ data: { id: "team-mine", organizationId: ORG, name: "Mine" } })
      await prisma.mtmTeam.create({ data: { id: "team-other", organizationId: ORG, name: "Other" } })
      await prisma.mtmTeam.create({ data: { id: "team-abroad", organizationId: OTHER_ORG, name: "Abroad" } })
      await prisma.mtmAgent.createMany({
        data: [
          { id: MANAGER, organizationId: ORG, name: "Team Manager", role: "MANAGER", teamId: "team-mine" },
          { id: AYSEL, organizationId: ORG, name: "Aysel", teamId: "team-mine" },
          { id: ELVIN, organizationId: ORG, name: "Elvin", teamId: "team-mine", managerId: MANAGER },
          { id: LEFT, organizationId: ORG, name: "Left the company", teamId: "team-mine", status: "INACTIVE" },
          { id: OTHER_TEAM, organizationId: ORG, name: "Someone else's", teamId: "team-other" },
          { id: OTHER_COMPANY, organizationId: OTHER_ORG, name: "Another company", teamId: "team-abroad" },
        ],
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => callAs(MANAGER, "MANAGER"))

  function callAs(agentId: string, role: string, tenantCapabilities = { routeField: true, workforceHrm: true }) {
    caller.current = {
      orgId: ORG,
      agentId,
      userId: "",
      role,
      email: `${agentId}@example.test`,
      name: agentId === MANAGER ? "Team Manager" : "Field agent",
      tenantCapabilities,
    }
  }

  async function post(body: Record<string, unknown>) {
    const response = await send(new NextRequest(URL_TEAM, {
      method: "POST",
      headers: { Authorization: "Bearer mobile", "content-type": "application/json" },
      body: JSON.stringify({ clientMessageId: `client-message-${++sequence}`, ...body }),
    }))
    return { status: response.status, body: await response.json() as Record<string, any> }
  }

  /** Everything a send could have written, in this company and the other one. */
  async function written() {
    return bypass(async () => ({
      threads: await prisma.mtmMessageThread.count(),
      messages: await prisma.mtmMessage.count(),
      participants: await prisma.mtmMessageParticipant.count(),
      notifications: await prisma.mtmNotification.count(),
    }))
  }

  it("offers the manager's own active team, without the manager", async () => {
    const response = await listTeam(new NextRequest(URL_TEAM, { headers: { Authorization: "Bearer mobile" } }))
    expect(response.status).toBe(200)
    const body = await response.json() as { data: { recipients: Array<{ id: string }> } }
    expect(body.data.recipients.map((agent) => agent.id)).toEqual([AYSEL, ELVIN])
  })

  it("writes nothing for someone outside the team", async () => {
    const before = await written()
    for (const agentId of [OTHER_TEAM, OTHER_COMPANY, LEFT, MANAGER, "no-such-card"]) {
      const sent = await post({ to: "AGENT", agentId, body: "Hello" })
      expect({ agentId, status: sent.status, code: sent.body.code })
        .toEqual({ agentId, status: 403, code: "MTM_TEAM_MESSAGE_RECIPIENT_FORBIDDEN" })
    }
    expect(await written()).toEqual(before)
  })

  it("lets no field agent write to the team, and no tenant without Route & Field", async () => {
    const before = await written()
    callAs(AYSEL, "AGENT")
    expect((await post({ to: "TEAM", body: "Hello" })).body.code).toBe("MTM_MOBILE_CAPABILITY_REQUIRED")
    callAs(MANAGER, "MANAGER", { routeField: false, workforceHrm: true })
    expect((await post({ to: "TEAM", body: "Hello" })).body.code).toBe("TENANT_CAPABILITY_DISABLED")
    expect(await written()).toEqual(before)
  })

  it("sends to the whole team: one broadcast, one notification each, nobody else", async () => {
    const sent = await post({ to: "TEAM", body: "  Sabah saat 9:00-da <b>ofisdə</b> görüş  ", clientMessageId: "team-message-0001" })
    expect(sent.status).toBe(201)
    expect(sent.body.data.recipientCount).toBe(2)

    const thread = await bypass(() => prisma.mtmMessageThread.findUniqueOrThrow({
      where: { id: sent.body.data.threadId },
      select: {
        organizationId: true,
        type: true,
        subject: true,
        createdByAgentId: true,
        participants: { select: { agentId: true }, orderBy: { agentId: "asc" } },
        messages: { select: { senderAgentId: true, senderName: true, body: true, clientMessageId: true } },
      },
    }))
    expect(thread).toEqual({
      organizationId: ORG,
      type: "BROADCAST",
      subject: "Team Manager",
      createdByAgentId: MANAGER,
      participants: [{ agentId: AYSEL }, { agentId: ELVIN }],
      messages: [{ senderAgentId: MANAGER, senderName: "Team Manager", body: "Sabah saat 9:00-da ofisdə görüş", clientMessageId: "team-message-0001" }],
    })
    const notified = await bypass(() => prisma.mtmNotification.findMany({
      where: { metadata: { path: ["threadId"], equals: sent.body.data.threadId } },
      select: { organizationId: true, agentId: true, title: true, type: true },
      orderBy: { agentId: "asc" },
    }))
    expect(notified).toEqual([
      { organizationId: ORG, agentId: AYSEL, title: "Team Manager", type: "announcement" },
      { organizationId: ORG, agentId: ELVIN, title: "Team Manager", type: "announcement" },
    ])
    const audit = await bypass(() => prisma.mtmAuditLog.findFirst({
      where: { organizationId: ORG, entityId: sent.body.data.threadId },
      select: { agentId: true, action: true, newData: true },
    }))
    expect(audit).toEqual({
      agentId: MANAGER,
      action: "MESSAGE_BROADCAST",
      newData: { recipientAgentIds: [AYSEL, ELVIN], channel: "mobile" },
    })

    // The answer got lost and the phone sends again: the same message, not a second one.
    const before = await written()
    const again = await post({ to: "TEAM", body: "Sabah saat 9:00-da ofisdə görüş", clientMessageId: "team-message-0001" })
    expect(again.status).toBe(200)
    expect(again.body.data).toEqual({
      threadId: sent.body.data.threadId,
      messageId: sent.body.data.messageId,
      recipientCount: 2,
      replayed: true,
    })
    expect(await written()).toEqual(before)
  })

  it("refuses an empty message before writing anything", async () => {
    const before = await written()
    const sent = await post({ to: "TEAM", body: "  <p> </p>  " })
    expect({ status: sent.status, code: sent.body.code }).toEqual({ status: 400, code: "MTM_TEAM_MESSAGE_EMPTY" })
    expect(await written()).toEqual(before)
  })

  it("sends to one person in the conversation they share, and it reaches their inbox", async () => {
    const first = await post({ to: "AGENT", agentId: ELVIN, body: "Elvin, bu gün klinikaya gir" })
    const second = await post({ to: "AGENT", agentId: ELVIN, body: "Təşəkkürlər" })
    expect([first.status, second.status]).toEqual([201, 201])
    expect(second.body.data.threadId).toBe(first.body.data.threadId)

    const thread = await bypass(() => prisma.mtmMessageThread.findUniqueOrThrow({
      where: { id: first.body.data.threadId },
      select: {
        type: true,
        directKey: true,
        participants: { select: { agentId: true, role: true }, orderBy: { agentId: "asc" } },
        _count: { select: { messages: true } },
      },
    }))
    expect(thread).toEqual({
      type: "DIRECT",
      directKey: [MANAGER, ELVIN].sort().join(":"),
      participants: [{ agentId: ELVIN, role: "MEMBER" }, { agentId: MANAGER, role: "OWNER" }],
      _count: { messages: 2 },
    })
    const notified = await bypass(() => prisma.mtmNotification.findMany({
      where: { metadata: { path: ["threadId"], equals: first.body.data.threadId } },
      select: { agentId: true, type: true },
    }))
    expect(notified).toEqual([{ agentId: ELVIN, type: "message" }, { agentId: ELVIN, type: "message" }])

    // What Elvin's phone reads: the conversation, under the manager's name.
    callAs(ELVIN, "AGENT")
    const response = await inbox(new NextRequest(URL_INBOX, { headers: { Authorization: "Bearer mobile" } }))
    const read = await response.json() as { data: { threads: Array<{ id: string; type: string; title: string; unread: boolean; lastMessage: { body: string } }> } }
    const direct = read.data.threads.find((candidate) => candidate.id === first.body.data.threadId)
    expect(direct).toMatchObject({ type: "DIRECT", title: "Team Manager", unread: true, lastMessage: { body: "Təşəkkürlər" } })
    // Aysel was not written to; Elvin also has the team's broadcast from above.
    expect(read.data.threads.map((candidate) => candidate.type).sort()).toEqual(["BROADCAST", "DIRECT"])
    callAs(AYSEL, "AGENT")
    const ayselInbox = await (await inbox(new NextRequest(URL_INBOX, { headers: { Authorization: "Bearer mobile" } }))).json() as { data: { threads: Array<{ type: string }> } }
    expect(ayselInbox.data.threads.map((candidate) => candidate.type)).toEqual(["BROADCAST"])
  })
})
