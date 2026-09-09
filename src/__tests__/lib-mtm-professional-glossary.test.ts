import { describe, expect, it } from "vitest"
import {
  DoctorScoringFormulaActivateSchema,
  parseGovernedDoctorScoringDefinition,
  professionalDefinitionHash,
  professionalGlossaryIsGoverned,
  professionalGlossaryProvenance,
} from "@/lib/mtm/professional-glossary"

const term = (label: string) => ({
  labels: { ru: label, az: label, en: label },
  definitions: { ru: `${label} definition`, az: `${label} definition`, en: `${label} definition` },
})

const definition = {
  engine: "server",
  glossary: {
    schemaVersion: 1,
    terms: {
      balance: term("Balance"),
      potential: term("Potential"),
      coverageDisclosure: term("Coverage"),
      doctorCategory: term("Category"),
      kol: term("KOL"),
      profile: term("Profile"),
    },
  },
  authority: {
    sourceSystem: "SwissMed approved master data",
    sourceReference: "SWM-04/glossary/2026-01",
    sourceObservedAt: "2026-08-09T10:00:00.000Z",
    approvalReference: "SWM-CAB-2026-041",
  },
}

describe("MTM governed professional glossary", () => {
  it("hashes canonical JSON independently of object key order", () => {
    const reversed = Object.fromEntries(Object.entries(definition).reverse())
    expect(professionalDefinitionHash(reversed)).toBe(professionalDefinitionHash(definition))
  })

  it("requires every multilingual professional term and authority field", () => {
    const parsed = parseGovernedDoctorScoringDefinition(definition)
    expect(parsed.success).toBe(true)
    expect(parseGovernedDoctorScoringDefinition({
      ...definition,
      glossary: {
        ...definition.glossary,
        terms: { ...definition.glossary.terms, kol: undefined },
      },
    }).success).toBe(false)
    expect(parseGovernedDoctorScoringDefinition({
      ...definition,
      authority: { ...definition.authority, approvalReference: "" },
    }).success).toBe(false)
  })

  it("requires exact hash and approval reference activation inputs", () => {
    const hash = professionalDefinitionHash(definition)
    expect(DoctorScoringFormulaActivateSchema.safeParse({
      expectedDefinitionHash: hash,
      approvalReference: definition.authority.approvalReference,
    }).success).toBe(true)
    expect(DoctorScoringFormulaActivateSchema.safeParse({
      expectedDefinitionHash: "not-a-hash",
      approvalReference: definition.authority.approvalReference,
    }).success).toBe(false)
  })

  it("builds an immutable provenance snapshot only for governed formulas", () => {
    const formula = {
      id: "formula-1",
      version: "2026.1",
      definitionHash: professionalDefinitionHash(definition),
      glossarySchemaVersion: 1,
      approvalReference: definition.authority.approvalReference,
      sourceSystem: definition.authority.sourceSystem,
      sourceReference: definition.authority.sourceReference,
      sourceObservedAt: new Date(definition.authority.sourceObservedAt),
    }
    expect(professionalGlossaryIsGoverned(formula)).toBe(true)
    expect(professionalGlossaryProvenance(formula)).toMatchObject({
      professionalGlossary: {
        formulaId: "formula-1",
        formulaVersion: "2026.1",
        definitionHash: formula.definitionHash,
        approvalReference: definition.authority.approvalReference,
      },
    })
    expect(() => professionalGlossaryProvenance({ ...formula, definitionHash: null })).toThrow()
  })
})
