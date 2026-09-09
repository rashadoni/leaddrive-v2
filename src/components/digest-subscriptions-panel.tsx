"use client"

import { useEffect, useMemo, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Users, Save, Send, CheckCircle2, XCircle } from "lucide-react"

type DigestType = "daily_briefing" | "anomaly_alert" | "renewal"
type Frequency = "off" | "daily" | "every_2_days" | "weekly" | "monthly"
type Channel = "email" | "in_app" | "telegram" | "slack"

interface SubscriptionRow {
  type: DigestType
  frequency: Frequency
  channels: Channel[]
  isActive: boolean
  lastSentAt: string | null
  configured: boolean
}

interface UserWithSubs {
  user: { id: string; name: string | null; email: string; role: string; preferredLanguage: string | null }
  subscriptions: SubscriptionRow[]
}

const TYPE_ICONS: Record<DigestType, string> = {
  daily_briefing: "📊",
  anomaly_alert:  "⚠️",
  renewal:        "📅",
}

const TYPE_KEYS: Record<DigestType, string> = {
  daily_briefing: "typeDailyBriefing",
  anomaly_alert:  "typeAnomalyAlert",
  renewal:        "typeRenewal",
}

const FREQ_KEYS: Record<Frequency, string> = {
  off:          "freqOff",
  daily:        "freqDaily",
  every_2_days: "freqEvery2Days",
  weekly:       "freqWeekly",
  monthly:      "freqMonthly",
}

// email / telegram / slack are brand names kept verbatim; in_app is localized via t("channelInApp")
const CHANNEL_LABELS: Record<Exclude<Channel, "in_app">, string> = {
  email:    "Email",
  telegram: "Telegram",
  slack:    "Slack",
}

export function DigestSubscriptionsPanel() {
  const { data: session } = useSession()
  const t = useTranslations("briefingSubscriptions")
  const locale = useLocale()
  const dateLocale = locale === "ru" ? "ru-RU" : locale === "az" ? "az" : "en-US"
  const orgId = session?.user?.organizationId
  const role = (session?.user as { role?: string })?.role || "viewer"
  const canEdit = role === "admin" || role === "superadmin"

  const [rows, setRows] = useState<UserWithSubs[]>([])
  const [types, setTypes] = useState<DigestType[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<{ userId: string; type: DigestType; deliveries: Array<{ channel: string; ok: boolean; error?: string }> } | null>(null)

  const headers = useMemo(
    () => (orgId ? { "x-organization-id": String(orgId) } : ({} as Record<string, string>)),
    [orgId],
  )

  useEffect(() => {
    if (!orgId) return
    fetch("/api/v1/digest-subscriptions", { headers })
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          setRows(j.data.users)
          setTypes(j.data.types)
        }
      })
      .finally(() => setLoading(false))
  }, [orgId, headers])

  const updateRow = (userId: string, type: DigestType, patch: Partial<SubscriptionRow>) => {
    setRows((prev) =>
      prev.map((r) =>
        r.user.id === userId
          ? {
              ...r,
              subscriptions: r.subscriptions.map((s) =>
                s.type === type ? { ...s, ...patch, configured: true } : s,
              ),
            }
          : r,
      ),
    )
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      const flat: Array<{ userId: string; type: DigestType; frequency: Frequency; channels: Channel[]; isActive: boolean }> = []
      for (const r of rows) {
        for (const s of r.subscriptions) {
          flat.push({
            userId: r.user.id,
            type: s.type,
            frequency: s.frequency,
            channels: s.channels,
            isActive: s.isActive,
          })
        }
      }
      const res = await fetch("/api/v1/digest-subscriptions", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ subscriptions: flat }),
      })
      if (res.ok) {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async (userId: string, type: DigestType) => {
    setTesting(`${userId}:${type}`)
    setTestResult(null)
    try {
      const res = await fetch("/api/v1/digest-subscriptions/test", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ userId, type }),
      })
      const json = await res.json()
      if (json.success) setTestResult({ userId, type, deliveries: json.deliveries })
    } finally {
      setTesting(null)
    }
  }

  const toggleChannel = (userId: string, type: DigestType, channel: Channel, on: boolean) => {
    const row = rows.find((r) => r.user.id === userId)
    const sub = row?.subscriptions.find((s) => s.type === type)
    if (!sub) return
    const next: Channel[] = on
      ? Array.from(new Set([...sub.channels, channel]))
      : sub.channels.filter((c) => c !== channel)
    updateRow(userId, type, { channels: next })
  }

  return (
    <Card className="mb-6">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" /> {t("title")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t("description")}
        </p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">{t("loading")}</div>
        ) : rows.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">{t("noUsers")}</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium min-w-[180px]">{t("colUser")}</th>
                    {types.map((ty) => (
                      <th key={ty} className="text-left py-2 px-3 font-medium">
                        <span className="mr-1">{TYPE_ICONS[ty]}</span>
                        {t(TYPE_KEYS[ty] as Parameters<typeof t>[0])}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.user.id} className="border-b last:border-b-0 align-top">
                      <td className="py-3 pr-3">
                        <div className="font-medium text-foreground">{r.user.name || r.user.email}</div>
                        <div className="text-[11px] text-muted-foreground">{r.user.email}</div>
                        <Badge variant="outline" className="text-[9px] mt-1">{r.user.role}</Badge>
                      </td>
                      {r.subscriptions.map((s) => {
                        const testKey = `${r.user.id}:${s.type}`
                        const tr = testResult && testResult.userId === r.user.id && testResult.type === s.type ? testResult : null
                        return (
                          <td key={s.type} className="py-3 px-3">
                            <div className="space-y-2">
                              {/* Frequency dropdown */}
                              <select
                                value={s.frequency}
                                onChange={(e) => updateRow(r.user.id, s.type, { frequency: e.target.value as Frequency })}
                                disabled={!canEdit}
                                className="h-7 text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 bg-background w-full"
                              >
                                {(["off","daily","every_2_days","weekly","monthly"] as Frequency[]).map((f) => (
                                  <option key={f} value={f}>{t(FREQ_KEYS[f] as Parameters<typeof t>[0])}</option>
                                ))}
                              </select>

                              {/* Channel checkboxes */}
                              {s.frequency !== "off" && (
                                <div className="flex flex-wrap gap-1">
                                  {(["email","in_app","telegram","slack"] as Channel[]).map((ch) => (
                                    <label
                                      key={ch}
                                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-zinc-200 dark:border-zinc-700 text-[10px] cursor-pointer ${
                                        s.channels.includes(ch)
                                          ? "bg-primary/10 border-primary text-primary"
                                          : "bg-background border-zinc-200 dark:border-zinc-700 text-muted-foreground hover:bg-muted"
                                      }`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={s.channels.includes(ch)}
                                        onChange={(e) => toggleChannel(r.user.id, s.type, ch, e.target.checked)}
                                        disabled={!canEdit}
                                        className="h-3 w-3"
                                      />
                                      {ch === "in_app" ? t("channelInApp") : CHANNEL_LABELS[ch]}
                                    </label>
                                  ))}
                                </div>
                              )}

                              {/* Test button + last result */}
                              {canEdit && s.frequency !== "off" && (
                                <button
                                  type="button"
                                  onClick={() => sendTest(r.user.id, s.type)}
                                  disabled={testing === testKey}
                                  className="text-[10px] text-primary hover:underline disabled:opacity-50"
                                >
                                  {testing === testKey ? t("testing") : t("test")}
                                </button>
                              )}
                              {tr && (
                                <div className="text-[10px] space-y-0.5">
                                  {tr.deliveries.map((d, i) => (
                                    <div key={i} className={d.ok ? "text-green-600" : "text-red-500"}>
                                      {d.ok ? "✓" : "✗"} {d.channel}{d.error ? ` — ${d.error.slice(0, 40)}` : ""}
                                    </div>
                                  ))}
                                </div>
                              )}

                              {s.lastSentAt && (
                                <div className="text-[10px] text-muted-foreground">
                                  {t("lastSent")} {new Date(s.lastSentAt).toLocaleDateString(dateLocale)}
                                </div>
                              )}
                            </div>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {canEdit && (
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" onClick={save} disabled={saving}>
                  {saving ? (
                    t("saving")
                  ) : (
                    <>
                      <Save className="h-3.5 w-3.5 mr-1" /> {t("save")}
                    </>
                  )}
                </Button>
                {saved && (
                  <span className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {t("saved")}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
