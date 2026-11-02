import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { AttendanceBranchScreenKiosk } from "@/components/mtm/attendance-branch-screen-kiosk"

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("attendanceBranchScreen")
  return { title: t("pageTitle"), robots: { index: false, follow: false } }
}

/**
 * The tablet at a branch entrance. No CRM sign-in: an administrator pairs it
 * once with a code, and from then on it shows its branch's QR, a new one
 * every minute. Nothing else of the CRM is reachable from here.
 */
export default function BranchScreenPage() {
  return <AttendanceBranchScreenKiosk />
}
