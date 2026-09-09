/**
 * B10 Entitlement Process.
 *
 * GET /api/v1/entitlement-templates — list tenant support-level templates.
 * PUT /api/v1/entitlement-templates — replace one support-level template.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { withRlsAuth } from "@/lib/with-rls"
import {
  canUseEntitlementPermission,
  entitlementPermissionError,
  type EntitlementPermissionScope,
} from "@/lib/entitlement-process/access"
import {
  DUE_WINDOW_UNITS,
  MILESTONE_SEVERITY_SCOPES,
  assertNoDuplicateMilestoneDefinitions,
  dueWindowToSeconds,
  normalizeSeverityScope,
  type DueWindowUnit,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
import {
  MILESTONE_TYPES,
  SUPPORT_LEVELS,
  type MilestoneType,
  type SupportLevel,
} from "@/lib/entitlement-process/types"
import {
  ensureEntitlementTemplates,
  replaceEntitlementTemplate,
} from "@/lib/entitlement-process/template-settings"

const supportLevelSchema = z.enum(["basic", "standard", "premium", "enterprise"])
const milestoneTypeSchema = z.enum([
  "first_response",
  "problem_identified",
  "workaround_delivered",
  "resolution",
  "escalation",
])
const severityScopeSchema = z.enum(["all", "critical", "high", "normal", "low"])
const dueUnitSchema = z.enum(["minutes", "hours", "days"])

const templateDefinitionSchema = z.object({
  type: milestoneTypeSchema,
  name: z.string().trim().min(1).max(120),
  severityTier: severityScopeSchema.nullable().optional(),
  dueValue: z.coerce.number().positive(),
  dueUnit: dueUnitSchema,
  isRequired: z.boolean().default(true),
})

const updateTemplateSchema = z.object({
  supportLevel: supportLevelSchema,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).nullable().optional(),
  isActive: z.boolean().default(true),
  definitions: z.array(templateDefinitionSchema).max(30),
})

function forbidden(permission: EntitlementPermissionScope) {
  return NextResponse.json(
    { error: "Forbidden", message: entitlementPermissionError(permission) },
    { status: 403 },
  )
}

function metadata() {
  return {
    supportLevels: SUPPORT_LEVELS,
    types: MILESTONE_TYPES,
    severities: MILESTONE_SEVERITY_SCOPES,
    units: DUE_WINDOW_UNITS,
  }
}

export const GET = withRlsAuth("tickets", "read", async (_req, auth) => {
  if (!canUseEntitlementPermission(auth.role, "entitlements.read")) {
    return forbidden("entitlements.read")
  }

  try {
    return NextResponse.json({
      success: true,
      templates: await ensureEntitlementTemplates(auth.orgId),
      ...metadata(),
    })
  } catch (err) {
    console.error("[entitlement templates] GET error:", err)
    return NextResponse.json(
      { error: "Failed to load support templates." },
      { status: 500 },
    )
  }
})

export const PUT = withRlsAuth("tickets", "write", async (req, auth) => {
  if (!canUseEntitlementPermission(auth.role, "entitlements.write")) {
    return forbidden("entitlements.write")
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const parsed = updateTemplateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 },
    )
  }

  if (parsed.data.isActive && parsed.data.definitions.length === 0) {
    return NextResponse.json(
      { error: "Active templates require at least one milestone rule." },
      { status: 422 },
    )
  }

  try {
    const definitions = parsed.data.definitions.map((definition) => ({
      type: definition.type as MilestoneType,
      name: definition.name,
      severityTier: normalizeSeverityScope(
        definition.severityTier as MilestoneSeverityScope | null | undefined,
      ),
      dueWithinSeconds: dueWindowToSeconds(
        definition.dueValue,
        definition.dueUnit as DueWindowUnit,
      ),
      isRequired: definition.isRequired,
    }))
    assertNoDuplicateMilestoneDefinitions(definitions)

    const template = await replaceEntitlementTemplate(auth.orgId, {
      supportLevel: parsed.data.supportLevel as SupportLevel,
      name: parsed.data.name,
      description: parsed.data.description,
      isActive: parsed.data.isActive,
      definitions,
    })

    return NextResponse.json({
      success: true,
      template,
      templates: await ensureEntitlementTemplates(auth.orgId),
      ...metadata(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save support template."
    return NextResponse.json({ error: message }, { status: 400 })
  }
})
