/**
 * «Агент едет к вам» on a real Postgres: the minute job that sends the
 * customer an agent has set off to a link to where the agent is, and the
 * public answer that link opens (src/lib/mtm/customer-eta-link*.ts).
 *
 * What is asked is what reached the customer's phone — the senders are the
 * only stand-ins: the SMS provider, Meta, the road router — and what the
 * table and the public route say afterwards. A mocked Prisma would answer the
 * one-row-per-stop rule the whole «never twice» promise rests on with
 * whatever the test handed it.
 *
 * The owner (2026-10-12, 2026-11-02): off until the company turns it on;
 * sent when the agent sets off, not when the visit is booked; SMS or
 * WhatsApp, the company's choice; the link stops showing him once he is
 * there.
 *
 * Set MTM_CUSTOMER_ETA_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55498:5432 postgres:16
 *   MTM_CUSTOMER_ETA_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55498/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy («MTM customer ETA links database gate»), where
 * `MTM_CUSTOMER_ETA_DB_GATE=required` turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.MTM_CUSTOMER_ETA_TEST_DATABASE_URL
if (!adminUrl && process.env.MTM_CUSTOMER_ETA_DB_GATE === "required") {
  throw new Error("MTM_CUSTOMER_ETA_TEST_DATABASE_URL is required by the MTM customer ETA links database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.MTM_CUSTOMER_ETA_TEST_DATABASE_URL
  if (!admin) return null
  const name = `mtm_customer_eta_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example.test"
  return { name, url: url.toString() }
})

const ROOT = process.cwd()
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const ORG = "org-eta"
const TZ = "Asia/Baku"

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) {
    throw new Error(`prisma ${args.join(" ")} failed\n${result.error ?? ""}\n${result.stdout}\n${result.stderr}`)
  }
}

/** The schema as `db push` can build it on any Postgres: without the two pgvector columns nothing here reads. */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "mtm-customer-eta-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** The table's own rules, as the migration words them — `db push` builds none of its CHECKs. */
function migrationChecks(): string {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261120090000_mtm_customer_eta_links/migration.sql"), "utf8")
  const shape = /ADD CONSTRAINT "mtm_location_share_links_customer_eta_shape_check"[\s\S]*?\)\s*\),/.exec(sql)?.[0]
  if (!shape) throw new Error("the migration no longer words the shape check this test copies")
  return `ALTER TABLE "mtm_location_share_links" ${shape.replace(/,\s*$/, "")};`
}

/** Where the customer is, and where the agent stands: about two kilometres apart, in Baku. */
const CUSTOMER_AT = { latitude: 40.4093, longitude: 49.8671 }
const AGENT_AT = { latitude: 40.3920, longitude: 49.8500 }

type SmsCall = { to: string; message: string; organizationId?: string }
type WaCall = { to: string; templateName: string; languageCode?: string; variables?: unknown; organizationId: string }

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("«агент едет к вам» on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let job!: typeof import("@/lib/mtm/customer-eta-link-job")
  let getPublic!: typeof import("@/app/api/v1/public/location-share/[token]/route").GET
  let resetTrips!: () => void
  let sequence = 0
  let sms: SmsCall[]
  let whatsapp: WaCall[]
  let smsAnswer: { success: boolean; error?: string }

  const senders = () => ({
    sendSms: vi.fn(async (call: SmsCall) => { sms.push(call); return smsAnswer }),
    sendWhatsAppTemplate: vi.fn(async (call: WaCall) => { whatsapp.push(call); return { success: true, messageId: "wamid.1" } }),
    // Twenty minutes by the roads.
    roadTable: vi.fn(async () => ({ seconds: [[0, 1200], [1200, 0]], metres: [[0, 2400], [2400, 0]] })),
  })

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(
      ["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"],
      { ...process.env, DATABASE_URL: scratch!.url },
    )
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, migrationChecks())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    job = await import("@/lib/mtm/customer-eta-link-job")
    getPublic = (await import("@/app/api/v1/public/location-share/[token]/route")).GET
    resetTrips = (await import("@/lib/mtm/customer-eta-trip")).resetCustomerEtaTripCache
    await bypass(() => prisma.organization.create({
      data: { id: ORG, name: "NovaMed", slug: ORG, modules: { mtm: true, "route-field": true } },
    }))
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(async () => {
    sms = []
    whatsapp = []
    smsAnswer = { success: true }
    resetTrips()
    // Each case starts from a company that never touched the settings, and
    // from no agent on shift: the job looks at every organization.
    await bypass(async () => {
      await prisma.mtmSetting.deleteMany({ where: { organizationId: ORG } })
      await prisma.mtmAgentWorkday.updateMany({ where: { organizationId: ORG }, data: { status: "COMPLETED" } })
    })
  })

  const setting = (key: string, value: unknown) => bypass(() => prisma.mtmSetting.upsert({
    where: { organizationId_key: { organizationId: ORG, key } },
    create: { organizationId: ORG, key, value: value as never },
    update: { value: value as never },
  }))
  const switchOn = async (channel: "sms" | "whatsapp" = "sms") => {
    await setting("customerEtaLinksEnabled", true)
    await setting("customerEtaLinkChannel", channel)
  }

  /** Today by the company's calendar, as the workday and route tables store a date. */
  const today = async () => {
    const { locationShareLinkTodayWorkDate } = await import("@/lib/mtm/location-share-link")
    return locationShareLinkTodayWorkDate(new Date(), TZ)
  }

  /**
   * An agent on shift with a fresh point, and today's route: a stop he has
   * been to and closed, then the customer he is driving to now.
   */
  async function agentOnTheWay(options: {
    shift?: "STARTED" | "PAUSED"
    pointAt?: { latitude: number; longitude: number }
    plannedTime?: Date | null
    contactPhones?: { mobilePhone?: string | null; whatsappPhone?: string | null } | null
    customerPhone?: string | null
    appLanguage?: string
  } = {}) {
    const n = ++sequence
    const agentId = `agent-${n}`
    const workDate = await today()
    const startedAt = new Date(Date.now() - 60 * 60_000)
    await bypass(async () => {
      await prisma.mtmAgent.create({ data: { id: agentId, organizationId: ORG, name: `Elçin Məmmədov ${n}`, appLanguage: options.appLanguage ?? "ru" } })
      const workday = await prisma.mtmAgentWorkday.create({
        data: {
          organizationId: ORG,
          agentId,
          workDate,
          startedAt,
          status: options.shift ?? "STARTED",
          pausedAt: options.shift === "PAUSED" ? new Date(Date.now() - 5 * 60_000) : null,
        },
      })
      await prisma.mtmAgentWorkdayEvent.create({
        data: { organizationId: ORG, agentId, workdayId: workday.id, type: "START", occurredAt: startedAt, appliedAt: startedAt },
      })
      if (options.shift === "PAUSED") {
        const paused = new Date(Date.now() - 5 * 60_000)
        await prisma.mtmAgentWorkdayEvent.create({
          data: { organizationId: ORG, agentId, workdayId: workday.id, type: "PAUSE", occurredAt: paused, appliedAt: paused },
        })
      }
      const at = options.pointAt ?? AGENT_AT
      await prisma.mtmAgentLocation.create({
        data: { organizationId: ORG, agentId, latitude: at.latitude, longitude: at.longitude, accuracy: 10, recordedAt: new Date(Date.now() - 60_000) },
      })
    })
    const done = await bypass(() => prisma.mtmCustomer.create({ data: { organizationId: ORG, name: `Earlier stop ${n}`, latitude: 40.38, longitude: 49.84 } }))
    const customer = await bypass(() => prisma.mtmCustomer.create({
      data: { organizationId: ORG, name: `Customer ${n}`, ...CUSTOMER_AT, phone: options.customerPhone === undefined ? "+994 12 555 00 00" : options.customerPhone },
    }))
    const contact = options.contactPhones === null ? null : await bypass(() => prisma.mtmContact.create({
      data: {
        organizationId: ORG,
        firstName: "Aysel",
        lastName: "Quliyeva",
        displayName: "Aysel Quliyeva",
        mobilePhone: options.contactPhones?.mobilePhone === undefined ? "+994 50 111 22 33" : options.contactPhones.mobilePhone,
        whatsappPhone: options.contactPhones?.whatsappPhone ?? null,
      },
    }))
    const route = await bypass(() => prisma.mtmRoute.create({ data: { organizationId: ORG, agentId, date: workDate, status: "IN_PROGRESS" } }))
    const first = await bypass(() => prisma.mtmRoutePoint.create({
      data: { organizationId: ORG, routeId: route.id, customerId: done.id, orderIndex: 0, status: "VISITED" },
    }))
    const next = await bypass(() => prisma.mtmRoutePoint.create({
      data: {
        organizationId: ORG,
        routeId: route.id,
        customerId: customer.id,
        contactId: contact?.id ?? null,
        orderIndex: 1,
        status: "PENDING",
        plannedTime: options.plannedTime ?? null,
      },
    }))
    await bypass(() => prisma.mtmVisit.create({
      data: {
        organizationId: ORG, agentId, customerId: done.id, routeId: route.id, routePointId: first.id,
        status: "CHECKED_OUT", checkInAt: new Date(Date.now() - 40 * 60_000), checkOutAt: new Date(Date.now() - 10 * 60_000),
      },
    }))
    return { agentId, routeId: route.id, stopId: next.id, customerId: customer.id }
  }

  const tick = (given = senders()) => bypass(() => job.executeCustomerEtaLinkJob(new Date(), given))
  const linksOf = (stopId: string) => bypass(() => prisma.mtmLocationShareLink.findMany({
    where: { organizationId: ORG, routePointId: stopId },
    select: { purpose: true, deliveryChannel: true, deliveryStatus: true, deliveryError: true, revokedAt: true, customerId: true, agentId: true },
  }))
  const tokenIn = (text: string) => /\/share\/location\/([a-f0-9]{64})\?lang=(az|ru|en)/.exec(text)
  async function open(token: string) {
    const response = await getPublic(
      new NextRequest(`http://localhost/api/v1/public/location-share/${token}`, { headers: { "x-real-ip": `10.0.0.${++sequence % 250}` } }),
      { params: Promise.resolve({ token }) },
    )
    return { status: response.status, body: await response.json() as { state: string; data?: Record<string, unknown> } }
  }

  it("sends nothing for a company that has not switched it on — the default", async () => {
    const { stopId } = await agentOnTheWay()
    const result = await tick()
    expect(sms).toEqual([])
    expect(whatsapp).toEqual([])
    expect(result.scanned).toBe(0)
    expect(await linksOf(stopId)).toEqual([])
  })

  it("switched on: one SMS to the contact the agent is coming to see, with the time, and never a second one", async () => {
    await switchOn()
    const { stopId, customerId, agentId } = await agentOnTheWay()
    expect((await tick()).sent).toBe(1)
    expect(sms).toHaveLength(1)
    expect(sms[0].to).toBe("+994501112233")
    expect(sms[0].organizationId).toBe(ORG)
    expect(sms[0].message).toMatch(/^NovaMed: ваш представитель Elçin Məmmədov \d+ едет к вам, будет примерно в \d{2}:\d{2}\. Где он сейчас: https:\/\/app\.example\.test\/share\/location\/[a-f0-9]{64}\?lang=ru$/)
    expect(await linksOf(stopId)).toEqual([{
      purpose: "CUSTOMER_ETA", deliveryChannel: "sms", deliveryStatus: "SENT", deliveryError: null, revokedAt: null, customerId, agentId,
    }])

    // The next minutes, and two ticks at once: still the one message.
    await tick()
    await Promise.all([tick(), tick()])
    expect(sms).toHaveLength(1)
    expect(await linksOf(stopId)).toHaveLength(1)
  })

  it("opens on where he is and where he is coming to, then says «на месте» once he checked in — and no position from then", async () => {
    await switchOn()
    const { stopId, customerId, agentId, routeId } = await agentOnTheWay()
    await tick()
    const token = tokenIn(sms[0].message)![1]

    const onTheWay = await open(token)
    expect(onTheWay.status).toBe(200)
    expect(onTheWay.body.state).toBe("AVAILABLE")
    expect(onTheWay.body.data).toMatchObject({ latitude: AGENT_AT.latitude, longitude: AGENT_AT.longitude, organizationName: "NovaMed" })
    // No road router here: the pin, and no time rather than a guessed one.
    expect(onTheWay.body.data?.trip).toEqual({ destination: CUSTOMER_AT, arrivesAt: null })

    await bypass(() => prisma.mtmVisit.create({
      data: { organizationId: ORG, agentId, customerId, routeId, routePointId: stopId, status: "CHECKED_IN", checkInAt: new Date() },
    }))
    const arrived = await open(token)
    expect(arrived.status).toBe(200)
    expect(arrived.body.state).toBe("ARRIVED")
    expect(arrived.body.data).not.toHaveProperty("latitude")
    expect(arrived.body.data).not.toHaveProperty("trip")
  })

  it("shows no position while he is in a visit at somebody else, and sends nothing then", async () => {
    await switchOn()
    const busy = await agentOnTheWay()
    const elsewhere = await bypass(() => prisma.mtmCustomer.create({ data: { organizationId: ORG, name: "Unplanned stop", latitude: 40.4, longitude: 49.86 } }))
    await bypass(() => prisma.mtmVisit.create({
      data: { organizationId: ORG, agentId: busy.agentId, customerId: elsewhere.id, status: "CHECKED_IN", checkInAt: new Date() },
    }))
    await tick()
    expect(sms).toEqual([])
    expect(await linksOf(busy.stopId)).toEqual([])

    // One already sent, and then he stopped somewhere else on the way.
    const sent = await agentOnTheWay()
    await tick()
    const token = tokenIn(sms[0].message)![1]
    await bypass(() => prisma.mtmVisit.create({
      data: { organizationId: ORG, agentId: sent.agentId, customerId: elsewhere.id, status: "CHECKED_IN", checkInAt: new Date() },
    }))
    const answer = await open(token)
    expect(answer.body.state).toBe("UNAVAILABLE")
    expect(answer.body.data).not.toHaveProperty("latitude")
  })

  it("sends nothing on a break, at the customer's door, hours before the stop was planned, or with no number to send to", async () => {
    await switchOn()
    const cases = [
      await agentOnTheWay({ shift: "PAUSED" }),
      await agentOnTheWay({ pointAt: { latitude: CUSTOMER_AT.latitude + 0.0005, longitude: CUSTOMER_AT.longitude } }),
      await agentOnTheWay({ plannedTime: new Date(Date.now() + 3 * 60 * 60_000) }),
      await agentOnTheWay({ contactPhones: null, customerPhone: null }),
    ]
    await tick()
    expect(sms).toEqual([])
    for (const { stopId } of cases) expect(await linksOf(stopId)).toEqual([])
  })

  it("falls back to the customer's own phone when the stop names no contact", async () => {
    await switchOn()
    await agentOnTheWay({ contactPhones: null })
    await tick()
    expect(sms.map((call) => call.to)).toEqual(["+994125550000"])
  })

  it("by WhatsApp: the company's approved template, to the contact's WhatsApp number, in the agent's language", async () => {
    await switchOn("whatsapp")
    const { stopId } = await agentOnTheWay({ contactPhones: { mobilePhone: "+994 50 111 22 33", whatsappPhone: "+994 55 999 88 77" }, appLanguage: "az" })
    await tick()
    expect(sms).toEqual([])
    expect(whatsapp).toHaveLength(1)
    expect(whatsapp[0]).toMatchObject({ to: "+994559998877", templateName: "mtm_agent_on_the_way", languageCode: "az", organizationId: ORG })
    const variables = whatsapp[0].variables as string[]
    expect(variables.slice(0, 2)).toEqual(["NovaMed", expect.stringMatching(/^Elçin Məmmədov \d+$/)])
    expect(variables[2]).toMatch(/^\d{2}:\d{2}$/)
    expect(tokenIn(variables[3])?.[2]).toBe("az")
    expect((await linksOf(stopId))[0]).toMatchObject({ deliveryChannel: "whatsapp", deliveryStatus: "SENT" })
  })

  it("a message that did not go leaves a link that opens nothing, says why without the number, and is not tried again", async () => {
    await switchOn()
    smsAnswer = { success: false, error: "Twilio: unreachable +994501112233" }
    const { stopId } = await agentOnTheWay()
    expect((await tick()).failed).toBe(1)
    const token = tokenIn(sms[0].message)![1]
    const [row] = await linksOf(stopId)
    expect(row.deliveryStatus).toBe("FAILED")
    expect(row.deliveryError).toBe("Twilio: unreachable …")
    expect(row.revokedAt).not.toBeNull()
    expect((await open(token)).status).toBe(404)
    await tick()
    expect(sms).toHaveLength(1)
  })

  it("answers to its own switch: the managers' switch off leaves it working, its own switch off ends it", async () => {
    await switchOn()
    await agentOnTheWay()
    await tick()
    const token = tokenIn(sms[0].message)![1]
    await setting("locationShareLinksEnabled", false)
    expect((await open(token)).status).toBe(200)
    await setting("customerEtaLinksEnabled", false)
    expect((await open(token)).status).toBe(404)
  })

  it("refuses a bot's row without its stop, and a manager's row with one", async () => {
    const { agentId, stopId, customerId } = await agentOnTheWay()
    const row = (data: Record<string, unknown>) => bypass(() => prisma.mtmLocationShareLink.create({
      data: {
        organizationId: ORG, agentId, tokenHash: "a".repeat(63) + String(++sequence % 10),
        expiresAt: new Date(Date.now() + 60 * 60_000), ...data,
      } as never,
    }))
    await expect(row({ purpose: "CUSTOMER_ETA", deliveryChannel: "sms", deliveryStatus: "SENT" })).rejects.toThrow(/customer_eta_shape_check/)
    await expect(row({ purpose: "MANAGER", routePointId: stopId, customerId })).rejects.toThrow(/customer_eta_shape_check/)
  })
})
