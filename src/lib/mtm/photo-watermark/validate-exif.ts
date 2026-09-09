import { haversineMeters } from "./haversine"

export interface ExifValidationInput {
  exif: Record<string, unknown> | null
  claim: {
    latitude: number | null
    longitude: number | null
    agentId: string
  }
  maxDistanceMeters?: number
}

export type ExifValidationFailureReason =
  | "missing_required_tag"
  | "invalid_software"
  | "invalid_make"
  | "invalid_model"
  | "agent_mismatch"
  | "gps_mismatch"

export type ExifValidationResult =
  | { ok: true; gpsMatched: boolean }
  | { ok: false; reason: ExifValidationFailureReason }

// Spec §2 lists all five as required identity tags. Keeping them in
// REQUIRED_TAGS means an attacker who strips Make+Model entirely (the
// previous undefined-bypass) now hits missing_required_tag instead of
// silently passing validation.
const REQUIRED_TAGS = [
  "DateTimeOriginal",
  "Software",
  "ImageDescription",
  "Make",
  "Model",
] as const
const EXPECTED_SOFTWARE = "LeadDrive MTM Mobile"
const EXPECTED_MAKE = "LeadDrive MTM"
// Accept any "v<digits>.<digits>.<digits>" — we don't want to fail the
// validator every time the mobile app bumps a patch.
const MODEL_VERSION_REGEX = /^v\d+\.\d+\.\d+$/
const DEFAULT_MAX_DISTANCE_M = 50

/**
 * Validate EXIF metadata of an uploaded photo against the auth context.
 * Returns ok=true/gpsMatched when the photo provably came from our
 * LeadDrive MTM Mobile client for the authenticated agent, or ok=false
 * with a machine-readable reason for downstream audit/review pipelines.
 *
 * See docs/mtm-photo-watermark-spec.md §4 for the contract.
 */
export function validateExif(input: ExifValidationInput): ExifValidationResult {
  const { exif, claim, maxDistanceMeters = DEFAULT_MAX_DISTANCE_M } = input

  if (!exif) {
    return { ok: false, reason: "missing_required_tag" }
  }

  // Required tags presence
  for (const tag of REQUIRED_TAGS) {
    const v = exif[tag]
    if (v === undefined || v === null || v === "") {
      return { ok: false, reason: "missing_required_tag" }
    }
  }

  // Identity tags — Software, Make, Model (all guaranteed present here
  // because REQUIRED_TAGS includes them; the undefined-bypass was closed
  // in the architect green-phase review).
  if (exif.Software !== EXPECTED_SOFTWARE) {
    return { ok: false, reason: "invalid_software" }
  }
  if (exif.Make !== EXPECTED_MAKE) {
    return { ok: false, reason: "invalid_make" }
  }
  if (typeof exif.Model !== "string" || !MODEL_VERSION_REGEX.test(exif.Model)) {
    return { ok: false, reason: "invalid_model" }
  }

  // Agent identity from ImageDescription JSON
  let desc: Record<string, unknown>
  try {
    desc = JSON.parse(exif.ImageDescription as string) as Record<string, unknown>
  } catch {
    return { ok: false, reason: "agent_mismatch" }
  }
  if (desc.agentId !== claim.agentId) {
    return { ok: false, reason: "agent_mismatch" }
  }

  // GPS check (optional — photo without GPS is a legit edge case, spec §5)
  const exifLat = exif.GPSLatitude
  const exifLng = exif.GPSLongitude
  const hasExifGps = typeof exifLat === "number" && typeof exifLng === "number"
  const hasClaimGps =
    typeof claim.latitude === "number" && typeof claim.longitude === "number"

  if (hasExifGps && hasClaimGps) {
    const distance = haversineMeters(
      { latitude: exifLat, longitude: exifLng },
      { latitude: claim.latitude as number, longitude: claim.longitude as number },
    )
    if (distance > maxDistanceMeters) {
      return { ok: false, reason: "gps_mismatch" }
    }
    return { ok: true, gpsMatched: true }
  }

  // No GPS to compare against — accept as gpsMatched=false (review UI
  // shows a badge per spec §5 edge-case "GPS недоступен").
  return { ok: true, gpsMatched: false }
}
