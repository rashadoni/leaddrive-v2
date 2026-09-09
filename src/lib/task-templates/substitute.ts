/**
 * Variable substitution for task templates — Roadmap #21.
 *
 * Templates store `taskTitle` / `taskDescription` as free text with
 * `{{var}}` placeholders. At instantiation time the client replaces
 * known vars with locale-aware runtime values; unknown vars are left
 * untouched so they're visible in the created task (good UX signal —
 * "you typed {{xyz}} but I don't know what that is").
 *
 * Recognized variables:
 *   {{date}}   → today's date in user locale (e.g. "28.05.2026")
 *   {{user}}   → current user's name
 *   {{month}}  → current month name in user locale (e.g. "May")
 *   {{week}}   → ISO week number (e.g. "22")
 */

export interface SubstituteContext {
  userName?: string
  locale?: string
  /** Override `now` for testing — defaults to `new Date()` */
  now?: Date
}

function isoWeek(d: Date): number {
  // ISO-8601 week number — Monday-starting weeks, week 1 contains Jan 4.
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = target.getUTCDay() || 7
  target.setUTCDate(target.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1))
  return Math.ceil(((target.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
}

export function substituteTemplateVars(text: string, ctx: SubstituteContext = {}): string {
  const now = ctx.now ?? new Date()
  const locale = ctx.locale ?? "en-US"

  const vars: Record<string, string> = {
    date: now.toLocaleDateString(locale),
    user: ctx.userName ?? "",
    month: now.toLocaleString(locale, { month: "long" }),
    week: String(isoWeek(now)),
  }

  return text.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in vars) return vars[key]
    return match // leave unknown placeholders intact
  })
}
