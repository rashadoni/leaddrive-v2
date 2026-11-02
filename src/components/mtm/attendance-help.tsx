"use client"

import { BookOpen, ChevronDown } from "lucide-react"
import { useTranslations } from "next-intl"

const TOPICS = ["Access", "Status", "Requests", "Shifts", "Leave", "Month", "Exports", "Privacy"] as const

/** Static help inside the existing attendance scope; no new settings or reads. */
export function MtmAttendanceHelp() {
  const t = useTranslations("mtmAttendance")
  return <details className="group rounded-2xl border border-border bg-card text-card-foreground shadow-[0_1px_3px_rgba(0,0,0,0.05)]" data-testid="attendance-help">
    <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 rounded-2xl px-4 py-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-5 [&::-webkit-details-marker]:hidden">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-orange-700 dark:text-orange-300"><BookOpen className="h-5 w-5" aria-hidden="true" /></span>
      <span className="min-w-0"><span className="block text-base font-semibold">{t("helpTitle")}</span><span className="block text-sm text-muted-foreground">{t("helpIntro")}</span></span>
      <ChevronDown className="ml-auto h-5 w-5 shrink-0 text-muted-foreground group-open:rotate-180" aria-hidden="true" />
    </summary>
    <div className="grid gap-6 border-t border-border p-5 md:grid-cols-2 md:gap-x-8 md:p-6">
      {TOPICS.map(topic => <section key={topic} aria-labelledby={`attendance-help-${topic.toLowerCase()}`} className="min-w-0 space-y-2">
        <h2 id={`attendance-help-${topic.toLowerCase()}`} className="text-base font-semibold">{t(`help${topic}Title`)}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{t(`help${topic}Body`)}</p>
      </section>)}
    </div>
  </details>
}
