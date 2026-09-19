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

export default async function DemoAccessPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  return <DemoAccessShell token={token} />
}
