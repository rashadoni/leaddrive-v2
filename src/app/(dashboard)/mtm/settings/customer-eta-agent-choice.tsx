"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Agent = { id: string; name: string }
type Scope = "all" | "selected"

/**
 * Whose customers get «агент едет к вам» (owner, 2026-11-07: «пока не хочу
 * всем включать»; mock-up approved with «Давай»). Under the switch on the
 * same row, not a second switch somewhere else: «Только выбранным» shows the
 * chosen agents' names, each with its cross, and «Выбрать агентов» opens the
 * list with ticks. Nothing is sent until the page's own «Сохранить».
 */
export function CustomerEtaAgentChoice({
  scope,
  agentIds,
  disabled,
  onScopeChange,
  onAgentIdsChange,
}: {
  scope: unknown
  agentIds: unknown
  disabled: boolean
  onScopeChange: (scope: Scope) => void
  onAgentIdsChange: (ids: string[]) => void
}) {
  const ts = useTranslations("mtmSettingsPage")
  const chosenScope: Scope = scope === "selected" ? "selected" : "all"
  const chosen = useMemo(
    () => (Array.isArray(agentIds) ? agentIds.filter((id): id is string => typeof id === "string") : []),
    [agentIds],
  )
  const [agents, setAgents] = useState<Agent[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    let alive = true
    fetch("/api/v1/mtm/agents?limit=500", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        const rows: unknown = body?.data?.agents
        if (!response.ok || !Array.isArray(rows)) throw new Error("agents")
        const active = rows
          .filter((row) => row && typeof row.id === "string" && row.status === "ACTIVE")
          .map((row) => ({ id: row.id as string, name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : "—" }))
          .sort((left, right) => left.name.localeCompare(right.name))
        if (alive) setAgents(active)
      })
      .catch(() => { if (alive) setLoadFailed(true) })
    return () => { alive = false }
  }, [])

  const nameOf = (id: string) => agents?.find((agent) => agent.id === id)?.name ?? ts("customerEtaAgentGone")
  const hint = chosenScope === "all"
    ? ts("hintCustomerEtaAgentsAll")
    : chosen.length === 0 ? ts("hintCustomerEtaAgentsNone") : ts("hintCustomerEtaAgentsSelected")

  return (
    <div className="space-y-2 border-l-2 border-muted pl-3" data-setting-row="customerEtaAgentScope">
      <div className="text-xs font-semibold">{ts("lblCustomerEtaAgents")}</div>
      <div role="radiogroup" aria-label={ts("lblCustomerEtaAgents")} className="inline-flex rounded-md border border-border p-0.5 text-xs">
        {(["selected", "all"] as const).map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={chosenScope === option}
            disabled={disabled}
            onClick={() => onScopeChange(option)}
            className={cn(
              "rounded px-3 py-1.5 transition-colors disabled:cursor-not-allowed",
              chosenScope === option ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {ts(option === "selected" ? "optCustomerEtaAgentsSelected" : "optCustomerEtaAgentsAll")}
          </button>
        ))}
      </div>
      {chosenScope === "selected" ? (
        <div className="flex flex-wrap items-center gap-1.5" data-testid="customer-eta-chosen-agents">
          {chosen.map((id) => (
            <span key={id} data-agent-id={id} className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-1 text-xs font-medium">
              {nameOf(id)}
              <button
                type="button"
                disabled={disabled}
                aria-label={ts("customerEtaAgentRemove", { name: nameOf(id) })}
                onClick={() => onAgentIdsChange(chosen.filter((other) => other !== id))}
                className="text-muted-foreground hover:text-foreground disabled:cursor-not-allowed"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2.5 text-xs" disabled={disabled || agents === null} onClick={() => setPicking(true)}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {ts("btnCustomerEtaChooseAgents")}
          </Button>
        </div>
      ) : null}
      <div className="text-xs text-muted-foreground">{loadFailed ? ts("customerEtaAgentsLoadFailed") : hint}</div>
      {picking && agents ? (
        <AgentPicker
          agents={agents}
          chosen={chosen}
          onCancel={() => setPicking(false)}
          onDone={(ids) => { onAgentIdsChange(ids); setPicking(false) }}
        />
      ) : null}
    </div>
  )
}

function AgentPicker({ agents, chosen, onCancel, onDone }: {
  agents: Agent[]
  chosen: string[]
  onCancel: () => void
  onDone: (ids: string[]) => void
}) {
  const ts = useTranslations("mtmSettingsPage")
  const [ticked, setTicked] = useState(() => new Set(chosen))
  const [query, setQuery] = useState("")
  const needle = query.trim().toLocaleLowerCase()
  const shown = needle ? agents.filter((agent) => agent.name.toLocaleLowerCase().includes(needle)) : agents
  const toggle = (id: string, on: boolean) => setTicked((current) => {
    const next = new Set(current)
    if (on) next.add(id)
    else next.delete(id)
    return next
  })
  // In the order of the list, so the saved value does not depend on the order of the clicks.
  const done = () => onDone([...agents.filter((agent) => ticked.has(agent.id)).map((agent) => agent.id),
    ...chosen.filter((id) => ticked.has(id) && !agents.some((agent) => agent.id === id))])

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel() }} widthClassName="max-w-[28rem]">
      <DialogHeader>
        <DialogTitle>{ts("customerEtaAgentsDialogTitle")}</DialogTitle>
      </DialogHeader>
      <DialogContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{ts("customerEtaAgentsDialogHint")}</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={ts("customerEtaAgentsSearch")} aria-label={ts("customerEtaAgentsSearch")} className="pl-8" />
        </div>
        <div className="space-y-0.5" data-testid="customer-eta-agent-list">
          {shown.map((agent) => (
            <label key={agent.id} className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <Checkbox checked={ticked.has(agent.id)} onCheckedChange={(on) => toggle(agent.id, on)} aria-label={agent.name} />
              {agent.name}
            </label>
          ))}
          {shown.length === 0 ? <div className="px-2 py-3 text-sm text-muted-foreground">{ts("customerEtaAgentsEmpty")}</div> : null}
        </div>
        <div className="flex items-center justify-between gap-3 pt-1">
          <span className="text-xs text-muted-foreground">{ts("customerEtaAgentsCount", { count: ticked.size, total: agents.length })}</span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>{ts("cancel")}</Button>
            <Button type="button" onClick={done}>{ts("btnCustomerEtaAgentsDone")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
