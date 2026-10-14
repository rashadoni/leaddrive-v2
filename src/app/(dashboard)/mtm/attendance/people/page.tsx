import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { MtmAttendanceTabs, attendanceTab } from "@/components/mtm/attendance-tabs"
import { MtmAttendanceEmployees } from "@/components/mtm/attendance-employees"
import { MtmAttendanceBranches } from "@/components/mtm/attendance-branches"
import { MtmAttendanceInstallations } from "@/components/mtm/attendance-installations"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

// Administrator-only like their endpoints (formerly admin-only menu items).
const ADMIN_TABS: readonly string[] = ["employees"]
const TABS = ["employees", "branches", "phones"] as const

export default async function PersonnelPeoplePage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const t = await getTranslations("personnel")
  const session = await runWithRlsBypass(async () => auth())
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "superadmin"
  const visible = TABS.filter(key => isAdmin || !ADMIN_TABS.includes(key))
  const tab = attendanceTab((await searchParams).tab, visible)
  return <div className="space-y-6">
    <MtmAttendanceTabs base="/mtm/attendance/people" active={tab} label={t("peopleTabs")} tabs={visible.map(key => ({ key, label: t(`tabs.${key}`) }))} />
    {tab === "employees" ? <MtmAttendanceEmployees /> : tab === "branches" ? <MtmAttendanceBranches /> : <MtmAttendanceInstallations />}
  </div>
}
