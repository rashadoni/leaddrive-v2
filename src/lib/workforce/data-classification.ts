/**
 * The single technical vocabulary for Workforce data handling. This is a
 * classification contract, not a legal basis or a deletion job: those remain
 * gated by C10 legal-hold, staging and rollout evidence.
 */
export const WORKFORCE_DATA_CLASSES = [
  "RAW_LOCATION",
  "DERIVED_VERDICT",
  "TIME_FACT",
  "REQUEST_REASON",
  "DEVICE_EVIDENCE",
  "AUDIT_RECORD",
  "EXPORT_ARTIFACT",
] as const

export type WorkforceDataClass = typeof WORKFORCE_DATA_CLASSES[number]
export type WorkforceRetentionClass = "RAW_GPS_30_DAYS" | "TIME_DECISION_1_YEAR" | "POLICY_DEFINED"

type WorkforceDataClassification = {
  retention: WorkforceRetentionClass
  ordinaryTimesheetExport: boolean
  generalTelemetry: boolean
  description: string
}

/**
 * Do not add a Workforce evidence field without choosing a class here.
 * Ordinary export is allow-list based: an omitted class cannot enter it by
 * accident.
 */
export const WORKFORCE_DATA_CLASSIFICATION: Record<WorkforceDataClass, WorkforceDataClassification> = {
  RAW_LOCATION: {
    retention: "RAW_GPS_30_DAYS",
    ordinaryTimesheetExport: false,
    generalTelemetry: false,
    description: "Exact coordinates, accuracy and encrypted location envelope",
  },
  DERIVED_VERDICT: {
    retention: "TIME_DECISION_1_YEAR",
    ordinaryTimesheetExport: false,
    generalTelemetry: false,
    description: "Non-reversible assessment verdict/reason and redacted receipt",
  },
  TIME_FACT: {
    retention: "TIME_DECISION_1_YEAR",
    ordinaryTimesheetExport: true,
    generalTelemetry: false,
    description: "Immutable workday/event, snapshot, correction and approved-time facts",
  },
  REQUEST_REASON: {
    retention: "TIME_DECISION_1_YEAR",
    ordinaryTimesheetExport: false,
    generalTelemetry: false,
    description: "Employee request reason, decision note and correction explanation",
  },
  DEVICE_EVIDENCE: {
    retention: "POLICY_DEFINED",
    ordinaryTimesheetExport: false,
    generalTelemetry: false,
    description: "Device enrollment/proof, QR/security material and attestation metadata",
  },
  AUDIT_RECORD: {
    retention: "TIME_DECISION_1_YEAR",
    ordinaryTimesheetExport: false,
    generalTelemetry: false,
    description: "Accountability record for a permitted Workforce action/access",
  },
  EXPORT_ARTIFACT: {
    retention: "POLICY_DEFINED",
    ordinaryTimesheetExport: false,
    generalTelemetry: false,
    description: "Export artifact, checksum, recipient/purpose/channel and expiry metadata",
  },
}

export function assertWorkforceOrdinaryTimesheetExportClasses(
  classes: readonly WorkforceDataClass[],
): void {
  const unsafe = classes.find((dataClass) => !WORKFORCE_DATA_CLASSIFICATION[dataClass].ordinaryTimesheetExport)
  if (unsafe) {
    throw new Error(`Workforce data class ${unsafe} is not permitted in an ordinary timesheet export`)
  }
}
