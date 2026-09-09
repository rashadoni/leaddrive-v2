"use client"

import { useState, useRef, useEffect } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Bot, X, Send, Loader2, Sparkles, Trash2, Brain, CheckCircle2, XCircle, Clock, Maximize2, Minimize2 } from "lucide-react"
import { useTranslations } from "next-intl"
import { QueryResultCard, type QueryResult, type SearchUiText } from "@/components/ai/query-result-card"
import { markdownToHtml } from "@/lib/simple-markdown"
import { sanitizeRichHtml } from "@/lib/sanitize"

interface AiAction {
  tool: string
  input: Record<string, unknown>
  status: "executed" | "pending_approval" | "failed"
  result?: unknown
  error?: string
  pendingActionId?: string
  riskLevel?: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: Date
  actions?: AiAction[]
  queryResult?: QueryResult
  queryError?: string
}

// Tool labels are locale-keyed inside UI_TEXT.toolLabels

const UI_TEXT: Record<string, { title: string; subtitle: string; greeting: string; placeholder: string; suggestions: string[]; approve: string; reject: string; approved: string; rejected: string; executed: string; failed: string; pending: string; connectionError: string; capabilityDisabled: string; tooManyRequests: string; configurationMissing: string; noResponse: string; toolLabels: Record<string, string>; search: SearchUiText }> = {
  en: {
    title: "Da Vinci",
    subtitle: "Da Vinci AI",
    greeting: "Ask me anything about your CRM data, deals, clients, or get help with analysis.",
    placeholder: "Ask Da Vinci...",
    suggestions: ["Summarize my sales pipeline", "Which deals are at risk?", "Top clients by revenue"],
    approve: "Approve",
    reject: "Reject",
    approved: "Approved",
    rejected: "Rejected",
    executed: "Done",
    failed: "Failed",
    pending: "Awaiting approval",
    connectionError: "Connection error. Please try again.",
    capabilityDisabled: "This feature is available in demo mode. Live access needs approval from an admin or LeadDrive.",
    tooManyRequests: "Too many Da Vinci requests. Please try again in a minute.",
    configurationMissing: "Da Vinci is not configured for this organization yet. Ask an admin to check AI settings.",
    noResponse: "No response",
    toolLabels: { add_note: "Note", log_activity: "Activity", create_task: "Task", update_deal_stage: "Deal stage", create_ticket: "Ticket", create_deal: "Deal", send_email: "Email", update_contact: "Contact" },
    search: {
      results: "{count} results",
      showingOf: "Showing {shown} of {total}",
      openFullList: "Open full list",
      noResults: "No matching records",
      queryFailed: "Couldn't run that search",
      columns: { number: "Number", name: "Name", title: "Title", subject: "Subject", status: "Status", priority: "Priority", amount: "Amount", date: "Date", closeDate: "Close date", dueDate: "Due", email: "Email", phone: "Phone", category: "Category", stage: "Stage" },
    },
  },
  ru: {
    title: "Da Vinci",
    subtitle: "Da Vinci",
    greeting: "Спроси меня о данных CRM, сделках, клиентах, или получи помощь с аналитикой.",
    placeholder: "Спросить Da Vinci...",
    suggestions: ["Сводка по воронке продаж", "Какие сделки под угрозой?", "Топ клиенты по выручке"],
    approve: "Одобрить",
    reject: "Отклонить",
    approved: "Одобрено",
    rejected: "Отклонено",
    executed: "Выполнено",
    failed: "Ошибка",
    pending: "Ожидает одобрения",
    connectionError: "Ошибка соединения. Попробуйте еще раз.",
    capabilityDisabled: "Функция доступна в демо-режиме. Для live-доступа нужно одобрение администратора или LeadDrive.",
    tooManyRequests: "Слишком много запросов к Da Vinci. Попробуйте еще раз через минуту.",
    configurationMissing: "Da Vinci еще не настроен для этой организации. Попросите администратора проверить AI-настройки.",
    noResponse: "Нет ответа",
    toolLabels: { add_note: "Заметка", log_activity: "Активность", create_task: "Задача", update_deal_stage: "Стадия сделки", create_ticket: "Тикет", create_deal: "Сделка", send_email: "Email", update_contact: "Контакт" },
    search: {
      results: "{count} результатов",
      showingOf: "Показано {shown} из {total}",
      openFullList: "Открыть весь список",
      noResults: "Нет подходящих записей",
      queryFailed: "Не удалось выполнить поиск",
      columns: { number: "Номер", name: "Название", title: "Заголовок", subject: "Тема", status: "Статус", priority: "Приоритет", amount: "Сумма", date: "Дата", closeDate: "Закрытие", dueDate: "Срок", email: "Email", phone: "Телефон", category: "Категория", stage: "Этап" },
    },
  },
  az: {
    title: "Da Vinci",
    subtitle: "Da Vinci",
    greeting: "CRM məlumatları, sövdələşmələr, müştərilər haqqında soruş və ya analitikada kömək al.",
    placeholder: "Da Vinci-dan soruş...",
    suggestions: ["Proses axınını ümumiləşdir", "Hansı sövdələşmələr risk altındadır?", "Gəlirə görə ən yaxşı müştərilər"],
    approve: "Təsdiq et",
    reject: "İmtina et",
    approved: "Təsdiqləndi",
    rejected: "İmtina edildi",
    executed: "Tamamlandı",
    failed: "Xəta",
    pending: "Təsdiq gözləyir",
    connectionError: "Bağlantı xətası. Yenidən cəhd edin.",
    capabilityDisabled: "Bu funksiya demo rejimində əlçatandır. Live giriş üçün admin və ya LeadDrive təsdiqi lazımdır.",
    tooManyRequests: "Da Vinci üçün çox sorğu göndərildi. Bir dəqiqə sonra yenidən cəhd edin.",
    configurationMissing: "Da Vinci bu təşkilat üçün hələ qurulmayıb. Admin AI ayarlarını yoxlamalıdır.",
    noResponse: "Cavab yoxdur",
    toolLabels: { add_note: "Qeyd", log_activity: "Fəaliyyət", create_task: "Tapşırıq", update_deal_stage: "Sövdələşmə mərhələsi", create_ticket: "Bilet", create_deal: "Sövdələşmə", send_email: "Email", update_contact: "Kontakt" },
    search: {
      results: "{count} nəticə",
      showingOf: "{total}-dən {shown} göstərilir",
      openFullList: "Tam siyahını aç",
      noResults: "Uyğun qeyd yoxdur",
      queryFailed: "Axtarış alınmadı",
      columns: { number: "Nömrə", name: "Ad", title: "Başlıq", subject: "Mövzu", status: "Status", priority: "Prioritet", amount: "Məbləğ", date: "Tarix", closeDate: "Bağlanma", dueDate: "Son tarix", email: "Email", phone: "Telefon", category: "Kateqoriya", stage: "Mərhələ" },
    },
  },
}

function getLocale(): string {
  if (typeof document === "undefined") return "ru"
  const cookie = document.cookie.split(";").map(c => c.trim()).find(c => c.startsWith("NEXT_LOCALE="))
  return cookie?.split("=")[1] || "ru"
}

function displayAiError(raw: unknown, uiText: typeof UI_TEXT["ru"]) {
  const message = typeof raw === "string" ? raw : ""
  if (!message) return uiText.noResponse
  if (
    /TENANT_CAPABILITY_DISABLED/i.test(message) ||
    /Demo is available, but live activation requires admin or LeadDrive approval/i.test(message)
  ) {
    return uiText.capabilityDisabled
  }
  if (/Too many Da Vinci requests/i.test(message)) return uiText.tooManyRequests
  if (/Da Vinci AI requires configuration|ANTHROPIC_API_KEY/i.test(message)) return uiText.configurationMissing
  if (/Unauthorized/i.test(message)) return uiText.connectionError
  return message.replace(/^Error:\s*/i, "")
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function ActionCard({ action, t, onApprove, onReject }: {
  action: AiAction
  t: typeof UI_TEXT["ru"]
  onApprove: () => void
  onReject: () => void
}) {
  const label = t.toolLabels?.[action.tool] || action.tool

  if (action.status === "executed") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
        <span className="text-emerald-700 dark:text-emerald-400">{t.executed}: {label}</span>
      </div>
    )
  }

  if (action.status === "failed") {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-xs">
        <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />
        <span className="text-red-700 dark:text-red-400">{t.failed}: {label}</span>
      </div>
    )
  }

  // pending_approval
  return (
    <div className="px-2.5 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 space-y-1.5">
      <div className="flex items-center gap-2 text-xs">
        <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <span className="text-amber-700 dark:text-amber-400 font-medium">{t.pending}: {label}</span>
      </div>
      <div className="text-[11px] text-muted-foreground pl-5.5">
        {action.tool === "send_email" && typeof action.input.to === "string" && <span>To: {action.input.to}</span>}
        {action.tool === "update_contact" && <span>Fields: {Object.keys(asRecord(action.input.fields)).join(", ")}</span>}
      </div>
      <div className="flex gap-1.5 pl-5.5">
        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 text-emerald-600 border-emerald-300 hover:bg-emerald-50" onClick={onApprove}>
          {t.approve}
        </Button>
        <Button size="sm" variant="outline" className="h-6 text-[11px] px-2 text-red-600 border-red-300 hover:bg-red-50" onClick={onReject}>
          {t.reject}
        </Button>
      </div>
    </div>
  )
}

interface AiAssistantPanelProps {
  showFloatingLauncher?: boolean
}

export function AiAssistantPanel({ showFloatingLauncher = true }: AiAssistantPanelProps) {
  const t = useTranslations("ai")
  const router = useRouter()
  const [open, setOpen] = useState(false)
  // Wide mode for rich answers (summaries / result tables). Toggled in the
  // header; collapse or ✕ gets the panel out of the way for CRM work.
  const [expanded, setExpanded] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [locale, setLocale] = useState("ru")
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setLocale(getLocale()) }, [open])

  const uiText = UI_TEXT[locale] || UI_TEXT.ru

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const handleApproveAction = async (msgId: string, actionIndex: number, decision: "approve" | "reject") => {
    const msg = messages.find(m => m.id === msgId)
    const action = msg?.actions?.[actionIndex]
    if (!action?.pendingActionId) return

    try {
      const res = await fetch("/api/v1/ai/approve-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.pendingActionId, decision }),
      })
      const json = await res.json()

      setMessages(prev => prev.map(m => {
        if (m.id !== msgId || !m.actions) return m
        const newActions = [...m.actions]
        newActions[actionIndex] = {
          ...newActions[actionIndex],
          status: decision === "approve" && json.success ? "executed" : decision === "reject" ? "failed" : "pending_approval",
        }
        return { ...m, actions: newActions }
      }))
    } catch {
      // silently fail
    }
  }

  const sendMessage = async (override?: string) => {
    // `override` lets the header AI-search box (and suggestion chips) send a
    // query directly. onClick passes a MouseEvent, so guard with typeof.
    const text = (typeof override === "string" ? override : input).trim()
    if (!text || loading) return

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text, timestamp: new Date() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const pageContext = {
        url: window.location.pathname,
        title: document.title,
      }

      const res = await fetch("/api/v1/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, context: pageContext, history: messages.slice(-6), locale }),
      })
      const json = await res.json()

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: json.data?.reply || displayAiError(json.error, uiText),
        timestamp: new Date(),
        actions: json.data?.actions,
        queryResult: json.data?.queryResult,
        queryError: json.data?.queryError,
      }
      setMessages(prev => [...prev, aiMsg])
      // A result table is cramped at 380px — auto-widen the panel when a search
      // returns one. The user can collapse it again via the header toggle or ✕.
      if (json.data?.queryResult) setExpanded(true)
    } catch {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: "assistant",
        content: uiText.connectionError, timestamp: new Date(),
      }])
    } finally {
      setLoading(false)
    }
  }

  // Header AI-search box dispatches "davinci:open" → open the panel and, if a
  // query was typed, run it as a smart search. Ref keeps the listener calling
  // the latest sendMessage (fresh locale/messages) without re-binding.
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage
  useEffect(() => {
    function onDaVinciOpen(e: Event) {
      setOpen(true)
      setLocale(getLocale())
      const q = (e as CustomEvent).detail?.query
      const text = typeof q === "string" ? q.trim() : ""
      if (text) {
        setInput(text)
        setTimeout(() => sendMessageRef.current(text), 60)
      }
    }
    window.addEventListener("davinci:open", onDaVinciOpen as EventListener)
    return () => window.removeEventListener("davinci:open", onDaVinciOpen as EventListener)
  }, [])

  return (
    <>
      {/* FAB Button */}
      {!open && showFloatingLauncher && (
        <button
          onClick={() => setOpen(true)}
          data-testid="ai-assistant-launcher"
          aria-label={uiText.title}
          className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-200 flex items-center justify-center group animate-pulse-glow"
        >
          <Brain className="h-6 w-6 group-hover:scale-110 transition-transform" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className={`fixed right-0 top-0 bottom-0 z-50 ${expanded ? "w-[min(760px,94vw)]" : "w-[380px]"} glass-panel shadow-2xl flex flex-col animate-in slide-in-from-right duration-200 ai-glow transition-[width]`}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] text-white">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{uiText.title}</h3>
                <p className="text-[10px] opacity-80">{uiText.subtitle}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/20"
                onClick={() => setExpanded(e => !e)}
                aria-label={expanded ? "Collapse" : "Expand"}
                title={expanded ? "Collapse" : "Expand"}>
                {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
              {messages.length > 0 && (
                <Button variant="ghost" size="icon" className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/20"
                  onClick={() => setMessages([])}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/20"
                onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="h-16 w-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--ai-from))]/10 to-[hsl(var(--ai-to))]/10 flex items-center justify-center mb-4 ai-glow">
                  <Sparkles className="h-8 w-8 text-[hsl(var(--ai-from))]" />
                </div>
                <h4 className="text-sm font-semibold mb-1">{uiText.title} Assistant</h4>
                <p className="text-xs text-muted-foreground mb-4">{uiText.greeting}</p>
                <div className="space-y-2 w-full">
                  {uiText.suggestions.map(q => (
                    <button
                      key={q}
                      onClick={() => { setInput(q); setTimeout(sendMessage, 100) }}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 hover:bg-muted/50 transition-colors text-muted-foreground hover:text-foreground"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`${msg.queryResult ? "max-w-[94%] w-full" : "max-w-[85%]"} space-y-2`}>
                  <div className={`rounded-2xl px-3.5 py-2.5 text-sm ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-br-md"
                      : "bg-card border border-[hsl(var(--ai-from))]/20 rounded-bl-md"
                  }`}>
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      <div
                        className="leading-relaxed text-sm text-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-foreground [&_h4]:mt-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-foreground [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_li]:marker:text-[hsl(var(--ai-from))] [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-foreground [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_th]:border-b [&_th]:border-[hsl(var(--ai-from))]/25 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:border-b [&_td]:border-[hsl(var(--ai-from))]/10 [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td]:text-foreground"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(markdownToHtml(msg.content)) }}
                      />
                    )}
                    <p className={`text-[10px] mt-1 ${msg.role === "user" ? "text-primary-foreground/60" : "text-muted-foreground"}`}>
                      {msg.timestamp.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                    </p>
                  </div>
                  {/* Smart AI Search — read-only result table (navigation only) */}
                  {msg.queryError && (
                    <div className="rounded-2xl rounded-bl-md border border-red-500/20 bg-red-500/10 px-3 py-2.5 text-xs text-red-700 dark:text-red-400">
                      {uiText.search.queryFailed}
                    </div>
                  )}
                  {msg.queryResult && (
                    <QueryResultCard
                      result={msg.queryResult}
                      search={uiText.search}
                      locale={locale}
                      onNavigate={(href) => { setOpen(false); router.push(href) }}
                    />
                  )}
                  {/* Actions */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="space-y-1.5 ml-1">
                      {msg.actions.map((action, idx) => (
                        <ActionCard
                          key={idx}
                          action={action}
                          t={uiText}
                          onApprove={() => handleApproveAction(msg.id, idx, "approve")}
                          onReject={() => handleApproveAction(msg.id, idx, "reject")}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-[hsl(var(--ai-from))]" />
                    <span className="text-xs text-muted-foreground">{t("thinking")}</span>
                  </div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="border-t p-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
                placeholder={uiText.placeholder}
                rows={1}
                className="flex-1 resize-none rounded-xl border border-zinc-200 dark:border-zinc-700 px-3 py-2.5 text-sm bg-muted/30 focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={loading}
              />
              <Button
                size="icon"
                className="h-10 w-10 rounded-full bg-gradient-to-br from-[hsl(var(--ai-from))] to-[hsl(var(--ai-to))] hover:opacity-90"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
