import { cn } from "@/lib/utils"

export type PhoneOrderStatusValue = "pending_review" | "confirmed" | "rejected"

const STATUS_COLOUR: Record<PhoneOrderStatusValue, { text: string; dot: string }> = {
  pending_review: { text: "text-amber-600", dot: "bg-amber-500" },
  confirmed: { text: "text-emerald-600", dot: "bg-emerald-500" },
  rejected: { text: "text-muted-foreground", dot: "bg-zinc-400" },
}

/** A status as coloured words with a dot, never a filled pill. */
export function PhoneOrderStatus({ status, label }: { status: PhoneOrderStatusValue; label: string }) {
  const colour = STATUS_COLOUR[status]
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold", colour.text)}>
      <span className={cn("h-2 w-2 rounded-full", colour.dot)} />{label}
    </span>
  )
}

/** "284,70" in az/ru, "284.70" in en: two decimals, never rounded further. */
export function formatMoney(amount: string, locale: string) {
  const [whole, fraction = "00"] = amount.split(".")
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(BigInt(whole))
  return `${grouped}${locale === "en" ? "." : ","}${fraction.padEnd(2, "0").slice(0, 2)}`
}

/** Date and time (default), date only (false) or time only ("time"). */
export function formatOrderDate(iso: string, locale: string, part: true | false | "time" = true) {
  const date = new Date(iso)
  if (part === "time") return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date)
  if (!part) return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(date)
  // Date and time apart: az's combined pattern joins them with a slash.
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" }).format(date)
  return `${day}, ${formatOrderDate(iso, locale, "time")}`
}
