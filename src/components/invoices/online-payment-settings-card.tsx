"use client"

/**
 * «Card payments · Kapital Bank» in the invoice settings: the merchant login
 * and password the bank issued. Saving checks the pair with the bank first
 * (/api/v1/settings/online-payment), so a wrong password is said here, not by
 * a customer's failed payment. The password is never shown back.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { CheckCircle, CreditCard, Loader2, AlertCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Hint } from "@/components/hint"

interface SettingsView {
  configured: boolean
  isActive: boolean
  isTestMode: boolean
  login: string
  hasPassword: boolean
}

const ERROR_KEYS: Record<string, string> = {
  INVALID_CREDENTIALS: "errInvalid",
  BANK_UNREACHABLE: "errUnreachable",
  NO_ENCRYPTION_KEY: "errNoKey",
  PASSWORD_REQUIRED: "errPasswordRequired",
}

export function OnlinePaymentSettingsCard() {
  const t = useTranslations("onlinePayment")
  const [view, setView] = useState<SettingsView | null>(null)
  const [login, setLogin] = useState("")
  const [password, setPassword] = useState("")
  const [isTestMode, setIsTestMode] = useState(false)
  const [busy, setBusy] = useState<"save" | "off" | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  useEffect(() => {
    fetch("/api/v1/settings/online-payment", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        if (!body?.success) return
        setView(body.data)
        setLogin(body.data.login || "")
        setIsTestMode(Boolean(body.data.isTestMode && body.data.configured))
      })
      .catch(() => {})
  }, [])

  async function save(isActive: boolean) {
    setBusy(isActive ? "save" : "off")
    setMessage(null)
    try {
      const response = await fetch("/api/v1/settings/online-payment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ login: login.trim(), password: password || undefined, isTestMode, isActive }),
      })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || !body.success) {
        setMessage({ type: "error", text: t(ERROR_KEYS[body?.code] ?? "errGeneric") })
        return
      }
      setView(body.data)
      setPassword("")
      setMessage({ type: "success", text: isActive ? t("saved") : t("turnedOff") })
    } catch {
      setMessage({ type: "error", text: t("errGeneric") })
    } finally {
      setBusy(null)
    }
  }

  const status = !view?.configured
    ? { text: t("statusNotSet"), tone: "text-muted-foreground", dot: "bg-muted-foreground" }
    : view.isActive
      ? { text: view.isTestMode ? `${t("statusOn")} · ${t("statusTest")}` : t("statusOn"), tone: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" }
      : { text: t("statusOff"), tone: "text-muted-foreground", dot: "bg-muted-foreground" }
  const canSave = login.trim().length > 0 && (password.length > 0 || Boolean(view?.hasPassword))

  return (
    <Card data-testid="online-payment-settings">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
            {t("settingsTitle")}
          </CardTitle>
          <span className={`flex items-center gap-2 text-sm font-medium ${status.tone}`}>
            <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />
            {status.text}
          </span>
        </div>
        <CardDescription>{t("settingsDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="kapital-login" className="text-sm">{t("login")}</Label>
            <Input
              id="kapital-login"
              value={login}
              onChange={(e) => setLogin(e.target.value)}
              placeholder="TerminalSys/…"
              autoComplete="off"
              className="mt-1"
            />
            <p className="mt-1 text-xs text-muted-foreground">{t("loginHint")}</p>
          </div>
          <div>
            <Label htmlFor="kapital-password" className="text-sm">{t("password")}</Label>
            <Input
              id="kapital-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={view?.hasPassword ? "••••••••" : ""}
              autoComplete="new-password"
              className="mt-1"
            />
            {view?.hasPassword ? <p className="mt-1 text-xs text-muted-foreground">{t("passwordSaved")}</p> : null}
          </div>
        </div>

        <Hint text={t("testModeHint")} side="top" align="start">
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={isTestMode} onCheckedChange={setIsTestMode} />
            {t("testMode")}
          </label>
        </Hint>

        {message ? (
          <p className={`flex items-center gap-2 text-sm ${message.type === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`} role="status">
            {message.type === "success" ? <CheckCircle className="h-4 w-4" aria-hidden="true" /> : <AlertCircle className="h-4 w-4" aria-hidden="true" />}
            {message.text}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Hint text={t("saveHint")} wrap>
            <Button onClick={() => void save(true)} disabled={!canSave || busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {busy === "save" ? t("saving") : t("save")}
            </Button>
          </Hint>
          {view?.configured && view.isActive ? (
            <Hint text={t("turnOffHint")}>
              <Button variant="outline" onClick={() => void save(false)} disabled={busy !== null}>
                {busy === "off" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {t("turnOff")}
              </Button>
            </Hint>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
