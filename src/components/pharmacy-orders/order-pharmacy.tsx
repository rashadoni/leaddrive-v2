"use client"

import Link from "next/link"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

type Card = { id: string; name: string; address: string | null; city: string | null }
type Candidate = Card & { fitsWords: boolean }
export type OrderPharmacyValue = {
  identification: string; name: string | null; address: string | null; company: Card | null
}

const place = (card: Card) => [card.city, card.address].filter(Boolean).join(", ")

/**
 * The order's pharmacy: its card when known, else a choice. A number 1C
 * gives several pharmacies lists them, the one the caller's words fit
 * already marked; a search finds any other.
 */
export function OrderPharmacy({ orderId, pharmacy, busy, onSet }: {
  orderId: string; pharmacy: OrderPharmacyValue; busy: boolean; onSet: (companyId: string) => Promise<boolean>
}) {
  const t = useTranslations("pharmacyPhoneOrders")
  const [choosing, setChoosing] = useState(!pharmacy.company && pharmacy.identification !== "test_call")
  const testCall = pharmacy.identification === "test_call"

  if (pharmacy.company && !choosing) {
    return (
      <div className="mt-2 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
          <div className="min-w-0">
            <Link href={`/companies/${pharmacy.company.id}`} className="font-semibold text-primary hover:underline">{pharmacy.company.name} →</Link>
            <div className="truncate text-[11px] text-muted-foreground">{place(pharmacy.company) || "—"}</div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-600">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />{t(`identification.${pharmacy.identification}`)}
          </span>
        </div>
        <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setChoosing(true)}>{t("pharmacyChange")}</Button></div>
      </div>
    )
  }
  if (!choosing) {
    return (
      <div className="mt-2 flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">{t(testCall ? "testCallNote" : "unidentifiedNote")}</p>
        <div><Button size="sm" variant="outline" disabled={busy} onClick={() => setChoosing(true)}>{t("pharmacyChoose")}</Button></div>
      </div>
    )
  }
  return <PharmacyChooser orderId={orderId} busy={busy}
    onCancel={pharmacy.company || testCall ? () => setChoosing(false) : null}
    onSet={async companyId => { if (await onSet(companyId)) setChoosing(false) }} />
}

function PharmacyChooser({ orderId, busy, onCancel, onSet }: {
  orderId: string; busy: boolean; onCancel: (() => void) | null; onSet: (companyId: string) => Promise<void>
}) {
  const t = useTranslations("pharmacyPhoneOrders")
  const [query, setQuery] = useState("")
  const [result, setResult] = useState<{ query: string; spoken: string | null; byPhone: boolean; candidates: Candidate[] } | null>(null)
  const [failed, setFailed] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  useEffect(() => {
    const q = query.trim()
    if (q.length === 1) return
    let live = true
    const timer = setTimeout(async () => {
      const response = await fetch(`/api/v1/pharmacy-orders/${orderId}/pharmacies?q=${encodeURIComponent(q)}`, { cache: "no-store" })
      if (!live) return
      setFailed(!response.ok)
      if (!response.ok) return
      const data = (await response.json()).data
      setResult({ query: q, ...data })
      // The caller's words fit one of the number's pharmacies: mark it.
      if (!q) setPicked(current => current ?? data.candidates.find((candidate: Candidate) => candidate.fitsWords)?.id ?? null)
    }, q ? 300 : 0)
    return () => { live = false; clearTimeout(timer) }
  }, [orderId, query])

  const candidates = result?.candidates ?? []
  const chosen = candidates.find(candidate => candidate.id === picked) ?? null
  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      {result?.spoken ? <p>{t("pharmacySaid")} <span className="font-semibold">«{result.spoken}»</span></p> : null}
      {result && !result.query ? (
        <p className="text-xs text-muted-foreground">
          {candidates.length > 1 ? t("pharmacyShared", { count: candidates.length })
            : candidates.length === 1 ? t("pharmacyOne") : t("pharmacyNoneByPhone")}
        </p>
      ) : null}
      {failed ? <p className="text-red-600">{t("errorGeneric")}</p> : null}
      {result?.query && !candidates.length ? <p className="text-muted-foreground">{t("pickerEmpty")}</p> : null}
      <div className="flex flex-col gap-1.5">
        {candidates.map(candidate => (
          <button key={candidate.id} type="button" onClick={() => setPicked(candidate.id)}
            className={cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-left",
              picked === candidate.id ? "border-2 border-primary" : "border border-border hover:bg-muted/40")}>
            <span className={cn("h-3.5 w-3.5 shrink-0 rounded-full", picked === candidate.id ? "border-4 border-primary" : "border border-zinc-300")} />
            <span className="min-w-0">
              <span className="block font-semibold">{candidate.name}</span>
              <span className="block text-[11px] text-muted-foreground">
                {place(candidate) || "—"}{candidate.fitsWords ? <> · <span className="font-semibold text-emerald-600">{t("pharmacyFitsWords")}</span></> : null}
              </span>
            </span>
          </button>
        ))}
      </div>
      <Input value={query} placeholder={t("pharmacySearch")} onChange={event => { setQuery(event.target.value); setPicked(null) }} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !chosen} onClick={() => chosen && void onSet(chosen.id)}>
          {chosen ? t("pharmacyLinkTo", { name: chosen.name }) : t("pharmacyLink")}
        </Button>
        {onCancel ? <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>{t("cancel")}</Button> : null}
      </div>
    </div>
  )
}
