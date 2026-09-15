/**
 * Validation of org-level field settings, shared by the settings page and the
 * PUT endpoint so both refuse the same values with the same code.
 *
 * Only INCOMING keys are checked. A value already stored out of range (from
 * before these bounds existed) is left alone and never blocks saving another
 * key: the page sends only the keys the user changed. Nothing is clamped —
 * a refused value is reported, not silently rewritten into something the user
 * did not type.
 *
 * Every default in MTM_SETTING_DEFAULTS sits inside its range (tested).
 */
export type MtmSettingNumberRange = { min: number; max: number }

export const MTM_SETTING_NUMBER_RANGES = {
  // Check-in radius around a customer, meters.
  geofenceRadius: { min: 25, max: 10_000 },
  // Local hour after which a not-started route shows as late on the live map.
  lateAfterHour: { min: 0, max: 23 },
  // Minutes a visit may stay open before the long-open visit alert.
  autoCheckoutMinutes: { min: 5, max: 1_440 },
  maxPhotosPerVisit: { min: 1, max: 50 },
  // Expected interval between GPS points (gap detection, freshness), seconds.
  gpsInterval: { min: 5, max: 3_600 },
  // Live map: no signal for this long means offline, seconds.
  offlineThresholdSeconds: { min: 30, max: 86_400 },
  locationWindowMinutes: { min: 1, max: 1_440 },
  // The readers already bound these three to the same ranges.
  historyMaxAccuracyMeters: { min: 5, max: 1_000 },
  historyStopRadiusMeters: { min: 10, max: 1_000 },
  historyStopMinimumMinutes: { min: 1, max: 240 },
  deviationThresholdMeters: { min: 50, max: 50_000 },
  deviationAlertThrottleMinutes: { min: 1, max: 1_440 },
} as const satisfies Record<string, MtmSettingNumberRange>

export type MtmNumericSettingKey = keyof typeof MTM_SETTING_NUMBER_RANGES

export const MTM_SETTING_ERROR_CODES = {
  outOfRange: "MTM_SETTING_OUT_OF_RANGE",
  notInteger: "MTM_SETTING_NOT_INTEGER",
  invalidType: "MTM_SETTING_INVALID_TYPE",
} as const

export type MtmSettingErrorCode = typeof MTM_SETTING_ERROR_CODES[keyof typeof MTM_SETTING_ERROR_CODES]

export type MtmSettingFieldError = {
  key: string
  code: MtmSettingErrorCode
  min?: number
  max?: number
}

export function isMtmNumericSettingKey(key: string): key is MtmNumericSettingKey {
  return Object.prototype.hasOwnProperty.call(MTM_SETTING_NUMBER_RANGES, key)
}

/** Validates one numeric setting value; null when it is acceptable. */
export function validateMtmNumericSetting(key: MtmNumericSettingKey, value: unknown): MtmSettingFieldError | null {
  const range = MTM_SETTING_NUMBER_RANGES[key]
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { key, code: MTM_SETTING_ERROR_CODES.invalidType, min: range.min, max: range.max }
  }
  if (!Number.isInteger(value)) {
    return { key, code: MTM_SETTING_ERROR_CODES.notInteger, min: range.min, max: range.max }
  }
  if (value < range.min || value > range.max) {
    return { key, code: MTM_SETTING_ERROR_CODES.outOfRange, min: range.min, max: range.max }
  }
  return null
}

/**
 * Validates the numeric and boolean keys of an incoming change set against
 * the defaults' types. Other shapes (timezone, e-mail, arrays) keep their
 * dedicated checks in the route.
 */
export function validateMtmSettingChanges(
  changes: Record<string, unknown>,
  defaults: Record<string, unknown>,
): MtmSettingFieldError[] {
  const errors: MtmSettingFieldError[] = []
  for (const [key, value] of Object.entries(changes)) {
    if (isMtmNumericSettingKey(key)) {
      const error = validateMtmNumericSetting(key, value)
      if (error) errors.push(error)
    } else if (typeof defaults[key] === "boolean" && typeof value !== "boolean") {
      errors.push({ key, code: MTM_SETTING_ERROR_CODES.invalidType })
    }
  }
  return errors
}

/**
 * Keys whose value differs from the last values loaded from the server.
 * Compared structurally so an array edited back to its loaded shape is not
 * "changed".
 */
export function changedMtmSettingKeys(
  loaded: Record<string, unknown>,
  current: Record<string, unknown>,
): string[] {
  return Object.keys(current).filter((key) => JSON.stringify(current[key]) !== JSON.stringify(loaded[key]))
}
