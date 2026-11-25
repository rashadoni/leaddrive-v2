"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Mail } from "lucide-react"
import { Hint } from "@/components/hint"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

type Status = { tone: "ok" | "error"; text: string } | null

/**
 * Who hears about each demo request from a partner's own site
 * (src/lib/demo-center/site-partner.ts). One address per site; empty = nobody.
 */
export function SitePartnerForm({ site, initialEmail }: { site: string; initialEmail: string | null }) {
  const t = useTranslations("admin.demoCenter")
  const [saved, setSaved] = useState(initialEmail ?? "")
  const [email, setEmail] = useState(initialEmail ?? "")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const inputId = `site-partner-${site.replace(/\W+/g, "-")}`

  async function save(next: string) {
    setBusy(true)
    setStatus(null)
    try {
      const response = await fetch("/api/v1/admin/demo-center/site-partner", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site, email: next }),
      })
      const data = (await response.json().catch(() => ({}))) as { code?: string; email?: string | null }
      if (!response.ok) {
        setStatus({
          tone: "error",
          text: data.code === "invalid_email" ? t("sitePartnerInvalid") : data.code === "no_sales_organization" ? t("sitePartnerUnavailable") : t("sitePartnerFailed"),
        })
        return
      }
      const value = data.email ?? ""
      setSaved(value)
      setEmail(value)
      setStatus({ tone: "ok", text: value ? t("sitePartnerSaved", { email: value }) : t("sitePartnerCleared") })
    } catch {
      setStatus({ tone: "error", text: t("sitePartnerFailed") })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      onSubmit={(event) => {
        event.preventDefault()
        if (!email.trim()) {
          setStatus({ tone: "error", text: t("sitePartnerInvalid") })
          return
        }
        void save(email)
      }}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <Label htmlFor={inputId}>{t("sitePartnerLabel", { site })}</Label>
        <Input
          id={inputId}
          type="email"
          inputMode="email"
          autoComplete="off"
          placeholder="ad@sirket.az"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={busy}
        />
        <p className="text-xs text-zinc-500">{saved ? t("sitePartnerCurrent", { email: saved }) : t("sitePartnerNone")}</p>
        <p className="min-h-4 text-xs" role="status" aria-live="polite">
          {status ? <span className={status.tone === "ok" ? "text-emerald-700" : "text-red-700"}>{status.text}</span> : null}
        </p>
      </div>
      <div className="flex gap-2 sm:pb-10">
        <Hint wrap text={t("sitePartnerSaveHint", { site })}>
          <Button type="submit" disabled={busy || email.trim() === saved}>
            <Mail className="mr-2 h-4 w-4" />
            {t("sitePartnerSave")}
          </Button>
        </Hint>
        {saved ? (
          <Hint wrap text={t("sitePartnerClearHint")}>
            <Button type="button" variant="outline" disabled={busy} onClick={() => void save("")}>
              {t("sitePartnerClear")}
            </Button>
          </Hint>
        ) : null}
      </div>
    </form>
  )
}
