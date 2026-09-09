import { describe, expect, it } from "vitest"
import { CoverageSnapshotImportSchema, coveragePolicyHash } from "@/lib/mtm/coverage-policy"
import { prepareCoverageSnapshot } from "@/lib/mtm/coverage-snapshot"

const definition = {
  schemaVersion: 1 as const,
  timezone: "Asia/Baku",
  rounding: { mode: "HALF_UP" as const, scale: 2 },
  groups: [
    {
      key: "pharmacies",
      order: 1,
      subjectType: "PHARMACY" as const,
      labels: { ru: "Аптеки", az: "Apteklər", en: "Pharmacies" },
      population: { source: "CUSTOMER" as const, filter: { objectType: "PHARMACY" } },
      metrics: Object.fromEntries(["requiredCoverage", "actualMoi", "target", "actualCoverage", "uncoveredMoi"].map((key) => [key, {
        source: "EXTERNAL_SOURCE",
        unit: "VALUE",
        rule: { field: key },
      }])) as never,
    },
    {
      key: "doctors",
      order: 2,
      subjectType: "DOCTOR" as const,
      labels: { ru: "Врачи", az: "Həkimlər", en: "Doctors" },
      population: { source: "CONTACT" as const, filter: { type: "DOCTOR" } },
      metrics: Object.fromEntries(["requiredCoverage", "actualMoi", "target", "actualCoverage", "uncoveredMoi"].map((key) => [key, {
        source: "EXTERNAL_SOURCE",
        unit: "VALUE",
        rule: { field: key },
      }])) as never,
    },
  ],
  reconciliation: { kpiFormulaVersion: "SWM15-v1", tolerance: "0.0001" },
}

const rowEvidence = {
  explanation: {
    summary: {
      ru: "Не покрыто по подписанной формуле",
      az: "İmzalanmış düstura görə əhatə olunmayıb",
      en: "Uncovered under the signed formula",
    },
    formula: "signed-external-result",
  },
  planningContext: { direction: "DOCTORS" },
  sourceEvidence: { sourceRow: "row-1" },
}

function importInput(rows: unknown[]) {
  return CoverageSnapshotImportSchema.parse({
    policyId: "policy-1",
    expectedDefinitionHash: coveragePolicyHash(definition),
    agentId: "agent-1",
    periodStart: "2026-06-01",
    periodEnd: "2026-06-30",
    sourceCutoffAt: "2026-06-30T20:00:00.000Z",
    sourceFreshnessAt: "2026-06-30T19:45:00.000Z",
    sourceBatchReference: "swissmed-2026-06",
    rows,
  })
}

const pharmacies = {
  subjectType: "PHARMACY",
  subjectId: "pharmacy-1",
  subjectName: "Pharmacy 1",
  groupKey: "pharmacies",
  requiredCoverage: "50",
  actualMoi: "44",
  target: "0",
  actualCoverage: "44",
  uncoveredMoi: "30",
  ...rowEvidence,
}

const doctors = {
  subjectType: "DOCTOR",
  subjectId: "doctor-1",
  subjectName: "Doctor 1",
  customerId: "clinic-1",
  customerName: "Clinic 1",
  groupKey: "doctors",
  requiredCoverage: "119",
  actualMoi: "82",
  target: "0",
  actualCoverage: "82",
  uncoveredMoi: "31",
  ...rowEvidence,
}

describe("MTM coverage snapshot preparation", () => {
  it("preserves signed row metrics and reconciles totals without inventing uncovered MOI", () => {
    const result = prepareCoverageSnapshot(definition, importInput([pharmacies, doctors]), { id: "agent-1", name: "Aysel" })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.totals.groups).toEqual([
      expect.objectContaining({ key: "pharmacies", label: "Аптеки", labels: definition.groups[0].labels, uncoveredMoi: "30" }),
      expect.objectContaining({ key: "doctors", label: "Врачи", labels: definition.groups[1].labels, uncoveredMoi: "31" }),
    ])
    expect(result.value.totals.overall).toMatchObject({
      requiredCoverage: "169",
      actualMoi: "126",
      actualCoverage: "126",
      uncoveredMoi: "61",
    })
    expect(result.value.totals.overall.uncoveredMoi).not.toBe("43")
  })

  it("produces the same population hash regardless of source row order", () => {
    const left = prepareCoverageSnapshot(definition, importInput([pharmacies, doctors]), { id: "agent-1", name: "Aysel" })
    const right = prepareCoverageSnapshot(definition, importInput([doctors, pharmacies]), { id: "agent-1", name: "Aysel" })
    expect(left.ok && right.ok && left.value.populationHash).toBe(right.ok ? right.value.populationHash : "")
  })

  it("rejects group/type drift and values outside the signed rounding scale", () => {
    const result = prepareCoverageSnapshot(definition, importInput([{
      ...doctors,
      groupKey: "pharmacies",
      actualCoverage: "82.001",
    }]), { id: "agent-1", name: "Aysel" })
    expect(result).toEqual({
      ok: false,
      issues: expect.arrayContaining([
        "rows.0.subjectType:GROUP_SUBJECT_MISMATCH",
        "rows.0.actualCoverage:ROUNDING_SCALE_MISMATCH",
      ]),
    })
  })

  it("rejects negative coverage values before snapshot preparation", () => {
    expect(CoverageSnapshotImportSchema.safeParse({
      ...importInput([pharmacies]),
      rows: [{ ...pharmacies, uncoveredMoi: "-1" }],
    }).success).toBe(false)
  })
})
