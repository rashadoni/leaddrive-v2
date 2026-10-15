"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Check } from "lucide-react"
import type { AttendanceSetupStatus, AttendanceSetupStep } from "@/lib/mtm/attendance-setup"

const HREF: Record<AttendanceSetupStep, string> = {
  hours: "/mtm/attendance/settings?tab=hours",
  holidays: "/mtm/attendance/settings?tab=holidays",
  branches: "/mtm/attendance/people?tab=branches",
  leave: "/mtm/attendance/settings?tab=leave",
  employees: "/mtm/attendance/people",
  app: "/mtm/attendance/people?tab=phones",
}

/**
 * Personnel → Today, for an administrator, until attendance is set up (owner,
 * 2026-10-15: HR did not know where to begin, and without these steps every
 * report is wrong). Disappears once every step is done; never shown on error.
 */
export function MtmAttendanceSetupChecklist({ year }: { year: string }) {
  const p = useTranslations("personnel")
  const [steps, setSteps] = useState<AttendanceSetupStatus[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch("/api/v1/mtm/attendance/setup", { cache: "no-store", signal: controller.signal })
      .then(async response => { const body = await response.json().catch(() => null); if (response.ok && Array.isArray(body?.data?.steps)) setSteps(body.data.steps) })
      .catch(() => {})
    return () => controller.abort()
  }, [])
  if (!steps || steps.every(step => step.done)) return null
  const done = steps.filter(step => step.done).length
  return <section className="space-y-4 rounded-2xl border border-primary/30 bg-card p-5" aria-labelledby="attendance-setup-title" data-testid="attendance-setup-checklist">
    <div className="space-y-2">
      <h2 id="attendance-setup-title" className="text-lg font-semibold">{p("setupTitle", { done, total: steps.length })}</h2>
      <p className="max-w-3xl text-sm text-muted-foreground">{p("setupHint")}</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true"><div className="h-full rounded-full bg-primary" style={{ width: `${done / steps.length * 100}%` }} /></div>
    </div>
    <ol className="grid gap-3 md:grid-cols-2">{steps.map((step, index) => <li key={step.key} data-testid={`attendance-setup-${step.key}`} data-done={step.done || undefined}
      className={`flex items-center gap-3 rounded-xl border p-3 ${step.done ? "bg-muted/30" : "bg-card"}`}>
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${step.done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-primary/10 text-primary"}`} aria-hidden="true">
        {step.done ? <Check className="h-4 w-4" /> : index + 1}</span>
      <span className="min-w-0 flex-1"><span className={`block font-semibold ${step.done ? "text-muted-foreground" : ""}`}>{p(`setupSteps.${step.key}.title`, { year })}</span>
        <span className="block text-sm text-muted-foreground">{p(`setupSteps.${step.key}.${step.done ? "done" : "todo"}`, { count: step.count ?? 0, total: step.total ?? 0 })}</span></span>
      <Link href={HREF[step.key]} prefetch={false} className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${step.done ? "text-muted-foreground hover:text-foreground" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
        {p(step.done ? "setupOpen" : "setupDo")}</Link>
    </li>)}</ol>
  </section>
}
