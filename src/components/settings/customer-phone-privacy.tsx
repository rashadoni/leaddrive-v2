"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

/** Opt-in per workspace. Only an administrator's deliberate save changes the policy. */
export function CustomerPhonePrivacy() {
  const { data: session } = useSession()
  const t = useTranslations("whatsapp.phonePrivacy")
  const [saved, setSaved] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const admin = session?.user?.role === "admin" || session?.user?.role === "superadmin"
  useEffect(() => {
    if (!admin) return
    const controller = new AbortController()
    fetch("/api/v1/settings/customer-phone-privacy", { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("Unable to load")
        const result = await response.json()
        setSaved(result.data.enabled)
        setEnabled(result.data.enabled)
      })
      .catch(() => { if (!controller.signal.aborted) setError(true) })
    return () => controller.abort()
  }, [admin])
  if (!admin) return null
  async function save() {
    setSaving(true)
    setError(false)
    try {
      const response = await fetch("/api/v1/settings/customer-phone-privacy", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled }),
      })
      if (!response.ok) throw new Error("Unable to save")
      const result = await response.json()
      setSaved(result.data.enabled)
      setEnabled(result.data.enabled)
    } catch { setError(true) } finally { setSaving(false) }
  }
  return <Card className="p-6 space-y-3">
    <h2 className="text-base font-semibold">{t("title")}</h2>
    <p className="text-sm text-muted-foreground">{t("description")}</p>
    <label className="flex items-center gap-3 text-sm">
      <input type="checkbox" checked={enabled} disabled={saved === null || saving} onChange={event => setEnabled(event.target.checked)} className="h-4 w-4" />
      {t("label")}
    </label>
    <p className="text-xs text-muted-foreground">{t("scope")}</p>
    {error && <p role="alert" className="text-sm text-destructive">{t("error")}</p>}
    <Button onClick={save} disabled={saving || saved === null || enabled === saved}>{saving ? t("saving") : t("save")}</Button>
  </Card>
}
