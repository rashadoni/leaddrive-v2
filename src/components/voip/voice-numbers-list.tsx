"use client"

import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { Card, CardContent } from "@/components/ui/card"

/** The organization's phone numbers, read-only: LeadDrive assigns them. Hidden
 * while the organization has none. */
export function VoiceNumbersList() {
  const t = useTranslations("voiceLineNumbers")
  const [numbers, setNumbers] = useState<Array<{ id: string; e164: string; label: string | null }>>([])
  useEffect(() => {
    let live = true
    void fetch("/api/v1/voip/numbers", { cache: "no-store" }).then(async (response) => {
      if (live && response.ok) setNumbers((await response.json()).data ?? [])
    })
    return () => { live = false }
  }, [])
  if (!numbers.length) return null
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <div>
          <p className="text-sm font-semibold">{t("title")}</p>
          <p className="text-xs text-muted-foreground">{t("tenantHint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {numbers.map((row) => (
            <div key={row.id} className="rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <div className="text-sm font-semibold tabular-nums">{row.e164}</div>
              {row.label ? <div className="text-[11px] text-muted-foreground">{row.label}</div> : null}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
