/** Money as the API sends it (Decimal as a string, or null when hidden from this reader). */
export function formatMoney(value: string | number | null | undefined, currency?: string | null, locale?: string): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "—"
  const text = n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return currency ? `${text} ${currency}` : text
}

export function formatQuantity(value: string | number | null | undefined, locale?: string): string {
  if (value === null || value === undefined || value === "") return "—"
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n.toLocaleString(locale, { maximumFractionDigits: 4 }) : "—"
}

export function formatDay(value: string | null | undefined, locale?: string): string {
  if (!value) return "—"
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" })
}

/** yyyy-mm-dd for an <input type="date">. */
export function dayInputValue(value: string | null | undefined): string {
  return value ? new Date(value).toISOString().slice(0, 10) : ""
}
