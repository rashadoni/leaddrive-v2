import { describe, expect, it } from "vitest"
import {
  assertWorkforceOrdinaryTimesheetExportClasses,
  WORKFORCE_DATA_CLASSES,
  WORKFORCE_DATA_CLASSIFICATION,
} from "@/lib/workforce/data-classification"

describe("Workforce data classification", () => {
  it("classifies every required HRM evidence class with a retention and disclosure boundary", () => {
    expect(WORKFORCE_DATA_CLASSES).toEqual([
      "RAW_LOCATION",
      "DERIVED_VERDICT",
      "TIME_FACT",
      "REQUEST_REASON",
      "DEVICE_EVIDENCE",
      "AUDIT_RECORD",
      "EXPORT_ARTIFACT",
    ])
    for (const dataClass of WORKFORCE_DATA_CLASSES) {
      expect(WORKFORCE_DATA_CLASSIFICATION[dataClass].description).toBeTruthy()
      expect(WORKFORCE_DATA_CLASSIFICATION[dataClass].retention).toBeTruthy()
      expect(WORKFORCE_DATA_CLASSIFICATION[dataClass].generalTelemetry).toBe(false)
    }
    expect(WORKFORCE_DATA_CLASSIFICATION.RAW_LOCATION.retention).toBe("RAW_GPS_30_DAYS")
    expect(WORKFORCE_DATA_CLASSIFICATION.TIME_FACT.retention).toBe("TIME_DECISION_1_YEAR")
  })

  it("keeps ordinary timesheet export on an explicit time-fact allow-list", () => {
    expect(() => assertWorkforceOrdinaryTimesheetExportClasses(["TIME_FACT"])).not.toThrow()
    for (const dataClass of WORKFORCE_DATA_CLASSES.filter((dataClass) => dataClass !== "TIME_FACT")) {
      expect(() => assertWorkforceOrdinaryTimesheetExportClasses([dataClass])).toThrow(/not permitted/)
    }
  })
})
