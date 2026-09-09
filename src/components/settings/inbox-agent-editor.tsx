"use client"

import { useEffect, useRef, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Bot, Loader2, Check, History, UserRoundCheck, Workflow, Download, Upload } from "lucide-react"
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

/**
 * Inbox AI agent persona editor — writes `AiAgentConfig(agentType="inbox")` (the
 * Communication group's own agent, distinct from the CRM "general" chat agent that
 * `lib/social/ai-autoreply.ts generateChannelAiReply` reads). Plus the master switch
 * (`Organization.features` "aiAutoReply") that the engine self-gates on. For AI to
 * actually answer a channel you need: this master ON + the channel set to "AI" in the
 * matrix below + (optional) a custom persona here.
 */

const MODELS = [
  { value: "claude-haiku-4-5-20251001", labelKey: "modelHaiku" },
  { value: "claude-sonnet-4-6", labelKey: "modelSonnet" },
  { value: "claude-opus-4-8", labelKey: "modelOpus" },
]

interface InboxAgent {
  id?: string
  systemPrompt: string
  knowledgeBase: string
  replyLanguage: string
  model: string
  temperature: number
  escalationEnabled: boolean
  greeting: string
  autoLeadEnabled: boolean
  autoAssignSales: boolean
  autonomousBacklogEnabled: boolean
  autonomousLookbackDays: number
  autonomousBatchSize: number
}

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
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card p-4 space-y-5">
      <div className="flex items-start gap-2">
        <Bot className="h-5 w-5 text-violet-500 mt-0.5 shrink-0" />
        <div>
          <h2 className="font-semibold">{t("personaTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("personaDesc")}</p>
        </div>
      </div>

      {/* Master switch — the org-level aiAutoReply flag the engine self-gates on. */}
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-3 bg-muted/30">
        <div className="pr-3">
          <Label className="font-medium">{t("aiMasterToggle")}</Label>
          <p className="text-xs text-muted-foreground">{t("aiMasterHint")}</p>
        </div>
        <Switch checked={aiOn} onCheckedChange={toggleAi} />
      </div>

      <div className="space-y-4">
        <div>
          <Label>{t("fieldPrompt")}</Label>
          <Textarea
            value={agent.systemPrompt}
            onChange={(e) => setAgent((a) => ({ ...a, systemPrompt: e.target.value }))}
            rows={6}
            placeholder={t("fieldPromptHint")}
            className="mt-1"
          />
        </div>

        {/* Facts live apart from behaviour, as they do for the voice agent:
            a price list changes often, the rules almost never, and mixing them
            means every content edit risks disturbing how the agent behaves. */}
        <div>
          <Label>{t("fieldKnowledge")}</Label>
          <Textarea
            value={agent.knowledgeBase}
            onChange={(e) => setAgent((a) => ({ ...a, knowledgeBase: e.target.value }))}
            rows={8}
            placeholder={t("fieldKnowledgeHint")}
            className="mt-1"
          />
          <p className="mt-1 text-xs text-muted-foreground">{t("fieldKnowledgeHelp")}</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <Label>{t("fieldModel")}</Label>
            <Select value={agent.model} onChange={(e) => setAgent((a) => ({ ...a, model: e.target.value }))} className="mt-1 w-full">
              {MODELS.map((m) => (
                <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
              ))}
            </Select>
          </div>
          <div>
            {/* A brand that answers in one language has to be able to say so.
                The default — follow the customer — is right for a mixed
                audience and wrong for a single-language brand, and until now
                there was no way to tell the two apart. */}
            <Label>{t("fieldReplyLanguage")}</Label>
            <Select
              value={agent.replyLanguage}
              onChange={(e) => setAgent((a) => ({ ...a, replyLanguage: e.target.value }))}
              className="mt-1 w-full"
            >
              <option value="">{t("replyLanguageAuto")}</option>
              <option value="az">{t("replyLanguageAz")}</option>
              <option value="ru">{t("replyLanguageRu")}</option>
              <option value="en">{t("replyLanguageEn")}</option>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">{t("fieldReplyLanguageHelp")}</p>
          </div>
          <div>
            <Label>{t("fieldTemperature")} — {agent.temperature.toFixed(1)}</Label>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={agent.temperature}
              onChange={(e) => setAgent((a) => ({ ...a, temperature: parseFloat(e.target.value) }))}
              className="mt-3 w-full accent-violet-500"
            />
          </div>
        </div>

        <div>
          <Label>{t("fieldGreeting")}</Label>
          <Input
            value={agent.greeting}
            onChange={(e) => setAgent((a) => ({ ...a, greeting: e.target.value }))}
            placeholder={t("fieldGreetingHint")}
            className="mt-1"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-zinc-200 dark:border-zinc-700 p-3">
          <div className="pr-3">
            <Label className="font-medium">{t("fieldEscalation")}</Label>
            <p className="text-xs text-muted-foreground">{t("fieldEscalationHint")}</p>
          </div>
          <Switch checked={agent.escalationEnabled} onCheckedChange={(v) => setAgent((a) => ({ ...a, escalationEnabled: v }))} />
        </div>

        <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-4 dark:border-orange-900/60 dark:bg-orange-950/20">
          <div className="flex items-start gap-2">
            <Workflow className="mt-0.5 h-5 w-5 shrink-0 text-orange-600" />
            <div>
              <h3 className="font-semibold">{t("autonomyTitle")}</h3>
              <p className="text-sm text-muted-foreground">{t("autonomyDesc")}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between rounded-lg border bg-card p-3">
              <div className="pr-3">
                <Label className="flex items-center gap-1.5 font-medium">
                  <UserRoundCheck className="h-4 w-4 text-orange-600" />
                  {t("autoLeadTitle")}
                </Label>
                <p className="text-xs leading-5 text-muted-foreground">{t("autoLeadHint")}</p>
              </div>
              <Switch
                checked={agent.autoLeadEnabled}
                onCheckedChange={(value) => setAgent((current) => ({ ...current, autoLeadEnabled: value }))}
              />
            </div>

            {agent.autoLeadEnabled && (
              <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2">
                <div>
                  <Label>{t("autonomyBoardLabel")}</Label>
                  <Select
                    value={qualificationBoardId}
                    onChange={(event) => setQualificationBoardId(event.target.value)}
                    className="mt-1 w-full"
                  >
                    <option value="">{t("autonomyBoardPlaceholder")}</option>
                    {boards.map((board) => (
                      <option key={board.id} value={board.id}>{board.name}</option>
                    ))}
                  </Select>
                  <p className="mt-1 text-xs text-muted-foreground">{t("autonomyBoardHint")}</p>
                </div>
                <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                  <div className="pr-3">
                    <Label className="font-medium">{t("autoAssignTitle")}</Label>
                    <p className="text-xs leading-5 text-muted-foreground">{t("autoAssignHint")}</p>
                  </div>
                  <Switch
                    checked={agent.autoAssignSales}
                    onCheckedChange={(value) => setAgent((current) => ({ ...current, autoAssignSales: value }))}
                  />
                </div>
              </div>
            )}

            <div className="rounded-lg border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="pr-3">
                  <Label className="flex items-center gap-1.5 font-medium">
                    <History className="h-4 w-4 text-violet-500" />
                    {t("backlogTitle")}
                  </Label>
                  <p className="text-xs leading-5 text-muted-foreground">{t("backlogHint")}</p>
                </div>
                <Switch
                  checked={agent.autonomousBacklogEnabled}
                  onCheckedChange={(value) =>
                    setAgent((current) => ({ ...current, autonomousBacklogEnabled: value }))
                  }
                />
              </div>
              {agent.autonomousBacklogEnabled && (
                <div className="mt-3 grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2">
                  <div>
                    <Label>{t("backlogDaysLabel")}</Label>
                    <Select
                      value={String(agent.autonomousLookbackDays)}
                      onChange={(event) =>
                        setAgent((current) => ({
                          ...current,
                          autonomousLookbackDays: Number(event.target.value),
                        }))
                      }
                      className="mt-1 w-full"
                    >
                      <option value="1">1</option>
                      <option value="3">3</option>
                      <option value="7">7</option>
                      <option value="14">14</option>
                      <option value="30">30</option>
                    </Select>
                  </div>
                  <div>
                    <Label>{t("backlogBatchLabel")}</Label>
                    <Select
                      value={String(agent.autonomousBatchSize)}
                      onChange={(event) =>
                        setAgent((current) => ({
                          ...current,
                          autonomousBatchSize: Number(event.target.value),
                        }))
                      }
                      className="mt-1 w-full"
                    >
                      <option value="5">5</option>
                      <option value="10">10</option>
                      <option value="20">20</option>
                      <option value="50">50</option>
                    </Select>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{t("saveError")}: {error}</p>}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving} className="gap-1.5">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {t("saveBtn")}
        </Button>
        {savedTick && !saving && (
          <span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1">
            <Check className="h-4 w-4" /> {t("saved")}
          </span>
        )}

        {/* Moving this agent to another tenant. Copying the two text boxes by
            hand looks equivalent and is not: the switches below them change
            what the engine appends to the prompt, so the same words produce a
            different assistant. The whole card travels as one file, with a
            checksum, so a partial transfer fails instead of passing quietly. */}
        <div className="ml-auto flex items-center gap-2">
          <Button type="button" variant="outline" onClick={exportAgent} className="gap-1.5">
            <Download className="h-4 w-4" /> {t("exportBtn")}
          </Button>
          <Button type="button" variant="outline" onClick={() => importInputRef.current?.click()} disabled={importing} className="gap-1.5">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            {t("importBtn")}
          </Button>
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
        </div>
      </div>
    </div>
  )
}
