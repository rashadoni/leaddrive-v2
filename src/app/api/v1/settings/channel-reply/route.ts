import { NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsSessionAuth } from "@/lib/with-rls"
import { isAdmin } from "@/lib/constants"
import { readJsonRequestWithinLimit } from "@/lib/request-body-limit"
import { dedicatedChannelTypeError, isDedicatedChannelType } from "@/lib/channels/dedicated-channel-types"

/**
 * Per-channel reply routing settings — the data layer behind the "AI vs agent"
 * settings matrix. Each ChannelConfig carries its reply policy inside its existing
 * `settings` JSON (no schema change):
 *   replyMode        "agent" | "ai" | "rules" | "off"   (default "agent"; unset WhatsApp defaults to "ai")
 *   afterHoursAi     boolean   — AI only outside business hours (agent in-hours)
 *   outOfOffice      { enabled, message }                — auto-reply outside hours
 *   draftMode        boolean   — AI drafts a suggestion, agent sends (no auto-send)
 *   escalateKeywords string[]  — words that hand the conversation to a human
 *
 * IMPORTANT: PATCH MERGES into the existing settings — it must never clobber a
 * channel's auth/config keys (chatwoot baseUrl/accountId/webhookSecret, telegram
 * chatId, etc.). The chatwoot/TikTok, Facebook, and Instagram webhooks ENFORCE
 * replyMode (default "agent" = no AI); WhatsApp/Telegram/SMS/VK store it but their
 * webhooks don't act on it yet — a follow-up slice.
 *
 * Only conversation channels have a reply policy. A row of a type that has a screen of its own
 * (lib/channels/dedicated-channel-types) is not listed, and PATCH refuses it with 403. Decided
 * per type, 2026-09-21:
 *   social_monitoring  Social Monitoring's "Monitoring providers" and "Monitoring scenarios"
 *                      rows. Nothing reads a reply policy there, and both of their writers
 *                      replace `settings` whole on every save, so a policy set here showed in
 *                      the matrix until that save, then vanished.
 *   slack, teams       outbound notification hooks from Integrations: nothing comes in to answer.
 *   voip               calls. The voice agent answers by the switches on the VoIP screen
 *                      (voiceAgentEnabled / voiceAgentMode, api/v1/voip/config); no call or
 *                      voice-agent path reads a reply policy from the row.
 *
 * GET   /api/v1/settings/channel-reply — list the conversation channels + their reply policy
 * PATCH /api/v1/settings/channel-reply — update one channel's reply policy (by configId)
 */

const REPLY_MODES = ["agent", "ai", "rules", "off"] as const
const MAX_REPLY_POLICY_BODY_BYTES = 16 * 1024

function requireReplyPolicyAdmin(role: string): Response | null {
  return isAdmin(role)
    ? null
    : NextResponse.json({ error: "Forbidden" }, { status: 403 })
}

/** Extract the reply-policy view from a ChannelConfig.settings blob (with defaults). */
function readReplyPolicy(settings: unknown, channelType?: string) {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>
  const oo = (s.outOfOffice && typeof s.outOfOffice === "object" ? s.outOfOffice : {}) as Record<string, unknown>
  // WhatsApp's AI (Da Vinci) is default-ON, so an unset whatsapp channel reads as "ai" (not the
  // generic "agent" default) — matching the webhook's `!== "agent"` gate (lib/inbox/reply-mode).
  const explicitMode = (REPLY_MODES as readonly string[]).includes(s.replyMode as string) ? (s.replyMode as string) : null
  const fallbackMode = channelType === "whatsapp" ? "ai" : "agent"
  return {
    mode: explicitMode ?? fallbackMode,
    modeDefaulted: explicitMode === null,
    modeSource: explicitMode !== null ? "explicit" : channelType === "whatsapp" ? "whatsapp_default_ai" : "default_agent",
    afterHoursAi: s.afterHoursAi === true,
    draftMode: s.draftMode === true,
    // A2 — auto-send confidence threshold (A1 judge total). null = gating off (send everything,
    // pre-A2 behavior). Presets: Cautious 0.85 / Balanced 0.70 / Bold 0.55, any 0..1 accepted.
    aiThreshold: typeof s.aiThreshold === "number" && s.aiThreshold >= 0 && s.aiThreshold <= 1 ? s.aiThreshold : null,
    // A3 — audience rollout: share of inbound conversations the AI handles. null = everyone.
    aiRolloutPercent:
      typeof s.aiRolloutPercent === "number" && Number.isInteger(s.aiRolloutPercent) && s.aiRolloutPercent >= 0 && s.aiRolloutPercent <= 100
        ? s.aiRolloutPercent
        : null,
    outOfOffice: { enabled: oo.enabled === true, message: typeof oo.message === "string" ? oo.message : "" },
    escalateKeywords: Array.isArray(s.escalateKeywords)
      ? (s.escalateKeywords as unknown[]).filter((k): k is string => typeof k === "string")
      : [],
  }
}

export const GET = withRlsSessionAuth(async (_req, auth) => {
  const denial = requireReplyPolicyAdmin(auth.role)
  if (denial) return denial

  const rows = await prisma.channelConfig.findMany({
    where: { organizationId: auth.orgId },
    select: { id: true, channelType: true, configName: true, isActive: true, settings: true },
    orderBy: { channelType: "asc" },
  })
  // Conversation channels only — see the header.
  const channels = rows.filter((c: { channelType: string }) => !isDedicatedChannelType(c.channelType))

  return NextResponse.json({
    data: {
      channels: channels.map((c: { id: string; channelType: string; configName: string; isActive: boolean; settings: unknown }) => ({
        id: c.id,
        channelType: c.channelType,
        configName: c.configName,
        isActive: c.isActive,
        reply: readReplyPolicy(c.settings, c.channelType),
      })),
    },
  })
})

const patchSchema = z.object({
  configId: z.string().trim().min(1).max(128),
  mode: z.enum(REPLY_MODES).optional(),
  afterHoursAi: z.boolean().optional(),
  draftMode: z.boolean().optional(),
  aiThreshold: z.number().min(0).max(1).nullable().optional(),
  aiRolloutPercent: z.number().int().min(0).max(100).nullable().optional(),
  outOfOffice: z.object({ enabled: z.boolean(), message: z.string().max(2000).optional() }).optional(),
  escalateKeywords: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
}).strict()

export const PATCH = withRlsSessionAuth(async (req, auth) => {
  const denial = requireReplyPolicyAdmin(auth.role)
  if (denial) return denial

  const requestBody = await readJsonRequestWithinLimit(req, MAX_REPLY_POLICY_BODY_BYTES)
  if (!requestBody.ok) {
    return NextResponse.json(
      { error: requestBody.reason === "too_large" ? "Request body too large" : "Invalid request" },
      { status: requestBody.reason === "too_large" ? 413 : 400 },
    )
  }
  const parsed = patchSchema.safeParse(requestBody.value)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { configId, mode, afterHoursAi, draftMode, aiThreshold, aiRolloutPercent, outOfOffice, escalateKeywords } = parsed.data

  // Org-scope guard (belt-and-braces over RLS): the config must belong to this org.
  const cfg = await prisma.channelConfig.findFirst({
    where: { id: configId, organizationId: auth.orgId },
    select: { id: true, channelType: true, settings: true },
  })
  if (!cfg) return NextResponse.json({ error: "Channel not found" }, { status: 404 })
  // Not a conversation channel (see the header): nothing would read the policy, and the row's own
  // screen owns its settings.
  const dedicatedError = dedicatedChannelTypeError(cfg.channelType)
  if (dedicatedError) return NextResponse.json({ error: dedicatedError }, { status: 403 })

  // MERGE — preserve every existing settings key (auth/config), override only the
  // reply-policy fields that were sent.
  const current = (cfg.settings && typeof cfg.settings === "object" ? cfg.settings : {}) as Record<string, unknown>
  const next: Record<string, unknown> = { ...current }
  if (mode !== undefined) next.replyMode = mode
  if (afterHoursAi !== undefined) next.afterHoursAi = afterHoursAi
  if (draftMode !== undefined) next.draftMode = draftMode
  if (aiThreshold !== undefined) {
    // null unsets (gating off); a number arms threshold gating for this channel.
    if (aiThreshold === null) delete next.aiThreshold
    else next.aiThreshold = aiThreshold
  }
  if (aiRolloutPercent !== undefined) {
    // null unsets (everyone); an int 0..100 caps the AI's share of conversations.
    if (aiRolloutPercent === null) delete next.aiRolloutPercent
    else next.aiRolloutPercent = aiRolloutPercent
  }
  // NOTE: replaces the whole outOfOffice object — if more sub-fields are added later,
  // a partial PATCH would drop them; merge sub-fields then (both are required today).
  if (outOfOffice !== undefined) next.outOfOffice = { enabled: outOfOffice.enabled, message: outOfOffice.message ?? "" }
  if (escalateKeywords !== undefined) {
    // dedupe + drop blanks
    next.escalateKeywords = [...new Set(escalateKeywords.map((k) => k.trim()).filter(Boolean))]
  }

  await prisma.channelConfig.update({ where: { id: cfg.id }, data: { settings: next } })

  await logAudit(
    auth.orgId,
    "channel_reply_policy_updated",
    "channelConfig",
    cfg.id,
    cfg.channelType,
    {
      userId: auth.userId,
      oldValue: { reply: readReplyPolicy(current, cfg.channelType) },
      newValue: { reply: readReplyPolicy(next, cfg.channelType) },
    },
  )

  return NextResponse.json({ data: { reply: readReplyPolicy(next, cfg.channelType) } })
})
