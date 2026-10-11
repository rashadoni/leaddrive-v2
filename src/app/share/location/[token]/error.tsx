"use client"

import { useTranslations } from "next-intl"

/**
 * What a visitor sees when the page behind a «ссылка на местоположение»
 * cannot be drawn — most often the map's own code not arriving: the
 * connection dropped, or a new version was deployed while the page stood
 * open (a link lives up to a day, and every release replaces those files).
 *
 * Without this file the failure lands on the application's own error page:
 * Azerbaijani only, with a button to the marketing site. Here it is said in
 * the link's language, with the page's own few sentences — the only ones the
 * layout hands it — and nothing leads anywhere else.
 *
 * «Обновить» loads the page anew. Not the `reset` Next offers: that draws
 * the same tree again, React has kept the failed import, and the same error
 * comes straight back.
 */
export default function LocationShareLinkError() {
  const t = useTranslations("mtmLocationShareLink")
  return (
    <main data-testid="location-share-link-error" className="flex min-h-dvh flex-col bg-background text-foreground">
      <section className="m-auto w-full max-w-md px-4 py-10 text-center">
        <h1 className="text-xl font-semibold">{t("pageTitle")}</h1>
        <p role="alert" className="mt-2 text-sm text-amber-700">{t("pageFailed")}</p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => window.location.reload()}
            data-testid="location-share-link-reload"
            className="inline-flex min-h-11 items-center rounded-lg border border-zinc-300 bg-background px-4 text-sm font-semibold text-foreground hover:bg-muted"
          >
            {t("refresh")}
          </button>
        </div>
      </section>
    </main>
  )
}
