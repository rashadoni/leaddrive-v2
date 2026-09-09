"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { usePayables, usePayablesStats, useCreateBill, useUpdateBill, useDeleteBill, useCreateBillPayment } from "@/lib/finance/hooks"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Cell,
} from "recharts"
import { Plus, DollarSign, AlertTriangle, Clock, CreditCard, Trash2, ArrowRight, XCircle } from "lucide-react"
import type { Bill } from "@/lib/finance/types"
import { getCurrencySymbol } from "@/lib/constants"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

type CreateBillMutation = ReturnType<typeof useCreateBill>
type CreateBillPaymentMutation = ReturnType<typeof useCreateBillPayment>

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground/70",
  pending: "bg-blue-100 text-blue-700",
  partially_paid: "bg-amber-100 text-amber-700",
  paid: "bg-green-100 text-green-700",
  overdue: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
}

export function APDashboard() {
  const t = useTranslations("finance.ap")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const hasCustomRange = !!dateFrom && !!dateTo

  const { data: bills, isLoading: billsLoading } = usePayables()
  const { data: stats, isLoading: statsLoading } = usePayablesStats(
    hasCustomRange ? { dateFrom, dateTo } : undefined,
  )
  const createBill = useCreateBill()
  const updateBill = useUpdateBill()
  const deleteBill = useDeleteBill()
  const createPayment = useCreateBillPayment()
  const [showCreate, setShowCreate] = useState(false)
  const [showPayment, setShowPayment] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  if (billsLoading || statsLoading) return <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    if (!bills) return
    if (selected.size === bills.length) setSelected(new Set())
    else setSelected(new Set(bills.map((b: Bill) => b.id)))
  }
  const clearSelection = () => setSelected(new Set())

  const bulkUpdateStatus = (status: string) => {
    selected.forEach((id) => updateBill.mutate({ id, status }))
    clearSelection()
  }
  const bulkDelete = () => {
    if (!confirm(t("confirmBulkDelete", { count: selected.size }))) return
    selected.forEach((id) => deleteBill.mutate(id))
    clearSelection()
  }

  const selectedBills = bills?.filter((b: Bill) => selected.has(b.id)) || []
  const deepLinkedBillId = searchParams.get("billId")
  const focusedBill = bills?.find((bill: Bill) => bill.id === deepLinkedBillId) || (selectedBills.length === 1 ? selectedBills[0] : null)
  const canBulkPending = selectedBills.some((b: Bill) => b.status === "draft" || b.status === "overdue")
  const canBulkCancel = selectedBills.some((b: Bill) => !["paid", "cancelled"].includes(b.status))

  const AGING_COLORS = ["#22c55e", "#f59e0b", "#f97316", "#ef4444"]

  return (
    <div className="space-y-6">
      {/* Date range filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          min={dateFrom || undefined}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        />
        {hasCustomRange && (
          <button
            onClick={() => { setDateFrom(""); setDateTo("") }}
            className="h-9 px-3 rounded-md border border-input text-sm hover:bg-muted transition-colors"
          >
            {t("clearRange")}
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <SummaryCard title={t("totalPayables")} value={`${fmt(stats?.total || 0)} ${getCurrencySymbol()}`} icon={<CreditCard className="w-5 h-5" />} color="#8b5cf6" />
        <SummaryCard title={t("overdueTotal")} value={`${fmt(stats?.overdueTotal || 0)} ${getCurrencySymbol()}`} icon={<AlertTriangle className="w-5 h-5" />} color="#ef4444" />
        <SummaryCard title={t("overdueCount")} value={String(stats?.overdueCount || 0)} icon={<Clock className="w-5 h-5" />} color="#f59e0b" />
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("billsTitle")}</h3>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> {t("newBill")}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Aging Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("agingTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.aging?.some((b) => b.amount > 0) ? (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.aging}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmt(v)} />
                  <Tooltip formatter={(value) => [`${fmt(Number(value ?? 0))} ${getCurrencySymbol()}`, t("tooltipAmount")]} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {stats.aging.map((_, i) => (
                      <Cell key={i} fill={AGING_COLORS[i]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">{t("noData")}</div>
            )}
          </CardContent>
        </Card>

        {/* Top Vendors */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">{t("topVendors")}</CardTitle>
          </CardHeader>
          <CardContent>
            {stats?.topVendors && stats.topVendors.length > 0 ? (
              <div className="space-y-2">
                {stats.topVendors.map((v, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-muted-foreground w-5">{i + 1}</span>
                      <div>
                        <p className="text-sm font-medium">{v.vendorName}</p>
                        <p className="text-xs text-muted-foreground">{t("billCount", { count: v.billCount })}</p>
                      </div>
                    </div>
                    <p className="text-sm font-bold tabular-nums">{fmt(v.amount)} {getCurrencySymbol()}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-[220px] flex items-center justify-center text-sm text-muted-foreground">{t("noVendors")}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 p-3 rounded-lg border border-blue-200 bg-blue-50 dark:bg-blue-950/30 dark:border-blue-800">
          <span className="text-sm font-medium text-blue-800 dark:text-blue-300">
            {t("selected", { count: selected.size })}
          </span>
          <div className="flex gap-2 ml-auto">
            {canBulkPending && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={() => bulkUpdateStatus("pending")}>
                <ArrowRight className="w-3 h-3 mr-1" /> {t("toWork")}
              </Button>
            )}
            {canBulkCancel && (
              <Button size="sm" variant="outline" className="h-7 text-xs text-amber-700" onClick={() => bulkUpdateStatus("cancelled")}>
                <XCircle className="w-3 h-3 mr-1" /> {t("bulkCancel")}
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 text-xs text-red-700" onClick={bulkDelete}>
              <Trash2 className="w-3 h-3 mr-1" /> {t("bulkDelete")}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={clearSelection}>
              {t("bulkDeselect")}
            </Button>
          </div>
        </div>
      )}

      {/* Bills Table */}
      <div className={`grid gap-4 ${focusedBill ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
        <Card>
          <CardContent className="pt-4">
            {bills && bills.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 px-2 w-8">
                      <input type="checkbox" checked={bills.length > 0 && selected.size === bills.length} onChange={toggleAll} className="rounded border-zinc-200 dark:border-zinc-700" />
                    </th>
                    <th className="py-2 px-2 font-medium text-muted-foreground">{t("colBillNumber")}</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground">{t("colVendor")}</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground">{t("colTitle")}</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground">{t("colStatus")}</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">{t("colAmount")}</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">{t("colBalance")}</th>
                    <th className="py-2 px-2 font-medium text-muted-foreground text-right">{t("colDueDate")}</th>
                    <th className="py-2 px-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map((bill: Bill) => {
                    const isOverdue = bill.status === "overdue" || (bill.dueDate && new Date(bill.dueDate) < new Date() && bill.balanceDue > 0 && !["paid", "cancelled"].includes(bill.status))
                    const isFocused = focusedBill?.id === bill.id
                    return (
                    <tr key={bill.id} className={`border-b last:border-0 hover:bg-muted/50 ${isOverdue ? "bg-red-50/50 dark:bg-red-950/20" : ""} ${selected.has(bill.id) ? "bg-blue-50/50 dark:bg-blue-950/20" : ""} ${isFocused ? "outline outline-1 outline-primary/40" : ""}`}>
                      <td className="py-2 px-2">
                        <input type="checkbox" checked={selected.has(bill.id)} onChange={() => toggleSelect(bill.id)} className="rounded border-zinc-200 dark:border-zinc-700" />
                      </td>
                      <td className="py-2 px-2 font-medium">{bill.billNumber}</td>
                      <td className="py-2 px-2">{bill.vendorName}</td>
                      <td className="py-2 px-2">{bill.title}</td>
                      <td className="py-2 px-2">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[bill.status] || ""}`}>
                          {{ draft: t("statusDraft"), pending: t("statusPending"), partially_paid: t("statusPartial"), paid: t("statusPaid"), overdue: t("statusOverdue"), cancelled: t("statusCancelled") }[bill.status] || bill.status}
                        </span>
                      </td>
                      <td className="py-2 px-2 text-right tabular-nums">{fmt(bill.totalAmount)}</td>
                      <td className="py-2 px-2 text-right tabular-nums font-bold">{fmt(bill.balanceDue)}</td>
                      <td className="py-2 px-2 text-right text-xs text-muted-foreground">
                        {bill.dueDate ? formatDate(bill.dueDate, locale) : "—"}
                      </td>
                      <td className="py-2 px-2 text-right">
                        <div className="flex gap-1 justify-end">
                          {bill.status === "draft" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={() => updateBill.mutate({ id: bill.id, status: "pending" })}>
                              <ArrowRight className="w-3 h-3 mr-1" /> {t("toWork")}
                            </Button>
                          )}
                          {bill.status !== "paid" && bill.status !== "cancelled" && (
                            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowPayment(bill.id)}>
                              <DollarSign className="w-3 h-3 mr-1" /> {t("pay")}
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500" onClick={() => { if (confirm(t("confirmDelete"))) deleteBill.mutate(bill.id) }}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
                </table>
              </div>
            ) : (
              <div className="py-12 text-center text-muted-foreground text-sm">{t("noBills")}</div>
            )}
          </CardContent>
        </Card>
        {focusedBill ? (
          <AdvisorRecordWidget entityType="bill" entityId={focusedBill.id} title="Advisor risk" />
        ) : null}
      </div>

      {/* Create Bill Dialog */}
      <CreateBillDialog open={showCreate} onClose={() => setShowCreate(false)} onCreate={createBill} />

      {/* Add Payment Dialog */}
      {showPayment && (
        <AddPaymentDialog billId={showPayment} onClose={() => setShowPayment(null)} onPay={createPayment} />
      )}
    </div>
  )
}

function CreateBillDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: CreateBillMutation }) {
  const t = useTranslations("finance.ap")
  const [form, setForm] = useState({ billNumber: "", vendorName: "", title: "", totalAmount: "", dueDate: "", category: "" })

  const handleSubmit = () => {
    if (!form.billNumber || !form.vendorName || !form.title || !form.totalAmount) return
    onCreate.mutate(
      { ...form, totalAmount: parseFloat(form.totalAmount) },
      { onSuccess: () => { onClose(); setForm({ billNumber: "", vendorName: "", title: "", totalAmount: "", dueDate: "", category: "" }) } }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("newBillTitle")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>{t("billNumber")} *</Label><Input value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} placeholder="BILL-001" /></div>
          <div><Label>{t("vendor")} *</Label><Input value={form.vendorName} onChange={(e) => setForm({ ...form, vendorName: e.target.value })} /></div>
          <div><Label>{t("billTitle")} *</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("amount")} *</Label><Input type="number" value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} placeholder="5000" /></div>
            <div><Label>{t("dueDate")}</Label><Input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
          </div>
          <div><Label>{t("category")}</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder={t("categoryPlaceholder")} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleSubmit} disabled={onCreate.isPending}>{onCreate.isPending ? t("creating") : t("createBill")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddPaymentDialog({ billId, onClose, onPay }: { billId: string; onClose: () => void; onPay: CreateBillPaymentMutation }) {
  const t = useTranslations("finance.ap")
  const [amount, setAmount] = useState("")
  const [ref, setRef] = useState("")

  const handleSubmit = () => {
    if (!amount) return
    onPay.mutate(
      { billId, amount: parseFloat(amount), reference: ref || undefined },
      { onSuccess: () => { onClose(); setAmount(""); setRef("") } }
    )
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("addPayment")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>{t("paymentAmount")} *</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1000" /></div>
          <div><Label>{t("paymentReference")}</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("paymentRefPlaceholder")} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleSubmit} disabled={onPay.isPending}>{onPay.isPending ? t("paying") : t("recordPayment")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SummaryCard({ title, value, icon, color }: { title: string; value: string; icon: React.ReactNode; color: string }) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-sm" style={{ background: `linear-gradient(135deg, ${color}08 0%, ${color}18 100%)`, borderColor: `${color}20` }}>
      <div className="absolute top-0 left-0 right-0 h-[3px] rounded-t-xl" style={{ backgroundColor: color }} />
      <div className="relative p-4 pt-5 flex justify-between items-center">
        <div>
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{title}</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{value}</p>
        </div>
        <div className="p-2.5 rounded-xl" style={{ color, backgroundColor: `${color}12` }}>{icon}</div>
      </div>
    </div>
  )
}
