"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  INBOX_QUALIFICATION_BOARD_PREFIX,
  INBOX_QUALIFICATION_FLAG,
} from "@/lib/chatbot-engine"
import { OMNICHANNEL_AI_FEATURE } from "@/lib/ai/feature-keys"
import {
  loadOrganizationFeatures,
  updateOrganizationFeature,
} from "@/lib/client/organization-features"
import { InboxAgentEditorView, type InboxAgent } from "@/components/settings/inbox-agent-editor-view"

/**
 * Inbox AI agent persona editor — writes `AiAgentConfig(agentType="inbox")` (the
 * Communication group's own agent, distinct from the CRM "general" chat agent that
 * `lib/social/ai-autoreply.ts generateChannelAiReply` reads). Plus the master switch
 * (`Organization.features` "aiAutoReply") that the engine self-gates on. For AI to
 * actually answer a channel you need: this master ON + the channel set to "AI" in the
 * matrix below + (optional) a custom persona here.
 *
 * This is the container: it loads and saves for the signed-in tenant. What the
 * card looks like is `InboxAgentEditorView` (./inbox-agent-editor-view.tsx),
 * which the guided demo renders too.
 */

const DEFAULTS: InboxAgent = {
  systemPrompt: "",
  knowledgeBase: "",
  // "" = follow the customer, which is what every agent did before this
  // setting existed.
  replyLanguage: "",
  model: "claude-sonnet-4-6",
  temperature: 0.7,
  escalationEnabled: true,
  greeting: "",
  // Lead creation requires an explicitly selected board. Keep new/unconfigured
  // agents fail-closed so this optional feature cannot block persona saves.
  autoLeadEnabled: false,
  autoAssignSales: true,
  autonomousBacklogEnabled: false,
  autonomousLookbackDays: 7,
  autonomousBatchSize: 20,
}

export function isAutoLeadConfigured(configEnabled: boolean, features: string[]): boolean {
  return configEnabled
    && features.includes(INBOX_QUALIFICATION_FLAG)
    && features.some((feature) =>
      feature.startsWith(INBOX_QUALIFICATION_BOARD_PREFIX)
      && feature.length > INBOX_QUALIFICATION_BOARD_PREFIX.length,
    )
}

export function InboxAgentEditor() {
  const { data: session, status } = useSession()
  const t = useTranslations("settings")
  const orgId = session?.user?.organizationId
  const authHeaders = (): Record<string, string> => (orgId ? { "x-organization-id": String(orgId) } : {})

  const [aiOn, setAiOn] = useState(false)
  const [agent, setAgent] = useState<InboxAgent>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [boards, setBoards] = useState<{ id: string; name: string; isDepartment?: boolean }[]>([])
  const [qualificationBoardId, setQualificationBoardId] = useState("")
  const [loadedFeatures, setLoadedFeatures] = useState<string[]>([])

  useEffect(() => {
    if (status === "loading") return
    Promise.all([
      loadOrganizationFeatures(orgId ? String(orgId) : undefined).catch((): string[] => []),
      fetch("/api/v1/ai-configs", { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { data: { configs: [] } })),
      fetch("/api/v1/divisions", { headers: authHeaders() }).then((r) => (r.ok ? r.json() : { data: { divisions: [] } })),
    ])
      .then(([features, cfg, divisionResponse]) => {
        setLoadedFeatures(features)
        setAiOn(features.includes(OMNICHANNEL_AI_FEATURE))
        const boardFlag = features.find((feature) => feature.startsWith(INBOX_QUALIFICATION_BOARD_PREFIX))
        setQualificationBoardId(boardFlag?.slice(INBOX_QUALIFICATION_BOARD_PREFIX.length) ?? "")
        setBoards((divisionResponse.data?.divisions ?? []).filter(
          (division: { isDepartment?: boolean }) => division.isDepartment !== true,
        ))
        const inbox = (cfg.data?.configs ?? []).find((c: { agentType?: string }) => c.agentType === "inbox")
        if (inbox) {
          setAgent({
            id: inbox.id,
            systemPrompt: inbox.systemPrompt ?? "",
            knowledgeBase: inbox.knowledgeBase ?? "",
            replyLanguage: inbox.replyLanguage ?? "",
            model: inbox.model ?? DEFAULTS.model,
            temperature: typeof inbox.temperature === "number" ? inbox.temperature : DEFAULTS.temperature,
            escalationEnabled: inbox.escalationEnabled !== false,
            greeting: inbox.greeting ?? "",
            // A previous interrupted save can leave the config enabled without
            // its required feature/board flags. Treat that incomplete state as
            // disabled so ordinary model/persona settings remain saveable.
            autoLeadEnabled: isAutoLeadConfigured(inbox.autoLeadEnabled === true, features),
            autoAssignSales: inbox.autoAssignSales !== false,
            autonomousBacklogEnabled: inbox.autonomousBacklogEnabled === true,
            autonomousLookbackDays: typeof inbox.autonomousLookbackDays === "number"
              ? inbox.autonomousLookbackDays
              : DEFAULTS.autonomousLookbackDays,
            autonomousBatchSize: typeof inbox.autonomousBatchSize === "number"
              ? inbox.autonomousBatchSize
              : DEFAULTS.autonomousBatchSize,
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const toggleAi = async (on: boolean) => {
    setAiOn(on) // optimistic
    try {
      const features = await updateOrganizationFeature(
        OMNICHANNEL_AI_FEATURE,
        on,
        orgId ? String(orgId) : undefined,
      )
      setAiOn(features.includes(OMNICHANNEL_AI_FEATURE))
    } catch {
      setAiOn(!on) // revert on failure
    }
  }

  const importInputRef = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  const exportAgent = () => {
    // Straight to the endpoint: it sets the filename and forbids caching, and a
    // configuration snapshot served from a cache is worse than none.
    window.location.href = "/api/v1/ai-configs/transfer?agentType=inbox"
  }

  const importAgent = async (file: File) => {
    setImporting(true)
    try {
      const text = await file.text()
      let document: unknown
      try {
        document = JSON.parse(text)
      } catch {
        toast.error(t("importNotJson"))
        return
      }
      const res = await fetch("/api/v1/ai-configs/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(document),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        // The endpoint's message says exactly what is wrong with the file —
        // a generic failure would send the operator back to guessing.
        toast.error(json?.error || t("importFailed"))
        return
      }
      for (const warning of json?.data?.warnings ?? []) toast.warning(warning)
      toast.success(t("importDone"))
      // Reload rather than patch local state: after an import the screen must
      // show what was actually stored, not what we hoped to store.
      window.location.reload()
    } finally {
      setImporting(false)
    }
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    if (agent.autoLeadEnabled && !qualificationBoardId) {
      setError(t("autonomyBoardRequired"))
      setSaving(false)
      return
    }
    const payload = {
      configName: "Inbox AI Agent",
      agentType: "inbox",
      isActive: true,
      systemPrompt: agent.systemPrompt,
      knowledgeBase: agent.knowledgeBase,
      replyLanguage: agent.replyLanguage || null,
      model: agent.model,
      temperature: agent.temperature,
      escalationEnabled: agent.escalationEnabled,
      greeting: agent.greeting,
      autoLeadEnabled: agent.autoLeadEnabled,
      autoAssignSales: agent.autoAssignSales,
      autonomousBacklogEnabled: agent.autonomousBacklogEnabled,
      autonomousLookbackDays: agent.autonomousLookbackDays,
      autonomousBatchSize: agent.autonomousBatchSize,
    }
    try {
      const res = agent.id
        ? await fetch(`/api/v1/ai-configs/${agent.id}`, { method: "PATCH", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(payload) })
        : await fetch("/api/v1/ai-configs", { method: "POST", headers: { "Content-Type": "application/json", ...authHeaders() }, body: JSON.stringify(payload) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || `HTTP ${res.status}`)
        return
      }
      const wantedBoardFlag = qualificationBoardId
        ? `${INBOX_QUALIFICATION_BOARD_PREFIX}${qualificationBoardId}`
        : null
      const featureChanges: { feature: string; action: "add" | "remove" }[] = []
      const oldBoardFlags = loadedFeatures.filter((feature) =>
        feature.startsWith(INBOX_QUALIFICATION_BOARD_PREFIX),
      )
      for (const feature of oldBoardFlags) {
        if (feature !== wantedBoardFlag) featureChanges.push({ feature, action: "remove" })
      }
      if (agent.autoLeadEnabled) {
        if (!loadedFeatures.includes(INBOX_QUALIFICATION_FLAG)) {
          featureChanges.push({ feature: INBOX_QUALIFICATION_FLAG, action: "add" })
        }
        if (wantedBoardFlag && !loadedFeatures.includes(wantedBoardFlag)) {
          featureChanges.push({ feature: wantedBoardFlag, action: "add" })
        }
      } else {
        if (loadedFeatures.includes(INBOX_QUALIFICATION_FLAG)) {
          featureChanges.push({ feature: INBOX_QUALIFICATION_FLAG, action: "remove" })
        }
        for (const feature of oldBoardFlags) {
          if (!featureChanges.some((change) => change.feature === feature)) {
            featureChanges.push({ feature, action: "remove" })
          }
        }
      }
      for (const change of featureChanges) {
        await updateOrganizationFeature(
          change.feature,
          change.action === "add",
          orgId ? String(orgId) : undefined,
        )
      }
      setLoadedFeatures((current) => {
        const next = new Set(current)
        for (const change of featureChanges) {
          if (change.action === "add") next.add(change.feature)
          else next.delete(change.feature)
        }
        return [...next]
      })
      const savedId = j.data?.id
      if (savedId && !agent.id) setAgent((a) => ({ ...a, id: savedId }))
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="h-48 bg-muted rounded-lg animate-pulse" />

  return (
    <InboxAgentEditorView
      agent={agent}
      onAgentChange={(patch) => setAgent((a) => ({ ...a, ...patch }))}
      aiOn={aiOn}
      onAiOnChange={toggleAi}
      boards={boards}
      qualificationBoardId={qualificationBoardId}
      onQualificationBoardChange={setQualificationBoardId}
      saving={saving}
      savedTick={savedTick}
      error={error}
      onSave={save}
      importing={importing}
      onExport={exportAgent}
      onImport={() => importInputRef.current?.click()}
      importSlot={
        <input
          ref={importInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared immediately so choosing the SAME file twice still fires
            // a change event — otherwise a failed import cannot be retried.
            event.target.value = ""
            if (file) void importAgent(file)
          }}
        />
      }
    />
  )
}
