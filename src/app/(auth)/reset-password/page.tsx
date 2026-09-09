"use client"

import { useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<Card><CardHeader className="text-center"><CardTitle>Loading...</CardTitle></CardHeader></Card>}>
      <ResetPasswordForm />
    </Suspense>
  )
}

function ResetPasswordForm() {
  const t = useTranslations("auth")
  const searchParams = useSearchParams()
  const token = searchParams.get("token")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [done, setDone] = useState(false)

  if (!token) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t("resetPassword")}</CardTitle>
          <CardDescription>{t("linkExpired") ?? "This password reset link is invalid or has expired."}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link href="/forgot-password" className="text-sm text-primary hover:underline">
            {t("sendResetLink")}
          </Link>
        </CardFooter>
      </Card>
    )
  }

  if (done) {
    return (
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">{t("resetPassword")}</CardTitle>
          <CardDescription>{t("passwordChanged")}</CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <Link href="/login" className="text-sm text-primary hover:underline">
            {t("signIn")}
          </Link>
        </CardFooter>
      </Card>
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    if (Array.from(password).length < 12) {
      setError(t("passwordMinLength"))
      return
    }
    if (password !== confirm) {
      setError(t("passwordsDoNotMatch"))
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/v1/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to reset password")
      setDone(true)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        <CardTitle className="text-2xl">{t("newPassword")}</CardTitle>
        <CardDescription>{t("confirmPassword")}</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {error && <div className="text-sm text-red-500 bg-red-50 dark:bg-red-900/20 p-2 rounded">{error}</div>}
          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">{t("newPassword")}</label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} maxLength={72} />
          </div>
          <div className="space-y-2">
            <label htmlFor="confirm" className="text-sm font-medium">{t("confirmPassword")}</label>
            <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={12} maxLength={72} />
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t("sending") : t("resetPassword")}
          </Button>
          <Link href="/login" className="text-sm text-muted-foreground hover:text-primary">
            {t("backToLogin")}
          </Link>
        </CardFooter>
      </form>
    </Card>
  )
}
