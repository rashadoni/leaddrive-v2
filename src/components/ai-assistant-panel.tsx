"use client"

import { useCallback, useState, useRef, useEffect } from "react"
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

const UI_TEXT: Record<string, { title: string; subtitle: string; greeting: string; placeholder: string; suggestions: string[]; approve: string; reject: string; approved: string; rejected: string; executed: string; failed: string; pending: string; connectionError: string; capabilityDisabled: string; tooManyRequests: string; configurationMissing: string; noResponse: string; collapse: string; expand: string; clear: string; close: string; send: string; recipient: string; fields: string; unknownAction: string; toolLabels: Record<string, string>; search: SearchUiText }> = {
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
    collapse: "Collapse panel",
    expand: "Expand panel",
    clear: "Clear conversation",
    close: "Close Da Vinci",
    send: "Send message",
    recipient: "To",
    fields: "Fields",
    unknownAction: "Action",
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
    collapse: "Свернуть панель",
    expand: "Развернуть панель",
    clear: "Очистить диалог",
    close: "Закрыть Da Vinci",
    send: "Отправить сообщение",
    recipient: "Кому",
    fields: "Поля",
    unknownAction: "Действие",
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
    collapse: "Paneli yığ",
    expand: "Paneli genişləndir",
    clear: "Söhbəti təmizlə",
    close: "Da Vinci-ni bağla",
    send: "Mesajı göndər",
    recipient: "Kimə",
    fields: "Sahələr",
    unknownAction: "Əməliyyat",
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
  return uiText.connectionError
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
  const label = t.toolLabels?.[action.tool] || t.unknownAction

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
      <div className="pl-5.5 text-xs text-muted-foreground">
        {action.tool === "send_email" && typeof action.input.to === "string" && <span>{t.recipient}: {action.input.to}</span>}
        {action.tool === "update_contact" && <span>{t.fields}: {Object.keys(asRecord(action.input.fields)).length}</span>}
      </div>
      <div className="flex gap-1.5 pl-5.5">
        <Button size="sm" variant="outline" className="h-11 border-emerald-300 px-2 text-xs text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 sm:h-9" onClick={onApprove}>
          {t.approve}
        </Button>
        <Button size="sm" variant="outline" className="h-11 border-red-300 px-2 text-xs text-red-700 hover:bg-red-50 dark:text-red-300 sm:h-9" onClick={onReject}>
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
  const launcherRef = useRef<HTMLButtonElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setLocale(getLocale()) }, [open])

  const uiText = UI_TEXT[locale] || UI_TEXT.ru

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    bottomRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" })
  }, [messages])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const closePanel = useCallback(() => {
    setOpen(false)
    window.requestAnimationFrame(() => launcherRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePanel()
    }
    window.addEventListener("keydown", handleEscape)
    return () => window.removeEventListener("keydown", handleEscape)
  }, [closePanel, open])

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
          ref={launcherRef}
          type="button"
          onClick={() => setOpen(true)}
          data-testid="ai-assistant-launcher"
          aria-label={uiText.title}
          className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full border bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          <Brain className="h-6 w-6" />
        </button>
      )}

      {/* Panel */}
      {open && (
        <aside
          role="dialog"
          aria-modal="false"
          aria-label={uiText.title}
          className={`fixed bottom-0 right-0 top-0 z-50 flex max-w-full flex-col border-l bg-background shadow-lg transition-[width] motion-reduce:transition-none ${expanded ? "w-[min(760px,94vw)]" : "w-[380px]"}`}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold">{uiText.title}</h3>
                <p className="text-xs text-muted-foreground">{uiText.subtitle}</p>
              </div>
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground sm:h-9 sm:w-9"
                onClick={() => setExpanded(e => !e)}
                aria-label={expanded ? uiText.collapse : uiText.expand}
                title={expanded ? uiText.collapse : uiText.expand}>
                {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              </Button>
              {messages.length > 0 && (
                <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground sm:h-9 sm:w-9"
                  aria-label={uiText.clear}
                  onClick={() => setMessages([])}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button type="button" variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground sm:h-9 sm:w-9"
                aria-label={uiText.close}
                onClick={closePanel}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center px-6">
                <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-primary">
                  <Sparkles className="h-7 w-7" />
                </div>
                <h4 className="mb-1 text-sm font-semibold">{uiText.title}</h4>
                <p className="text-xs text-muted-foreground mb-4">{uiText.greeting}</p>
                <div className="space-y-2 w-full">
                  {uiText.suggestions.map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => { setInput(q); setTimeout(sendMessage, 100) }}
                      className="min-h-11 w-full rounded-lg border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
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
                      : "rounded-bl-md border bg-card"
                  }`}>
                    {msg.role === "user" ? (
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      <div
                        className="text-sm leading-relaxed text-foreground [&_strong]:font-semibold [&_strong]:text-foreground [&_h3]:mb-1.5 [&_h3]:mt-3 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-foreground [&_h4]:mt-2 [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:text-foreground [&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_li]:marker:text-primary [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-xs [&_code]:text-foreground [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_th]:border-b [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-semibold [&_th]:text-foreground [&_td]:border-b [&_td]:px-2 [&_td]:py-1 [&_td]:align-top [&_td]:text-foreground"
                        dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(markdownToHtml(msg.content)) }}
                      />
                    )}
                    <p className={`mt-1 text-xs ${msg.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {msg.timestamp.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
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
                    <Loader2 className="h-4 w-4 animate-spin text-primary motion-reduce:animate-none" />
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
                aria-label={uiText.placeholder}
                rows={1}
                className="min-h-11 flex-1 resize-none rounded-xl border bg-muted/30 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                disabled={loading}
              />
              <Button
                size="icon"
                type="button"
                aria-label={uiText.send}
                className="h-11 w-11 rounded-full"
                onClick={() => sendMessage()}
                disabled={loading || !input.trim()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </aside>
      )}
    </>
  )
}
