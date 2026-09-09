"use client"

/**
 * KPI Arena page — gamified "Crypto Bubbles"-style leaderboard. Department tabs
 * switch the group (like Crypto Bubbles' 1H/1D/1W); the period selector reframes
 * the window. Bubbles float (BubbleArena); clicking one opens its KPI breakdown.
 *
 * Visible tabs come from /api/v1/leaderboard/groups (RBAC + module-gated), so a
 * non-manager only ever sees their own department.
 */
import { useEffect, useRef, useState, useCallback } from "react"
import dynamic from "next/dynamic"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Trophy, AlertTriangle, RotateCw } from "lucide-react"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
// BubbleArena is a canvas/DOM + d3-force component that can only run in the
// browser. Loading it via next/dynamic with ssr:false keeps d3-force (ESM) out
// of the route's server-side render + client-reference manifest — server-rendering
// it under Next 16 + webpack standalone corrupted the route manifest and 500'd
// the whole page ("client reference manifest for route /leaderboard does not exist").
const BubbleArena = dynamic(
  () => import("@/components/leaderboard/bubble-arena").then((m) => m.BubbleArena),
  { ssr: false },
)
import { AgentDetailCard } from "@/components/leaderboard/agent-detail-card"
import { BubbleArenaSkeleton } from "@/components/leaderboard/bubble-arena-skeleton"
import { LeaderboardLegend } from "@/components/leaderboard/leaderboard-legend"
import { LeaderboardTable } from "@/components/leaderboard/leaderboard-table"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet"
import type { LeaderboardGroup, LeaderboardPeriod, LeaderboardResult, NormalizedAgent } from "@/lib/leaderboard/types"

type ViewMode = "bubbles" | "list"

const PERIODS: LeaderboardPeriod[] = ["day", "week", "month", "quarter", "year", "all"]

export default function LeaderboardPage() {
  const t = useTranslations("leaderboard")
  const { data: session, update: refreshSession } = useSession()
  const orgId = session?.user?.organizationId

  const [groups, setGroups] = useState<LeaderboardGroup[]>([])
  const [group, setGroup] = useState<LeaderboardGroup | null>(null)
  const [period, setPeriod] = useState<LeaderboardPeriod>("month")
  // Always land on the Bubbles view (per user) — the Arena's signature visual.
  // The viewer can toggle to List for the session, but every fresh load opens
  // Bubbles (no persisted override).
  const [view, setView] = useState<ViewMode>("bubbles")
  const [data, setData] = useState<LeaderboardResult | null>(null)
  const [loading, setLoading] = useState(true)
  // Fatal fetch error (arena load) — shown with a retry instead of a silent spinner.
  const [error, setError] = useState<string | null>(null)
  // The session watchdog (below): true once we've waited too long for orgId to
  // arrive from useSession() — i.e. /api/auth/session is flaking (503).
  const [sessionStalled, setSessionStalled] = useState(false)
  const [selected, setSelected] = useState<NormalizedAgent | null>(null)
  // Keep the last opened agent so the drawer keeps its content while it slides
  // closed (selected→null would otherwise blank the panel mid-animation).
  const lastAgentRef = useRef<NormalizedAgent | null>(null)
  if (selected) lastAgentRef.current = selected

  // 1) which groups can this viewer see?
  useEffect(() => {
    if (!orgId) return
    const headers = { "x-organization-id": String(orgId) }
    fetch("/api/v1/leaderboard/groups", { headers })
      .then((r) => r.json())
      .then((j: { groups?: LeaderboardGroup[] }) => {
        const gs = j.groups ?? []
        setGroups(gs)
        setGroup((cur) => cur ?? gs[0] ?? null)
      })
      .catch(() => toast.error(t("loadError")))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId])

  // 2) load the selected group/period. `silent` = a background poll refresh: don't
  //    flip the loading spinner or clear the selection, just update the data (the
  //    bubble sim preserves positions by id, so it re-settles smoothly).
  const fetchArena = useCallback(
    (silent: boolean) => {
      if (!group || !orgId) return
      if (!silent) {
        setLoading(true)
        setError(null)
        setSelected(null)
      }
      fetch(`/api/v1/leaderboard/arena?group=${group}&period=${period}`, {
        headers: { "x-organization-id": String(orgId) },
      })
        .then(async (r) => {
          if (!r.ok) throw new Error((await r.json()).error || "error")
          return r.json()
        })
        // Success clears any prior error too — a recovered silent poll should
        // drop the retry panel and show the fresh data.
        .then((j: LeaderboardResult) => {
          setData(j)
          setError(null)
        })
        .catch(() => {
          // Silent polls don't clobber a working view with an error banner on a
          // transient blip; only a foreground load surfaces the retry state.
          if (!silent) {
            toast.error(t("loadError"))
            setError(t("loadError"))
          }
        })
        .finally(() => {
          if (!silent) setLoading(false)
        })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [group, period, orgId],
  )

  useEffect(() => {
    fetchArena(false)
  }, [fetchArena])

  // 3) live auto-refresh every 30s (silent — no spinner, no flicker)
  useEffect(() => {
    const id = setInterval(() => fetchArena(true), 30_000)
    return () => clearInterval(id)
  }, [fetchArena])

  // 4) refetch IMMEDIATELY when the user returns to this tab — so completing work
  //    in another tab/window shows up the moment they switch back to the Arena,
  //    instead of waiting for the 30s timer ("live, not after a reload").
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") fetchArena(true)
    }
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("focus", refresh)
    return () => {
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("focus", refresh)
    }
  }, [fetchArena])

  // 5) Session watchdog. This is the ONLY page that reads orgId client-side via
  //    useSession(); when /api/auth/session flakes (503 under load) the orgId
  //    never arrives, so the groups + arena effects above stay parked and the
  //    skeleton would spin forever with no way out. If orgId hasn't landed
  //    within 8s, flip to a retry panel instead. A healthy session resolves in
  //    well under a second, so this never fires on a normal load.
  useEffect(() => {
    if (orgId) {
      setSessionStalled(false)
      return
    }
    const id = setTimeout(() => setSessionStalled(true), 8_000)
    return () => clearTimeout(id)
  }, [orgId])

  const handleRetry = useCallback(() => {
    setError(null)
    setSessionStalled(false)
    if (!orgId) {
      // Session never resolved — re-fetch /api/auth/session. Once orgId lands,
      // the groups + arena effects re-run on their own.
      refreshSession()
    } else {
      fetchArena(false)
    }
  }, [orgId, refreshSession, fetchArena])

  const agents = data?.agents ?? []
  // A blocking error the user can retry out of: a stalled session (no orgId) or
  // a failed arena load. Takes precedence over the loading/empty states so the
  // Arena never hangs on a silent, actionless spinner.
  const fatalError = sessionStalled && !orgId ? t("sessionError") : error

  return (
    <div
      className="dark -m-8 min-h-[calc(100vh-3.5rem)] p-8 text-foreground"
      style={{
        // Whole KPI Arena section goes fully dark — no white anywhere. The `dark`
        // class flips every theme token (title/tabs/period/legend/toggle/table) to
        // its dark variant, and this near-black field (full-bleed via -m-8, cancels
        // <main>'s p-8 + bg-background) replaces the white page background.
        //
        // Crypto-Bubbles look (per user): the canvas is NEAR-BLACK so the bubbles'
        // neon rings/glow pop at maximum contrast (navy diluted the glow). The brand
        // navy survives only as a soft ambient glow at the very top. Near-black ≈ the
        // black sidebar, so the old left-edge seam dissolves on its own; a faint 1px
        // hairline keeps a deliberate panel edge. Layers paint first-on-top.
        background:
          "linear-gradient(to right, rgba(120,150,210,0.16) 0px, rgba(120,150,210,0.16) 1px, transparent 1px)," +
          "radial-gradient(ellipse 110% 50% at 50% -5%, rgba(40,92,184,0.22) 0%, rgba(40,92,184,0) 58%)," +
          "linear-gradient(to bottom, #070b14 0%, #04060d 100%)",
      }}
    >
      <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <PageDescription icon={Trophy} title={t("title")} description={t("description")} />
        <HelpButton slug="leaderboard" variant="label" />
      </div>

      {/* Department tabs — segmented control in a muted track. Active uses the
          PRIMARY emphasis (this is the main axis: which department). One shared
          control idiom across tabs/period/view, two emphasis levels for hierarchy. */}
      {groups.length > 0 && (
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                group === g
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`groups.${g}`)}
            </button>
          ))}
        </div>
      )}

      {/* Period selector — same segmented idiom, NEUTRAL emphasis (secondary axis:
          timeframe). Dropped the uppercase/inverted styling that made it a 3rd idiom. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-0.5">
          {PERIODS.map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                period === p ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`periods.${p}`)}
            </button>
          ))}
        </div>
        {group === "sales" && <span className="text-xs text-muted-foreground">· {t("note.salesQuarter")}</span>}
      </div>

      {/* legend + Bubbles|List view toggle — same segmented idiom, neutral emphasis */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {data?.meta && view === "bubbles" ? <LeaderboardLegend /> : <span />}
        <div className="inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
          {(["bubbles", "list"] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                view === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t(`view.${v}`)}
            </button>
          ))}
        </div>
      </div>

      {fatalError ? (
        /* Retry panel — a stalled session or a failed load lands here instead of
           the infinite skeleton. Spans the same full-bleed canvas as the Arena. */
        <div className="relative -mx-8 overflow-hidden">
          <div className="flex h-[620px] flex-col items-center justify-center gap-4 text-white/70">
            <AlertTriangle className="h-10 w-10 text-amber-400/80" />
            <span className="max-w-md text-center text-sm">{fatalError}</span>
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              <RotateCw className="h-4 w-4" />
              {t("retry")}
            </button>
          </div>
        </div>
      ) : view === "bubbles" ? (
        /* Arena canvas — spans full width (-mx-8, flush to the sidebar). The whole
           section wrapper is already near-black (navy survives only as a top glow),
           so the canvas itself is transparent and just holds the floating bubbles. */
        <div className="relative -mx-8 overflow-hidden">
          {loading ? (
            <BubbleArenaSkeleton height={620} label={t("loading")} />
          ) : agents.length === 0 ? (
            <div className="flex h-[620px] flex-col items-center justify-center gap-3 text-white/55">
              <Trophy className="h-10 w-10 opacity-40" />
              <span className="text-sm">{t("empty")}</span>
            </div>
          ) : (
            <BubbleArena agents={agents} height={620} selectedId={selected?.id} onSelect={setSelected} />
          )}
        </div>
      ) : loading ? (
        <div className="py-16 text-center text-sm text-muted-foreground animate-pulse">{t("loading")}</div>
      ) : agents.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
          <Trophy className="h-10 w-10 opacity-40" />
          <span className="text-sm">{t("empty")}</span>
        </div>
      ) : (
        <LeaderboardTable agents={agents} onSelect={setSelected} />
      )}

      {/* Unified drill-down — ONE right-side Sheet (drawer) for BOTH bubbles and
          list views (replaces the old split: floating card in bubbles / centred
          modal in list). Radix Sheet gives slide-in, overlay, Esc + focus-trap.
          The drawer portals to <body> (outside the Arena's forced-dark wrapper),
          so it follows the app's normal LIGHT palette — a white, slightly
          translucent frosted panel matching every other section (per user),
          NOT the near-black Arena canvas. */}
      <Sheet open={!!selected} onOpenChange={(open) => { if (!open) setSelected(null) }}>
        <SheetContent
          side="right"
          className="w-full overflow-y-auto bg-background/90 backdrop-blur-md sm:max-w-md"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{(selected ?? lastAgentRef.current)?.name ?? ""}</SheetTitle>
            <SheetDescription>{t("ofTarget")}</SheetDescription>
          </SheetHeader>
          {/* render the last agent too, so the panel keeps its content while it
              slides closed (selected→null) instead of blanking mid-animation. */}
          {(selected ?? lastAgentRef.current) && (
            <AgentDetailCard
              agent={(selected ?? lastAgentRef.current)!}
              group={group}
              period={period}
              orgId={orgId ? String(orgId) : undefined}
            />
          )}
        </SheetContent>
      </Sheet>
      </div>
    </div>
  )
}
