"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, Network } from "lucide-react"

import { HelpButton } from "@/components/help/help-button"
import { AgentSkillsManager } from "@/components/support/agent-skills-manager"
import { QueueManager } from "@/components/support/queue-manager"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { Button } from "@/components/ui/button"
import {
  normalizeRoutingSkills,
  routingCoverage,
  type RoutingAgent,
  type RoutingQueue,
} from "@/lib/skill-routing/presentation"

type MobileView = "queues" | "agents"

export default function SkillRoutingPage() {
  const t = useTranslations("skillRouting")
  useAutoTour("skillRouting")
  const [queues, setQueues] = useState<RoutingQueue[]>([])
  const [agents, setAgents] = useState<RoutingAgent[]>([])
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null)
  const [mobileView, setMobileView] = useState<MobileView>("queues")
  const [queuesLoading, setQueuesLoading] = useState(true)
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [queuesError, setQueuesError] = useState("")
  const [agentsError, setAgentsError] = useState("")
  const [queueCanWrite, setQueueCanWrite] = useState(false)
  const [agentCanWrite, setAgentCanWrite] = useState(false)

  const loadQueues = useCallback(async () => {
    setQueuesLoading(true)
    setQueuesError("")
    try {
      const response = await fetch("/api/v1/ticket-queues")
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.data)) throw new Error(t("queuesLoadFailed"))
      setQueues(payload.data)
      setQueueCanWrite(Boolean(payload.permissions?.canWrite))
    } catch {
      setQueuesError(t("queuesLoadFailed"))
    } finally {
      setQueuesLoading(false)
    }
  }, [t])

  const loadAgents = useCallback(async () => {
    setAgentsLoading(true)
    setAgentsError("")
    try {
      const response = await fetch("/api/v1/skill-routing/agents", {
        headers: { "x-skill-routing-view": "routing" },
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok || !Array.isArray(payload?.data)) throw new Error(t("agentsLoadFailed"))
      setAgents(payload.data)
      setAgentCanWrite(Boolean(payload.permissions?.canWrite))
    } catch {
      setAgentsError(t("agentsLoadFailed"))
    } finally {
      setAgentsLoading(false)
    }
  }, [t])

  useEffect(() => {
    void Promise.allSettled([loadQueues(), loadAgents()])
  }, [loadAgents, loadQueues])

  useEffect(() => {
    if (queues.length === 0) {
      setSelectedQueueId(null)
      return
    }
    if (!selectedQueueId || !queues.some((queue) => queue.id === selectedQueueId)) {
      setSelectedQueueId(queues[0].id)
    }
  }, [queues, selectedQueueId])

  const selectedQueue = queues.find((queue) => queue.id === selectedQueueId) ?? null
  const coverage = useMemo(() => routingCoverage(queues, agents), [agents, queues])
  const availableSkills = useMemo(() => normalizeRoutingSkills([
    ...queues.flatMap((queue) => queue.skills),
    ...agents.flatMap((agent) => agent.skills),
  ]), [agents, queues])
  const partial = Boolean(queuesError) !== Boolean(agentsError) && !queuesLoading && !agentsLoading

  const selectQueue = (id: string) => {
    setSelectedQueueId(id)
    setMobileView("agents")
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start gap-3">
        <Network className="mt-0.5 h-5 w-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><h1 data-tour-id="sr-header" className="text-xl font-semibold tracking-tight">{t("title")}</h1><TourReplayButton tourId="skillRouting" /><HelpButton slug="skill-routing" /></div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("subtitleCompact")}</p>
        </div>
      </header>

      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="min-h-11 cursor-pointer py-2 font-medium">{t("howItWorksTitle")}</summary>
        <p className="pb-2 text-muted-foreground">{t("howItWorksBody")}</p>
      </details>

      <section aria-label={t("coverageTitle")} className="grid divide-y rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-3"><p className="text-lg font-semibold tabular-nums">{coverage.activeQueues.length}</p><p className="text-xs text-muted-foreground">{t("activeQueuesSummary")}</p></div>
        <div className="p-3"><p className="text-lg font-semibold tabular-nums">{coverage.uncoveredQueues.length}</p><p className="text-xs text-muted-foreground">{t("uncoveredQueuesSummary")}</p></div>
        <div className="p-3"><p className="text-lg font-semibold tabular-nums">{coverage.agentsWithoutSkills.length}</p><p className="text-xs text-muted-foreground">{t("agentsWithoutSkillsSummary")}</p></div>
      </section>

      {partial && <div role="status" className="flex items-start gap-2 rounded-lg border p-3 text-sm"><AlertCircle className="mt-0.5 h-4 w-4 text-muted-foreground" /><div><p className="font-medium">{t("partialDataTitle")}</p><p className="text-muted-foreground">{queuesError ? t("partialQueuesMissing") : t("partialAgentsMissing")}</p></div></div>}

      {!queueCanWrite && !agentCanWrite && !queuesLoading && !agentsLoading && !queuesError && !agentsError && <p className="rounded-lg border p-3 text-sm text-muted-foreground">{t("readOnlyHint")}</p>}

      <div className="grid grid-cols-2 gap-2 lg:hidden" role="tablist" aria-label={t("mobileViews")}>
        <Button type="button" role="tab" aria-selected={mobileView === "queues"} variant={mobileView === "queues" ? "secondary" : "outline"} className="min-h-11" onClick={() => setMobileView("queues")}>{t("queuesTab")}</Button>
        <Button type="button" role="tab" aria-selected={mobileView === "agents"} variant={mobileView === "agents" ? "secondary" : "outline"} className="min-h-11" onClick={() => setMobileView("agents")}>{t("agentsTab")}</Button>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <div data-tour-id="sr-queues" className={mobileView === "queues" ? "block" : "hidden lg:block"}>
          <QueueManager queues={queues} agents={agents} selectedQueueId={selectedQueueId} canWrite={queueCanWrite} loading={queuesLoading} error={queuesError} onSelect={selectQueue} onRetry={() => void loadQueues()} onQueuesChange={setQueues} onReload={() => void loadQueues()} />
        </div>
        <div data-tour-id="sr-agents" className={mobileView === "agents" ? "block" : "hidden lg:block"}>
          <AgentSkillsManager agents={agents} selectedQueue={selectedQueue} availableSkills={availableSkills} canWrite={agentCanWrite} loading={agentsLoading} error={agentsError} onRetry={() => void loadAgents()} onAgentsChange={setAgents} />
        </div>
      </div>
    </div>
  )
}
