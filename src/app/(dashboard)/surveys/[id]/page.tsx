"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Download, TrendingUp, ThumbsUp, ThumbsDown, Minus, Users, Save, Ticket as TicketIcon, User, ExternalLink, MessageSquare, Mail, Phone } from "lucide-react"
import { QuestionBuilder, type Question } from "@/components/surveys/question-builder"
import { SurveyAnalyticsDashboard } from "@/components/surveys/analytics-dashboard"
import { SurveyUnsubscribesPanel } from "@/components/surveys/unsubscribes-panel"
import { SurveyTriggersPanel } from "@/components/surveys/triggers-panel"
import { HelpButton } from "@/components/help/help-button"

interface Survey {
  id: string
  name: string
  description: string | null
  type: string
  status: string
  publicSlug: string
  totalSent: number
  totalResponses: number
  questions: any[]
  channels: string[]
  triggers: Record<string, any>
}

interface Response {
  id: string
  score: number | null
  category: string | null
  comment: string | null
  commentSentiment: string | null
  email: string | null
  phone: string | null
  channel: string | null
  answers: Record<string, any>
  completedAt: string
  contact: { id: string; fullName: string; email: string | null; phone: string | null } | null
  ticket: { id: string; ticketNumber: string; subject: string; source: string | null } | null
}

interface Stats {
  total: number
  promoters: number
  passives: number
  detractors: number
  nps: number | null
}

export default function SurveyDetailPage() {
  const t = useTranslations("surveys")
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const orgId = session?.user?.organizationId
  const headers: Record<string, string> = orgId ? { "x-organization-id": String(orgId) } : {}

  const [survey, setSurvey] = useState<Survey | null>(null)
  const [responses, setResponses] = useState<Response[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [questions, setQuestions] = useState<Question[]>([])
  const [savingQuestions, setSavingQuestions] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    if (!params.id) return
    fetch(`/api/v1/surveys/${params.id}`, { headers })
      .then(r => r.json())
      .then(d => {
        if (d.success) {
          setSurvey(d.data.survey)
          setResponses(d.data.responses)
          setStats(d.data.stats)
          setQuestions(Array.isArray(d.data.survey?.questions) ? d.data.survey.questions : [])
        }
        setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id, orgId])

  const saveQuestions = async () => {
    if (!params.id) return
    setSavingQuestions(true)
    try {
      const res = await fetch(`/api/v1/surveys/${params.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ questions }),
      })
      if (res.ok) {
        setSavedFlash(true)
        setTimeout(() => setSavedFlash(false), 2000)
      }
    } finally {
      setSavingQuestions(false)
    }
  }

  const downloadCsv = () => {
    if (!params.id) return
    const url = `/api/v1/surveys/${params.id}/export`
    window.open(url, "_blank")
  }

  if (loading) {
    return <div className="p-6"><div className="animate-pulse h-40 bg-muted rounded-lg" /></div>
  }
  if (!survey) {
    return <div className="p-6 text-muted-foreground">Survey not found</div>
  }

  // Score distribution for NPS (0-10) or rating
  const max = survey.type === "nps" ? 10 : survey.type === "ces" ? 7 : 5
  const distribution: number[] = Array(max + 1).fill(0)
  for (const r of responses) {
    if (r.score != null && r.score >= 0 && r.score <= max) distribution[r.score]++
  }
  const distMax = Math.max(1, ...distribution)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.push("/surveys")} className="gap-1.5">
          <ArrowLeft className="h-4 w-4" /> {t("back")}
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2 min-w-0"><span className="truncate">{survey.name}</span> <HelpButton slug="survey-detail" variant="label" className="shrink-0" /></h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant={survey.status === "active" ? "default" : "secondary"}>{survey.status}</Badge>
            <Badge variant="outline" className="uppercase text-[10px]">{survey.type}</Badge>
          </div>
        </div>
        <Button variant="outline" onClick={downloadCsv} className="gap-1.5">
          <Download className="h-4 w-4" /> {t("exportCsv")}
        </Button>
      </div>

      <SurveyAnalyticsDashboard surveyId={survey.id} orgId={orgId} />
      <SurveyTriggersPanel surveyId={survey.id} orgId={orgId} initialTriggers={survey.triggers || {}} />
      <SurveyUnsubscribesPanel surveyId={survey.id} orgId={orgId} />

      {stats && stats.nps != null && (
        <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">{t("npsScore")}</h2>
            <span className={`text-4xl font-bold ${stats.nps >= 50 ? "text-green-600" : stats.nps >= 0 ? "text-amber-600" : "text-red-600"}`}>
              {stats.nps}
            </span>
          </div>
          <div className="space-y-1">
            {distribution.map((count, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-6 text-xs text-muted-foreground tabular-nums text-right">{i}</span>
                <div className="flex-1 h-4 bg-muted rounded overflow-hidden">
                  <div
                    className={`h-full ${i <= 6 ? "bg-red-500" : i <= 8 ? "bg-amber-500" : "bg-green-500"}`}
                    style={{ width: `${(count / distMax) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-xs tabular-nums">{count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <NpsTrendChart responses={responses} type={survey.type} />


      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">{t("distribution")}</h2>
          <div className="flex items-center gap-2">
            {savedFlash && <span className="text-xs text-green-600">{t("savedAt", { time: new Date().toLocaleTimeString() })}</span>}
            <Button size="sm" variant="outline" onClick={saveQuestions} disabled={savingQuestions} className="gap-1.5">
              <Save className="h-3.5 w-3.5" /> {savingQuestions ? t("saving") : t("saveTriggers")}
            </Button>
          </div>
        </div>
        <QuestionBuilder value={questions} onChange={setQuestions} />
      </div>

      <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold">{t("recentResponses")} ({responses.length})</h2>
        </div>
        {responses.length === 0 ? (
          <p className="p-6 text-sm text-center text-muted-foreground">{t("noResponses")}</p>
        ) : (
          <div className="divide-y">
            {responses.map(r => (
              <div key={r.id} className="p-4 space-y-2.5">
                <div className="flex items-start gap-3 flex-wrap">
                  <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-base shrink-0 ${
                    r.category === "promoter" ? "bg-green-100 text-green-700" :
                    r.category === "detractor" ? "bg-red-100 text-red-700" :
                    r.category === "passive" ? "bg-amber-100 text-amber-700" :
                    "bg-muted text-muted-foreground"
                  }`}>
                    {r.score ?? "—"}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {r.category && <Badge variant="outline" className="text-[10px] uppercase">{r.category}</Badge>}
                      {r.channel && <Badge variant="secondary" className="text-[10px]">{r.channel}</Badge>}
                      {r.ticket?.source && r.ticket.source !== r.channel && (
                        <Badge variant="outline" className="text-[10px]">source: {r.ticket.source}</Badge>
                      )}
                      <span className="text-xs text-muted-foreground ml-auto">{new Date(r.completedAt).toLocaleString()}</span>
                    </div>
                    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
                      {r.contact ? (
                        <a href={`/contacts/${r.contact.id}`} className="inline-flex items-center gap-1 hover:text-foreground hover:underline">
                          <User className="h-3 w-3" /> {r.contact.fullName}
                        </a>
                      ) : (r.email || r.phone) ? (
                        <span className="inline-flex items-center gap-1">
                          <User className="h-3 w-3" /> {r.email || r.phone}
                        </span>
                      ) : null}
                      {r.contact?.email && <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{r.contact.email}</span>}
                      {r.contact?.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{r.contact.phone}</span>}
                      {r.ticket && (
                        <a href={`/tickets/${r.ticket.id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                          <TicketIcon className="h-3 w-3" /> {r.ticket.ticketNumber}
                          <ExternalLink className="h-3 w-3 opacity-60" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                {r.comment && (
                  <div className="ml-13 flex items-start gap-2 bg-muted/40 rounded-lg p-2.5">
                    <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0 text-sm">
                      <p>{r.comment}</p>
                      {r.commentSentiment && (
                        <span className={`inline-block mt-1 text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wide ${
                          r.commentSentiment === "positive" ? "bg-emerald-100 text-emerald-700" :
                          r.commentSentiment === "negative" ? "bg-red-100 text-red-700" :
                          "bg-muted text-muted-foreground"
                        }`}>
                          AI: {r.commentSentiment}
                        </span>
                      )}
                    </div>
                  </div>
                )}
                {r.answers && Object.keys(r.answers).length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                      Show {Object.keys(r.answers).length} answer(s)
                    </summary>
                    <div className="mt-2 space-y-1 rounded-md bg-muted/30 p-2">
                      {Object.entries(r.answers).map(([qid, val]) => (
                        <div key={qid} className="flex gap-2">
                          <span className="text-muted-foreground font-mono">{qid}:</span>
                          <span className="flex-1 break-words">
                            {typeof val === "object" ? JSON.stringify(val) : String(val)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NpsTrendChart({ responses, type }: { responses: Response[]; type: string }) {
  // Bucket responses by week over the last 12 weeks
  const weeks: Array<{ label: string; start: Date; scores: number[]; categories: string[] }> = []
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const start = new Date(now)
    start.setDate(start.getDate() - i * 7)
    start.setHours(0, 0, 0, 0)
    weeks.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, start, scores: [], categories: [] })
  }
  for (const r of responses) {
    const ts = new Date(r.completedAt).getTime()
    for (let i = weeks.length - 1; i >= 0; i--) {
      if (ts >= weeks[i].start.getTime()) {
        if (r.score != null) weeks[i].scores.push(r.score)
        if (r.category) weeks[i].categories.push(r.category)
        break
      }
    }
  }

  if (type !== "nps") {
    return null
  }

  const weeklyNps = weeks.map(w => {
    if (w.categories.length === 0) return null
    const p = w.categories.filter(c => c === "promoter").length
    const d = w.categories.filter(c => c === "detractor").length
    return Math.round(((p - d) / w.categories.length) * 100)
  })
  const hasAny = weeklyNps.some(v => v != null)
  if (!hasAny) return null

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-5">
      <h2 className="text-sm font-semibold mb-3">NPS trend (last 12 weeks)</h2>
      <div className="flex items-end gap-1 h-32">
        {weeks.map((w, i) => {
          const nps = weeklyNps[i]
          const hasData = nps != null
          const normalized = hasData ? Math.min(100, Math.max(0, (nps + 100) / 2)) : 0
          const color = !hasData ? "bg-muted" : nps >= 50 ? "bg-green-500" : nps >= 0 ? "bg-amber-500" : "bg-red-500"
          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full flex items-end flex-1">
                <div className={`w-full ${color} rounded-t`} style={{ height: `${normalized}%` }} />
              </div>
              <span className="text-[9px] text-muted-foreground">{w.label}</span>
              <span className="text-[10px] font-medium tabular-nums">{hasData ? nps : "—"}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StatTile({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3 flex items-center gap-3">
      <div className="p-2 rounded-lg bg-muted">
        <Icon className={`h-4 w-4 ${color || ""}`} />
      </div>
      <div>
        <p className={`text-lg font-bold leading-none ${color || ""}`}>{value.toLocaleString()}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
      </div>
    </div>
  )
}
