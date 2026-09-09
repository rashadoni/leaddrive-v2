/**
 * Validation rules CRUD — list + create.
 *
 *   GET  /api/v1/validation-rules?entityType=deal       → list
 *   POST /api/v1/validation-rules                       → create
 *
 * Part of N5 Validation rules (Phase 2 roadmap, slice 1).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { validateFormula } from "@/lib/formula"

const VALID_ENTITY_TYPES = new Set([
  "deal", "lead", "contact", "company", "ticket", "task",
  "invoice", "offer", "contract", "project",
])

const createSchema = z.object({
  entityType: z.string().min(1).max(40),
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional().nullable(),
  condition: z.string().min(1).max(4000),
  errorField: z.string().max(80).optional().nullable(),
  errorMessage: z.string().min(1).max(500),
  severity: z.enum(["error", "warning"]).default("error"),
  isActive: z.boolean().default(true),
})

export const GET = withRlsAuth("settings", "read", async (req, auth) => {
  const entityType = req.nextUrl.searchParams.get("entityType") || undefined
  if (entityType && !VALID_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json(
      { error: "Invalid entityType", validValues: [...VALID_ENTITY_TYPES] },
      { status: 400 }
    )
  }

  const rules = await prisma.formulaValidationRule.findMany({
    where: {
      organizationId: auth.orgId,
      ...(entityType ? { entityType } : {}),
    },
    orderBy: [{ entityType: "asc" }, { name: "asc" }],
  })

  return NextResponse.json({ success: true, data: rules })
})

export const POST = withRlsAuth("settings", "write", async (req, auth) => {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message, details: parsed.error.flatten() },
      { status: 400 }
    )
  }

  if (!VALID_ENTITY_TYPES.has(parsed.data.entityType)) {
    return NextResponse.json(
      { error: "Invalid entityType", validValues: [...VALID_ENTITY_TYPES] },
      { status: 400 }
    )
  }

  // Validate the formula condition before persisting — admin sees the
  // error immediately, not at end-user save time.
  const validation = validateFormula(parsed.data.condition)
  if (!validation.valid) {
    return NextResponse.json(
      {
        error: "Formula is invalid",
        formulaError: validation.error,
        unknownFunctions: validation.unknownFunctions,
      },
      { status: 400 }
    )
  }

  const rule = await prisma.formulaValidationRule.create({
    data: {
      organizationId: auth.orgId,
      entityType: parsed.data.entityType,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      condition: parsed.data.condition,
      errorField: parsed.data.errorField ?? null,
      errorMessage: parsed.data.errorMessage,
      severity: parsed.data.severity,
      isActive: parsed.data.isActive,
      createdBy: auth.userId,
    },
  })

  return NextResponse.json({ success: true, data: rule }, { status: 201 })
})
