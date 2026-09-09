import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateOutboundWebhookUrl } from "@/lib/integrations/webhook-url-guard"

const MAX_WORKFLOW_ACTIONS = 100
const MAX_WORKFLOW_WEBHOOKS = 10

class WorkflowNotFoundError extends Error {}

const updateWorkflowSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  entityType: z.string().optional(),
  triggerEvent: z.string().optional(),
  conditions: z.any().optional(),
  isActive: z.boolean().optional(),
  actions: z.array(z.object({
    actionType: z.string().min(1),
    actionConfig: z.any().optional().default({}),
    actionOrder: z.number().int().min(0).optional().default(0),
  })).max(MAX_WORKFLOW_ACTIONS).optional(),
})

export const GET = withRlsAuth("settings", "read", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const rule = await prisma.workflowRule.findFirst({
      where: { id, organizationId: orgId },
      include: { actions: { orderBy: { actionOrder: "asc" } } },
    })
    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: rule })
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
})

export const PUT = withRlsAuth("settings", "write", async (req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const body = await req.json()
  const parsed = updateWorkflowSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const { actions: rawActions, ...ruleData } = parsed.data
  const actions = rawActions ? [...rawActions] : undefined

  if (actions) {
    const webhookTargets: Array<{ index: number; url: string }> = []
    for (let index = 0; index < actions.length; index++) {
      const action = actions[index]
      if (action.actionType !== "webhook") continue

      const config =
        action.actionConfig &&
        typeof action.actionConfig === "object" &&
        !Array.isArray(action.actionConfig)
          ? action.actionConfig as Record<string, unknown>
          : {}
      if (config.url === undefined || config.url === "") continue
      if (typeof config.url !== "string") {
        return NextResponse.json(
          { error: "Webhook action URL must be a string" },
          { status: 400 },
        )
      }
      webhookTargets.push({ index, url: config.url })
    }

    if (webhookTargets.length > MAX_WORKFLOW_WEBHOOKS) {
      return NextResponse.json(
        { error: `A workflow can contain at most ${MAX_WORKFLOW_WEBHOOKS} webhook actions` },
        { status: 400 },
      )
    }

    try {
      // DNS lookup cannot be aborted reliably on every supported Node runtime;
      // validate the bounded list sequentially so one request cannot occupy ten
      // resolver workers at once during a slow-DNS attack.
      for (const { index, url } of webhookTargets) {
        const target = await validateOutboundWebhookUrl(url)
        const action = actions[index]
        const config = action.actionConfig as Record<string, unknown>
        actions[index] = {
          ...action,
          actionConfig: { ...config, url: target.url.toString() },
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unsafe webhook URL"
      return NextResponse.json({ error: message }, { status: 400 })
    }
  }

  try {
    if (actions !== undefined) {
      // Transactional: update rule + replace all actions
      await prisma.$transaction(async (tx: any) => {
        // WorkflowAction has no organizationId of its own. Prove ownership in
        // the same transaction before touching child rows by ruleId.
        const ownedRule = await tx.workflowRule.findFirst({
          where: { id, organizationId: orgId },
          select: { id: true },
        })
        if (!ownedRule) throw new WorkflowNotFoundError()

        // Update rule fields if any
        if (Object.keys(ruleData).length > 0) {
          await tx.workflowRule.updateMany({
            where: { id, organizationId: orgId },
            data: ruleData,
          })
        }
        // Delete existing actions
        await tx.workflowAction.deleteMany({ where: { ruleId: id } })
        // Create new actions
        if (actions.length > 0) {
          await tx.workflowAction.createMany({
            data: actions.map((a, i) => ({
              ruleId: id,
              actionType: a.actionType,
              actionConfig: a.actionConfig || {},
              actionOrder: a.actionOrder ?? i,
            })),
          })
        }
      })
    } else {
      // Just update rule fields
      const result = await prisma.workflowRule.updateMany({
        where: { id, organizationId: orgId },
        data: ruleData,
      })
      if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    }

    const updated = await prisma.workflowRule.findFirst({
      where: { id, organizationId: orgId },
      include: { actions: { orderBy: { actionOrder: "asc" } } },
    })
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: updated })
  } catch (e) {
    if (e instanceof WorkflowNotFoundError) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("settings", "delete", async (_req, { orgId }, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    // WorkflowAction rows are deleted by the database relation's onDelete:
    // Cascade only after this tenant-scoped parent delete succeeds.
    const result = await prisma.workflowRule.deleteMany({ where: { id, organizationId: orgId } })
    if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (e) {
    console.error(e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
