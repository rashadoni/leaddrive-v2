import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth"
import { runWithRlsBypass } from "@/lib/rls-context"
import { MtmAttendanceSettingsHub } from "@/components/mtm/attendance-settings-hub"
import { MtmAttendanceRulesForm } from "@/components/mtm/attendance-rules-form"
import { MtmAttendanceCalendar } from "@/components/mtm/attendance-calendar"
import { MtmAttendanceShifts } from "@/components/mtm/attendance-shifts"
import { MtmAttendanceLeaveBalances } from "@/components/mtm/attendance-leave-balances"
import { MtmAttendanceManagedSetting } from "@/components/mtm/attendance-managed-setting"
import { MtmAttendanceQrDisplay } from "@/components/mtm/attendance-qr-display"
import { MtmAttendanceLocationPolicy } from "@/components/mtm/attendance-location-policy"
import { ATTENDANCE_ADMIN_SETTINGS, ATTENDANCE_SETTINGS_CARDS, type AttendanceSettingsCard } from "@/lib/mtm/attendance-settings-cards"
import { redirect } from "next/navigation"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

// These editors carry no page heading of their own.
const UNTITLED: readonly AttendanceSettingsCard[] = ["hours", "holidays", "day-kinds", "requests", "access"]

/** Owner, 2026-10-14: nine tabs were too many to explain to HR. Settings is one
 * page of cards; `?tab=<card>` opens that card's editor with a way back. */
export default async function PersonnelSettingsPage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const t = await getTranslations("personnel")
  const session = await runWithRlsBypass(async () => auth())
  const isAdmin = session?.user?.role === "admin" || session?.user?.role === "superadmin"
  const params = await searchParams, raw = params.tab
  // The former settings card: bookmarks and old links land on the queue itself.
  if (raw === "review") {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) if (key !== "tab") for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item)
    redirect(`/mtm/attendance/review${query.size ? `?${query}` : ""}`)
  }
  const requested = (Array.isArray(raw) ? raw[0] : raw) as AttendanceSettingsCard | undefined
  const tab = requested && ATTENDANCE_SETTINGS_CARDS.includes(requested) && (isAdmin || !ATTENDANCE_ADMIN_SETTINGS.includes(requested)) ? requested : null
  if (!tab) return <MtmAttendanceSettingsHub isAdmin={isAdmin} />
  return <div className="space-y-6">
    <Link href="/mtm/attendance/settings" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="attendance-back-to-settings">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />{t("settingsTitle")}</Link>
    {UNTITLED.includes(tab) ? <h1 className="text-2xl font-bold tracking-tight">{t(`settingsCards.${tab}.title`)}</h1> : null}
    {tab === "hours" ? <MtmAttendanceRulesForm />
      : tab === "holidays" ? <MtmAttendanceCalendar />
      : tab === "shifts" ? <MtmAttendanceShifts />
      : tab === "day-kinds" || tab === "requests" || tab === "access" ? <MtmAttendanceManagedSetting kind={tab} />
      : tab === "leave" ? <MtmAttendanceLeaveBalances />
      : tab === "qr" ? <MtmAttendanceQrDisplay />
      : <MtmAttendanceLocationPolicy />}
  </div>
}
