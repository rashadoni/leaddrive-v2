"use client"

/**
 * Settings → «Telegram-bot»: the organization's own bot for its employees
 * (owner 2026-10-25: «свой бот у каждой организации»). The token is never
 * shown back. Approved as a mockup on 2026-10-25.
 */
import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertCircle, CheckCircle, Loader2, PlugZap, Send } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Hint } from "@/components/hint"

interface BotView { connected: boolean; botUsername: string | null; linkedUsers: number }

const ERROR_KEYS: Record<string, string> = {
  INVALID_TOKEN: "errInvalidToken",
  CUSTOMER_CHAT_BOT: "errCustomerChatBot",
  BOT_IN_USE: "errBotInUse",
  UNREACHABLE: "errUnreachable",
  NO_ENCRYPTION_KEY: "errNoKey",
}

export default function TelegramBotSettingsPage() {
  const t = useTranslations("telegramStaff")
  const [view, setView] = useState<BotView | null>(null)
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState<"save" | "off" | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const load = useCallback(() => {
    void fetch("/api/v1/settings/telegram-bot", { cache: "no-store" }).then((r) => r.json()).then((body) => {
      if (body?.success) setView(body.data)
    }).catch(() => undefined)
  }, [])
  useEffect(load, [load])

  async function send(method: "PUT" | "DELETE") {
    setBusy(method === "PUT" ? "save" : "off")
    setMessage(null)
    const response = await fetch("/api/v1/settings/telegram-bot", {
      method,
      headers: { "Content-Type": "application/json" },
      ...(method === "PUT" ? { body: JSON.stringify({ token }) } : {}),
    }).catch(() => null)
    const body = await response?.json().catch(() => null)
    setBusy(null)
    if (!response?.ok || !body?.success) {
      setMessage({ type: "error", text: t(ERROR_KEYS[body?.code] ?? "errGeneric") })
      return
    }
    setView(body.data)
    setToken("")
    setMessage({ type: "success", text: method === "PUT" ? t("connected", { bot: `@${body.data.botUsername}` }) : t("turnedOff") })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Send className="h-6 w-6 text-muted-foreground" aria-hidden="true" />{t("title")}
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{t("desc")}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t("cardTitle")}</CardTitle>
            {view?.connected ? (
              <span className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle className="h-4 w-4" aria-hidden="true" />@{view.botUsername} · {t("linkedUsers", { count: view.linkedUsers })}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">{t("notConnected")}</span>
            )}
          </div>
          <CardDescription>{t("cardDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xl">
            <Label htmlFor="bot-token">{t("token")}</Label>
            <Input id="bot-token" className="mt-1" type="password" autoComplete="new-password" value={token}
              placeholder={view?.connected ? "••••••••" : "123456789:AA…"} onChange={(e) => setToken(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{t("tokenHint")}</p>
          </div>
          <ol className="max-w-xl list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          {message ? (
            <p className={`flex items-center gap-2 text-sm ${message.type === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`} role="status">
              {message.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
              {message.text}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Hint text={token.trim() ? t("connectHint") : t("errTokenMissing")} wrap>
              <Button onClick={() => void send("PUT")} disabled={!token.trim() || busy !== null}>
                {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
                {t("connect")}
              </Button>
            </Hint>
            {view?.connected ? (
              <Hint text={t("turnOffHint")}>
                <Button variant="outline" onClick={() => void send("DELETE")} disabled={busy !== null}>{t("turnOff")}</Button>
              </Hint>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
