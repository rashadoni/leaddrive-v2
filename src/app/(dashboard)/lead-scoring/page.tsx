"use client"

import { useSession } from "next-auth/react"
import { useEffect, useState, useCallback } from "react"
import { useTranslations, useLocale } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Brain, Sparkles, RefreshCw, Target, TrendingUp, Users, Zap } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageDescription } from "@/components/page-description"
import { LeadItemModal } from "@/components/lead-item-modal"
import { HelpButton } from "@/components/help/help-button"

interface Lead {
  id: string
  contactName: string
  companyName: string | null
  email: string | null
  phone: string | null
  source: string | null
  status: string
  priority: string
  score: number
  scoreDetails: any
  grade: "A" | "B" | "C" | "D" | "F"
  conversionProb: number
  reasoning: string
  lastScoredAt: string | null
  estimatedValue: number | null
  notes: string | null
  createdAt: string
}

interface ScoringResponse {
  success: boolean
  data: {
    scored: number
    aiPowered: boolean
    results: { id: string; name: string; score: number; grade: string }[]
  }
}

// description field is overridden by gradeDescriptions (from useTranslations) in gradeDistribution
const GRADE_CONFIG: Record<string, { description: string; color: string; badgeClass: string }> = {
  A: {
    description: "Hot (80-100)",
    color: "text-green-600 bg-green-100 dark:text-green-400 dark:bg-green-900/30",
    badgeClass: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400 border-green-200 dark:border-green-800",
  },
  B: {
    description: "Warm (60-79)",
    color: "text-blue-600 bg-blue-100 dark:text-blue-400 dark:bg-blue-900/30",
    badgeClass: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  },
  C: {
    description: "Neutral (40-59)",
    color: "text-yellow-600 bg-yellow-100 dark:text-yellow-400 dark:bg-yellow-900/30",
    badgeClass: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800",
  },
  D: {
    description: "Cold (20-39)",
    color: "text-orange-600 bg-orange-100 dark:text-orange-400 dark:bg-orange-900/30",
    badgeClass: "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-400 border-orange-200 dark:border-orange-800",
  },
  F: {
    description: "Dead (0-19)",
    color: "text-red-600 bg-red-100 dark:text-red-400 dark:bg-red-900/30",
    badgeClass: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400 border-red-200 dark:border-red-800",
  },
}

export default function LeadScoringPage() {
  const t = useTranslations("leads")
  const tc = useTranslations("common")
  const tai = useTranslations("ai")
  const locale = useLocale()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId

  const [leads, setLeads] = useState<Lead[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [scoring, setScoring] = useState(false)
  const [rescoringId, setRescoringId] = useState<string | null>(null)
  const [aiPowered, setAiPowered] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)

  const headers: Record<string, string> = orgId
    ? { "x-organization-id": String(orgId) }
    : {}

  const fetchLeads = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/lead-scoring", { headers })
      const json = await res.json()
      if (json.success) {
        setLeads(json.data.leads)
        setTotal(json.data.total)
      }
    } catch (err) {
      console.error("Failed to fetch leads:", err)
    } finally {
      setLoading(false)
    }
  }, [orgId])

  useEffect(() => {
    fetchLeads()
  }, [fetchLeads])

  const scoreAll = async () => {
    setScoring(true)
    try {
      const res = await fetch("/api/v1/lead-scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ locale }),
      })
      const json: ScoringResponse = await res.json()
      if (json.success) {
        setAiPowered(json.data.aiPowered)
        await fetchLeads()
      }
    } catch (err) {
      console.error("Scoring failed:", err)
    } finally {
      setScoring(false)
    }
  }

  const rescoreLead = async (leadId: string) => {
    setRescoringId(leadId)
    try {
      const res = await fetch("/api/v1/lead-scoring", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ leadId, locale }),
      })
      const json: ScoringResponse = await res.json()
      if (json.success) {
        setAiPowered(json.data.aiPowered)
        await fetchLeads()
      }
    } catch (err) {
      console.error("Rescoring failed:", err)
    } finally {
      setRescoringId(null)
    }
  }

  // Computed stats
  const scoredLeads = leads.filter((l) => l.score > 0)
  const avgScore = scoredLeads.length
    ? Math.round(scoredLeads.reduce((sum, l) => sum + l.score, 0) / scoredLeads.length)
    : 0
  const avgConversion = scoredLeads.length
    ? Math.round(scoredLeads.reduce((sum, l) => sum + l.conversionProb, 0) / scoredLeads.length)
    : 0

  const gradeDescriptions: Record<string, string> = {
    A: t("gradeADesc"), B: t("gradeBDesc"), C: t("gradeCDesc"),
    D: t("gradeDDesc"), F: t("gradeFDesc"),
  }
  const gradeDistribution = ["A", "B", "C", "D", "F"].map((g) => ({
    label: g,
    ...GRADE_CONFIG[g],
    description: gradeDescriptions[g],
    count: leads.filter((l) => l.grade === g).length,
  }))

  const sortedLeads = [...leads].sort((a, b) => b.score - a.score)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">{tai("title")} <HelpButton slug="lead-scoring" variant="label" /></h1>
          <p className="text-muted-foreground mt-1">
            {tai("subtitle")}
          </p>
        </div>
        <Button onClick={scoreAll} disabled={scoring || loading} className="ai-glow">
          {scoring ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {scoring ? tc("loading") : tai("newAgent")}
        </Button>
      </div>

      <PageDescription text={tai("hintLeadScoringPageDescription")} />

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("avgScore")}</p>
                <p className="text-2xl font-bold">{avgScore}<span className="text-sm font-normal text-muted-foreground"> / 100</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{tc("probability")}</p>
                <p className="text-2xl font-bold">{avgConversion}<span className="text-sm font-normal text-muted-foreground"> %</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Users className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{tai("totalSessions")}</p>
                <p className="text-2xl font-bold">{scoredLeads.length}<span className="text-sm font-normal text-muted-foreground"> / {total}</span></p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2">
                <Zap className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{tai("active")}</p>
                <p className="text-2xl font-bold">{aiPowered ? tc("yes") : tc("no")}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Grade Distribution */}
      <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-5">
        {gradeDistribution.map((grade) => (
          <Card key={grade.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className={cn("inline-flex items-center rounded-full px-3 py-1 text-lg font-bold", grade.color)}>
                    {grade.label}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">{grade.description}</p>
                </div>
                <span className="text-3xl font-bold">{grade.count}</span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Results Table */}
      <Card className="ai-accent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            {tai("stats")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
              {tc("loading")}
            </div>
          ) : sortedLeads.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <div className="text-center">
                <Brain className="mx-auto h-12 w-12 mb-4 opacity-50" />
                <p className="text-lg font-medium">{tc("noData")}</p>
                <p className="text-sm mt-1">
                  {tai("noSessions")}
                </p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{t("colScore")}</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{tc("score")}</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{tc("name")}</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{t("colCompany")}</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{t("colSource")}</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{t("colConversion")}</th>
                    <th className="pb-3 pr-4 font-medium text-muted-foreground">{tai("stats")}</th>
                    <th className="pb-3 font-medium text-muted-foreground">{tc("actions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLeads.map((lead) => {
                    const gradeConf = GRADE_CONFIG[lead.grade] || GRADE_CONFIG["F"]
                    return (
                      <tr key={lead.id} className="border-b last:border-0 hover:bg-muted/50 cursor-pointer" onClick={() => setSelectedLead(lead)}>
                        <td className="py-3 pr-4">
                          <Badge variant="outline" className={cn("font-bold text-sm", gradeConf.badgeClass)}>
                            {lead.grade}
                          </Badge>
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-semibold">{lead.score}</span>
                        </td>
                        <td className="py-3 pr-4">
                          <div>
                            <p className="font-medium">{lead.contactName}</p>
                            {lead.email && (
                              <p className="text-xs text-muted-foreground">{lead.email}</p>
                            )}
                          </div>
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {lead.companyName || "—"}
                        </td>
                        <td className="py-3 pr-4 text-muted-foreground">
                          {lead.source || "—"}
                        </td>
                        <td className="py-3 pr-4">
                          <span className="font-medium">{lead.conversionProb}%</span>
                        </td>
                        <td className="py-3 pr-4 max-w-[250px]">
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {lead.reasoning || "—"}
                          </p>
                        </td>
                        <td className="py-3" onClick={e => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => rescoreLead(lead.id)}
                            disabled={rescoringId === lead.id}
                          >
                            <RefreshCw className={cn("h-4 w-4", rescoringId === lead.id && "animate-spin")} />
                            <span className="ml-1">{tc("refresh")}</span>
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Lead Detail Modal */}
      <LeadItemModal
        open={!!selectedLead}
        onOpenChange={open => { if (!open) setSelectedLead(null) }}
        lead={selectedLead}
        orgId={orgId}
        onSaved={fetchLeads}
      />
    </div>
  )
}
