"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Bell, Save, Loader2 } from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"

interface NotifCategory {
  enabled: boolean
  channels: string[]
  daysBeforeDeadline?: number
}

interface Settings {
  recipientEmail: string
  overdue: NotifCategory
  advance: NotifCategory & { daysBeforeDeadline: number }
  paymentOrders: NotifCategory
  billPayments: NotifCategory
}

const DEFAULTS: Settings = {
  recipientEmail: "",
  overdue: { enabled: true, channels: ["telegram"] },
  advance: { enabled: true, channels: ["telegram"], daysBeforeDeadline: 7 },
  paymentOrders: { enabled: true, channels: ["telegram"] },
  billPayments: { enabled: true, channels: ["telegram"] },
}

export default function FinanceNotificationsPage() {
  const t = useTranslations("finance.notif")
  useAutoTour("financeNotifications")
  const { data: session } = useSession()
  const orgId = (session?.user as any)?.organizationId || ""
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const CHANNELS = [
    { key: "telegram", label: t("telegram"), desc: t("telegramDesc") },
    { key: "inApp", label: t("inApp"), desc: t("inAppDesc") },
    { key: "email", label: t("email"), desc: t("emailDesc") },
  ]

  const DAY_OPTIONS = [
    { value: 1, label: t("oneDay") },
    { value: 3, label: t("threeDays") },
    { value: 7, label: t("sevenDays") },
    { value: 14, label: t("fourteenDays") },
  ]

  useEffect(() => {
    if (!orgId) return
    fetch("/api/finance/payment-orders/notification-settings", {
      headers: { "x-organization-id": orgId },
    })
      .then((r) => r.json())
      .then((json) => setSettings({ ...DEFAULTS, ...json.data }))
      .finally(() => setLoading(false))
  }, [orgId])

  const handleSave = async () => {
    setSaving(true)
    setSaved(false)
    await fetch("/api/finance/payment-orders/notification-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      body: JSON.stringify(settings),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const toggleEnabled = (key: keyof Omit<Settings, "recipientEmail">) => {
    setSettings((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }))
  }

  const toggleChannel = (key: keyof Omit<Settings, "recipientEmail">, channel: string) => {
    setSettings((prev) => {
      const cat = prev[key]
      const channels = cat.channels.includes(channel)
        ? cat.channels.filter((c) => c !== channel)
        : [...cat.channels, channel]
      return { ...prev, [key]: { ...cat, channels } }
    })
  }

  const setDays = (days: number) => {
    setSettings((prev) => ({
      ...prev,
      advance: { ...prev.advance, daysBeforeDeadline: days },
    }))
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 data-tour-id="fin-notif-header" className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="financeNotifications" /><HelpButton slug="finance-notifications" variant="label" /></h1>
          <p className="text-sm text-muted-foreground mt-1">{t("description")}</p>
        </div>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
          {saved ? t("saved") : t("save")}
        </Button>
      </div>

      {/* Recipient Email */}
      <Card>
        <CardContent className="pt-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium">{t("recipientEmail")}</Label>
            <p className="text-xs text-muted-foreground">{t("recipientEmailDesc")}</p>
            <Input
              type="email"
              value={settings.recipientEmail}
              onChange={(e) => setSettings((prev) => ({ ...prev, recipientEmail: e.target.value }))}
              placeholder={t("recipientEmailPlaceholder")}
              className="max-w-md"
            />
          </div>
        </CardContent>
      </Card>

      {/* Overdue */}
      <NotifSection
        title={t("overduePayments")}
        desc={t("overdueDesc")}
        category={settings.overdue}
        channels={CHANNELS}
        onToggle={() => toggleEnabled("overdue")}
        onToggleChannel={(ch) => toggleChannel("overdue", ch)}
      />

      {/* Advance Warning */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-amber-600" />
              <div>
                <CardTitle className="text-base">{t("advanceWarning")}</CardTitle>
                <p className="text-sm text-muted-foreground">{t("advanceDesc")}</p>
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input type="checkbox" checked={settings.advance.enabled} onChange={() => toggleEnabled("advance")} className="sr-only peer" />
              <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>
        </CardHeader>
        {settings.advance.enabled && (
          <CardContent className="space-y-4">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">{t("daysBeforeDeadline")}</Label>
              <div className="flex gap-2 mt-2">
                {DAY_OPTIONS.map(({ value, label }) => (
                  <Button key={value} size="sm" variant={settings.advance.daysBeforeDeadline === value ? "default" : "outline"} className="h-8" onClick={() => setDays(value)}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
            <ChannelToggles channels={settings.advance.channels} channelList={CHANNELS} onToggle={(ch) => toggleChannel("advance", ch)} label={t("deliveryChannels")} />
          </CardContent>
        )}
      </Card>

      {/* Payment Orders */}
      <NotifSection
        title={t("paymentOrders")}
        desc={t("paymentOrdersDesc")}
        category={settings.paymentOrders}
        channels={CHANNELS}
        onToggle={() => toggleEnabled("paymentOrders")}
        onToggleChannel={(ch) => toggleChannel("paymentOrders", ch)}
      />

      {/* Bill Payments */}
      <NotifSection
        title={t("billPayments")}
        desc={t("billPaymentsDesc")}
        category={settings.billPayments}
        channels={CHANNELS}
        onToggle={() => toggleEnabled("billPayments")}
        onToggleChannel={(ch) => toggleChannel("billPayments", ch)}
      />
    </div>
  )
}

function NotifSection({ title, desc, category, channels, onToggle, onToggleChannel }: {
  title: string; desc: string; category: NotifCategory
  channels: { key: string; label: string; desc: string }[]
  onToggle: () => void; onToggleChannel: (ch: string) => void
}) {
  const t = useTranslations("finance.notif")
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Bell className="w-5 h-5 text-blue-600" />
            <div>
              <CardTitle className="text-base">{title}</CardTitle>
              <p className="text-sm text-muted-foreground">{desc}</p>
            </div>
          </div>
          <label className="relative inline-flex items-center cursor-pointer">
            <input type="checkbox" checked={category.enabled} onChange={onToggle} className="sr-only peer" />
            <div className="w-11 h-6 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:after:translate-x-full" />
          </label>
        </div>
      </CardHeader>
      {category.enabled && (
        <CardContent>
          <ChannelToggles channels={category.channels} channelList={channels} onToggle={onToggleChannel} label={t("deliveryChannels")} />
        </CardContent>
      )}
    </Card>
  )
}

function ChannelToggles({ channels, channelList, onToggle, label }: {
  channels: string[]; channelList: { key: string; label: string; desc: string }[]
  onToggle: (ch: string) => void; label: string
}) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="space-y-2 mt-2">
        {channelList.map(({ key, label, desc }) => (
          <label key={key} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 cursor-pointer transition-colors">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{desc}</p>
            </div>
            <input type="checkbox" checked={channels.includes(key)} onChange={() => onToggle(key)} className="rounded border-zinc-200 dark:border-zinc-700 w-4 h-4" />
          </label>
        ))}
      </div>
    </div>
  )
}
