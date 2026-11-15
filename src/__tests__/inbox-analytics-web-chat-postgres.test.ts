/**
 * The website chat in the inbox's two reports, on a real Postgres (2026-11-15).
 *
 * The «Bu gün» card in the inbox's folder rail and the trend / first-reply blocks of
 * /inbox/analytics read `analytics/temporal` and `analytics/frt`. Both read channel_messages and
 * social_conversations only, but the website chat keeps its messages in web_chat_messages —
 * nothing copies them into channel_messages — so its visitors were never counted. The routes now
 * read the two tables together; this runs the routes' own SQL through Prisma against Postgres:
 *
 *  - temporal: the visitor's messages are inbound, the bot's and the operators' outbound, an
 *    unknown role neither; `?tz=` moves a late-evening message to the next local day; `?from=` /
 *    `?to=` cut both tables; `?channel=whatsapp` drops the website chat, `?channel=web-chat` keeps
 *    only it; the heatmap counts the visitor's messages at their UTC hour.
 *  - frt: each session is one conversation — first visitor message → first bot/operator message
 *    at or after it (a greeting sent before the visitor wrote is not a reply); a session nobody
 *    wrote in is no conversation; `?agent=` is the session's assignee; another channel drops it.
 *  - Another organization's rows count for nobody else, and its own numbers include its chat.
 *  - With `?channel=whatsapp` both reports answer exactly what they answered before the website
 *    chat was added — the other channels' figures do not move.
 *
 * The tables carry only the columns the routes read, with the production types (`timestamp(3)`).
 * Set INBOX_ANALYTICS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55497:5432 postgres:16
 *   INBOX_ANALYTICS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55497/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the deploy («Inbox
 * analytics website chat database gate»), where INBOX_ANALYTICS_DB_GATE=required turns a missing
 * URL into a failure.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { Prisma, PrismaClient } from "@prisma/client"

const adminUrl = process.env.INBOX_ANALYTICS_TEST_DATABASE_URL
if (!adminUrl && process.env.INBOX_ANALYTICS_DB_GATE === "required") {
  throw new Error("INBOX_ANALYTICS_TEST_DATABASE_URL is required by the inbox analytics website chat database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.INBOX_ANALYTICS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `inbox_analytics_web_chat_${process.pid}_${Date.now()}`
  const db = new URL(admin)
  db.pathname = `/${name}`
  // No tenant data keys to preload: the routes read no encrypted column.
  delete process.env.TENANT_PII_MASTER_KEY
  return { name, url: db.toString() }
})

const auth = vi.hoisted(() => ({ orgId: "org-a" }))

// The routes' prisma is a plain client on the scratch database: the SQL is what is under test.
vi.mock("@/lib/prisma", async () => {
  if (!scratch) return { prisma: {} }
  const client = await import("@prisma/client")
  return { prisma: new client.PrismaClient<client.Prisma.PrismaClientOptions>({ datasourceUrl: scratch.url }) }
})
vi.mock("@/lib/api-auth", () => ({
  getOrgId: vi.fn(async () => auth.orgId),
  getSession: vi.fn().mockResolvedValue(null),
  requireAuth: vi.fn(async () => ({ orgId: auth.orgId, userId: "u-admin", role: "admin", email: "", name: "" })),
  requireSessionAuth: vi.fn(async () => ({ orgId: auth.orgId, userId: "u-admin", role: "admin", email: "", name: "" })),
  isAuthError: (value: unknown) => value instanceof Response,
}))

import { GET as temporalGET } from "@/app/api/v1/inbox/analytics/temporal/route"
import { GET as frtGET } from "@/app/api/v1/inbox/analytics/frt/route"
import { prisma } from "@/lib/prisma"

type Trend = { date: string; inbound: number; outbound: number }[]

async function temporal(query: string, orgId = "org-a"): Promise<{ trend: Trend; heatmap: number[][] }> {
  auth.orgId = orgId
  const res = await temporalGET(new NextRequest(`http://localhost/api/v1/inbox/analytics/temporal?${query}`))
  expect(res.status).toBe(200)
  return (await res.json()).data
}

async function frt(query: string, orgId = "org-a") {
  auth.orgId = orgId
  const res = await frtGET(new NextRequest(`http://localhost/api/v1/inbox/analytics/frt?${query}`))
  expect(res.status).toBe(200)
  return (await res.json()).data as {
    conversations: number; answered: number; unanswered: number
    medianMinutes: number | null; avgMinutes: number | null
    sla: { slaMetPct: number; distribution: { label: string; count: number }[] }
    aging: { total: number }
  }
}

const FROM = "from=2026-11-05T00:00:00.000Z"

;(scratch ? describe : describe.skip)("inbox analytics with the website chat, on a real Postgres", () => {
  let admin!: PrismaClient
  let created = false

  beforeAll(async () => {
    admin = new PrismaClient<Prisma.PrismaClientOptions>({ datasourceUrl: adminUrl })
    await admin.$executeRawUnsafe(`CREATE DATABASE "${scratch!.name}"`)
    created = true
    const db = prisma as unknown as PrismaClient
    for (const statement of [
      `CREATE TABLE social_conversations (
         id text PRIMARY KEY, "organizationId" text NOT NULL, platform text NOT NULL,
         metadata jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'open', "assignedTo" text,
         "createdAt" timestamp(3) NOT NULL, "lastMessageAt" timestamp(3) NOT NULL)`,
      `CREATE TABLE channel_messages (
         id text PRIMARY KEY, "organizationId" text NOT NULL, direction text NOT NULL, "channelType" text,
         "conversationId" text REFERENCES social_conversations(id), "createdAt" timestamp(3) NOT NULL)`,
      `CREATE TABLE web_chat_sessions (
         id text PRIMARY KEY, "organizationId" text NOT NULL, status text NOT NULL DEFAULT 'open',
         "assignedUserId" text, "createdAt" timestamp(3) NOT NULL, "lastMessageAt" timestamp(3) NOT NULL)`,
      `CREATE TABLE web_chat_messages (
         id text PRIMARY KEY, "organizationId" text NOT NULL,
         "sessionId" text NOT NULL REFERENCES web_chat_sessions(id), "fromRole" text NOT NULL,
         text text NOT NULL DEFAULT '', "createdAt" timestamp(3) NOT NULL)`,
      // A WhatsApp conversation: in 10:00, out 10:04 — four minutes.
      `INSERT INTO social_conversations (id, "organizationId", platform, "createdAt", "lastMessageAt") VALUES
         ('conv-wa', 'org-a', 'whatsapp', '2026-11-10 09:59:00', '2026-11-10 10:04:00')`,
      `INSERT INTO channel_messages (id, "organizationId", direction, "channelType", "conversationId", "createdAt") VALUES
         ('cm-1', 'org-a', 'inbound',  'whatsapp',  'conv-wa', '2026-11-10 10:00:00'),
         ('cm-2', 'org-a', 'outbound', 'whatsapp',  'conv-wa', '2026-11-10 10:04:00'),
         ('cm-3', 'org-a', 'inbound',  'instagram', NULL,      '2026-11-11 09:00:00'),
         ('cm-b', 'org-b', 'inbound',  'whatsapp',  NULL,      '2026-11-10 10:00:00')`,
      `INSERT INTO web_chat_sessions (id, "organizationId", "assignedUserId", "createdAt", "lastMessageAt") VALUES
         ('ws-1',   'org-a', NULL,      '2026-11-10 09:58:30', '2026-11-10 10:02:00'),
         ('ws-2',   'org-a', 'u-agent', '2026-11-10 10:59:00', '2026-11-10 11:20:00'),
         ('ws-3',   'org-a', NULL,      '2026-11-10 21:29:00', '2026-11-10 21:30:00'),
         ('ws-4',   'org-a', NULL,      '2026-11-10 12:00:00', '2026-11-10 12:00:00'),
         ('ws-old', 'org-a', NULL,      '2026-11-01 10:00:00', '2026-11-01 10:05:00'),
         ('ws-b',   'org-b', NULL,      '2026-11-10 10:00:00', '2026-11-10 10:00:10')`,
      `INSERT INTO web_chat_messages (id, "organizationId", "sessionId", "fromRole", "createdAt") VALUES
         ('w1-greet', 'org-a', 'ws-1',   'bot',     '2026-11-10 09:59:00'),
         ('w1-in',    'org-a', 'ws-1',   'visitor', '2026-11-10 10:00:00'),
         ('w1-out',   'org-a', 'ws-1',   'bot',     '2026-11-10 10:01:00'),
         ('w1-other', 'org-a', 'ws-1',   'system',  '2026-11-10 10:02:00'),
         ('w2-in',    'org-a', 'ws-2',   'visitor', '2026-11-10 11:00:00'),
         ('w2-out',   'org-a', 'ws-2',   'agent',   '2026-11-10 11:20:00'),
         ('w3-in',    'org-a', 'ws-3',   'visitor', '2026-11-10 21:30:00'),
         ('w4-greet', 'org-a', 'ws-4',   'bot',     '2026-11-10 12:00:00'),
         ('wo-in',    'org-a', 'ws-old', 'visitor', '2026-11-01 10:00:00'),
         ('wo-out',   'org-a', 'ws-old', 'agent',   '2026-11-01 10:05:00'),
         ('wb-in',    'org-b', 'ws-b',   'visitor', '2026-11-10 10:00:00'),
         ('wb-out',   'org-b', 'ws-b',   'bot',     '2026-11-10 10:00:10')`,
    ]) await db.$executeRawUnsafe(statement)
  }, 60_000)

  afterAll(async () => {
    await (prisma as unknown as PrismaClient).$disconnect()
    if (created) await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    await admin?.$disconnect()
  })

  describe("temporal", () => {
    it("counts the visitor's messages in, the bot's and operators' out, on UTC days", async () => {
      const { trend } = await temporal(FROM)
      expect(trend).toEqual([
        // WhatsApp 1 in / 1 out + chat: visitors 10:00, 11:00, 21:30; greeting, bot, operator, greeting.
        { date: "2026-11-10", inbound: 4, outbound: 5 },
        { date: "2026-11-11", inbound: 1, outbound: 0 },
      ])
    })

    it("puts a 21:30 UTC visitor on the next Baku day with ?tz=", async () => {
      const { trend } = await temporal(`${FROM}&tz=Asia%2FBaku`)
      expect(trend).toEqual([
        { date: "2026-11-10", inbound: 3, outbound: 5 },
        { date: "2026-11-11", inbound: 2, outbound: 0 },
      ])
    })

    it("cuts the website chat by ?from= and ?to= as well", async () => {
      expect((await temporal("")).trend[0]).toEqual({ date: "2026-11-01", inbound: 1, outbound: 1 })
      const { trend } = await temporal("from=2026-11-10T10:30:00.000Z&to=2026-11-10T22:00:00.000Z")
      expect(trend).toEqual([{ date: "2026-11-10", inbound: 2, outbound: 2 }])
    })

    it("keeps the website chat out of another channel and alone in its own", async () => {
      expect((await temporal(`${FROM}&channel=whatsapp`)).trend).toEqual([
        { date: "2026-11-10", inbound: 1, outbound: 1 },
      ])
      expect((await temporal(`${FROM}&channel=web-chat`)).trend).toEqual([
        { date: "2026-11-10", inbound: 3, outbound: 4 },
      ])
    })

    it("puts the visitors on the heatmap at their UTC hour", async () => {
      const { heatmap } = await temporal(FROM)
      // 2026-11-10 is a Tuesday (2), 2026-11-11 a Wednesday (3).
      expect(heatmap[2][10]).toBe(2) // WhatsApp + the chat visitor
      expect(heatmap[2][11]).toBe(1)
      expect(heatmap[2][21]).toBe(1)
      expect(heatmap[3][9]).toBe(1)
      expect(heatmap.flat().reduce((a, b) => a + b, 0)).toBe(5)
    })

    it("answers each organization with its own rows", async () => {
      expect((await temporal(FROM, "org-b")).trend).toEqual([
        { date: "2026-11-10", inbound: 2, outbound: 1 },
      ])
    })
  })

  describe("frt", () => {
    it("adds each chat session with a visitor as one conversation", async () => {
      const d = await frt(FROM)
      // WhatsApp 4 min; chat 1 min (the greeting before the visitor is not a reply), 20 min, unanswered.
      expect(d).toMatchObject({ conversations: 4, answered: 3, unanswered: 1, medianMinutes: 4, avgMinutes: 8.3 })
      expect(d.sla.slaMetPct).toBe(100)
      expect(d.sla.distribution.map((b) => b.count)).toEqual([2, 0, 1, 0, 0])
    })

    it("takes the chat session's own window", async () => {
      const d = await frt("")
      expect(d).toMatchObject({ conversations: 5, answered: 4, medianMinutes: 4.5, avgMinutes: 7.5 })
    })

    it("keeps the website chat out of another channel and alone in its own", async () => {
      expect(await frt(`${FROM}&channel=web-chat`)).toMatchObject({
        conversations: 3, answered: 2, medianMinutes: 10.5, avgMinutes: 10.5,
      })
    })

    it("filters chat sessions by their assignee with ?agent=", async () => {
      expect(await frt(`${FROM}&agent=u-agent`)).toMatchObject({ conversations: 1, answered: 1, medianMinutes: 20 })
    })

    it("answers each organization with its own sessions", async () => {
      expect(await frt(FROM, "org-b")).toMatchObject({ conversations: 1, answered: 1, medianMinutes: 0.2 })
    })
  })

  // The figures /inbox/analytics showed for other channels before the website chat was added —
  // computed by hand from the WhatsApp rows alone, and unchanged now.
  it("leaves the other channels' figures where they were", async () => {
    expect((await temporal(`${FROM}&channel=whatsapp`)).trend).toEqual([
      { date: "2026-11-10", inbound: 1, outbound: 1 },
    ])
    expect((await temporal(`${FROM}&channel=whatsapp`)).heatmap.flat().reduce((a, b) => a + b, 0)).toBe(1)
    const d = await frt(`${FROM}&channel=whatsapp`)
    expect(d).toMatchObject({ conversations: 1, answered: 1, unanswered: 0, medianMinutes: 4, avgMinutes: 4 })
    expect(d.aging.total).toBe(1)
  })
})
