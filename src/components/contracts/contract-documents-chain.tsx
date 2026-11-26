"use client"

/**
 * «Sənəd zənciri» in the contract card (owner 2026-11-25, mock «Протокол цены
 * и акт»): contract → price protocol → invoices → acceptance acts, each link
 * with its state, and the missing one lit with the button that makes it.
 * Below, the protocols and the invoices with their acts.
 */
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { FileDown, FilePlus2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Hint } from "@/components/hint"
import { moneyText } from "@/lib/clm/contract-documents"

interface DocRow {
  id: string
  kind: "price_protocol" | "acceptance_act"
  number: number
  status: "draft" | "in_signing" | "signed" | "cancelled"
  documentDate: string
  validFrom: string | null
  validTo: string | null
  invoiceId: string | null
  currency: string
  totalAmount: number
  invoice: { id: string; invoiceNumber: string } | null
}
interface InvoiceRow {
  id: string
  invoiceNumber: string
  status: string
  totalAmount: number
  currency: string
  act: { id: string; status: DocRow["status"] } | null
}
interface ChainData {
  contract: { status: string; signedAt: string | null }
  documents: DocRow[]
  activeProtocol: { id: string; number: number; signed: boolean } | null
  invoices: InvoiceRow[] | null
}

const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10).split("-").reverse().join(".") : "…")

export function ContractDocumentsChain({ contractId, canWrite, canInvoice }: { contractId: string; canWrite: boolean; canInvoice: boolean }) {
  const t = useTranslations("contractDocuments")
  const router = useRouter()
  const [data, setData] = useState<ChainData | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/documents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => setData(json?.success ? (json.data as ChainData) : null))
      .catch(() => setData(null))
  }, [contractId])
  useEffect(load, [load])

  const create = async (key: string, body: Record<string, unknown>) => {
    setBusy(key)
    setError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(json?.code === "CONTRACT_NOT_IN_FORCE" ? t("errNotInForce") : t("errCreate"))
        return
      }
      router.push(`/contracts/${contractId}/documents/${json.data.id}`)
    } finally {
      setBusy(null)
    }
  }

  const createInvoice = async () => {
    setBusy("invoice")
    setError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/create-invoice`, { method: "POST" })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(t("errInvoice"))
        return
      }
      router.push(`/invoices/${json.data.id}`)
    } finally {
      setBusy(null)
    }
  }

  if (!data) return null

  const statusLabel = (status: DocRow["status"]) => t(`status_${status}`)
  const statusClass = (status: DocRow["status"]) =>
    status === "signed"
      ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
      : status === "cancelled"
        ? "bg-muted text-muted-foreground line-through"
        : status === "in_signing"
          ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
          : "bg-muted text-foreground"

  const protocols = data.documents.filter((d) => d.kind === "price_protocol")
  const latestProtocol = protocols.find((p) => p.status !== "cancelled") ?? null
  const invoices = data.invoices
  const actsDone = invoices ? invoices.filter((i) => i.act && i.act.status !== "cancelled").length : 0
  const contractSigned = Boolean(data.contract.signedAt)
  const needs = !latestProtocol ? 2 : invoices && invoices.length === 0 ? 3 : invoices && actsDone < invoices.length ? 4 : 0
  const linkClass = (n: number, done: boolean) =>
    `flex min-w-0 flex-col gap-1.5 rounded-lg border p-3 ${needs === n ? "border-primary bg-primary/5" : done ? "border-emerald-300 dark:border-emerald-800" : ""}`

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" data-testid="contract-documents-chain">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <span className="text-xs text-muted-foreground">{t("subtitle")}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div className={linkClass(1, contractSigned)} data-testid="chain-contract">
          <span className="text-[11px] font-bold text-muted-foreground">1</span>
          <b className="text-sm">{t("linkContract")}</b>
          <span className={`w-fit rounded-full px-2 py-0.5 text-[11px] ${contractSigned ? statusClass("signed") : statusClass("draft")}`}>
            {contractSigned ? t("status_signed") : t("contractNotSigned")}
          </span>
        </div>

        <div className={linkClass(2, latestProtocol?.status === "signed")} data-testid="chain-protocol">
          <span className="text-[11px] font-bold text-muted-foreground">2</span>
          <b className="text-sm">{t("linkProtocol")}</b>
          {latestProtocol ? (
            <Link href={`/contracts/${contractId}/documents/${latestProtocol.id}`} className="w-fit">
              <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(latestProtocol.status)}`}>
                {t("annex", { n: latestProtocol.number })} · {statusLabel(latestProtocol.status)}
              </span>
            </Link>
          ) : (
            <span className="w-fit rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">{t("none")}</span>
          )}
          {canWrite && (
            <Hint text={latestProtocol ? t("newProtocolHint") : t("makeProtocolHint")} wrap>
              <Button size="sm" variant={latestProtocol ? "outline" : "default"} disabled={busy !== null} onClick={() => create("protocol", { kind: "price_protocol" })} data-testid="chain-make-protocol">
                {busy === "protocol" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="mr-1 h-3.5 w-3.5" />}
                {latestProtocol ? t("newProtocol") : t("makeProtocol")}
              </Button>
            </Hint>
          )}
        </div>

        <div className={linkClass(3, Boolean(invoices && invoices.length > 0))} data-testid="chain-invoices">
          <span className="text-[11px] font-bold text-muted-foreground">3</span>
          <b className="text-sm">{t("linkInvoices")}</b>
          <span className="text-xs text-muted-foreground">{invoices ? t("invoiceCount", { count: invoices.length }) : t("invoicesHidden")}</span>
          {canWrite && canInvoice && (
            <Hint text={data.activeProtocol ? t("makeInvoiceFromProtocolHint", { n: data.activeProtocol.number }) : t("makeInvoiceHint")} wrap>
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={createInvoice} data-testid="chain-make-invoice">
                {busy === "invoice" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <FilePlus2 className="mr-1 h-3.5 w-3.5" />}
                {t("makeInvoice")}
              </Button>
            </Hint>
          )}
        </div>

        <div className={linkClass(4, Boolean(invoices && invoices.length > 0 && actsDone === invoices.length))} data-testid="chain-acts">
          <span className="text-[11px] font-bold text-muted-foreground">4</span>
          <b className="text-sm">{t("linkActs")}</b>
          <span className="text-xs text-muted-foreground">{invoices ? t("actCount", { done: actsDone, total: invoices.length }) : t("invoicesHidden")}</span>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {(protocols.length > 0 || (invoices && invoices.length > 0)) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {protocols.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("protocols")}</h3>
              <ul className="divide-y rounded-md border text-sm">
                {protocols.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <Link href={`/contracts/${contractId}/documents/${p.id}`} className="font-medium hover:underline">
                      {t("annex", { n: p.number })}
                    </Link>
                    <span className="text-xs text-muted-foreground">{`${day(p.validFrom)} — ${day(p.validTo)}`}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(p.status)}`}>{statusLabel(p.status)}</span>
                    {data.activeProtocol?.id === p.id && (
                      <Hint text={data.activeProtocol.signed ? t("activeHint") : t("activeDraftHint")}>
                        <span tabIndex={0} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                          {t("active")}
                        </span>
                      </Hint>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {invoices && invoices.length > 0 && (
            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("invoicesAndActs")}</h3>
              <ul className="divide-y rounded-md border text-sm">
                {invoices.map((inv) => (
                  <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                    <Link href={`/invoices/${inv.id}`} className="font-medium hover:underline">
                      {inv.invoiceNumber}
                    </Link>
                    <span className="text-xs tabular-nums text-muted-foreground">{`${moneyText(inv.totalAmount)} ${inv.currency}`}</span>
                    {inv.act ? (
                      <Link href={`/contracts/${contractId}/documents/${inv.act.id}`}>
                        <span className={`rounded-full px-2 py-0.5 text-[11px] ${statusClass(inv.act.status)}`}>
                          {t("act")} · {statusLabel(inv.act.status)}
                        </span>
                      </Link>
                    ) : (
                      canWrite && (
                        <Hint text={t("makeActHint")} wrap>
                          <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => create(`act-${inv.id}`, { kind: "acceptance_act", invoiceId: inv.id })} data-testid={`chain-make-act-${inv.id}`}>
                            {busy === `act-${inv.id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <FileDown className="mr-1 h-3 w-3" />}
                            {t("makeAct")}
                          </Button>
                        </Hint>
                      )
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
