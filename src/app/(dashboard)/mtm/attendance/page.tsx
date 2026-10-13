import { getTranslations } from "next-intl/server"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"
import { MtmAttendanceCalendar } from "@/components/mtm/attendance-calendar"

export default async function AttendancePage() {
  const t = await getTranslations("mtmAttendance")
  return <div className="space-y-6"><h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1><MtmAttendanceRulesForm /><MtmAttendanceCalendar /></div>
}
