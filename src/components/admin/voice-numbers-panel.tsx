"use client"

import { useTranslations } from "next-intl"
import { useCallback, useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

type NumberRow = { id: string; e164: string; label: string | null; channelConfigId: string | null }
type Channel = { id: string; configName: string | null; isActive: boolean }

/** The tenant's phone numbers, assigned by the operator: a call on a number
 * goes to the organization that holds it. */
export function VoiceNumbersPanel({ tenantId }: { tenantId: string }) {
  const t = useTranslations("voiceLineNumbers")
  const [numbers, setNumbers] = useState<NumberRow[] | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [number, setNumber] = useState("")
  const [label, setLabel] = useState("")
  const [error, setError] = useState<"invalid" | "taken" | "generic" | null>(null)
  const [holder, setHolder] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const url = `/api/v1/admin/tenants/${tenantId}/voice-numbers`

  const apply = (body: { data?: { numbers: NumberRow[]; channels: Channel[] } }) => {
    if (body.data) { setNumbers(body.data.numbers); setChannels(body.data.channels) }
  }
  const load = useCallback(async () => {
    const response = await fetch(url, { cache: "no-store" })
    if (response.ok) apply(await response.json())
  }, [url])
  useEffect(() => { void load() }, [load])

  async function add() {
    setBusy(true); setError(null); setHolder(null)
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ number, label: label || undefined }) })
      const body = await response.json().catch(() => ({}))
      if (response.ok) { apply(body); setNumber(""); setLabel(""); return }
      setError(body.error === "number_taken" ? "taken" : body.error === "invalid_number" ? "invalid" : "generic")
      setHolder(body.holder ?? null)
    } finally { setBusy(false) }
  }
  async function remove(id: string) {
    setBusy(true)
    try {
      const response = await fetch(`${url}?numberId=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (response.ok) apply(await response.json())
    } finally { setBusy(false) }
  }

  return (
    <Card className="p-5">
      <h3 className="mb-1 text-base font-semibold">{t("title")}</h3>
      <p className="mb-4 text-xs text-muted-foreground">{t("adminHint")}</p>
      <div className="space-y-2">
        {numbers === null ? <p className="text-sm text-muted-foreground">{t("loading")}</p>
          : numbers.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p>
          : numbers.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-700">
              <div className="min-w-0">
                <div className="text-sm font-semibold tabular-nums">{row.e164}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {row.label ?? t("noLabel")}
                  {row.channelConfigId ? ` · ${channels.find((c) => c.id === row.channelConfigId)?.configName ?? ""}` : ""}
                </div>
              </div>
              <Button size="sm" variant="outline" className="text-red-600" disabled={busy} onClick={() => void remove(row.id)}>{t("remove")}</Button>
            </div>
          ))}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_1fr_auto] gap-2">
        <Input value={number} placeholder="+994 12 555 30 65" aria-label={t("number")} onChange={(event) => setNumber(event.target.value)} />
        <Input value={label} placeholder={t("labelPlaceholder")} aria-label={t("label")} onChange={(event) => setLabel(event.target.value)} />
        <Button disabled={busy || number.trim().length < 5} onClick={() => void add()}>{t("add")}</Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error === "taken" ? t("taken", { holder: holder ?? "—" }) : error === "invalid" ? t("invalid") : t("generic")}
        </p>
      ) : null}
    </Card>
  )
}
