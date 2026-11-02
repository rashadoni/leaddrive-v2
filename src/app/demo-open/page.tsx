import type { Metadata } from "next"
import { redirect } from "next/navigation"
import { OpenDemo } from "@/components/demo-center/journey/open-demo"
import { isSuperAdminSession } from "@/lib/superadmin-guard"

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
 * The demo without a request: the owner's own walk-through and the page the
 * intro clips are filmed on.
 *
 * Open to anyone from 2026-09-22 until 2026-10-18, when the owner closed it:
 * a prospect's demo opens only from the link mailed to the address on their
 * request, once that address is confirmed (`demo-access/[token]/confirm`).
 * Anyone else is sent to the request form.
 *
 * Deliberately outside the marketing chrome: the visitor lands inside the
 * product rather than on another page about it. `name` and `company` only
 * decide who the lead in the story is; they stay in the browser.
 */
export default async function OpenDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[]; company?: string | string[] }>
}) {
  if (!(await isSuperAdminSession())) redirect("/demo")
  const query = await searchParams
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value)
  return <OpenDemo name={first(query.name)} company={first(query.company)} />
}
