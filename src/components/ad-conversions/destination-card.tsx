"use client"

/**
 * Meta (Facebook and Instagram ads) as a conversions destination: pixel id,
 * access token, what to send, and the consent statement without which
 * sending cannot be turned on. The token is never shown back — `hasSecret`
 * says one is stored.
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

export interface DestinationView {
  configured: boolean
  isActive: boolean
  publicId: string
  hasSecret: boolean
  testEventCode: string
  sendLeads: boolean
  sendWins: boolean
  consentConfirmed: boolean
  lastSentAt: string | null
  failures7d: number
}

export interface DestinationSave {
  publicId: string
  secret?: string
  testEventCode?: string
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
  INVALID_PIXEL: "errInvalidPixel",
  NO_PIXEL_ACCESS: "errNoPixelAccess",
  TEST_CODE_REQUIRED: "errTestCode",
}

export function MetaDestinationCard({
  view, onSave, onTest,
}: {
  view: DestinationView | null
  onSave: (input: DestinationSave) => Promise<{ ok: true; view: DestinationView } | { ok: false; code?: string; reason?: string }>
  onTest: () => Promise<{ ok: boolean; code?: string; reason?: string }>
}) {
  const t = useTranslations("adConversions")
  const locale = useLocale()
  const [publicId, setPublicId] = useState(view?.publicId ?? "")
  const [secret, setSecret] = useState("")
  const [testEventCode, setTestEventCode] = useState(view?.testEventCode ?? "")
  const [sendLeads, setSendLeads] = useState(view?.sendLeads ?? true)
  const [sendWins, setSendWins] = useState(view?.sendWins ?? true)
  const [consent, setConsent] = useState(view?.consentConfirmed ?? false)
  const [current, setCurrent] = useState<DestinationView | null>(view)
  const [busy, setBusy] = useState<"save" | "off" | "test" | null>(null)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const provider = "Meta"

  async function save(isActive: boolean) {
    setBusy(isActive ? "save" : "off")
    setMessage(null)
    const result = await onSave({
      publicId: publicId.trim(),
      secret: secret || undefined,
      testEventCode: testEventCode.trim(),
      sendLeads,
      sendWins,
      isActive,
      consent,
    })
    setBusy(null)
    if (!result.ok) {
      // Meta's own words after ours: «Missing Permission» or «Invalid OAuth access token» tells the owner where to look.
      const text = t(ERROR_KEYS[result.code ?? ""] ?? "errGeneric", { provider })
      setMessage({ type: "error", text: result.reason ? `${text} ${provider}: «${result.reason}»` : text })
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
    if (result.ok) setMessage({ type: "success", text: t("testSent") })
    else setMessage({ type: "error", text: result.code ? t(ERROR_KEYS[result.code] ?? "errGeneric", { provider }) : `${t("errInvalidKey", { provider })} ${result.reason ?? ""}`.trim() })
  }

  const status = !current?.configured
    ? { text: t("statusNotSet"), tone: "text-muted-foreground", dot: "bg-muted-foreground" }
    : current.isActive
      ? { text: t("statusOn"), tone: "text-emerald-700 dark:text-emerald-400", dot: "bg-emerald-500" }
      : { text: t("statusOff"), tone: "text-muted-foreground", dot: "bg-muted-foreground" }
  // What still stops saving, first missing first — the button's hint names it.
  const missing = !/^\d{5,25}$/.test(publicId.trim()) ? t("errInvalidPixel")
    : !(secret.length > 0 || current?.hasSecret) ? t("missingToken")
      : !(sendLeads || sendWins) ? t("missingEvent")
        : !consent ? t("errConsent") : null
  const canSave = missing === null

  return (
    <Card data-testid="ad-destination-meta">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{t("metaTitle")}</CardTitle>
          <span className={`flex items-center gap-2 text-sm font-medium ${status.tone}`}>
            <span className={`h-2 w-2 rounded-full ${status.dot}`} aria-hidden="true" />{status.text}
            {current?.isActive && current.lastSentAt ? (
              <span className="font-normal text-muted-foreground">· {t("lastSentAt", { time: formatDateTime(current.lastSentAt, locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) })}</span>
            ) : null}
          </span>
        </div>
        <CardDescription>{t("metaDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <Label htmlFor="meta-pixel">{t("pixelId")}</Label>
            <Input id="meta-pixel" className="mt-1" inputMode="numeric" value={publicId} placeholder="123456789012345" onChange={(e) => setPublicId(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{t("pixelIdHint")}</p>
          </div>
          <div>
            <Label htmlFor="meta-token">{t("accessToken")}</Label>
            <Input id="meta-token" className="mt-1" type="password" autoComplete="new-password" value={secret} placeholder={current?.hasSecret ? "••••••••" : ""} onChange={(e) => setSecret(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{current?.hasSecret ? t("secretSaved") : t("tokenHintSystem")}</p>
          </div>
          <div>
            <Label htmlFor="meta-test-code">{t("testEventCode")}</Label>
            <Input id="meta-test-code" className="mt-1" value={testEventCode} placeholder="TEST12345" onChange={(e) => setTestEventCode(e.target.value)} />
            <p className="mt-1 text-xs text-muted-foreground">{t("testEventCodeHint")}</p>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("eventsLabel")}</legend>
            <div>
              <Hint text={t("sendLeadsHint")} side="top" align="start">
                <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
                  <Checkbox checked={sendLeads} onCheckedChange={setSendLeads} />{t("sendLeads")}
                </label>
              </Hint>
              <p className="ml-6 text-xs text-muted-foreground">{t("sendLeadsWhich")}</p>
            </div>
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={sendWins} onCheckedChange={setSendWins} />{t("sendWins")}
            </label>
          </fieldset>
          <div className="rounded-lg border border-l-4 border-l-amber-500 p-3">
            <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
              <Checkbox className="mt-0.5" checked={consent} onCheckedChange={setConsent} />{t("consent")}
            </label>
            <p className="ml-6 mt-1 text-xs text-muted-foreground">{t("consentHint")}</p>
          </div>
        </div>

        {message ? (
          <p className={`flex items-center gap-2 text-sm ${message.type === "success" ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`} role="status">
            {message.type === "success" ? <CheckCircle className="h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
            {message.text}
          </p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Hint text={missing ?? t("saveHint")} wrap>
            <Button onClick={() => void save(true)} disabled={!canSave || busy !== null}>
              {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              {busy === "save" ? t("saving") : t("save")}
            </Button>
          </Hint>
          {current?.configured && current.isActive ? (
            <>
              <Hint text={t("sendTestHint")}>
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
