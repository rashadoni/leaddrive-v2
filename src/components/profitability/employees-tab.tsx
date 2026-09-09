"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Plus, Trash2, Check, X, Pencil, Loader2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { getCurrencySymbol } from "@/lib/constants"
import {
  useEmployees,
  useCreateEmployee,
  useUpdateEmployee,
  useDeleteEmployee,
} from "@/lib/cost-model/hooks"
import type { EmployeeRow } from "@/lib/cost-model/types"

const INCOME_TAX_RATE = 0.14
const EMPLOYER_TAX_RATE = 0.175

function calcGross(net: number): number {
  return net / (1 - INCOME_TAX_RATE)
}

function calcSuperGross(gross: number): number {
  return gross * (1 + EMPLOYER_TAX_RATE)
}

function calcTotal(net: number, count: number): number {
  return count * calcSuperGross(calcGross(net))
}

const DEPARTMENTS = ["BackOffice", "IT", "InfoSec", "HelpDesk", "ERP", "GRC", "PM"]

const DEPT_COLORS: Record<string, string> = {
  BackOffice: "bg-muted text-foreground",
  IT: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  InfoSec: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
  HelpDesk: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  ERP: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  GRC: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  PM: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-300",
}

export function EmployeesTab() {
  const t = useTranslations("profitability")
  const tc = useTranslations("common")
  const { data: employees = [], isLoading } = useEmployees()
  const createMutation = useCreateEmployee()
  const updateMutation = useUpdateEmployee()
  const deleteMutation = useDeleteEmployee()

  const [filterDept, setFilterDept] = useState<string>("all")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<Partial<EmployeeRow>>({})
  const [error, setError] = useState<string | null>(null)

  const filtered = filterDept === "all" ? employees : employees.filter(e => e.department === filterDept)

  const totalHeadcount = employees.reduce((s, e) => s + e.count, 0)
  const totalLaborCost = employees.reduce((s, e) => s + calcTotal(e.netSalary, e.count), 0)
  const deptSummary = DEPARTMENTS.map(d => ({
    dept: d,
    count: employees.filter(e => e.department === d).reduce((s, e) => s + e.count, 0),
    cost: employees.filter(e => e.department === d).reduce((s, e) => s + calcTotal(e.netSalary, e.count), 0),
  })).filter(d => d.count > 0)

  const startEdit = (emp: EmployeeRow) => {
    setEditingId(String(emp.id))
    setEditForm({ ...emp })
    setError(null)
  }

  const saveEdit = async () => {
    if (!editingId) return
    setError(null)
    try {
      await updateMutation.mutateAsync({
        id: editingId,
        department: editForm.department,
        position: editForm.position,
        count: editForm.count,
        netSalary: editForm.netSalary,
        inOverhead: editForm.inOverhead,
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
      const created: any = await createMutation.mutateAsync({
        department: "IT",
        position: "New Position",
        count: 1,
        netSalary: 0,
        grossSalary: 0,
        superGross: 0,
        inOverhead: false,
      })
      if (created?.id) {
        setEditingId(String(created.id))
        setEditForm({
          ...created,
          department: "IT",
          position: "New Position",
          count: 1,
          netSalary: 0,
          inOverhead: false,
        })
      }
    } catch (err: any) {
      setError(err.message || "Failed to add employee")
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
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("empTotalHeadcount")}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums tracking-tight">{totalHeadcount}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("empTotalLaborCost")}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums tracking-tight">{Math.round(totalLaborCost).toLocaleString()} {getCurrencySymbol()}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">{t("empDepartments")}</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold tabular-nums tracking-tight">{deptSummary.length}</p></CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant={filterDept === "all" ? "default" : "outline"} size="sm" onClick={() => setFilterDept("all")}>
          All ({totalHeadcount})
        </Button>
        {deptSummary.map(d => (
          <Button key={d.dept} variant={filterDept === d.dept ? "default" : "outline"} size="sm" onClick={() => setFilterDept(d.dept)}>
            {d.dept} ({d.count})
          </Button>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">{t("empRoster", { count: filtered.length })}</CardTitle>
          <Button size="sm" onClick={addItem} disabled={isMutating}>
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            {t("empAddPosition")}
          </Button>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="pb-2 pr-4">{t("empDepartment")}</th>
                  <th className="pb-2 pr-4">{t("empPosition")}</th>
                  <th className="pb-2 pr-4 text-right">{t("empCount")}</th>
                  <th className="pb-2 pr-4 text-right">{t("empNetSalary")}</th>
                  <th className="pb-2 pr-4 text-right">{t("empGross")}</th>
                  <th className="pb-2 pr-4 text-right">{t("empSuperGross")}</th>
                  <th className="pb-2 pr-4 text-right">{t("empTotalCostMo")}</th>
                  <th className="pb-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(emp => {
                  const empId = String(emp.id)
                  const isEditing = editingId === empId
                  const gross = emp.grossSalary || calcGross(emp.netSalary)
                  const superGross = emp.superGross || calcSuperGross(gross)
                  const total = calcTotal(emp.netSalary, emp.count)

                  return (
                    <tr key={empId} className="border-b last:border-0 hover:bg-muted/50">
                      {isEditing ? (
                        <>
                          <td className="py-2 pr-4">
                            <select
                              value={editForm.department || "IT"}
                              onChange={e => setEditForm(prev => ({ ...prev, department: e.target.value }))}
                              className="h-8 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-2 text-sm"
                            >
                              {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              value={editForm.position || ""}
                              onChange={e => setEditForm(prev => ({ ...prev, position: e.target.value }))}
                              className="h-8 text-sm"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              type="number"
                              value={editForm.count || 1}
                              onChange={e => setEditForm(prev => ({ ...prev, count: parseInt(e.target.value) || 1 }))}
                              className="h-8 text-sm w-20 text-right"
                            />
                          </td>
                          <td className="py-2 pr-4">
                            <Input
                              type="number"
                              value={editForm.netSalary || 0}
                              onChange={e => setEditForm(prev => ({ ...prev, netSalary: parseFloat(e.target.value) || 0 }))}
                              className="h-8 text-sm w-28 text-right"
                            />
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-muted-foreground">
                            {calcGross(editForm.netSalary || 0).toFixed(2)}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono text-muted-foreground">
                            {calcSuperGross(calcGross(editForm.netSalary || 0)).toFixed(2)}
                          </td>
                          <td className="py-2 pr-4 text-right font-mono font-medium">
                            {calcTotal(editForm.netSalary || 0, editForm.count || 1).toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}
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
                          <td className="py-2.5 pr-4">
                            <Badge className={DEPT_COLORS[emp.department] || ""}>{emp.department}</Badge>
                          </td>
                          <td className="py-2.5 pr-4 font-medium">{emp.position}</td>
                          <td className="py-2.5 pr-4 text-right font-mono">{emp.count}</td>
                          <td className="py-2.5 pr-4 text-right font-mono">{emp.netSalary.toLocaleString("en", { minimumFractionDigits: 2 })}</td>
                          <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">{gross.toFixed(2)}</td>
                          <td className="py-2.5 pr-4 text-right font-mono text-muted-foreground">{superGross.toFixed(2)}</td>
                          <td className="py-2.5 pr-4 text-right font-mono font-medium">{total.toLocaleString("en", { minimumFractionDigits: 2 })} {getCurrencySymbol()}</td>
                          <td className="py-2.5 flex gap-1">
                            <Button variant="ghost" size="sm" onClick={() => startEdit(emp)} className="h-7 w-7 p-0">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => deleteItem(empId)}
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
