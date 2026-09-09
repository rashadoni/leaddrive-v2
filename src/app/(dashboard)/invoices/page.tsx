"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations, useLocale } from "next-intl"
import { useEnumLabelBy } from "@/lib/status-labels"
import { formatDate } from "@/lib/format-date"
import { useRouter, useSearchParams } from "next/navigation"
import { ColorStatCard } from "@/components/color-stat-card"
import { DataTable } from "@/components/data-table"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import { PageDescription } from "@/components/page-description"
import { HelpButton } from "@/components/help/help-button"
import { DidYouKnow } from "@/components/did-you-know"
import { InvoicesAnalytics } from "@/components/invoices/invoices-analytics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Plus, DollarSign, Clock, AlertTriangle, CheckCircle, Eye, Pencil, Trash2, Download, CalendarDays, TrendingUp, Send, FileText, BarChart3, XCircle, RefreshCw, List } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"

interface Invoice {
  id: string
  invoiceNumber: string
  title: string
  company?: { id: string; name: string }
  companyId?: string
  status: string
  totalAmount?: number
  currency: string
  dueDate?: string
  balanceDue?: number
  createdAt: string
}

interface InvoiceStats {
  totalInvoiced: number
  totalPaid: number
  totalOutstanding: number
  totalOverdue: number
  currency: string
  totalCount: number
  draftCount: number
  sentCount: number
  paidCount: number
  overdueCount: number
  partiallyPaidCount: number
  cancelledCount: number
  thisMonthCount: number
  thisMonthAmount: number
  thisYearCount: number
  thisYearAmount: number
  avgAmount: number
}

const statusBadge = (status: string, label: string) => {
  switch (status) {
    case "draft":
      return <Badge variant="secondary">{label}</Badge>
    case "sent":
      return <Badge variant="default">{label}</Badge>
    case "viewed":
      return <Badge variant="outline">{label}</Badge>
    case "partially_paid":
      return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">{label}</Badge>
    case "paid":
      return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{label}</Badge>
    case "overdue":
      return <Badge variant="destructive">{label}</Badge>
    case "cancelled":
      return <Badge variant="secondary" className="line-through">{label}</Badge>
    case "refunded":
      return <Badge variant="outline">{label}</Badge>
    default:
      return <Badge variant="secondary">{label}</Badge>
  }
}

import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

export default function InvoicesPage() {
  const { data: session } = useSession()
  const t = useTranslations("invoices")
  const tc = useTranslations("common")
  const locale = useLocale()
  const statusLabel = useEnumLabelBy("invoices", (v) => `status.${v}`, ["draft", "sent", "viewed", "partially_paid", "paid", "overdue", "cancelled", "refunded"])
  const router = useRouter()
  const searchParams = useSearchParams()
  const dealIdFilter = searchParams.get("dealId")
  useAutoTour("invoices")
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>("")
  const [tab, setTab] = useState<"analytics" | "list">("list")
  const [stats, setStats] = useState<InvoiceStats>({
    totalInvoiced: 0, totalPaid: 0, totalOutstanding: 0, totalOverdue: 0, currency: DEFAULT_CURRENCY,
    totalCount: 0, draftCount: 0, sentCount: 0, paidCount: 0, overdueCount: 0,
    partiallyPaidCount: 0, cancelledCount: 0, thisMonthCount: 0, thisMonthAmount: 0,
    thisYearCount: 0, thisYearAmount: 0, avgAmount: 0,
  })
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [editInvoice, setEditInvoice] = useState<Invoice | null>(null)
  const [editForm, setEditForm] = useState({ title: "", issueDate: "", dueDate: "", paymentTerms: "", currency: "", notes: "" })
  const [editLoading, setEditLoading] = useState(false)
  const orgId = (session?.user as { organizationId?: string })?.organizationId
  const headers: Record<string, string> = { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>) }

  const fetchStats = async () => {
    try {
      const res = await fetch("/api/v1/invoices/stats", {
        headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
      })
      const json = await res.json()
      if (json.success) setStats(json.data)
    } catch (err) { console.error(err) }
  }

  const fetchInvoices = async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `/api/v1/invoices?limit=500${statusFilter ? `&status=${statusFilter}` : ""}${dealIdFilter ? `&dealId=${dealIdFilter}` : ""}`,
        {
          headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
        }
      )
      const json = await res.json()
      if (json.success) setInvoices(json.data.invoices)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (session) {
      fetchStats()
      fetchInvoices()
    }
  }, [session, statusFilter])

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/invoices/${deleteId}`, {
      method: "DELETE",
      headers: orgId ? { "x-organization-id": String(orgId) } : {} as Record<string, string>,
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchInvoices()
    fetchStats()
  }

  function openEdit(item: Invoice, e: React.MouseEvent) {
    e.stopPropagation()
    setEditInvoice(item)
    setEditForm({
      title: item.title || "",
      issueDate: "",
      dueDate: item.dueDate ? new Date(item.dueDate).toISOString().split("T")[0] : "",
      paymentTerms: "",
      currency: item.currency || DEFAULT_CURRENCY,
      notes: "",
    })
  }

  async function handleSaveEdit() {
    if (!editInvoice) return
    setEditLoading(true)
    try {
      const body: Record<string, unknown> = { currency: editForm.currency }
      if (editForm.title) body.title = editForm.title
      if (editForm.dueDate) body.dueDate = editForm.dueDate
      if (editForm.paymentTerms) body.paymentTerms = editForm.paymentTerms
      if (editForm.notes) body.notes = editForm.notes
      await fetch(`/api/v1/invoices/${editInvoice.id}`, { method: "PUT", headers, body: JSON.stringify(body) })
      setEditInvoice(null)
      fetchInvoices()
    } finally {
      setEditLoading(false)
    }
  }

  const columns = [
    {
      key: "_index",
      label: "#",
      sortable: false,
      render: (_item: any, index?: number) => (
        <span className="text-xs text-muted-foreground">{(index ?? 0) + 1}</span>
      ),
    },
    {
      key: "invoiceNumber",
      label: t("colNumber"),
      hint: t("hintColNumber"),
      sortable: true,
      render: (item: any) => (
        <span className="font-mono text-sm">{item.invoiceNumber}{item.recurringInvoiceId && <span className="ml-1.5 text-[10px] bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300 px-1 py-0.5 rounded font-sans">↻</span>}</span>
      ),
    },
    {
      key: "company",
      label: t("colCompany"),
      sortable: true,
      render: (item: any) => item.company?.name ?? "—",
    },
    {
      key: "title",
      label: t("colTitle"),
      sortable: true,
    },
    {
      key: "totalAmount",
      label: t("colAmount"),
      hint: t("hintColAmount"),
      sortable: true,
      render: (item: any) => (
        <span className="font-medium">
          {item.totalAmount != null ? item.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}{" "}
          {item.currency}
        </span>
      ),
    },
    {
      key: "status",
      label: t("colStatus"),
      hint: t("hintColStatus"),
      sortable: true,
      render: (item: any) => statusBadge(item.status, statusLabel(item.status)),
    },
    {
      key: "dueDate",
      label: t("colDueDate"),
      hint: t("hintColDueDate"),
      sortable: true,
      render: (item: any) =>
        item.dueDate ? formatDate(item.dueDate, locale) : "—",
    },
    {
      key: "balanceDue",
      label: t("colBalanceDue"),
      hint: t("hintColBalance"),
      sortable: true,
      render: (item: any) => (
        <span className="font-medium">
          {item.balanceDue != null ? item.balanceDue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—"}{" "}
          {item.currency}
        </span>
      ),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      render: (item: any) => (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
            title={t("view")}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); router.push(`/invoices/${item.id}`) }}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
            title={tc("edit")}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); router.push(`/invoices/${item.id}/edit`) }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-accent"
            title={t("downloadPdf")}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); window.open(`/api/v1/invoices/${item.id}/pdf?stamp=true`, "_blank") }}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive/70 hover:text-destructive hover:bg-destructive/10"
            title={t("delete")}
            onClick={(e: React.MouseEvent) => { e.stopPropagation(); setDeleteId(item.id); setDeleteName(item.invoiceNumber) }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ]

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <div className="animate-pulse h-96 bg-muted rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">{t("title")} <TourReplayButton tourId="invoices" /><HelpButton slug="invoices" variant="label" /></h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Tab switcher */}
          <div className="flex items-center rounded-lg border border-zinc-200 dark:border-zinc-700 bg-muted/50 p-0.5">
            <button
              onClick={() => setTab("analytics")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === "analytics" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <BarChart3 className="h-4 w-4" />
              {tc("analytics")}
            </button>
            <button
              onClick={() => setTab("list")}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                tab === "list" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <List className="h-4 w-4" />
              {tc("list")}
            </button>
          </div>
          <Button variant="outline" onClick={() => router.push("/invoices/recurring")}>
            <RefreshCw className="h-4 w-4 mr-1" /> {t("recurringInvoices")}
          </Button>
          <Button data-tour-id="invoices-new" onClick={() => router.push("/invoices/create")}>
            <Plus className="h-4 w-4 mr-1" /> {t("newInvoice")}
          </Button>
        </div>
      </div>
      <PageDescription text={t("pageDescription")} />

      <DidYouKnow page="invoices" className="mb-4" />

      {/* Row 1 — Financial summary */}
      <div data-tour-id="invoices-stats" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ColorStatCard
          label={t("statTotalInvoiced")}
          value={`${stats.totalInvoiced.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stats.currency}`}
          icon={<DollarSign className="h-5 w-5" />}
         
          hint={t("hintTotalInvoiced")}
        />
        <ColorStatCard
          label={t("statPaid")}
          value={`${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stats.currency}`}
          icon={<CheckCircle className="h-5 w-5" />}
         
          hint={t("hintTotalPaid")}
        />
        <ColorStatCard
          label={t("statOutstanding")}
          value={`${stats.totalOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stats.currency}`}
          icon={<Clock className="h-5 w-5" />}
         
          hint={t("hintTotalOutstanding")}
        />
        <ColorStatCard
          label={t("statOverdue")}
          value={`${stats.totalOverdue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${stats.currency}`}
          icon={<AlertTriangle className="h-5 w-5" />}
         
          hint={t("hintTotalOverdue")}
        />
      </div>

      {tab === "analytics" ? (
        <>
          {/* Row 2 — Detailed analytics (clickable filters) */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { icon: <CalendarDays className="h-3.5 w-3.5" />, label: t("thisMonth"), value: `${stats.thisMonthCount}`, sub: `${stats.thisMonthAmount.toLocaleString()} ${stats.currency}`, filter: null },
              { icon: <TrendingUp className="h-3.5 w-3.5" />, label: t("thisYear"), value: `${stats.thisYearCount}`, sub: `${stats.thisYearAmount.toLocaleString()} ${stats.currency}`, filter: null },
              { icon: <Send className="h-3.5 w-3.5" />, label: t("statSentCount"), value: `${stats.sentCount}`, sub: `${stats.totalCount} ${t("ofTotal")}`, filter: "sent" },
              { icon: <FileText className="h-3.5 w-3.5" />, label: t("statDrafts"), value: `${stats.draftCount}`, sub: t("notSent"), filter: "draft" },
              { icon: <BarChart3 className="h-3.5 w-3.5" />, label: t("statAvgInvoice"), value: `${Math.round(stats.avgAmount).toLocaleString()}`, sub: stats.currency, filter: null },
              { icon: <XCircle className="h-3.5 w-3.5" />, label: t("statPartialCancel"), value: `${stats.partiallyPaidCount} / ${stats.cancelledCount}`, sub: t("partialCancelSub"), filter: "partially_paid" },
            ].map(({ icon, label, value, sub, filter }) => (
              <div
                key={label}
                onClick={() => filter && setStatusFilter(prev => prev === filter ? "" : filter)}
                className={`rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card p-3 space-y-1 transition-all ${filter ? "cursor-pointer hover:border-primary hover:shadow-sm" : ""} ${filter && statusFilter === filter ? "border-primary bg-primary/5 shadow-sm" : ""}`}
              >
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  {icon}
                  <span className="text-xs font-medium">{label}</span>
                  {filter && statusFilter === filter && <span className="ml-auto text-xs text-primary font-medium">✕</span>}
                </div>
                <p className="text-lg font-bold">{value} <span className="text-xs font-normal text-muted-foreground">{t("invoiceShort")}</span></p>
                <p className="text-xs text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>

          {/* Payment progress bar */}
          {stats.totalInvoiced > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-card px-4 py-3 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">{t("paymentProgress")}</span>
                <span className="text-muted-foreground">
                  {stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / {stats.totalInvoiced.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {stats.currency}
                  {" "}·{" "}
                  <span className="font-semibold text-green-600">{Math.round((stats.totalPaid / stats.totalInvoiced) * 100)}%</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all duration-500"
                  style={{ width: `${Math.min((stats.totalPaid / stats.totalInvoiced) * 100, 100)}%` }}
                />
              </div>
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-green-500" />{t("status.paid")}: {stats.paidCount} {t("invoiceShort")}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-orange-400" />{t("waiting")}: {stats.sentCount} {t("invoiceShort")}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-red-500" />{t("status.overdue")}: {stats.overdueCount} {t("invoiceShort")}</span>
                <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-full bg-yellow-400" />{t("status.partially_paid")}: {stats.partiallyPaidCount} {t("invoiceShort")}</span>
              </div>
            </div>
          )}

          {/* Analytics charts */}
          <InvoicesAnalytics
            invoices={invoices.map(inv => ({
              id: inv.id,
              invoiceNumber: inv.invoiceNumber,
              title: inv.title,
              amount: inv.totalAmount || 0,
              paidAmount: (inv as any).paidAmount || 0,
              status: inv.status,
              currency: inv.currency,
              dueDate: inv.dueDate,
              company: inv.company ? { name: inv.company.name } : undefined,
              createdAt: inv.createdAt,
            }))}
            stats={{
              totalInvoiced: stats.totalInvoiced,
              totalPaid: stats.totalPaid,
              totalOutstanding: stats.totalOutstanding,
              totalOverdue: stats.totalOverdue,
            }}
            currency={stats.currency || DEFAULT_CURRENCY}
          />
        </>
      ) : (
        <>
          <div className="flex items-center gap-4">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-[200px]"
            >
              <option value="">{t("statusAll")}</option>
              <option value="draft">{t("status.draft")}</option>
              <option value="sent">{t("status.sent")}</option>
              <option value="paid">{t("status.paid")}</option>
              <option value="overdue">{t("status.overdue")}</option>
              <option value="partially_paid">{t("status.partially_paid")}</option>
              <option value="cancelled">{t("status.cancelled")}</option>
            </Select>
          </div>

          <div data-tour-id="invoices-list"><DataTable
            columns={columns}
            data={invoices}
            searchPlaceholder={t("searchPlaceholder")}
            searchKey="invoiceNumber"
            onRowClick={(item: any) => router.push(`/invoices/${item.id}`)}
            rowClassName={(item: any) => {
              if (item.status === "overdue") return "bg-red-50/60 dark:bg-red-950/20"
              if (item.status === "paid") return "bg-green-50/60 dark:bg-green-950/20"
              if (item.status === "partially_paid") return "bg-yellow-50/60 dark:bg-yellow-950/20"
              return ""
            }}
          /></div>
        </>
      )}

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        onConfirm={handleDelete}
        title={t("deleteInvoice")}
        itemName={deleteName}
      />

      {/* Edit Dialog */}
      <Dialog open={!!editInvoice} onOpenChange={(open) => { if (!open) setEditInvoice(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5" />
              {tc("edit")} — {editInvoice?.invoiceNumber}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("title")}</Label>
              <Input value={editForm.title} onChange={(e) => setEditForm(p => ({ ...p, title: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>{t("dueDate")}</Label>
                <Input type="date" value={editForm.dueDate} onChange={(e) => setEditForm(p => ({ ...p, dueDate: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>{t("paymentTerms")}</Label>
                <Select value={editForm.paymentTerms} onChange={(e) => setEditForm(p => ({ ...p, paymentTerms: e.target.value }))}>
                  <option value="">{tc("select")}</option>
                  <option value="dueOnReceipt">{t("dueOnReceipt")}</option>
                  <option value="net15">{t("net15")}</option>
                  <option value="net30">{t("net30")}</option>
                  <option value="net45">{t("net45")}</option>
                  <option value="net60">{t("net60")}</option>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t("currency")}</Label>
              <Select value={editForm.currency} onChange={(e) => setEditForm(p => ({ ...p, currency: e.target.value }))}>
                {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                  <option key={code} value={code}>{code} {sym}</option>
                ))}
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("notes")}</Label>
              <Textarea value={editForm.notes} onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditInvoice(null)} disabled={editLoading}>{tc("cancel")}</Button>
            <Button onClick={handleSaveEdit} disabled={editLoading}>
              {editLoading ? <span className="flex items-center gap-2"><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />{tc("saving")}</span> : tc("save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
