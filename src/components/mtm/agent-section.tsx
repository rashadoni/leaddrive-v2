"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { AlertCircle, ArrowLeft, History, Info, MapPinned, UserPlus, UsersRound } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MtmContactExplorer, type MtmContactExplorerAgentScope } from "@/components/mtm/contact-explorer"
import { useMtmApiError } from "@/components/mtm/use-mtm-api-error"
import { mtmStatusLabel } from "@/lib/mtm/status-labels"

type SectionAgent = {
  id: string
  name: string
  role: string
  status: string
  phone: string | null
  email: string | null
  manager: { id: string; name: string } | null
  team: { id: string; name: string } | null
}

type SectionView = MtmContactExplorerAgentScope["view"]

/**
 * One employee's own section: every client assigned to them with the same
 * data the Clients page shows, and the two things a manager came here for —
 * attach clients to this employee and detach them (owner, 2026-10-02).
 *
 * Until now both actions lived only on the Clients page: filter by the
 * responsible employee, tick, choose the employee again in a dialog. Opening
 * an employee led to their GPS history and nowhere near their clients.
 */
export function MtmAgentSection({ agentId }: { agentId: string }) {
  const t = useTranslations("mtmAgentSection")
  const ta = useTranslations("mtmAgents")
  const ts = useTranslations("mtmStatus")
  const explainError = useMtmApiError()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const view: SectionView = searchParams.get("tab") === "attach" ? "candidates" : "assigned"
  const [agent, setAgent] = useState<SectionAgent | null>(null)
  const [error, setError] = useState("")
  const [assignedTotal, setAssignedTotal] = useState<number | null>(null)
  const [changes, setChanges] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    void fetch(`/api/v1/mtm/agents/${encodeURIComponent(agentId)}`, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { success?: boolean; data?: SectionAgent } | null
        if (controller.signal.aborted) return
        if (!response.ok || !body?.success || !body.data) {
          setError(response.status === 404 ? t("notFound") : explainError(body, response.status))
          return
        }
        setAgent(body.data)
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(explainError(null))
      })
    return () => controller.abort()
  }, [agentId, explainError, t])

  // On the attach tab the employee's own list is not mounted, so nothing
  // reports its size: ask for the count directly, again after every change.
  useEffect(() => {
    if (view !== "candidates") return
    const controller = new AbortController()
    const params = new URLSearchParams({ ownerAgentId: agentId, status: "ACTIVE", page: "1", limit: "1" })
    void fetch(`/api/v1/mtm/contacts?${params}`, { headers: { Accept: "application/json" }, signal: controller.signal })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as { success?: boolean; data?: { total?: number } } | null
        if (!controller.signal.aborted && response.ok && body?.success && typeof body.data?.total === "number") {
          setAssignedTotal(body.data.total)
        }
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [agentId, changes, view])

  const openView = (next: SectionView) => {
    const params = new URLSearchParams(searchParams.toString())
    if (next === "candidates") params.set("tab", "attach")
    else params.delete("tab")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  const onChanged = useCallback(() => setChanges((count) => count + 1), [])
  const scope = useMemo<MtmContactExplorerAgentScope | null>(() => agent ? {
    agent: { id: agent.id, name: agent.name, role: agent.role, status: agent.status },
    view,
    returnHref: view === "candidates" ? `${pathname}?tab=attach` : pathname,
    onTotal: view === "assigned" ? setAssignedTotal : undefined,
    onChanged,
  } : null, [agent, onChanged, pathname, view])

  const back = (
    <Button asChild variant="ghost" size="sm" className="min-h-11 -ml-2">
      <Link href="/mtm/agents"><ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />{t("back")}</Link>
    </Button>
  )

  if (error) {
    return (
      <div className="space-y-4" data-testid="mtm-agent-section">
        {back}
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>{error}</span>
        </div>
      </div>
    )
  }
  if (!agent || !scope) {
    return (
      <div className="space-y-3" aria-busy="true" data-testid="mtm-agent-section">
        <div className="h-8 w-56 animate-pulse rounded-md bg-muted motion-reduce:animate-none" />
        <div className="h-40 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />
      </div>
    )
  }

  // The server attaches clients to an active field employee only; say so here
  // instead of letting every selected client come back "excluded".
  const canReceiveClients = agent.role === "AGENT" && agent.status === "ACTIVE"
  const roleLabel = mtmStatusLabel(ts, "role", agent.role)
  const statusLabel = mtmStatusLabel(ts, "agentStatus", agent.status)
  const tabClass = (active: boolean) => `inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-medium transition-colors ${active ? "border-primary bg-primary text-primary-foreground" : "border-zinc-200 bg-card hover:bg-muted dark:border-zinc-700"}`

  return (
    <div className="space-y-4" data-testid="mtm-agent-section">
      {back}
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cyan-100 text-lg font-semibold text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400" aria-hidden="true">{agent.name.charAt(0).toUpperCase()}</div>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold [overflow-wrap:anywhere]">{agent.name}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {[roleLabel, statusLabel, agent.team?.name, agent.manager ? t("manager", { name: agent.manager.name }) : null].filter(Boolean).join(" · ")}
            </p>
            {agent.phone || agent.email ? <p className="mt-0.5 text-sm text-muted-foreground [overflow-wrap:anywhere]">{[agent.phone, agent.email].filter(Boolean).join(" · ")}</p> : null}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={`/mtm/map?agentId=${encodeURIComponent(agent.id)}`}><MapPinned className="mr-1.5 h-4 w-4" aria-hidden="true" />{ta("actionMap")}</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-h-11">
            <Link href={`/mtm/map?mode=history&agentId=${encodeURIComponent(agent.id)}`}><History className="mr-1.5 h-4 w-4" aria-hidden="true" />{ta("actionHistory")}</Link>
          </Button>
        </div>
      </header>

      <div role="tablist" aria-label={t("tabs")} className="flex flex-wrap gap-2">
        <button type="button" role="tab" aria-selected={view === "assigned"} data-testid="mtm-agent-tab-assigned" className={tabClass(view === "assigned")} onClick={() => openView("assigned")}>
          <UsersRound className="h-4 w-4" aria-hidden="true" />
          {assignedTotal === null ? t("tabAssigned") : t("tabAssignedCount", { count: assignedTotal })}
        </button>
        <button type="button" role="tab" aria-selected={view === "candidates"} data-testid="mtm-agent-tab-attach" className={tabClass(view === "candidates")} onClick={() => openView("candidates")}>
          <UserPlus className="h-4 w-4" aria-hidden="true" />
          {t("tabAttach")}
        </button>
      </div>

      {view === "candidates" && !canReceiveClients ? (
        <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/20 dark:text-sky-100" data-testid="mtm-agent-attach-unavailable">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">{t("attachUnavailableTitle")}</p>
            <p className="mt-1 opacity-80">{t("attachUnavailableBody", { name: agent.name, role: roleLabel, status: statusLabel })}</p>
          </div>
        </div>
      ) : (
        // The list says itself whose clients it shows and how to change that.
        <MtmContactExplorer key={`${agent.id}-${view}`} agentScope={scope} />
      )}
    </div>
  )
}
