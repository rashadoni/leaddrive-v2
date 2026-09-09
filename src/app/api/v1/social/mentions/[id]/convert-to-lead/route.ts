import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { nonNegativeFinancialAmountSchema } from "@/lib/validation/numeric"
import { prisma, logAudit } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { executeWorkflows } from "@/lib/workflow-engine"
import { createNotification } from "@/lib/notifications"
import { fireWebhooks } from "@/lib/webhooks"
import { refreshProfileForSource } from "@/lib/unified-profile/profile-builder"
import { CONVERTED_STATUS } from "@/lib/social/mention-status"
import { findSmmPipeline } from "@/lib/pipeline-routing"
import { extractPhoneNumber } from "@/lib/inbox/customer-phone"

/**
 * Optional overrides posted by the social-monitoring "create lead" dialog so the
 * rep can fill in missing contact data before the lead is created. Every field is
 * optional: when absent we fall back to values derived from the mention, which
 * preserves the original one-click behaviour for any caller that posts no body.
 * Mirrors the leads create schema (src/app/api/v1/leads/route.ts).
 */
const convertBodySchema = z
  .object({
    contactName: z.string().max(200).optional(),
    companyName: z.string().max(200).optional(),
    email: z.string().email().optional().or(z.literal("")),
    phone: z.string().max(50).optional(),
    phoneWhatsApp: z.string().max(50).optional(),
    telegramHandle: z.string().max(100).optional(),
    source: z.string().max(50).optional(),
    brand: z.string().max(100).optional(),
    category: z.string().max(50).optional(),
    status: z.enum(["new", "contacted", "qualified", "converted", "lost"]).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
    estimatedValue: nonNegativeFinancialAmountSchema.optional(),
    assignedTo: z.string().min(1).optional(),
    pipelineId: z.string().min(1).optional(),
    notes: z.string().max(5000).optional(),
  })
  .partial()

/**
 * Convert a social mention into a Lead. Atomic pattern: create the Lead, then
 * try to claim the mention with updateMany guarded on leadId=null. If another
 * request won the race we delete the orphan Lead and return 409.
 */
export const POST = withSocialMonitoringMutationFence("leads", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const userId = auth.userId
  const { id } = await params

  // Body is optional — a bare POST keeps the legacy auto-fill conversion.
  const parsed = convertBodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }
  const overrides = parsed.data

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (mention.leadId) {
    return NextResponse.json(
      { error: "Already converted", data: { leadId: mention.leadId } },
      { status: 409 },
    )
  }

  const phone = extractPhoneNumber(overrides.phone || "")
    || extractPhoneNumber(overrides.phoneWhatsApp || "")
  if (!phone) {
    return NextResponse.json(
      { error: "A valid phone number is required to create an omnichannel lead", code: "phone_required" },
      { status: 400 },
    )
  }

  // Values derived from the mention — used as fallbacks for any field the dialog
  // didn't supply (and as the full payload when no body is posted at all).
  const derivedName = mention.authorName || (mention.authorHandle ? `@${mention.authorHandle}` : `Visitor from ${mention.platform}`)
  const derivedNotes = [
    `Platform: ${mention.platform}`,
    mention.authorHandle ? `Handle: @${mention.authorHandle}` : null,
    mention.url ? `URL: ${mention.url}` : null,
    mention.sentiment ? `Sentiment: ${mention.sentiment}` : null,
    "",
    "Content:",
    mention.text,
  ].filter(Boolean).join("\n")
  const derivedPriority = mention.sentiment === "negative" ? "high" : "medium"

  const contactName = (overrides.contactName?.trim() || derivedName).slice(0, 200)
  let assignedTo = userId || null
  if (overrides.assignedTo) {
    const seller = await prisma.user.findFirst({
      where: {
        id: overrides.assignedTo,
        organizationId: orgId,
        role: "sales",
        isActive: true,
      },
      select: { id: true },
    })
    if (!seller) {
      return NextResponse.json(
        { error: "Selected seller is inactive or does not belong to this organization" },
        { status: 400 },
      )
    }
    assignedTo = seller.id
  }

  const activePipelines = await prisma.pipeline.findMany({
    where: { organizationId: orgId, isActive: true },
    select: { id: true, name: true },
  })
  const pipelineId = overrides.pipelineId ?? findSmmPipeline(activePipelines)?.id ?? null
  if (pipelineId && !activePipelines.some((pipeline) => pipeline.id === pipelineId)) {
    return NextResponse.json({ error: "Invalid pipelineId" }, { status: 400 })
  }

  const lead = await prisma.lead.create({
    data: {
      organizationId: orgId,
      contactName,
      companyName: overrides.companyName || null,
      email: overrides.email || null,
      phone,
      phoneWhatsApp: overrides.phoneWhatsApp ? phone : null,
      telegramHandle: overrides.telegramHandle || null,
      source: overrides.source || `social:${mention.platform}`,
      brand: overrides.brand || null,
      category: overrides.category || null,
      status: overrides.status || "new",
      priority: overrides.priority || derivedPriority,
      estimatedValue: overrides.estimatedValue,
      notes: overrides.notes ?? derivedNotes,
      assignedTo,
      pipelineId,
    },
  })

  const claim = await prisma.socialMention.updateMany({
    where: { id: mention.id, leadId: null },
    data: {
      leadId: lead.id,
      status: CONVERTED_STATUS.leadId,
      handledAt: new Date(),
      handledBy: userId,
    },
  })
  if (claim.count === 0) {
    await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {})
    const winner = await prisma.socialMention.findUnique({
      where: { id: mention.id },
      select: { leadId: true },
    })
    return NextResponse.json(
      { error: "Already converted", data: winner?.leadId ? { leadId: winner.leadId } : null },
      { status: 409 },
    )
  }

  // Side-effects fire only after the claim succeeds — a lead lost to the race above
  // is already deleted, so these must not run for it. Mirrors the leads create route
  // (src/app/api/v1/leads/route.ts) so a social-originated lead is first-class:
  // audit, workflows, CDP profile, notification, webhooks. Assignment rules are
  // intentionally skipped — the conversion already assigns the lead to the rep who
  // converted it (assignedTo above), which assignment rules would otherwise override.
  await logAudit(orgId, "create", "lead", lead.id, lead.contactName)
  await executeWorkflows(
    orgId,
    "lead",
    "created",
    lead,
    { awaitExternalSideEffects: true },
  ).catch((error) => {
    console.error("[social-convert] lead workflow execution failed", error)
  })
  await refreshProfileForSource(prisma, orgId, "lead", lead.id).catch((error) => {
    console.error("[cdp-hook] social-convert lead profile refresh failed", error)
  })
  await createNotification({
    organizationId: orgId,
    type: "info",
    title: "Новый лид",
    message: `Создан лид «${lead.contactName}» из ${mention.platform}`,
    entityType: "lead",
    entityId: lead.id,
  }).catch((error) => {
    console.error("[social-convert] lead notification failed", error)
  })
  await fireWebhooks(
    orgId,
    "lead.created",
    { id: lead.id, contactName: lead.contactName, companyName: lead.companyName },
    { awaitDelivery: true },
  ).catch((error) => {
    console.error("[social-convert] lead webhook failed", error)
  })

  return NextResponse.json({ success: true, data: { leadId: lead.id } })
})
