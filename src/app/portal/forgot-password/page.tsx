"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Mail } from "lucide-react"

export default function PortalForgotPasswordPage() {
  const t = useTranslations("portal")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    setLoading(true)
    setError("")

    try {
      const response = await fetch("/api/v1/public/portal-auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await response.json()
      if (!response.ok) throw new Error(json.error || "Error")
      setSent(true)
    } catch (requestError: any) {
      setError(requestError.message)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <CardContent className="py-10 text-center">
            <Mail className="h-12 w-12 text-primary mx-auto mb-3" />
            <h2 className="text-xl font-semibold mb-2">{t("checkEmail")}</h2>
            <p className="text-sm text-muted-foreground mb-1">
              {t("resetLinkSent")} <strong>{email}</strong>
            </p>
            <p className="text-sm text-muted-foreground">{t("followLink")}</p>
            <p className="text-xs text-muted-foreground mt-4">{t("linkValid24h")}</p>
            <div className="mt-6">
              <Link href="/portal/login" className="text-sm text-primary hover:underline">
                {t("backToLogin")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Card className="w-full max-w-md shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t("forgotPasswordTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("forgotPasswordSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-lg">{error}</div>}
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="your@company.com" className="mt-1" required />
            </div>
            <Button type="submit" className="w-full rounded-full" disabled={loading}>
              {loading ? "..." : t("sendResetLink")}
            </Button>
          </form>
          <div className="mt-4 text-center">
            <Link href="/portal/login" className="text-sm text-primary hover:underline">
              {t("backToLogin")}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
