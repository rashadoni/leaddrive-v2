/**
 * The one parser for stored MTM setting values (`mtm_settings.value` is JSON).
 *
 * `getMtmSettings` — and through it the settings API and the settings screen —
 * uses these rules, and so does every runtime path that reads a single key
 * straight from a transaction (visit-policy resolver, sync alert gates,
 * check-out photo cap). One rule means the editor and the runtime can never
 * disagree about whether a switch is on. Deliberately prisma-free.
 */

/** null/undefined → fallback; boolean as is; string → only "true" is on; anything else → fallback. */
export function coerceMtmBooleanSetting(raw: unknown, fallback: boolean): boolean {
  if (raw == null) return fallback
  if (typeof raw === "boolean") return raw
  if (typeof raw === "string") return raw === "true"
  return fallback
}

/** null/undefined → fallback; otherwise Number(raw) when finite, else fallback. */
export function coerceMtmNumberSetting(raw: unknown, fallback: number): number {
  if (raw == null) return fallback
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}
