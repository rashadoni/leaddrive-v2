/**
 * CLM Slice 3b — Contract Approval Rule detail CRUD.
 *
 * GET    /api/v1/contract-approval-rules/:id  — fetch rule with actions
 * PUT    /api/v1/contract-approval-rules/:id  — replace rule + actions
 * DELETE /api/v1/contract-approval-rules/:id  — soft-delete (isActive = false)
 *
 * Auth: org-scoped + "contracts" module gate + superadmin bypass.
 * Write (PUT/DELETE): ADMIN role only (same reasoning as POST — skip_stage actions
 *   are approval-policy, not a manager concern).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const KNOWN_ROLES = ["admin", "manager", "member", "director", "superadmin"] as const

const conditionSchema = z.object({
  field: z.enum(["value", "type", "currency"]),
  operator: z.enum(["gte", "lte", "gt", "lt", "eq", "neq", "in"]),
  value: z.union([z.number(), z.string(), z.array(z.string())]),
})

const actionSchema = z.object({
  actionType: z.enum(["add_stage", "skip_stage"]),
  stageLabel: z.string().min(1).max(150).nullable().optional(),
  assigneeUserId: z.string().nullable().optional(),
  assigneeRole: z.string().nullable().optional(),
  atPosition: z.number().int().positive().nullable().optional(),
  sortOrder: z.number().int().default(0),
})

const updateRuleSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  templateId: z.string().nullable().optional(),
  conditions: z.array(conditionSchema).min(1, "At least one condition is required").optional(),
  matchLogic: z.enum(["all", "any"]).optional(),
  isActive: z.boolean().optional(),
  actions: z.array(actionSchema).min(1, "At least one action is required").optional(),
})

// ─── GET /api/v1/contract-approval-rules/:id ─────────────────────────────────

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id } = await params

  try {
    const rule = await prisma.contractApprovalRule.findFirst({
      where: { id, organizationId: orgId },
      include: {
        actions: { orderBy: { sortOrder: "asc" } },
        template: { select: { id: true, name: true, slug: true } },
      },
    })

    if (!rule) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true, data: rule })
  } catch (e) {
    console.error("[contract-approval-rules/:id GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── PUT /api/v1/contract-approval-rules/:id ─────────────────────────────────

export const PUT = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id } = await params

  // FIX 2: Write requires ADMIN role. Managers are intentionally excluded.
  if (session?.role !== "superadmin" && session?.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can manage approval rules." },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = updateRuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const existing = await prisma.contractApprovalRule.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { name, templateId, conditions, matchLogic, isActive, actions } = parsed.data

    // Validate templateId if provided.
    if (templateId) {
      const tmpl = await prisma.contractTemplate.findFirst({
        where: { id: templateId, organizationId: orgId },
        select: { id: true },
      })
      if (!tmpl) return NextResponse.json({ error: "Template not found." }, { status: 404 })
    }

    // FIX 3: Validate assignee users are same-org active members.
    if (actions !== undefined) {
      for (const action of actions) {
        if (action.assigneeUserId) {
          const user = await prisma.user.findFirst({
            where: { id: action.assigneeUserId, organizationId: orgId, isActive: true },
            select: { id: true },
          })
          if (!user) {
            return NextResponse.json(
              { error: `Assignee user "${action.assigneeUserId}" not found in your organization.` },
              { status: 400 },
            )
          }
        }
        // FIX 3: Validate assigneeRole is a known role string.
        if (action.assigneeRole && !(KNOWN_ROLES as readonly string[]).includes(action.assigneeRole)) {
          return NextResponse.json(
            { error: `Unknown assignee role: "${action.assigneeRole}".` },
            { status: 400 },
          )
        }
      }
    }

    // Replace actions if provided: delete all existing, create new ones.
    const rule = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (actions !== undefined) {
        await tx.contractApprovalRuleAction.deleteMany({ where: { ruleId: id } })
      }

      return tx.contractApprovalRule.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(templateId !== undefined && { templateId: templateId ?? null }),
          ...(conditions !== undefined && { conditions: conditions as object[] }),
          ...(matchLogic !== undefined && { matchLogic }),
          ...(isActive !== undefined && { isActive }),
          ...(actions !== undefined && {
            actions: {
              create: actions.map((a) => ({
                actionType: a.actionType,
                stageLabel: a.stageLabel ?? null,
                assigneeUserId: a.assigneeUserId ?? null,
                assigneeRole: a.assigneeRole ?? null,
                atPosition: a.atPosition ?? null,
                sortOrder: a.sortOrder,
              })),
            },
          }),
        },
        include: {
          actions: { orderBy: { sortOrder: "asc" } },
          template: { select: { id: true, name: true, slug: true } },
        },
      })
    })

    return NextResponse.json({ success: true, data: rule })
  } catch (e) {
    console.error("[contract-approval-rules/:id PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── DELETE /api/v1/contract-approval-rules/:id ──────────────────────────────

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id } = await params

  // FIX 2: Write requires ADMIN role. Managers are intentionally excluded.
  if (session?.role !== "superadmin" && session?.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can manage approval rules." },
      { status: 403 },
    )
  }

  try {
    const existing = await prisma.contractApprovalRule.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Soft-delete: deactivate rather than hard-delete so historical context is preserved.
    await prisma.contractApprovalRule.update({
      where: { id },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[contract-approval-rules/:id DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
