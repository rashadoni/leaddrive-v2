"use client"

/**
 * Suppliers — the companies an organization buys from (docs/sales-procurement/README.md,
 * task 2.1). A supplier is a company of the category `supplier`, so the row
 * opens the ordinary company card with its contacts and history.
 */
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSession } from "next-auth/react"
import { useTranslations } from "next-intl"
import { Loader2, Plus, Search, Truck, Upload } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { checkPermission, type Role } from "@/lib/permissions"
import { StatusTabs } from "@/components/procurement/status-tabs"
import { ExcelImportDialog } from "@/components/excel-import-dialog"

interface SupplierRow {
  id: string
  name: string
  voen: string | null
  director: string | null
  phone: string | null
  email: string | null
  city: string | null
  status: string
}

type StatusTab = "active" | "inactive" | "all"

const EMPTY_FORM = { name: "", voen: "", director: "", phone: "", email: "", website: "", address: "", city: "", description: "" }

export default function SuppliersPage() {
  const t = useTranslations("procurement.suppliers")
  const { data: session } = useSession()
  const role = ((session?.user as { role?: string } | undefined)?.role || "viewer") as Role
  const canAdd = checkPermission(role, "procurement", "write")

  const [suppliers, setSuppliers] = useState<SupplierRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState<StatusTab>("active")
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const ti = useTranslations("excelImport")
  const reads = useRef(0)

  const load = useCallback(async () => {
    // Only the latest read may write the list: a slow answer to an older
    // search must not replace a newer one.
    const read = ++reads.current
    setLoading(true)
    try {
      const params = new URLSearchParams({ status: tab, limit: "200" })
      if (search.trim()) params.set("search", search.trim())
      const res = await fetch(`/api/v1/procurement/suppliers?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const body = await res.json()
      if (read !== reads.current) return
      setSuppliers(body.data?.suppliers ?? [])
      setTotal(body.data?.total ?? 0)
    } catch {
      if (read !== reads.current) return
      toast.error(t("loadFailed"))
      setSuppliers([])
      setTotal(0)
    } finally {
      if (read === reads.current) setLoading(false)
    }
  }, [search, tab, t])

  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 250)
    return () => clearTimeout(timer)
  }, [load])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      toast.error(t("nameRequired"))
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/v1/procurement/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body?.code === "INVALID_VOEN" ? t("invalidVoen") : t("createFailed"))
        return
      }
      toast.success(t("created"))
      setOpen(false)
      setForm(EMPTY_FORM)
      void load()
    } catch {
      toast.error(t("createFailed"))
    } finally {
      setSaving(false)
    }
  }

  const field = (key: keyof typeof EMPTY_FORM, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="space-y-1.5">
      <Label htmlFor={`supplier-${key}`}>{label}</Label>
      <Input id={`supplier-${key}`} value={form[key]} onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} {...props} />
    </div>
  )

  const TABS: { id: StatusTab; label: string }[] = [
    { id: "active", label: t("activeTab") },
    { id: "inactive", label: t("inactiveTab") },
    { id: "all", label: t("allTab") },
  ]

  return (
    <div className="flex-1 space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Truck className="h-7 w-7 text-orange-600" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
            <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
          </div>
        </div>
        {canAdd && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" />
              {ti("button")}
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("add")}
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[16rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <StatusTabs tabs={TABS} value={tab} onChange={setTab} />
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : suppliers.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="font-medium">{t("empty")}</p>
          <p className="mt-1 text-sm text-muted-foreground">{t("emptyHint")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">{t("count", { count: total })}</p>
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{t("name")}</th>
                  <th className="px-4 py-2 font-medium">{t("voen")}</th>
                  <th className="px-4 py-2 font-medium">{t("phone")}</th>
                  <th className="px-4 py-2 font-medium">{t("email")}</th>
                  <th className="px-4 py-2 font-medium">{t("city")}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <Link href={`/companies/${supplier.id}`} className="font-medium text-primary hover:underline" title={t("open")}>
                        {supplier.name}
                      </Link>
                      {supplier.director && <div className="text-xs text-muted-foreground">{supplier.director}</div>}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{supplier.voen || "—"}</td>
                    <td className="px-4 py-2">{supplier.phone || "—"}</td>
                    <td className="px-4 py-2">{supplier.email || "—"}</td>
                    <td className="px-4 py-2">{supplier.city || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Dialog open={open} onOpenChange={(next) => { if (!saving) setOpen(next) }} widthClassName="max-w-[44rem]">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("add")}</DialogTitle>
          </DialogHeader>
          <DialogContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">{field("name", t("name"), { required: true, maxLength: 200, autoFocus: true })}</div>
              {field("voen", t("voen"), { inputMode: "numeric", maxLength: 12 })}
              {field("director", t("director"), { maxLength: 200 })}
              {field("phone", t("phone"), { type: "tel", maxLength: 60 })}
              {field("email", t("email"), { type: "email", maxLength: 200 })}
              {field("website", t("website"), { maxLength: 300 })}
              {field("city", t("city"), { maxLength: 120 })}
              <div className="sm:col-span-2">{field("address", t("address"), { maxLength: 500 })}</div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="supplier-description">{t("notes")}</Label>
                <Textarea id="supplier-description" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
          </DialogContent>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>{t("cancel")}</Button>
            <Button type="submit" disabled={saving}>
              {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t("saving")}</> : t("save")}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      <ExcelImportDialog open={importOpen} onOpenChange={setImportOpen} entity="suppliers" onImported={() => { void load() }} />
    </div>
  )
}
