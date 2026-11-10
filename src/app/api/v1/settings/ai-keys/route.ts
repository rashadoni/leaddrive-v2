import { NextResponse } from "next/server"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin, type Role } from "@/lib/permissions"
import {
  AI_PROVIDERS, deleteTenantAiCredential, isSelfKeyProvider, listTenantAiCredentials, saveTenantAiCredential,
  verifyProviderKey, type AiProvider,
} from "@/lib/ai/gateway"
import { providerUses } from "@/lib/ai/gateway/provider-uses"

/**
 * The organization's own AI provider keys («Настройки → ИИ и расходы»).
 *
 * GET    — each provider: the key's last four characters and state, never the key;
 *          which of the organization's modules call it, and its 30-day spend.
 * PUT    { provider, key } — checked at the provider with a free request, then
 *        sealed and saved; a key the provider refuses is not saved.
 * DELETE ?provider= — back to the platform's key (if the superadmin allows it).
 *
 * Admins only. Only providers whose every call goes through the gateway take a
 * key today (`SELF_KEY_PROVIDERS`); a key for another would sit unused.
 */
const isProvider = (value: unknown): value is AiProvider =>
  typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value)

async function state(orgId: string) {
  const [org, keys, providers] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { aiPlatformKey: true } }),
    listTenantAiCredentials(orgId),
    // Which of its modules call each provider, and what each cost in 30 days.
    providerUses(orgId),
  ])
  return { platformAllowed: org?.aiPlatformKey !== false, keys, providers }
}

export const GET = withRlsSessionAuth(async (_req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  return NextResponse.json({ data: await state(auth.orgId) })
})

export const PUT = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const body = await req.json().catch(() => null) as { provider?: unknown; key?: unknown } | null
  const provider = body?.provider
  const key = typeof body?.key === "string" ? body.key.trim() : ""
  if (!isProvider(provider) || !isSelfKeyProvider(provider)) {
    return NextResponse.json({ error: "This provider does not take an own key yet", code: "PROVIDER_NOT_OPEN" }, { status: 400 })
  }
  if (key.length < 20 || key.length > 512 || /\s/.test(key)) {
    return NextResponse.json({ error: "That does not look like a key", code: "KEY_MALFORMED" }, { status: 400 })
  }
  const check = await verifyProviderKey(provider, key)
  if (check === "invalid") return NextResponse.json({ error: "The provider refused this key", code: "KEY_REFUSED" }, { status: 400 })
  if (check === "unreachable") {
    return NextResponse.json({ error: "Could not reach the provider to check the key; try again", code: "PROVIDER_UNREACHABLE" }, { status: 502 })
  }
  const saved = await saveTenantAiCredential({ orgId: auth.orgId, provider, secret: key, userId: auth.userId, status: "ok" })
  await logAudit(auth.orgId, "update", "ai_provider_key", provider, provider, {
    userId: auth.userId, newValue: { provider, keyHint: saved.keyHint },
  })
  return NextResponse.json({ data: await state(auth.orgId) })
})

export const DELETE = withRlsSessionAuth(async (req, auth) => {
  if (!isAdmin(auth.role as Role)) return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  const provider = new URL(req.url).searchParams.get("provider")
  if (!isProvider(provider)) return NextResponse.json({ error: "Unknown provider" }, { status: 400 })
  await deleteTenantAiCredential(auth.orgId, provider)
  await logAudit(auth.orgId, "delete", "ai_provider_key", provider, provider, { userId: auth.userId })
  return NextResponse.json({ data: await state(auth.orgId) })
})
