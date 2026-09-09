/**
 * CLM Slice 1b — Contract Template detail (GET / PUT / DELETE).
 *
 * GET    /api/v1/contract-templates/:id — fetch one template (org-scoped)
 * PUT    /api/v1/contract-templates/:id — update + bump version
 * DELETE /api/v1/contract-templates/:id — hard delete
 *
 * Auth: org-scoped via getOrgId. Gated by the "contracts" module.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

// ─── Zod schemas (mirrors route.ts list schema) ──────────────────────────────

const clauseBlockSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  body: z.string(),
  conditional: z
    .object({
      var: z.string().min(1),
      equals: z.union([z.string(), z.number(), z.boolean()]),
    })
    .optional(),
})

const variableSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "number", "date", "boolean"]),
  required: z.boolean(),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
  label: z.string().max(120).optional(),
  placeholder: z.string().max(200).optional(),
})

const updateTemplateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  clauses: z.array(clauseBlockSchema).optional(),
  variables: z.array(variableSchema).optional(),
  defaultContractType: z.string().optional(),
  defaultDurationMonths: z.number().int().positive().nullable().optional(),
  isActive: z.boolean().optional(),
})

// ─── GET /api/v1/contract-templates/:id ─────────────────────────────────────

export const GET = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id } = await params

  try {
    const template = await prisma.contractTemplate.findFirst({
      where: { id, organizationId: orgId },
    })
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true, data: template })
  } catch (e) {
    console.error("[contract-templates GET/:id]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── PUT /api/v1/contract-templates/:id ─────────────────────────────────────

export const PUT = withRls(async (req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id } = await params

  const body = await req.json()
  const parsed = updateTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Verify ownership
    const existing = await prisma.contractTemplate.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, version: true },
    })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    // Guarded conditional update: only succeeds if version hasn't changed since we read it.
    // This prevents two concurrent PUT requests from both reading version=N and both writing N+1
    // (the second write would silently overwrite the first — classic lost-update race).
    const result = await prisma.contractTemplate.updateMany({
      where: { id, organizationId: orgId, version: existing.version },
      data: {
        ...parsed.data,
        // Bump version on every edit — existing contract instances pin via Contract.templateVersion
        version: { increment: 1 },
      },
    })
    if (result.count === 0) {
      return NextResponse.json({ error: "Version conflict — reload and retry" }, { status: 409 })
    }

    // Re-fetch to return the updated row with the new version number.
    const updated = await prisma.contractTemplate.findFirst({
      where: { id, organizationId: orgId },
    })

    return NextResponse.json({ success: true, data: updated })
  } catch (e: any) {
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A template with this slug already exists" }, { status: 409 })
    }
    console.error("[contract-templates PUT/:id]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── DELETE /api/v1/contract-templates/:id ──────────────────────────────────

export const DELETE = withRls(async (_req, { orgId, session }, { params }: { params: Promise<{ id: string }> }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { id } = await params

  try {
    const deleted = await prisma.contractTemplate.deleteMany({
      where: { id, organizationId: orgId },
    })
    if (deleted.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error("[contract-templates DELETE/:id]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
