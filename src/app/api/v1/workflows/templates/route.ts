import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { WORKFLOW_TEMPLATES, getTemplateById } from "@/lib/workflow-templates"
import { isSmsConfigured } from "@/lib/sms"
import { withRlsAuth } from "@/lib/with-rls"

const applyTemplateSchema = z.object({
  templateId: z.string().min(1),
  name: z.string().max(200).optional(),
  isActive: z.boolean().optional().default(true),
  /** Force re-apply even when a rule from this template already exists. */
  force: z.boolean().optional().default(false),
  /**
   * Per-action overrides applied before the rule is created. Keyed by action
   * index (0-based). Unknown keys are ignored. Kept narrow on purpose —
   * only surfaces safe customer-facing fields.
   */
  customizations: z
    .record(
      z.string(),
      z.object({
        subject: z.string().optional(),
        body: z.string().optional(),
        message: z.string().optional(),
        title: z.string().optional(),
        delayMinutes: z.number().int().min(0).max(1440).optional(), // up to 24h delay
      })
    )
    .optional(),
})

/**
 * Returns action types that require SMS provider to be configured.
 * Used by the preflight warning so users know before applying.
 */
function smsDependentActions(template: ReturnType<typeof getTemplateById>): boolean {
  return !!template?.actions.some((a) => a.actionType === "send_sms")
}

/**
 * GET /api/v1/workflows/templates
 *
 * Returns the catalog enriched with per-template metadata:
 *   - `appliedCount`: how many times this org has applied this template
 *   - `isApplied`: true if at least one active rule exists (for dedup UI)
 *   - `requiresSms`: true if any action is send_sms
 *   - `canRun`: false when requiresSms and org has no SMS provider configured
 *                 (UI renders a warning badge)
 *
 * Clients still resolve names/descriptions via the workflowTemplates i18n namespace.
 */
export const GET = withRlsAuth("settings", "read", async (_req, { orgId }) => {
  const [applied, smsOk] = await Promise.all([
    prisma.appliedTemplate.groupBy({
      by: ["templateId"],
      where: { organizationId: orgId },
      _count: { templateId: true },
    }),
    isSmsConfigured(orgId),
  ])

  const counts: Record<string, number> = {}
  for (const row of applied) counts[row.templateId] = row._count.templateId

  const enriched = WORKFLOW_TEMPLATES.map((t) => {
    const requiresSms = smsDependentActions(t)
    return {
      ...t,
      appliedCount: counts[t.id] || 0,
      isApplied: (counts[t.id] || 0) > 0,
      requiresSms,
      canRun: !requiresSms || smsOk,
    }
  })

  return NextResponse.json({
    success: true,
    data: enriched,
    meta: { smsProviderConfigured: smsOk },
  })
})

/**
 * POST /api/v1/workflows/templates
 * Body: { templateId, name?, isActive?, force?, customizations? }
 *
 * Creates a WorkflowRule + actions for the template. Records it in
 * applied_templates for analytics and duplicate detection.
 *
 * Returns 409 when the same template was already applied unless `force=true`.
 */
export const POST = withRlsAuth("settings", "write", async (req, { orgId, userId }) => {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

  const parsed = applyTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const template = getTemplateById(parsed.data.templateId)
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 })
  }

  // Duplicate check — skipped when force=true
  if (!parsed.data.force) {
    const existing = await prisma.appliedTemplate.findFirst({
      where: { organizationId: orgId, templateId: template.id },
      orderBy: { appliedAt: "desc" },
    })
    if (existing) {
      return NextResponse.json(
        {
          error: "Template already applied",
          code: "already_applied",
          appliedAt: existing.appliedAt,
          existingRuleId: existing.ruleId,
        },
        { status: 409 }
      )
    }
  }

  // Preflight: warn if send_sms action will fail
  if (smsDependentActions(template)) {
    const smsOk = await isSmsConfigured(orgId)
    if (!smsOk) {
      return NextResponse.json(
        {
          error: "This template requires SMS provider to be configured. Go to Settings → VoIP to set up Twilio or Vonage first.",
          code: "sms_not_configured",
        },
        { status: 422 }
      )
    }
  }

  // Apply customizations (safe fields only)
  const customized = template.actions.map((a, idx) => {
    const custom = parsed.data.customizations?.[String(idx)]
    if (!custom) return a
    return {
      ...a,
      actionConfig: {
        ...a.actionConfig,
        ...(custom.subject !== undefined ? { subject: custom.subject } : {}),
        ...(custom.body !== undefined ? { body: custom.body } : {}),
        ...(custom.message !== undefined ? { message: custom.message } : {}),
        ...(custom.title !== undefined ? { title: custom.title } : {}),
        ...(custom.delayMinutes !== undefined ? { delayMinutes: custom.delayMinutes } : {}),
      },
    }
  })

  try {
    const rule = await prisma.workflowRule.create({
      data: {
        organizationId: orgId,
        name: parsed.data.name || template.id,
        entityType: template.entityType,
        triggerEvent: template.triggerEvent,
        conditions: template.conditions,
        isActive: parsed.data.isActive,
        actions: {
          create: customized.map((a) => ({
            actionType: a.actionType,
            actionConfig: a.actionConfig,
            actionOrder: a.actionOrder,
          })),
        },
      },
      include: { actions: true },
    })

    await prisma.appliedTemplate.create({
      data: {
        organizationId: orgId,
        templateId: template.id,
        ruleId: rule.id,
        appliedBy: userId || null,
      },
    })

    return NextResponse.json({ success: true, data: rule }, { status: 201 })
  } catch (e) {
    console.error("[workflows/templates] apply error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
