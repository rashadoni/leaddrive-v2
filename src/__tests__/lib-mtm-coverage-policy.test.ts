import { describe, expect, it } from "vitest"
import {
  CoveragePolicyDefinitionSchema,
  coveragePolicyHash,
  coveragePolicySignatureIsCoherent,
  coverageSnapshotIsComplete,
  coverageSnapshotTotalsReconcile,
} from "@/lib/mtm/coverage-policy"

function metric(source = "FIELD_POTENTIAL") {
  return { source, unit: "VALUE", rule: { field: "coverageValue" } }
}

function definition() {
  return {
    schemaVersion: 1,
    timezone: "Asia/Baku",
    rounding: { mode: "HALF_UP", scale: 2 },
    groups: [{
      key: "doctors",
      order: 1,
      subjectType: "DOCTOR",
      labels: { ru: "Врачи", az: "Həkimlər", en: "Doctors" },
      population: { source: "CONTACT", filter: { type: "DOCTOR", status: "ACTIVE" } },
      metrics: {
        requiredCoverage: metric(),
        actualMoi: metric("EXTERNAL_SOURCE"),
        target: metric("EXTERNAL_SOURCE"),
        actualCoverage: metric(),
        uncoveredMoi: metric("EXTERNAL_SOURCE"),
      },
    }],
    reconciliation: { kpiFormulaVersion: "SWM15-v1", tolerance: "0.0001" },
  }
}

describe("MTM coverage policy contract", () => {
  it("produces a stable signature independent of object key insertion order", () => {
    const left = definition()
    const right = { ...left, rounding: { scale: 2, mode: "HALF_UP" } }
    expect(coveragePolicyHash(left)).toBe(coveragePolicyHash(right))
  })

  it("rejects a doctor group backed by a customer population", () => {
    const invalid = structuredClone(definition())
    const population = invalid.groups[0].population as { source: string }
    population.source = "CUSTOMER"
    expect(CoveragePolicyDefinitionSchema.safeParse(invalid).success).toBe(false)
  })

  it("accepts only an intact signed active policy", () => {
    const value = definition()
    const signed = {
      status: "ACTIVE",
      definition: value,
      definitionHash: coveragePolicyHash(value),
      approvalReference: "SwissMed approval SWM15-2026-08",
      signedByUserId: "user-1",
      signedAt: new Date("2026-08-08T08:00:00.000Z"),
      activatedAt: new Date("2026-08-08T08:00:00.000Z"),
      retiredAt: null,
    }
    expect(coveragePolicySignatureIsCoherent(signed)).toBe(true)
    expect(coveragePolicySignatureIsCoherent({ ...signed, definitionHash: "0".repeat(64) })).toBe(false)
    expect(coveragePolicySignatureIsCoherent({ ...signed, approvalReference: "" })).toBe(false)
  })

  it("never treats partial population persistence as complete", () => {
    expect(coverageSnapshotIsComplete({
      schemaVersion: 1,
      complete: true,
      expectedRows: 169,
      persistedRows: 168,
      missingSources: [],
      warnings: [],
    })).toBe(false)
    expect(coverageSnapshotIsComplete({
      schemaVersion: 1,
      complete: true,
      expectedRows: 169,
      persistedRows: 169,
      missingSources: [],
      warnings: [],
    })).toBe(true)
  })

  it("rejects a snapshot whose overall values do not reconcile with its groups", () => {
    const totals = {
      groups: [{
        key: "doctors",
        label: "Врачи",
        order: 1,
        subjectType: "DOCTOR",
        populationCount: 119,
        requiredCoverage: "119",
        actualMoi: "82",
        target: "0",
        actualCoverage: "82",
        uncoveredMoi: "31",
      }],
      overall: {
        populationCount: 119,
        requiredCoverage: "119",
        actualMoi: "82",
        target: "0",
        actualCoverage: "82",
        uncoveredMoi: "37",
      },
    }
    expect(coverageSnapshotTotalsReconcile(totals)).toBe(false)
    totals.overall.uncoveredMoi = "31"
    expect(coverageSnapshotTotalsReconcile(totals)).toBe(true)
  })
})
