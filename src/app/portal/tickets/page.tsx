"use client"

import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Plus, Search, ChevronRight, MessageSquareWarning } from "lucide-react"
import { useRouter } from "next/navigation"

interface Ticket {
  id: string
  ticketNumber: string
  subject: string
  description?: string
  status: string
  priority: string
  category?: string
  createdAt: string
}

const statusColors: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "destructive", in_progress: "default", waiting: "secondary", resolved: "outline", closed: "outline",
}

export default function PortalTicketsPage() {
  const t = useTranslations("portal")
  const [tickets, setTickets] = useState<Ticket[]>([])
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  // Auto-open form if ?action=new (from chat widget "New Ticket" button)
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.search.includes("action=new")) {
      setShowForm(true)
    }
  }, [])
  const [search, setSearch] = useState("")
  const [subject, setSubject] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("general")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  // Complaints Register (optional feature, per-tenant)
  const [complaintsEnabled, setComplaintsEnabled] = useState(false)
  const [brandOptions, setBrandOptions] = useState<string[]>([])
  const [productOptions, setProductOptions] = useState<string[]>([])
  const [asComplaint, setAsComplaint] = useState(false)
  const [complaintMeta, setComplaintMeta] = useState({
    complaintType: "complaint" as "complaint" | "suggestion",
    brand: "",
    productCategory: "",
    complaintObject: "",
    complaintObjectDetail: "",
  })

  const fetchTickets = async () => {
    try {
      const res = await fetch("/api/v1/public/portal-tickets")
      const json = await res.json()
      if (json.success) setTickets(json.data.tickets || json.data || [])
    } catch (err) { console.error(err) } finally { setLoading(false) }
  }

  useEffect(() => { fetchTickets() }, [])

  // Load tenant config once — decides whether to show the "complaint" toggle.
  useEffect(() => {
    fetch("/api/v1/public/portal-config")
      .then((r) => r.json())
      .then((j) => {
        if (j.success) {
          setComplaintsEnabled(!!j.data.features?.complaints_register)
          setBrandOptions(j.data.brands || [])
          setProductOptions(j.data.productCategories || [])
        }
      })
      .catch(() => {})
  }, [])

  // Poll for updates every 20 seconds
  useEffect(() => {
    const interval = setInterval(fetchTickets, 20000)
    return () => clearInterval(interval)
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError("")
    try {
      const res = await fetch("/api/v1/public/portal-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject,
          description,
          category,
          ...(asComplaint && complaintsEnabled
            ? {
                isComplaint: true,
                complaintMeta: {
                  complaintType: complaintMeta.complaintType,
                  brand: complaintMeta.brand || null,
                  productCategory: complaintMeta.productCategory || null,
                  complaintObject: complaintMeta.complaintObject || null,
                  complaintObjectDetail: complaintMeta.complaintObjectDetail || null,
                },
              }
            : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Failed to create")
      setSubject("")
      setDescription("")
      setAsComplaint(false)
      setComplaintMeta({ complaintType: "complaint", brand: "", productCategory: "", complaintObject: "", complaintObjectDetail: "" })
      setShowForm(false)
      fetchTickets()
    } catch (err: any) {
      setError(err.message)
    } finally { setSaving(false) }
  }

  const filtered = tickets.filter(tk =>
    tk.subject.toLowerCase().includes(search.toLowerCase()) ||
    tk.ticketNumber.toLowerCase().includes(search.toLowerCase())
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">{t("myTickets")}</h1>
        <div className="animate-pulse space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-lg" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">{t("myTickets")}</h1>
          <p className="text-muted-foreground text-sm mt-1">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="rounded-full">
          <Plus className="h-4 w-4 mr-1" /> {t("newTicket")}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="pt-4">
            <form onSubmit={handleCreate} className="space-y-4">
              {error && <div className="text-sm text-destructive bg-destructive/10 p-2 rounded-lg">{error}</div>}
              <div>
                <label className="text-sm font-medium">Subject *</label>
                <Input value={subject} onChange={e => setSubject(e.target.value)} placeholder={t("describeIssue")} required className="mt-1" />
              </div>
              <div>
                <label className="text-sm font-medium">Category</label>
                <Select value={category} onChange={e => setCategory(e.target.value)} className="mt-1" disabled={asComplaint}>
                  <option value="general">{t("categoryGeneral")}</option>
                  <option value="technical">{t("categoryTechnical")}</option>
                  <option value="billing">{t("categoryBilling")}</option>
                  <option value="feature_request">{t("categoryFeature")}</option>
                </Select>
              </div>
              {complaintsEnabled && (
                <label className="flex items-start gap-2 text-sm cursor-pointer p-2 -mx-2 rounded hover:bg-muted/40">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={asComplaint}
                    onChange={(e) => setAsComplaint(e.target.checked)}
                  />
                  <span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <MessageSquareWarning className="h-3.5 w-3.5 text-amber-600" />
                      This is a complaint about a product
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      Helps us route it to the right team (quality, sales, logistics…).
                    </span>
                  </span>
                </label>
              )}
              {complaintsEnabled && asComplaint && (
                <div className="rounded-lg border border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-900/10 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-sm font-medium">Type</label>
                      <Select
                        value={complaintMeta.complaintType}
                        onChange={(e) => setComplaintMeta((m) => ({ ...m, complaintType: e.target.value as "complaint" | "suggestion" }))}
                        className="mt-1"
                      >
                        <option value="complaint">Complaint</option>
                        <option value="suggestion">Suggestion</option>
                      </Select>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Brand</label>
                      <Input
                        list="portal-complaint-brands"
                        value={complaintMeta.brand}
                        onChange={(e) => setComplaintMeta((m) => ({ ...m, brand: e.target.value }))}
                        className="mt-1"
                        autoComplete="off"
                      />
                      <datalist id="portal-complaint-brands">
                        {brandOptions.map((b) => <option key={b} value={b} />)}
                      </datalist>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Product</label>
                      <Input
                        list="portal-complaint-products"
                        value={complaintMeta.productCategory}
                        onChange={(e) => setComplaintMeta((m) => ({ ...m, productCategory: e.target.value }))}
                        className="mt-1"
                        autoComplete="off"
                      />
                      <datalist id="portal-complaint-products">
                        {productOptions.map((p) => <option key={p} value={p} />)}
                      </datalist>
                    </div>
                    <div>
                      <label className="text-sm font-medium">Issue</label>
                      <Input
                        value={complaintMeta.complaintObject}
                        onChange={(e) => setComplaintMeta((m) => ({ ...m, complaintObject: e.target.value }))}
                        placeholder="quality, delivery, price…"
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Risk level and the handling department will be filled in by the team.
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">Description</label>
                <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t("provideDetails")} rows={4} className="mt-1" />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="rounded-full">{saving ? t("creating") : t("submitTicket")}</Button>
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder={t("searchTickets")} value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
      </div>

      <div className="space-y-3">
        {filtered.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              {tickets.length === 0 ? t("noTickets") : "No tickets match your search."}
            </CardContent>
          </Card>
        ) : (
          filtered.map(ticket => (
            <Card key={ticket.id} className="hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => router.push(`/portal/tickets/${ticket.id}`)}>
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{ticket.subject}</span>
                      <Badge variant={statusColors[ticket.status] || "outline"}>{ticket.status.replace(/_/g, " ")}</Badge>
                      <Badge variant="outline" className="text-xs">{ticket.priority}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {ticket.ticketNumber} · {new Date(ticket.createdAt).toLocaleDateString()}
                      {ticket.category ? ` · ${ticket.category}` : ""}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  )
}
