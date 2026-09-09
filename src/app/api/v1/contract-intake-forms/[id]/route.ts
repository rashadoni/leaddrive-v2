/**
 * CLM Slice 3d — Contract Intake Form by ID.
 *
 * GET    /api/v1/contract-intake-forms/:id  — fetch form (any authed org member)
 * PUT    /api/v1/contract-intake-forms/:id  — update form (admin only)
 * DELETE /api/v1/contract-intake-forms/:id  — soft-deactivate (admin only)
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

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

const updateFormSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).nullable().optional(),
  contractType: z.string().max(100).nullable().optional(),
  questions: z.array(questionSchema).optional(),
  mapping: z.record(z.string(), z.string()).optional(),
  defaultStages: z.array(stageSpecSchema).max(10).optional(),
  isActive: z.boolean().optional(),
})

// ─── GET ──────────────────────────────────────────────────────────────────────

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id } = await params

  try {
    const form = await prisma.contractIntakeForm.findFirst({
      where: { id, organizationId: orgId },
      include: {
        _count: { select: { submissions: true } },
      },
    })
    if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true, data: form })
  } catch (e) {
    console.error("[contract-intake-forms/[id] GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── PUT ──────────────────────────────────────────────────────────────────────

export const PUT = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id } = await params

  if (session?.role !== "superadmin" && session?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can manage intake forms." }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = updateFormSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    const existing = await prisma.contractIntakeForm.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const { questions, mapping, defaultStages, ...rest } = parsed.data
    const form = await prisma.contractIntakeForm.update({
      where: { id },
      data: {
        ...rest,
        ...(questions !== undefined ? { questions: questions as object[] } : {}),
        ...(mapping !== undefined ? { mapping: mapping as object } : {}),
        ...(defaultStages !== undefined ? { defaultStages: defaultStages as object[] } : {}),
      },
    })

    return NextResponse.json({ success: true, data: form })
  } catch (e) {
    console.error("[contract-intake-forms/[id] PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── DELETE (soft-deactivate) ─────────────────────────────────────────────────

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")
  const { id } = await params

  if (session?.role !== "superadmin" && session?.role !== "admin") {
    return NextResponse.json({ error: "Only admins can manage intake forms." }, { status: 403 })
  }

  try {
    const existing = await prisma.contractIntakeForm.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Soft-deactivate: don't hard-delete because existing submissions reference this form.
    await prisma.contractIntakeForm.update({
      where: { id },
      data: { isActive: false },
    })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[contract-intake-forms/[id] DELETE]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
