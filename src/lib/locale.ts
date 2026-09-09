// Shared locale utilities

export function getLocale(): string {
  if (typeof document === "undefined") return "ru"
  const cookie = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("NEXT_LOCALE="))
  return cookie?.split("=")[1] || "ru"
}

// Common translations for pipeline and other CRM terms
const TRANSLATIONS: Record<string, Record<string, string>> = {
  "Deals Pipeline": { ru: "Воронка продаж", az: "Proses axını", en: "Deals Pipeline" },
  "Pipeline Value": { ru: "Стоимость воронки", az: "Proses axını dəyəri", en: "Pipeline Value" },
  "Pipeline": { ru: "Воронка продаж", az: "Proses axını", en: "Pipeline" },
  "Deal Pipeline": { ru: "Воронка продаж", az: "Proses axını", en: "Deal Pipeline" },
  "Sales Pipeline": { ru: "Воронка продаж", az: "Satış proses axını", en: "Sales Pipeline" },
  "Total Deals": { ru: "Всего сделок", az: "Cəmi sövdələşmələr", en: "Total Deals" },
  "Won": { ru: "Выиграно", az: "Qazanılmış", en: "Won" },
  "Lost": { ru: "Потеряно", az: "İtirilmiş", en: "Lost" },
}

export function t(key: string, locale?: string): string {
  const loc = locale || getLocale()
  return TRANSLATIONS[key]?.[loc] || TRANSLATIONS[key]?.["en"] || key
}
