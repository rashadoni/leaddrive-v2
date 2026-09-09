"use client"

import { useState, useRef, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck, Loader2, Smartphone } from "lucide-react"

/**
 * Post-password 2FA verification page.
 *
 * Branches on session.user.twoFactorMethod:
 *   - "totp" → Input hex/digit authenticator or backup code → /verify-2fa
 *   - "sms"  → 6-digit SMS code (already sent during authorize()) → /verify-sms-2fa
 *             + resend button that calls /resend-sms-2fa
 *   - anything else → redirect out; user shouldn't be here.
 */
export default function Verify2FAPage() {
  const router = useRouter()
  const t = useTranslations("auth")
  const { data: session, update } = useSession()
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [resentJustNow, setResentJustNow] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const method = (session?.user as any)?.twoFactorMethod as "totp" | "sms" | undefined
  const isSms = method === "sms"

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    if (session && !(session.user as any)?.needs2fa) {
      router.push("/")
    }
  }, [session, router])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const endpoint = isSms ? "/api/v1/auth/verify-sms-2fa" : "/api/v1/auth/verify-2fa"
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      })

      const json = await res.json()
      if (!res.ok) {
        setError(json.error || t("invalidCode"))
        setLoading(false)
        return
      }

      await update({ needs2fa: false, twoFactorNonce: json.data.twoFactorNonce })
      router.push("/")
      router.refresh()
    } catch {
      setError(t("invalidCode"))
      setLoading(false)
    }
  }

  async function handleResend() {
    setError("")
    setResending(true)
    try {
      const res = await fetch("/api/v1/auth/resend-sms-2fa", { method: "POST" })
      const json = await res.json()
      if (!res.ok) {
        setError(json.error || t("sms2faResendFailed"))
      } else {
        setResentJustNow(true)
        setTimeout(() => setResentJustNow(false), 5000)
      }
    } catch {
      setError(t("sms2faResendFailed"))
    } finally {
      setResending(false)
    }
  }

  const IconComponent = isSms ? Smartphone : ShieldCheck
  const titleKey = isSms ? "sms2faVerifyTitle" : "verify2faTitle"
  const subtitleKey = isSms ? "sms2faVerifySubtitle" : "verify2faSubtitle"

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <IconComponent className="h-7 w-7 text-primary" />
        </div>
        <CardTitle className="text-xl font-bold">{t(titleKey)}</CardTitle>
        <CardDescription>{t(subtitleKey)}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {resentJustNow && (
            <div className="rounded-md bg-emerald-50 dark:bg-emerald-900/20 p-3 text-sm text-emerald-700 dark:text-emerald-300">
              {t("sms2faCodeSent")}
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="code" className="text-sm font-medium">
              {t(isSms ? "sms2faEnterCode" : "enterCode")}
            </label>
            <Input
              ref={inputRef}
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder={isSms ? "123456" : "000000"}
              value={code}
              onChange={(e) =>
                setCode(
                  e.target.value
                    .replace(isSms ? /\D/g : /[^0-9a-fA-F]/g, "")
                    .slice(0, isSms ? 6 : 8)
                )
              }
              required
              maxLength={isSms ? 6 : 8}
              className="text-center text-2xl tracking-[0.5em] font-mono"
            />
            <p className="text-xs text-muted-foreground">
              {isSms ? t("sms2faCodeHint") : t("backupCodeHint")}
            </p>
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-2">
          <Button type="submit" className="w-full gap-2" disabled={loading || code.length < 6}>
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> {t("verifying")}</>
            ) : (
              t("verifyCode")
            )}
          </Button>
          {isSms && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              disabled={resending}
              onClick={handleResend}
            >
              {resending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> {t("sms2faSending")}</>
              ) : (
                t("sms2faResendCta")
              )}
            </Button>
          )}
        </CardFooter>
      </form>
    </Card>
  )
}
