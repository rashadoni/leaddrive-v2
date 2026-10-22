import { randomUUID } from "node:crypto"
import { PrismaClient, type Prisma } from "@prisma/client"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
const fixture = vi.hoisted(() => ({ prisma: null as unknown as PrismaClient }))
vi.mock("@/lib/prisma", () => ({ get prisma() { return fixture.prisma } }))
vi.mock("@/lib/inbox/whatsapp-ai-reply-guard", () => ({ withWhatsAppAiReplyGuard: vi.fn() }))
import { claimWhatsAppAiTest, startWhatsAppAiTest, stillInWhatsAppAiTest, stopWhatsAppAiTest } from "@/lib/inbox/whatsapp-ai-test"

const url = process.env.WHATSAPP_AI_TEST_DATABASE_URL
const schema = `wa_ai_test_${randomUUID().replaceAll("-", "")}`
const binding = { organizationId: "org-test", channelConfigId: "channel-test", conversationId: "conversation-test", phone: "+15550001001" }
// A deliberately disposable, local database: never accept production credentials.
const pg = url ? new URL(url) : null
if (pg && (!new Set(["localhost", "127.0.0.1"]).has(pg.hostname) || pg.pathname !== "/whatsapp_ai_test")) throw new Error("Use the isolated local whatsapp_ai_test database")
const localDescribe = url ? describe : describe.skip
localDescribe("WhatsApp AI test real PostgreSQL JSON CAS", () => {
  let admin: PrismaClient
  beforeAll(async () => {
    admin = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: url! } } })
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    const scoped = new URL(url!)
    scoped.searchParams.set("schema", schema)
    fixture.prisma = new PrismaClient<Prisma.PrismaClientOptions>({ datasources: { db: { url: scoped.toString() } } })
    await fixture.prisma.$executeRawUnsafe(`CREATE TABLE channel_configs (id text PRIMARY KEY, "organizationId" text, "channelType" text, "isActive" boolean, settings jsonb, "updatedAt" timestamp DEFAULT now())`)
    await fixture.prisma.$executeRawUnsafe(`CREATE TABLE social_conversations (id text PRIMARY KEY, "organizationId" text, "channelConfigId" text, platform text, "deletedAt" timestamp, "externalId" text, status text, "assignedTo" text, metadata jsonb, "contactId" text)`)
    await fixture.prisma.$executeRawUnsafe(`INSERT INTO channel_configs (id,"organizationId","channelType","isActive",settings) VALUES ('channel-test','org-test','whatsapp',true,'{"replyMode":"agent","unrelatedSetting":{"keep":true}}')`)
    await fixture.prisma.$executeRawUnsafe(`INSERT INTO social_conversations (id,"organizationId","channelConfigId",platform,"externalId",status,metadata) VALUES ('conversation-test','org-test','channel-test','whatsapp','15550001001','open','{}')`)
  })
  afterAll(async () => {
    await fixture.prisma?.$disconnect()
    if (admin) { await admin.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`); await admin.$disconnect() }
  })
  it("admits exactly three of 20 concurrent claims, isolates tenants and stops a pending generation", async () => {
    await startWhatsAppAiTest(binding)
    expect(await claimWhatsAppAiTest({ ...binding, organizationId: "other-org" })).toBeNull()
    expect(await claimWhatsAppAiTest({ ...binding, channelConfigId: "other-channel" })).toBeNull()
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimWhatsAppAiTest(binding)))
    expect(claims.filter(Boolean)).toHaveLength(3)
    const row = await fixture.prisma.channelConfig.findFirst({ where: { id: binding.channelConfigId }, select: { settings: true } })
    expect(row!.settings).toMatchObject({ replyMode: "agent", unrelatedSetting: { keep: true }, whatsappAiTest: { attemptsUsed: 3 } })
    const stillValid = await Promise.all(claims.filter(Boolean).map(claim => stillInWhatsAppAiTest(binding, claim!)))
    expect(stillValid.filter(Boolean)).toHaveLength(1)
    await stopWhatsAppAiTest(binding)
    for (const claim of claims.filter(Boolean)) expect(await stillInWhatsAppAiTest(binding, claim!)).toBe(false)
    const stopped = await fixture.prisma.channelConfig.findFirst({ where: { id: binding.channelConfigId }, select: { settings: true } })
    expect(stopped!.settings).toEqual({ replyMode: "agent", unrelatedSetting: { keep: true } })
  })
})
