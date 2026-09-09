"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import dynamic from "next/dynamic"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import { Trophy, Zap, Camera, Target, Heart, Star } from "lucide-react"
import { useTranslations } from "next-intl"
// The KPI-Arena bubble is a canvas + d3-force component — browser-only, so it's
// loaded via next/dynamic with ssr:false (same as the top-level /leaderboard).
const BubbleArena = dynamic(() => import("@/components/leaderboard/bubble-arena").then((m) => m.BubbleArena), { ssr: false })
import { AgentDetailCard } from "@/components/leaderboard/agent-detail-card"
import { BubbleArenaSkeleton } from "@/components/leaderboard/bubble-arena-skeleton"
import { LeaderboardLegend } from "@/components/leaderboard/leaderboard-legend"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import type { NormalizedAgent, LeaderboardPeriod } from "@/lib/leaderboard/types"

const achievementIcons: Record<string, { icon: any; color: string }> = {
  speed_master: { icon: Zap, color: "text-amber-500" },
  photo_champion: { icon: Camera, color: "text-teal-500" },
  consistent_success: { icon: Target, color: "text-red-500" },
  customer_friend: { icon: Heart, color: "text-green-500" },
  perfect_week: { icon: Star, color: "text-purple-500" },
}

// MTM period → Arena period (Arena knows day/week/month/quarter/year/all).
const ARENA_PERIOD: Record<string, LeaderboardPeriod> = { weekly: "week", monthly: "month", all: "all" }

type ViewMode = "bubbles" | "list"

export default function MtmLeaderboardPage() {
  const t = useTranslations("mtmLeaderboard")
  const tl = useTranslations("leaderboard") // reuse Arena strings (view/legend/states)
  const { data: session } = useSession()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<"weekly" | "monthly" | "all">("monthly")
  const [view, setView] = useState<ViewMode>("bubbles")
  const [arena, setArena] = useState<{ agents: NormalizedAgent[]; meta?: any } | null>(null)
  const [arenaLoading, setArenaLoading] = useState(true)
  const [arenaError, setArenaError] = useState(false)
  const [selected, setSelected] = useState<NormalizedAgent | null>(null)
  const lastAgentRef = useRef<NormalizedAgent | null>(null)
  if (selected) lastAgentRef.current = selected
  const orgId = session?.user?.organizationId
  const headers = orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>)

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`/api/v1/mtm/leaderboard?period=${period}`, { headers })
      const r = await res.json()
      if (!res.ok || !r.success) toast.error(`Failed to load leaderboard: ${r.error || "Unknown error"}`)
      else setData(r.data)
    } catch (e) {
      toast.error(`Failed to load leaderboard: ${e instanceof Error ? e.message : "Network error"}`)
    } finally { setLoading(false) }
  }

  // KPI-Arena bubble feed for the MTM group (radius ∝ volume, colour ∝ attainment,
  // click → the agent's KPI breakdown). RBAC/module-gated — a 403 just falls back
  // to the List view.
  const fetchArena = useCallback(() => {
    if (!orgId) return
    setArenaLoading(true); setArenaError(false)
    fetch(`/api/v1/leaderboard/arena?group=mtm&period=${ARENA_PERIOD[period]}`, { headers: { "x-organization-id": String(orgId) } })
      .then(async (r) => { if (!r.ok) throw new Error("arena"); return r.json() })
      .then((j) => setArena(j))
      .catch(() => setArenaError(true))
      .finally(() => setArenaLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, period])

  useEffect(() => { fetchLeaderboard() }, [orgId, period])
  useEffect(() => { fetchArena() }, [fetchArena])

  const rankings = data?.rankings || []
  const maxScore = Math.max(...rankings.map((r: any) => r.score), 1)
  const arenaAgents = arena?.agents ?? []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={Trophy} title={t("title")} description={t("description")} />
          <HelpButton slug="mtm-leaderboard" variant="label" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {(["weekly", "monthly", "all"] as const).map(p => (
              <Button key={p} variant={period === p ? "default" : "outline"} size="sm" onClick={() => setPeriod(p)}>
                {p === "weekly" ? t("weekly") : p === "monthly" ? t("monthly") : t("allTime")}
              </Button>
            ))}
          </div>
          <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
            {(["bubbles", "list"] as ViewMode[]).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-md px-3 py-1 text-xs font-medium transition ${view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                {tl(`view.${v}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "bubbles" ? (
        /* KPI Arena — near-black canvas so the bubbles' rings pop (Crypto-Bubbles look).
           The `dark` class flips legend tokens; the drawer portals out to the light app. */
        <div className="dark rounded-xl overflow-hidden border border-zinc-800" style={{ background: "linear-gradient(to bottom, #070b14 0%, #04060d 100%)" }}>
          <div className="flex items-center justify-between px-4 pt-3">
            {arena?.meta && !arenaLoading && !arenaError ? <LeaderboardLegend /> : <span />}
          </div>
          {arenaError ? (
            <div className="flex h-[520px] flex-col items-center justify-center gap-3 text-white/55">
              <Trophy className="h-10 w-10 opacity-40" />
              <span className="text-sm">{tl("empty")}</span>
              <Button size="sm" variant="outline" onClick={() => setView("list")}>{tl("view.list")}</Button>
            </div>
          ) : arenaLoading ? (
            <BubbleArenaSkeleton height={520} label={tl("loading")} />
          ) : arenaAgents.length === 0 ? (
            <div className="flex h-[520px] flex-col items-center justify-center gap-3 text-white/55">
              <Trophy className="h-10 w-10 opacity-40" />
              <span className="text-sm">{tl("empty")}</span>
            </div>
          ) : (
            <BubbleArena agents={arenaAgents} height={520} selectedId={selected?.id} onSelect={setSelected} />
          )}
        </div>
      ) : loading ? (
        <div className="animate-pulse space-y-4"><div className="h-48 bg-muted rounded-lg" /><div className="h-64 bg-muted rounded-lg" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* Rankings */}
          <div className="lg:col-span-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /> {t("fullRanking")}</h3>
            {rankings.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t("noAgents")}</div>
            ) : (
              <div className="space-y-3">
                {rankings.map((agent: any) => (
                  <div key={agent.agentId} className="flex items-center gap-3">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                      agent.rank === 1 ? "bg-amber-100 text-amber-700" : agent.rank === 2 ? "bg-slate-100 text-slate-600" : agent.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"}`}>
                      {agent.rank}
                    </span>
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-semibold">{agent.name?.charAt(0)?.toUpperCase()}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{agent.name}</div>
                      <div className="w-full bg-muted rounded-full h-1.5 mt-1"><div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${(agent.score / maxScore) * 100}%` }} /></div>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span title={t("tooltipVisits")}>👁 {agent.visits}</span>
                      <span title={t("tooltipTasks")}>✓ {agent.completedTasks}</span>
                      <span title={t("tooltipPhotos")}>📷 {agent.approvedPhotos}</span>
                    </div>
                    <div className="text-right"><span className="text-sm font-bold text-primary">{agent.score}</span><span className="text-[10px] text-muted-foreground ml-1">{t("pointsSuffix")}</span></div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Achievements + Top 3 */}
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
              <h3 className="font-semibold text-sm mb-4 flex items-center gap-2"><Star className="h-4 w-4 text-primary" /> {t("achievements")}</h3>
              {rankings.length > 0 && rankings[0].achievements ? (
                <div className="space-y-3">
                  {rankings[0].achievements.map((ach: any) => {
                    const meta = achievementIcons[ach.id]; if (!meta) return null
                    const Icon = meta.icon; const completed = ach.progress >= ach.total
                    return (
                      <div key={ach.id} className="flex items-center gap-3">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center ${completed ? "bg-primary/10" : "bg-muted"}`}><Icon className={`h-4 w-4 ${completed ? meta.color : "text-muted-foreground"}`} /></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium">{t(`ach_${ach.id}_label`)}</div>
                          <div className="text-[10px] text-muted-foreground">{t(`ach_${ach.id}_desc`)}</div>
                          <div className="w-full bg-muted rounded-full h-1 mt-1"><div className={`h-1 rounded-full ${completed ? "bg-green-500" : "bg-amber-500"}`} style={{ width: `${Math.min((ach.progress / ach.total) * 100, 100)}%` }} /></div>
                        </div>
                        <span className="text-[10px] text-muted-foreground">{ach.progress}/{ach.total}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (<div className="text-sm text-muted-foreground">{t("selectAgent")}</div>)}
            </div>

            {rankings.length >= 3 && (
              <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
                <h3 className="font-semibold text-sm mb-3">{t("top3Weekly")}</h3>
                <div className="space-y-2">
                  {rankings.slice(0, 3).map((agent: any) => (
                    <div key={agent.agentId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${agent.rank === 1 ? "text-amber-500" : agent.rank === 2 ? "text-slate-400" : "text-orange-500"}`}>#{agent.rank}</span>
                        <span className="text-sm">{agent.name}</span>
                      </div>
                      <span className="text-sm font-semibold">{agent.score} pts</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Drill-down drawer for a clicked bubble — the agent's KPI breakdown. */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background/90 backdrop-blur-md sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>{(selected ?? lastAgentRef.current)?.name ?? ""}</SheetTitle>
            <SheetDescription>{tl("ofTarget")}</SheetDescription>
          </SheetHeader>
          {(selected ?? lastAgentRef.current) && (
            <AgentDetailCard agent={(selected ?? lastAgentRef.current)!} group="mtm" period={ARENA_PERIOD[period]} orgId={orgId ? String(orgId) : undefined} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
