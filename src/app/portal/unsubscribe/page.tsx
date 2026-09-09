"use client"

import { Suspense, useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Mail, CheckCircle, AlertCircle, Loader2 } from "lucide-react"

// Public unsubscribe landing — served to customers who click "Unsubscribe" in
// the email client (List-Unsubscribe header). Uses the email as the only
// identifier; the API resolves the tenant from the contact record.
export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">…</div>}>
      <UnsubscribeInner />
    </Suspense>
  )
}

function UnsubscribeInner() {
  const t = useTranslations("portal")
  const searchParams = useSearchParams()
  const email = (searchParams.get("email") || "").trim()
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [message, setMessage] = useState("")

  async function onConfirm() {
    setStatus("loading")
    try {
      const res = await fetch("/api/v1/public/portal-unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })
      const json = await res.json()
      if (res.ok && json.success) {
        setStatus("done")
        setMessage(json.message || t("unsubscribeSuccess"))
      } else {
        setStatus("error")
        setMessage(json.error || t("unsubscribeError"))
      }
    } catch {
      setStatus("error")
      setMessage(t("networkError"))
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardContent className="py-10">
          <div className="flex items-start gap-3 mb-5">
            <Mail className="h-6 w-6 text-primary shrink-0 mt-0.5" />
            <div>
              <h1 className="text-xl font-semibold">{t("unsubscribeTitle")}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t("unsubscribeDesc")}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/30 px-3 py-2 text-sm font-mono mb-4 break-all">
            {email || <span className="text-muted-foreground">{t("emailMissing")}</span>}
          </div>

          {status === "done" && (
            <div className="flex items-start gap-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 p-3 text-sm text-emerald-900 dark:text-emerald-100">
              <CheckCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{message}</p>
            </div>
          )}
          {status === "error" && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 p-3 text-sm text-red-900 dark:text-red-100">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{message}</p>
            </div>
          )}

          {status !== "done" && (
            <div className="flex gap-2 mt-5">
              <Button
                onClick={onConfirm}
                disabled={!email || status === "loading"}
                className="flex-1"
              >
                {status === "loading" && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                {status === "loading" ? t("processing") : t("unsubscribeBtn")}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
