"use client"

import { useEffect, useState, useCallback, useMemo, useRef } from "react"
import { useSession } from "next-auth/react"
import { toast } from "sonner"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { Button } from "@/components/ui/button"
import { Trophy, Zap, Camera, Target, Heart, Star, ChevronDown, ChevronUp } from "lucide-react"
import { useTranslations } from "next-intl"
import { AgentDetailCard } from "@/components/leaderboard/agent-detail-card"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import type { NormalizedAgent, LeaderboardPeriod } from "@/lib/leaderboard/types"

/**
 * Field UX audit 2026-09-05, W-12 / task C13 (backlog T15).
 *
 * The page used to open on a near-black canvas of floating bubbles, one per
 * agent, every one of them reading 0 %. The Phase 1 UX contract says the field
 * module is "not a gamified dashboard", and with empty data the screen was not
 * merely off-contract, it was useless: nothing to read, nothing to compare.
 *
 * What replaces it is a table — the thing a supervisor was trying to get at by
 * squinting at bubble sizes. `BubbleArena` itself stays in the codebase: the
 * general `/leaderboard` page is built on it, and deleting it here would break
 * a screen this audit never looked at.
 */

const achievementIcons: Record<string, { icon: any; color: string }> = {
  speed_master: { icon: Zap, color: "text-amber-500" },
  photo_champion: { icon: Camera, color: "text-teal-500" },
  consistent_success: { icon: Target, color: "text-red-500" },
  customer_friend: { icon: Heart, color: "text-green-500" },
  perfect_week: { icon: Star, color: "text-purple-500" },
}

// MTM period → Arena period (Arena knows day/week/month/quarter/year/all).
const ARENA_PERIOD: Record<string, LeaderboardPeriod> = { weekly: "week", monthly: "month", all: "all" }

type SortKey = "rank" | "visits" | "completedTasks" | "approvedPhotos" | "score"

/** Columns the table can be ordered by, and which way is "best first". */
const SORTABLE: Array<{ key: SortKey; label: string; numeric: boolean }> = [
  { key: "rank", label: "colAgent", numeric: false },
  { key: "visits", label: "colVisits", numeric: true },
  { key: "completedTasks", label: "colTasks", numeric: true },
  { key: "approvedPhotos", label: "colPhotos", numeric: true },
  { key: "score", label: "colScore", numeric: true },
]

export default function MtmLeaderboardPage() {
  const t = useTranslations("mtmLeaderboard")
  const { data: session } = useSession()
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<"weekly" | "monthly" | "all">("monthly")
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "rank", desc: false })
  const [arenaAgents, setArenaAgents] = useState<NormalizedAgent[] | null>(null)
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

  /**
   * The breakdown panel's own numbers, keyed by agent id.
   *
   * The table's figures come from `/api/v1/mtm/leaderboard` and nowhere else —
   * one source, which is what the audit asked for. This second call exists
   * only to resolve a clicked row into the shape `AgentDetailCard` reads, and
   * it is deliberately not recomputed on the client: attainment is weighted
   * per organization, so a client-side guess would print a different number
   * from the one the panel's own API would give. If the call is refused
   * (module gate, RBAC) the table simply stops being clickable.
   */
  const fetchArena = useCallback(() => {
    if (!orgId) return
    fetch(`/api/v1/leaderboard/arena?group=mtm&period=${ARENA_PERIOD[period]}`, { headers: { "x-organization-id": String(orgId) } })
      .then(async (r) => { if (!r.ok) throw new Error("arena"); return r.json() })
      .then((j) => setArenaAgents(Array.isArray(j?.agents) ? j.agents : []))
      .catch(() => setArenaAgents([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, period])

  useEffect(() => { fetchLeaderboard() }, [orgId, period])
  useEffect(() => { fetchArena() }, [fetchArena])

  const rankings = data?.rankings || []
  const maxScore = Math.max(...rankings.map((r: any) => r.score), 1)
  const breakdownById = useMemo(() => {
    const map = new Map<string, NormalizedAgent>()
    for (const agent of arenaAgents ?? []) map.set(agent.id, agent)
    return map
  }, [arenaAgents])

  /**
   * The order the table is drawn in.
   *
   * `rankings` keeps the server's order untouched, because Top 3 is read from
   * it. Sorting the one array and slicing the first three off it would quietly
   * turn "the three best" into "the three at the top of whatever the reader
   * just sorted by" — the defect T15 names in its acceptance.
   */
  const sortedRankings = useMemo(() => {
    const rows = [...rankings]
    if (sort.key === "rank") {
      rows.sort((a: any, b: any) => (sort.desc ? b.rank - a.rank : a.rank - b.rank))
      return rows
    }
    rows.sort((a: any, b: any) => {
      const delta = (b[sort.key] ?? 0) - (a[sort.key] ?? 0)
      return sort.desc ? delta : -delta
    })
    return rows
  }, [rankings, sort])

  const toggleSort = (key: SortKey) => {
    setSort((current) => current.key === key ? { key, desc: !current.desc } : { key, desc: key !== "rank" })
  }

  const openBreakdown = (agentId: string) => {
    const agent = breakdownById.get(agentId)
    if (agent) setSelected(agent)
    else toast.message(t("breakdownUnavailable"))
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <PageDescription icon={Trophy} title={t("title")} description={t("description")} />
          <HelpButton slug="mtm-leaderboard" variant="label" />
        </div>
        <div className="flex gap-1 flex-wrap">
          {(["weekly", "monthly", "all"] as const).map(p => (
            <Button key={p} variant={period === p ? "default" : "outline"} size="sm" onClick={() => setPeriod(p)}>
              {p === "weekly" ? t("weekly") : p === "monthly" ? t("monthly") : t("allTime")}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse space-y-4"><div className="h-48 bg-muted rounded-lg" /><div className="h-64 bg-muted rounded-lg" /></div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2"><Trophy className="h-4 w-4 text-amber-500" /> {t("fullRanking")}</h3>
            {rankings.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">{t("noAgents")}</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-zinc-200 text-xs text-muted-foreground dark:border-zinc-700">
                      {SORTABLE.map(({ key, label, numeric }) => (
                        <th key={key} scope="col" className={numeric ? "px-2 py-2 text-right" : "px-2 py-2 text-left"}
                          aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"}>
                          <button type="button" onClick={() => toggleSort(key)}
                            aria-label={t("sortBy", { column: t(label) })}
                            className={`inline-flex min-h-9 items-center gap-1 rounded px-1 font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${sort.key === key ? "text-foreground" : ""}`}>
                            {t(label)}
                            {sort.key === key ? (sort.desc ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />) : null}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRankings.map((agent: any) => (
                      <tr key={agent.agentId} data-testid="mtm-leaderboard-row"
                        tabIndex={0} role="button"
                        aria-label={t("openBreakdown", { name: agent.name })}
                        onClick={() => openBreakdown(agent.agentId)}
                        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openBreakdown(agent.agentId) } }}
                        className="cursor-pointer border-b border-zinc-100 last:border-b-0 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-zinc-800">
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                              agent.rank === 1 ? "bg-amber-100 text-amber-700" : agent.rank === 2 ? "bg-slate-100 text-slate-600" : agent.rank === 3 ? "bg-orange-100 text-orange-700" : "bg-muted text-muted-foreground"}`}>
                              {agent.rank}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate font-medium">{agent.name}</div>
                              <div className="mt-1 h-1.5 w-full rounded-full bg-muted"><div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${(agent.score / maxScore) * 100}%` }} /></div>
                            </div>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums">{agent.visits}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{agent.completedTasks}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{agent.approvedPhotos}</td>
                        <td className="px-2 py-2 text-right"><span className="font-bold text-primary tabular-nums">{agent.score}</span><span className="ml-1 text-[10px] text-muted-foreground">{t("pointsSuffix")}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

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
                <h3 className="font-semibold text-sm mb-1">{t("top3Weekly")}</h3>
                <p className="mb-3 text-[11px] text-muted-foreground">{t("top3FromRanking")}</p>
                <div className="space-y-2" data-testid="mtm-leaderboard-top3">
                  {/* `rankings`, never `sortedRankings`: see the note on the memo. */}
                  {rankings.slice(0, 3).map((agent: any) => (
                    <div key={agent.agentId} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-bold ${agent.rank === 1 ? "text-amber-500" : agent.rank === 2 ? "text-slate-400" : "text-orange-500"}`}>#{agent.rank}</span>
                        <span className="text-sm">{agent.name}</span>
                      </div>
                      <span className="text-sm font-semibold">{agent.score} {t("pointsSuffix")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent side="right" className="w-full overflow-y-auto bg-background/90 backdrop-blur-md sm:max-w-md">
          <SheetHeader className="sr-only">
            <SheetTitle>{(selected ?? lastAgentRef.current)?.name ?? ""}</SheetTitle>
            <SheetDescription>{t("achievements")}</SheetDescription>
          </SheetHeader>
          {(selected ?? lastAgentRef.current) && (
            <AgentDetailCard agent={(selected ?? lastAgentRef.current)!} group="mtm" period={ARENA_PERIOD[period]} orgId={orgId ? String(orgId) : undefined} />
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}
