"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { BarChart3 } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { ExplainableKpiDashboard } from "@/components/mtm/explainable-kpi-dashboard"
import { MtmTeamResults } from "@/components/mtm/team-results"

/**
 * Owner 2026-09-26: «аналитика нужна для менеджеров». The page opened on the
 * formula registry — versions, numerators, «формула не утверждена» — and kept
 * what a manager reads under a folded «Операционный обзор» headed «KPI Mars»,
 * counted a second way on the server's clock. Now: the team's results on top,
 * from the registry's own facts; the registry folded as «Как считаются цифры»;
 * the second formula gone («убери дублирования»).
 */
export default function MtmAnalyticsPage() {
  const { data: session } = useSession()
  const ta = useTranslations("mtmAnalytics")
  const tr = useTranslations("mtmTeamResults")
  const [formulasOpen, setFormulasOpen] = useState(false)
  const orgId = session?.user?.organizationId ? String(session.user.organizationId) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <PageDescription icon={BarChart3} title={ta("title")} />
        <HelpButton slug="mtm-analytics" variant="label" />
      </div>

      <MtmTeamResults orgId={orgId} />

      <details
        data-testid="mtm-analytics-formulas"
        className="group rounded-xl border border-zinc-200 bg-card dark:border-zinc-700"
        onToggle={(event) => setFormulasOpen(event.currentTarget.open)}
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary [&::-webkit-details-marker]:hidden">
          {tr("formulasTitle")}
        </summary>
        {/* Mounted only when opened: the registry makes its own heavy request. */}
        {formulasOpen ? <div className="border-t border-zinc-200 p-2 dark:border-zinc-700"><ExplainableKpiDashboard orgId={orgId} /></div> : null}
      </details>
    </div>
  )
}
