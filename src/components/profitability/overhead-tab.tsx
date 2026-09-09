"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Plus, Trash2, Check, X, Pencil, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { getCurrencySymbol } from "@/lib/constants"
import {
  useOverheadItems,
  useCreateOverhead,
  useUpdateOverhead,
  useDeleteOverhead,
} from "@/lib/cost-model/hooks"
import type { OverheadItem } from "@/lib/cost-model/types"
import { OVERHEAD_CATEGORIES } from "@/lib/cost-model/types"

const SERVICE_OPTIONS = [
  { value: "", label: "None (Admin)" },
  { value: "permanent_it", label: "Daimi IT" },
  { value: "infosec", label: "InfoSec" },
  { value: "helpdesk", label: "HelpDesk" },
  { value: "erp", label: "ERP" },
  { value: "grc", label: "GRC" },
  { value: "projects", label: "PM" },
  { value: "cloud", label: "Cloud" },
  { value: "waf", label: "WAF" },
]

export function OverheadTab() {
  const t = useTranslations("profitability")
  const tc = useTranslations("common")
  const { data: items = [], isLoading } = useOverheadItems()
  const createMutation = useCreateOverhead()
  const updateMutation = useUpdateOverhead()
  const deleteMutation = useDeleteOverhead()

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<OverheadItem>>({})
  const [error, setError] = useState<string | null>(null)

  const calculateMonthly = (item: Partial<OverheadItem>): number => {
    let amt = item.amount || 0
    // Amortization: custom period (e.g. 60, 84 months)
    if (item.amortMonths && item.amortMonths > 0) {
      amt = amt / item.amortMonths
    } else if (item.isAnnual) {
      amt = amt / 12
    }
    if (item.hasVat) amt = amt * 1.18
    if (item.category === "insurance" || item.category === "mobile") amt = amt * 137
    return Math.round(amt * 100) / 100
  }

  const adminItems = items.filter(i => i.isAdmin)
  const techItems = items.filter(i => !i.isAdmin)

  const adminTotal = adminItems.reduce((sum, i) => sum + calculateMonthly(i), 0)
  const techTotal = techItems.reduce((sum, i) => sum + calculateMonthly(i), 0)
  const grandTotal = adminTotal + techTotal

  const startEdit = (item: OverheadItem) => {
    setEditingId(String(item.id))
    setEditForm({ ...item })
    setError(null)
  }

  const saveEdit = async () => {
    if (!editingId || !editForm) return
    setError(null)
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        category: editForm.category || OVERHEAD_CATEGORIES[0],
        label: editForm.label,
        amount: editForm.amount,
        isAnnual: editForm.isAnnual,
        hasVat: editForm.hasVat,
        isAdmin: !editForm.targetService,
        targetService: editForm.targetService || "",
        amortMonths: editForm.amortMonths || 0,
      })
      setEditingId(null)
      setEditForm({})
    } catch (err: any) {
      setError(err.message || tc("errorUpdateFailed"))
    }
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditForm({})
    setError(null)
  }

  const deleteItem = async (id: string) => {
    setError(null)
    try {
      await deleteMutation.mutateAsync(id)
    } catch (err: any) {
      setError(err.message || tc("errorDeleteFailed"))
    }
  }

  const addItem = async () => {
    setError(null)
    try {
      const defaultCategory = OVERHEAD_CATEGORIES[0]
      const created: any = await createMutation.mutateAsync({
        category: defaultCategory,
        label: "Yeni xərc",
        amount: 0,
        isAnnual: false,
        hasVat: false,
        isAdmin: true,
        targetService: "",
        sortOrder: items.length,
      })
      if (created?.id) {
        setEditingId(String(created.id))
        setEditForm({
          ...created,
          category: defaultCategory,
          label: "Yeni xərc",
          amount: 0,
          isAnnual: false,
          hasVat: false,
          isAdmin: true,
          targetService: "",
        })
      }
    } catch (err: any) {
      setError(err.message || "Failed to add item")
    }
  }

  const isMutating = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("adminOverhead")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums tracking-tight">{adminTotal.toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("techInfra")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums tracking-tight">{techTotal.toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">{t("ohTotalOverhead")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums tracking-tight">{grandTotal.toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("ohCostItems", { count: items.length })}</CardTitle>
          <Button size="sm" onClick={addItem} disabled={isMutating}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            {t("ohAddItem")}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">Label</th>
                  <th className="pb-2 pr-4">Kateqoriya</th>
                  <th className="pb-2 pr-4">Məbləğ</th>
                  <th className="pb-2 pr-4">Hesablama</th>
                  <th className="pb-2 pr-4">ƏDV</th>
                  <th className="pb-2 pr-4">Xidmət</th>
                  <th className="pb-2 pr-4">Tip</th>
                  <th className="pb-2 pr-4 text-right">Aylıq</th>
                  <th className="pb-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const itemId = String(item.id)
                  const isEditing = editingId === itemId
                  return (
                    <tr key={itemId} className="border-b last:border-0 hover:bg-muted/50">
                      {isEditing ? (
                        <>
                          <td className="py-2 pr-4">
                            <Input
                              value={editForm.label || ""}
                              onChange={(e) => setEditForm(prev => ({ ...prev, label: e.target.value }))}
                              className="h-8 text-sm"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <select
                              value={editForm.category || ""}
                              onChange={(e) => setEditForm(prev => ({ ...prev, category: e.target.value }))}
                              className="h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-xs"
                            >
                              {OVERHEAD_CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              type="number"
                              value={editForm.amount || 0}
                              onChange={(e) => setEditForm(prev => ({ ...prev, amount: parseFloat(e.target.value) || 0 }))}
                              className="h-8 text-sm w-28"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <div className="flex items-center gap-1">
                              <select
                                value={editForm.amortMonths && editForm.amortMonths > 0 ? "amort" : editForm.isAnnual ? "annual" : "monthly"}
                                onChange={(e) => {
                                  const v = e.target.value
                                  if (v === "monthly") setEditForm(prev => ({ ...prev, isAnnual: false, amortMonths: 0 }))
                                  else if (v === "annual") setEditForm(prev => ({ ...prev, isAnnual: true, amortMonths: 0 }))
                                  else setEditForm(prev => ({ ...prev, isAnnual: false, amortMonths: prev.amortMonths || 60 }))
                                }}
                                className="h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-1 text-xs"
                              >
                                <option value="monthly">Aylıq</option>
                                <option value="annual">İllik÷12</option>
                                <option value="amort">Amort÷ay</option>
                              </select>
                              {editForm.amortMonths && editForm.amortMonths > 0 ? (
                                <Input
                                  type="number"
                                  value={editForm.amortMonths}
                                  onChange={(e) => setEditForm(prev => ({ ...prev, amortMonths: parseInt(e.target.value) || 0 }))}
                                  className="h-8 w-16 text-xs"
                                  placeholder="ay"
                                />
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 pr-4">
                            <input
                              type="checkbox"
                              checked={editForm.hasVat || false}
                              onChange={(e) => setEditForm(prev => ({ ...prev, hasVat: e.target.checked }))}
                              className="rounded"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <select
                              value={editForm.targetService || ""}
                              onChange={(e) => setEditForm(prev => ({
                                ...prev,
                                targetService: e.target.value,
                                isAdmin: !e.target.value,
                              }))}
                              className="h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-sm"
                            >
                              {SERVICE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <Badge variant={editForm.targetService ? "default" : "secondary"}>
                              {editForm.targetService ? "Tech" : "Admin"}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 text-right font-mono">
                            {calculateMonthly(editForm).toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}
                          </td>
                          <td className="py-2 flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={saveEdit}
                              disabled={updateMutation.isPending}
                              className="h-7 w-7 p-0"
                            >
                              {updateMutation.isPending ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="h-3.5 w-3.5 text-green-600" />
                              )}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={cancelEdit} className="h-7 w-7 p-0">
                              <X className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2 pr-4 font-medium">{item.label}</td>
                          <td className="py-2 pr-4 text-xs text-muted-foreground">{item.category}</td>
                          <td className="py-2 pr-4 font-mono">{item.amount.toLocaleString("en", { minimumFractionDigits: 2 })}</td>
                          <td className="py-2 pr-4 text-xs">
                            {item.amortMonths && item.amortMonths > 0
                              ? `÷${item.amortMonths} ay`
                              : item.isAnnual ? "illik÷12" : "aylıq"}
                          </td>
                          <td className="py-2 pr-4">{item.hasVat ? "18%" : "No"}</td>
                          <td className="py-2 pr-4">
                            {item.targetService
                              ? SERVICE_OPTIONS.find(o => o.value === item.targetService)?.label || item.targetService
                              : "—"}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge variant={item.isAdmin ? "secondary" : "default"}>
                              {item.isAdmin ? "Admin" : "Tech"}
                            </Badge>
                          </td>
                          <td className="py-2 pr-4 text-right font-mono font-medium">
                            {calculateMonthly(item).toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}
                          </td>
                          <td className="py-2 flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => startEdit(item)} className="h-7 w-7 p-0">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteItem(itemId)}
                              disabled={deleteMutation.isPending}
                              className="h-7 w-7 p-0"
                            >
                              <Trash2 className="h-3.5 w-3.5 text-red-600" />
                            </Button>
                          </td>
                        </>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
