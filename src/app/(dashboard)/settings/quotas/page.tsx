"use client"

import { useCallback, useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { MotionPage, MotionCard } from "@/components/ui/motion"
import { Plus, Trash2, Loader2 } from "lucide-react"
import { HelpButton } from "@/components/help/help-button"
import { useAutoTour } from "@/components/tour/tour-provider"
import { TourReplayButton } from "@/components/tour/tour-replay-button"

interface QuotaRow {
  id: string
  userId: string
  user: { id: string; name: string; email: string }
  year: number
  quarter: number
  amount: number
  actual: number
  attainment: number
}

interface UserOption {
  id: string
  name: string
  email: string
}

interface ApiUser {
  id: string
  name?: string | null
  email?: string | null
}

function fmtCurrency(n: number): string {
  return `${n.toLocaleString()} ₼`
}

export default function QuotaSettingsPage() {
  const t = useTranslations("quotas")
  useAutoTour("quotasSettings")
  const [quotas, setQuotas] = useState<QuotaRow[]>([])
  const [users, setUsers] = useState<UserOption[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState("")
  const [year, setYear] = useState(new Date().getFullYear())

  // New quota form
  const [newUserId, setNewUserId] = useState("")
  const [newQuarter, setNewQuarter] = useState(1)
  const [newAmount, setNewAmount] = useState("")

  const fetchData = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch(`/api/v1/sales-quotas?year=${year}`).then(r => r.json()),
      fetch("/api/v1/users?limit=100").then(r => r.json()),
    ])
      .then(([q, u]) => {
        if (q.success) setQuotas(q.data)
        if (u.success) {
          const usersData = (u.data?.users || u.data || []) as ApiUser[]
          setUsers(usersData.map((user) => ({
            id: user.id,
            name: user.name || "",
            email: user.email || "",
          })))
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [year])

  useEffect(() => { fetchData() }, [fetchData])

  const handleAdd = async () => {
    if (!newUserId || !newAmount) return
    setSaving(true)
    try {
      await fetch("/api/v1/sales-quotas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: newUserId, year, quarter: newQuarter, amount: parseFloat(newAmount) }),
      })
      setNewUserId("")
      setNewAmount("")
      fetchData()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/v1/sales-quotas/${id}`, { method: "DELETE" })
    fetchData()
  }

  const handleInlineEdit = (q: QuotaRow) => {
    setEditingId(q.id)
    setEditAmount(String(q.amount))
  }

  const handleInlineSave = async (id: string) => {
    if (!editAmount) return
    await fetch(`/api/v1/sales-quotas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: parseFloat(editAmount) }),
    })
    setEditingId(null)
    fetchData()
  }

  // Group by user
  const userQuotas = new Map<string, QuotaRow[]>()
  for (const q of quotas) {
    const key = q.userId
    if (!userQuotas.has(key)) userQuotas.set(key, [])
    userQuotas.get(key)!.push(q)
  }

  return (
    <MotionPage className="p-6 space-y-6">
      <div className="flex items-center justify-between" data-tour-id="quotas-header">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            {t("title")}
            <TourReplayButton tourId="quotasSettings" />
            <HelpButton slug="quotas" variant="label" />
          </h1>
          <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
        </div>
        <div className="flex gap-2" data-tour-id="quotas-year">
          {[year - 1, year, year + 1].map(y => (
            <button
              key={y}
              onClick={() => setYear(y)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                year === y ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/80"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      {/* Add New Quota */}
      <MotionCard className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card" data-tour-id="quotas-form">
        <h3 className="text-sm font-semibold mb-3">{t("addQuota")}</h3>
        <p className="mb-4 text-xs text-muted-foreground">{t("formHint")}</p>
        <div className="flex gap-3 items-end flex-wrap">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("manager")}</label>
            <select
              value={newUserId}
              onChange={e => setNewUserId(e.target.value)}
              className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 text-sm bg-background min-w-[160px]"
            >
              <option value="">{t("selectManager")}</option>
              {users.map(u => (
                <option key={u.id} value={u.id}>{u.name || u.email}</option>
              ))}
            </select>
            <p className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">{t("managerHint")}</p>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("quarter")}</label>
            <select
              value={newQuarter}
              onChange={e => setNewQuarter(parseInt(e.target.value))}
              className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 text-sm bg-background w-20"
            >
              {[1, 2, 3, 4].map(q => (
                <option key={q} value={q}>Q{q}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">{t("amount")}</label>
            <input
              type="number"
              value={newAmount}
              onChange={e => setNewAmount(e.target.value)}
              placeholder="150000"
              className="h-9 rounded-md border border-zinc-200 dark:border-zinc-700 px-2 text-sm bg-background w-32"
            />
            <p className="mt-1 max-w-[180px] text-[11px] text-muted-foreground">{t("amountHint")}</p>
          </div>
          <Button size="sm" onClick={handleAdd} disabled={saving || !newUserId || !newAmount}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Plus className="h-3.5 w-3.5 mr-1" />}
            {t("add")}
          </Button>
        </div>
      </MotionCard>

      {/* Quotas Table */}
      {loading ? (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">{t("loading")}</div>
      ) : quotas.length === 0 ? (
        <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 bg-card px-6 py-10 text-center text-muted-foreground dark:border-zinc-700" data-tour-id="quotas-list">
          <p className="text-sm font-medium text-foreground">{t("noQuotas", { year })}</p>
          <p className="mt-2 max-w-md text-sm leading-6">{t("noQuotasHint")}</p>
        </div>
      ) : (
        <MotionCard className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden" data-tour-id="quotas-list">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground">{t("colManager")}</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-muted-foreground">{t("colQuarter")}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">{t("colQuota")}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">{t("colActual")}</th>
                <th className="text-right px-3 py-2.5 text-xs font-semibold text-muted-foreground">%</th>
                <th className="text-center px-3 py-2.5 text-xs font-semibold text-muted-foreground w-16"></th>
              </tr>
            </thead>
            <tbody>
              {quotas.map(q => (
                <tr key={q.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-xs font-medium">{q.user.name || q.user.email}</td>
                  <td className="px-3 py-2.5 text-xs text-center">Q{q.quarter}</td>
                  <td className="px-3 py-2.5 text-xs text-right">
                    {editingId === q.id ? (
                      <input
                        autoFocus
                        type="number"
                        value={editAmount}
                        onChange={e => setEditAmount(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === "Enter") handleInlineSave(q.id)
                          if (e.key === "Escape") setEditingId(null)
                        }}
                        onBlur={() => handleInlineSave(q.id)}
                        className="h-6 w-24 text-right border border-zinc-200 dark:border-zinc-700 rounded px-1 text-xs bg-background"
                      />
                    ) : (
                      <span
                        onClick={() => handleInlineEdit(q)}
                        className="cursor-pointer hover:text-primary hover:underline transition-colors"
                        title={t("clickToEdit")}
                      >
                        {fmtCurrency(q.amount)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-right">{fmtCurrency(q.actual)}</td>
                  <td className="px-3 py-2.5 text-xs text-right">
                    <span className={`font-semibold ${
                      q.attainment >= 100 ? "text-emerald-600" :
                      q.attainment >= 70 ? "text-blue-600" :
                      q.attainment >= 40 ? "text-amber-600" : "text-red-600"
                    }`}>
                      {q.attainment}%
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <button
                      onClick={() => handleDelete(q.id)}
                      className="text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </MotionCard>
      )}
    </MotionPage>
  )
}
