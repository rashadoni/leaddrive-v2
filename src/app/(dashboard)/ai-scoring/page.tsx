"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Brain, RefreshCw, Loader2, Sparkles, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"

interface ScoredLead {
  id: string
  contactName: string
  companyName: string | null
  source: string | null
  status: string
  score: number
  grade: string
  conversionProb: number
  reasoning: string | null
  lastScoredAt: string | null
  estimatedValue: number | null
}

const gradeColors: Record<string, string> = {
  A: "bg-green-500 text-white",
  B: "bg-blue-500 text-white",
  C: "bg-yellow-500 text-white",
  D: "bg-orange-500 text-white",
  F: "bg-red-500 text-white",
}

const gradeBgLight: Record<string, string> = {
  A: "bg-green-50 dark:bg-green-900/20",
  B: "bg-blue-50 dark:bg-blue-900/20",
  C: "bg-yellow-50 dark:bg-yellow-900/20",
  D: "bg-orange-50 dark:bg-orange-900/20",
  F: "bg-red-50 dark:bg-red-900/20",
}

export default function AILeadScoringPage() {
  const t = useTranslations("ai")
  const tc = useTranslations("common")
  const tl = useTranslations("leads")
  const locale = useLocale()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const [leads, setLeads] = useState<ScoredLead[]>([])
  const [loading, setLoading] = useState(true)
  const [scoring, setScoring] = useState(false)
  const [scoringId, setScoringId] = useState<string | null>(null)
  const [aiPowered, setAiPowered] = useState(false)
  const [sortBy, setSortBy] = useState("score_desc")

  const fetchLeads = async () => {
    try {
      const res = await fetch("/api/v1/lead-scoring", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setLeads(json.data.leads)
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchLeads() }, [session])

  async function scoreAll() {
    setScoring(true)
    try {
      const res = await fetch("/api/v1/lead-scoring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ locale }),
      })
      const json = await res.json()
      if (json.success) setAiPowered(json.data.aiPowered)
      await fetchLeads()
    } catch (err) { console.error(err) } finally { setScoring(false) }
  }

  async function scoreOne(leadId: string) {
    setScoringId(leadId)
    try {
      const res = await fetch("/api/v1/lead-scoring", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>),
        },
        body: JSON.stringify({ leadId, locale }),
      })
      const json = await res.json()
      if (json.success) setAiPowered(json.data.aiPowered)
      await fetchLeads()
    } catch (err) { console.error(err) } finally { setScoringId(null) }
  }

  // Grade distribution
  const gradeCounts: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 }
  leads.forEach(l => { gradeCounts[l.grade] = (gradeCounts[l.grade] || 0) + 1 })
  const avgScore = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.score, 0) / leads.length) : 0
  const avgConversion = leads.length > 0 ? Math.round(leads.reduce((s, l) => s + l.conversionProb, 0) / leads.length) : 0
  const totalScored = leads.filter(l => l.lastScoredAt).length

  const sourceLabels: Record<string, string> = {
    website: tl("sourceWebsite"),
    referral: tl("sourceReferral"),
    cold_call: tl("sourceColdCall"),
    linkedin: tl("sourceLinkedin"),
    email: tl("sourceEmail"),
  }

  const sortedLeads = [...leads].sort((a, b) => {
    switch (sortBy) {
      case "grade_desc": return a.grade.localeCompare(b.grade)
      case "grade_asc": return b.grade.localeCompare(a.grade)
      case "score_desc": return b.score - a.score
      case "score_asc": return a.score - b.score
      case "name_asc": return a.contactName.localeCompare(b.contactName)
      case "name_desc": return b.contactName.localeCompare(a.contactName)
      case "company_asc": return (a.companyName || "").localeCompare(b.companyName || "")
      case "company_desc": return (b.companyName || "").localeCompare(a.companyName || "")
      case "source_asc": return (a.source || "").localeCompare(b.source || "")
      case "source_desc": return (b.source || "").localeCompare(a.source || "")
      case "conversion_desc": return b.conversionProb - a.conversionProb
      case "conversion_asc": return a.conversionProb - b.conversionProb
      default: return 0
    }
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse"><div className="h-96 bg-muted rounded-lg" /></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between rounded-xl p-4 ai-card">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-gradient-to-br from-[hsl(var(--ai-from))]/10 to-[hsl(var(--ai-to))]/10 rounded-lg ai-glow">
            <Brain className="h-6 w-6 text-[hsl(var(--ai-from))]" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">{t("title")}<HelpButton slug="ai-scoring" variant="label" /></h1>
            <p className="text-sm text-muted-foreground">
              {t("subtitle")}
              {aiPowered && (
                <Badge variant="ai" className="ml-2">
                  <Sparkles className="h-3 w-3 mr-1" /> Da Vinci
                </Badge>
              )}
            </p>
          </div>
        </div>
        <Button onClick={scoreAll} disabled={scoring} className="gap-2 ai-glow">
          {scoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          {scoring ? tc("loading") : t("newAgent")}
        </Button>
      </div>

      <PageDescription text={t("hintScoringPageDescription")} />

      {/* Grade cards */}
      <div className="grid grid-cols-5 gap-3">
        {(["A", "B", "C", "D", "F"] as const).map(grade => (
          <div key={grade} className={cn("rounded-lg p-5 text-center", gradeBgLight[grade])}>
            <div className={cn("text-4xl font-bold", {
              "text-green-600": grade === "A",
              "text-blue-600": grade === "B",
              "text-yellow-600": grade === "C",
              "text-orange-600": grade === "D",
              "text-red-600": grade === "F",
            })}>
              {grade}
            </div>
            <div className="text-2xl font-bold mt-1">{gradeCounts[grade]}</div>
            <div className="text-xs text-muted-foreground">{tl("title")}</div>
          </div>
        ))}
      </div>

      {/* Summary bar */}
      <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg p-4 bg-muted/30 flex items-center gap-8 text-sm">
        <span>{tl("avgScore")}: <strong className="text-primary">{avgScore}/100</strong></span>
        <span>{tc("probability")}: <strong className="text-primary">{avgConversion}%</strong></span>
        <span>{t("totalSessions")}: <strong className="text-primary">{totalScored}</strong></span>
      </div>

      {/* Lead table */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{tl("title")}</h2>
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                {[
                  { key: "grade", label: tl("colScore") },
                  { key: "score", label: tc("score") },
                  { key: "name", label: tl("colLead") },
                  { key: "company", label: tl("colCompany") },
                  { key: "source", label: tl("colSource") },
                  { key: "conversion", label: tl("colConversion") },
                  { key: null, label: t("stats"), className: "min-w-[200px]" },
                ].map(col => {
                  const isActive = col.key && sortBy.startsWith(col.key)
                  const isDesc = sortBy.endsWith("_desc")
                  const SortIcon = !col.key ? null : isActive ? (isDesc ? ArrowDown : ArrowUp) : ArrowUpDown
                  return (
                    <th
                      key={col.label}
                      className={cn(
                        "px-4 py-3 text-left font-medium text-muted-foreground select-none",
                        col.className,
                        col.key && "cursor-pointer hover:text-foreground transition-colors"
                      )}
                      onClick={col.key ? () => {
                        if (isActive) setSortBy(`${col.key}_${isDesc ? "asc" : "desc"}`)
                        else setSortBy(`${col.key}_desc`)
                      } : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        {SortIcon && <SortIcon className={cn("h-3 w-3", isActive ? "text-primary" : "opacity-40")} />}
                      </span>
                    </th>
                  )
                })}
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">{tc("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {leads.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">{tl("noLeads")}</td></tr>
              ) : sortedLeads.map((lead) => (
                <tr key={lead.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-3">
                    <span className={cn("inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold", gradeColors[lead.grade])}>
                      {lead.grade}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-bold">{lead.score}</td>
                  <td className="px-4 py-3 font-medium">{lead.contactName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.companyName || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{lead.source ? (sourceLabels[lead.source] || lead.source) : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={cn("font-medium", lead.conversionProb >= 50 ? "text-green-600" : lead.conversionProb >= 30 ? "text-yellow-600" : "text-red-500")}>
                      {lead.conversionProb}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[250px]">
                    {lead.reasoning ? (
                      <span className="flex items-start gap-1">
                        <Sparkles className="h-3 w-3 text-purple-500 shrink-0 mt-0.5" />
                        {lead.reasoning}
                      </span>
                    ) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 text-xs"
                      disabled={scoringId === lead.id}
                      onClick={() => scoreOne(lead.id)}
                    >
                      {scoringId === lead.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      {t("recalculate")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
