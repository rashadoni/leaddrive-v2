import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { MtmAttendanceTabs, attendanceTab } from "@/components/mtm/attendance-tabs"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"
import { MtmAttendanceCalendar } from "@/components/mtm/attendance-calendar"
import { MtmAttendanceShifts } from "@/components/mtm/attendance-shifts"
import { MtmAttendanceLeaveBalances } from "@/components/mtm/attendance-leave-balances"
import { MtmAttendanceManagedSetting } from "@/components/mtm/attendance-managed-setting"
import { MtmAttendanceRiskReview } from "@/components/mtm/attendance-risk-review"
import { MtmAttendanceQrDisplay } from "@/components/mtm/attendance-qr-display"
import { MtmAttendanceLocationPolicy } from "@/components/mtm/attendance-location-policy"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

// Administrator-only like their endpoints (formerly admin-only menu items).
const ADMIN_TABS: readonly string[] = ["location"]
const TABS = ["hours", "shifts", "day-kinds", "leave", "requests", "access", "review", "qr", "location"] as const

export default async function PersonnelSettingsPage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const t = await getTranslations("personnel")
  const session = await runWithRlsBypass(async () => auth())
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "superadmin"
  const visible = TABS.filter(key => isAdmin || !ADMIN_TABS.includes(key))
  const tab = attendanceTab((await searchParams).tab, visible)
  return <div className="space-y-6">
    <MtmAttendanceTabs base="/mtm/attendance/settings" active={tab} label={t("settingsTabs")} tabs={visible.map(key => ({ key, label: t(`tabs.${key}`) }))} />
    {tab === "hours" ? <><MtmAttendanceRulesForm /><MtmAttendanceCalendar /></>
      : tab === "shifts" ? <MtmAttendanceShifts />
      : tab === "day-kinds" || tab === "requests" || tab === "access" ? <MtmAttendanceManagedSetting kind={tab} />
      : tab === "leave" ? <MtmAttendanceLeaveBalances />
      : tab === "review" ? <MtmAttendanceRiskReview />
      : tab === "qr" ? <MtmAttendanceQrDisplay />
      : <MtmAttendanceLocationPolicy />}
  </div>
}
