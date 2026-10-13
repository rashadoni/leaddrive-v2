import { getTranslations } from "next-intl/server"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"
import { MtmAttendanceCalendar } from "@/components/mtm/attendance-calendar"
import { MtmAttendanceReportWorkspace } from "@/components/mtm/attendance-report-workspace"

export default async function AttendancePage() {
  const t = await getTranslations("mtmAttendance")
  return <div className="space-y-6"><h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1><MtmAttendanceReportWorkspace /><MtmAttendanceRulesForm /><MtmAttendanceCalendar /></div>
}
