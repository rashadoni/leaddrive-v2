"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ShieldAlert, Loader2, Check } from "lucide-react"

/**
 * Self-serve editor for the TikTok channel's escalate keywords. Reads/writes via the existing
 * /api/v1/settings/channel-reply API (escalateKeywords already round-trips there). When a
 * customer's inbound message contains one of these words, the engine (chatwoot webhook) hands
 * the conversation to a human and the AI does NOT answer — see src/lib/inbox/escalation.ts.
 */
export function InboxEscalationKeywords() {
  const { data: session, status } = useSession()
  const t = useTranslations("settings")
  const orgId = session?.user?.organizationId
  const authHeaders = (): Record<string, string> => (orgId ? { "x-organization-id": String(orgId) } : {})

  const [configId, setConfigId] = useState<string | null>(null)
  const [value, setValue] = useState("")
  const [channelConnected, setChannelConnected] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => {
    if (status === "loading") return
    fetch("/api/v1/settings/channel-reply", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { data: { channels: [] } }))
      .then((j) => {
        const ch = (j.data?.channels ?? []).find((c: { channelType?: string }) => c.channelType === "chatwoot")
        if (ch) {
          setConfigId(ch.id)
          setValue((ch.reply?.escalateKeywords ?? []).join(", "))
        } else {
          setChannelConnected(false)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const save = async () => {
    if (!configId) return
    setSaving(true)
    const keywords = [...new Set(value.split(",").map((k) => k.trim()).filter(Boolean))]
    const res = await fetch("/api/v1/settings/channel-reply", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ configId, escalateKeywords: keywords }),
    }).catch(() => null)
    setSaving(false)
    if (res && res.ok) {
      setValue(keywords.join(", ")) // normalize (dedupe/trim) on success
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2000)
    }
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-start gap-2">
        <ShieldAlert className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-semibold">{t("escalateTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("escalateDesc")}</p>
        </div>
      </div>

      {loading ? (
        <div className="h-12 bg-muted rounded animate-pulse" />
      ) : !channelConnected ? (
        <p className="text-xs text-amber-600 dark:text-amber-400">{t("followupNoChannel")}</p>
      ) : (
        <div className="space-y-1.5">
          <label className="text-sm font-medium">{t("escalateKeywordsLabel")}</label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={t("escalateKeywordsPlaceholder")} />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">{t("escalateKeywordsHint")}</p>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : savedTick ? (
                <>
                  <Check className="h-4 w-4 mr-1" /> {t("followupSaved")}
                </>
              ) : (
                t("followupSave")
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
