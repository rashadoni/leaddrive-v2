"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Check, CheckCircle2, ChevronDown, Loader2, Search, Users } from "lucide-react"

import { SkillPicker } from "@/components/skill-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import {
  agentEligibleForQueue,
  applyBulkSkillChange,
  normalizeRoutingSkills,
  type RoutingAgent,
  type RoutingQueue,
} from "@/lib/skill-routing/presentation"

type AgentFilter = "all" | "eligible" | "uncovered" | "unavailable"

function RoutingCheckbox({ checked, onChange, label, testId }: {
  checked: boolean
  onChange: () => void
  label: string
  testId: string
}) {
  return (
    <label className="relative flex h-11 w-11 shrink-0 items-center justify-center">
      <input
        type="checkbox"
        className="peer absolute inset-0 h-11 w-11 cursor-pointer opacity-0"
        checked={checked}
        onChange={onChange}
        aria-label={label}
        data-testid={testId}
      />
      <span aria-hidden="true" className="pointer-events-none flex h-4 w-4 items-center justify-center rounded border bg-background peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2">
        {checked && <Check className="h-3 w-3 text-foreground" />}
      </span>
    </label>
  )
}

export function AgentSkillsManager({
  agents,
  selectedQueue,
  availableSkills,
  canWrite,
  loading,
  error,
  errorRetryable,
  onRetry,
  onAgentsChange,
}: {
  agents: RoutingAgent[]
  selectedQueue: RoutingQueue | null
  availableSkills: string[]
  canWrite: boolean
  loading: boolean
  error: string
  errorRetryable: boolean
  onRetry: () => void
  onAgentsChange: (agents: RoutingAgent[]) => void
}) {
  const t = useTranslations("skillRouting")
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<AgentFilter>("all")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [bulkSkills, setBulkSkills] = useState<string[]>([])
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
  const [savingIds, setSavingIds] = useState<string[]>([])
  const [status, setStatus] = useState<{ kind: "success" | "error"; text: string } | null>(null)

  const visibleAgents = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return agents.filter((agent) => {
      if (needle && !`${agent.name} ${agent.role} ${agent.skills.join(" ")}`.toLowerCase().includes(needle)) return false
      const eligible = selectedQueue ? agentEligibleForQueue(agent, selectedQueue) : false
      if (filter === "eligible" && !eligible) return false
      if (filter === "uncovered" && normalizeRoutingSkills(agent.skills).length > 0) return false
      if (filter === "unavailable" && agent.isActive && agent.isAvailable) return false
      return true
    })
  }, [agents, filter, query, selectedQueue])

  const mutateSkills = async (agentIds: string[], skills: string[], mode: "add" | "remove") => {
    if (!canWrite || agentIds.length === 0 || skills.length === 0) return false
    const previous = agents
    const selected = new Set(agentIds)
    const optimistic = agents.map((agent) => selected.has(agent.id)
      ? { ...agent, skills: applyBulkSkillChange(agent.skills, skills, mode) }
      : agent)
    onAgentsChange(optimistic)
    setSavingIds(agentIds)
    setStatus(null)
    try {
      const response = await fetch("/api/v1/skill-routing/agents", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentIds, skills, mode }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.data)) throw new Error(t("saveFailed"))
      onAgentsChange(payload.data)
      setStatus({ kind: "success", text: t("skillsSaved", { count: agentIds.length }) })
      return true
    } catch {
      onAgentsChange(previous)
      setStatus({ kind: "error", text: t("skillsRolledBack") })
      return false
    } finally {
      setSavingIds([])
    }
  }

  const handleIndividual = (agent: RoutingAgent, nextSkills: string[]) => {
    const before = new Set(normalizeRoutingSkills(agent.skills))
    const after = new Set(normalizeRoutingSkills(nextSkills))
    const added = [...after].filter((skill) => !before.has(skill))
    const removed = [...before].filter((skill) => !after.has(skill))
    if (added.length > 0) void mutateSkills([agent.id], added, "add")
    else if (removed.length > 0) void mutateSkills([agent.id], removed, "remove")
  }

  const handleBulk = async (mode: "add" | "remove") => {
    if (await mutateSkills(selectedIds, bulkSkills, mode)) {
      setSelectedIds([])
      setBulkSkills([])
    }
  }

  const allVisibleSelected = visibleAgents.length > 0 && visibleAgents.every((agent) => selectedIds.includes(agent.id))

  return (
    <section aria-labelledby="routing-agents-title" className="min-w-0 rounded-xl border bg-card" data-testid="routing-agents-manager" data-state={loading ? "loading" : error ? "error" : agents.length === 0 ? "empty" : "ready"} data-selected-queue-id={selectedQueue?.id ?? ""}>
      <div className="border-b p-3 sm:p-4">
        <div className="flex items-start gap-2">
          <Users className="mt-0.5 h-4 w-4 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 id="routing-agents-title" className="text-base font-semibold">{selectedQueue ? t("agentsForQueue", { name: selectedQueue.name }) : t("agentSkills")}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{selectedQueue ? t("queueEligibilityHint") : t("selectQueueHint")}</p>
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
          <label className="relative block">
            <span className="sr-only">{t("searchAgents")}</span>
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchAgents")} className="min-h-11 pl-9" data-testid="routing-agent-search" />
          </label>
          <Select aria-label={t("filterAgents")} value={filter} onChange={(event) => setFilter(event.target.value as AgentFilter)} className="min-h-11" data-testid="routing-agent-filter">
            <option value="all">{t("agentFilterAll")}</option>
            <option value="eligible" disabled={!selectedQueue}>{t("agentFilterEligible")}</option>
            <option value="uncovered">{t("agentFilterNoSkills")}</option>
            <option value="unavailable">{t("agentFilterUnavailable")}</option>
          </Select>
        </div>
      </div>

      {status && <div role="status" aria-live="polite" className={`m-3 flex items-center gap-2 rounded-lg border p-3 text-sm ${status.kind === "error" ? "border-destructive/30" : ""}`} data-testid="routing-agent-status" data-kind={status.kind}>{status.kind === "error" ? <AlertCircle className="h-4 w-4 text-destructive" /> : <CheckCircle2 className="h-4 w-4" />}{status.text}</div>}

      {canWrite && selectedIds.length > 0 && (
        <div className="m-3 rounded-lg border bg-muted/10 p-3" data-testid="routing-agent-bulk-editor">
          <p className="text-sm font-medium">{t("bulkTitle", { count: selectedIds.length })}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t("bulkHint")}</p>
          <div className="mt-2">
            <SkillPicker value={bulkSkills} onChange={setBulkSkills} options={availableSkills} emptyHint={t("noQueueSkills")} ariaLabel={t("bulkSkillsLabel")} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" className="min-h-11 text-foreground" onClick={() => void handleBulk("add")} disabled={bulkSkills.length === 0 || savingIds.length > 0} data-testid="routing-agent-bulk-add">{t("bulkAdd", { count: selectedIds.length })}</Button>
            <Button type="button" variant="outline" className="min-h-11" onClick={() => void handleBulk("remove")} disabled={bulkSkills.length === 0 || savingIds.length > 0} data-testid="routing-agent-bulk-remove">{t("bulkRemove", { count: selectedIds.length })}</Button>
            <Button type="button" variant="ghost" className="min-h-11" onClick={() => setSelectedIds([])}>{t("clearSelection")}</Button>
          </div>
        </div>
      )}

      {loading ? (
        <div aria-busy="true" className="space-y-2 p-3" data-testid="routing-agents-loading">{Array.from({ length: 5 }, (_, index) => <div key={index} className="h-16 animate-pulse rounded-lg bg-muted/30 motion-reduce:animate-none" />)}</div>
      ) : error ? (
        <div role="alert" className="flex min-h-48 flex-col items-center justify-center p-5 text-center" data-testid="routing-agents-error"><AlertCircle className="h-7 w-7 text-destructive" /><p className="mt-2 text-sm font-medium">{error}</p>{errorRetryable && <Button variant="outline" className="mt-3 min-h-11" onClick={onRetry} data-testid="routing-agents-retry">{t("retry")}</Button>}</div>
      ) : agents.length === 0 ? (
        <p className="p-6 text-center text-sm text-muted-foreground" data-testid="routing-agents-empty">{t("noAgents")}</p>
      ) : visibleAgents.length === 0 ? (
        <div className="p-6 text-center" data-testid="routing-agents-no-results"><p className="text-sm font-medium">{t("noAgentResults")}</p><Button variant="ghost" className="mt-2 min-h-11" onClick={() => { setQuery(""); setFilter("all") }} data-testid="routing-agents-reset">{t("resetFilters")}</Button></div>
      ) : (
        <div>
          {canWrite && <div className="flex min-h-11 items-center gap-1 border-b px-1 pr-3 text-xs text-muted-foreground"><RoutingCheckbox checked={allVisibleSelected} onChange={() => setSelectedIds(allVisibleSelected ? selectedIds.filter((id) => !visibleAgents.some((agent) => agent.id === id)) : Array.from(new Set([...selectedIds, ...visibleAgents.map((agent) => agent.id)])))} label={t("selectVisible", { count: visibleAgents.length })} testId="routing-agents-select-visible" />{t("selectVisible", { count: visibleAgents.length })}</div>}
          <div className="divide-y">
            {visibleAgents.map((agent) => {
              const eligible = selectedQueue ? agentEligibleForQueue(agent, selectedQueue) : false
              const saving = savingIds.includes(agent.id)
              const expanded = expandedAgentId === agent.id
              return (
                <article key={agent.id} className="p-3" data-testid="routing-agent-row" data-agent-id={agent.id}>
                  <div className="flex min-h-11 items-start gap-3">
                    {canWrite && <RoutingCheckbox checked={selectedIds.includes(agent.id)} onChange={() => setSelectedIds((current) => current.includes(agent.id) ? current.filter((id) => id !== agent.id) : [...current, agent.id])} label={t("selectAgentNamed", { name: agent.name })} testId={`routing-agent-select-${agent.id}`} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><h3 className="truncate text-sm font-medium">{agent.name}</h3><span className="text-xs text-muted-foreground">{t.has(`roleLabels.${agent.role}`) ? t(`roleLabels.${agent.role}`) : t("roleLabels.other")}</span>{selectedQueue && <span className="text-xs">{eligible ? t("eligible") : t("notEligible")}</span>}{(!agent.isActive || !agent.isAvailable) && <span className="text-xs text-muted-foreground">{agent.isActive ? t("unavailable") : t("inactiveAgent")}</span>}{saving && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-label={t("savingSkills")} />}</div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{agent.skills.length > 0 ? normalizeRoutingSkills(agent.skills).join(", ") : t("agentNoSkills")}</p>
                      {canWrite && <Button type="button" variant="ghost" className="mt-1 min-h-11 px-2" aria-expanded={expanded} aria-controls={`agent-skills-${agent.id}`} onClick={() => setExpandedAgentId(expanded ? null : agent.id)} data-testid={`routing-agent-edit-skills-${agent.id}`}><ChevronDown className={`transition-transform motion-reduce:transition-none ${expanded ? "rotate-180" : ""}`} />{expanded ? t("closeSkillEditor") : t("editAgentSkills")}</Button>}
                      {expanded && <div id={`agent-skills-${agent.id}`} className="mt-2 rounded-lg border bg-muted/10 p-3" data-testid="routing-agent-skill-editor"><SkillPicker value={agent.skills} onChange={(skills) => handleIndividual(agent, skills)} options={availableSkills} emptyHint={t("agentNoSkills")} ariaLabel={t("skillsForAgent", { name: agent.name })} disabled={!canWrite || savingIds.length > 0} /></div>}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      )}
      {!canWrite && !loading && !error && <p className="border-t p-3 text-xs text-muted-foreground">{t("readOnlyHint")}</p>}
    </section>
  )
}
