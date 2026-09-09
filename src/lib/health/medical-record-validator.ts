/**
 * Medical record validator — R2 slice 1.
 *
 * The `health_medical_records.details` column is JSONB. The DB allows
 * arbitrary shapes; this helper enforces the per-record-type contract
 * that downstream code expects.
 *
 * Each of the 10 record types has a required-key set. Helper rejects:
 *   • non-object payloads (null, arrays, primitives)
 *   • missing required keys
 *   • extra keys that aren't in the (required ∪ optional) allow-list
 *   • prototype-chain pollution (__proto__ / constructor / prototype)
 *
 * Slice-2 may tighten with per-key type checks (ICD-10 regex, CPT
 * 5-digit-code check, etc.) and clinical-coding-system lookup. Slice-1
 * keeps it structural — caller still has to pick reasonable values.
 */
import {
  MEDICAL_RECORD_SENSITIVITIES,
  MEDICAL_RECORD_SEVERITIES,
  MEDICAL_RECORD_TYPES,
  type MedicalRecordSensitivity,
  type MedicalRecordSeverity,
  type MedicalRecordType,
  type ValidateMedicalRecordInput,
  type ValidateMedicalRecordResult,
} from "./types"

/** Per-record-type required keys (must be present, non-null). */
const REQUIRED_KEYS: Readonly<Record<MedicalRecordType, readonly string[]>> = {
  visit_summary: ["reasonForVisit", "assessment", "plan"],
  diagnosis: ["icd10Code", "description", "status"],
  lab_result: ["testName", "value", "unit"],
  procedure: ["cptCode", "description", "performedAt"],
  medication: ["name", "dosage", "frequency", "route", "startDate"],
  allergy: ["allergen", "reaction", "severity"],
  immunization: ["vaccine", "doseNumber", "administeredAt"],
  vital_signs: [],
  imaging: ["modality", "bodyPart", "findings", "performedAt"],
  discharge_summary: ["primaryDiagnosis", "instructions"],
}

/** Per-record-type optional keys (allowed). The union of REQ + OPT
 *  forms the allow-list for incoming payloads. */
const OPTIONAL_KEYS: Readonly<Record<MedicalRecordType, readonly string[]>> = {
  visit_summary: ["followUp", "providerNotes"],
  diagnosis: ["severity", "onsetDate", "resolvedDate", "icd10Subcode"],
  lab_result: ["referenceRange", "abnormal", "collectionDate", "interpretation"],
  procedure: ["outcome", "complications", "performingProviderId"],
  medication: ["endDate", "prescribingProviderId", "indication", "ndcCode"],
  allergy: ["onsetDate", "notes"],
  immunization: ["manufacturer", "lotNumber", "administeringProviderId"],
  vital_signs: [
    "bloodPressureSystolic",
    "bloodPressureDiastolic",
    "heartRate",
    "respiratoryRate",
    "temperatureCelsius",
    "oxygenSaturationPct",
    "weightKg",
    "heightCm",
    "bmi",
    "painScore",
  ],
  imaging: ["impression", "performingProviderId", "studyInstanceUid"],
  discharge_summary: ["followUp", "medicationsAtDischarge", "dispositionLabel"],
}

/** Reject anything that walks the prototype chain. */
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"])

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date)
  )
}

function isRecordType(v: unknown): v is MedicalRecordType {
  return (
    typeof v === "string" &&
    (MEDICAL_RECORD_TYPES as readonly string[]).includes(v)
  )
}

function isSeverity(v: unknown): v is MedicalRecordSeverity {
  return (
    typeof v === "string" &&
    (MEDICAL_RECORD_SEVERITIES as readonly string[]).includes(v)
  )
}

function isSensitivity(v: unknown): v is MedicalRecordSensitivity {
  return (
    typeof v === "string" &&
    (MEDICAL_RECORD_SENSITIVITIES as readonly string[]).includes(v)
  )
}

/**
 * Validate a medical record payload + metadata.
 *
 * Slice-1 contract:
 *   • recordType must be one of the 10 allow-list values
 *   • severity / sensitivity must be allow-list values
 *   • details must be a plain object (not null, not array, not Date)
 *   • all required keys present (non-undefined; null IS allowed for
 *     optional fields by convention, but required ones cannot be null
 *     or undefined since they carry the clinical signal)
 *   • no extra keys outside (REQUIRED ∪ OPTIONAL)
 *   • no prototype-chain keys
 *
 * Slice-2 worker can layer per-key type checks (regex on ICD-10, etc.).
 */
export function validateMedicalRecord(
  input: ValidateMedicalRecordInput
): ValidateMedicalRecordResult {
  if (!isRecordType(input.recordType)) {
    return {
      ok: false,
      error: `unknown recordType "${String(input.recordType)}"`,
      field: "recordType",
    }
  }
  if (!isSeverity(input.severity)) {
    return {
      ok: false,
      error: `unknown severity "${String(input.severity)}"`,
      field: "severity",
    }
  }
  if (!isSensitivity(input.sensitivity)) {
    return {
      ok: false,
      error: `unknown sensitivity "${String(input.sensitivity)}"`,
      field: "sensitivity",
    }
  }

  const details = input.details
  if (!isPlainObject(details)) {
    return {
      ok: false,
      error: "details must be a plain object",
      field: "details",
    }
  }

  // Prototype-chain pollution guard. Use hasOwnProperty (not in-operator)
  // since the in-operator walks the prototype chain and would always
  // see "constructor" inherited from Object.prototype.
  for (const key of FORBIDDEN_KEYS) {
    if (Object.prototype.hasOwnProperty.call(details, key)) {
      return {
        ok: false,
        error: `forbidden key "${key}" in details`,
        field: `details.${key}`,
      }
    }
  }

  const required = REQUIRED_KEYS[input.recordType]
  const optional = OPTIONAL_KEYS[input.recordType]
  const allowList = new Set<string>([...required, ...optional])

  for (const rk of required) {
    if (
      !Object.prototype.hasOwnProperty.call(details, rk) ||
      details[rk] === null ||
      details[rk] === undefined
    ) {
      return {
        ok: false,
        error: `missing required key "${rk}" for recordType "${input.recordType}"`,
        field: `details.${rk}`,
      }
    }
  }

  for (const k of Object.keys(details)) {
    if (!allowList.has(k)) {
      return {
        ok: false,
        error: `unknown key "${k}" for recordType "${input.recordType}"`,
        field: `details.${k}`,
      }
    }
  }

  return { ok: true }
}

/** Test-only export — surfaces the contract so vitest can pin it. */
export const __VALIDATOR_INTERNALS = {
  REQUIRED_KEYS,
  OPTIONAL_KEYS,
  FORBIDDEN_KEYS,
}
