/**
 * Which advertisement brought a conversation, against a real Postgres.
 *
 * The rule is one conditional UPDATE — «write it only if nothing is written
 * yet» — and that is exactly the kind of rule a mocked Prisma cannot show.
 * A stand-in returns whatever it was told to; only a database can answer what
 * happens when Meta redelivers the same first message, when the customer taps
 * a second ad a week later, or when the statement names another tenant's row.
 *
 * Three things are proved here and nowhere else:
 *
 *  - **first touch wins** — a later ad does not rewrite where a conversation
 *    came from, so last month's report says the same thing next month;
 *  - **the rest of `metadata` survives** — the payload is written with
 *    `jsonb_set`, and a careless write would take the conversation's other
 *    metadata with it;
 *  - **the row belongs to its tenant** — the UPDATE carries organizationId,
 *    and under RLS another organization's conversation is simply not there.
 *
 * Set WHATSAPP_AD_REFERRAL_TEST_DATABASE_URL to an admin connection, e.g.
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -p 127.0.0.1:55501:5432 postgres:16
 *   WHATSAPP_AD_REFERRAL_TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55501/postgres
 * Without it the suite is skipped. CI runs it in `static-checks` and again in
 * the deploy, where `WHATSAPP_AD_REFERRAL_DB_GATE=required` turns a missing URL
 * into a failure so the gate cannot go quietly green.
 */
import { spawnSync } from "node:child_process"
import { createRequire } from "node:module"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import type { Prisma, PrismaClient } from "@prisma/client"
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const adminUrl = process.env.WHATSAPP_AD_REFERRAL_TEST_DATABASE_URL
if (!adminUrl && process.env.WHATSAPP_AD_REFERRAL_DB_GATE === "required") {
  throw new Error("WHATSAPP_AD_REFERRAL_TEST_DATABASE_URL is required by the WhatsApp ad referral database gate")
}

const scratch = vi.hoisted(() => {
  const admin = process.env.WHATSAPP_AD_REFERRAL_TEST_DATABASE_URL
  if (!admin) return null
  const name = `wa_ad_referral_${process.pid}`
  const role = `wa_ad_referral_app_${process.pid}`
  const password = `pw${process.pid}x${Date.now()}`
  const adminScratch = new URL(admin)
  adminScratch.pathname = `/${name}`
  const app = new URL(adminScratch)
  app.username = role
  app.password = password
  // `@/lib/prisma` builds its client from DATABASE_URL on first import, which
  // happens after the scratch database and the role exist.
  process.env.DATABASE_URL = app.toString()
  return { name, role, password, adminScratch: adminScratch.toString() }
})

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

/** The schema as `db push` can build it on any Postgres: the pgvector columns are left out. */
function schemaWithoutEmbeddings(): string {
  const schema = readFileSync(path.join(ROOT, "prisma/schema.prisma"), "utf8")
  const stripped = schema.split("\n").filter((line) => !/Unsupported\("vector/.test(line)).join("\n")
  const directory = mkdtempSync(path.join(tmpdir(), "wa-ad-referral-schema-"))
  const file = path.join(directory, "schema.prisma")
  writeFileSync(file, stripped)
  return file
}

const SALON = "org-salon"
const OTHER = "org-other"

/** Meta's payload for a tap on a Click-to-WhatsApp ad, as the webhook receives it. */
const AD_MESSAGE = {
  from: "994501112233",
  id: "wamid.first",
  type: "text",
  text: { body: "Salam, qiymət nə qədərdir?" },
  referral: {
    source_url: "https://fb.me/2abCdEf",
    source_type: "ad",
    source_id: "120210000000111",
    headline: "Payız endirimi — 30 %",
    body: "Bu həftə bütün xidmətlərə endirim",
    media_type: "image",
    ctwa_clid: "ARAbCdEfGhIjKlMn",
  },
}

const describeIfDb = adminUrl ? describe : describe.skip

describeIfDb("which ad brought the conversation", () => {
  let admin: PrismaClient
  let app: PrismaClient
  let readAdReferral: typeof import("@/lib/inbox/ad-referral").readAdReferral
  let recordAdReferral: typeof import("@/lib/inbox/ad-referral").recordAdReferral
  let runWithTenant: typeof import("@/lib/rls-context").runWithTenant

  beforeAll(async () => {
    const control = adminUrl!
    sql(control, `DROP DATABASE IF EXISTS "${scratch!.name}" WITH (FORCE)`)
    sql(control, `CREATE DATABASE "${scratch!.name}"`)
    prismaCli(["db", "push", "--schema", schemaWithoutEmbeddings(), "--skip-generate", "--accept-data-loss"], { ...process.env, DATABASE_URL: scratch!.adminScratch })
    // Production's tenant isolation: FORCE RLS with `tenant_isolation` on every
    // table carrying organizationId, social_conversations among them.
    prismaCli(["db", "execute", "--url", scratch!.adminScratch, "--file", path.join(ROOT, "prisma/migrations/20260825170000_tenant_isolation_from_migrations/migration.sql")], process.env)
    sql(control, `DROP ROLE IF EXISTS "${scratch!.role}"`)
    sql(control, `CREATE ROLE "${scratch!.role}" LOGIN PASSWORD '${scratch!.password}' NOSUPERUSER NOBYPASSRLS`)
    sql(scratch!.adminScratch, `GRANT USAGE ON SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${scratch!.role}"`)
    sql(scratch!.adminScratch, `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO "${scratch!.role}"`)

    const { PrismaClient: Client } = await import("@prisma/client")
    admin = new Client<Prisma.PrismaClientOptions>({ datasourceUrl: scratch!.adminScratch })
    await admin.organization.createMany({ data: [
      { id: SALON, name: "Gözəllik salonu", slug: "salon" },
      { id: OTHER, name: "Başqa şirkət", slug: "other" },
    ] })
    app = (await import("@/lib/prisma")).prisma
    const referralModule = await import("@/lib/inbox/ad-referral")
    readAdReferral = referralModule.readAdReferral
    recordAdReferral = referralModule.recordAdReferral
    runWithTenant = (await import("@/lib/rls-context")).runWithTenant
  }, 300_000)

  afterAll(async () => {
    await app?.$disconnect()
    await admin?.$disconnect()
    if (scratch) {
      sql(adminUrl!, `DROP DATABASE IF EXISTS "${scratch.name}" WITH (FORCE)`)
      sql(adminUrl!, `DROP ROLE IF EXISTS "${scratch.role}"`)
    }
  })

  beforeEach(async () => {
    await admin.socialConversation.deleteMany({})
  })

  /** A conversation as the webhook's upsert leaves it, before any referral. */
  async function conversation(orgId: string, externalId: string, metadata: Prisma.InputJsonValue = {}) {
    return admin.socialConversation.create({
      data: { organizationId: orgId, platform: "whatsapp", externalId, contactName: "Müştəri", lastMessage: "Salam", metadata },
    })
  }

  const row = (id: string) => admin.socialConversation.findUniqueOrThrow({ where: { id } })

  it("records the ad that brought the chat", async () => {
    const conv = await conversation(SALON, "994501112233")
    const referral = readAdReferral(AD_MESSAGE)
    expect(referral).not.toBeNull()
    const wrote = await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: conv.id, referral: referral! }))
    expect(wrote).toBe(true)

    const saved = await row(conv.id)
    expect(saved.adSourceType).toBe("ad")
    expect(saved.adSourceId).toBe("120210000000111")
    expect(saved.adHeadline).toBe("Payız endirimi — 30 %")
    expect(saved.adReferralAt).toBeInstanceOf(Date)
    // The click id is not shown anywhere, but Meta's Conversions API will want
    // it back, so it has to survive the trip.
    expect((saved.metadata as { adReferral?: { ctwaClid?: string } }).adReferral?.ctwaClid).toBe("ARAbCdEfGhIjKlMn")
  })

  it("ignores Meta redelivering the same first message", async () => {
    const conv = await conversation(SALON, "994501112233")
    const referral = readAdReferral(AD_MESSAGE)!
    await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: conv.id, referral }))
    const first = await row(conv.id)

    const again = await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: conv.id, referral }))
    expect(again).toBe(false)
    expect((await row(conv.id)).adReferralAt?.getTime()).toBe(first.adReferralAt?.getTime())
  })

  it("keeps the first ad when the customer taps a second one later", async () => {
    // A report that rewrites last month's numbers when someone clicks again is
    // worse than no report: the first ad is the one that brought this chat.
    const conv = await conversation(SALON, "994501112233")
    await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: conv.id, referral: readAdReferral(AD_MESSAGE)! }))

    const second = readAdReferral({ ...AD_MESSAGE, referral: { ...AD_MESSAGE.referral, source_id: "120210000000222", headline: "Qış kampaniyası" } })!
    const wrote = await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: conv.id, referral: second }))

    expect(wrote).toBe(false)
    const saved = await row(conv.id)
    expect(saved.adSourceId).toBe("120210000000111")
    expect(saved.adHeadline).toBe("Payız endirimi — 30 %")
  })

  it("leaves the conversation's other metadata alone", async () => {
    const conv = await conversation(SALON, "994501112233", { qualificationLeadId: "lead-77", webChatSessionKey: "s-1" })
    await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: conv.id, referral: readAdReferral(AD_MESSAGE)! }))

    const metadata = (await row(conv.id)).metadata as Record<string, unknown>
    expect(metadata.qualificationLeadId).toBe("lead-77")
    expect(metadata.webChatSessionKey).toBe("s-1")
    expect(metadata.adReferral).toBeTruthy()
  })

  it("does not write onto another organization's conversation", async () => {
    const theirs = await conversation(OTHER, "994555556677")
    const wrote = await runWithTenant(SALON, () => recordAdReferral({ orgId: SALON, conversationId: theirs.id, referral: readAdReferral(AD_MESSAGE)! }))

    expect(wrote).toBe(false)
    expect((await row(theirs.id)).adReferralAt).toBeNull()
  })

  it("writes nothing for a message that carries no ad", async () => {
    const conv = await conversation(SALON, "994501112233")
    // An ordinary message, an empty referral, and one that names no source at
    // all — none of them should put a badge on the conversation.
    expect(readAdReferral({ from: "994501112233", text: { body: "Salam" } })).toBeNull()
    expect(readAdReferral({ ...AD_MESSAGE, referral: {} })).toBeNull()
    expect(readAdReferral({ ...AD_MESSAGE, referral: { source_type: "ad", headline: "No source" } })).toBeNull()
    expect((await row(conv.id)).adReferralAt).toBeNull()
  })

  it("caps what an outsider can put on the screen", async () => {
    // Everything in the referral is attacker-controlled text that the inbox
    // renders; a headline the length of a book is a layout bug waiting.
    const long = readAdReferral({ ...AD_MESSAGE, referral: { ...AD_MESSAGE.referral, headline: "x".repeat(5000), body: "y".repeat(5000) } })!
    expect(long.headline?.length).toBe(200)
    expect(long.body?.length).toBe(400)
  })
})
