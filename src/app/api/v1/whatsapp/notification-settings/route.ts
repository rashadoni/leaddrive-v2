import { selectWhatsAppSettingsChannel } from "@/lib/channels/whatsapp-settings-channel"
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { withRls } from "@/lib/with-rls"

// GET/PUT /api/v1/whatsapp/notification-settings
//
// Stores three keys under ChannelConfig(whatsapp).settings:
//
//   whatsappTicketStatusTemplates: { [status: string]: string }
//     — per-status WhatsApp template mapping for ticket status notifications.
//       Status keys must match the TicketStatus enum (new, open, in_progress,
//       waiting, resolved, closed, escalated).
//
//   whatsappSurveyTemplate: string
//     — template to use for survey invites sent via WhatsApp.
//
//   whatsappJourneyDefaultTemplate: string
//     — fallback template for journey `send_whatsapp` step when step.config
//       doesn't name one explicitly.
//
// Empty string / null values mean "do not send that notification" — the
// runtime silently skips (see tickets/[id]/route.ts, survey-triggers.ts,
// journey-engine.ts).

const TICKET_STATUSES = ["new", "open", "in_progress", "waiting", "resolved", "closed", "escalated"] as const

const putSchema = z.object({
  whatsappTicketStatusTemplates: z.record(z.string(), z.string()).optional(),
  whatsappSurveyTemplate: z.string().optional(),
  whatsappJourneyDefaultTemplate: z.string().optional(),
})

export const GET = withRls(async (req, { orgId }) => {
  const selection = await selectWhatsAppSettingsChannel(orgId, new URL(req.url).searchParams.get("channelConfigId"))
  if (!selection.id) return NextResponse.json({ success: false, error: selection.error }, { status: selection.error === "whatsapp_channel_required" ? 409 : 404 })


  const cfg = await prisma.channelConfig.findFirst({
    where: { id: selection.id, organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
  })

  if (!cfg) {
    return NextResponse.json({
      success: false,
      error: "WhatsApp not configured",
      hint: "Configure your WABA credentials in /settings/channels before setting notification templates.",
    }, { status: 404 })
  }

  const s = (cfg.settings as Record<string, unknown> | null) || {}
  return NextResponse.json({
    success: true,
    data: {
      whatsappTicketStatusTemplates: s.whatsappTicketStatusTemplates || {},
      whatsappSurveyTemplate: s.whatsappSurveyTemplate || "",
      whatsappJourneyDefaultTemplate: s.whatsappJourneyDefaultTemplate || "",
    },
    ticketStatuses: TICKET_STATUSES,
    legacyFallbackEnabled: !Object.hasOwn(s, "whatsappTicketStatusTemplates") || !Object.hasOwn(s, "whatsappSurveyTemplate"),
  })
})

export const PUT = withRls(async (req, { orgId }) => {
  const selection = await selectWhatsAppSettingsChannel(orgId, new URL(req.url).searchParams.get("channelConfigId"))
  if (!selection.id) return NextResponse.json({ success: false, error: selection.error }, { status: selection.error === "whatsapp_channel_required" ? 409 : 404 })


  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 })
  }

  const cfg = await prisma.channelConfig.findFirst({
    where: { id: selection.id, organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
  })
  if (!cfg) {
    return NextResponse.json({ error: "WhatsApp not configured" }, { status: 404 })
  }

  // A blank selection is persisted as an explicit opt-out from this automatic
  // notification. An absent key belongs to legacy configuration.
  const patch: Record<string, Prisma.InputJsonValue> = {}

  if (parsed.data.whatsappTicketStatusTemplates !== undefined) {
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed.data.whatsappTicketStatusTemplates)) {
      if (v && TICKET_STATUSES.includes(k as typeof TICKET_STATUSES[number])) cleaned[k] = v
    }
    patch.whatsappTicketStatusTemplates = cleaned
  }

  if (parsed.data.whatsappSurveyTemplate !== undefined) {
    patch.whatsappSurveyTemplate = parsed.data.whatsappSurveyTemplate || ""
  }

  if (parsed.data.whatsappJourneyDefaultTemplate !== undefined) {
    patch.whatsappJourneyDefaultTemplate = parsed.data.whatsappJourneyDefaultTemplate || ""
  }

  const existing = (cfg.settings as Prisma.InputJsonObject | null) || {}
  const merged = { ...existing, ...patch }

  // Empty values are intentional "do not send" choices, distinct from legacy
  // settings that predate notification configuration. Preserve them.

  await prisma.channelConfig.update({
    where: { id: cfg.id },
    data: { settings: merged },
  })

  return NextResponse.json({ success: true, data: merged })
})
