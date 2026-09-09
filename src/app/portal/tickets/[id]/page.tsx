"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, Send, Loader2, Star, User, Headphones } from "lucide-react"

interface TicketDetail {
  id: string
  ticketNumber: string
  subject: string
  description: string | null
  status: string
  priority: string
  category: string
  satisfactionRating: number | null
  satisfactionComment: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  comments: CommentItem[]
}

interface CommentItem {
  id: string
  comment: string
  isAgent: boolean
  authorName: string
  createdAt: string
}

const STATUS_COLORS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  new: "destructive", in_progress: "default", waiting: "secondary", resolved: "outline", closed: "outline",
}

function formatDate(d: string) {
  return new Date(d).toLocaleString(undefined, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}

export default function PortalTicketDetailPage() {
  const params = useParams()
  const router = useRouter()
  const ticketId = params.id as string
  const t = useTranslations("portal")

  const STATUS_LABELS: Record<string, string> = {
    new: t("statusNew"),
    in_progress: t("statusInProgress"),
    waiting: t("statusWaiting"),
    resolved: t("statusResolved"),
    closed: t("statusClosed"),
  }

  const [ticket, setTicket] = useState<TicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Comment
  const [newComment, setNewComment] = useState("")
  const [sending, setSending] = useState(false)

  // CSAT
  const [csatRating, setCsatRating] = useState(0)
  const [csatHover, setCsatHover] = useState(0)
  const [csatComment, setCsatComment] = useState("")
  const [csatSending, setCsatSending] = useState(false)
  const [csatSent, setCsatSent] = useState(false)

  const fetchTicket = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/public/portal-tickets/${ticketId}`)
      const json = await res.json()
      if (json.success) {
        setTicket(json.data)
        if (json.data.satisfactionRating) {
          setCsatRating(json.data.satisfactionRating)
          setCsatSent(true)
        }
      } else {
        setError(json.error || t("ticketLoadError"))
      }
    } catch {
      setError(t("ticketLoadError"))
    } finally {
      setLoading(false)
    }
  }, [ticketId, t])

  useEffect(() => { fetchTicket() }, [fetchTicket])

  // Poll for new comments every 10 seconds
  useEffect(() => {
    const interval = setInterval(fetchTicket, 10000)
    return () => clearInterval(interval)
  }, [fetchTicket])

  const handleSendComment = async () => {
    if (!newComment.trim() || sending) return
    setSending(true)
    try {
      const res = await fetch(`/api/v1/public/portal-tickets/${ticketId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: newComment }),
      })
      const json = await res.json()
      if (json.success) {
        setNewComment("")
        fetchTicket()
      }
    } catch { /* ignore */ } finally { setSending(false) }
  }

  const handleSubmitCsat = async () => {
    if (csatRating === 0 || csatSending) return
    setCsatSending(true)
    try {
      const res = await fetch(`/api/v1/public/portal-tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ satisfactionRating: csatRating, satisfactionComment: csatComment }),
      })
      const json = await res.json()
      if (json.success) {
        setCsatSent(true)
        fetchTicket()
      }
    } catch { /* ignore */ } finally { setCsatSending(false) }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !ticket) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/portal/tickets")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> {t("myTickets")}
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {error || t("ticketNotFound")}
          </CardContent>
        </Card>
      </div>
    )
  }

  const isResolved = ticket.status === "resolved" || ticket.status === "closed"
  const canRate = isResolved && !csatSent

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/portal/tickets")}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Back
        </Button>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_COLORS[ticket.status]}>{STATUS_LABELS[ticket.status] || ticket.status}</Badge>
          <Badge variant="outline">{ticket.priority}</Badge>
          <span className="text-sm text-muted-foreground font-mono">{ticket.ticketNumber}</span>
        </div>
      </div>

      {/* Ticket info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">{ticket.subject}</CardTitle>
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Category: {ticket.category}</span>
            <span>Created: {formatDate(ticket.createdAt)}</span>
          </div>
        </CardHeader>
        {ticket.description && (
          <CardContent className="pt-0">
            <div className="p-3 bg-muted/50 rounded-lg border border-zinc-200 dark:border-zinc-700">
              <p className="text-sm whitespace-pre-wrap">{ticket.description}</p>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Comments / Conversation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Conversation ({ticket.comments.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ticket.comments.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No messages yet. Write the first one!
            </p>
          )}

          {ticket.comments.map(comment => (
            <div key={comment.id} className={`flex gap-3 ${comment.isAgent ? "" : "flex-row-reverse"}`}>
              <div className={`h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0 ${
                comment.isAgent
                  ? "bg-[hsl(var(--ai-from))]/10 text-[hsl(var(--ai-from))]"
                  : "bg-primary/10 text-primary"
              }`}>
                {comment.isAgent ? <Headphones className="h-4 w-4" /> : <User className="h-4 w-4" />}
              </div>
              <div className={`max-w-[80%] ${comment.isAgent ? "" : "text-right"}`}>
                <div className={`inline-block p-3 rounded-lg text-sm shadow-[0_1px_3px_rgba(0,0,0,0.05)] ${
                  comment.isAgent
                    ? "bg-card border border-zinc-200 dark:border-zinc-700 text-foreground"
                    : "bg-primary text-primary-foreground"
                }`}>
                  <p className="whitespace-pre-wrap">{comment.comment}</p>
                </div>
                <div className={`flex items-center gap-2 mt-1 text-xs text-muted-foreground ${comment.isAgent ? "" : "justify-end"}`}>
                  <span>{comment.authorName}</span>
                  <span>·</span>
                  <span>{formatDate(comment.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}

          {/* Comment input */}
          {!isResolved ? (
            <div className="border-t pt-4 space-y-3">
              <Textarea
                value={newComment}
                onChange={e => setNewComment(e.target.value)}
                placeholder="Write a message..."
                rows={3}
                disabled={sending}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSendComment() } }}
              />
              <div className="flex justify-end">
                <Button onClick={handleSendComment} disabled={sending || !newComment.trim()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send
                </Button>
              </div>
            </div>
          ) : (
            <div className="border-t pt-4 text-center">
              <p className="text-sm text-muted-foreground">
                Ticket is {ticket.status === "resolved" ? "resolved" : "closed"}.
                If you need further help, send a message and the ticket will be reopened.
              </p>
              <div className="mt-3 space-y-3">
                <Textarea
                  value={newComment}
                  onChange={e => setNewComment(e.target.value)}
                  placeholder="Write a message (ticket will be reopened)..."
                  rows={2}
                  disabled={sending}
                />
                <Button variant="outline" onClick={handleSendComment} disabled={sending || !newComment.trim()}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                  Send and reopen
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* CSAT Rating */}
      {canRate && (
        <Card className="border-[hsl(var(--ai-from))]/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="h-4 w-4 text-yellow-500" /> Rate support quality
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map(i => (
                <button
                  key={i}
                  onClick={() => setCsatRating(i)}
                  onMouseEnter={() => setCsatHover(i)}
                  onMouseLeave={() => setCsatHover(0)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star className={`h-8 w-8 ${
                    i <= (csatHover || csatRating)
                      ? "fill-yellow-400 text-yellow-400"
                      : "text-muted-foreground"
                  }`} />
                </button>
              ))}
              {csatRating > 0 && (
                <span className="ml-2 text-sm text-muted-foreground">
                  {csatRating === 1 ? "Terrible" : csatRating === 2 ? "Bad" : csatRating === 3 ? "OK" : csatRating === 4 ? "Good" : "Excellent!"}
                </span>
              )}
            </div>
            <Textarea
              value={csatComment}
              onChange={e => setCsatComment(e.target.value)}
              placeholder="Comment (optional)..."
              rows={2}
            />
            <Button
              onClick={handleSubmitCsat}
              disabled={csatRating === 0 || csatSending}
              className="rounded-full"
            >
              {csatSending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Star className="h-4 w-4 mr-1" />}
              Submit rating
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Already rated */}
      {csatSent && ticket.satisfactionRating && (
        <Card className="border-primary/20">
          <CardContent className="py-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Your rating:</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map(i => (
                  <Star key={i} className={`h-4 w-4 ${i <= ticket.satisfactionRating! ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                ))}
              </div>
              {ticket.satisfactionComment && (
                <span className="text-sm text-muted-foreground ml-2">— {ticket.satisfactionComment}</span>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
