"use client"

import { useEffect, useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { useRouter } from "next/navigation"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DeleteConfirmDialog } from "@/components/delete-confirm-dialog"
import {
  ArrowLeft,
  Plus,
  RefreshCw,
  Calendar,
  Trash2,
  Play,
  Pause,
} from "lucide-react"
import { DEFAULT_CURRENCY, CURRENCY_SYMBOLS } from "@/lib/constants"
import { HelpButton } from "@/components/help/help-button"

interface RecurringInvoice {
  id: string
  title: string
  frequency: string
  intervalCount: number
  isActive: boolean
  startDate: string | null
  endDate: string | null
  nextRunDate: string | null
  lastRunDate: string | null
  totalGenerated: number
  maxOccurrences: number | null
  currency: string
  includeVat: boolean
  taxRate: number
  paymentTerms: string | null
  recipientEmail: string | null
  notes: string | null
  companyId: string | null
  company?: { id: string; name: string }
  items: RecurringInvoiceItem[]
}

interface RecurringInvoiceItem {
  id?: string
  name: string
  quantity: number
  unitPrice: number
  discount: number
}

interface Company {
  id: string
  name: string
}

const emptyItem = (): RecurringInvoiceItem => ({
  name: "",
  quantity: 1,
  unitPrice: 0,
  discount: 0,
})

const defaultForm = {
  title: "",
  titleTemplate: "",
  companyId: "",
  frequency: "monthly",
  intervalCount: 1,
  startDate: "",
  endDate: "",
  maxOccurrences: "",
  currency: DEFAULT_CURRENCY,
  includeVat: false,
  taxRate: "0.18",
  paymentTerms: "",
  recipientEmail: "",
  notes: "",
}

export default function RecurringInvoicesPage() {
  const { data: session } = useSession()
  const t = useTranslations("invoices")
  const tc = useTranslations("common")
  const router = useRouter()

  const orgId = (session?.user as { organizationId?: string })?.organizationId

  const [rules, setRules] = useState<RecurringInvoice[]>([])
  const [loading, setLoading] = useState(true)
  const [companies, setCompanies] = useState<Company[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState(defaultForm)
  const [items, setItems] = useState<RecurringInvoiceItem[]>([emptyItem()])
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleteName, setDeleteName] = useState("")
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [generateReport, setGenerateReport] = useState<Array<{ invoiceNumber: string; company?: string; status: string; error?: string }> | null>(null)

  const headers = useCallback((): Record<string, string> => {
    const h: Record<string, string> = { "Content-Type": "application/json" }
    if (orgId) h["x-organization-id"] = String(orgId)
    return h
  }, [orgId])

  const fetchRules = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v1/recurring-invoices", {
        headers: headers(),
      })
      const json = await res.json()
      if (json.success) {
        setRules(json.data ?? json.data?.recurringInvoices ?? [])
      }
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [headers])

  const fetchCompanies = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/companies?limit=500", {
        headers: headers(),
      })
      const json = await res.json()
      if (json.success) {
        setCompanies(json.data?.companies ?? json.data ?? [])
      }
    } catch {
      // ignore
    }
  }, [headers])

  useEffect(() => {
    if (session) {
      fetchRules()
      fetchCompanies()
    }
  }, [session, fetchRules, fetchCompanies])

  const handleCreate = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        title: form.title,
        titleTemplate: form.titleTemplate || `${form.title} — {month} {year}`,
        frequency: form.frequency,
        intervalCount: Number(form.intervalCount) || 1,
        currency: form.currency,
        includeVat: form.includeVat,
        taxRate: parseFloat(form.taxRate) || 0,
        items: items.filter((i) => i.name.trim() !== ""),
      }
      if (form.companyId) body.companyId = form.companyId
      if (form.startDate) body.startDate = form.startDate
      if (form.endDate) body.endDate = form.endDate
      if (form.maxOccurrences) body.maxOccurrences = Number(form.maxOccurrences)
      if (form.paymentTerms) body.paymentTerms = form.paymentTerms
      if (form.recipientEmail) body.recipientEmail = form.recipientEmail
      if (form.notes) body.notes = form.notes

      const res = await fetch("/api/v1/recurring-invoices", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      })
      if (res.ok) {
        setDialogOpen(false)
        setForm(defaultForm)
        setItems([emptyItem()])
        fetchRules()
      }
    } catch {
      // ignore
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (rule: RecurringInvoice) => {
    try {
      await fetch(`/api/v1/recurring-invoices/${rule.id}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ isActive: !rule.isActive }),
      })
      fetchRules()
    } catch {
      // ignore
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    const res = await fetch(`/api/v1/recurring-invoices/${deleteId}`, {
      method: "DELETE",
      headers: headers(),
    })
    if (!res.ok) throw new Error(tc("errorDeleteFailed"))
    fetchRules()
  }

  const handleGenerateNow = async () => {
    setGenerating(true)
    setGenerateReport(null)
    try {
      const res = await fetch("/api/v1/recurring-invoices/generate", {
        method: "POST",
        headers: headers(),
      })
      const json = await res.json()
      if (json.data?.report) {
        setGenerateReport(json.data.report)
      }
      fetchRules()
    } catch {
      // ignore
    } finally {
      setGenerating(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    if (selectedIds.size === rules.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(rules.map((r) => r.id)))
    }
  }

  const handleBulkToggle = async (activate: boolean) => {
    for (const id of selectedIds) {
      await fetch(`/api/v1/recurring-invoices/${id}`, {
        method: "PUT",
        headers: headers(),
        body: JSON.stringify({ isActive: activate }),
      })
    }
    setSelectedIds(new Set())
    fetchRules()
  }

  const updateItem = (
    index: number,
    field: keyof RecurringInvoiceItem,
    value: string | number
  ) => {
    setItems((prev) => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }

  const removeItem = (index: number) => {
    setItems((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((_, i) => i !== index)
    })
  }

  const addItem = () => {
    setItems((prev) => [...prev, emptyItem()])
  }

  const frequencyLabel = (freq: string) => {
    switch (freq) {
      case "daily":
        return t("freqDaily")
      case "weekly":
        return t("freqWeekly")
      case "monthly":
        return t("freqMonthly")
      case "quarterly":
        return t("freqQuarterly")
      case "yearly":
        return t("freqYearly")
      default:
        return freq
    }
  }

  const formatDate = (d: string | null) => {
    if (!d) return "—"
    return new Date(d).toLocaleDateString()
  }

  const activeCount = rules.filter((r) => r.isActive).length
  const pausedCount = rules.length - activeCount
  const [search, setSearch] = useState("")
  const filteredRules = rules.filter((r) => {
    if (!search) return true
    const q = search.toLowerCase()
    return r.title.toLowerCase().includes(q) || (r.company?.name || "").toLowerCase().includes(q) || (r.recipientEmail || "").toLowerCase().includes(q)
  })

  if (loading) {
    return (
      <div className="-mx-6 -mt-6 min-h-screen bg-muted/30">
        <div className="bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-6">
          <div className="animate-pulse h-12 bg-white/20 rounded-lg w-64" />
        </div>
        <div className="px-6 pt-6">
          <div className="animate-pulse h-96 bg-muted rounded-lg" />
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-6 -mt-6 min-h-screen bg-muted/30 pb-20">
      {/* Gradient Header */}
      <div className="bg-gradient-to-r from-cyan-600 to-blue-600 px-6 py-5 shadow-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="sm" onClick={() => router.push("/invoices")} className="text-white/80 hover:text-white hover:bg-white/10">
              <ArrowLeft className="h-4 w-4 mr-1" /> {t("backToList")}
            </Button>
            <div>
              <h1 className="text-xl font-bold text-white flex items-center gap-2">{t("recurringInvoices")} <HelpButton slug="invoices-recurring" variant="label" className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white" /></h1>
              <p className="text-white/70 text-xs mt-0.5">{rules.length} {t("recurring").toLowerCase()}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="bg-white/10 border-white/30 text-white hover:bg-white/20" onClick={handleGenerateNow} disabled={generating}>
              <RefreshCw className={`h-4 w-4 mr-1 ${generating ? "animate-spin" : ""}`} /> Hazırla və göndər
            </Button>
            <Button size="sm" className="bg-white text-cyan-700 hover:bg-white/90" onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-1" /> Yeni
            </Button>
          </div>
        </div>
      </div>

      <div className="px-6 pt-5 space-y-4">

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-cyan-100 dark:bg-cyan-900 flex items-center justify-center">
              <RefreshCw className="h-5 w-5 text-cyan-600" />
            </div>
            <div>
              <p className="text-2xl font-bold">{rules.length}</p>
              <p className="text-xs text-muted-foreground">{t("totalRules")}</p>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center">
              <Play className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{activeCount}</p>
              <p className="text-xs text-muted-foreground">{t("active")}</p>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-orange-100 dark:bg-orange-900 flex items-center justify-center">
              <Pause className="h-5 w-5 text-orange-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-orange-600">{pausedCount}</p>
              <p className="text-xs text-muted-foreground">{t("pausedLabel")}</p>
            </div>
          </div>
        </div>

        {/* Bulk actions bar */}
        {selectedIds.size > 0 && (
          <div className="rounded-xl border-2 border-cyan-400 bg-cyan-50 dark:bg-cyan-950 p-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-cyan-800 dark:text-cyan-200">{t("selectedCount", { count: selectedIds.size })}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="h-8 text-green-700 border-green-300 hover:bg-green-50" onClick={() => handleBulkToggle(true)}>
                <Play className="h-3.5 w-3.5 mr-1" /> {t("activateBtn")}
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-orange-700 border-orange-300 hover:bg-orange-50" onClick={() => handleBulkToggle(false)}>
                <Pause className="h-3.5 w-3.5 mr-1" /> {t("pauseBtn")}
              </Button>
              <Button size="sm" className="h-8 bg-cyan-600 hover:bg-cyan-700" onClick={handleGenerateNow} disabled={generating}>
                <RefreshCw className={`h-3.5 w-3.5 mr-1 ${generating ? "animate-spin" : ""}`} /> {t("generateBtn")}
              </Button>
            </div>
          </div>
        )}

        {/* Generate report */}
        {generateReport && generateReport.length > 0 && (
          <div className="rounded-xl border border-green-300 bg-green-50 dark:bg-green-950 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-green-800">{t("lastResult", { sent: generateReport.filter(r => r.status === "sent").length, errors: generateReport.filter(r => r.status === "send_failed").length })}</h3>
              <Button variant="ghost" size="sm" onClick={() => setGenerateReport(null)} className="h-6 text-xs text-green-700">{t("closeBtn")}</Button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {generateReport.map((r, i) => (
                <div key={i} className={`flex justify-between py-1.5 px-3 rounded-lg text-xs ${r.status === "sent" ? "bg-green-100 text-green-800" : r.status === "send_failed" ? "bg-red-100 text-red-800" : "bg-card"}`}>
                  <span className="font-medium">{r.invoiceNumber} — {r.company || "?"}</span>
                  <span>{r.status === "sent" ? t("statusSent") : r.status === "send_failed" ? (t("statusSendFailed") + ": " + (r.error || "").slice(0, 40)) : t("statusDraft")}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Search + Select All */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <input
              className="w-full h-9 pl-9 pr-3 text-sm border border-zinc-200 dark:border-zinc-700 rounded-lg bg-card focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none"
              placeholder="Axtar... (şirkət, ad, email)"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={selectedIds.size === filteredRules.length && filteredRules.length > 0}
              onChange={toggleSelectAll}
              className="h-4 w-4 rounded border-zinc-200 dark:border-zinc-700 accent-cyan-600"
            />
            <span className="text-xs text-muted-foreground">Hamısı ({filteredRules.length})</span>
          </label>
        </div>

        {/* Table */}
        <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card overflow-hidden shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-xs text-muted-foreground uppercase tracking-wider">
                <th className="w-10 px-3 py-2.5"></th>
                <th className="px-3 py-2.5 text-left">Şirkət / Başlıq</th>
                <th className="px-3 py-2.5 text-left">Email</th>
                <th className="px-3 py-2.5 text-center">Status</th>
                <th className="px-3 py-2.5 text-center">Növbəti</th>
                <th className="px-3 py-2.5 text-center">Yaradılıb</th>
                <th className="px-3 py-2.5 text-right w-24"></th>
              </tr>
            </thead>
            <tbody>
              {filteredRules.map((rule, i) => (
                <tr key={rule.id}
                  className={`border-b transition-colors hover:bg-cyan-50/50 dark:hover:bg-cyan-900/10 ${i % 2 === 1 ? "bg-muted/20" : ""} ${selectedIds.has(rule.id) ? "bg-cyan-50 dark:bg-cyan-950" : ""}`}
                >
                  <td className="px-3 py-2.5">
                    <input type="checkbox" checked={selectedIds.has(rule.id)} onChange={() => toggleSelect(rule.id)} className="h-4 w-4 rounded accent-cyan-600" />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-sm">{rule.company?.name || rule.title}</div>
                    {rule.company && <div className="text-xs text-muted-foreground truncate max-w-[250px]">{rule.title}</div>}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs text-muted-foreground">{rule.recipientEmail || "—"}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {rule.isActive ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-100 dark:bg-green-900 dark:text-green-300 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" /> {t("active")}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-orange-700 bg-orange-100 dark:bg-orange-900 dark:text-orange-300 px-2 py-0.5 rounded-full">
                        <span className="h-1.5 w-1.5 rounded-full bg-orange-500" /> {t("pausedLabel")}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-xs font-mono">{formatDate(rule.nextRunDate)}</span>
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <span className="text-xs tabular-nums">{rule.totalGenerated}</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <button onClick={() => handleToggleActive(rule)} className={`p-1.5 rounded-md transition-colors ${rule.isActive ? "hover:bg-orange-100 text-orange-600" : "hover:bg-green-100 text-green-600"}`} title={rule.isActive ? t("stopTooltip") : t("activateTooltip")}>
                        {rule.isActive ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </button>
                      <button onClick={() => { setDeleteId(rule.id); setDeleteName(rule.title) }} className="p-1.5 rounded-md hover:bg-red-100 text-red-500 transition-colors" title={t("deleteTooltip")}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredRules.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">Nəticə tapılmadı</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("newRecurring")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Title */}
            <div className="space-y-1">
              <Label>{t("titleField")} *</Label>
              <Input
                value={form.title}
                onChange={(e) => {
                  const val = e.target.value
                  setForm((f) => ({
                    ...f,
                    title: val,
                    // Auto-fill template if user hasn't manually edited it
                    titleTemplate: !f.titleTemplate || f.titleTemplate === `${f.title} — {month} {year}`
                      ? `${val} — {month} {year}`
                      : f.titleTemplate,
                  }))
                }}
                placeholder={t("recurringTitlePlaceholder")}
              />
            </div>

            {/* Title Template */}
            <div className="space-y-1">
              <Label>Title Template</Label>
              <Input
                value={form.titleTemplate}
                onChange={(e) =>
                  setForm((f) => ({ ...f, titleTemplate: e.target.value }))
                }
                placeholder="{title} — {month} {year}"
              />
              <p className="text-xs text-muted-foreground">
                Variables: {"{month}"}, {"{year}"}, {"{number}"}. Leave empty to use static title.
              </p>
            </div>

            {/* Company */}
            <div className="space-y-1">
              <Label>{t("company")}</Label>
              <Select
                value={form.companyId}
                onChange={(e) =>
                  setForm((f) => ({ ...f, companyId: e.target.value }))
                }
              >
                <option value="">{t("selectCompany")}</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>

            {/* Frequency + Interval */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{t("frequency")}</Label>
                <Select
                  value={form.frequency}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, frequency: e.target.value }))
                  }
                >
                  <option value="daily">{t("freqDaily")}</option>
                  <option value="weekly">{t("freqWeekly")}</option>
                  <option value="monthly">{t("freqMonthly")}</option>
                  <option value="quarterly">
                    {t("freqQuarterly")}
                  </option>
                  <option value="yearly">{t("freqYearly")}</option>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>{t("intervalCount")}</Label>
                <Input
                  type="number"
                  min={1}
                  value={form.intervalCount}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      intervalCount: Number(e.target.value) || 1,
                    }))
                  }
                />
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{t("startDate")}</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, startDate: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1">
                <Label>{t("endDate")}</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, endDate: e.target.value }))
                  }
                />
              </div>
            </div>

            {/* Max Occurrences */}
            <div className="space-y-1">
              <Label>{t("maxOccurrences")}</Label>
              <Input
                type="number"
                min={0}
                value={form.maxOccurrences}
                onChange={(e) =>
                  setForm((f) => ({ ...f, maxOccurrences: e.target.value }))
                }
                placeholder={t("unlimited")}
              />
            </div>

            {/* Currency + VAT */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label>{t("currency")}</Label>
                <Select
                  value={form.currency}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, currency: e.target.value }))
                  }
                >
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => (
                    <option key={code} value={code}>{code} {sym}</option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.includeVat}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, includeVat: e.target.checked }))
                    }
                    className="rounded border-zinc-200 dark:border-zinc-700"
                  />
                  {t("includeVat")}
                </Label>
              </div>
              {form.includeVat && (
                <div className="space-y-1">
                  <Label>{t("taxRate")}</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    max={1}
                    value={form.taxRate}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, taxRate: e.target.value }))
                    }
                  />
                </div>
              )}
            </div>

            {/* Payment Terms */}
            <div className="space-y-1">
              <Label>{t("paymentTerms")}</Label>
              <Select
                value={form.paymentTerms}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    paymentTerms: e.target.value,
                  }))
                }
              >
                <option value="">{t("selectPaymentTerms")}</option>
                <option value="net_7">Net 7</option>
                <option value="net_15">Net 15</option>
                <option value="net_30">Net 30</option>
                <option value="net_45">Net 45</option>
                <option value="net_60">Net 60</option>
                <option value="due_on_receipt">
                  {t("dueOnReceipt")}
                </option>
              </Select>
            </div>

            {/* Recipient Email */}
            <div className="space-y-1">
              <Label>{t("recipientEmail")}</Label>
              <Input
                type="email"
                value={form.recipientEmail}
                onChange={(e) =>
                  setForm((f) => ({ ...f, recipientEmail: e.target.value }))
                }
                placeholder="email@example.com"
              />
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <Label>{t("notes")}</Label>
              <Textarea
                value={form.notes}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
                rows={3}
              />
            </div>

            {/* Items */}
            <div className="space-y-2">
              <Label>{t("items")}</Label>
              <div className="border border-zinc-200 dark:border-zinc-700 rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2 font-medium">
                        {t("itemName")}
                      </th>
                      <th className="text-right p-2 font-medium w-20">
                        {t("qty")}
                      </th>
                      <th className="text-right p-2 font-medium w-28">
                        {t("unitPrice")}
                      </th>
                      <th className="text-right p-2 font-medium w-24">
                        {t("discount")}
                      </th>
                      <th className="p-2 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-1">
                          <Input
                            value={item.name}
                            onChange={(e) =>
                              updateItem(idx, "name", e.target.value)
                            }
                            className="h-8"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "quantity",
                                Number(e.target.value) || 1
                              )
                            }
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "unitPrice",
                                Number(e.target.value) || 0
                              )
                            }
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="p-1">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.discount}
                            onChange={(e) =>
                              updateItem(
                                idx,
                                "discount",
                                Number(e.target.value) || 0
                              )
                            }
                            className="h-8 text-right"
                          />
                        </td>
                        <td className="p-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            onClick={() => removeItem(idx)}
                            disabled={items.length <= 1}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={addItem}
                type="button"
              >
                <Plus className="h-3 w-3 mr-1" /> {t("addItem")}
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={saving}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || !form.title.trim()}
            >
              {saving ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin mr-1" />
                  {t("saving")}
                </>
              ) : (
                t("create")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null)
        }}
        onConfirm={handleDelete}
        title={t("deleteRecurring")}
        itemName={deleteName}
      />
    </div>
  )
}
