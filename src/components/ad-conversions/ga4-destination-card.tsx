"use client"

/**
 * Google Analytics 4 as a conversions destination: measurement id, the
 * Measurement Protocol API secret, what to send, and the consent statement
 * without which sending cannot be turned on. Approved as a mockup on
 * 2026-10-26. The secret is never shown back — `hasSecret` says one is stored.
 */
import { useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { AlertCircle, CheckCircle, Loader2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Hint } from "@/components/hint"
import { formatDateTime } from "@/lib/format-date"
import type { DestinationView } from "./destination-card"

export interface Ga4Save {
  publicId: string
  secret?: string
  sendLeads: boolean
  sendWins: boolean
  isActive: boolean
  consent: boolean
}

const ERROR_KEYS: Record<string, string> = {
  INVALID_KEY: "errInvalidKey",
  UNREACHABLE: "errUnreachable",
  NO_ENCRYPTION_KEY: "errNoKey",
  CONSENT_REQUIRED: "errConsent",
  INVALID_MEASUREMENT_ID: "ga4ErrMeasurementId",
}

export function Ga4DestinationCard({
  view, onSave, onTest,
}: {
  view: DestinationView | null
  onSave: (input: Ga4Save) => Promise<{ ok: true; view: DestinationView } | { ok: false; code?: string; reason?: string }>
  onTest: () => Promise<{ ok: boolean; reason?: string }>
}) {
  const t = useTranslations("adConversions")
  const locale = useLocale()
  const [publicId, setPublicId] = useState(view?.publicId ?? "")
  const [secret, setSecret] = useState("")
  const [sendLeads, setSendLeads] = useState(view?.sendLeads ?? true)
  const [sendWins, setSendWins] = useState(view?.sendWins ?? true)
  const [consent, setConsent] = useState(view?.consentConfirmed ?? false)
  const [current, setCurrent] = useState<DestinationView | null>(view)
  const [busy, setBusy] = useState<"save" | "off" | "test" | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const provider = "Google Analytics"

  async function save(isActive: boolean) {
    setBusy(isActive ? "save" : "off")
    setMessage(null)
    const result = await onSave({ publicId: publicId.trim().toUpperCase(), secret: secret || undefined, sendLeads, sendWins, isActive, consent })
    setBusy(null)
    if (!result.ok) {
      const text = t(ERROR_KEYS[result.code ?? ""] ?? "errGeneric", { provider })
      setMessage({ type: "error", text: result.reason ? `${text} Google: «${result.reason}»` : text })
      return
    }
    setCurrent(result.view)
    setSecret("")
    setMessage({ type: "success", text: isActive ? t("saved") : t("turnedOff") })
  }

  async function test() {
    setBusy("test")
    setMessage(null)
    const result = await onTest()
    setBusy(null)
    setMessage(result.ok ? { type: "success", text: t("ga4TestSent") } : { type: "error", text: `${t("errUnreachable", { provider })} ${result.reason ?? ""}`.trim() })
  }

  const status = !current?.configured
    ? { text: t("statusNotSet"), tone: "text-muted-foreground", dot: "bg-muted-foreground" }
    : current.isActive
      ? { text: t("statusOn"), tone: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" }
      : { text: t("statusOff"), tone: "text-muted-foreground", dot: "bg-muted-foreground" }
  const missing = !/^G-[A-Z0-9]{4,20}$/i.test(publicId.trim()) ? t("ga4ErrMeasurementId")
    : !(secret.length > 0 || current?.hasSecret) ? t("ga4MissingSecret")
      : !(sendLeads || sendWins) ? t("missingEvent")
        : !consent ? t("errConsent") : null

  return (
    <Card data-testid="ad-destination-ga4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Google Analytics 4</CardTitle>
          <span className={`flex items-center gap-2 text-sm font-medium ${status.tone}`}>
            <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />{status.text}
            {current?.isActive && current.lastSentAt ? (
              <span className="font-normal text-muted-foreground">· {t("lastSentAt", { time: formatDateTime(current.lastSentAt, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</span>
            ) : null}
          </span>
        </div>
        <CardDescription>{t("ga4Desc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label htmlFor="ga4-id">{t("ga4MeasurementId")}</Label>
            <Input id="ga4-id" className="mt-1" value={publicId} placeholder="G-XXXXXXXXXX" onChange={(e) => setPublicId(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{t("ga4MeasurementIdHint")}</p>
          </div>
          <div>
            <Label htmlFor="ga4-secret">{t("ga4Secret")}</Label>
            <Input id="ga4-secret" className="mt-1" type="password" autoComplete="new-password" value={secret} placeholder={current?.hasSecret ? "••••••••" : ""} onChange={(e) => setSecret(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{current?.hasSecret ? t("secretSaved") : t("ga4SecretHint")}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("eventsLabel")}</legend>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={sendLeads} onCheckedChange={setSendLeads} />{t("sendLeads")} → <code className="text-xs">generate_lead</code>
            </label>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={sendWins} onCheckedChange={setSendWins} />{t("sendWins")} → <code className="text-xs">close_convert_lead</code>
            </label>
          </fieldset>
          <div className="rounded-lg border border-l-4 border-l-amber-500 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
              <Checkbox className="mt-0.5" checked={consent} onCheckedChange={setConsent} />{t("consent")}
            </label>
            <p className="ml-6 mt-1 text-xs text-muted-foreground">{t("ga4ConsentHint")}</p>
          </div>
        </div>

        {message ? (
          <p className={`flex items-center gap-2 text-sm ${message.type === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`} role="status">
            {message.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Hint text={missing ?? t("ga4SaveHint")} wrap>
            <Button onClick={() => void save(true)} disabled={missing !== null || busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {busy === "save" ? t("saving") : t("save")}
            </Button>
          </Hint>
          {current?.configured && current.isActive ? (
            <>
              <Hint text={t("ga4TestHint")}>
                <Button variant="outline" onClick={() => void test()} disabled={busy !== null}>
                  {busy === "test" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}{t("sendTest")}
                </Button>
              </Hint>
              <Button variant="outline" onClick={() => void save(false)} disabled={busy !== null}>{t("turnOff")}</Button>
            </>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
