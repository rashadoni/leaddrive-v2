export const locales = ["ru", "az", "en"] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = "ru"
