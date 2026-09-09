"use client"

import { useTranslations } from "next-intl"
import { Brain } from "lucide-react"

const gradeColors: Record<string, string> = {
  A: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  C: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  D: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
}

function getGrade(score: number): string {
  if (score >= 80) return "A"
  if (score >= 60) return "B"
  if (score >= 40) return "C"
  return "D"
}

export function AiLeadScoring({ leads }: { leads: any[] }) {
  const t = useTranslations("dashboard")

  return (
    <div className="dashboard-bento-card rounded-xl p-4 ai-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-[hsl(var(--ai-from))]/10 to-[hsl(var(--ai-to))]/10 flex items-center justify-center">
            <Brain className="h-3.5 w-3.5 text-[hsl(var(--ai-from))]" />
          </div>
          <span className="text-sm font-semibold">{t("aiLeadScoring")}</span>
        </div>
        <a href="/leads" className="text-[10px] text-[hsl(var(--ai-from))] hover:underline">{t("viewAll")} →</a>
      </div>
      {leads && leads.length > 0 ? (
        <div className="space-y-1.5">
          {leads.map((l: any) => {
            const grade = getGrade(l.score || 0)
            return (
              <div key={l.id} className="flex items-center gap-2 py-0.5">
                <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${gradeColors[grade]}`}>
                  {grade}
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-xs font-medium truncate block">{l.contactName || l.companyName || "—"}</span>
                  <span className="text-[10px] text-muted-foreground">{l.companyName || "—"}</span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-[100px] flex items-center justify-center text-xs text-muted-foreground">{t("noData")}</div>
      )}
    </div>
  )
}
