import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { LocationShareLinkView } from "@/components/mtm/location-share-link-view"

// The page is a person's position at this moment: never a stored copy.
export const dynamic = "force-dynamic"
export const revalidate = 0

/**
 * What a messenger shows of a pasted link — to everybody in the chat — is
 * the page's title and description. Both are the same for every link: no
 * employee and no organization is named in either. The language is the
 * link's own (`?lang=`, which the proxy hands on as the request's locale).
 *
 * No `referrer` here, unlike the demo page: the map's background is admitted
 * by the address of the page that asks for it. The proxy's own policy
 * (`strict-origin-when-cross-origin`) already keeps the path, and so the
 * link, out of what another host is told.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("mtmLocationShareLink")
  return {
    title: t("pageTitle"),
    description: t("scopeNote"),
    robots: { index: false, follow: false, nocache: true },
  }
}

/**
 * /share/location/[token] — the page behind a «ссылка на местоположение»,
 * opened by somebody with no account.
 *
 * It reads nothing itself: no database, no session. Everything on it comes
 * from GET /api/v1/public/location-share/[token], asked by the view in the
 * visitor's browser — so there is one place that decides what an outsider is
 * told, and this page cannot say more than that answer does.
 *
 * It never hands a request over to the application's own «not found»: that
 * one is a page of the marketing site, in one language. A link that does not
 * work is said so here, in the link's language, by the view.
 */
export default async function LocationShareLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // Keyed by the link: nothing one link showed is ever carried over to another.
  return <LocationShareLinkView key={token} token={token} />
}
