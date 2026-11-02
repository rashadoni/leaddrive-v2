import type { Metadata } from "next"
import { DemoSocialResult } from "@/components/demo-center/demo-social-result"

export const dynamic = "force-dynamic"
export const revalidate = 0

export const metadata: Metadata = {
  title: "Facebook səhifəsi | LeadDrive",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
}

/*
 * Where Meta's tab lands after the prospect connected (or did not connect) his
 * own Facebook Page to the demo: the product's callback hands a demo state to
 * src/lib/demo-center/demo-social-callback.ts, which redirects here with one
 * word. Nothing here reads a token or a row; the demo tab learns the result
 * from its own poll.
 */
export default async function DemoSocialResultPage({ searchParams }: { searchParams: Promise<{ r?: string | string[] }> }) {
  const { r } = await searchParams
  return <DemoSocialResult result={typeof r === "string" ? r : ""} />
}
