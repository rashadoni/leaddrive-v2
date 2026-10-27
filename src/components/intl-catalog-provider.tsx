"use client"

import dynamic from "next/dynamic"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import type { ComponentType, ReactNode } from "react"
import type { Locale } from "@/i18n/routing"

/**
 * The interface catalog reaches the browser as a file of its own.
 *
 * Until 2026-10-27 the root layout handed the whole of `messages/<locale>.json`
 * to next-intl's server provider, which wrote it into the HTML of every page:
 * measured on production on 2026-10-26, 2.3 of the 2.5 MB of `/demo` was the
 * catalog, sent again with every full page load, never cached, and rendered
 * into the RSC payload on every request.
 *
 * Now each language is its own `import()`, i.e. its own content-hashed chunk
 * under `/_next/static`: the browser and the service worker keep it until the
 * catalog changes, and a page carries only what it shows. Through
 * `next/dynamic` the server also writes a `<link rel="preload">` for the one
 * chunk the page needs, so it downloads beside the page's other scripts rather
 * than after them. Hydration waits for it — the server-rendered page is on
 * screen meanwhile, so nobody sees a key in place of a word. On the server the
 * same import resolves once per process and then stays in memory, so
 * server rendering is what it was.
 *
 * The three imports are written out as literals, not as one template: the
 * `next/dynamic` transform can name a preload only for a literal request.
 */
type CatalogProviderProps = { locale: Locale; timeZone: string; children?: ReactNode }

function withCatalog(messages: AbstractIntlMessages): ComponentType<CatalogProviderProps> {
  return function CatalogProvider({ locale, timeZone, children }: CatalogProviderProps) {
    return (
      <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
        {children}
      </NextIntlClientProvider>
    )
  }
}

// `as unknown as`: a direct cast would have the type checker compare every
// sentence of the catalog with the message type, for nothing.
const CATALOG_PROVIDERS: Record<Locale, ComponentType<CatalogProviderProps>> = {
  ru: dynamic(() => import("../../messages/ru.json").then((catalog) => withCatalog(catalog.default as unknown as AbstractIntlMessages))),
  az: dynamic(() => import("../../messages/az.json").then((catalog) => withCatalog(catalog.default as unknown as AbstractIntlMessages))),
  en: dynamic(() => import("../../messages/en.json").then((catalog) => withCatalog(catalog.default as unknown as AbstractIntlMessages))),
}

/**
 * `messages`: the few namespaces a public page is handed inline (the sign-in
 * pages, the portal, a location link — see `messagesForClient` in the root
 * layout), or `null` for the whole catalog of `locale`, loaded as its file.
 *
 * `timeZone` comes from the server's request config, as next-intl's server
 * provider used to fill it in: dates on screen are formatted in the same zone
 * as before.
 */
export function IntlCatalogProvider({
  locale,
  timeZone,
  messages,
  children,
}: CatalogProviderProps & { messages: AbstractIntlMessages | null }) {
  if (messages) {
    return (
      <NextIntlClientProvider locale={locale} timeZone={timeZone} messages={messages}>
        {children}
      </NextIntlClientProvider>
    )
  }
  const Catalog = CATALOG_PROVIDERS[locale]
  return <Catalog locale={locale} timeZone={timeZone}>{children}</Catalog>
}
