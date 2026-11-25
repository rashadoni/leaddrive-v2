"use client"

/**
 * «Sənədlər» in the client portal — the counterparty's cabinet (owner
 * 2026-11-25, mock «Кабинет контрагента»; rules in src/lib/portal-documents.ts):
 *   PortalDocumentsHome   — what waits for this person's signature, then the company's contracts;
 *   PortalContractView    — one contract's chain: contract, protocols, invoices, acts, PDFs.
 * «İmzala» asks for a fresh signing link and opens the same signing page as the e-mail.
 */
import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, FileDown, Loader2, PenLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import { moneyText } from "@/lib/clm/contract-documents"

interface Waiting {
  signerId: string
  envelopeId: string
  contractId: string
  contractNumber: string
  title: string
  kind: "contract" | "price_protocol" | "acceptance_act"
  number: number | null
  sentAt: string | null
  canSignNow: boolean
}
interface ContractRow { id: string; contractNumber: string; title: string; status: string; startDate: string | null; endDate: string | null; signed: boolean }

const day = (iso: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join(".") : "…")
const timeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return "UTC"
  }
}

function useLang() {
  const locale = useLocale()
  return locale === "ru" || locale === "en" ? locale : "az"
}

function WaitingCards({ items, onError }: { items: Waiting[]; onError: (code: string) => void }) {
  const t = useTranslations("portal.documents")
  const [busy, setBusy] = useState<string | null>(null)
  const sign = async (item: Waiting) => {
    setBusy(item.signerId)
    try {
      const res = await fetch("/api/v1/public/portal-documents/sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signerId: item.signerId }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        onError(json?.code ?? "FAILED")
        return
      }
      window.location.assign(json.data.url as string)
    } finally {
      setBusy(null)
    }
  }
  if (items.length === 0) return null
  return (
    <section className="space-y-2" data-testid="portal-documents-waiting">
      <h2 className="text-base font-semibold">{t("waitingTitle", { count: items.length })}</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <article key={item.signerId} className="space-y-2 rounded-lg border border-primary/40 bg-primary/5 p-3">
            <b className="block text-sm">{item.title}</b>
            <span className="block text-xs text-muted-foreground">{t("waitingMeta", { number: item.contractNumber, date: day(item.sentAt) })}</span>
            <div className="flex flex-wrap items-center gap-2">
              {item.canSignNow ? (
                <Button size="sm" onClick={() => void sign(item)} disabled={busy !== null} data-testid={`portal-sign-${item.signerId}`}>
                  {busy === item.signerId ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1 h-3.5 w-3.5" />}
                  {t("sign")}
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">{t("waitingTurn")}</span>
              )}
              <Link href={`/portal/documents/${item.contractId}`} className="text-xs underline">
                {t("openContract")}
              </Link>
            </div>
          </article>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("signNote")}</p>
    </section>
  )
}

function errorText(t: ReturnType<typeof useTranslations>, code: string | null) {
  if (!code) return null
  if (code === "EXPIRED") return t("errExpired")
  if (code === "ALREADY_DONE") return t("errAlreadyDone")
  if (code === "DOCUMENTS_DISABLED" || code === "NO_COMPANY" || code === "MODULE_DISABLED") return t("errNoAccess")
  return t("errFailed")
}

export function PortalDocumentsHome() {
  const t = useTranslations("portal.documents")
  const [data, setData] = useState<{ contracts: ContractRow[]; waiting: Waiting[] } | null>(null)
  const [code, setCode] = useState<string | null>(null)
  useEffect(() => {
    fetch("/api/v1/public/portal-documents", { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, json: await r.json().catch(() => null) }))
      .then(({ ok, json }) => (ok && json?.success ? setData(json.data) : setCode(json?.code ?? "FAILED")))
      .catch(() => setCode("FAILED"))
  }, [])
  if (code && !data) return <p className="rounded-lg border p-4 text-sm text-muted-foreground" data-testid="portal-documents-error">{errorText(t, code)}</p>
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("loading")} />
  return (
    <div className="space-y-5" data-testid="portal-documents">
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      {code && <p className="text-sm text-destructive">{errorText(t, code)}</p>}
      <WaitingCards items={data.waiting} onError={setCode} />
      <section className="space-y-2">
        <h2 className="text-base font-semibold">{t("contracts")}</h2>
        {data.contracts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noContracts")}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {data.contracts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <b className="block break-words">{c.title}</b>
                  <span className="text-xs text-muted-foreground">{`${c.contractNumber} · ${day(c.startDate)} — ${day(c.endDate)}`}</span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px]">{t(`contractStatus_${c.status}`)}</span>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/portal/documents/${c.id}`}>{t("open")}</Link>
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

interface ContractData {
  contract: { id: string; contractNumber: string; title: string; status: string; startDate: string | null; endDate: string | null; signedAt: string | null; currency: string; hasSignedCopy: boolean }
  documents: Array<{ id: string; kind: "price_protocol" | "acceptance_act"; number: number; status: "in_signing" | "signed"; documentDate: string; validFrom: string | null; validTo: string | null; totalAmount: number; currency: string; invoice: { invoiceNumber: string } | null }>
  invoices: Array<{ id: string; invoiceNumber: string; status: string; totalAmount: number; currency: string; issueDate: string; url: string | null }>
  waiting: Waiting[]
}

export function PortalContractView({ contractId }: { contractId: string }) {
  const t = useTranslations("portal.documents")
  const lang = useLang()
  const [data, setData] = useState<ContractData | null>(null)
  const [code, setCode] = useState<string | null>(null)
  const load = useCallback(() => {
    fetch(`/api/v1/public/portal-documents/${encodeURIComponent(contractId)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, status: r.status, json: await r.json().catch(() => null) }))
      .then(({ ok, status, json }) => (ok && json?.success ? setData(json.data) : setCode(status === 404 ? "NOT_FOUND" : json?.code ?? "FAILED")))
      .catch(() => setCode("FAILED"))
  }, [contractId])
  useEffect(load, [load])

  const pdf = (opts: { doc?: string; signed?: boolean }) => {
    const q = new URLSearchParams({ lang, download: "1" })
    if (opts.doc) q.set("doc", opts.doc)
    if (opts.signed) {
      q.set("signed", "1")
      q.set("tz", timeZone())
    }
    return `/api/v1/public/portal-documents/${encodeURIComponent(contractId)}/pdf?${q.toString()}`
  }

  if (code === "NOT_FOUND") return <p className="rounded-lg border p-4 text-sm text-muted-foreground">{t("notFound")}</p>
  if (code && !data) return <p className="rounded-lg border p-4 text-sm text-muted-foreground">{errorText(t, code)}</p>
  if (!data) return <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-label={t("loading")} />
  const protocols = data.documents.filter((d) => d.kind === "price_protocol")
  const acts = data.documents.filter((d) => d.kind === "acceptance_act")
  const docStatus = (s: "in_signing" | "signed") => (s === "signed" ? t("status_signed") : t("status_in_signing"))
  const PdfLink = ({ href, label, testId }: { href: string; label: string; testId?: string }) => (
    <a href={href} className="inline-flex items-center gap-1 text-xs underline" data-testid={testId}>
      <FileDown className="h-3.5 w-3.5" /> {label}
    </a>
  )

  return (
    <div className="space-y-4" data-testid="portal-contract">
      <Link href="/portal/documents" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("title")}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{`${data.contract.title} · ${data.contract.contractNumber}`}</h1>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{t(`contractStatus_${data.contract.status}`)}</span>
      </div>
      {code && <p className="text-sm text-destructive">{errorText(t, code)}</p>}
      <WaitingCards items={data.waiting} onError={setCode} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <section className="space-y-1.5 rounded-lg border p-3 text-sm" data-testid="portal-chain-contract">
          <span className="text-[11px] font-bold text-muted-foreground">1</span>
          <b className="block">{t("linkContract")}</b>
          <span className="block text-xs">{data.contract.signedAt ? t("status_signed") : t("contractNotSigned")}</span>
          {data.contract.hasSignedCopy ? <PdfLink href={pdf({ signed: true })} label={t("signedPdf")} testId="portal-contract-signed-pdf" /> : <PdfLink href={pdf({})} label="PDF" />}
        </section>
        <section className="space-y-1.5 rounded-lg border p-3 text-sm" data-testid="portal-chain-protocols">
          <span className="text-[11px] font-bold text-muted-foreground">2</span>
          <b className="block">{t("linkProtocols")}</b>
          {protocols.length === 0 && <span className="block text-xs text-muted-foreground">{t("none")}</span>}
          {protocols.map((p) => (
            <div key={p.id} className="space-y-0.5">
              <span className="block text-xs">{`${t("annex", { n: p.number })} · ${docStatus(p.status)}`}</span>
              <PdfLink href={pdf({ doc: p.id, signed: p.status === "signed" })} label={p.status === "signed" ? t("signedPdf") : "PDF"} />
            </div>
          ))}
        </section>
        <section className="space-y-1.5 rounded-lg border p-3 text-sm" data-testid="portal-chain-invoices">
          <span className="text-[11px] font-bold text-muted-foreground">3</span>
          <b className="block">{t("linkInvoices")}</b>
          {data.invoices.length === 0 && <span className="block text-xs text-muted-foreground">{t("none")}</span>}
          {data.invoices.map((inv) => (
            <div key={inv.id} className="text-xs">
              {inv.url ? (
                <a href={inv.url} className="underline">
                  {inv.invoiceNumber}
                </a>
              ) : (
                inv.invoiceNumber
              )}
              {` · ${moneyText(inv.totalAmount)} ${inv.currency} · ${t(`invoiceStatus_${inv.status}`)}`}
            </div>
          ))}
        </section>
        <section className="space-y-1.5 rounded-lg border p-3 text-sm" data-testid="portal-chain-acts">
          <span className="text-[11px] font-bold text-muted-foreground">4</span>
          <b className="block">{t("linkActs")}</b>
          {acts.length === 0 && <span className="block text-xs text-muted-foreground">{t("none")}</span>}
          {acts.map((a) => (
            <div key={a.id} className="space-y-0.5">
              <span className="block text-xs">{`${t("actN", { n: a.number })}${a.invoice ? ` · ${a.invoice.invoiceNumber}` : ""} · ${docStatus(a.status)}`}</span>
              <PdfLink href={pdf({ doc: a.id, signed: a.status === "signed" })} label={a.status === "signed" ? t("signedPdf") : "PDF"} />
            </div>
          ))}
        </section>
      </div>
      <p className="text-xs text-muted-foreground">{t("invoiceNote")}</p>
    </div>
  )
}
