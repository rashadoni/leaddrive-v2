/**
 * Validation rules single-record endpoints.
 *
 *   PATCH  /api/v1/validation-rules/[id]   → partial update
 *   DELETE /api/v1/validation-rules/[id]   → hard delete
 *
 * Part of N5 Validation rules.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { validateFormula } from "@/lib/formula"
import { withRlsAuth } from "@/lib/with-rls"

const patchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  condition: z.string().min(1).max(4000).optional(),
  errorField: z.string().max(80).nullable().optional(),
  errorMessage: z.string().min(1).max(500).optional(),
  severity: z.enum(["error", "warning"]).optional(),
  isActive: z.boolean().optional(),
})

export const PATCH = withRlsAuth("settings", "write", async (req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.formulaValidationRule.findFirst({
    where: { id, organizationId: auth.orgId },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  // If condition changed, re-validate the formula.
  if (parsed.data.condition && parsed.data.condition !== existing.condition) {
    const v = validateFormula(parsed.data.condition)
    if (!v.valid) {
      return NextResponse.json(
        { error: "Formula is invalid", formulaError: v.error, unknownFunctions: v.unknownFunctions },
        { status: 400 }
      )
    }
  }

  const updated = await prisma.formulaValidationRule.update({
    where: { id },
    data: parsed.data,
  })

  return NextResponse.json({ success: true, data: updated })
})

export const DELETE = withRlsAuth("settings", "delete", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  const existing = await prisma.formulaValidationRule.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.formulaValidationRule.delete({ where: { id } })
  return NextResponse.json({ success: true })
})
