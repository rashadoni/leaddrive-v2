import { NextResponse } from "next/server"
import { z } from "zod"
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

export const GET = withRls(async (_req, { orgId }) => {

  const cfg = await prisma.channelConfig.findFirst({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
  })

  if (!cfg) {
    return NextResponse.json({
      success: false,
      error: "WhatsApp not configured",
      hint: "Configure your WABA credentials in /settings/channels before setting notification templates.",
    }, { status: 404 })
  }

  const s = (cfg.settings as any) || {}
  return NextResponse.json({
    success: true,
    data: {
      whatsappTicketStatusTemplates: s.whatsappTicketStatusTemplates || {},
      whatsappSurveyTemplate: s.whatsappSurveyTemplate || "",
      whatsappJourneyDefaultTemplate: s.whatsappJourneyDefaultTemplate || "",
    },
    ticketStatuses: TICKET_STATUSES,
  })
})

export const PUT = withRls(async (req, { orgId }) => {

  const body = await req.json().catch(() => null)
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid body", issues: parsed.error.issues }, { status: 400 })
  }

  const cfg = await prisma.channelConfig.findFirst({
    where: { organizationId: orgId, channelType: "whatsapp", isActive: true },
    select: { id: true, settings: true },
  })
  if (!cfg) {
    return NextResponse.json({ error: "WhatsApp not configured" }, { status: 404 })
  }

  // Drop empty values so the settings blob doesn't accumulate noise. If the
  // user cleared a dropdown, we actually *remove* the key — the runtime
  // treats "missing" and "empty string" the same (silently skip), but a
  // smaller JSON is nicer to read in SQL and in UI later.
  const patch: Record<string, any> = {}

  if (parsed.data.whatsappTicketStatusTemplates !== undefined) {
    const cleaned: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed.data.whatsappTicketStatusTemplates)) {
      if (v && TICKET_STATUSES.includes(k as any)) cleaned[k] = v
    }
    patch.whatsappTicketStatusTemplates = cleaned
  }

  if (parsed.data.whatsappSurveyTemplate !== undefined) {
    patch.whatsappSurveyTemplate = parsed.data.whatsappSurveyTemplate || null
  }

  if (parsed.data.whatsappJourneyDefaultTemplate !== undefined) {
    patch.whatsappJourneyDefaultTemplate = parsed.data.whatsappJourneyDefaultTemplate || null
  }

  const existing = (cfg.settings as any) || {}
  const merged = { ...existing, ...patch }

  // Null values: drop them from the final object so we don't persist dead keys.
  for (const [k, v] of Object.entries(merged)) {
    if (v === null || v === "") delete merged[k]
  }
  // Empty map also drops.
  if (merged.whatsappTicketStatusTemplates && Object.keys(merged.whatsappTicketStatusTemplates).length === 0) {
    delete merged.whatsappTicketStatusTemplates
  }

  await prisma.channelConfig.update({
    where: { id: cfg.id },
    data: { settings: merged },
  })

  return NextResponse.json({ success: true, data: merged })
})
