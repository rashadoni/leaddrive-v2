import { validateExif } from "./validate-exif"

export interface DecideStatusInput {
  exif: Record<string, unknown> | null
  claim: {
    latitude: number | null
    longitude: number | null
    agentId: string
  }
  serverNow: Date
  maxClockDriftMs?: number
}

export interface PhotoStatusDecision {
  status: "APPROVED" | "PENDING"
  hasWatermark: boolean
  tamperingDetected: boolean
  gpsMatchedAt: Date | null
  watermarkedAt: Date | null
  reviewNote: string | null
  timeDriftCorrected: boolean
  correctedDateTimeOriginal: Date | null
}

const MAX_CLOCK_DRIFT_MS_DEFAULT = 5 * 60_000 // 5 minutes (spec §5)
const EXPECTED_SOFTWARE = "LeadDrive MTM Mobile"

const TAMPERING_REASONS = new Set([
  "gps_mismatch",
  "agent_mismatch",
  "invalid_make",
  "invalid_model",
  "invalid_software",
])

/**
 * Parse EXIF DateTimeOriginal ("YYYY:MM:DD HH:mm:ss") into a UTC Date.
 * Returns null when the input is missing or malformed — caller treats
 * that as "no client timestamp available".
 */
function parseExifDateTime(s: unknown): Date | null {
  if (typeof s !== "string") return null
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/)
  if (!m) return null
  const [, y, mo, d, h, mi, se] = m
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se))
}

/**
 * Orchestrator on top of validateExif. Translates the EXIF validation
 * result into the database-row scaffold the route writes to MtmPhoto:
 * status (APPROVED/PENDING), hasWatermark, tamperingDetected, plus
 * clock-drift correction.
 *
 * Drift handling: spec §5 — if device clock is >5 min off server clock,
 * overwrite EXIF DateTimeOriginal with serverNow so reports/audits use a
 * trusted timestamp. The boundary is strict ">" not ">=" — exactly 5min
 * is treated as within tolerance.
 */
export function decidePhotoStatus(input: DecideStatusInput): PhotoStatusDecision {
  const { exif, claim, serverNow, maxClockDriftMs = MAX_CLOCK_DRIFT_MS_DEFAULT } = input

  if (!exif) {
    return {
      status: "PENDING",
      hasWatermark: false,
      tamperingDetected: false,
      gpsMatchedAt: null,
      watermarkedAt: null,
      reviewNote: "EXIF missing",
      timeDriftCorrected: false,
      correctedDateTimeOriginal: null,
    }
  }

  const hasOurSoftware = exif.Software === EXPECTED_SOFTWARE
  const watermarkedAt = parseExifDateTime(exif.DateTimeOriginal)

  // Clock-drift correction independent of identity/GPS validation —
  // even if other tags are tampered, we still know what server time is.
  let timeDriftCorrected = false
  let correctedDateTimeOriginal: Date | null = null
  if (watermarkedAt) {
    const driftMs = Math.abs(serverNow.getTime() - watermarkedAt.getTime())
    if (driftMs > maxClockDriftMs) {
      timeDriftCorrected = true
      correctedDateTimeOriginal = serverNow
    }
  }

  const validation = validateExif({ exif, claim })

  if (validation.ok) {
    return {
      status: "APPROVED",
      hasWatermark: hasOurSoftware,
      tamperingDetected: false,
      gpsMatchedAt: validation.gpsMatched ? serverNow : null,
      watermarkedAt,
      reviewNote: null,
      timeDriftCorrected,
      correctedDateTimeOriginal,
    }
  }

  // Tampered/invalid → never show the watermark badge, even if Software
  // happened to be correct. Decouples "we trust this photo" from
  // "this photo claims to come from our app".
  return {
    status: "PENDING",
    hasWatermark: false,
    tamperingDetected: TAMPERING_REASONS.has(validation.reason),
    gpsMatchedAt: null,
    watermarkedAt,
    reviewNote: `EXIF mismatch: ${validation.reason}`,
    timeDriftCorrected,
    correctedDateTimeOriginal,
  }
}
