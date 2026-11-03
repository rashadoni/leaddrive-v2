/**
 * How a day and a time are written to a client, in their language and on the
 * salon's clock. Lives apart from the agent so the reminder job can use it
 * without the two importing each other.
 */
export type ReplyLanguage = "az" | "ru" | "en"

/** «Şənbə, 7 noyabr» / «Суббота, 7 ноября» / «Saturday, November 7». */
export function dayLabel(iso: string, language: ReplyLanguage, timezone: string): string {
  const at = new Date(iso)
  if (language === "az") {
    const parts = new Intl.DateTimeFormat("az", { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).formatToParts(at)
    const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ""
    const weekday = part("weekday")
    return `${weekday.charAt(0).toLocaleUpperCase("az")}${weekday.slice(1)}, ${part("day")} ${part("month")}`
  }
  const text = new Intl.DateTimeFormat(language, { weekday: "long", day: "numeric", month: "long", timeZone: timezone }).format(at)
  return language === "en" ? text : `${text.charAt(0).toLocaleUpperCase("ru")}${text.slice(1)}`
}

export function clock(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: timezone }).format(new Date(iso))
}
