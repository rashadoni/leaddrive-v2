"use client"

import { useCallback, useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Bot, Loader2, Check } from "lucide-react"

/**
 * Social Monitoring AI agent persona editor — writes AiAgentConfig(agentType="social")
 * through the omnichannel-gated /api/v1/social/agent route (NOT /ai-configs), so it
 * works without the AI Command Center / ai add-on. The persona feeds draftSocialReply.
 */
const MODELS = [
  { value: "claude-haiku-4-5-20251001", labelKey: "modelHaiku" },
  { value: "claude-sonnet-4-6", labelKey: "modelSonnet" },
  { value: "claude-opus-4-8", labelKey: "modelOpus" },
]

interface SocialAgent {
  systemPrompt: string
  model: string
  temperature: number
  greeting: string
}

const DEFAULTS: SocialAgent = {
  systemPrompt: "",
  model: "claude-haiku-4-5-20251001",
  temperature: 0.7,
  greeting: "",
}

export function SocialAgentEditor() {
  const { data: session, status } = useSession()
  const t = useTranslations("socialMonitoring")
  const orgId = session?.user?.organizationId
  const authHeaders = useCallback((): Record<string, string> =>
    orgId ? { "x-organization-id": String(orgId) } : {}, [orgId])

  const [agent, setAgent] = useState<SocialAgent>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === "loading") return
    fetch("/api/v1/social/agent", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j?.data) {
          setAgent({
            systemPrompt: j.data.systemPrompt ?? "",
            model: j.data.model ?? DEFAULTS.model,
            temperature: typeof j.data.temperature === "number" ? j.data.temperature : DEFAULTS.temperature,
            greeting: j.data.greeting ?? "",
          })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [status, authHeaders])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch("/api/v1/social/agent", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify(agent),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(j.error || `HTTP ${res.status}`)
        return
      }
      if (j?.data) {
        setAgent({
          systemPrompt: j.data.systemPrompt ?? "",
          model: j.data.model ?? DEFAULTS.model,
          temperature: typeof j.data.temperature === "number"
            ? j.data.temperature
            : DEFAULTS.temperature,
          greeting: j.data.greeting ?? "",
        })
      }
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : "error")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="rounded-xl border border-zinc-200 bg-card shadow-sm dark:border-zinc-700">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-100 dark:bg-violet-900/40">
            <Bot className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </span>
          {t("agentEditor.title")}
        </CardTitle>
        <p className="text-sm font-normal normal-case text-muted-foreground">{t("agentEditor.desc")}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-40 bg-muted rounded-lg animate-pulse" />
        ) : (
          <div className="space-y-4">
            {error && <p className="text-sm text-red-500">{error}</p>}

            <div>
              <Label>{t("agentEditor.persona")}</Label>
              <Textarea
                value={agent.systemPrompt}
                onChange={(e) => setAgent((a) => ({ ...a, systemPrompt: e.target.value }))}
                rows={6}
                placeholder={t("agentEditor.personaHint")}
                className="mt-1"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label>{t("agentEditor.model")}</Label>
                <Select value={agent.model} onChange={(e) => setAgent((a) => ({ ...a, model: e.target.value }))} className="mt-1 w-full">
                  {MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{t(`agentEditor.${m.labelKey}`)}</option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>{t("agentEditor.temperature")} — {agent.temperature.toFixed(1)}</Label>
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

            <div className="flex items-center justify-end">
              <Button onClick={save} disabled={saving} className="gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : savedTick ? <Check className="h-4 w-4" /> : null}
                {savedTick ? t("agentEditor.saved") : t("agentEditor.save")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
