import { getTranslations } from "next-intl/server"

export default async function AttendancePage() {
  const t = await getTranslations("mtmAttendance")
  return <div className="space-y-6"><h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1></div>
}
