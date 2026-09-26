import type { Metadata } from "next"
import { OpenDemo } from "@/components/demo-center/journey/open-demo"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "LeadDrive CRM — demo",
  description: "LeadDrive CRM-in bələdçili demosu: müraciətdən qazanılmış sövdələşməyə.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

/*
 * The locale is pinned by the proxy (`x-locale: az` for this path), not by a
 * provider here: the root provider then loads the one bundle the demo needs.
 * A nested provider would render the same screen but ship a second complete
 * message bundle on top of the first.
 */

/**
 * The demo, open to anyone, on its own page.
 *
 * Deliberately outside the marketing chrome: the whole point is that the
 * visitor lands inside the product rather than on another page about it.
 *
 * `name` and `company` only decide who the lead in the story is. They arrive
 * from the visitor's own form on /demo, stay in their browser, and are never
 * posted anywhere.
 */
export default async function OpenDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[]; company?: string | string[] }>
}) {
  const query = await searchParams
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)
  return <OpenDemo name={first(query.name)} company={first(query.company)} />
}
