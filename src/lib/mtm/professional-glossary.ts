import { createHash } from "node:crypto"
import { z } from "zod"

const Text = z.string().trim().min(1).max(1_000)
const Labels = z.object({ ru: Text, az: Text, en: Text }).strict()

export const ProfessionalGlossaryTermSchema = z.object({
  labels: Labels,
  definitions: Labels,
  unit: z.string().trim().max(120).optional(),
  sourceField: z.string().trim().max(200).optional(),
}).strict()

export const ProfessionalGlossarySchema = z.object({
  schemaVersion: z.literal(1),
  terms: z.object({
    balance: ProfessionalGlossaryTermSchema,
    potential: ProfessionalGlossaryTermSchema,
    coverageDisclosure: ProfessionalGlossaryTermSchema,
    doctorCategory: ProfessionalGlossaryTermSchema,
    kol: ProfessionalGlossaryTermSchema,
    profile: ProfessionalGlossaryTermSchema,
  }).strict(),
}).strict()

export const ProfessionalGlossaryAuthoritySchema = z.object({
  sourceSystem: z.string().trim().min(2).max(120),
  sourceReference: z.string().trim().max(500).optional(),
  sourceObservedAt: z.string().datetime({ offset: true }),
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

export const GovernedDoctorScoringDefinitionSchema = z.object({
  glossary: ProfessionalGlossarySchema,
  authority: ProfessionalGlossaryAuthoritySchema,
}).passthrough()

export const DoctorScoringFormulaActivateSchema = z.object({
  expectedDefinitionHash: z.string().regex(/^[a-fA-F0-9]{64}$/),
  approvalReference: z.string().trim().min(3).max(500),
}).strict()

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, canonical(nested)]))
}

export function professionalDefinitionHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex")
}

export function parseGovernedDoctorScoringDefinition(value: unknown) {
  const parsed = GovernedDoctorScoringDefinitionSchema.safeParse(value)
  if (!parsed.success) return parsed
  return {
    success: true as const,
    data: {
      definition: parsed.data,
      definitionHash: professionalDefinitionHash(parsed.data),
      glossarySchemaVersion: parsed.data.glossary.schemaVersion,
      approvalReference: parsed.data.authority.approvalReference,
      sourceSystem: parsed.data.authority.sourceSystem,
      sourceReference: parsed.data.authority.sourceReference ?? null,
      sourceObservedAt: new Date(parsed.data.authority.sourceObservedAt),
    },
  }
}

export interface ProfessionalGlossaryFormulaSnapshot {
  id: string
  version: string
  definitionHash: string | null
  glossarySchemaVersion: number | null
  approvalReference: string | null
  sourceSystem: string | null
  sourceReference: string | null
  sourceObservedAt: Date | null
}

export function professionalGlossaryIsGoverned(
  formula: ProfessionalGlossaryFormulaSnapshot,
): formula is ProfessionalGlossaryFormulaSnapshot & {
  definitionHash: string
  glossarySchemaVersion: 1
  approvalReference: string
  sourceSystem: string
  sourceObservedAt: Date
} {
  return formula.glossarySchemaVersion === 1
    && /^[a-f0-9]{64}$/.test(formula.definitionHash ?? "")
    && Boolean(formula.approvalReference?.trim())
    && Boolean(formula.sourceSystem?.trim())
    && formula.sourceObservedAt instanceof Date
}

export function professionalGlossaryProvenance(
  formula: ProfessionalGlossaryFormulaSnapshot,
): Record<string, unknown> {
  if (!professionalGlossaryIsGoverned(formula)) {
    throw new Error("Active doctor scoring formula has no governed professional glossary")
  }
  return {
    professionalGlossary: {
      schemaVersion: formula.glossarySchemaVersion,
      definitionHash: formula.definitionHash,
      formulaId: formula.id,
      formulaVersion: formula.version,
      approvalReference: formula.approvalReference,
      sourceSystem: formula.sourceSystem,
      sourceReference: formula.sourceReference,
      sourceObservedAt: formula.sourceObservedAt.toISOString(),
    },
  }
}
