/**
 * CLM Slice 1b — Contract Templates list + create.
 *
 * GET  /api/v1/contract-templates  — org-scoped list with optional name search
 * POST /api/v1/contract-templates  — create a new template (version starts at 1)
 *
 * Auth: org-scoped via getOrgId. Gated by the "contracts" module.
 * Mirrors the guard pattern in src/app/api/v1/quotes/route.ts.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth"
import { withRls } from "@/lib/with-rls"

// ─── Zod schemas ────────────────────────────────────────────────────────────

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

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/).optional(),
  description: z.string().optional(),
  clauses: z.array(clauseBlockSchema).default([]),
  variables: z.array(variableSchema).default([]),
  defaultContractType: z.string().optional(),
  defaultDurationMonths: z.number().int().positive().optional(),
})

// ─── GET /api/v1/contract-templates ─────────────────────────────────────────

export const GET = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search") || ""
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"))
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50")))

  try {
    const where = {
      organizationId: orgId,
      ...(search ? { name: { contains: search, mode: "insensitive" as const } } : {}),
    }

    const [templates, total] = await Promise.all([
      prisma.contractTemplate.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          version: true,
          clauses: true,
          variables: true,
          defaultContractType: true,
          defaultDurationMonths: true,
          isActive: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.contractTemplate.count({ where }),
    ])

    return NextResponse.json({ success: true, data: { templates, total, page, limit, search } })
  } catch (e) {
    console.error("[contract-templates GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

// ─── POST /api/v1/contract-templates ────────────────────────────────────────

export const POST = withRls(async (req, { orgId, session }) => {
  if (session?.role !== "superadmin" && !(await orgHasModule(orgId, "contracts")))
    return moduleDisabledResponse("contracts")

  const body = await req.json()
  const parsed = createTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const { name, slug, description, clauses, variables, defaultContractType, defaultDurationMonths } = parsed.data

  // Auto-generate slug from name if not provided
  const resolvedSlug =
    slug ??
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 100)

  try {
    const template = await prisma.contractTemplate.create({
      data: {
        organizationId: orgId,
        name,
        slug: resolvedSlug,
        description,
        clauses,
        variables,
        defaultContractType: defaultContractType ?? "service_agreement",
        defaultDurationMonths,
        version: 1,
        createdBy: session?.userId ?? undefined,
      },
    })

    return NextResponse.json({ success: true, data: template }, { status: 201 })
  } catch (e: any) {
    // Unique constraint on (organizationId, slug)
    if (e?.code === "P2002") {
      return NextResponse.json({ error: "A template with this slug already exists" }, { status: 409 })
    }
    console.error("[contract-templates POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
