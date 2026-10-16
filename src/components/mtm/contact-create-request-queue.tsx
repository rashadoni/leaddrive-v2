"use client"

import { useCallback, useEffect, useState } from "react"
import { useLocale } from "next-intl"
import { AlertTriangle, Check, RefreshCw, UserPlus, X } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type RequestRow = {
  id: string
  displayName: string
  specialtyName?: string | null
  phone?: string | null
  clinicName: string
  address?: string | null
  notes?: string | null
  duplicateSnapshot?: Array<{ id: string; displayName: string; exact: boolean; reasons: string[] }> | null
  requestedByAgent: { id: string; name: string }
}

const COPY = {
  ru: { waitingOne: "Новый врач от агента ждёт решения", waitingMany: "Новые врачи от агентов ждут решения", andMore: "и ещё {count}", review: "Рассмотреть", collapse: "Свернуть", title: "Заявки на новых врачей", hint: "Проверьте возможные дубли. Одобрение создаст врача, клинику и привязку к агенту.", empty: "Новых заявок нет.", refresh: "Обновить", approve: "Одобрить", reject: "Отклонить", comment: "Комментарий к решению", duplicate: "Возможные дубли", from: "Агент", failed: "Не удалось выполнить действие", approved: "Врач добавлен", rejected: "Заявка отклонена" },
  az: { waitingOne: "Agentdən yeni həkim qərar gözləyir", waitingMany: "Agentlərdən yeni həkimlər qərar gözləyir", andMore: "və daha {count}", review: "Nəzərdən keçir", collapse: "Yığ", title: "Yeni həkim sorğuları", hint: "Mümkün dubları yoxlayın. Təsdiq həkimi, klinikanı və agent əlaqəsini yaradacaq.", empty: "Yeni sorğu yoxdur.", refresh: "Yenilə", approve: "Təsdiq et", reject: "Rədd et", comment: "Qərar şərhi", duplicate: "Mümkün dublar", from: "Agent", failed: "Əməliyyat alınmadı", approved: "Həkim əlavə edildi", rejected: "Sorğu rədd edildi" },
  en: { waitingOne: "A new doctor from an agent awaits a decision", waitingMany: "New doctors from agents await a decision", andMore: "and {count} more", review: "Review", collapse: "Collapse", title: "New doctor requests", hint: "Review possible duplicates. Approval creates the doctor, clinic and agent assignment.", empty: "No new requests.", refresh: "Refresh", approve: "Approve", reject: "Reject", comment: "Decision comment", duplicate: "Possible duplicates", from: "Agent", failed: "The action failed", approved: "Doctor added", rejected: "Request rejected" },
} as const

function language(value: string): keyof typeof COPY {
  if (value.startsWith("az")) return "az"
  if (value.startsWith("en")) return "en"
  return "ru"
}

export function ContactCreateRequestQueue() {
  const copy = COPY[language(useLocale())]
  const [rows, setRows] = useState<RequestRow[]>([])
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch("/api/v1/mtm/contact-create-requests", { headers: { Accept: "application/json" } })
      const body = await response.json().catch(() => null)
      // The queue belongs to whoever may decide the requests. A field agent, or
      // a login without an employee card, is refused it — which is not an error
      // on their Clients screen: they simply have no queue. This used to raise a
      // red "Forbidden" toast on every visit.
      if (response.status === 403) {
        setRows([])
        return
      }
      if (!response.ok || !body?.success) throw new Error(body?.error || copy.failed)
      setRows(Array.isArray(body.data?.requests) ? body.data.requests : [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.failed)
    } finally {
      setLoading(false)
    }
  }, [copy.failed])

  useEffect(() => { void load() }, [load])

  const decide = async (id: string, decision: "APPROVED" | "REJECTED") => {
    setBusy(id)
    try {
      const response = await fetch(`/api/v1/mtm/contact-create-requests/${id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comment: comments[id]?.trim() || null }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) {
        const duplicateNames = Array.isArray(body?.duplicateCandidates)
          ? body.duplicateCandidates.map((item: { displayName?: string }) => item.displayName).filter(Boolean).join(", ")
          : ""
        throw new Error(duplicateNames ? `${body?.error || copy.failed}: ${duplicateNames}` : body?.error || copy.failed)
      }
      toast.success(decision === "APPROVED" ? copy.approved : copy.rejected)
      setRows((current) => current.filter((row) => row.id !== id))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : copy.failed)
    } finally {
      setBusy(null)
    }
  }

  // Owner 2026-09-27 («слишком много места занимает»): an empty queue was a
  // whole card saying «Новых запросов нет» above the list. It shows when there
  // is something to decide.
  if (rows.length === 0) return null

  // Owner, 2026-10-16, from a picture: one waiting request was a 400 px card
  // above the list, and the first client stood below the screen. It is one
  // line now — who asks for whom — and «Рассмотреть» opens the cards.
  const first = rows[0]
  const summary = [
    `«${first.displayName}»${first.specialtyName ? `, ${first.specialtyName}` : ""}`,
    first.requestedByAgent.name,
  ].join(" · ")
  return (
    <section data-testid="mtm-contact-create-requests" className="mb-4 space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-amber-200 px-1.5 text-xs font-bold text-amber-950">{rows.length}</span>
        <span className="min-w-0 flex-1">
          <b className="font-semibold">{rows.length === 1 ? copy.waitingOne : copy.waitingMany}</b>
          {" — "}{summary}{rows.length > 1 ? ` ${copy.andMore.replace("{count}", String(rows.length - 1))}` : ""}
        </span>
        <Button type="button" size="sm" className="min-h-9 bg-amber-900 text-white hover:bg-amber-950" aria-expanded={open} data-testid="mtm-contact-create-requests-toggle" onClick={() => setOpen((current) => !current)}>
          {open ? copy.collapse : copy.review}
        </Button>
      </div>
      {open ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-card dark:border-zinc-700">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 p-4 dark:border-zinc-700 sm:p-5">
            <div>
              <h2 className="flex items-center gap-2 text-base font-semibold"><UserPlus className="h-4 w-4 text-primary" />{copy.title}{rows.length ? <Badge variant="warning">{rows.length}</Badge> : null}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{copy.hint}</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`mr-1 h-4 w-4 ${loading ? "animate-spin" : ""}`} />{copy.refresh}</Button>
          </div>
          {rows.length === 0 ? <p className="p-5 text-sm text-muted-foreground">{copy.empty}</p> : (
            <div className="grid gap-3 p-4 lg:grid-cols-2 sm:p-5">
              {rows.map((row) => {
                const duplicates = Array.isArray(row.duplicateSnapshot) ? row.duplicateSnapshot : []
                return (
                  <article key={row.id} className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div><h3 className="font-semibold">{row.displayName}</h3><p className="text-sm text-muted-foreground">{[row.specialtyName, row.phone].filter(Boolean).join(" · ") || "—"}</p></div>
                      <Badge variant="outline">{copy.from}: {row.requestedByAgent.name}</Badge>
                    </div>
                    <div className="mt-3 rounded-md bg-muted/40 p-3 text-sm"><div className="font-medium">{row.clinicName}</div>{row.address ? <div className="text-muted-foreground">{row.address}</div> : null}{row.notes ? <div className="mt-2 text-muted-foreground">{row.notes}</div> : null}</div>
                    {duplicates.length ? <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-100"><div className="flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" />{copy.duplicate}</div><ul className="mt-1 list-inside list-disc">{duplicates.map((item) => <li key={item.id}>{item.displayName}{item.exact ? " — exact" : ""}</li>)}</ul></div> : null}
                    <Textarea className="mt-3" rows={2} placeholder={copy.comment} value={comments[row.id] || ""} onChange={(event) => setComments((current) => ({ ...current, [row.id]: event.target.value }))} />
                    <div className="mt-3 flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" onClick={() => void decide(row.id, "REJECTED")} disabled={busy === row.id}><X className="mr-1 h-4 w-4" />{copy.reject}</Button><Button type="button" onClick={() => void decide(row.id, "APPROVED")} disabled={busy === row.id}><Check className="mr-1 h-4 w-4" />{copy.approve}</Button></div>
                  </article>
                )
              })}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}
