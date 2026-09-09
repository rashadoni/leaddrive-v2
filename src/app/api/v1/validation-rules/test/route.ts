/**
 * POST /api/v1/validation-rules/test
 *
 * Dry-run the active rules for an entityType against a sample record.
 * Used by the admin "Test rule" UI to preview behaviour before going live,
 * and by client code to validate ahead of an actual save.
 *
 * Body: `{ entityType, record, ruleIds? }`
 *   - When `ruleIds` is provided, only those rules are evaluated.
 *   - Otherwise all active rules for entityType are evaluated.
 *
 * Returns `EvaluateRulesResult`.
 *
 * Part of N5 Validation rules.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { evaluateRules, type ValidationRuleInput, type RuleSeverity } from "@/lib/validation/engine"

const bodySchema = z.object({
  entityType: z.string().min(1).max(40),
  record: z.record(z.string(), z.unknown()),
  ruleIds: z.array(z.string()).optional(),
})

export const POST = withRlsAuth("settings", "read", async (req, auth) => {
  // "settings:read" — testing rules is a read-level operation; even
  // viewers shouldn't dry-run rules against arbitrary records.

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  const rulesDb = await prisma.formulaValidationRule.findMany({
    where: {
      organizationId: auth.orgId,
      entityType: parsed.data.entityType,
      isActive: true,
      ...(parsed.data.ruleIds ? { id: { in: parsed.data.ruleIds } } : {}),
    },
  })

  // Map findMany result → input shape the engine expects. The narrow row
  // type is declared locally so the map callback gets concrete types
  // (Prisma's generated payload is wide otherwise).
  type RuleRow = {
    id: string; name: string; entityType: string; condition: string
    errorField: string | null; errorMessage: string; severity: string; isActive: boolean
  }
  const rules: ValidationRuleInput[] = rulesDb.map((r: RuleRow) => ({
    id: r.id,
    name: r.name,
    entityType: r.entityType,
    condition: r.condition,
    errorField: r.errorField,
    errorMessage: r.errorMessage,
    severity: r.severity as RuleSeverity,
    isActive: r.isActive,
  }))

  const result = evaluateRules(rules, parsed.data.record)
  return NextResponse.json({ success: true, ...result })
})
