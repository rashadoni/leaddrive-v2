"use client"

import { useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Mail } from "lucide-react"

export default function PortalRegisterPage() {
  const t = useTranslations("portal")
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const res = await fetch("/api/v1/public/portal-auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Error")
      setSent(true)
    } catch (err: any) {
      setError(err.message)
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
              {t("emailSent")} <strong>{email}</strong>
            </p>
            <p className="text-sm text-muted-foreground">
              {t("followLink")}
            </p>
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
          <CardTitle className="text-2xl">{t("registerTitle")}</CardTitle>
          <p className="text-sm text-muted-foreground">{t("registerSubtitle")}</p>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-lg">{error}</div>}
            <div>
              <label className="text-sm font-medium">Email</label>
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@company.com" className="mt-1" required />
            </div>
            <Button type="submit" className="w-full rounded-full" disabled={loading}>
              {loading ? "..." : t("sendLink")}
            </Button>
          </form>
          <div className="mt-4 text-center space-y-2">
            <Link href="/portal/login" className="text-sm text-primary hover:underline">
              {t("hasAccount")}
            </Link>
            <p className="text-xs text-muted-foreground">
              {t("contactAdmin")}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
