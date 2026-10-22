import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { aiReplyEnabled } from "@/lib/inbox/reply-mode"
import { withWhatsAppAiReplyGuard } from "@/lib/inbox/whatsapp-ai-reply-guard"

export const AI_TEST_MAX_ATTEMPTS = 3
export const AI_TEST_DURATION_MS = 20 * 60_000
export const AI_TEST_KEY = "whatsappAiTest"

type TestRun = {
  runId: string
  conversationId: string
  recipientPhone: string
  expiresAt: string
  maxAttempts: number
  attemptsUsed: number
  lastClaimId?: string
}
export type AiTestBinding = { organizationId: string; channelConfigId: string; conversationId: string; phone: string }
export type AiTestClaim = { runId: string; claimId: string }

export function settingsObject(value: unknown): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue> : {}
}

export function normalizeAiTestPhone(value: string): string | null {
  const phone = value.trim().replace(/[\s()-]/g, "")
  return /^\+?[1-9]\d{6,14}$/.test(phone) ? phone.replace(/^\+/, "") : null
}

export function hasWhatsAppAiTest(settings: unknown): boolean {
  return Object.prototype.hasOwnProperty.call(settingsObject(settings), AI_TEST_KEY)
}

export function readWhatsAppAiTest(settings: unknown): TestRun | null {
  const value = settingsObject(settings)[AI_TEST_KEY]
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const run = value as unknown as TestRun
  if (typeof run.runId !== "string" || !run.runId || typeof run.conversationId !== "string" || !run.conversationId
    || typeof run.recipientPhone !== "string" || normalizeAiTestPhone(run.recipientPhone) !== run.recipientPhone
    || typeof run.expiresAt !== "string" || !Number.isFinite(Date.parse(run.expiresAt))
    || !Number.isInteger(run.maxAttempts) || run.maxAttempts < 1 || run.maxAttempts > AI_TEST_MAX_ATTEMPTS
    || !Number.isInteger(run.attemptsUsed) || run.attemptsUsed < 0 || run.attemptsUsed > run.maxAttempts) return null
  return run
}

/** Test settings override the ordinary channel-wide AI switch. Invalid/expired tests fail closed. */
export function aiTestMatches(settings: unknown, binding: Pick<AiTestBinding, "conversationId" | "phone">, now = Date.now()): boolean {
  const run = readWhatsAppAiTest(settings)
  return settingsObject(settings).replyMode === "agent" && !!run
    && run.conversationId === binding.conversationId
    && normalizeAiTestPhone(binding.phone) === run.recipientPhone
    && Date.parse(run.expiresAt) > now
}

export function aiTestView(settings: unknown) {
  const run = readWhatsAppAiTest(settings)
  return run ? {
    runId: run.runId, conversationId: run.conversationId,
    recipientLast4: run.recipientPhone.slice(-4), expiresAt: run.expiresAt,
    attemptsUsed: run.attemptsUsed, maxAttempts: run.maxAttempts,
    active: settingsObject(settings).replyMode === "agent" && Date.parse(run.expiresAt) > Date.now() && run.attemptsUsed < run.maxAttempts,
  } : null
}

async function eligibleConversation(binding: AiTestBinding) {
  const conversation = await prisma.socialConversation.findFirst({
    where: { id: binding.conversationId, organizationId: binding.organizationId, channelConfigId: binding.channelConfigId, platform: "whatsapp", deletedAt: null },
    select: { externalId: true, status: true, assignedTo: true, metadata: true, contactId: true },
  })
  if (!conversation || conversation.status !== "open" || conversation.assignedTo
    || normalizeAiTestPhone(conversation.externalId) !== normalizeAiTestPhone(binding.phone)
    || settingsObject(conversation.metadata).whatsappOptedOut === true) return false
  if (conversation.contactId) {
    const preference = await prisma.channelPreference.findFirst({
      where: { organizationId: binding.organizationId, contactId: conversation.contactId, channel: "whatsapp" },
      select: { isOptedIn: true },
    })
    if (preference?.isOptedIn === false) return false
  }
  return true
}

const channelWhere = (binding: Pick<AiTestBinding, "organizationId" | "channelConfigId">) => ({
  id: binding.channelConfigId, organizationId: binding.organizationId, channelType: "whatsapp", isActive: true,
})

export async function startWhatsAppAiTest(binding: AiTestBinding) {
  const phone = normalizeAiTestPhone(binding.phone)
  if (!phone || !await eligibleConversation(binding)) throw new Error("Test conversation is not eligible")
  const cfg = await prisma.channelConfig.findFirst({ where: channelWhere(binding), select: { settings: true } })
  if (!cfg || settingsObject(cfg.settings).replyMode !== "agent") throw new Error("Keep the channel in agent mode before testing")
  const oldRun = readWhatsAppAiTest(cfg.settings)
  if (oldRun && Date.parse(oldRun.expiresAt) > Date.now()) throw new Error("A test is already active; stop it first")
  const run: TestRun = { runId: randomUUID(), conversationId: binding.conversationId, recipientPhone: phone,
    expiresAt: new Date(Date.now() + AI_TEST_DURATION_MS).toISOString(), maxAttempts: AI_TEST_MAX_ATTEMPTS, attemptsUsed: 0 }
  const next = { ...settingsObject(cfg.settings), [AI_TEST_KEY]: run as unknown as Prisma.JsonObject }
  const saved = await prisma.channelConfig.updateMany({
    where: { ...channelWhere(binding), settings: { equals: cfg.settings ?? Prisma.JsonNull } }, data: { settings: next },
  })
  if (saved.count !== 1) throw new Error("Channel settings changed; reload before testing")
  return aiTestView(next)
}

/** A consumed generation attempt is never refunded after failure/timeout. CAS prevents parallel over-allocation. */
export async function claimWhatsAppAiTest(binding: AiTestBinding): Promise<AiTestClaim | null> {
  if (!await eligibleConversation(binding)) return null
  for (let retry = 0; retry < 3; retry++) {
    const cfg = await prisma.channelConfig.findFirst({ where: channelWhere(binding), select: { settings: true } })
    const run = readWhatsAppAiTest(cfg?.settings)
    if (!cfg || !run || !aiTestMatches(cfg.settings, binding) || run.attemptsUsed >= run.maxAttempts) return null
    const claimId = randomUUID()
    const next = { ...settingsObject(cfg.settings), [AI_TEST_KEY]: { ...run, attemptsUsed: run.attemptsUsed + 1, lastClaimId: claimId } }
    const saved = await prisma.channelConfig.updateMany({
      where: { ...channelWhere(binding), settings: { equals: cfg.settings ?? Prisma.JsonNull } }, data: { settings: next },
    })
    if (saved.count === 1) return { runId: run.runId, claimId }
  }
  return null
}

/** Re-read immediately before generation side effects and the provider call. Stopping/expiry/STOP suppresses an in-flight generation. */
export async function stillInWhatsAppAiTest(binding: AiTestBinding, claim: AiTestClaim) {
  const cfg = await prisma.channelConfig.findFirst({ where: channelWhere(binding), select: { settings: true } })
  const run = readWhatsAppAiTest(cfg?.settings)
  return !!run && run.runId === claim.runId && run.lastClaimId === claim.claimId
    && aiTestMatches(cfg?.settings, binding) && await eligibleConversation(binding)
}

export async function stopWhatsAppAiTest(binding: Pick<AiTestBinding, "organizationId" | "channelConfigId">) {
  for (let retry = 0; retry < 3; retry++) {
    const cfg = await prisma.channelConfig.findFirst({ where: channelWhere(binding), select: { settings: true } })
    if (!cfg) throw new Error("Channel not found")
    const next = { ...settingsObject(cfg.settings) }
    if (!hasWhatsAppAiTest(next)) return
    delete next[AI_TEST_KEY]
    const saved = await prisma.channelConfig.updateMany({
      where: { ...channelWhere(binding), settings: { equals: cfg.settings ?? Prisma.JsonNull } }, data: { settings: next },
    })
    if (saved.count === 1) return
  }
  throw new Error("Channel settings changed; reload before stopping")
}

/** The webhook's native AI entry point. Test mode never falls through to global AI. */
export async function withWhatsAppAiPolicy(
  binding: AiTestBinding,
  settings: unknown,
  operation: (stillOwned: () => Promise<boolean>, testRunId?: string) => Promise<void>,
) {
  const testMode = hasWhatsAppAiTest(settings)
  const rawMode = settingsObject(settings).replyMode
  const replyMode = typeof rawMode === "string" ? rawMode : undefined
  if (testMode ? !aiTestMatches(settings, binding) : !aiReplyEnabled(replyMode, true)) return
  await withWhatsAppAiReplyGuard(binding.organizationId, binding.conversationId, async (stillOwned) => {
    if (!testMode) return operation(stillOwned)
    const claim = await claimWhatsAppAiTest(binding)
    if (!claim) return
    const stillAllowed = async () => await stillOwned() && await stillInWhatsAppAiTest(binding, claim)
    if (await stillAllowed()) await operation(stillAllowed, claim.runId)
  })
}
