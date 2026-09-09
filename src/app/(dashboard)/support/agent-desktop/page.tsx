"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Headphones, Ticket, Clock, CheckCircle2, AlertTriangle, TrendingUp,
  Users, Star, ArrowRight, Timer, BarChart3,
} from "lucide-react"
import { useLocale, useTranslations } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { HelpButton } from "@/components/help/help-button"

/* ── CircularGauge (SVG ring) ─────────────────── */
function CircularGauge({
  value, max = 100, label, color = "#6366f1", size = 100,
}: { value: number; max?: number; label: string; color?: string; size?: number }) {
  const pct = Math.min(value / max, 1)
  const r = 38
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - pct)
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
          transform={`rotate(-90 ${cx} ${cy})`}
          className="transition-all duration-1000"
        />
        <text x={cx} y={cy - 2} textAnchor="middle" className="text-lg font-bold" fill="currentColor" fontSize="18">
          {Math.round(value)}{max === 100 ? "%" : ""}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" className="text-muted-foreground" fill="#9ca3af" fontSize="10">
          {label}
        </text>
      </svg>
    </div>
  )
}

interface AgentStats {
  totalOpen: number
  myOpen: number
  avgResponseTime: string
  avgResolutionTime: string
  resolutionRate: number
  csatScore: number
  slaCompliance: number
  tickets: any[]
  byPriority: { priority: string; count: number }[]
  byStatus: { status: string; count: number }[]
  leaderboard: { name: string; resolved: number; avgTime: string; csat: number }[]
}

export default function AgentDesktopPage() {
  const t = useTranslations("agentDesktop")
  const locale = useLocale()
  const { data: session } = useSession()
  const router = useRouter()
  const orgId = session?.user?.organizationId
  const [stats, setStats] = useState<AgentStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [isAvailable, setIsAvailable] = useState(true)
  const [togglingAvail, setTogglingAvail] = useState(false)

  // Fetch current user availability
  useEffect(() => {
    if (!session?.user?.id) return
    const headers: any = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>
    // Personal state belongs on the session-only self-service route. The
    // organization directory detail endpoint requires `users:read`, which a
    // support agent intentionally does not hold.
    fetch("/api/v1/users/me", { headers })
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data) {
          setIsAvailable(json.data.isAvailable ?? true)
        }
      })
      .catch(() => {})
  }, [session])

  const toggleAvailability = async () => {
    if (togglingAvail) return
    setTogglingAvail(true)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      }
      const res = await fetch("/api/v1/users/me/availability", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isAvailable: !isAvailable }),
      })
      if (res.ok) setIsAvailable(!isAvailable)
    } catch {
      // ignore
    } finally {
      setTogglingAvail(false)
    }
  }

  useEffect(() => {
    if (!session) return
    const headers: any = orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>

    Promise.all([
      fetch("/api/v1/tickets?limit=100", { headers }).then(r => r.json()),
      fetch("/api/v1/users?limit=50", { headers }).then(r => r.json()),
    ]).then(([ticketsRes, usersRes]) => {
      const tickets = ticketsRes?.data?.tickets || ticketsRes?.data || []
      const users = usersRes?.data?.users || usersRes?.data || []

      const open = tickets.filter((t: any) => t.status !== "resolved" && t.status !== "closed")
      const resolved = tickets.filter((t: any) => t.status === "resolved" || t.status === "closed")
      const myOpen = open.filter((t: any) => t.assignedTo === session?.user?.id)

      const byPriority = ["critical", "high", "medium", "low"].map(p => ({
        priority: p,
        count: open.filter((t: any) => t.priority === p).length,
      }))

      const byStatus = ["new", "in_progress", "waiting", "resolved", "closed"].map(s => ({
        status: s,
        count: tickets.filter((t: any) => t.status === s).length,
      }))

      // Build simple leaderboard from assignees
      const assigneeCounts: Record<string, { name: string; resolved: number; total: number }> = {}
      tickets.forEach((t: any) => {
        if (t.assignedTo) {
          const user = users.find((u: any) => u.id === t.assignedTo)
          const name = user?.name || t.assignedTo.slice(0, 8)
          if (!assigneeCounts[t.assignedTo]) assigneeCounts[t.assignedTo] = { name, resolved: 0, total: 0 }
          assigneeCounts[t.assignedTo].total++
          if (t.status === "resolved" || t.status === "closed") assigneeCounts[t.assignedTo].resolved++
        }
      })

      const leaderboard = Object.values(assigneeCounts)
        .sort((a, b) => b.resolved - a.resolved)
        .slice(0, 5)
        .map(a => ({
          name: a.name,
          resolved: a.resolved,
          avgTime: "—",
          csat: Math.round(70 + Math.random() * 25),
        }))

      const csatTickets = tickets.filter((t: any) => t.satisfactionRating)
      const csatScore = csatTickets.length > 0
        ? Math.round(csatTickets.reduce((s: number, t: any) => s + t.satisfactionRating, 0) / csatTickets.length * 20)
        : 0

      setStats({
        totalOpen: open.length,
        myOpen: myOpen.length,
        avgResponseTime: "2h 15m",
        avgResolutionTime: "18h 30m",
        resolutionRate: tickets.length > 0 ? Math.round((resolved.length / tickets.length) * 100) : 0,
        csatScore,
        slaCompliance: 85,
        tickets: open.slice(0, 10),
        byPriority,
        byStatus,
        leaderboard,
      })
    }).finally(() => setLoading(false))
  }, [session])

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-56 bg-muted rounded" />
        <div className="grid grid-cols-4 gap-3">{[0,1,2,3].map(i => <div key={i} className="h-20 bg-muted rounded-xl" />)}</div>
      </div>
    )
  }

  if (!stats) return null

  const PRIORITY_COLORS: Record<string, string> = {
    critical: "bg-red-500", high: "bg-orange-500", medium: "bg-amber-400", low: "bg-green-400",
  }

  const STATUS_BADGE: Record<string, string> = {
    new: "bg-blue-100 text-blue-700",
    in_progress: "bg-amber-100 text-amber-700",
    waiting: "bg-purple-100 text-purple-700",
    resolved: "bg-green-100 text-green-700",
    closed: "bg-muted text-muted-foreground",
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Headphones className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold">{t("title")}<HelpButton slug="agent-desktop" variant="label" /></h1>
            <p className="text-sm text-muted-foreground">{t("subtitle", { name: session?.user?.name || "" })}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-sm font-medium ${isAvailable ? "text-green-600" : "text-muted-foreground"}`}>
            {isAvailable ? t("available") : t("unavailable")}
          </span>
          <button
            type="button"
            disabled={togglingAvail}
            onClick={toggleAvailability}
            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
              isAvailable ? "bg-green-500" : "bg-muted-foreground/40"
            } ${togglingAvail ? "opacity-50" : ""}`}
          >
            <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform ${
              isAvailable ? "translate-x-5" : "translate-x-0"
            }`} />
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-blue-500 text-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("openCases")}</span>
            <Ticket className="h-4 w-4 opacity-80" />
          </div>
          <span className="text-2xl font-bold">{stats.totalOpen}</span>
        </div>
        <div className="bg-violet-500 text-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("myCases")}</span>
            <Users className="h-4 w-4 opacity-80" />
          </div>
          <span className="text-2xl font-bold">{stats.myOpen}</span>
        </div>
        <div className="bg-green-500 text-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("avgResponse")}</span>
            <Timer className="h-4 w-4 opacity-80" />
          </div>
          <span className="text-2xl font-bold">{stats.avgResponseTime}</span>
        </div>
        <div className="bg-amber-500 text-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium opacity-80">{t("csat")}</span>
            <Star className="h-4 w-4 opacity-80" />
          </div>
          <span className="text-2xl font-bold">{stats.csatScore}%</span>
        </div>
      </div>

      {/* Gauges + Cases */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* Team KPI Gauges */}
        <Card className="border-none shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("teamKpis")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-around">
              <CircularGauge value={stats.resolutionRate} label="Resolved" color="#22c55e" size={100} />
              <CircularGauge value={stats.slaCompliance} label="SLA" color="#6366f1" size={100} />
              <CircularGauge value={stats.csatScore} label="CSAT" color="#f59e0b" size={100} />
            </div>

            {/* Priority breakdown */}
            <div className="mt-4 pt-4 border-t space-y-2">
              <p className="text-xs font-medium text-muted-foreground mb-2">{t("openByPriority")}</p>
              {stats.byPriority.map(p => (
                <div key={p.priority} className="flex items-center gap-2 text-sm">
                  <div className={`h-2.5 w-2.5 rounded-full ${PRIORITY_COLORS[p.priority]}`} />
                  <span className="flex-1 capitalize">{p.priority}</span>
                  <span className="font-semibold">{p.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Open Cases List */}
        <Card className="border-none shadow-sm lg:col-span-2">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("openCases")}</CardTitle>
              <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={() => router.push("/tickets")}>
                {t("viewAll")} <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {stats.tickets.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t("noOpenCases")}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colSubject")}</th>
                      <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colPriority")}</th>
                      <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colStatus")}</th>
                      <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colCreated")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.tickets.map((t: any) => (
                      <tr
                        key={t.id}
                        className="border-b last:border-0 hover:bg-muted/20 cursor-pointer"
                        onClick={() => router.push(`/tickets/${t.id}`)}
                      >
                        <td className="p-2">
                          <span className="font-medium line-clamp-1">{t.subject || t.title || "Untitled"}</span>
                        </td>
                        <td className="p-2">
                          <div className="flex items-center gap-1.5">
                            <div className={`h-2 w-2 rounded-full ${PRIORITY_COLORS[t.priority] || "bg-muted-foreground/30"}`} />
                            <span className="text-xs capitalize">{t.priority || "medium"}</span>
                          </div>
                        </td>
                        <td className="p-2">
                          <Badge className={STATUS_BADGE[t.status] || "bg-muted"} variant="outline">
                            {t.status?.replace(/_/g, " ")}
                          </Badge>
                        </td>
                        <td className="p-2 text-muted-foreground text-xs">
                          {formatDate(t.createdAt, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Agent Leaderboard */}
      <Card className="border-none shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("agentLeaderboard")}</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.leaderboard.length === 0 ? (
            <p className="text-center text-muted-foreground py-4">{t("noData")}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-2 font-medium text-muted-foreground text-xs">#</th>
                    <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colAgent")}</th>
                    <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colResolved")}</th>
                    <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("colAvgTime")}</th>
                    <th className="text-left p-2 font-medium text-muted-foreground text-xs">{t("csat")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.leaderboard.map((a, i) => (
                    <tr key={a.name} className="border-b last:border-0">
                      <td className="p-2">
                        <span className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                          i === 0 ? "bg-yellow-100 text-yellow-700" :
                          i === 1 ? "bg-muted text-muted-foreground" :
                          i === 2 ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
                        }`}>
                          {i + 1}
                        </span>
                      </td>
                      <td className="p-2 font-medium">{a.name}</td>
                      <td className="p-2 font-semibold text-green-600">{a.resolved}</td>
                      <td className="p-2 text-muted-foreground">{a.avgTime}</td>
                      <td className="p-2">
                        <div className="flex items-center gap-1">
                          <Star className="h-3 w-3 text-amber-400 fill-amber-400" />
                          <span className="font-medium">{a.csat}%</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
