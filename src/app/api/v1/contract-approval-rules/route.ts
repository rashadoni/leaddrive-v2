/**
 * CLM Slice 3b — Contract Approval Rules CRUD.
 *
 * GET  /api/v1/contract-approval-rules  — org-scoped list (with actions)
 * POST /api/v1/contract-approval-rules  — create rule + actions
 *
 * Auth: org-scoped + "contracts" module gate + superadmin bypass.
 * Write (POST): ADMIN role only (manager intentionally excluded — a skip_stage
 *   action can remove Legal/CFO from the chain, making rule authorship an
 *   admin-level concern, not a manager-level one).
 * Read (GET): any authenticated org member.
 *
 * Mirrors the guard pattern from contract-templates routes.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

// ─── Zod schemas ──────────────────────────────────────────────────────────────

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

const KNOWN_ROLES = ["admin", "manager", "member", "director", "superadmin"] as const

const createRuleSchema = z.object({
  name: z.string().min(1).max(255),
  templateId: z.string().nullable().optional(),
  conditions: z.array(conditionSchema).min(1, "At least one condition is required"),
  matchLogic: z.enum(["all", "any"]).default("all"),
  isActive: z.boolean().default(true),
  actions: z.array(actionSchema).min(1, "At least one action is required"),
})

// ─── GET /api/v1/contract-approval-rules ─────────────────────────────────────

export const GET = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { searchParams } = new URL(req.url)
  const isActiveParam = searchParams.get("isActive")
  const templateId = searchParams.get("templateId")

  try {
    const where: {
      organizationId: string
      isActive?: boolean
      templateId?: string | null
    } = { organizationId: orgId }

    if (isActiveParam !== null) {
      where.isActive = isActiveParam !== "false"
    }
    if (templateId !== undefined && templateId !== null) {
      where.templateId = templateId === "null" ? null : templateId
    }

    const rules = await prisma.contractApprovalRule.findMany({
      where,
      orderBy: { createdAt: "asc" },
      include: {
        actions: { orderBy: { sortOrder: "asc" } },
        template: { select: { id: true, name: true, slug: true } },
      },
    })

    return NextResponse.json({ success: true, data: rules })
  } catch (e) {
    console.error("[contract-approval-rules GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── POST /api/v1/contract-approval-rules ────────────────────────────────────

export const POST = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  // Write: ADMIN only (superadmin inherently included via the superadmin check above).
  // Managers are intentionally excluded — skip_stage actions can remove required
  // approvers (Legal/CFO), making rule authorship an admin-level policy concern.
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

  const parsed = createRuleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { name, templateId, conditions, matchLogic, isActive, actions } = parsed.data

  try {
    // Validate templateId belongs to this org if provided.
    if (templateId) {
      const tmpl = await prisma.contractTemplate.findFirst({
        where: { id: templateId, organizationId: orgId },
        select: { id: true },
      })
      if (!tmpl) {
        return NextResponse.json({ error: "Template not found." }, { status: 404 })
      }
    }

    // FIX 3: Validate assignee users are same-org active members.
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

    const rule = await prisma.contractApprovalRule.create({
      data: {
        organizationId: orgId,
        templateId: templateId ?? null,
        name,
        conditions: conditions as object[],
        matchLogic,
        isActive,
        createdBy: session?.userId ?? null,
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
      },
      include: {
        actions: { orderBy: { sortOrder: "asc" } },
        template: { select: { id: true, name: true, slug: true } },
      },
    })

    return NextResponse.json({ success: true, data: rule }, { status: 201 })
  } catch (e) {
    console.error("[contract-approval-rules POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
