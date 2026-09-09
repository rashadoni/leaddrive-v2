"use client"

/**
 * F3 — agent test sandbox dialog.
 *
 * Chat with an agent config's persona before publishing. Runs server-side via
 * POST /api/v1/ai-configs/[id]/test — model + persona only, no tools, no data
 * writes — so testing a draft is side-effect free.
 */
import { useRef, useState, useEffect } from "react"
import { useTranslations } from "next-intl"
import { Dialog, DialogHeader, DialogTitle, DialogContent } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Send, FlaskConical } from "lucide-react"
import { cn } from "@/lib/utils"

interface Turn {
  role: "user" | "assistant"
  content: string
  meta?: { costUsd: number; latencyMs: number; promptTokens: number; completionTokens: number }
}

export function AgentSandboxDialog({
  open, onClose, agentId, agentName, orgId,
}: {
  open: boolean
  onClose: () => void
  agentId: string
  agentName: string
  orgId?: string | number
}) {
  const t = useTranslations("ai.sandbox")
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [tools, setTools] = useState<string[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Reset the transcript whenever a different agent's sandbox opens.
  useEffect(() => {
    if (open) { setTurns([]); setInput(""); setError(""); setTools([]) }
  }, [open, agentId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [turns, busy])

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setError("")
    const next: Turn[] = [...turns, { role: "user", content: text }]
    setTurns(next)
    setInput("")
    setBusy(true)
    try {
      const res = await fetch(`/api/v1/ai-configs/${agentId}/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": String(orgId) } : {}) },
        body: JSON.stringify({ messages: next.map((m) => ({ role: m.role, content: m.content })) }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.success) {
        setError(json.error || t("failed"))
        return
      }
      const d = json.data
      setTools(Array.isArray(d.toolsAvailable) ? d.toolsAvailable : [])
      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: d.reply || "", meta: { costUsd: d.costUsd, latencyMs: d.latencyMs, promptTokens: d.promptTokens, completionTokens: d.completionTokens } },
      ])
    } catch {
      setError(t("failed"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> {t("title", { name: agentName })}
          </DialogTitle>
        </DialogHeader>

        <div className="rounded-md bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2">
          {t("notice")}
          {tools.length > 0 && (
            <span className="ml-1">{t("toolsAvailable", { tools: tools.map((x) => x.replace(/_/g, " ")).join(", ") })}</span>
          )}
        </div>

        <div ref={scrollRef} className="mt-3 h-[46vh] overflow-y-auto space-y-3 pr-1">
          {turns.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-10">{t("empty")}</p>
          )}
          {turns.map((turn, i) => (
            <div key={i} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
              <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap",
                turn.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted")}>
                {turn.content}
                {turn.meta && (
                  <div className="mt-1 text-[10px] opacity-70">
                    {t("trace", { ms: turn.meta.latencyMs, cost: turn.meta.costUsd.toFixed(5), inTok: turn.meta.promptTokens, outTok: turn.meta.completionTokens })}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-3.5 py-2 bg-muted"><Loader2 className="h-4 w-4 animate-spin" /></div>
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-2 pt-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={t("placeholder")}
            disabled={busy}
            className="flex-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-background px-3 py-2 text-sm"
          />
          <Button onClick={send} disabled={busy || !input.trim()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
