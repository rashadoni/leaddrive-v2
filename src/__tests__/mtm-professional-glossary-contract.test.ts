import fs from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const source = (relative: string) => fs.readFileSync(path.join(root, relative), "utf8")

describe("SWM-04 professional glossary integration contract", () => {
  it("migrates governed source metadata without rewriting legacy formulas", () => {
    const migration = source("prisma/migrations/20260809210000_mtm_professional_glossary_contract/migration.sql")
    expect(migration).toContain('ADD COLUMN "definitionHash" VARCHAR(64)')
    expect(migration).toContain('"glossarySchemaVersion" = 1')
    expect(migration).toContain('"sourceObservedAt" IS NOT NULL')
    expect(migration).not.toContain("UPDATE \"mtm_doctor_scoring_formulas\"")
  })

  it("pins the glossary in web assessments and web/mobile brand potential writes", () => {
    const assessment = source("src/app/api/v1/mtm/contacts/[id]/assessments/route.ts")
    const potential = source("src/app/api/v1/mtm/contacts/[id]/brand-potentials/route.ts")
    const mobile = source("src/app/api/v1/mtm/mobile/sync/push/route.ts")
    for (const route of [assessment, potential, mobile]) {
      expect(route).toContain("professionalGlossaryProvenance")
      expect(route).toContain("MTM_PROFESSIONAL_GLOSSARY_NOT_ACTIVE")
    }
    expect(potential).toContain("formulaVersion: glossaryFormula.version")
    expect(mobile).toContain("formulaVersion: glossaryFormula.version")
  })

  it("exposes the signed definitions and removes client-selected potential formula versions", () => {
    const panel = source("src/components/mtm/contact-scoring-panel.tsx")
    const dialogs = source("src/components/mtm/contact-scoring-entry-dialogs.tsx")
    expect(panel).toContain('t("governedGlossaryTitle")')
    expect(panel).toContain("professionalGlossaryTerms")
    expect(dialogs).not.toContain('id="potential-formula-version"')
    expect(dialogs).toContain("formula.glossarySchemaVersion === 1")
  })
})
