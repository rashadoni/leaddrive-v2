/**
 * License expiration calculator — R8 slice 1.
 *
 * Given a license type + issued date, computes:
 *   • expiresAt — when the license naturally expires.
 *   • termYears — how many years the term covers.
 *   • gracePeriodDays — slice-2 cron uses this to delay status flip
 *     to revoked after expiration (e.g. driver's license has 30-day
 *     grace; food-service permit has 0-day grace).
 *
 * Term lengths (slice-1 defaults — slice-2 reads per-jurisdiction
 * config from a table):
 *   driver           — 4 years, 30-day grace
 *   business         — 1 year, 30-day grace
 *   building_permit  — 1 year, 0-day grace (construction window)
 *   food_service     — 1 year, 0-day grace (food safety)
 *   liquor           — 1 year, 0-day grace (alcohol control)
 *   professional     — 2 years, 60-day grace (renew certifications)
 *   hunting_fishing  — 1 year, 0-day grace (seasonal)
 *   event_permit     — 1 day, 0-day grace (single-event)
 *   other            — 1 year default, 30-day grace
 *
 * Pure synchronous.
 */
import {
  LICENSE_TYPES,
  type CalculateLicenseExpirationInput,
  type CalculateLicenseExpirationResult,
  type LicenseType,
} from "./types"

const TERM_YEARS_DEFAULT: Readonly<Record<LicenseType, number>> = {
  driver: 4,
  business: 1,
  building_permit: 1,
  food_service: 1,
  liquor: 1,
  professional: 2,
  hunting_fishing: 1,
  // Event permits are typically single-day; encoded as 1/365 year.
  // Caller using `termYearsOverride` for multi-day events.
  event_permit: 1 / 365,
  other: 1,
}

const GRACE_PERIOD_DAYS: Readonly<Record<LicenseType, number>> = {
  driver: 30,
  business: 30,
  building_permit: 0,
  food_service: 0,
  liquor: 0,
  professional: 60,
  hunting_fishing: 0,
  event_permit: 0,
  other: 30,
}

function isLicenseType(v: unknown): v is LicenseType {
  return (
    typeof v === "string" && (LICENSE_TYPES as readonly string[]).includes(v)
  )
}

function isFiniteDate(d: unknown): d is Date {
  return d instanceof Date && Number.isFinite(d.getTime())
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

export function calculateLicenseExpiration(
  input: CalculateLicenseExpirationInput
): CalculateLicenseExpirationResult {
  if (!isLicenseType(input.licenseType)) {
    return {
      ok: false,
      error: `unknown licenseType "${String(input.licenseType)}"`,
    }
  }
  if (!isFiniteDate(input.issuedAt)) {
    return { ok: false, error: "issuedAt must be a finite Date" }
  }
  if (input.termYearsOverride !== undefined) {
    if (
      !Number.isFinite(input.termYearsOverride) ||
      input.termYearsOverride <= 0
    ) {
      return {
        ok: false,
        error: "termYearsOverride must be a positive finite number",
      }
    }
  }

  const termYears =
    input.termYearsOverride !== undefined
      ? input.termYearsOverride
      : TERM_YEARS_DEFAULT[input.licenseType]
  const gracePeriodDays = GRACE_PERIOD_DAYS[input.licenseType]

  // Slice-2 split: long-term licenses use 365.25-day year (leap-year
  // averaging — over a 5-year license the half-day-per-year drift
  // averages to 1 leap day, which is what we want). Sub-year terms
  // (event_permit = 1/365) need whole-day rounding instead — using
  // 365.25 made event_permit ~59 seconds short of one calendar day,
  // which made "issued at 2026-01-15 10:00:00, expires at 2026-01-16
  // 09:59:01" instead of the operator-expected 24-hour rollover.
  //
  // Rule: termYears < 1 ⇒ round to whole days using 365-day year.
  //       termYears ≥ 1 ⇒ keep 365.25-day averaging.
  const totalDaysMs =
    termYears < 1
      ? Math.round(termYears * 365) * MS_PER_DAY
      : termYears * 365.25 * MS_PER_DAY
  const expiresAt = new Date(input.issuedAt.getTime() + totalDaysMs)

  return {
    ok: true,
    expiration: {
      expiresAt,
      termYears,
      gracePeriodDays,
    },
  }
}

/** Test-only — surfaces tables for drift guards. */
export const __LICENSE_INTERNALS = { TERM_YEARS_DEFAULT, GRACE_PERIOD_DAYS }
