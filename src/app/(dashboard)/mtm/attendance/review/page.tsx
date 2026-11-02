import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { MtmAttendanceRiskReview } from "@/components/mtm/attendance-risk-review"

/**
 * Suspicious marks are a daily work queue, not a setting (owner, 2026-10-15):
 * reached from Personnel → Today, with the way back there. Notifications have
 * always pointed here.
 */
export default async function AttendanceReviewPage() {
  const t = await getTranslations("personnel")
  return <div className="space-y-6">
    <Link href="/mtm/attendance" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="attendance-back-to-today">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />{t("todayTitle")}</Link>
    <MtmAttendanceRiskReview />
  </div>
}
