"use client"

import { useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { formatDate } from "@/lib/format-date"
import { useFunds, useCreateFund, useDeleteFund, useFundTransactions, useCreateFundTransaction, useFundRules, useCreateFundRule, useDeleteFundRule, useFinanceDashboard } from "@/lib/finance/hooks"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Plus, Trash2, ArrowDownToLine, ArrowUpFromLine, History, Settings2, PiggyBank, AlertTriangle } from "lucide-react"
import type { Fund } from "@/lib/finance/types"
import { getCurrencySymbol } from "@/lib/constants"

function fmt(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
}

const FUND_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"]

export function FundManager() {
  const t = useTranslations("finance.funds")
  const { data: funds, isLoading } = useFunds()
  const { data: dashboard } = useFinanceDashboard(new Date().getFullYear())
  const createFund = useCreateFund()
  const deleteFund = useDeleteFund()
  const [showCreate, setShowCreate] = useState(false)
  const [selectedFund, setSelectedFund] = useState<string | null>(null)
  const [showTx, setShowTx] = useState(false)
  const [showRules, setShowRules] = useState(false)

  if (isLoading) return <div className="p-8 text-center text-muted-foreground">{t("loading")}</div>

  const totalBalance = (funds || []).reduce((s, f) => s + f.currentBalance, 0)
  const cashBalance = dashboard?.kpis?.cashBalance?.current || 0
  const fundCoverage = cashBalance > 0 ? Math.round((cashBalance / totalBalance) * 100) : 0
  const isFundOverCash = totalBalance > 0 && cashBalance < totalBalance

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{t("totalBalance")}</p>
          <p className="text-2xl font-bold tabular-nums">{fmt(totalBalance)} {getCurrencySymbol()}</p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> {t("newFund")}
        </Button>
      </div>

      {/* Fund Coverage Warning */}
      {isFundOverCash && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-400">{t("coverageWarning")}</p>
            <p className="text-amber-700 dark:text-amber-500">
              {t("coverageDetail", { reserved: fmt(totalBalance), available: fmt(cashBalance), percent: fundCoverage })}
            </p>
          </div>
        </div>
      )}

      {/* Fund Cards */}
      {funds && funds.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {funds.map((fund: Fund, i: number) => {
            const color = fund.color || FUND_COLORS[i % FUND_COLORS.length]
            const pct = fund.targetAmount ? Math.min(100, Math.round((fund.currentBalance / fund.targetAmount) * 100)) : null

            return (
              <Card key={fund.id} className="overflow-hidden">
                <div className="h-1" style={{ backgroundColor: color }} />
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                      <PiggyBank className="w-4 h-4" style={{ color }} />
                      {fund.name}
                    </CardTitle>
                    {!fund.isActive && <Badge variant="secondary" className="text-[10px]">{t("inactive")}</Badge>}
                  </div>
                  {fund.description && <p className="text-xs text-muted-foreground">{fund.description}</p>}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="flex justify-between items-baseline">
                      <span className="text-2xl font-bold tabular-nums" style={{ color }}>
                        {fmt(fund.currentBalance)}
                      </span>
                      <span className="text-xs text-muted-foreground">{fund.currency}</span>
                    </div>
                    {fund.targetAmount && (
                      <>
                        <div className="flex justify-between text-xs text-muted-foreground mt-1">
                          <span>{t("targetLabel")} {fmt(fund.targetAmount)}</span>
                          <span>{pct}%</span>
                        </div>
                        <Progress value={pct || 0} className="h-2 mt-1" />
                      </>
                    )}
                  </div>

                  {/* Rules count */}
                  {fund.rules && fund.rules.length > 0 && (
                    <p className="text-xs text-muted-foreground">{t("rulesCount", { count: fund.rules.length })}</p>
                  )}

                  {/* Actions */}
                  <div className="flex gap-1 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={() => { setSelectedFund(fund.id); setShowTx(true) }}>
                      <ArrowDownToLine className="w-3 h-3 mr-1" /> {t("deposit")}
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => { setSelectedFund(fund.id); setShowRules(true) }}>
                      <Settings2 className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-xs text-red-500" onClick={() => { if (confirm(t("confirmDelete", { name: fund.name }))) deleteFund.mutate(fund.id) }}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      ) : (
        <div className="py-20 text-center text-muted-foreground">
          <PiggyBank className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">{t("empty")}</p>
        </div>
      )}

      {/* Create Fund Dialog */}
      <CreateFundDialog open={showCreate} onClose={() => setShowCreate(false)} onCreate={createFund} />

      {/* Transaction Dialog */}
      {selectedFund && showTx && (
        <TransactionDialog fundId={selectedFund} onClose={() => { setShowTx(false); setSelectedFund(null) }} />
      )}

      {/* Rules Dialog */}
      {selectedFund && showRules && (
        <RulesDialog fundId={selectedFund} onClose={() => { setShowRules(false); setSelectedFund(null) }} />
      )}
    </div>
  )
}

function CreateFundDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: any }) {
  const t = useTranslations("finance.funds")
  const [form, setForm] = useState({ name: "", description: "", targetAmount: "", color: "#3b82f6" })
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const updateForm = (next: typeof form) => {
    if (!onCreate.isPending) setIdempotencyKey(crypto.randomUUID())
    setForm(next)
  }

  const handleSubmit = () => {
    if (!form.name) return
    onCreate.mutate(
      { ...form, targetAmount: form.targetAmount || undefined, idempotencyKey },
      {
        onSuccess: () => {
          onClose()
          setForm({ name: "", description: "", targetAmount: "", color: "#3b82f6" })
          setIdempotencyKey(crypto.randomUUID())
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader><DialogTitle>{t("createTitle")}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>{t("fundName")} *</Label><Input value={form.name} onChange={(e) => updateForm({ ...form, name: e.target.value })} placeholder={t("fundNamePlaceholder")} /></div>
          <div><Label>{t("description")}</Label><Input value={form.description} onChange={(e) => updateForm({ ...form, description: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>{t("targetAmount")}</Label><Input type="number" step="0.0001" value={form.targetAmount} onChange={(e) => updateForm({ ...form, targetAmount: e.target.value })} placeholder="50000" /></div>
            <div><Label>{t("color")}</Label><Input type="color" value={form.color} onChange={(e) => updateForm({ ...form, color: e.target.value })} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
          <Button onClick={handleSubmit} disabled={onCreate.isPending}>{onCreate.isPending ? t("creating") : t("create")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransactionDialog({ fundId, onClose }: { fundId: string; onClose: () => void }) {
  const t = useTranslations("finance.funds")
  const locale = useLocale()
  const { data: transactions, isLoading } = useFundTransactions(fundId)
  const createTx = useCreateFundTransaction()
  const [type, setType] = useState("deposit")
  const [amount, setAmount] = useState("")
  const [desc, setDesc] = useState("")
  const [txWarning, setTxWarning] = useState("")
  const [txError, setTxError] = useState("")
  // Keep the key after a transport/server error so a manual retry cannot
  // double-apply a command whose first response was lost.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())

  const commandEdited = () => {
    if (!createTx.isPending) setIdempotencyKey(crypto.randomUUID())
  }

  const handleAdd = () => {
    if (!amount) return
    setTxWarning("")
    setTxError("")
    createTx.mutate(
      { fundId, type, amount, description: desc || undefined, idempotencyKey },
      {
        onSuccess: (_data: any) => {
          setAmount("")
          setDesc("")
          setIdempotencyKey(crypto.randomUUID())
          if (_data?.warning) setTxWarning(_data.warning)
        },
        onError: (err: any) => {
          setTxError(err?.message || t("errorFallback"))
        },
      }
    )
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t("txTitle")}</DialogTitle></DialogHeader>

        {/* Add transaction form */}
        <div className="grid gap-2 p-3 bg-muted/50 rounded-lg">
          <div className="flex gap-2">
            <select value={type} onChange={(e) => { commandEdited(); setType(e.target.value) }} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="deposit">{t("txDeposit")}</option>
              <option value="withdrawal">{t("txWithdrawal")}</option>
            </select>
            <Input type="number" step="0.0001" value={amount} onChange={(e) => { commandEdited(); setAmount(e.target.value) }} placeholder={t("txAmount")} className="flex-1" />
            <Button size="sm" onClick={handleAdd} disabled={createTx.isPending}>
              {type === "deposit" ? <ArrowDownToLine className="w-4 h-4" /> : <ArrowUpFromLine className="w-4 h-4" />}
            </Button>
          </div>
          <Input value={desc} onChange={(e) => { commandEdited(); setDesc(e.target.value) }} placeholder={t("txDescription")} />
        </div>

        {txError && (
          <div className="p-3 rounded-lg border border-red-200 bg-red-50 dark:bg-red-950/30 text-sm text-red-700 dark:text-red-400">
            {txError}
          </div>
        )}
        {txWarning && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/30">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-400">{txWarning}</p>
          </div>
        )}

        {/* Transaction history */}
        <div className="max-h-[300px] overflow-y-auto space-y-1">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-4">{t("loading")}</p>}
          {transactions && transactions.length > 0 ? transactions.map((tx) => (
            <div key={tx.id} className="flex items-center justify-between py-2 px-1 border-b last:border-0">
              <div className="flex items-center gap-2">
                {tx.type === "deposit" || tx.type === "transfer_in" || tx.type === "auto_allocation" ? (
                  <ArrowDownToLine className="w-3.5 h-3.5 text-green-600" />
                ) : (
                  <ArrowUpFromLine className="w-3.5 h-3.5 text-red-600" />
                )}
                <div>
                  <p className="text-xs font-medium">{tx.type}</p>
                  {tx.description && <p className="text-[10px] text-muted-foreground">{tx.description}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold tabular-nums ${tx.type === "deposit" || tx.type === "transfer_in" ? "text-green-600" : "text-red-600"}`}>
                  {tx.type === "deposit" || tx.type === "transfer_in" ? "+" : "-"}{fmt(tx.amount)}
                </p>
                <p className="text-[10px] text-muted-foreground">{formatDate(tx.createdAt, locale)}</p>
              </div>
            </div>
          )) : (
            !isLoading && <p className="text-sm text-muted-foreground text-center py-4">{t("txEmpty")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RulesDialog({ fundId, onClose }: { fundId: string; onClose: () => void }) {
  const t = useTranslations("finance.funds")
  const { data: rules, isLoading } = useFundRules(fundId)
  const createRule = useCreateFundRule()
  const deleteRule = useDeleteFundRule()
  const [name, setName] = useState("")
  const [trigger, setTrigger] = useState("revenue_percentage")
  const [pct, setPct] = useState("")
  const [fixed, setFixed] = useState("")

  const handleAdd = () => {
    if (!name) return
    createRule.mutate(
      {
        fundId,
        name,
        triggerType: trigger,
        percentage: trigger === "revenue_percentage" ? parseFloat(pct) / 100 : undefined,
        fixedAmount: trigger === "fixed_monthly" ? parseFloat(fixed) : undefined,
      },
      { onSuccess: () => { setName(""); setPct(""); setFixed("") } }
    )
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t("rulesTitle")}</DialogTitle></DialogHeader>

        {/* Add rule form */}
        <div className="grid gap-2 p-3 bg-muted/50 rounded-lg">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("ruleName")} />
          <div className="flex gap-2">
            <select value={trigger} onChange={(e) => setTrigger(e.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm flex-1">
              <option value="revenue_percentage">{t("ruleRevenue")}</option>
              <option value="fixed_monthly">{t("ruleFixed")}</option>
              <option value="invoice_paid">{t("ruleInvoice")}</option>
            </select>
            {trigger === "revenue_percentage" && (
              <Input type="number" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="%" className="w-20" />
            )}
            {trigger === "fixed_monthly" && (
              <Input type="number" value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder={getCurrencySymbol()} className="w-24" />
            )}
            <Button size="sm" onClick={handleAdd} disabled={createRule.isPending}><Plus className="w-4 h-4" /></Button>
          </div>
        </div>

        {/* Rules list */}
        <div className="space-y-1">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-4">{t("loading")}</p>}
          {rules && rules.length > 0 ? rules.map((rule) => (
            <div key={rule.id} className="flex items-center justify-between py-2 px-1 border-b last:border-0">
              <div>
                <p className="text-sm font-medium">{rule.name}</p>
                <p className="text-xs text-muted-foreground">
                  {rule.triggerType === "revenue_percentage" && `${((rule.percentage || 0) * 100).toFixed(0)}% ${t("ruleRevenue")}`}
                  {rule.triggerType === "fixed_monthly" && `${fmt(rule.fixedAmount || 0)} ${getCurrencySymbol()}/${t("ruleFixed")}`}
                  {rule.triggerType === "invoice_paid" && t("ruleInvoice")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={rule.isActive ? "default" : "secondary"} className="text-[10px]">
                  {rule.isActive ? t("active") : t("inactive")}
                </Badge>
                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-red-500" onClick={() => deleteRule.mutate({ id: rule.id, fundId })}>
                  <Trash2 className="w-3 h-3" />
                </Button>
              </div>
            </div>
          )) : (
            !isLoading && <p className="text-sm text-muted-foreground text-center py-4">{t("rulesEmpty")}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
