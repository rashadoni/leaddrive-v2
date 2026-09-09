"use client"

/**
 * C1 (Creatio 10X roadmap) — «Web-трекинг» card for settings/integrations.
 * Owns its slice of state end-to-end: GET/PUT /api/v1/settings/web-tracking
 * (publicKey is minted lazily server-side, so the snippet is always shown).
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Activity, Copy, Check } from "lucide-react"

interface TrackingConfig {
  enabled: boolean
  publicKey: string
  allowedOrigins: string[]
  retentionDays: number
}

export function WebTrackingCard() {
  const t = useTranslations("webTracking")
  const [config, setConfig] = useState<TrackingConfig | null>(null)
  const [origins, setOrigins] = useState("")
  const [retention, setRetention] = useState("180")
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    fetch("/api/v1/settings/web-tracking")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          setConfig(j.data)
          setOrigins((j.data.allowedOrigins as string[]).join("\n"))
          setRetention(String(j.data.retentionDays))
        }
      })
      .catch(() => {})
  }, [])

  if (!config) return null

  const snippet = `<script src="${typeof window !== "undefined" ? window.location.origin : ""}/ldtrack.js" data-key="${config.publicKey}" async></script>`

  const persist = async (body: { enabled: boolean; allowedOrigins: string[]; retentionDays: number }) => {
    setSaving(true)
    setSaved(false)
    try {
      const r = await fetch("/api/v1/settings/web-tracking", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const j = await r.json()
      if (j.success) {
        setConfig(j.data)
        setOrigins((j.data.allowedOrigins as string[]).join("\n"))
        setRetention(String(j.data.retentionDays))
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      } else {
        // roll the optimistic toggle back to what the server last confirmed
        setConfig({ ...config })
      }
    } catch {
      setConfig({ ...config })
    } finally {
      setSaving(false)
    }
  }

  // Save button: persist the form as edited.
  const saveForm = () =>
    persist({
      enabled: config.enabled,
      allowedOrigins: origins.split("\n").map((s) => s.trim()).filter(Boolean),
      retentionDays: Math.min(3650, Math.max(1, Number(retention) || 180)),
    })

  // Toggle: flip ONLY enabled — unsaved textarea/retention edits stay unsaved.
  const saveEnabled = (enabled: boolean) =>
    persist({ enabled, allowedOrigins: config.allowedOrigins, retentionDays: config.retentionDays })

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard denied — user can select manually */
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-emerald-500" /> {t("title")}
        </CardTitle>
        <Switch
          checked={config.enabled}
          onCheckedChange={(v) => {
            setConfig({ ...config, enabled: v })
            void saveEnabled(v)
          }}
        />
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>

        <div>
          <Label>{t("snippetLabel")}</Label>
          <div className="mt-1 flex items-start gap-2">
            <code className="flex-1 rounded-md border bg-muted/50 px-3 py-2 text-xs break-all select-all">
              {snippet}
            </code>
            <Button size="sm" variant="outline" onClick={copySnippet} className="gap-1 shrink-0">
              {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
              {copied ? t("copied") : t("copy")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1">{t("consentHint")}</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{t("originsLabel")}</Label>
            <textarea
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[72px]"
              placeholder={"https://example.com\nhttps://www.example.com"}
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">{t("originsHint")}</p>
          </div>
          <div>
            <Label>{t("retentionLabel")}</Label>
            <Input
              type="number"
              min={1}
              max={3650}
              className="mt-1 w-32"
              value={retention}
              onChange={(e) => setRetention(e.target.value)}
            />
            <p className="text-xs text-muted-foreground mt-1">{t("retentionHint")}</p>
          </div>
        </div>

        <Button size="sm" onClick={() => void saveForm()} disabled={saving}>
          {saving ? t("saving") : saved ? t("saved") : t("save")}
        </Button>
      </CardContent>
    </Card>
  )
}
