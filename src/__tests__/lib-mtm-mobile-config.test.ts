import { describe, expect, it } from "vitest"
import { buildMobileConfig } from "@/lib/mtm/mobile-config"

describe("MTM mobile config", () => {
  it("keeps only namespaced dictionary/formula settings", () => {
    const config = buildMobileConfig([
      { key: "dictionary:visitOutcome", value: { ru: "Результат" }, updatedAt: new Date("2026-07-18T10:00:00Z") },
      { key: "formula:coverage", value: { expression: "visited / planned" }, updatedAt: new Date("2026-07-18T11:00:00Z") },
      { key: "timezone", value: "Asia/Baku", updatedAt: new Date("2026-07-18T12:00:00Z") },
    ])
    expect(config).toEqual({
      version: "2026-07-18T11:00:00.000Z",
      dictionaries: { visitOutcome: { ru: "Результат" } },
      formulas: { coverage: { expression: "visited / planned" } },
    })
  })

  it("returns a stable zero version when no config exists", () => {
    expect(buildMobileConfig([])).toEqual({ version: "0", dictionaries: {}, formulas: {} })
  })

  it("publishes signed contact dictionaries over transitional settings", () => {
    const config = buildMobileConfig([
      { key: "dictionary:psychotype", value: { legacy: true }, updatedAt: new Date("2026-08-01T10:00:00Z") },
    ], [{
      id: "dictionary-1",
      kind: "PSYCHOTYPE",
      version: 2,
      nameRu: "Психотип",
      nameAz: "Psixotip",
      nameEn: "Psychotype",
      entries: [{ code: "ANALYTICAL", order: 1, labels: { ru: "Аналитический", az: "Analitik", en: "Analytical" } }],
      entriesHash: "a".repeat(64),
      approvalReference: "SWM-03 approval",
      sourceSystem: "SwissMed master data",
      sourceReference: "SWM03-DICT-2",
      sourceObservedAt: new Date("2026-08-07T12:00:00Z"),
      effectiveFrom: new Date("2026-08-08T00:00:00Z"),
      signedAt: new Date("2026-08-08T09:00:00Z"),
      updatedAt: new Date("2026-08-08T09:00:00Z"),
    }])

    expect(config.version).toBe("2026-08-08T09:00:00.000Z")
    expect(config.dictionaries.psychotype).toMatchObject({
      id: "dictionary-1",
      kind: "PSYCHOTYPE",
      version: 2,
      approvalReference: "SWM-03 approval",
      effectiveFrom: "2026-08-08",
    })
  })
})
