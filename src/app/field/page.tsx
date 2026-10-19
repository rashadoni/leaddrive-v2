import type { Metadata } from "next"
import { getLocale, getTranslations } from "next-intl/server"
import { latestFieldAppRelease } from "@/lib/mtm/field-app-release"

// The newest build changes with every merge to the app's main branch.
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("fieldAppDownload")
  return {
    title: t("pageTitle"),
    description: t("lead"),
    robots: { index: false, follow: false },
  }
}

const DATE_LOCALE: Record<string, string> = { az: "az-Latn-AZ", ru: "ru-RU", en: "en-GB" }
const LANGUAGES = [
  { code: "az", label: "AZ" },
  { code: "ru", label: "RU" },
  { code: "en", label: "EN" },
] as const

/**
 * /field — the link clients hand to their agents until the app is on Google
 * Play (owner, 2026-10-19). One button that always downloads the newest build
 * of main (/field/download), the version it is, and how to install it.
 * No account, no tenant, no data: the same page for everybody.
 */
export default async function FieldAppDownloadPage() {
  const [t, locale, release] = await Promise.all([
    getTranslations("fieldAppDownload"),
    getLocale(),
    latestFieldAppRelease(),
  ])
  const date = release
    ? new Intl.DateTimeFormat(DATE_LOCALE[locale] ?? "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Baku" })
      .format(new Date(release.publishedAt))
    : null

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto flex max-w-md flex-col gap-8">
        <nav aria-label={t("languageLabel")} className="flex justify-end gap-3 text-sm">
          {LANGUAGES.map((language) => (
            <a
              key={language.code}
              href={`/field?lang=${language.code}`}
              aria-current={language.code === locale ? "true" : undefined}
              className={language.code === locale ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}
            >
              {language.label}
            </a>
          ))}
        </nav>

        <header className="flex flex-col gap-3">
          <p className="text-sm font-medium text-primary">{t("eyebrow")}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-base leading-relaxed text-muted-foreground">{t("lead")}</p>
        </header>

        <section className="flex flex-col gap-3">
          {release ? (
            <>
              <a
                href="/field/download"
                className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("download")}
              </a>
              <p className="text-center text-sm text-muted-foreground">
                {t("version", { version: release.versionName, date: date ?? "" })}
              </p>
            </>
          ) : (
            <p role="status" className="rounded-md border border-border bg-muted px-4 py-3 text-sm">
              {t("unavailable")}
            </p>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t("stepsTitle")}</h2>
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm leading-relaxed">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
            <li>{t("step4")}</li>
          </ol>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">{t("updatesTitle")}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("updates")}</p>
        </section>

        <footer className="flex flex-col gap-1 border-t border-border pt-4 text-xs text-muted-foreground">
          <p>{t("playNote")}</p>
          <a
            href={locale === "az" ? "https://leaddrivecrm.org/privacy/field-app" : `https://leaddrivecrm.org/${locale}/privacy/field-app`}
            className="underline hover:text-foreground"
          >
            {t("privacy")}
          </a>
        </footer>
      </div>
    </main>
  )
}
