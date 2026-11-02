import Link from "next/link"
import { ArrowRight, ChevronLeft } from "lucide-react"
import { getTranslations } from "next-intl/server"
import { MtmAttendanceReportViewer } from "@/components/mtm/attendance-report-viewer"
import { MtmAttendanceLeaveBalances } from "@/components/mtm/attendance-leave-balances"
import { MtmAttendanceDecisionJournal } from "@/components/mtm/attendance-decision-journal"
import { ATTENDANCE_REPORTS, ATTENDANCE_REPORT_GROUPS, NEW_ATTENDANCE_REPORTS, isAttendanceReportKey } from "@/lib/mtm/attendance-reports-catalog"
import type { AttendanceSearchParams } from "@/lib/mtm/attendance-legacy-redirect"

/** Personnel → Reports (owner, 2026-10-15): every report HR needs, as cards;
 * `?report=<key>` opens one with its period, team and Excel/PDF. */
export default async function PersonnelReportsPage({ searchParams }: { searchParams: AttendanceSearchParams }) {
  const t = await getTranslations("personnel")
  const params = await searchParams, raw = params.report
  const report = Array.isArray(raw) ? raw[0] : raw
  // Today's cards link here for one date (e.g. today's late arrivals).
  const date = Array.isArray(params.date) ? params.date[0] : params.date
  if (isAttendanceReportKey(report) && ATTENDANCE_REPORTS[report].kind !== "page") return <div className="space-y-5">
    <Link href="/mtm/attendance/reports" prefetch={false} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-primary hover:underline" data-testid="attendance-back-to-reports">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />{t("reportsTitle")}</Link>
    {ATTENDANCE_REPORTS[report].kind === "table" ? <>
      <div><h1 className="text-2xl font-bold tracking-tight">{t(`reports.${report}.title`)}</h1><p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t(`reports.${report}.hint`)}</p>
        <ReportExample label={t("reportExample")} text={t(`reports.${report}.example`)} className="mt-2 max-w-3xl" /></div>
      <MtmAttendanceReportViewer report={report} initialDate={date} />
    </> : report === "leaveBalances" ? <MtmAttendanceLeaveBalances /> : <MtmAttendanceDecisionJournal />}
  </div>
  return <div className="space-y-6" data-testid="attendance-reports-hub">
    <div><h1 className="text-2xl font-bold tracking-tight">{t("reportsTitle")}</h1><p className="mt-1 text-sm text-muted-foreground">{t("reportsIntro")}</p></div>
    {ATTENDANCE_REPORT_GROUPS.map(group => <section key={group.key} aria-labelledby={`reports-group-${group.key}`} className="space-y-3">
      <h2 id={`reports-group-${group.key}`} className="text-sm font-semibold text-muted-foreground">{t(`reportGroups.${group.key}`)}</h2>
      <div className="grid gap-3 md:grid-cols-2">{group.reports.map((key, index) => {
        const definition = ATTENDANCE_REPORTS[key]
        const href = definition.kind === "page" ? definition.href : `/mtm/attendance/reports?report=${key}`
        // A card alone in its row takes the whole row (owner: no half-empty rows).
        const alone = group.reports.length % 2 === 1 && index === group.reports.length - 1
        return <Link key={key} href={href} prefetch={false} data-testid={`attendance-report-card-${key}`}
          className={`${alone ? "md:col-span-2 " : ""}group flex min-h-20 items-start gap-4 rounded-2xl border bg-card p-4 outline-none transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring`}>
          <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">{t(`reports.${key}.title`)}
            {NEW_ATTENDANCE_REPORTS.includes(key) ? <span className="text-xs font-semibold text-primary">{t("reportsNew")}</span> : null}</span>
            <span className="mt-0.5 block text-sm text-muted-foreground">{t(`reports.${key}.hint`)}</span>
            <ReportExample label={t("reportExample")} text={t(`reports.${key}.example`)} className="mt-2" /></span>
          <span className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-primary">{t("open")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
        </Link>
      })}</div>
    </section>)}
  </div>
}

/** Owner, 2026-10-16: «отчёты не понятны … не понимаю, что это такое». A made-up
 * row shows what one line of the report says before anyone opens it. */
function ReportExample({ label, text, className }: { label: string; text: string; className: string }) {
  return <span className={`${className} block rounded-lg bg-muted/60 px-3 py-2 text-xs leading-relaxed text-foreground`} data-testid="attendance-report-example">
    <span className="text-muted-foreground">{label}: </span>{text}</span>
}
