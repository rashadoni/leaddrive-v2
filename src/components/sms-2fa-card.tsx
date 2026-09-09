"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Phone, ShieldCheck, ShieldOff, Loader2 } from "lucide-react"

type State =
  | { kind: "loading" }
  | { kind: "disabled"; suggestedPhone: string | null } // flag off — show "Enable SMS 2FA"
  | { kind: "entering_phone"; phone: string } // user clicked Enable → collecting phone
  | { kind: "awaiting_code"; phone: string; code: string }
  | { kind: "enabled"; maskedPhone: string | null } // flag on — show "Disable"
  | { kind: "disabling"; maskedPhone: string | null; code: string }

/**
 * SMS 2FA widget for /settings/security, including step-up verification before disable.
 *
 *   disabled                 — shows bound status + "Enable SMS 2FA" button
 *   entering_phone            — form for the phone number
 *   awaiting_code             — form for the 6-digit SMS code
 *   enabled                   — shows masked phone + "Disable SMS 2FA" button
 *
 * Flow:
 *   GET /api/v1/auth/sms-2fa/status   → initial state
 *   POST /api/v1/auth/sms-otp/send    → phone verification code
 *   POST /api/v1/auth/sms-2fa/enable  → mark flag on
 *   POST /api/v1/auth/sms-2fa/disable → turn flag off
 */
export function Sms2FACard() {
  const t = useTranslations("settings")
  const [state, setState] = useState<State>({ kind: "loading" })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = async () => {
    setState({ kind: "loading" })
    try {
      const res = await fetch("/api/v1/auth/sms-2fa/status")
      const data = await res.json()
      if (data.success) {
        if (data.data.enabled) {
          setState({ kind: "enabled", maskedPhone: data.data.phone })
        } else {
          setState({ kind: "disabled", suggestedPhone: data.data.suggestedPhone || null })
        }
      } else {
        setState({ kind: "disabled", suggestedPhone: null })
      }
    } catch {
      setState({ kind: "disabled", suggestedPhone: null })
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  const sendCode = async (phone: string) => {
    setError(null)
    setBusy(true)
    const normalized = phone.replace(/[\s\-()]/g, "")
    if (!/^\+?[\d]{7,15}$/.test(normalized)) {
      setError(t("sms2faPhoneInvalid"))
      setBusy(false)
      return
    }
    try {
      const res = await fetch("/api/v1/auth/sms-otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: normalized, purpose: "2fa" }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t("sms2faSendFailed"))
        return
      }
      toast.success(t("sms2faCodeSent"))
      setState({ kind: "awaiting_code", phone: normalized, code: "" })
    } catch {
      setError(t("sms2faSendFailed"))
    } finally {
      setBusy(false)
    }
  }

  const verifyAndEnable = async (phone: string, code: string) => {
    setError(null)
    if (!/^\d{6}$/.test(code)) {
      setError(t("sms2faCodeInvalid"))
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/v1/auth/sms-2fa/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t("sms2faVerifyFailed"))
        return
      }
      toast.success(t("sms2faEnabledSuccess"))
      await loadStatus()
    } catch {
      setError(t("sms2faVerifyFailed"))
    } finally {
      setBusy(false)
    }
  }

  const requestDisableCode = async (maskedPhone: string | null) => {
    setError(null)
    setBusy(true)
    try {
      const res = await fetch("/api/v1/auth/resend-sms-2fa", { method: "POST" })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t("sms2faResendFailed"))
        return
      }
      toast.success(t("sms2faCodeSent"))
      setState({ kind: "disabling", maskedPhone, code: "" })
    } catch {
      setError(t("sms2faResendFailed"))
    } finally {
      setBusy(false)
    }
  }

  const disable = async (code: string) => {
    setError(null)
    if (!/^\d{4,8}$/.test(code)) {
      setError(t("sms2faCodeInvalid"))
      return
    }
    setBusy(true)
    try {
      const res = await fetch("/api/v1/auth/sms-2fa/disable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || t("sms2faDisableFailed"))
        return
      }
      toast.success(t("sms2faDisabledSuccess"))
      // The server advanced passwordChangedAt, deliberately revoking this
      // session. Navigate to login instead of issuing authenticated requests
      // with a cookie that is now invalid.
      window.location.assign("/login")
    } catch {
      setError(t("sms2faDisableFailed"))
    } finally {
      setBusy(false)
    }
  }

  // Status pill renders in the card header regardless of which step is showing.
  const StatusPill = () => {
    if (state.kind === "loading") {
      return <Badge variant="outline" className="text-[10px]">...</Badge>
    }
    if (state.kind === "enabled") {
      return (
        <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800">
          {t("sms2faStatusEnabled")}
        </Badge>
      )
    }
    return (
      <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800">
        {t("sms2faStatusDisabled")}
      </Badge>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Phone className="h-4 w-4 text-primary" />
          {t("sms2faTitle")}
          <div className="ml-auto">
            <StatusPill />
          </div>
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">{t("sms2faDescription")}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {state.kind === "loading" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("sms2faLoading")}
          </div>
        )}

        {state.kind === "enabled" && (
          <>
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 p-3 text-xs text-emerald-900 dark:text-emerald-200 flex items-start gap-2">
              <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <div className="font-medium">{t("sms2faActiveTitle")}</div>
                <div className="mt-0.5 opacity-80">
                  {t("sms2faActiveOnPhone")}: <span className="font-mono">{state.maskedPhone || "—"}</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => requestDisableCode(state.maskedPhone)} disabled={busy}>
                {busy ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t("sms2faDisabling")}</>
                ) : (
                  <><ShieldOff className="h-3.5 w-3.5 mr-1.5" /> {t("sms2faDisableCta")}</>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setState({ kind: "entering_phone", phone: "" })}
                disabled={busy}
              >
                {t("sms2faChangeNumberCta")}
              </Button>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
          </>
        )}

        {state.kind === "disabling" && (
          <>
            <div className="text-xs text-muted-foreground">
              {t("sms2faCodeSentTo")}: <span className="font-mono">{state.maskedPhone || "—"}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sms2fa-disable-code" className="text-xs">{t("sms2faCodeLabel")}</Label>
              <Input
                id="sms2fa-disable-code"
                inputMode="numeric"
                maxLength={8}
                placeholder="123456"
                value={state.code}
                onChange={(e) => setState({ ...state, code: e.target.value.replace(/\D/g, "").slice(0, 8) })}
                disabled={busy}
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => disable(state.code)}
                disabled={busy || state.code.length < 4}
              >
                {busy ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t("sms2faDisabling")}</>
                ) : (
                  <><ShieldOff className="h-3.5 w-3.5 mr-1.5" /> {t("sms2faDisableCta")}</>
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={loadStatus} disabled={busy}>
                {t("sms2faCancel")}
              </Button>
            </div>
          </>
        )}

        {state.kind === "disabled" && (
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => setState({ kind: "entering_phone", phone: state.suggestedPhone || "" })}
            >
              <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
              {t("sms2faEnableCta")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("sms2faEnableHint")}</span>
          </div>
        )}

        {state.kind === "entering_phone" && (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="sms2fa-phone" className="text-xs">{t("sms2faPhoneLabel")}</Label>
              <Input
                id="sms2fa-phone"
                type="tel"
                placeholder="+994501234567"
                value={state.phone}
                onChange={(e) => setState({ kind: "entering_phone", phone: e.target.value })}
                disabled={busy}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">{t("sms2faPhoneHint")}</p>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => sendCode(state.phone)} disabled={busy || !state.phone}>
                {busy ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t("sms2faSending")}</>
                ) : (
                  t("sms2faSendCta")
                )}
              </Button>
              <Button variant="ghost" size="sm" onClick={loadStatus}>
                {t("sms2faCancel")}
              </Button>
            </div>
          </>
        )}

        {state.kind === "awaiting_code" && (
          <>
            <div className="text-xs text-muted-foreground">
              {t("sms2faCodeSentTo")}: <span className="font-mono">{state.phone}</span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sms2fa-code" className="text-xs">{t("sms2faCodeLabel")}</Label>
              <Input
                id="sms2fa-code"
                inputMode="numeric"
                maxLength={6}
                placeholder="123456"
                value={state.code}
                onChange={(e) =>
                  setState({ ...state, code: e.target.value.replace(/\D/g, "").slice(0, 6) })
                }
                autoFocus
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => verifyAndEnable(state.phone, state.code)}
                disabled={busy || state.code.length !== 6}
              >
                {busy ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t("sms2faVerifying")}</>
                ) : (
                  <><ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> {t("sms2faVerifyAndEnableCta")}</>
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setState({ kind: "entering_phone", phone: state.phone })}
                disabled={busy}
              >
                {t("sms2faBackCta")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
