import type { Metadata } from "next"
import { DemoLocaleProvider } from "@/components/demo-center/journey/demo-locale"
import { OpenDemo } from "@/components/demo-center/journey/open-demo"

export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "LeadDrive CRM — demo",
  description: "LeadDrive CRM-in bələdçili demosu: müraciətdən qazanılmış sövdələşməyə.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
}

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
  return (
    <DemoLocaleProvider>
      <OpenDemo name={first(query.name)} company={first(query.company)} />
    </DemoLocaleProvider>
  )
}
