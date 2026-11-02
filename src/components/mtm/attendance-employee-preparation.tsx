"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import type { AttendanceEmployeeDetail } from "@/lib/mtm/attendance-employee-contract"

export function MtmAttendanceEmployeePreparation({ detail }: { detail: AttendanceEmployeeDetail }) {
  const t = useTranslations("personnel.preparation")
  const facts = detail.preparation
  if (!facts) return null
  const rows = [
    { key: "login", text: t(`login${facts.login}`), href: "#employee-phone" },
    { key: "participation", text: t(detail.employee.included ? "included" : "excluded"), href: "#employee-participation" },
    { key: "schedule", text: t(`schedule${facts.schedule}`), href: `/mtm/attendance/settings?tab=${facts.schedule === "SHIFT" ? "shifts" : "hours"}` },
    { key: "branch", text: facts.branch ? t(facts.branch.active ? "branchActive" : "branchInactive", { name: facts.branch.name }) : t("branchMissing"), href: "/mtm/attendance/people?tab=branches" },
    { key: "phone", text: t(facts.installations.required ? "approvalRequired" : "approvalOptional", { count: facts.installations.approved }), href: "/mtm/attendance/people?tab=phones" },
  ]
  return <section className="space-y-4 rounded-2xl border bg-card p-5" data-testid="employee-preparation" aria-labelledby="employee-preparation-title">
    <div className="space-y-1"><h2 id="employee-preparation-title" className="text-base font-semibold">{t("title")}</h2><p className="text-sm text-muted-foreground">{t("hint", { date: facts.date })}</p></div>
    <dl className="divide-y">{rows.map(row => <div key={row.key} className="flex flex-wrap items-center justify-between gap-3 py-3" data-testid={`employee-preparation-${row.key}`}>
      <div className="min-w-0 flex-1"><dt className="text-sm font-semibold">{t(row.key)}</dt><dd className="mt-1 text-sm text-muted-foreground">{row.text}</dd>
        {row.key === "phone" && facts.installations.pending > 0 && <dd className="mt-1 text-sm text-amber-700 dark:text-amber-400">{t("pending", { count: facts.installations.pending })}</dd>}</div>
      <Link href={row.href} prefetch={false} className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-primary hover:underline">{t("open")}</Link>
    </div>)}</dl>
    <p className="text-sm text-muted-foreground">{t("invitation")}</p>
    <p className="text-xs text-muted-foreground">{t("noFakeMark")}</p>
  </section>
}
