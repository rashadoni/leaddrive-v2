import Link from "next/link"

export type LegalLocale = "en" | "ru" | "az"

const languageLabels: Record<LegalLocale, string> = {
  en: "English",
  ru: "Русский",
  az: "Azərbaycanca",
}

const documentLabels: Record<LegalLocale, { privacy: string; terms: string; deletion: string }> = {
  en: { privacy: "Privacy", terms: "Terms", deletion: "Data deletion" },
  ru: { privacy: "Конфиденциальность", terms: "Условия", deletion: "Удаление данных" },
  az: { privacy: "Məxfilik", terms: "Şərtlər", deletion: "Məlumatların silinməsi" },
}

export function legalLocale(value: string | string[] | undefined): LegalLocale {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === "ru" || candidate === "az" ? candidate : "en"
}

export function LegalDocumentNav({ locale, path }: { locale: LegalLocale; path: string }) {
  const labels = documentLabels[locale]
  return (
    <div className="mb-12 flex flex-col gap-4 border-y border-[#001E3C]/10 py-4 sm:flex-row sm:items-center sm:justify-between">
      <nav aria-label="Legal documents" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-[#001E3C]">
        <Link href={`/legal/privacy?lang=${locale}`} className="hover:text-[#E85D2A]">{labels.privacy}</Link>
        <Link href={`/legal/terms?lang=${locale}`} className="hover:text-[#E85D2A]">{labels.terms}</Link>
        <Link href={`/legal/data-deletion?lang=${locale}`} className="hover:text-[#E85D2A]">{labels.deletion}</Link>
      </nav>
      <nav aria-label="Document language" className="flex flex-wrap gap-2">
        {(["en", "ru", "az"] as const).map((item) => (
          <Link
            key={item}
            href={`${path}?lang=${item}`}
            hrefLang={item}
            aria-current={item === locale ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              item === locale
                ? "bg-[#001E3C] text-white"
                : "bg-[#001E3C]/5 text-[#001E3C]/65 hover:bg-[#001E3C]/10 hover:text-[#001E3C]"
            }`}
          >
            {languageLabels[item]}
          </Link>
        ))}
      </nav>
    </div>
  )
}
