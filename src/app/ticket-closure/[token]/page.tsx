"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react"

type ClosureRequestView = {
  id: string
  status: string
  dueAt: string
  ticket: {
    ticketNumber: string | null
    subject: string
    status: string
  }
}

export default function TicketClosurePage() {
  const params = useParams<{ token: string }>()
  const token = params.token
  const [request, setRequest] = useState<ClosureRequestView | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState<"confirm" | "reject" | null>(null)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        const res = await fetch(`/api/v1/public/ticket-closure/${encodeURIComponent(token)}`)
        const json = await res.json()
        if (!mounted) return
        if (!res.ok || !json.success) {
          setError(json.error || "Запрос не найден")
          return
        }
        setRequest(json.data)
      } catch {
        if (mounted) setError("Не удалось загрузить запрос")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => { mounted = false }
  }, [token])

  async function submit(action: "confirm" | "reject") {
    setSubmitting(action)
    setError("")
    setMessage("")
    try {
      const res = await fetch(`/api/v1/public/ticket-closure/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error || "Не удалось сохранить ответ")
        return
      }
      setRequest((prev) => prev ? { ...prev, status: json.data.status, ticket: json.data.ticket || prev.ticket } : prev)
      setMessage(action === "confirm" ? "Тикет закрыт. Спасибо за подтверждение." : "Тикет возвращен в работу.")
    } catch {
      setError("Не удалось сохранить ответ")
    } finally {
      setSubmitting(null)
    }
  }

  const isPending = request?.status === "pending"

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground">
      <div className="mx-auto max-w-xl rounded-lg border bg-card p-6 shadow-sm">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Загрузка
          </div>
        ) : error && !request ? (
          <div>
            <h1 className="text-xl font-semibold">Запрос не найден</h1>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
          </div>
        ) : request ? (
          <div className="space-y-5">
            <div>
              <p className="text-sm text-muted-foreground">{request.ticket.ticketNumber || "Тикет"}</p>
              <h1 className="mt-1 text-2xl font-semibold">Подтверждение закрытия</h1>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{request.ticket.subject}</p>
            </div>

            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Статус запроса</span>
                <span className="font-medium">{request.status}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3">
                <span className="text-muted-foreground">Автозакрытие</span>
                <span className="font-medium">{new Date(request.dueAt).toLocaleString()}</span>
              </div>
            </div>

            {message && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700">{message}</p>}
            {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

            {isPending && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => submit("confirm")}
                  disabled={!!submitting}
                  className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
                >
                  {submitting === "confirm" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Закрыть тикет
                </button>
                <button
                  type="button"
                  onClick={() => submit("reject")}
                  disabled={!!submitting}
                  className="inline-flex h-10 items-center justify-center rounded-md border px-4 text-sm font-medium disabled:opacity-60"
                >
                  {submitting === "reject" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-2 h-4 w-4" />}
                  Вернуть в работу
                </button>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </main>
  )
}
