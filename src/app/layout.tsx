import type { Metadata, Viewport } from "next"
import { headers } from "next/headers"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import { Providers } from "@/components/providers"
import { BASEMAP_PROVIDER_META, basemapProviderFromEnv, serializeBasemapProvider } from "@/lib/mtm/basemap-provider"
import { Toaster } from "sonner"
import "./globals.css"

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      "https://app.leaddrivecrm.org",
  ),
  title: "LeadDrive CRM",
  description: "SaaS CRM for IT Outsourcing Companies",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "LeadDrive CRM",
  },
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#001E3C",
}

const PUBLIC_AUTH_PATHS = new Set([
  "/login",
  "/forgot-password",
  "/reset-password",
  "/login/setup-2fa",
  "/login/verify-2fa",
])
const PUBLIC_PORTAL_PATHS = new Set([
  "/portal/login",
  "/portal/register",
  "/portal/set-password",
])
// «Ссылка на местоположение»: the page behind /share/location/<token> is
// opened by somebody with no account at all. The literal is the page's own
// path (LOCATION_SHARE_LINK_PAGE_PATH in src/lib/mtm/location-share-link.ts);
// a test keeps the two equal.
const PUBLIC_LOCATION_SHARE_LINK_PATH = "/share/location"

/**
 * Do not serialize the complete CRM catalog into unauthenticated auth/portal
 * hydration data. Besides increasing every public response, the full catalog
 * includes internal RBAC labels that have no place on a sign-in page.
 */
function messagesForClient(
  pathname: string | null,
  messages: AbstractIntlMessages,
): AbstractIntlMessages {
  const normalizedPath = pathname?.replace(/\/+$/, "") || "/"
  if (PUBLIC_AUTH_PATHS.has(normalizedPath)) {
    return { auth: messages.auth } as AbstractIntlMessages
  }
  if (PUBLIC_PORTAL_PATHS.has(normalizedPath)) {
    return { portal: messages.portal } as AbstractIntlMessages
  }
  // A stranger's page gets the few sentences it shows and nothing else of the
  // catalog — which is every module's labels, a megabyte and a half of them.
  if (normalizedPath === PUBLIC_LOCATION_SHARE_LINK_PATH || normalizedPath.startsWith(`${PUBLIC_LOCATION_SHARE_LINK_PATH}/`)) {
    return { mtmLocationShareLink: messages.mtmLocationShareLink } as AbstractIntlMessages
  }
  return messages
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const hdrs = await headers()
  const locale = await getLocale()
  const messages = messagesForClient(
    hdrs.get("x-request-pathname"),
    await getMessages() as AbstractIntlMessages,
  )
  const nonce = hdrs.get("x-nonce") ?? undefined
  // Whose tiles the maps fall back to, as the running deployment says it now
  // — read here, on the server, so that changing it needs no build
  // (src/lib/mtm/basemap-provider.ts). Nothing is written while no backup is named.
  const basemapProvider = serializeBasemapProvider(basemapProviderFromEnv())
  // Field UX audit 2026-09-05 (W-03): the document language drives screen
  // readers, hyphenation and spell-check, so it follows the request locale
  // (x-locale from the proxy, ru/az/en) instead of a hard-coded "en".

  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <link rel="dns-prefetch" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.googleapis.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {basemapProvider ? <meta name={BASEMAP_PROVIDER_META} content={basemapProvider} /> : null}
      </head>
      <body className="font-sans antialiased">
        {/* @ts-expect-error nonce prop supported at runtime */}
        <NextIntlClientProvider messages={messages} nonce={nonce}>
          <Providers nonce={nonce}>{children}</Providers>
          <Toaster richColors position="top-right" />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
