/**
 * Ad conversions to Meta against a real Postgres: a form remembers the ad
 * click, the click travels to the deal on conversion, and the cron sends the
 * lead and the won deal once each — never without the consent statement.
 *
 * Stood in for: Meta's Graph API (`fetch`), answering as it did live on
 * 2026-10-23 to a token generated in Events Manager — it may send events but
 * not read the pixel. Everything on our side is real —
 * the public lead route, the conversion command, the stage vocabulary, the
 * worker and its outbox table with its unique key and CHECKs.
 *
 * Set AD_CONVERSIONS_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55501:5432 postgres:16
 *   AD_CONVERSIONS_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55501/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and in the
 * deploy («Ad conversions database gate»), where AD_CONVERSIONS_DB_GATE=required
 * turns a missing URL into a failure.
 */
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { NextRequest } from "next/server"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.AD_CONVERSIONS_TEST_DATABASE_URL
if (!adminUrl && process.env.AD_CONVERSIONS_DB_GATE === "required") {
  throw new Error("AD_CONVERSIONS_TEST_DATABASE_URL is required by the ad conversions database gate")
}

const scratch = vi.hoisted(() => {
  process.env.TENANT_PII_MASTER_KEY = "8".repeat(64)
  const admin = process.env.AD_CONVERSIONS_TEST_DATABASE_URL
  if (!admin) return null
  const name = `ad_conversions_${process.pid}`
  const url = new URL(admin)
  url.pathname = `/${name}`
  process.env.DATABASE_URL = url.toString()
  return { name, url: url.toString() }
})

const session = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }))
vi.mock("@/lib/auth", () => ({ auth: async () => session.current }))
vi.mock("@/lib/mobile-auth", async () => {
  const { makeMobileAuthMock } = await import("./mocks/mobile-auth")
  return makeMobileAuthMock()
})

const ROOT = process.cwd()
const ORG = "org-ads"
const PIXEL = "123456789012345"
const TOKEN = "EAAB-good-system-user-token"
const PRISMA_CLI = createRequire(import.meta.url).resolve("prisma/build/index.js")
const sha = (value: string) => createHash("sha256").update(value).digest("hex")

function prismaCli(args: string[], env: NodeJS.ProcessEnv, input?: string) {
  const result = spawnSync(process.execPath, [PRISMA_CLI, ...args], { input, encoding: "utf8", env })
  if (result.status !== 0) throw new Error(`prisma ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`)
}

function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  if (stripped === schema) throw new Error("no pgvector column found — this workaround can be deleted")
  const directory = mkdtempSync(path.join(tmpdir(), "ad-conversions-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

/** `db push` builds no CHECKs; the ones the worker relies on are lifted from the migration. */
function constraintsSql(): string {
  const sql = readFileSync(path.join(ROOT, "prisma/migrations/20261102090000_ad_conversions/migration.sql"), "utf8")
  const checks = [...sql.matchAll(/CONSTRAINT "(ad_conversion_(destinations|events)_\w+_check)" CHECK (\(.*\))/g)]
  if (checks.length < 6) throw new Error("ad conversion CHECKs not found in the migration")
  return checks
    .map(([, name, table, body]) => `ALTER TABLE "ad_conversion_${table}" ADD CONSTRAINT "${name}" CHECK ${body.replace(/,$/, "")};`)
    .join("\n")
}

/* ─── Meta, stood in ─────────────────────────────────────────────────── */

const meta = vi.hoisted(() => ({ batches: [] as Record<string, unknown>[][], fail: null as string | null, testCodes: [] as unknown[] }))

async function fakeMeta(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
  if (url.hostname !== "graph.facebook.com") throw new Error(`unexpected fetch ${url.href}`)
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
  const denied = json(400, { error: { message: "Invalid OAuth access token - Cannot parse access token", code: 190 } })
  if ((init?.method ?? "GET") === "GET") {
    return url.searchParams.get("access_token") === TOKEN ? json(400, { error: { message: "(#100) Missing Permission", code: 100 } }) : denied
  }
  const body = JSON.parse(String(init?.body))
  if (body.access_token !== TOKEN) return denied
  if (!url.pathname.endsWith(`/${PIXEL}/events`)) {
    return json(400, { error: { message: "Unsupported post request. Object with ID 'x' does not exist, cannot be loaded due to missing permissions", code: 100, error_subcode: 33 } })
  }
  // "If any event_time is more than 7 days in the past, we return an error for the entire request and process no events."
  if ((body.data as { event_time: number }[]).some((event) => event.event_time < Date.now() / 1000 - 7 * 24 * 3600)) {
    return json(400, { error: { message: "Invalid parameter", code: 100, error_subcode: 2804003, error_user_msg: "The timestamp for this event is too far in the past." } })
  }
  if (meta.fail) return json(400, { error: { message: meta.fail, code: 100 } })
  meta.batches.push(body.data)
  meta.testCodes.push(body.test_event_code)
  return json(200, { events_received: body.data.length, fbtrace_id: "x" })
}

const json = (method: string, url: string, body?: unknown) => new NextRequest(`http://localhost:3000${url}`, {
  method,
  headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Test)" },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const pgDescribe = scratch ? describe : describe.skip

pgDescribe("ad conversions to Meta on a real Postgres", () => {
  type Prisma = typeof import("@/lib/prisma").prisma
  let prisma!: Prisma
  let bypass!: typeof import("@/lib/rls-context").runWithRlsBypass
  let saveMeta!: typeof import("@/app/api/v1/ad-conversions/meta/route").PUT
  let readPage!: typeof import("@/app/api/v1/ad-conversions/route").GET
  let publicLead!: typeof import("@/app/api/v1/public/leads/route").POST
  let convert!: typeof import("@/app/api/v1/leads/[id]/convert/route").POST
  let run!: typeof import("@/lib/ad-conversions/worker").runAdConversions
  let ipSequence = 0

  beforeAll(async () => {
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.url })
    prismaCli(["db", "execute", "--url", scratch!.url, "--stdin"], process.env, constraintsSql())
    prisma = (await import("@/lib/prisma")).prisma
    bypass = (await import("@/lib/rls-context")).runWithRlsBypass
    saveMeta = (await import("@/app/api/v1/ad-conversions/meta/route")).PUT
    readPage = (await import("@/app/api/v1/ad-conversions/route")).GET
    publicLead = (await import("@/app/api/v1/public/leads/route")).POST
    convert = (await import("@/app/api/v1/leads/[id]/convert/route")).POST
    run = (await import("@/lib/ad-conversions/worker")).runAdConversions
    await bypass(async () => {
      await prisma.organization.create({ data: { id: ORG, name: "Shop", slug: "shop-ads", modules: { crm: true, sales: true, settings: true, marketing: true } } })
      await prisma.user.create({ data: { id: "user-admin", organizationId: ORG, email: "admin@shop.test", name: "Admin", passwordHash: "-", role: "admin" } })
      const pipeline = await prisma.pipeline.create({ data: { organizationId: ORG, name: "Satış", isDefault: true } })
      await prisma.pipelineStage.createMany({
        data: [
          { organizationId: ORG, pipelineId: pipeline.id, name: "Yeni", displayName: "Yeni", sortOrder: 0 },
          { organizationId: ORG, pipelineId: pipeline.id, name: "Qazanıldı", displayName: "Qazanıldı", sortOrder: 1, isWon: true },
        ] as never,
      })
    })
  }, 300_000)

  afterAll(async () => {
    await prisma?.$disconnect()
    if (scratch) prismaCli(["db", "execute", "--url", adminUrl!, "--stdin"], process.env, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE);`)
  }, 60_000)

  beforeEach(() => {
    meta.batches = []
    meta.fail = null
    meta.testCodes = []
    vi.stubGlobal("fetch", vi.fn(fakeMeta))
    session.current = { user: { id: "user-admin", organizationId: ORG, role: "admin", email: "admin@shop.test", name: "Admin" } }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const destination = () => bypass(() => prisma.adConversionDestination.findFirst({ where: { organizationId: ORG } }))
  const eventsFor = (entityId: string) => bypass(() => prisma.adConversionEvent.findMany({ where: { entityId } }))
  const sentEvents = () => meta.batches.flat()

  async function connect(body: Record<string, unknown> = {}) {
    return saveMeta(json("PUT", "/api/v1/ad-conversions/meta", {
      publicId: PIXEL, secret: TOKEN, testEventCode: null, sendLeads: true, sendWins: true, isActive: true, consent: true, ...body,
    }))
  }

  async function websiteLead(name: string, extra: Record<string, unknown> = {}) {
    const request = new NextRequest("http://localhost:3000/api/v1/public/leads", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (Test)", "x-forwarded-for": `10.0.0.${++ipSequence}` },
      body: JSON.stringify({
        name, email: `${name.toLowerCase()}@mail.az`, phone: "050 123 45 67", org_slug: "shop-ads",
        attribution: { fbclid: "IwAR0abc", fbp: "fb.1.1792749000000.98765", utmSource: "instagram", pageUrl: "https://shop.az/kampaniya" },
        ...extra,
      }),
    })
    const res = await publicLead(request)
    expect(res.status, await res.clone().text()).toBe(201)
    return bypass(() => prisma.lead.findFirstOrThrow({ where: { organizationId: ORG, contactName: name } }))
  }

  it("refuses to turn sending on without the consent statement, with a token Meta rejects, or for a pixel the token cannot send to", async () => {
    const noConsent = await connect({ consent: false })
    const badToken = await connect({ secret: "wrong" })
    const otherPixel = await connect({ publicId: "999999999999999" })

    expect([noConsent.status, (await noConsent.json()).code]).toEqual([400, "CONSENT_REQUIRED"])
    expect([badToken.status, (await badToken.json()).code]).toEqual([400, "INVALID_KEY"])
    expect([otherPixel.status, (await otherPixel.json()).code]).toEqual([400, "NO_PIXEL_ACCESS"])
    expect(await destination()).toBeNull()
  })

  it("accepts a token that may send but not read the pixel, and the check records no event", async () => {
    const res = await connect()

    expect(res.status, await res.clone().text()).toBe(200)
    expect((await destination())?.isActive).toBe(true)
    expect(sentEvents()).toEqual([])
    await bypass(() => prisma.adConversionDestination.deleteMany({ where: { organizationId: ORG } }))
  })

  it("the database refuses an active destination without consent", async () => {
    await expect(bypass(() => prisma.adConversionDestination.create({
      data: { organizationId: ORG, platform: "meta", publicId: PIXEL, secretCiphertext: "x", isActive: true },
    }))).rejects.toThrow()
  })

  it("does not send a lead from before sending was turned on", async () => {
    const before = await websiteLead("Earlier")
    const res = await connect()
    expect(res.status, await res.clone().text()).toBe(200)
    const row = await destination()
    expect(row?.secretCiphertext).not.toContain(TOKEN)
    expect(row?.consentConfirmedAt).toBeInstanceOf(Date)

    await run()

    expect(await eventsFor(before.id)).toHaveLength(0)
  })

  it("remembers the ad click on a website lead and sends it once as a Lead", async () => {
    const lead = await websiteLead("Nigar")
    expect(lead.adAttribution).toMatchObject({ fbclid: "IwAR0abc", fbc: expect.stringMatching(/^fb\.1\.\d+\.IwAR0abc$/), utmSource: "instagram", userAgent: "Mozilla/5.0 (Test)" })

    await run()
    await run()

    const sent = sentEvents().filter((event) => event.event_id === `leaddrive:lead:${lead.id}`)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      event_name: "Lead",
      action_source: "website",
      event_source_url: "https://shop.az/kampaniya",
      user_data: { em: [sha("nigar@mail.az")], ph: [sha("994501234567")], fbc: expect.stringMatching(/IwAR0abc$/), fbp: "fb.1.1792749000000.98765" },
    })
    expect((await eventsFor(lead.id))[0]).toMatchObject({ status: "sent", eventName: "lead" })
  })

  it("does not send a cold-call lead", async () => {
    const cold = await bypass(() => prisma.lead.create({ data: { organizationId: ORG, contactName: "Soyuq", phone: "0501112233", source: "cold_call", status: "new" } }))
    await run()
    expect(await eventsFor(cold.id)).toHaveLength(0)
  })

  it("carries the click to the deal and sends the win with its amount, by the organization's own won stage", async () => {
    const lead = await websiteLead("Anar")
    const converted = await convert(json("POST", `/api/v1/leads/${lead.id}/convert`, { dealTitle: "Anar — illik", dealValue: 4800 }), { params: Promise.resolve({ id: lead.id }) })
    expect(converted.status, await converted.clone().text()).toBe(201)
    const deal = await bypass(() => prisma.deal.findFirstOrThrow({ where: { organizationId: ORG, name: "Anar — illik" } }))
    expect(deal.metadata).toMatchObject({ adAttribution: { fbclid: "IwAR0abc" }, sourceLeadId: lead.id })

    await bypass(() => prisma.deal.update({ where: { id: deal.id }, data: { stage: "Qazanıldı", stageChangedAt: new Date() } }))
    await run()

    const purchase = sentEvents().find((event) => event.event_id === `leaddrive:deal:${deal.id}`)
    expect(purchase).toMatchObject({
      event_name: "Purchase",
      action_source: "other",
      custom_data: { value: 4800, currency: "AZN" },
      user_data: { fbc: expect.stringMatching(/IwAR0abc$/), em: [sha("anar@mail.az")] },
    })
  })

  it("skips an event older than Meta accepts instead of failing the batch", async () => {
    const old = await bypass(() => prisma.lead.create({
      data: { organizationId: ORG, contactName: "Köhnə", email: "old@mail.az", source: "website", status: "new" },
    }))
    const row = await destination()
    await bypass(() => prisma.adConversionEvent.create({
      data: { organizationId: ORG, destinationId: row!.id, eventName: "lead", entityType: "lead", entityId: old.id, eventTime: new Date(Date.now() - 8 * 24 * 3600_000), recordLabel: "Köhnə" },
    }))
    const fresh = await websiteLead("Teze")

    await run()

    expect((await eventsFor(old.id))[0]).toMatchObject({ status: "skipped", reason: "skip_too_old" })
    expect((await eventsFor(fresh.id))[0]).toMatchObject({ status: "sent" })
    expect(sentEvents().some((event) => event.event_id === `leaddrive:lead:${old.id}`)).toBe(false)
  })

  it("keeps a refused event waiting with Meta's words, and gives up after five tries", async () => {
    const lead = await websiteLead("Elvin")
    meta.fail = "Invalid parameter"

    await run()
    let [event] = await eventsFor(lead.id)
    expect(event).toMatchObject({ status: "pending", attempts: 1, reason: "Invalid parameter" })

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      // Past the back-off for the next try.
      await bypass(() => prisma.adConversionEvent.updateMany({ where: { id: event.id }, data: { updatedAt: new Date(Date.now() - 24 * 3600_000) } }))
      await run()
    }
    ;[event] = await eventsFor(lead.id)
    expect(event).toMatchObject({ status: "failed", attempts: 5 })

    const page = await (await readPage(json("GET", "/api/v1/ad-conversions"))).json()
    expect(page.data.destinations.meta).toMatchObject({ isActive: true, consentConfirmed: true, hasSecret: true, failures7d: 1 })
    expect(JSON.stringify(page)).not.toContain(TOKEN)
  })

  it("sends nothing once turned off", async () => {
    meta.fail = null
    const off = await connect({ isActive: false, secret: undefined })
    expect(off.status).toBe(200)
    const lead = await websiteLead("Sonra")

    await run()

    expect(await eventsFor(lead.id)).toHaveLength(0)
    expect(meta.batches).toHaveLength(0)
  })
})
