/**
 * A campaign's send time as an `<input type="datetime-local">` value.
 *
 * The campaign form submits that input with `new Date(value).toISOString()`,
 * which reads it in the browser's own time; this is the inverse, so opening
 * and saving a scheduled campaign keeps the minute it goes out.
 *
 * Until 2026-10-17 both callers broke that round trip. The form filled the
 * input with `toISOString().slice(0, 16)` — the UTC clock, then saved as local
 * time, so in Baku every edit moved the send four hours earlier. The campaign
 * page passed the date alone, so an edit moved it to local midnight: a
 * campaign planned for 15:00 went out at 00:00 of the same day, or at once if
 * that day had begun. The scheduler sends whatever is due (scheduled-send-job).
 */
export function scheduledAtInputValue(value: string | Date | null | undefined): string {
  if (!value) return ""
  const at = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(at.getTime())) return ""
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`
}
