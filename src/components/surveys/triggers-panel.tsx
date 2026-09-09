"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Save, Zap } from "lucide-react"

interface Props {
  surveyId: string
  orgId: string | number | undefined
  initialTriggers: Record<string, any>
}

const TRIGGER_KEYS = ["afterTicketResolve", "afterDealWon", "afterLeadConverted", "afterInvoicePaid", "smsBackup"] as const

export function SurveyTriggersPanel({ surveyId, orgId, initialTriggers }: Props) {
  const t = useTranslations("surveys")
  const TRIGGER_META = [
    { key: "afterTicketResolve", label: t("triggerTicketResolve"), hint: t("triggerTicketResolveHint") },
    { key: "afterDealWon", label: t("triggerDealWon"), hint: t("triggerDealWonHint") },
    { key: "afterLeadConverted", label: t("triggerLeadConverted"), hint: t("triggerLeadConvertedHint") },
    { key: "afterInvoicePaid", label: t("triggerInvoicePaid"), hint: t("triggerInvoicePaidHint") },
    { key: "smsBackup", label: t("smsBackup"), hint: t("smsBackupHint") },
  ]
  const [triggers, setTriggers] = useState<Record<string, boolean>>(() => {
    const out: Record<string, boolean> = {}
    for (const key of TRIGGER_KEYS) out[key] = !!initialTriggers?.[key]
    return out
  })
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<Date | null>(null)

  const toggle = (key: string) => setTriggers(t => ({ ...t, [key]: !t[key] }))

  const save = async () => {
    setSaving(true)
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(orgId ? { "x-organization-id": String(orgId) } : {}),
      }
      const res = await fetch(`/api/v1/surveys/${surveyId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ triggers }),
      })
      if (res.ok) setSavedAt(new Date())
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Zap className="h-4 w-4 text-amber-500" /> {t("triggersTitle")}
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("triggersHint")}</p>
      </div>

      <div className="space-y-2">
        {TRIGGER_META.map(({ key, label, hint }) => (
          <label key={key} className="flex items-start gap-3 p-2 rounded-md border border-zinc-200 dark:border-zinc-700 hover:bg-muted/40 cursor-pointer">
            <input
              type="checkbox"
              checked={triggers[key]}
              onChange={() => toggle(key)}
              className="mt-0.5 h-4 w-4"
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{label}</p>
              <p className="text-xs text-muted-foreground">{hint}</p>
            </div>
          </label>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        {savedAt && (
          <span className="text-[11px] text-muted-foreground">
            {t("savedAt", { time: savedAt.toLocaleTimeString() })}
          </span>
        )}
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          <Save className="h-3.5 w-3.5" />
          {saving ? t("saving") : t("saveTriggers")}
        </Button>
      </div>
    </div>
  )
}
