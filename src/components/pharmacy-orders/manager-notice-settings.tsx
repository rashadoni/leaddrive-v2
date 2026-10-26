"use client"

import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** One line above the orders: which numbers hear of a new order on WhatsApp, and a way to change them. */
export function ManagerNoticeSettings() {
  const t = useTranslations("pharmacyPhoneOrders")
  const [data, setData] = useState<{ phones: string[]; whatsapp: string | null } | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [state, setState] = useState<"idle" | "saving" | "invalid" | "failed">("idle")

  useEffect(() => {
    let live = true
    void fetch("/api/v1/pharmacy-orders/settings", { cache: "no-store" }).then(async response => {
      if (live && response.ok) setData((await response.json()).data)
    })
    return () => { live = false }
  }, [])

  if (!data) return null
  const save = async () => {
    setState("saving")
    const phones = (draft ?? "").split(/[,;\n]/u).map(phone => phone.trim()).filter(Boolean)
    const response = await fetch("/api/v1/pharmacy-orders/settings", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ phones }),
    })
    if (response.ok) { setData({ ...data, phones: (await response.json()).data.phones }); setDraft(null); setState("idle"); return }
    setState((await response.json().catch(() => ({})))?.error === "invalid_phone" ? "invalid" : "failed")
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border bg-card px-4 py-2.5 text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <span className="font-medium">{t("noticeTitle")}</span>
      {draft === null ? (
        <>
          <span className={data.phones.length ? "" : "text-muted-foreground"}>{data.phones.length ? data.phones.join(", ") : t("noticeNone")}</span>
          {!data.whatsapp ? <span className="text-xs font-semibold text-amber-600">{t("noticeNoChannel")}</span>
            : <span className="text-xs text-muted-foreground">{t("noticeFrom", { channel: data.whatsapp })}</span>}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => { setDraft(data.phones.join(", ")); setState("idle") }}>{t("noticeEdit")}</Button>
        </>
      ) : (
        <>
          <Input className="h-8 w-full sm:w-[320px]" value={draft} placeholder="+994 50 123 45 67, +994 55 …" onChange={event => setDraft(event.target.value)} />
          <Button size="sm" disabled={state === "saving"} onClick={() => void save()}>{t("save")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t("cancel")}</Button>
          {state === "invalid" ? <span className="text-xs text-red-600">{t("noticeInvalid")}</span> : null}
          {state === "failed" ? <span className="text-xs text-red-600">{t("errorGeneric")}</span> : null}
        </>
      )}
    </div>
  )
}
