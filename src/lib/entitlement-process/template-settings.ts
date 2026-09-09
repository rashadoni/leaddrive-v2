import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  ENTITLEMENT_MILESTONE_TEMPLATES,
  type MilestoneDefinitionDraft,
} from "@/lib/entitlement-process/milestone-definitions"
import {
  SUPPORT_LEVELS,
  type MilestoneType,
  type SeverityTier,
  type SupportLevel,
} from "@/lib/entitlement-process/types"

interface TemplateRuleRow {
  id: string
  type: string
  name: string
  severityTier: string | null
  dueWithinSeconds: number
  isRequired: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

interface TemplateRow {
  id: string
  supportLevel: string
  name: string
  description: string | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
  rules: TemplateRuleRow[]
}

export interface EntitlementTemplateDefinition {
  id: string
  type: MilestoneType
  name: string
  severityTier: SeverityTier | null
  dueWithinSeconds: number
  isRequired: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface EntitlementTemplate {
  id: string
  supportLevel: SupportLevel
  name: string
  description: string | null
  isActive: boolean
  definitions: EntitlementTemplateDefinition[]
  createdAt: Date
  updatedAt: Date
}

export interface EntitlementTemplateUpsertInput {
  supportLevel: SupportLevel
  name: string
  description?: string | null
  isActive: boolean
  definitions: Array<Omit<MilestoneDefinitionDraft, "severityTier"> & {
    severityTier: SeverityTier | null
  }>
}

const DEFAULT_TEMPLATE_NAMES: Readonly<Record<SupportLevel, string>> = {
  basic: "Basic",
  standard: "Standard",
  premium: "Premium",
  enterprise: "Enterprise",
}

function defaultTemplateName(level: SupportLevel) {
  return DEFAULT_TEMPLATE_NAMES[level]
}

function serializeTemplate(row: TemplateRow): EntitlementTemplate {
  return {
    id: row.id,
    supportLevel: row.supportLevel as SupportLevel,
    name: row.name,
    description: row.description,
    isActive: row.isActive,
    definitions: [...row.rules]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((rule) => ({
        id: rule.id,
        type: rule.type as MilestoneType,
        name: rule.name,
        severityTier: rule.severityTier as SeverityTier | null,
        dueWithinSeconds: rule.dueWithinSeconds,
        isRequired: rule.isRequired,
        sortOrder: rule.sortOrder,
        createdAt: rule.createdAt,
        updatedAt: rule.updatedAt,
      })),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function sortTemplates(templates: EntitlementTemplate[]) {
  return templates.sort(
    (a, b) => SUPPORT_LEVELS.indexOf(a.supportLevel) - SUPPORT_LEVELS.indexOf(b.supportLevel),
  )
}

async function fetchTemplates(orgId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  const rows = await client.entitlementMilestoneTemplate.findMany({
    where: { organizationId: orgId },
    include: { rules: true },
  }) as TemplateRow[]

  return sortTemplates(rows.map(serializeTemplate))
}

async function createDefaultTemplate(
  tx: Prisma.TransactionClient,
  orgId: string,
  supportLevel: SupportLevel,
) {
  const defaults = ENTITLEMENT_MILESTONE_TEMPLATES[supportLevel].definitions
  return tx.entitlementMilestoneTemplate.create({
    data: {
      organizationId: orgId,
      supportLevel,
      name: defaultTemplateName(supportLevel),
      description: null,
      isActive: true,
      rules: {
        create: defaults.map((definition, index) => ({
          organizationId: orgId,
          type: definition.type,
          name: definition.name,
          severityTier: definition.severityTier,
          dueWithinSeconds: definition.dueWithinSeconds,
          isRequired: definition.isRequired,
          sortOrder: index,
        })),
      },
    },
    include: { rules: true },
  })
}

export async function ensureEntitlementTemplates(orgId: string) {
  const existing = await fetchTemplates(orgId)
  const existingLevels = new Set(existing.map((template) => template.supportLevel))
  const missing = SUPPORT_LEVELS.filter((level) => !existingLevels.has(level))

  if (missing.length === 0) return existing

  await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    for (const supportLevel of missing) {
      await createDefaultTemplate(tx, orgId, supportLevel)
    }
  })

  return fetchTemplates(orgId)
}

export async function getEntitlementTemplate(orgId: string, supportLevel: SupportLevel) {
  const templates = await ensureEntitlementTemplates(orgId)
  return templates.find((template) => template.supportLevel === supportLevel) ?? null
}

export async function replaceEntitlementTemplate(
  orgId: string,
  input: EntitlementTemplateUpsertInput,
) {
  await ensureEntitlementTemplates(orgId)

  const row = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const template = await tx.entitlementMilestoneTemplate.update({
      where: {
        organizationId_supportLevel: {
          organizationId: orgId,
          supportLevel: input.supportLevel,
        },
      },
      data: {
        name: input.name.trim(),
        description: input.description?.trim() || null,
        isActive: input.isActive,
      },
      select: { id: true },
    })

    await tx.entitlementMilestoneTemplateRule.deleteMany({
      where: { organizationId: orgId, templateId: template.id },
    })

    if (input.definitions.length > 0) {
      await tx.entitlementMilestoneTemplateRule.createMany({
        data: input.definitions.map((definition, index) => ({
          organizationId: orgId,
          templateId: template.id,
          type: definition.type,
          name: definition.name.trim(),
          severityTier: definition.severityTier,
          dueWithinSeconds: definition.dueWithinSeconds,
          isRequired: definition.isRequired,
          sortOrder: index,
        })),
      })
    }

    return tx.entitlementMilestoneTemplate.findUniqueOrThrow({
      where: { id: template.id },
      include: { rules: true },
    })
  }) as TemplateRow

  return serializeTemplate(row)
}
