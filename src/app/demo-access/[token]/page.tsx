import type { Metadata } from "next"
import { DemoAccessShell } from "@/components/demo-center/demo-access-shell"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Şəxsi demo | LeadDrive",
  description: "LeadDrive üçün qorunan, birdəfəlik məhsul demosu.",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}

/*
 * The locale is pinned by the proxy (`x-locale: az` for this path), not by a
 * provider here: the root provider then loads the one bundle the demo needs.
 * A nested provider would render the same screen but ship a second complete
 * message bundle on top of the first.
 */
export default async function DemoAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <DemoAccessShell token={token} />
}
