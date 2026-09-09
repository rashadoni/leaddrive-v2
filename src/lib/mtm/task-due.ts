/**
 * How a task's deadline is written on the screen.
 *
 * Field UX audit 2026-09-05, task C11. A due date is stored as an instant, so
 * a task created without a meaningful time — imported, or set from the field
 * app's date picker — lands on midnight in the tenant's timezone and the list
 * printed "1 окт., 00:00". That "00:00" is noise: it looks like a deadline
 * someone chose, and it is not.
 *
 * The rule is deliberately narrow: only exactly midnight in the display
 * timezone loses its time. A deadline at 00:05 keeps it, because someone
 * typed it.
 */
export function mtmTaskDueHasMeaningfulTime(value: Date, timezone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value)
  const at = (type: string) => parts.find((part) => part.type === type)?.value ?? ""
  // "24" is what some engines return for midnight under hour12: false.
  const hour = at("hour") === "24" ? "00" : at("hour")
  return !(hour === "00" && at("minute") === "00" && at("second") === "00")
}

export type MtmTaskDueFormat = { dateStyle: "medium" } | { dateStyle: "medium"; timeStyle: "short" }

/** Formatting options for a due date: with the time only when it says something. */
export function mtmTaskDueFormat(value: Date, timezone: string): MtmTaskDueFormat {
  return mtmTaskDueHasMeaningfulTime(value, timezone)
    ? { dateStyle: "medium", timeStyle: "short" }
    : { dateStyle: "medium" }
}
