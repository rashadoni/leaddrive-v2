"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Bell, Save, Loader2, Send } from "lucide-react"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"
import { HelpButton } from "@/components/help/help-button"
import { PageHeader } from "@/components/page-header"
import { useFinanceAccess } from "@/lib/finance/hooks"
import {
  FINANCE_NOTIF_DEFAULTS as DEFAULTS,
  type FinanceNotifCategory as NotifCategory,
  type FinanceNotifSettings as Settings,
} from "@/lib/finance/notification-settings"

type CategoryKey = "overdue" | "advance" | "paymentOrders" | "billPayments"
type Channel = { key: string; label: string; desc: string; warn?: boolean }

const SETTINGS_URL = "/api/finance/payment-orders/notification-settings"

export default function FinanceNotificationsPage() {
  const t = useTranslations("finance.notif")
  useAutoTour("financeNotifications")
  const { data: session } = useSession()
  const orgId = (session?.user as any)?.organizationId || ""
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null)
  const { canWrite } = useFinanceAccess()

  // Telegram goes through the organization's own bot into its own chat. Until
  // both are filled in the channel sends nothing, and the checkbox says so.
  const telegramReady = Boolean(settings.telegramBotToken && settings.telegramChatId)

  const CHANNELS: Channel[] = [
    { key: "telegram", label: t("telegram"), desc: telegramReady ? t("telegramDesc") : t("telegramNotConfigured"), warn: !telegramReady },
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
    fetch(SETTINGS_URL, {
      headers: { "x-organization-id": orgId },
    })
      .then((r) => r.json())
      .then((json) => setSettings({ ...DEFAULTS, ...json.data }))
      .finally(() => setLoading(false))
  }, [orgId])

  /** Saves the form. Resolves to null when saved, otherwise to the reason, which is also shown under the header. */
  const save = async (): Promise<string | null> => {
    setSaving(true)
    setSaved(false)
    setSaveError("")
    const fail = (reason: string) => {
      setSaveError(reason)
      return reason
    }
    try {
      const res = await fetch(SETTINGS_URL, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
        body: JSON.stringify(settings),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        return fail(
          json.code === "invalid_telegram_bot_token" ? t("telegramBotTokenInvalid")
            : json.code === "invalid_telegram_chat_id" ? t("telegramChatIdInvalid")
              : t("saveFailed"),
        )
      }
      // The saved token comes back masked; keep the form in step with the server.
      setSettings({ ...DEFAULTS, ...json.data })
      return null
    } catch {
      return fail(t("saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (await save()) return
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  // One click: what is in the form is saved first, then the saved bot writes to the saved chat.
  const handleTelegramTest = async () => {
    setTestResult(null)
    setTesting(true)
    try {
      const notSaved = await save()
      if (notSaved) {
        // Said next to the button as well: on a phone the header is off screen here.
        setTestResult({ ok: false, text: notSaved })
        return
      }
      const res = await fetch(`${SETTINGS_URL}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-organization-id": orgId },
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok) setTestResult({ ok: true, text: t("telegramTestSent") })
      else if (json.code === "telegram_rejected") setTestResult({ ok: false, text: t("telegramTestRejected", { reason: json.detail || "" }) })
      else if (json.code === "telegram_not_configured") setTestResult({ ok: false, text: t("telegramNotConfigured") })
      else setTestResult({ ok: false, text: t("telegramTestUnreachable") })
    } catch {
      setTestResult({ ok: false, text: t("telegramTestUnreachable") })
    } finally {
      setTesting(false)
    }
  }

  const toggleEnabled = (key: CategoryKey) => {
    setSettings((prev) => ({
      ...prev,
      [key]: { ...prev[key], enabled: !prev[key].enabled },
    }))
  }

  const toggleChannel = (key: CategoryKey, channel: string) => {
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
      <PageHeader
        title={<>{t("title")} <TourReplayButton tourId="financeNotifications" /><HelpButton slug="finance-notifications" variant="label" /></>}
        titleTourId="fin-notif-header"
        description={<p className="text-sm text-muted-foreground mt-1">{t("description")}</p>}
        actions={
          canWrite && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {saved ? t("saved") : t("save")}
            </Button>
          )
        }
      />

      {saveError && <p role="alert" className="text-sm font-medium text-destructive">{saveError}</p>}

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

      {/* Telegram: the organization's own bot and chat */}
      <Card>
        <CardContent className="pt-5">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-sm font-medium">{t("telegramSetupTitle")}</Label>
              <p className="text-xs text-muted-foreground">{t("telegramSetupDesc")}</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 max-w-2xl">
              <div className="space-y-1">
                <Label htmlFor="fin-notif-telegram-token" className="text-xs font-medium text-muted-foreground">{t("telegramBotToken")}</Label>
                <Input
                  id="fin-notif-telegram-token"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.telegramBotToken}
                  // A saved token is shown masked: typing replaces it whole.
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => setSettings((prev) => ({ ...prev, telegramBotToken: e.target.value.trim() }))}
                  placeholder="123456789:AAE…"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fin-notif-telegram-chat" className="text-xs font-medium text-muted-foreground">{t("telegramChatId")}</Label>
                <Input
                  id="fin-notif-telegram-chat"
                  type="text"
                  autoComplete="off"
                  spellCheck={false}
                  value={settings.telegramChatId}
                  onChange={(e) => setSettings((prev) => ({ ...prev, telegramChatId: e.target.value.trim() }))}
                  placeholder="-1001234567890"
                />
              </div>
            </div>
            <ol className="space-y-1 text-xs text-muted-foreground">
              <li>{t("telegramStep1")}</li>
              <li>{t("telegramStep2")}</li>
              <li>{t("telegramStep3")}</li>
            </ol>
            {canWrite && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  variant="outline"
                  // On a phone the label is wider than the card: let it wrap instead of spilling out.
                  className="h-auto min-h-9 w-full whitespace-normal sm:w-auto"
                  onClick={handleTelegramTest}
                  disabled={testing || saving || !telegramReady}
                >
                  {testing ? <Loader2 className="w-4 h-4 mr-2 shrink-0 animate-spin" /> : <Send className="w-4 h-4 mr-2 shrink-0" />}
                  {t("telegramTestButton")}
                </Button>
                {testResult && (
                  <p role="status" className={`text-sm font-medium ${testResult.ok ? "text-emerald-600" : "text-destructive"}`}>
                    {testResult.text}
                  </p>
                )}
              </div>
            )}
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
              <div className="flex flex-wrap gap-2 mt-2">
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
  channels: Channel[]
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
  channels: string[]; channelList: Channel[]
  onToggle: (ch: string) => void; label: string
}) {
  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="space-y-2 mt-2">
        {channelList.map(({ key, label, desc, warn }) => (
          <label key={key} className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/30 cursor-pointer transition-colors">
            <div>
              <p className="text-sm font-medium">{label}</p>
              <p className={`text-xs ${warn ? "font-medium text-amber-600" : "text-muted-foreground"}`}>{desc}</p>
            </div>
            <input type="checkbox" checked={channels.includes(key)} onChange={() => onToggle(key)} className="rounded border-zinc-200 dark:border-zinc-700 w-4 h-4" />
          </label>
        ))}
      </div>
    </div>
  )
}
