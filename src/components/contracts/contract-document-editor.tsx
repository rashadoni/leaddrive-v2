"use client"

/**
 * A price protocol (Əlavə №N) or an acceptance act (Akt №N) of a contract
 * (src/lib/clm/contract-documents.ts): its lines, VAT and totals, the PDF.
 * A draft is edited here; once it went for signing it only reads.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { ArrowLeft, FileDown, Loader2, Plus, Search, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Hint } from "@/components/hint"
import { ConfirmDialog } from "@/components/delete-confirm-dialog"
import { ContractDocumentSigning } from "@/components/contracts/contract-document-signing"
import { documentTotals, lineAmount, moneyText } from "@/lib/clm/contract-documents"

interface EditLine {
  key: string
  productId: string | null
  name: string
  unit: string
  quantity: string
  unitPrice: string
}
interface Doc {
  id: string
  kind: "price_protocol" | "acceptance_act"
  number: number
  status: "draft" | "in_signing" | "signed" | "cancelled"
  documentDate: string
  validFrom: string | null
  validTo: string | null
  currency: string
  vatRate: number
  note: string | null
  invoice: { id: string; invoiceNumber: string } | null
  contract: { id: string; contractNumber: string; title: string }
  lines: Array<{ productId: string | null; name: string; unit: string | null; quantity: number | null; unitPrice: number }>
}
interface Product { id: string; name: string; unit: string | null; price: number }

const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : "")
let keySeq = 0
const nextKey = () => `l${++keySeq}`
const toEdit = (l: Doc["lines"][number]): EditLine => ({
  key: nextKey(),
  productId: l.productId,
  name: l.name,
  unit: l.unit ?? "",
  quantity: l.quantity === null ? "" : String(l.quantity),
  unitPrice: String(l.unitPrice),
})
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")))

export function ContractDocumentEditor({ contractId, docId }: { contractId: string; docId: string }) {
  const t = useTranslations("contractDocuments")
  const locale = useLocale()
  const router = useRouter()
  const [doc, setDoc] = useState<Doc | null>(null)
  const [missing, setMissing] = useState(false)
  const [lines, setLines] = useState<EditLine[]>([])
  const [documentDate, setDocumentDate] = useState("")
  const [validFrom, setValidFrom] = useState("")
  const [validTo, setValidTo] = useState("")
  const [vatRate, setVatRate] = useState("0.18")
  const [note, setNote] = useState("")
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [products, setProducts] = useState<Product[]>([])

  const load = useCallback(async () => {
    const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/documents/${encodeURIComponent(docId)}`).catch(() => null)
    const json = res?.ok ? await res.json().catch(() => null) : null
    if (!json?.success) {
      setMissing(true)
      return
    }
    const d = json.data as Doc
    setDoc(d)
    setLines(d.lines.map(toEdit))
    setDocumentDate(isoDay(d.documentDate))
    setValidFrom(isoDay(d.validFrom))
    setValidTo(isoDay(d.validTo))
    setVatRate(String(d.vatRate))
    setNote(d.note ?? "")
    setDirty(false)
  }, [contractId, docId])
  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!catalogOpen) return
    const handle = setTimeout(() => {
      fetch(`/api/v1/products?active=1&search=${encodeURIComponent(search)}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((json) => setProducts(((json?.data ?? []) as Product[]).slice(0, 20)))
        .catch(() => setProducts([]))
    }, 250)
    return () => clearTimeout(handle)
  }, [catalogOpen, search])

  const editable = doc?.status === "draft"
  const protocol = doc?.kind === "price_protocol"
  const parsedLines = useMemo(
    () => lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unitPrice) ?? 0 })),
    [lines],
  )
  const totals = documentTotals(parsedLines, Number(vatRate) || 0)
  const invalid = lines.some((l) => !l.name.trim() || Number.isNaN(num(l.unitPrice) ?? 0) || Number.isNaN(num(l.quantity) ?? 0) || (!protocol && num(l.quantity) === null))

  const change = (key: string, field: keyof EditLine, value: string) => {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, [field]: value } : l)))
    setDirty(true)
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/documents/${encodeURIComponent(docId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentDate,
          ...(protocol ? { validFrom: validFrom || null, validTo: validTo || null } : {}),
          vatRate: Number(vatRate) || 0,
          note: note.trim() || null,
          lines: lines.map((l) => ({
            productId: l.productId,
            name: l.name.trim(),
            unit: l.unit.trim() || null,
            quantity: num(l.quantity),
            unitPrice: num(l.unitPrice) ?? 0,
          })),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.success) {
        setError(json?.code === "NOT_DRAFT" ? t("errNotDraft") : json?.code === "INVALID_PERIOD" ? t("errPeriod") : t("errSave"))
        return
      }
      setDirty(false)
      setSaved(true)
      await load()
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  if (missing) return <div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">{t("notFound")}</div>
  if (!doc) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-card p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("loading")}
      </div>
    )
  }

  const title = protocol ? `${t("annex", { n: doc.number })} · ${t("protocolTitle")}` : `${t("actTitle", { n: doc.number })}`
  const pdfUrl = `/api/v1/contracts/${encodeURIComponent(contractId)}/documents/${encodeURIComponent(docId)}/pdf?lang=${locale === "ru" || locale === "en" ? locale : "az"}`

  return (
    <div className="space-y-4" data-testid="contract-document-editor">
      {/* A plain link, not a one-line button: the number and title of a contract are longer than a phone. */}
      <Link href={`/contracts/${contractId}`} className="flex w-fit max-w-full items-start gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-muted">
        <ArrowLeft className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="min-w-0 break-words">{`${doc.contract.contractNumber} · ${doc.contract.title}`}</span>
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium" data-testid="document-status">
          {t(`status_${doc.status}`)}
        </span>
      </div>
      {!protocol && doc.invoice && (
        <p className="text-sm text-muted-foreground">
          {t("actFromInvoice")}{" "}
          <Link href={`/invoices/${doc.invoice.id}`} className="font-medium text-foreground underline">
            {doc.invoice.invoiceNumber}
          </Link>
        </p>
      )}
      {protocol && <p className="text-sm text-muted-foreground">{t("protocolExplain")}</p>}

      <section className="space-y-4 rounded-xl border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label htmlFor="doc-date">{t("documentDate")}</Label>
            <Input id="doc-date" type="date" value={documentDate} disabled={!editable} onChange={(e) => { setDocumentDate(e.target.value); setDirty(true) }} />
          </div>
          {protocol && (
            <>
              <div>
                <Label htmlFor="doc-from">{t("validFrom")}</Label>
                <Input id="doc-from" type="date" value={validFrom} disabled={!editable} onChange={(e) => { setValidFrom(e.target.value); setDirty(true) }} />
              </div>
              <div>
                <Label htmlFor="doc-to">{t("validTo")}</Label>
                <Input id="doc-to" type="date" value={validTo} disabled={!editable} onChange={(e) => { setValidTo(e.target.value); setDirty(true) }} />
              </div>
            </>
          )}
          <div>
            <Label htmlFor="doc-vat">{t("vat")}</Label>
            <Select id="doc-vat" value={vatRate} disabled={!editable} onChange={(e) => { setVatRate(e.target.value); setDirty(true) }}>
              <option value="0.18">18%</option>
              <option value="0">{t("noVat")}</option>
              {!["0.18", "0"].includes(vatRate) && <option value={vatRate}>{`${Math.round(Number(vatRate) * 10000) / 100}%`}</option>}
            </Select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[640px] text-sm" data-testid="document-lines">
            <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-8 px-2 py-2">№</th>
                <th className="px-2 py-2">{t("colName")}</th>
                <th className="w-24 px-2 py-2">{t("colUnit")}</th>
                <th className="w-28 px-2 py-2 text-right">{protocol ? t("colQuantityOptional") : t("colQuantity")}</th>
                <th className="w-32 px-2 py-2 text-right">{t("colPrice")}</th>
                <th className="w-32 px-2 py-2 text-right">{t("colAmount")}</th>
                {editable && <th className="w-10" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.key} className="border-t align-top">
                  <td className="px-2 py-2 text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5">
                    <Input aria-label={t("colName")} value={l.name} disabled={!editable} onChange={(e) => change(l.key, "name", e.target.value)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input aria-label={t("colUnit")} value={l.unit} disabled={!editable} onChange={(e) => change(l.key, "unit", e.target.value)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input aria-label={t("colQuantity")} inputMode="decimal" className="text-right" value={l.quantity} disabled={!editable} onChange={(e) => change(l.key, "quantity", e.target.value)} />
                  </td>
                  <td className="px-2 py-1.5">
                    <Input aria-label={t("colPrice")} inputMode="decimal" className="text-right" value={l.unitPrice} disabled={!editable} onChange={(e) => change(l.key, "unitPrice", e.target.value)} />
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {num(l.quantity) === null ? "—" : moneyText(lineAmount({ quantity: num(l.quantity), unitPrice: num(l.unitPrice) ?? 0 }))}
                  </td>
                  {editable && (
                    <td className="px-1 py-1.5">
                      <Hint text={t("removeLine")}>
                        <Button variant="ghost" size="icon" className="h-9 w-9" aria-label={t("removeLine")} onClick={() => { setLines((ls) => ls.filter((x) => x.key !== l.key)); setDirty(true) }}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </Hint>
                    </td>
                  )}
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-sm text-muted-foreground">
                    {t("noLines")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => { setLines((ls) => [...ls, { key: nextKey(), productId: null, name: "", unit: "", quantity: protocol ? "" : "1", unitPrice: "0" }]); setDirty(true) }} data-testid="add-line">
              <Plus className="mr-1 h-4 w-4" /> {t("addLine")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCatalogOpen((o) => !o)} data-testid="add-from-catalog">
              <Search className="mr-1 h-4 w-4" /> {t("addFromCatalog")}
            </Button>
          </div>
        )}
        {editable && catalogOpen && (
          <div className="space-y-2 rounded-md border p-3" data-testid="catalog-picker">
            <div className="flex items-center gap-2">
              <Input autoFocus placeholder={t("catalogSearch")} value={search} onChange={(e) => setSearch(e.target.value)} />
              <Button variant="ghost" size="icon" aria-label={t("close")} onClick={() => setCatalogOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <ul className="divide-y text-sm">
              {products.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left hover:bg-muted"
                    onClick={() => {
                      setLines((ls) => [...ls, { key: nextKey(), productId: p.id, name: p.name, unit: p.unit ?? "", quantity: protocol ? "" : "1", unitPrice: String(p.price ?? 0) }])
                      setDirty(true)
                    }}
                  >
                    <span>{p.name}</span>
                    <span className="tabular-nums text-muted-foreground">{moneyText(Number(p.price) || 0)}</span>
                  </button>
                </li>
              ))}
              {products.length === 0 && <li className="px-2 py-1.5 text-muted-foreground">{t("catalogEmpty")}</li>}
            </ul>
          </div>
        )}

        <dl className="ml-auto grid w-full max-w-xs grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm" data-testid="document-totals">
          <dt className="text-muted-foreground">{t("subtotal")}</dt>
          <dd className="text-right tabular-nums">{`${moneyText(totals.subtotal)} ${doc.currency}`}</dd>
          <dt className="text-muted-foreground">{t("vatAmount")}</dt>
          <dd className="text-right tabular-nums">{`${moneyText(totals.vatAmount)} ${doc.currency}`}</dd>
          <dt className="font-semibold">{t("total")}</dt>
          <dd className="text-right font-semibold tabular-nums">{`${moneyText(totals.totalAmount)} ${doc.currency}`}</dd>
        </dl>

        <div>
          <Label htmlFor="doc-note">{t("note")}</Label>
          <Input id="doc-note" value={note} disabled={!editable} onChange={(e) => { setNote(e.target.value); setDirty(true) }} />
        </div>
      </section>

      {error && <p className="text-sm text-destructive" data-testid="document-error">{error}</p>}
      {saved && !dirty && <p className="text-sm text-emerald-700 dark:text-emerald-300">{t("saved")}</p>}

      <div className="flex flex-wrap justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Hint text={t("pdfHint")}>
            <Button variant="outline" onClick={() => window.open(pdfUrl, "_blank")} data-testid="document-pdf">
              <FileDown className="mr-1 h-4 w-4" /> PDF
            </Button>
          </Hint>
          {editable && (
            <Hint text={t("cancelDocHint")}>
              <Button variant="outline" onClick={() => setConfirmCancel(true)} data-testid="document-cancel">
                {t("cancelDoc")}
              </Button>
            </Hint>
          )}
        </div>
        {editable && (
          <Hint text={invalid ? t("invalidLines") : dirty ? null : t("nothingToSave")} wrap>
            <Button onClick={save} disabled={saving || invalid || !dirty} data-testid="document-save">
              {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {t("save")}
            </Button>
          </Hint>
        )}
      </div>

      {doc.status !== "cancelled" && (
        <ContractDocumentSigning
          contractId={contractId}
          docId={docId}
          status={doc.status}
          hasLines={doc.lines.length > 0}
          unsaved={dirty}
          onChanged={() => void load()}
        />
      )}

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("cancelDocTitle")}
        description={t("cancelDocDescription")}
        confirmLabel={t("cancelDoc")}
        onConfirm={async () => {
          const res = await fetch(`/api/v1/contracts/${encodeURIComponent(contractId)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" })
          if (!res.ok) throw new Error(t("errSave"))
          router.push(`/contracts/${contractId}`)
        }}
      />
    </div>
  )
}
