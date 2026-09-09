"use client"

import { useState } from "react"
import { useSearchParams } from "next/navigation"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import {
  usePaymentRegistry,
  usePaymentOrders,
  useCreatePaymentOrder,
  useDeletePaymentOrder,
  useSubmitPaymentOrder,
  useApprovePaymentOrder,
  useRejectPaymentOrder,
  useExecutePaymentOrder,
  useUpdatePaymentOrder,
  usePayables,
  useBankAccounts,
} from "@/lib/finance/hooks"
import { FinanceKpiCard } from "./finance-kpi-card"
import { BankAccountsManager } from "./bank-accounts"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import {
  ArrowDownLeft, ArrowUpRight, Activity, Clock, Plus, Send, Check, X, Play, Trash2, FileText, Building2, Edit2,
} from "lucide-react"
import type { BankAccount, Bill, PaymentRegistryFilters, PaymentOrder, CreatePaymentOrderInput } from "@/lib/finance/types"
import { AdvisorRecordWidget } from "@/components/ai/advisor-record-widget"

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-foreground/70",
  pending_approval: "bg-blue-100 text-blue-700",
  approved: "bg-amber-100 text-amber-700",
  executed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  cancelled: "bg-muted text-muted-foreground",
}

const DIRECTION_COLORS: Record<string, string> = {
  incoming: "bg-green-100 text-green-700",
  outgoing: "bg-red-100 text-red-700",
}

export function PaymentsDashboard() {
  const t = useTranslations("finance.pod")
  const locale = useLocale()
  const searchParams = useSearchParams()
  const [subTab, setSubTab] = useState("orders")
  const [filters, setFilters] = useState<PaymentRegistryFilters>({})
  const [registryPage, setRegistryPage] = useState(1)
  const [showCreate, setShowCreate] = useState(false)
  const [editOrderId, setEditOrderId] = useState<string | null>(null)
  const [showReject, setShowReject] = useState<string | null>(null)
  const [rejectReason, setRejectReason] = useState("")

  const { data: registryData, isLoading: registryLoading } = usePaymentRegistry(filters, registryPage)
  const { data: orders, isLoading: ordersLoading } = usePaymentOrders()
  const { data: bills } = usePayables()
  const { data: bankAccounts } = useBankAccounts()

  const createOrder = useCreatePaymentOrder()
  const deleteOrder = useDeletePaymentOrder()
  const submitOrder = useSubmitPaymentOrder()
  const approveOrder = useApprovePaymentOrder()
  const rejectOrder = useRejectPaymentOrder()
  const executeOrder = useExecutePaymentOrder()
  const updateOrder = useUpdatePaymentOrder()

  const registryStats = registryData?.stats
  const focusedPaymentOrderId = searchParams.get("paymentOrderId")
  const focusedPaymentOrder = orders?.find((order: PaymentOrder) => order.id === focusedPaymentOrderId) || null

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <FinanceKpiCard
          title={t("incomingPayments")}
          value={registryStats?.totalIncoming || 0}
          icon={<ArrowDownLeft className="w-5 h-5" />}
          color="#22c55e"
        />
        <FinanceKpiCard
          title={t("outgoingPayments")}
          value={registryStats?.totalOutgoing || 0}
          icon={<ArrowUpRight className="w-5 h-5" />}
          color="#8b5cf6"
        />
        <FinanceKpiCard
          title={t("netFlow")}
          value={registryStats?.netFlow || 0}
          icon={<Activity className="w-5 h-5" />}
          color="#3b82f6"
        />
        <FinanceKpiCard
          title={t("pendingExecution")}
          value={registryStats?.pendingOrdersCount || 0}
          icon={<Clock className="w-5 h-5" />}
          color="#f59e0b"
          currency=""
        />
      </div>

      {/* Sub-tabs */}
      <Tabs value={subTab} onValueChange={setSubTab}>
        <TabsList>
          <TabsTrigger value="orders" className="gap-1.5">
            <FileText className="w-4 h-4" />
            {t("orders")}
          </TabsTrigger>
          <TabsTrigger value="registry" className="gap-1.5">
            <Activity className="w-4 h-4" />
            {t("registry")}
          </TabsTrigger>
          <TabsTrigger value="bank-accounts" className="gap-1.5">
            <Building2 className="w-4 h-4" />
            {t("accountShort")}
          </TabsTrigger>
        </TabsList>

        {/* Payment Orders */}
        <TabsContent value="orders" className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">{t("orders")}</h3>
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className="w-4 h-4 mr-1" /> {t("newOrder")}
            </Button>
          </div>

          {ordersLoading ? (
            <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>
          ) : !orders?.length ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">{t("empty")}</CardContent></Card>
          ) : (
            <div className={`grid gap-4 ${focusedPaymentOrder ? "xl:grid-cols-[minmax(0,1fr)_360px]" : ""}`}>
              <Card>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/30">
                          <th className="text-left p-3 font-medium">{t("orderNumber")}</th>
                          <th className="text-left p-3 font-medium">{t("colCounterparty")}</th>
                          <th className="text-right p-3 font-medium">{t("colAmount")}</th>
                          <th className="text-left p-3 font-medium">{t("purpose")}</th>
                          <th className="text-left p-3 font-medium">{t("method")}</th>
                          <th className="text-center p-3 font-medium">{t("colStatus")}</th>
                          <th className="text-left p-3 font-medium">{t("colCreated")}</th>
                          <th className="text-right p-3 font-medium">{t("colActions")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map((o: PaymentOrder) => {
                          const isFocused = focusedPaymentOrder?.id === o.id
                          return (
                            <tr key={o.id} className={`border-b last:border-0 hover:bg-muted/20 transition-colors ${isFocused ? "outline outline-1 outline-primary/40" : ""}`}>
                              <td className="p-3 font-mono text-xs">{o.orderNumber}</td>
                              <td className="p-3">{o.counterpartyName}</td>
                              <td className="p-3 text-right font-medium tabular-nums">{fmt(o.amount)} {o.currency}</td>
                              <td className="p-3 max-w-[200px] truncate text-muted-foreground">{o.purpose}</td>
                              <td className="p-3 text-xs">{{ bank_transfer: t("methodBankTransfer"), cash: t("methodCash"), card: t("methodCard") }[o.paymentMethod] || o.paymentMethod}</td>
                              <td className="p-3 text-center">
                                <Badge variant="secondary" className={`text-[10px] ${STATUS_COLORS[o.status] || ""}`}>
                                  {{ draft: t("statusDraft"), pending_approval: t("statusPending"), approved: t("statusApproved"), executed: t("statusExecuted"), rejected: t("statusRejected"), cancelled: t("statusCancelled") }[o.status] || o.status}
                                </Badge>
                              </td>
                              <td className="p-3 text-xs text-muted-foreground">{formatDate(o.createdAt, locale)}</td>
                              <td className="p-3 text-right">
                                <div className="flex justify-end gap-1">
                                  {o.status === "draft" && (
                                    <>
                                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditOrderId(o.id)}>
                                        <Edit2 className="w-3 h-3 mr-1" /> {t("edit")}
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => submitOrder.mutate(o.id)}>
                                        <Send className="w-3 h-3 mr-1" /> {t("submit")}
                                      </Button>
                                      <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => deleteOrder.mutate(o.id)}>
                                        <Trash2 className="w-3 h-3" />
                                      </Button>
                                    </>
                                  )}
                                  {o.status === "pending_approval" && (
                                    <>
                                      <Button size="sm" variant="outline" className="h-7 text-xs text-green-700" onClick={() => approveOrder.mutate(o.id)}>
                                        <Check className="w-3 h-3 mr-1" /> {t("approveBtn")}
                                      </Button>
                                      <Button size="sm" variant="outline" className="h-7 text-xs text-red-700" onClick={() => { setShowReject(o.id); setRejectReason("") }}>
                                        <X className="w-3 h-3 mr-1" /> {t("rejectBtn")}
                                      </Button>
                                    </>
                                  )}
                                  {o.status === "approved" && (
                                    <Button size="sm" variant="outline" className="h-7 text-xs text-blue-700" onClick={() => executeOrder.mutate(o.id)}>
                                      <Play className="w-3 h-3 mr-1" /> {t("executeBtn")}
                                    </Button>
                                  )}
                                  {o.status === "rejected" && o.rejectionReason && (
                                    <span className="text-xs text-red-600 truncate max-w-[150px]" title={o.rejectionReason}>{o.rejectionReason}</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
              {focusedPaymentOrder ? (
                <AdvisorRecordWidget entityType="payment_order" entityId={focusedPaymentOrder.id} title="Advisor risk" />
              ) : null}
            </div>
          )}
        </TabsContent>

        {/* Registry */}
        <TabsContent value="registry" className="space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <Label className="text-xs">{t("filterDirection")}</Label>
              <Select
                className="w-[140px] h-8"
                value={filters.direction || "all"}
                onChange={(e) => {
                  const value = e.target.value as PaymentRegistryFilters["direction"] | "all"
                  setFilters((p) => ({ ...p, direction: value === "all" ? undefined : value }))
                }}
              >
                <option value="all">{t("directionAll")}</option>
                <option value="incoming">{t("directionIncoming")}</option>
                <option value="outgoing">{t("directionOutgoing")}</option>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("filterCategory")}</Label>
              <Select className="w-[180px] h-8" value={filters.category || "all"} onChange={(e) => setFilters((p) => ({ ...p, category: e.target.value === "all" ? undefined : e.target.value }))}>
                <option value="all">{t("categoryAll")}</option>
                <option value="vendor_payment">{t("categoryVendor")}</option>
                <option value="revenue">{t("categoryRevenue")}</option>
                <option value="fund_allocation">{t("categoryFund")}</option>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("filterFrom")}</Label>
              <Input type="date" className="h-8 w-[140px]" value={filters.dateFrom || ""} onChange={(e) => setFilters((p) => ({ ...p, dateFrom: e.target.value || undefined }))} />
            </div>
            <div>
              <Label className="text-xs">{t("filterTo")}</Label>
              <Input type="date" className="h-8 w-[140px]" value={filters.dateTo || ""} onChange={(e) => setFilters((p) => ({ ...p, dateTo: e.target.value || undefined }))} />
            </div>
            <div>
              <Label className="text-xs">{t("filterCounterparty")}</Label>
              <Input className="h-8 w-[160px]" placeholder={t("filterSearch")} value={filters.counterparty || ""} onChange={(e) => setFilters((p) => ({ ...p, counterparty: e.target.value || undefined }))} />
            </div>
          </div>

          {registryLoading ? (
            <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>
          ) : !registryData?.data?.length ? (
            <Card><CardContent className="p-8 text-center text-muted-foreground">{t("registryEmpty")}</CardContent></Card>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left p-3 font-medium">{t("colDate")}</th>
                        <th className="text-center p-3 font-medium">{t("colDirection")}</th>
                        <th className="text-left p-3 font-medium">{t("colCounterparty")}</th>
                        <th className="text-left p-3 font-medium">{t("colCategory")}</th>
                        <th className="text-right p-3 font-medium">{t("colAmount")}</th>
                        <th className="text-left p-3 font-medium">{t("colSource")}</th>
                        <th className="text-left p-3 font-medium">{t("colDescription")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {registryData.data.map((e) => {
                        const dirLabel = e.direction === "incoming" ? t("directionIncoming") : t("directionOutgoing")
                        const dirColor = DIRECTION_COLORS[e.direction] || ""
                        return (
                          <tr key={e.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                            <td className="p-3 text-xs">{formatDate(e.paymentDate, locale)}</td>
                            <td className="p-3 text-center">
                              <Badge variant="secondary" className={`text-[10px] ${dirColor}`}>{dirLabel}</Badge>
                            </td>
                            <td className="p-3">{e.counterpartyName}</td>
                            <td className="p-3 text-xs text-muted-foreground">{{ vendor_payment: t("categoryVendor"), revenue: t("categoryRevenue"), fund_allocation: t("categoryFund") }[e.category || ""] || e.category || "—"}</td>
                            <td className={`p-3 text-right font-medium tabular-nums ${e.direction === "incoming" ? "text-green-700" : "text-red-700"}`}>
                              {e.direction === "incoming" ? "+" : "−"}{fmt(e.amount)} {e.currency}
                            </td>
                            <td className="p-3 text-xs text-muted-foreground">{e.sourceType.replace(/_/g, " ")}</td>
                            <td className="p-3 text-xs text-muted-foreground max-w-[200px] truncate">{e.description || "—"}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {registryData.total > 50 && (
                  <div className="flex items-center justify-between p-3 border-t">
                    <span className="text-xs text-muted-foreground">
                      {t("pagination", { from: (registryPage - 1) * 50 + 1, to: Math.min(registryPage * 50, registryData.total), total: registryData.total })}
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={registryPage <= 1} onClick={() => setRegistryPage((p) => p - 1)}>
                        {t("prev")}
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" disabled={registryPage * 50 >= registryData.total} onClick={() => setRegistryPage((p) => p + 1)}>
                        {t("next")}
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Bank Accounts */}
        <TabsContent value="bank-accounts">
          <BankAccountsManager />
        </TabsContent>
      </Tabs>

      {/* Create Order Dialog */}
      <CreateOrderDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreate={(input) => {
          createOrder.mutate(input, { onSuccess: () => setShowCreate(false) })
        }}
        bills={bills || []}
        bankAccounts={bankAccounts || []}
        isPending={createOrder.isPending}
      />

      {/* Edit Order Dialog */}
      {editOrderId && (() => {
        const editOrder = orders?.find((o: PaymentOrder) => o.id === editOrderId)
        if (!editOrder) return null
        return (
          <CreateOrderDialog
            open={!!editOrderId}
            onClose={() => setEditOrderId(null)}
            onCreate={(input) => {
              updateOrder.mutate({ id: editOrderId, ...input }, { onSuccess: () => setEditOrderId(null) })
            }}
            bills={bills || []}
            bankAccounts={bankAccounts || []}
            isPending={updateOrder.isPending}
            initialData={editOrder}
          />
        )
      })()}

      {/* Reject Dialog */}
      <Dialog open={!!showReject} onOpenChange={() => setShowReject(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("rejectDialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Label>{t("rejectReasonLabel")}</Label>
            <Textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder={t("rejectReasonPlaceholder")}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowReject(null)}>{t("cancel")}</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectOrder.isPending}
              onClick={() => {
                if (showReject) {
                  rejectOrder.mutate({ id: showReject, reason: rejectReason }, { onSuccess: () => setShowReject(null) })
                }
              }}
            >
              {rejectOrder.isPending ? t("rejecting") : t("rejectBtn")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Create Order Dialog ──────────────────────────────────────────────────

function CreateOrderDialog({
  open, onClose, onCreate, bills, bankAccounts, isPending, initialData,
}: {
  open: boolean
  onClose: () => void
  onCreate: (input: CreatePaymentOrderInput) => void
  bills: Bill[]
  bankAccounts: BankAccount[]
  isPending: boolean
  initialData?: PaymentOrder
}) {
  const t = useTranslations("finance.pod")
  const [form, setForm] = useState({
    counterpartyName: initialData?.counterpartyName || "",
    billId: initialData?.billId || "",
    bankAccountId: "",
    amount: initialData ? String(initialData.amount) : "",
    currency: initialData?.currency || DEFAULT_CURRENCY,
    purpose: initialData?.purpose || "",
    paymentMethod: initialData?.paymentMethod || "bank_transfer",
    bankDetails: initialData?.bankDetails || "",
  })

  const unpaidBills = bills.filter((b) => b.status !== "paid" && b.status !== "cancelled")

  function handleBillSelect(billId: string) {
    if (billId === "none") {
      setForm((f) => ({ ...f, billId: "" }))
      return
    }
    const bill = bills.find((b) => b.id === billId)
    if (bill) {
      setForm((f) => ({
        ...f,
        billId: bill.id,
        counterpartyName: bill.vendorName,
        amount: String(bill.balanceDue),
        currency: bill.currency,
        purpose: t("paymentPurpose", { billNumber: bill.billNumber }),
      }))
    }
  }

  function handleSubmit() {
    if (!form.counterpartyName || !form.amount || !form.purpose) return
    onCreate({
      counterpartyName: form.counterpartyName,
      billId: form.billId || undefined,
      bankAccountId: form.bankAccountId || undefined,
      amount: parseFloat(form.amount),
      currency: form.currency,
      purpose: form.purpose,
      paymentMethod: form.paymentMethod,
      bankDetails: form.bankDetails || undefined,
    })
    setForm({ counterpartyName: "", billId: "", bankAccountId: "", amount: "", currency: DEFAULT_CURRENCY, purpose: "", paymentMethod: "bank_transfer", bankDetails: "" })
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initialData ? t("editTitle") : t("newTitle")}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {unpaidBills.length > 0 && (
            <div>
              <Label className="text-xs">{t("billLink")}</Label>
              <Select className="h-9" value={form.billId || "none"} onChange={(e) => handleBillSelect(e.target.value)}>
                <option value="none">{t("billLinkNone")}</option>
                {unpaidBills.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.billNumber} — {b.vendorName} ({fmt(b.balanceDue)} {b.currency})
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs">{t("counterparty")} *</Label>
            <Input value={form.counterpartyName} onChange={(e) => setForm((f) => ({ ...f, counterpartyName: e.target.value }))} placeholder={t("counterpartyPlaceholder")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("sum")} *</Label>
              <Input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">{t("currency")}</Label>
              <Select className="h-9" value={form.currency} onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}>
                {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                  <option key={code} value={code}>{code} {sym}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("purpose")} *</Label>
            <Textarea value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} rows={2} placeholder={t("purposePlaceholder")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">{t("method")}</Label>
              <Select className="h-9" value={form.paymentMethod} onChange={(e) => setForm((f) => ({ ...f, paymentMethod: e.target.value }))}>
                <option value="bank_transfer">{t("methodBankTransfer")}</option>
                <option value="cash">{t("methodCash")}</option>
                <option value="card">{t("methodCard")}</option>
              </Select>
            </div>
            {bankAccounts.length > 0 && (
              <div>
                <Label className="text-xs">{t("bankAccount")}</Label>
                <Select className="h-9" value={form.bankAccountId || "none"} onChange={(e) => setForm((f) => ({ ...f, bankAccountId: e.target.value === "none" ? "" : e.target.value }))}>
                  <option value="none">{t("bankAccountNone")}</option>
                  {bankAccounts.filter((a) => a.isActive).map((a) => (
                    <option key={a.id} value={a.id}>{a.accountName} ({a.bankName})</option>
                  ))}
                </Select>
              </div>
            )}
          </div>
          <div>
            <Label className="text-xs">{t("bankDetails")}</Label>
            <Textarea value={form.bankDetails} onChange={(e) => setForm((f) => ({ ...f, bankDetails: e.target.value }))} rows={2} placeholder={t("bankDetailsPlaceholder")} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleSubmit} disabled={isPending || !form.counterpartyName || !form.amount || !form.purpose}>
            {isPending ? t("saving") : initialData ? t("save") : t("create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
