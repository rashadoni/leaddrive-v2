"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Clock, Loader2, Check } from "lucide-react"

/**
 * Self-serve settings for the 24h-silence auto-follow-up. Reads/writes
 * /api/v1/settings/inbox-followup (org `inboxFollowUp` flag + the chatwoot channel's
 * followUpMessage). Mirrors the engine in src/lib/inbox/followup-cron.ts; the fixed rules
 * (24h silence, 09:00–21:00 AZT, one nudge per conversation) are shown read-only.
 */
export function InboxFollowupSettings() {
  const { data: session, status } = useSession()
  const t = useTranslations("settings")
  const orgId = session?.user?.organizationId
  const authHeaders = (): Record<string, string> => (orgId ? { "x-organization-id": String(orgId) } : {})

  const [enabled, setEnabled] = useState(false)
  const [message, setMessage] = useState("")
  const [channelConnected, setChannelConnected] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  useEffect(() => {
    if (status === "loading") return
    fetch("/api/v1/settings/inbox-followup", { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((j) => {
        if (j.data) {
          setEnabled(!!j.data.enabled)
          setMessage(j.data.message ?? "")
          setChannelConnected(j.data.channelConnected !== false)
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  const toggle = async (on: boolean) => {
    setEnabled(on) // optimistic
    const res = await fetch("/api/v1/settings/inbox-followup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ enabled: on }),
    }).catch(() => null)
    if (!res || !res.ok) setEnabled(!on) // revert on failure
  }

  const saveMessage = async () => {
    setSaving(true)
    const res = await fetch("/api/v1/settings/inbox-followup", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ message }),
    }).catch(() => null)
    setSaving(false)
    if (res && res.ok) {
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2000)
    }
  }

  return (
    <div className="border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card p-4 space-y-4">
      <div className="flex items-start gap-2">
        <Clock className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
        <div className="flex-1">
          <h2 className="font-semibold">{t("followupTitle")}</h2>
          <p className="text-sm text-muted-foreground">{t("followupDesc")}</p>
        </div>
      </div>

      {loading ? (
        <div className="h-24 bg-muted rounded animate-pulse" />
      ) : (
        <>
          {/* Master toggle — the org-level inboxFollowUp flag the cron self-gates on. */}
          <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">{t("followupEnabledLabel")}</p>
              <p className="text-xs text-muted-foreground">{t("followupHint")}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={toggle} />
          </div>

          {!channelConnected && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{t("followupNoChannel")}</p>
          )}

          {/* Nudge text */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">{t("followupTextLabel")}</label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("followupTextPlaceholder")}
              rows={4}
              maxLength={1000}
              disabled={!enabled}
            />
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{t("followupTextBlankHint")}</p>
              <Button size="sm" onClick={saveMessage} disabled={saving || !enabled}>
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
        </>
      )}
    </div>
  )
}
