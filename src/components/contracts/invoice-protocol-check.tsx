"use client"

/**
 * On an invoice of a contract: lines priced differently from the contract's
 * price protocol (owner 2026-11-25, mock «Протокол цены и акт»). Shown, not
 * blocked — a person may change a price, but writes why, and the reason goes
 * to the invoice's history. Nothing is drawn when the prices match or the
 * contract has no protocol.
 */
import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { AlertTriangle, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { moneyText, priceDeviations, type DocumentLine } from "@/lib/clm/contract-documents"

interface Item { productId?: string | null; name: string; unitPrice: number }

export function InvoiceProtocolCheck({ invoiceId, contractId, items, onRecorded }: { invoiceId: string; contractId: string; items: Item[]; onRecorded?: () => void }) {
  const t = useTranslations("contractDocuments")
  const [protocol, setProtocol] = useState<{ number: number; signed: boolean; lines: DocumentLine[] } | null>(null)
  const [reason, setReason] = useState("")
  const [state, setState] = useState<"idle" | "busy" | "saved" | "error">("idle")

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/documents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => !cancelled && setProtocol(json?.data?.activeProtocol ?? null))
      .catch(() => !cancelled && setProtocol(null))
    return () => {
      cancelled = true
    }
  }, [contractId])

  const deviations = useMemo(
    () => (protocol ? priceDeviations(items.map((i) => ({ productId: i.productId ?? null, name: i.name, unitPrice: i.unitPrice })), protocol.lines) : []),
    [items, protocol],
  )
  if (!protocol || deviations.length === 0) return null

  const record = async () => {
    setState("busy")
    const res = await fetch(`/api/v1/invoices/${encodeURIComponent(invoiceId)}/protocol-deviation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason.trim() }),
    }).catch(() => null)
    if (res?.ok) {
      setState("saved")
      onRecorded?.()
    } else setState("error")
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100" data-testid="invoice-protocol-deviation">
      <p className="flex items-center gap-2 font-medium">
        <AlertTriangle className="h-4 w-4" /> {t("deviationTitle", { count: deviations.length, n: protocol.number })}
      </p>
      <ul className="list-disc pl-6">
        {deviations.map((d) => (
          <li key={d.itemIndex}>{t("deviationLine", { name: d.name, invoice: moneyText(d.invoicePrice), protocol: moneyText(d.protocolPrice) })}</li>
        ))}
      </ul>
      {state === "saved" ? (
        <p className="text-emerald-700 dark:text-emerald-300">{t("deviationSaved")}</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Input className="min-w-0 flex-1 bg-background" placeholder={t("deviationReason")} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t("deviationReason")} />
          <Button size="sm" onClick={record} disabled={reason.trim().length < 3 || state === "busy"} data-testid="invoice-deviation-save">
            {state === "busy" && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            {t("deviationSave")}
          </Button>
        </div>
      )}
      {state === "error" && <p className="text-destructive">{t("errSave")}</p>}
      <p className="text-xs opacity-80">{t("deviationHelp")}</p>
    </div>
  )
}
