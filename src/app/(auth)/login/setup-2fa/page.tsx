"use client"

import { useState, useEffect } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck, Loader2, Copy, Check } from "lucide-react"

export default function Setup2FAPage() {
  const router = useRouter()
  const t = useTranslations("auth")
  const { data: session, update } = useSession()
  const [step, setStep] = useState<"loading" | "scan" | "verify" | "done">("loading")
  const [qrCode, setQrCode] = useState("")
  const [secret, setSecret] = useState("")
  const [backupCodes, setBackupCodes] = useState<string[]>([])
  const [code, setCode] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [twoFactorNonce, setTwoFactorNonce] = useState("")

  // Redirect if user doesn't need setup
  useEffect(() => {
    if (session && !(session.user as any)?.needsSetup2fa) {
      router.push("/")
    }
  }, [session, router])

  // Start 2FA setup on mount
  useEffect(() => {
    async function setup() {
      try {
        const res = await fetch("/api/v1/auth/2fa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "setup" }),
        })
        const json = await res.json()
        if (json.success) {
          setQrCode(json.data.qrCode)
          setSecret(json.data.secret)
          setBackupCodes(json.data.backupCodes || [])
          setStep("scan")
        }
      } catch {
        setError("Failed to setup 2FA")
      }
    }
    setup()
  }, [])

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/v1/auth/2fa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "verify", code: code.trim() }),
      })
      const json = await res.json()

      if (!res.ok) {
        setError(json.error || t("invalidCode"))
        setLoading(false)
        return
      }

      // Store server-side nonce for secure session update
      if (json.data?.twoFactorNonce) {
        setTwoFactorNonce(json.data.twoFactorNonce)
      }
      setStep("done")
      setLoading(false)
    } catch {
      setError(t("invalidCode"))
      setLoading(false)
    }
  }

  async function handleFinish() {
    // Clear needsSetup2fa from session — pass server-side nonce for verification
    await update({ needsSetup2fa: false, twoFactorNonce })
    router.push("/")
    router.refresh()
  }

  function copySecret() {
    navigator.clipboard.writeText(secret)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (step === "loading") {
    return (
      <Card className="w-full max-w-md">
        <CardContent className="py-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground mt-3">{t("setup2faLoading")}</p>
        </CardContent>
      </Card>
    )
  }

  if (step === "done") {
    return (
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-green-100">
            <Check className="h-7 w-7 text-green-600" />
          </div>
          <CardTitle className="text-xl">{t("setup2faEnabled")}</CardTitle>
          <CardDescription>{t("setup2faBackupHint")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted rounded-lg p-4">
            <div className="grid grid-cols-2 gap-2 font-mono text-sm">
              {backupCodes.map((code, i) => (
                <div key={i} className="text-center py-1">{code}</div>
              ))}
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button onClick={handleFinish} className="w-full">{t("setup2faContinue")}</Button>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <ShieldCheck className="h-7 w-7 text-primary" />
        </div>
        <CardTitle className="text-xl">{t("setup2faTitle")}</CardTitle>
        <CardDescription>{t("setup2faRequiredHint")}</CardDescription>
      </CardHeader>

      {step === "scan" && (
        <form onSubmit={handleVerify}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>
            )}

            {/* QR Code */}
            {qrCode && (
              <div className="flex justify-center">
                <img src={qrCode} alt="QR Code" className="w-48 h-48 rounded-lg border border-zinc-200 dark:border-zinc-700" />
              </div>
            )}

            <p className="text-sm text-center text-muted-foreground">{t("setup2faScanHint")}</p>

            {/* Manual secret */}
            <div className="flex items-center gap-2 bg-muted rounded-md px-3 py-2">
              <code className="text-xs font-mono flex-1 break-all">{secret}</code>
              <button type="button" onClick={copySecret} className="shrink-0 p-1 rounded hover:bg-background">
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
              </button>
            </div>

            {/* Verification code */}
            <div className="space-y-2">
              <label className="text-sm font-medium">{t("enterCode")}</label>
              <Input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="text-center text-2xl tracking-[0.5em] font-mono"
                required
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" className="w-full gap-2" disabled={loading || code.length < 6}>
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> {t("verifying")}</>
              ) : (
                t("setup2faConfirm")
              )}
            </Button>
          </CardFooter>
        </form>
      )}
    </Card>
  )
}
