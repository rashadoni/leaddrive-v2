import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import type { ReactNode } from "react"
import { PROSPECT_TO_CLOSED_WON } from "@/lib/demo-center/journey"

/**
 * The demo speaks one language: the scenario's.
 *
 * Everything inside the player comes from two places — the product's own
 * message bundle (sidebar, lead card, quote columns) and the scenario's own
 * Azerbaijani copy (guide panel, step instructions, coach marks). The first
 * followed the visitor's cookie while the second could not, so a Russian
 * viewer got a Russian sidebar next to Azerbaijani instructions. That
 * half-and-half screen is exactly what a prospect should never see.
 *
 * Nesting a provider pins the whole subtree to the manifest's locale, so the
 * two halves always agree. A language switch becomes possible the day the
 * scenario itself carries ru/en copy — until then switching would only move
 * the seam rather than remove it.
 */
export async function DemoLocaleProvider({ children }: { children: ReactNode }) {
  const locale = PROSPECT_TO_CLOSED_WON.locale
  const messages = (await import(`../../../../messages/${locale}.json`)).default as AbstractIntlMessages

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      {children}
    </NextIntlClientProvider>
  )
}
