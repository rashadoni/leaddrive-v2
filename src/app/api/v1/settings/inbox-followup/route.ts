import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { setOrgFeatureFlag } from "@/lib/org-features"
import { featureFlagsToArray } from "@/lib/modules"

/**
 * Settings for the 24h-silence auto-follow-up (see src/lib/inbox/followup-cron.ts).
 * Surfaces the two knobs the cron reads, so the user self-serves without touching the DB:
 *   • enabled — the org `inboxFollowUp` feature flag (the cron gates on it);
 *   • message — ChannelConfig(chatwoot).settings.followUpMessage (per-channel text override;
 *     blank → the engine falls back to DEFAULT_FOLLOWUP).
 *
 * GET   /api/v1/settings/inbox-followup
 * PATCH /api/v1/settings/inbox-followup  { enabled?: boolean, message?: string }
 */
const FLAG = "inboxFollowUp"

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  message: z.string().max(1000).optional(),
})

async function readState(orgId: string) {
  const [org, cfg] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { features: true } }),
    prisma.channelConfig.findFirst({
      where: { organizationId: orgId, channelType: "chatwoot", isActive: true },
      select: { settings: true },
    }),
  ])
  const features = featureFlagsToArray(org?.features)
  const settings = (cfg?.settings && typeof cfg.settings === "object" ? cfg.settings : {}) as Record<string, unknown>
  return {
    enabled: features.includes(FLAG),
    message: typeof settings.followUpMessage === "string" ? settings.followUpMessage : "",
    channelConnected: !!cfg, // false → there is no TikTok/Chatwoot channel to follow up on yet
  }
}

export const GET = withRls(async (_req, { orgId }) => {
  return NextResponse.json({ data: await readState(orgId) })
})

// PATCH flips a customer-facing automation (the nudge flag) + edits the outgoing text →
// gate behind settings:write RBAC, not just tenant scope. GET stays withRls (read-only).
export const PATCH = withRlsAuth("settings", "write", async (req, { orgId }) => {
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const { enabled, message } = parsed.data

  // 1) Flag toggle — ATOMIC (no read-modify-write race; shared helper, see setOrgFeatureFlag).
  if (enabled !== undefined) {
    await setOrgFeatureFlag(orgId, FLAG, enabled)
  }

  // 2) Text override — MERGE into the chatwoot channel settings so auth/config keys
  //    (replyMode, accountId, webhookSecret, ...) are never clobbered.
  if (message !== undefined) {
    const cfg = await prisma.channelConfig.findFirst({
      where: { organizationId: orgId, channelType: "chatwoot", isActive: true },
      select: { id: true, settings: true },
    })
    if (cfg) {
      const current = (cfg.settings && typeof cfg.settings === "object" ? cfg.settings : {}) as Record<string, unknown>
      await prisma.channelConfig.update({
        where: { id: cfg.id },
        data: { settings: { ...current, followUpMessage: message.trim() } },
      })
    }
  }

  return NextResponse.json({ data: await readState(orgId) })
})
