/**
 * B10 Entitlement Process.
 *
 * GET  /api/v1/entitlements/[id]/milestones — list milestone definitions.
 * POST /api/v1/entitlements/[id]/milestones — create one rule or apply a template.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
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
  milestoneDefinitionKey,
  normalizeSeverityScope,
  type DueWindowUnit,
  type MilestoneSeverityScope,
} from "@/lib/entitlement-process/milestone-definitions"
import {
  MILESTONE_TYPES,
  type MilestoneType,
  type SeverityTier,
  type SupportLevel,
} from "@/lib/entitlement-process/types"
import {
  ensureEntitlementTemplates,
  getEntitlementTemplate,
} from "@/lib/entitlement-process/template-settings"

const editableStatuses = new Set(["draft", "suspended"])

const milestoneTypeSchema = z.enum([
  "first_response",
  "problem_identified",
  "workaround_delivered",
  "resolution",
  "escalation",
])
const severityScopeSchema = z.enum(["all", "critical", "high", "normal", "low"])
const dueUnitSchema = z.enum(["minutes", "hours", "days"])
const supportLevelSchema = z.enum(["basic", "standard", "premium", "enterprise"])

const createDefinitionSchema = z.object({
  mode: z.literal("definition"),
  type: milestoneTypeSchema,
  name: z.string().trim().min(1).max(120).optional(),
  severityTier: severityScopeSchema.nullable().optional(),
  dueValue: z.coerce.number().positive(),
  dueUnit: dueUnitSchema,
  isRequired: z.boolean().default(true),
})

const applyTemplateSchema = z.object({
  mode: z.literal("template"),
  template: supportLevelSchema,
})

const postSchema = z.discriminatedUnion("mode", [createDefinitionSchema, applyTemplateSchema])

interface DefinitionRow {
  id: string
  type: string
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  metadata: Prisma.JsonValue
  createdAt: Date
  updatedAt: Date
}

function serializeDefinition(definition: DefinitionRow) {
  return {
    id: definition.id,
    type: definition.type,
    name: definition.name,
    severityTier: definition.severityTier,
    dueWithinSeconds: definition.dueWithinSeconds,
    isRequired: definition.isRequired,
    metadata: definition.metadata,
    createdAt: definition.createdAt,
    updatedAt: definition.updatedAt,
  }
}

function sortDefinitions(a: DefinitionRow, b: DefinitionRow) {
  const typeOrder =
    MILESTONE_TYPES.indexOf(a.type as MilestoneType) -
    MILESTONE_TYPES.indexOf(b.type as MilestoneType)
  if (typeOrder !== 0) return typeOrder
  const severityA = a.severityTier ?? "all"
  const severityB = b.severityTier ?? "all"
  return MILESTONE_SEVERITY_SCOPES.indexOf(severityA as MilestoneSeverityScope) -
    MILESTONE_SEVERITY_SCOPES.indexOf(severityB as MilestoneSeverityScope)
}

function forbidden(permission: EntitlementPermissionScope) {
  return NextResponse.json(
    { error: "Forbidden", message: entitlementPermissionError(permission) },
    { status: 403 },
  )
}

async function loadDefinitions(orgId: string, entitlementId: string) {
  const definitions = await prisma.entitlementMilestoneDefinition.findMany({
    where: { organizationId: orgId, entitlementId },
    select: {
      id: true,
      type: true,
      name: true,
      severityTier: true,
      dueWithinSeconds: true,
      isRequired: true,
      metadata: true,
      createdAt: true,
      updatedAt: true,
    },
  }) as DefinitionRow[]

  return definitions.sort(sortDefinitions).map(serializeDefinition)
}

async function findEntitlement(orgId: string, entitlementId: string) {
  return prisma.entitlement.findFirst({
    where: { id: entitlementId, organizationId: orgId },
    select: {
      id: true,
      status: true,
      supportLevel: true,
      company: { select: { name: true } },
    },
  })
}

async function assertNoExistingDefinition(
  orgId: string,
  entitlementId: string,
  type: MilestoneType,
  severityTier: SeverityTier | null,
) {
  const duplicate = await prisma.entitlementMilestoneDefinition.findFirst({
    where: {
      organizationId: orgId,
      entitlementId,
      type,
      severityTier,
    },
    select: { id: true },
  })
  if (duplicate) {
    throw new Error("A milestone definition for this type and severity already exists.")
  }
}

export const GET = withRlsAuth(
  "tickets",
  "read",
  async (_req, auth, context: { params: Promise<{ id: string }> }) => {
    if (!canUseEntitlementPermission(auth.role, "entitlements.read")) {
      return forbidden("entitlements.read")
    }

    const { id } = await context.params
    const entitlement = await findEntitlement(auth.orgId, id)
    if (!entitlement) {
      return NextResponse.json({ error: "Support term not found." }, { status: 404 })
    }

    const templates = await ensureEntitlementTemplates(auth.orgId)

    return NextResponse.json({
      success: true,
      entitlement: {
        id: entitlement.id,
        status: entitlement.status,
        supportLevel: entitlement.supportLevel,
        companyName: entitlement.company?.name ?? "",
        canEditMilestones: editableStatuses.has(entitlement.status),
      },
      definitions: await loadDefinitions(auth.orgId, id),
      templates: templates.map((template) => ({
        id: template.supportLevel,
        name: template.name,
        count: template.definitions.length,
        isActive: template.isActive,
      })),
      units: DUE_WINDOW_UNITS,
      severities: MILESTONE_SEVERITY_SCOPES,
      types: MILESTONE_TYPES,
    })
  },
)

export const POST = withRlsAuth(
  "tickets",
  "write",
  async (req, auth, context: { params: Promise<{ id: string }> }) => {
    if (!canUseEntitlementPermission(auth.role, "entitlements.write")) {
      return forbidden("entitlements.write")
    }

    const { id } = await context.params

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
    }

    const parsed = postSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 },
      )
    }

    const entitlement = await findEntitlement(auth.orgId, id)
    if (!entitlement) {
      return NextResponse.json({ error: "Support term not found." }, { status: 404 })
    }
    if (!editableStatuses.has(entitlement.status)) {
      return NextResponse.json(
        { error: "Milestone rules can be changed only while the support term is draft or suspended." },
        { status: 422 },
      )
    }

    if (parsed.data.mode === "template") {
      const templateRequest = parsed.data
      const template = await getEntitlementTemplate(
        auth.orgId,
        templateRequest.template as SupportLevel,
      )
      if (!template || !template.isActive || template.definitions.length === 0) {
        return NextResponse.json(
          { error: "Selected milestone template is inactive or empty." },
          { status: 422 },
        )
      }
      try {
        assertNoDuplicateMilestoneDefinitions(template.definitions)
        const existingDefinitions = await prisma.entitlementMilestoneDefinition.findMany({
          where: { organizationId: auth.orgId, entitlementId: id },
          select: { type: true, severityTier: true },
        }) as Array<{ type: string; severityTier: string | null }>
        const existingKeys = new Set(
          existingDefinitions.map((definition) =>
            milestoneDefinitionKey(
              definition.type as MilestoneType,
              definition.severityTier as SeverityTier | null,
            ),
          ),
        )
        const duplicate = template.definitions.find((definition) =>
          existingKeys.has(milestoneDefinitionKey(definition.type, definition.severityTier)),
        )
        if (duplicate) {
          return NextResponse.json(
            { error: "Template conflicts with an existing milestone definition." },
            { status: 409 },
          )
        }

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          for (const definition of template.definitions) {
            await tx.entitlementMilestoneDefinition.create({
              data: {
                organizationId: auth.orgId,
                entitlementId: id,
                type: definition.type,
                name: definition.name,
                severityTier: definition.severityTier,
                dueWithinSeconds: definition.dueWithinSeconds,
                isRequired: definition.isRequired,
                metadata: { template: templateRequest.template, templateId: template.id },
              },
            })
          }
          await tx.entitlementAuditEvent.create({
            data: {
              organizationId: auth.orgId,
              entitlementId: id,
              eventType: "entitlement_updated",
              actorUserId: auth.userId,
              payload: {
                action: "milestone_template_applied",
                template: templateRequest.template,
                templateId: template.id,
                definitionCount: template.definitions.length,
              },
            },
          })
        })
      } catch (err) {
        console.error("[entitlement milestones] template error:", err)
        return NextResponse.json(
          { error: err instanceof Error ? err.message : "Failed to apply milestone template." },
          { status: 500 },
        )
      }

      return NextResponse.json({
        success: true,
        definitions: await loadDefinitions(auth.orgId, id),
      })
    }

    const definitionRequest = parsed.data
    const severityTier = normalizeSeverityScope(
      definitionRequest.severityTier as MilestoneSeverityScope | null | undefined,
    )
    let dueWithinSeconds: number
    try {
      dueWithinSeconds = dueWindowToSeconds(definitionRequest.dueValue, definitionRequest.dueUnit as DueWindowUnit)
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Invalid due window." },
        { status: 400 },
      )
    }

    try {
      await assertNoExistingDefinition(
        auth.orgId,
        id,
        definitionRequest.type as MilestoneType,
        severityTier,
      )

      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await tx.entitlementMilestoneDefinition.create({
          data: {
            organizationId: auth.orgId,
            entitlementId: id,
            type: definitionRequest.type,
            name: definitionRequest.name || definitionRequest.type.replaceAll("_", " "),
            severityTier,
            dueWithinSeconds,
            isRequired: definitionRequest.isRequired,
            metadata: {},
          },
        })
        await tx.entitlementAuditEvent.create({
          data: {
            organizationId: auth.orgId,
            entitlementId: id,
            eventType: "entitlement_updated",
            actorUserId: auth.userId,
            payload: {
              action: "milestone_definition_created",
              type: definitionRequest.type,
              severityTier,
              dueWithinSeconds,
              isRequired: definitionRequest.isRequired,
            },
          },
        })
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create milestone definition."
      return NextResponse.json(
        { error: message },
        { status: message.includes("already exists") ? 409 : 500 },
      )
    }

    return NextResponse.json({
      success: true,
      definitions: await loadDefinitions(auth.orgId, id),
    }, { status: 201 })
  },
)
