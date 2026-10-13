import { getTranslations } from "next-intl/server"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"

export default async function AttendancePage() {
  const t = await getTranslations("mtmAttendance")
  return <div className="space-y-6"><h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1><MtmAttendanceRulesForm /></div>
}
