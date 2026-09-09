/**
 * CLM Slice 3d — Contract Intake Forms CRUD.
 *
 * GET  /api/v1/contract-intake-forms  — org-scoped list (active filter optional)
 * POST /api/v1/contract-intake-forms  — create form (admin only)
 *
 * Auth: org-scoped + "contracts" module gate + superadmin bypass.
 * Write: ADMIN role only (mirrors approval-rules admin-only gate).
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const questionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(500),
  type: z.enum(["text", "textarea", "number", "date", "select"]),
  required: z.boolean(),
  options: z.array(z.string()).optional(),
})

const stageSpecSchema = z.object({
  label: z.string().min(1).max(100),
  assigneeUserId: z.string().optional(),
  assigneeRole: z.string().optional(),
  slaHours: z.number().int().positive().optional(),
})

const createFormSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  contractType: z.string().max(100).optional(),
  questions: z.array(questionSchema).default([]),
  mapping: z.record(z.string(), z.string()).default({}),
  defaultStages: z.array(stageSpecSchema).max(10, "Max 10 default stages").default([]),
  isActive: z.boolean().default(true),
})

// ─── GET /api/v1/contract-intake-forms ───────────────────────────────────────

export const GET = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { searchParams } = new URL(req.url)
  const isActiveParam = searchParams.get("isActive")

  try {
    const where: { organizationId: string; isActive?: boolean } = { organizationId: orgId }
    if (isActiveParam !== null) {
      where.isActive = isActiveParam !== "false"
    }

    const forms = await prisma.contractIntakeForm.findMany({
      where,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        description: true,
        contractType: true,
        questions: true,
        mapping: true,
        defaultStages: true,
        isActive: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { submissions: true } },
      },
    })

    return NextResponse.json({ success: true, data: forms })
  } catch (e) {
    console.error("[contract-intake-forms GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── POST /api/v1/contract-intake-forms ──────────────────────────────────────

export const POST = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  // Write: ADMIN only (superadmin bypassed above via module check).
  if (session?.role !== "superadmin" && session?.role !== "admin") {
    return NextResponse.json(
      { error: "Only admins can manage intake forms." },
      { status: 403 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = createFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { name, description, contractType, questions, mapping, defaultStages, isActive } = parsed.data

  try {
    const form = await prisma.contractIntakeForm.create({
      data: {
        organizationId: orgId,
        name,
        description: description ?? null,
        contractType: contractType ?? null,
        questions: questions as object[],
        mapping: mapping as object,
        defaultStages: defaultStages as object[],
        isActive,
        createdBy: session?.userId ?? null,
      },
    })

    return NextResponse.json({ success: true, data: form }, { status: 201 })
  } catch (e) {
    console.error("[contract-intake-forms POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
