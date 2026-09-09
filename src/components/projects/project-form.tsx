"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { motion, AnimatePresence } from "framer-motion"
import { X } from "lucide-react"
import { CURRENCY_SYMBOLS, getCurrencySymbol } from "@/lib/constants"

interface ProjectFormProps {
  open: boolean
  onClose: () => void
  onSaved: () => void
  editData?: {
    id: string
    name: string
    description?: string
    status: string
    priority: string
    startDate?: string
    endDate?: string
    budget: number
    color: string
    managerId?: string
    companyId?: string
    dealId?: string
    currency: string
    tags: string[]
  }
}

export function ProjectForm({ open, onClose, onSaved, editData }: ProjectFormProps) {
  const { data: session } = useSession()
  const t = useTranslations("projects")
  const orgId = session?.user?.organizationId

  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formStatus, setFormStatus] = useState("planning")
  const [formPriority, setFormPriority] = useState("medium")
  const [formStartDate, setFormStartDate] = useState("")
  const [formEndDate, setFormEndDate] = useState("")
  const [formBudget, setFormBudget] = useState("")
  const [formColor, setFormColor] = useState("#6366f1")
  const [formManagerId, setFormManagerId] = useState("")
  const [formCompanyId, setFormCompanyId] = useState("")
  const [formDealId, setFormDealId] = useState("")
  const [formCurrency, setFormCurrency] = useState("USD")
  const [formTags, setFormTags] = useState<string[]>([])
  const [formTagInput, setFormTagInput] = useState("")
  const [saving, setSaving] = useState(false)

  const [users, setUsers] = useState<{ id: string; name: string }[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [deals, setDeals] = useState<{ id: string; name: string }[]>([])

  const statusLabels: Record<string, string> = {
    planning: t("statusPlanning"), active: t("statusActive"), on_hold: t("statusOnHold"),
    completed: t("statusCompleted"), cancelled: t("statusCancelled"),
  }
  const priorityLabels: Record<string, string> = {
    low: t("priorityLow"), medium: t("priorityMedium"), high: t("priorityHigh"), critical: t("priorityCritical"),
  }

  useEffect(() => {
    if (!orgId) return
    const h = { "x-organization-id": String(orgId) }
    fetch("/api/v1/users", { headers: h }).then(r => r.json()).then(j => {
      if (j.success) setUsers((j.data?.users || j.data || []).map((u: any) => ({ id: u.id, name: u.name || u.email })))
    }).catch(() => {})
    fetch("/api/v1/companies?limit=500", { headers: h }).then(r => r.json()).then(j => {
      if (j.success) setCompanies((j.data?.companies || j.data || []).map((c: any) => ({ id: c.id, name: c.name })))
    }).catch(() => {})
    fetch("/api/v1/deals?limit=500", { headers: h }).then(r => r.json()).then(j => {
      if (j.success) setDeals((j.data?.deals || j.data || []).map((d: any) => ({ id: d.id, name: d.name || d.title })))
    }).catch(() => {})
  }, [orgId])

  useEffect(() => {
    if (editData) {
      setFormName(editData.name)
      setFormDesc(editData.description || "")
      setFormStatus(editData.status)
      setFormPriority(editData.priority)
      setFormStartDate(editData.startDate ? editData.startDate.split("T")[0] : "")
      setFormEndDate(editData.endDate ? editData.endDate.split("T")[0] : "")
      setFormBudget(editData.budget ? String(editData.budget) : "")
      setFormColor(editData.color || "#6366f1")
      setFormManagerId(editData.managerId || "")
      setFormCompanyId(editData.companyId || "")
      setFormDealId(editData.dealId || "")
      setFormCurrency(editData.currency || "USD")
      setFormTags(editData.tags || [])
      setFormTagInput("")
    } else {
      setFormName(""); setFormDesc(""); setFormStatus("planning"); setFormPriority("medium")
      setFormStartDate(""); setFormEndDate(""); setFormBudget(""); setFormColor("#6366f1")
      setFormManagerId(""); setFormCompanyId(""); setFormDealId(""); setFormCurrency("USD")
      setFormTags([]); setFormTagInput("")
    }
  }, [editData, open])

  async function handleSave() {
    if (!formName.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        status: formStatus, priority: formPriority,
        startDate: formStartDate || undefined, endDate: formEndDate || undefined,
        budget: formBudget ? parseFloat(formBudget) : undefined,
        color: formColor,
        managerId: formManagerId || null, companyId: formCompanyId || null,
        dealId: formDealId || null, currency: formCurrency, tags: formTags,
      }
      const url = editData ? `/api/v1/projects/${editData.id}` : "/api/v1/projects"
      const method = editData ? "PUT" : "POST"
      const res = await fetch(url, {
        method, headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: JSON.stringify(payload),
      })
      if (res.ok) { onClose(); onSaved() }
    } catch (err) { console.error(err) } finally { setSaving(false) }
  }

  return (
    <AnimatePresence>
    {open && (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
        className="bg-background rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold">{editData ? t("editProject") : t("newProject")}</h2>
            <button onClick={onClose} className="p-1 hover:bg-muted rounded"><X className="h-5 w-5" /></button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">{t("name")} *</label>
              <input value={formName} onChange={e => setFormName(e.target.value)} placeholder={t("name")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring" />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("description")}</label>
              <textarea value={formDesc} onChange={e => setFormDesc(e.target.value)} rows={3}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">{t("status")}</label>
                <select value={formStatus} onChange={e => setFormStatus(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">{t("priority")}</label>
                <select value={formPriority} onChange={e => setFormPriority(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  {Object.entries(priorityLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">{t("startDate")}</label>
                <input type="date" value={formStartDate} onChange={e => setFormStartDate(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">{t("endDate")}</label>
                <input type="date" value={formEndDate} onChange={e => setFormEndDate(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">{t("manager")}</label>
                <select value={formManagerId} onChange={e => setFormManagerId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="">— {t("selectManager")} —</option>
                  {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">{t("company")}</label>
                <select value={formCompanyId} onChange={e => setFormCompanyId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="">— {t("selectCompany")} —</option>
                  {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">{t("deal")}</label>
                <select value={formDealId} onChange={e => setFormDealId(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  <option value="">— {t("selectDeal")} —</option>
                  {deals.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">{t("currency")}</label>
                <select value={formCurrency} onChange={e => setFormCurrency(e.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
                  {Object.entries(CURRENCY_SYMBOLS).map(([code, sym]) => <option key={code} value={code}>{code} {sym}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-sm font-medium mb-1 block">{t("budget")} ({getCurrencySymbol(formCurrency)})</label>
                <input type="number" value={formBudget} onChange={e => setFormBudget(e.target.value)} placeholder="0" className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">{t("color")}</label>
                <div className="flex items-center gap-2">
                  <input type="color" value={formColor} onChange={e => setFormColor(e.target.value)} className="h-9 w-12 rounded border border-zinc-200 dark:border-zinc-700 cursor-pointer" />
                  <span className="text-xs text-muted-foreground font-mono">{formColor}</span>
                </div>
              </div>
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">{t("tags")}</label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {formTags.map(tag => (
                  <Badge key={tag} variant="secondary" className="gap-1 pr-1">
                    {tag}
                    <button type="button" onClick={() => setFormTags(formTags.filter(t2 => t2 !== tag))} className="hover:text-destructive">
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
              <input value={formTagInput} onChange={e => setFormTagInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    const v = formTagInput.trim()
                    if (v && !formTags.includes(v)) { setFormTags([...formTags, v]); setFormTagInput("") }
                  }
                }}
                placeholder={t("addTagPlaceholder")}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <Button variant="outline" className="flex-1" onClick={onClose}>{t("cancel")}</Button>
            <Button className="flex-1" onClick={handleSave} disabled={saving || !formName.trim()}>
              {saving ? "..." : editData ? t("save") : t("create")}
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
    )}
    </AnimatePresence>
  )
}
