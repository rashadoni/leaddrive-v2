"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useLocale } from "next-intl"
import { AlertTriangle, ArrowUpRight, CheckCircle2, FileText, Inbox, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { buildAdvisorActionPreviewEntries } from "@/lib/ai/advisor/action-preview"
import type { AdvisorAction, AdvisorDomainKey, AdvisorPayload, AdvisorSignal } from "@/lib/ai/advisor/types"

interface AdvisorRecordWidgetProps {
  entityType: string
  entityId: string
  orgId?: string
  title?: string
}

const COPY = {
  en: {
    title: "Advisor risk",
    queued: "Advisor action queued",
    queueFailed: "Could not queue advisor action",
    checkFailed: "Advisor could not check this record right now.",
    noRisk: "No active Advisor risk for this record.",
    queuedForApproval: "Queued for approval",
    openAdvisorCenter: "Open Advisor center",
    whyFlagged: "Why Advisor flagged it",
    recommendedStep: "Recommended next step",
    actionPreview: "What will be prepared",
    requiresApproval: "Requires approval",
    sendForApproval: "Send for approval",
    domains: {
      crm: "CRM",
      sales: "Sales",
      contracts: "Contracts",
      marketing: "Marketing",
      tasks: "Tasks & Projects",
      finance: "Finance",
      support: "Ticketing",
      routes: "Routes",
      mtm: "Routes & Field",
      kpi: "KPI / Managers",
    },
    severities: {
      critical: "Critical",
      high: "High",
      medium: "Medium",
      low: "Low",
    },
    actionTypes: {
      create_task: "Create task",
      assign_task: "Assign task",
      assign_owner: "Assign owner",
      assign_ticket_owner: "Assign ticket owner",
      create_alert: "Create alert",
      priority_update: "Priority update",
      create_note: "Create note",
      draft_followup: "Draft follow-up",
      invoice_reminder: "Invoice reminder",
      flag_route_issue: "Flag route issue",
      suggest_budget_change: "Suggest budget review",
      contract_review: "Review contract",
      approval_escalation: "Escalate approval",
      signature_reminder: "Signature reminder",
      campaign_review: "Review campaign",
      segment_review_task: "Review segment",
      support_escalation: "Support escalation",
      kpi_plan_review: "Review KPI plan",
      stage_alert: "Stage alert",
      route_issue: "Route issue",
      create_followup_task: "Create follow-up task",
      quote_reminder: "Quote reminder",
      unblock_task: "Unblock task",
      escalate_overdue_task: "Escalate overdue task",
      bill_payment_escalation: "Escalate bill payment",
      missed_visit_task: "Missed visit follow-up",
      coaching_task: "Coaching task",
      update_health_note: "Update health note",
    },
    previewFields: {
      taskTitle: "Task",
      alertTitle: "Alert",
      noteSubject: "Note",
      followupSubject: "Subject",
      budgetTitle: "Budget review",
      description: "Description",
      message: "Message",
      body: "Draft",
      assignee: "Assignee",
      priority: "Priority",
      amount: "Amount",
      relatedRecord: "Related record",
      company: "Company",
      invoice: "Invoice",
      daysOverdue: "Days overdue",
    },
    factLabels: {
      Status: "Status",
      Priority: "Priority",
      "Escalation level": "Escalation level",
      Company: "Company",
      Customer: "Customer",
      "Idle days": "Idle days",
      "Valid until": "Valid until",
      Amount: "Amount",
      "First response due": "First response due",
      "SLA due": "SLA due",
    },
    statusValues: {
      open: "open",
      in_progress: "in progress",
      pending: "pending",
      resolved: "resolved",
      closed: "closed",
      viewed: "viewed",
      sent: "sent",
      accepted: "accepted",
      rejected: "rejected",
      expired: "expired",
      draft: "draft",
    },
    priorityValues: {
      critical: "critical",
      urgent: "urgent",
      high: "high",
      medium: "medium",
      low: "low",
    },
    entityTypes: {
      ticket: "ticket",
      quote: "quote",
    },
    advisorTexts: {
      ticketAtSlaRisk: "{ticket} is at SLA risk",
      ticketEscalatedUnresolved: "{ticket} is escalated and unresolved",
      ticketAtEscalationLevel: "Ticket is at escalation level {level} and remains open.",
      firstResponseSlaBreached: "First response SLA is breached.",
      resolutionSlaBreached: "Resolution SLA is breached.",
      slaDeadlineApproaching: "SLA deadline is approaching.",
      slaRiskTitle: "SLA risk: {ticket}",
      assignOwnerTitle: "Assign owner: {ticket}",
      raisePriorityTitle: "Raise priority: {ticket}",
      supportEscalationMessage: "Escalate or assign this ticket before the SLA is missed.",
      assignOwnerMessage: "Assign a support owner before the SLA is missed.",
      raisePriorityMessage: "Raise ticket priority because the SLA window is at risk.",
      quoteNoBuyerDecision: "{quote} has no buyer decision",
      quoteValidityExpired: "Quote validity expired. Status: {status}.",
      quoteIdle: "Quote is {status} and has been idle for {days} days.",
      followUpQuoteTitle: "Follow up quote {quote}",
      quoteFollowUpMessage: "Quote is {status} and has been idle for {days} days. Confirm buyer decision or revise terms.",
      quoteRiskNote: "Quote {status} is without buyer decision for {days} days. Amount {amount}.",
    },
  },
  ru: {
    title: "Риск Advisor",
    queued: "Действие Advisor добавлено в очередь",
    queueFailed: "Не удалось добавить действие Advisor",
    checkFailed: "Advisor не смог проверить эту запись сейчас.",
    noRisk: "Активных рисков Advisor по этой записи нет.",
    queuedForApproval: "В очереди согласования",
    openAdvisorCenter: "Открыть центр Advisor",
    whyFlagged: "Почему Advisor отметил риск",
    recommendedStep: "Рекомендованный шаг",
    actionPreview: "Что будет подготовлено",
    requiresApproval: "Требует согласования",
    sendForApproval: "Отправить на согласование",
    domains: {
      crm: "CRM",
      sales: "Продажи",
      contracts: "Контракты",
      marketing: "Маркетинг",
      tasks: "Задачи и проекты",
      finance: "Финансы",
      support: "Тикетинг",
      routes: "Маршруты",
      mtm: "MTM / Поле",
      kpi: "KPI / Менеджеры",
    },
    severities: {
      critical: "Критичный",
      high: "Высокий",
      medium: "Средний",
      low: "Низкий",
    },
    actionTypes: {
      create_task: "Создать задачу",
      assign_task: "Назначить задачу",
      assign_owner: "Назначить владельца",
      assign_ticket_owner: "Назначить владельца тикета",
      create_alert: "Создать уведомление",
      priority_update: "Обновить приоритет",
      create_note: "Создать заметку",
      draft_followup: "Подготовить ответ",
      invoice_reminder: "Напомнить по счету",
      flag_route_issue: "Отметить проблему маршрута",
      suggest_budget_change: "Предложить пересмотр бюджета",
      contract_review: "Проверить контракт",
      approval_escalation: "Эскалировать согласование",
      signature_reminder: "Напомнить о подписи",
      campaign_review: "Проверить кампанию",
      segment_review_task: "Проверить сегмент",
      support_escalation: "Эскалировать в поддержку",
      kpi_plan_review: "Проверить KPI-план",
      stage_alert: "Риск этапа",
      route_issue: "Проблема маршрута",
      create_followup_task: "Создать задачу на ответ",
      quote_reminder: "Напомнить по предложению",
      unblock_task: "Разблокировать задачу",
      escalate_overdue_task: "Эскалировать просроченную задачу",
      bill_payment_escalation: "Эскалировать оплату счета",
      missed_visit_task: "Разобрать пропущенный визит",
      coaching_task: "Коучинг-задача",
      update_health_note: "Обновить заметку о состоянии",
    },
    previewFields: {
      taskTitle: "Задача",
      alertTitle: "Уведомление",
      noteSubject: "Заметка",
      followupSubject: "Тема",
      budgetTitle: "Пересмотр бюджета",
      description: "Описание",
      message: "Сообщение",
      body: "Черновик",
      assignee: "Исполнитель",
      priority: "Приоритет",
      amount: "Сумма",
      relatedRecord: "Связанная запись",
      company: "Компания",
      invoice: "Счет",
      daysOverdue: "Дней просрочки",
    },
    factLabels: {
      Status: "Статус",
      Priority: "Приоритет",
      "Escalation level": "Уровень эскалации",
      Company: "Компания",
      Customer: "Клиент",
      "Idle days": "Дней без движения",
      "Valid until": "Действует до",
      Amount: "Сумма",
      "First response due": "Первый ответ до",
      "SLA due": "SLA до",
    },
    statusValues: {
      open: "открыт",
      in_progress: "в работе",
      pending: "ожидает",
      resolved: "решен",
      closed: "закрыт",
      viewed: "просмотрено",
      sent: "отправлено",
      accepted: "принято",
      rejected: "отклонено",
      expired: "истекло",
      draft: "черновик",
    },
    priorityValues: {
      critical: "критичный",
      urgent: "срочный",
      high: "высокий",
      medium: "средний",
      low: "низкий",
    },
    entityTypes: {
      ticket: "тикет",
      quote: "предложение",
    },
    advisorTexts: {
      ticketAtSlaRisk: "{ticket} под риском SLA",
      ticketEscalatedUnresolved: "{ticket} эскалирован и не решен",
      ticketAtEscalationLevel: "Тикет на уровне эскалации {level} и все еще открыт.",
      firstResponseSlaBreached: "SLA первого ответа уже нарушен.",
      resolutionSlaBreached: "SLA решения уже нарушен.",
      slaDeadlineApproaching: "Срок SLA скоро наступит.",
      slaRiskTitle: "Риск SLA: {ticket}",
      assignOwnerTitle: "Назначить владельца: {ticket}",
      raisePriorityTitle: "Повысить приоритет: {ticket}",
      supportEscalationMessage: "Эскалируйте или назначьте тикет до нарушения SLA.",
      assignOwnerMessage: "Назначьте владельца поддержки до нарушения SLA.",
      raisePriorityMessage: "Повысьте приоритет тикета, потому что окно SLA под риском.",
      quoteNoBuyerDecision: "По {quote} нет решения покупателя",
      quoteValidityExpired: "Срок действия предложения истек. Статус: {status}.",
      quoteIdle: "Предложение в статусе {status} и без движения {days} дн.",
      followUpQuoteTitle: "Проверить решение покупателя по {quote}",
      quoteFollowUpMessage: "Предложение в статусе {status} и без движения {days} дн. Подтвердите решение покупателя или обновите условия.",
      quoteRiskNote: "Предложение {status} без решения покупателя {days} дн. Сумма {amount}.",
    },
  },
  az: {
    title: "Advisor riski",
    queued: "Advisor əməliyyatı növbəyə əlavə edildi",
    queueFailed: "Advisor əməliyyatını növbəyə əlavə etmək olmadı",
    checkFailed: "Advisor bu qeydi indi yoxlaya bilmədi.",
    noRisk: "Bu qeyd üzrə aktiv Advisor riski yoxdur.",
    queuedForApproval: "Təsdiq növbəsində",
    openAdvisorCenter: "Advisor mərkəzini aç",
    whyFlagged: "Advisor niyə risk kimi göstərdi",
    recommendedStep: "Tövsiyə olunan addım",
    actionPreview: "Nə hazırlanacaq",
    requiresApproval: "Təsdiq tələb edir",
    sendForApproval: "Təsdiqə göndər",
    domains: {
      crm: "CRM",
      sales: "Satış",
      contracts: "Müqavilələr",
      marketing: "Marketinq",
      tasks: "Tapşırıqlar və layihələr",
      finance: "Maliyyə",
      support: "Tiketlər",
      routes: "Marşrutlar",
      mtm: "MTM / Sahə",
      kpi: "KPI / Menecerlər",
    },
    severities: {
      critical: "Kritik",
      high: "Yüksək",
      medium: "Orta",
      low: "Aşağı",
    },
    actionTypes: {
      create_task: "Tapşırıq yarat",
      assign_task: "Tapşırığı təyin et",
      assign_owner: "Sahib təyin et",
      assign_ticket_owner: "Tiket sahibi təyin et",
      create_alert: "Xəbərdarlıq yarat",
      priority_update: "Prioritet yenilə",
      create_note: "Qeyd yarat",
      draft_followup: "Cavab hazırla",
      invoice_reminder: "Faktura xatırlatması",
      flag_route_issue: "Marşrut problemini işarələ",
      suggest_budget_change: "Büdcə baxışını təklif et",
      contract_review: "Müqaviləni yoxla",
      approval_escalation: "Təsdiqi eskalasiya et",
      signature_reminder: "İmza xatırlatması",
      campaign_review: "Kampaniyanı yoxla",
      segment_review_task: "Segmenti yoxla",
      support_escalation: "Dəstəyə eskalasiya et",
      kpi_plan_review: "KPI planını yoxla",
      stage_alert: "Mərhələ riski",
      route_issue: "Marşrut problemi",
      create_followup_task: "Cavab tapşırığı yarat",
      quote_reminder: "Təklif xatırlatması",
      unblock_task: "Tapşırığı blokdan çıxar",
      escalate_overdue_task: "Gecikmiş tapşırığı eskalasiya et",
      bill_payment_escalation: "Faktura ödənişini eskalasiya et",
      missed_visit_task: "Buraxılmış ziyarəti yoxla",
      coaching_task: "Kouçinq tapşırığı",
      update_health_note: "Status qeydini yenilə",
    },
    previewFields: {
      taskTitle: "Tapşırıq",
      alertTitle: "Xəbərdarlıq",
      noteSubject: "Qeyd",
      followupSubject: "Mövzu",
      budgetTitle: "Büdcə baxışı",
      description: "Təsvir",
      message: "Mesaj",
      body: "Qaralama",
      assignee: "İcraçı",
      priority: "Prioritet",
      amount: "Məbləğ",
      relatedRecord: "Əlaqəli qeyd",
      company: "Şirkət",
      invoice: "Invoice",
      daysOverdue: "Gecikmə günü",
    },
    factLabels: {
      Status: "Status",
      Priority: "Prioritet",
      "Escalation level": "Eskalasiya səviyyəsi",
      Company: "Şirkət",
      Customer: "Müştəri",
      "Idle days": "Hərəkətsiz günlər",
      "Valid until": "Etibarlıdır",
      Amount: "Məbləğ",
      "First response due": "İlk cavab vaxtı",
      "SLA due": "SLA vaxtı",
    },
    statusValues: {
      open: "açıq",
      in_progress: "icradadır",
      pending: "gözləyir",
      resolved: "həll edilib",
      closed: "bağlı",
      viewed: "baxılıb",
      sent: "göndərilib",
      accepted: "qəbul edilib",
      rejected: "rədd edilib",
      expired: "müddəti bitib",
      draft: "qaralama",
    },
    priorityValues: {
      critical: "kritik",
      urgent: "təcili",
      high: "yüksək",
      medium: "orta",
      low: "aşağı",
    },
    entityTypes: {
      ticket: "tiket",
      quote: "təklif",
    },
    advisorTexts: {
      ticketAtSlaRisk: "{ticket} SLA riski altındadır",
      ticketEscalatedUnresolved: "{ticket} eskalasiya edilib və həll olunmayıb",
      ticketAtEscalationLevel: "Tiket {level} eskalasiya səviyyəsindədir və hələ açıqdır.",
      firstResponseSlaBreached: "İlk cavab SLA-sı artıq pozulub.",
      resolutionSlaBreached: "Həll SLA-sı artıq pozulub.",
      slaDeadlineApproaching: "SLA müddəti yaxınlaşır.",
      slaRiskTitle: "SLA riski: {ticket}",
      assignOwnerTitle: "Sahib təyin et: {ticket}",
      raisePriorityTitle: "Prioriteti yüksəlt: {ticket}",
      supportEscalationMessage: "SLA pozulmadan əvvəl bu tiketi eskalasiya edin və ya sahib təyin edin.",
      assignOwnerMessage: "SLA pozulmadan əvvəl dəstək sahibi təyin edin.",
      raisePriorityMessage: "SLA pəncərəsi riskdə olduğu üçün tiket prioritetini yüksəldin.",
      quoteNoBuyerDecision: "{quote} üzrə alıcı qərarı yoxdur",
      quoteValidityExpired: "Təklifin etibarlılıq müddəti bitib. Status: {status}.",
      quoteIdle: "Təklif {status} statusundadır və {days} gündür hərəkətsizdir.",
      followUpQuoteTitle: "{quote} üzrə alıcı qərarını yoxla",
      quoteFollowUpMessage: "Təklif {status} statusundadır və {days} gündür hərəkətsizdir. Alıcı qərarını təsdiqləyin və ya şərtləri yeniləyin.",
      quoteRiskNote: "Təklif {status} statusunda {days} gündür alıcı qərarı olmadan qalır. Məbləğ {amount}.",
    },
  },
}

function domainLabelFor(copy: (typeof COPY)["en"], key: AdvisorDomainKey, fallback?: string) {
  return copy.domains[key] || fallback || key
}

function severityLabelFor(copy: (typeof COPY)["en"], severity: AdvisorSignal["severity"]) {
  return copy.severities[severity] || severity
}

function actionTypeLabelFor(copy: (typeof COPY)["en"], actionType: string) {
  return copy.actionTypes[actionType as keyof typeof copy.actionTypes] || actionType.replace(/_/g, " ")
}

function interpolate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce((result, [key, value]) => result.replace(`{${key}}`, value), template)
}

function advisorTextFor(copy: (typeof COPY)["en"], value: string) {
  const exact: Record<string, string> = {
    "First response SLA is breached.": copy.advisorTexts.firstResponseSlaBreached,
    "Resolution SLA is breached.": copy.advisorTexts.resolutionSlaBreached,
    "SLA deadline is approaching.": copy.advisorTexts.slaDeadlineApproaching,
    "Escalate or assign this ticket before the SLA is missed.": copy.advisorTexts.supportEscalationMessage,
    "Assign a support owner before the SLA is missed.": copy.advisorTexts.assignOwnerMessage,
    "Raise ticket priority because the SLA window is at risk.": copy.advisorTexts.raisePriorityMessage,
  }
  if (exact[value]) return exact[value]

  const ticketAtRisk = value.match(/^(.+) is at SLA risk$/)
  if (ticketAtRisk) return interpolate(copy.advisorTexts.ticketAtSlaRisk, { ticket: ticketAtRisk[1] })

  const ticketEscalated = value.match(/^(.+) is escalated and unresolved$/)
  if (ticketEscalated) return interpolate(copy.advisorTexts.ticketEscalatedUnresolved, { ticket: ticketEscalated[1] })

  const escalationLevel = value.match(/^Ticket is at escalation level (.+) and remains open\.$/)
  if (escalationLevel) return interpolate(copy.advisorTexts.ticketAtEscalationLevel, { level: escalationLevel[1] })

  const slaRiskTitle = value.match(/^SLA risk: (.+)$/)
  if (slaRiskTitle) return interpolate(copy.advisorTexts.slaRiskTitle, { ticket: slaRiskTitle[1] })

  const assignOwnerTitle = value.match(/^Assign owner: (.+)$/)
  if (assignOwnerTitle) return interpolate(copy.advisorTexts.assignOwnerTitle, { ticket: assignOwnerTitle[1] })

  const raisePriorityTitle = value.match(/^Raise priority: (.+)$/)
  if (raisePriorityTitle) return interpolate(copy.advisorTexts.raisePriorityTitle, { ticket: raisePriorityTitle[1] })

  const noBuyerDecision = value.match(/^(.+?) has no buyer decision$/)
  if (noBuyerDecision) return interpolate(copy.advisorTexts.quoteNoBuyerDecision, { quote: noBuyerDecision[1] })

  const quoteExpired = value.match(/^Quote validity expired with status (.+)\.$/)
  if (quoteExpired) {
    const status = copy.statusValues[quoteExpired[1] as keyof typeof copy.statusValues] || quoteExpired[1]
    return interpolate(copy.advisorTexts.quoteValidityExpired, { status })
  }

  const quoteIdle = value.match(/^Quote is (.+) and has been idle for (\d+) days\.$/)
  if (quoteIdle) {
    const status = copy.statusValues[quoteIdle[1] as keyof typeof copy.statusValues] || quoteIdle[1]
    return interpolate(copy.advisorTexts.quoteIdle, { status, days: quoteIdle[2] })
  }

  const followUpQuote = value.match(/^Follow up quote (.+)$/)
  if (followUpQuote) return interpolate(copy.advisorTexts.followUpQuoteTitle, { quote: followUpQuote[1] })

  const quoteFollowUp = value.match(/^Quote is (.+) and has been idle for (\d+) days\. Confirm buyer decision or revise terms\.$/)
  if (quoteFollowUp) {
    const status = copy.statusValues[quoteFollowUp[1] as keyof typeof copy.statusValues] || quoteFollowUp[1]
    return interpolate(copy.advisorTexts.quoteFollowUpMessage, { status, days: quoteFollowUp[2] })
  }

  const quoteRiskNote = value.match(/^Quote (.+) without buyer decision for (\d+) days\. Amount (.+)\.$/)
  if (quoteRiskNote) {
    const status = copy.statusValues[quoteRiskNote[1] as keyof typeof copy.statusValues] || quoteRiskNote[1]
    return interpolate(copy.advisorTexts.quoteRiskNote, { status, days: quoteRiskNote[2], amount: quoteRiskNote[3] })
  }

  return value
}

function factLabelFor(copy: (typeof COPY)["en"], label: string) {
  return copy.factLabels[label as keyof typeof copy.factLabels] || label
}

function factValueFor(copy: (typeof COPY)["en"], fact: AdvisorSignal["facts"][number]) {
  const value = fact.value
  if (fact.label === "Status") return copy.statusValues[value as keyof typeof copy.statusValues] || value
  if (fact.label === "Priority") return copy.priorityValues[value as keyof typeof copy.priorityValues] || value
  return advisorTextFor(copy, value)
}

function previewValueFor(copy: (typeof COPY)["en"], label: string, value: string) {
  const localized = advisorTextFor(copy, value)
  if (label !== copy.previewFields.relatedRecord) return localized
  const match = localized.match(/^([^:]+):(.+)$/)
  if (!match) return localized
  const entityType = copy.entityTypes[match[1] as keyof typeof copy.entityTypes] || match[1]
  return `${entityType}: ${match[2]}`
}

export function AdvisorRecordWidget({ entityType, entityId, orgId, title = "Da Vinci Advisor" }: AdvisorRecordWidgetProps) {
  const locale = useLocale()
  const copy = COPY[(locale as keyof typeof COPY) in COPY ? (locale as keyof typeof COPY) : "en"]
  const [payload, setPayload] = useState<AdvisorPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [queueing, setQueueing] = useState<string | null>(null)
  const [queued, setQueued] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)

  const headers = useMemo(() => ({
    "Content-Type": "application/json",
    ...(orgId ? { "x-organization-id": orgId } : {}),
  }), [orgId])

  useEffect(() => {
    let active = true
    setLoading(true)
    setFailed(false)
    const params = new URLSearchParams({ entityType, entityId })
    fetch(`/api/v1/ai/advisor/signals?${params.toString()}`, { headers })
      .then((res) => res.json())
      .then((json) => {
        if (active && json?.data) setPayload(json.data)
      })
      .catch(() => {
        if (active) setFailed(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => { active = false }
  }, [entityId, entityType, headers])

  const signals = payload?.signals || []
  const advisorHref = "/dashboard"

  const queueAction = async (signal: AdvisorSignal, action: AdvisorAction) => {
    const key = `${signal.id}:${action.actionType}`
    setQueueing(key)
    try {
      const res = await fetch("/api/v1/ai/advisor/actions", {
        method: "POST",
        headers,
        body: JSON.stringify({ signal, action }),
      }).then((response) => response.json()).catch(() => null)
      if (res?.data) {
        setQueued(key)
        toast(copy.queued, { description: actionTypeLabelFor(copy, action.actionType) })
      } else {
        toast(copy.queueFailed)
      }
    } finally {
      setQueueing(null)
    }
  }

  const displayTitle = title === "Advisor risk" || title === "Da Vinci Advisor" ? copy.title : title

  return (
    <section className="rounded-xl border border-zinc-200 bg-card p-4 dark:border-zinc-700">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="truncate text-sm font-semibold">{displayTitle}</h3>
        </div>
        <Button variant="ghost" size="sm" className="h-7 px-2" title={copy.openAdvisorCenter} aria-label={copy.openAdvisorCenter} asChild>
          <Link href={advisorHref}>
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">
          <div className="h-3 w-2/3 rounded bg-muted" />
          <div className="h-3 w-full rounded bg-muted" />
          <div className="h-8 w-full rounded-lg bg-muted" />
        </div>
      ) : failed ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
          {copy.checkFailed}
        </div>
      ) : signals.length === 0 ? (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" />
          {copy.noRisk}
        </div>
      ) : (
        <div className="divide-y divide-zinc-200 dark:divide-zinc-700">
          {signals.slice(0, 2).map((signal) => (
            <RecordSignalRisk
              key={signal.id}
              signal={signal}
              copy={copy}
              queued={queued}
              queueing={queueing}
              onQueue={queueAction}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function RecordSignalRisk({
  signal,
  copy,
  queued,
  queueing,
  onQueue,
}: {
  signal: AdvisorSignal
  copy: (typeof COPY)["en"]
  queued: string | null
  queueing: string | null
  onQueue: (signal: AdvisorSignal, action: AdvisorAction) => void
}) {
  const primaryAction = signal.recommendedActions[0]
  const actionKey = primaryAction ? `${signal.id}:${primaryAction.actionType}` : null
  const preview = primaryAction
    ? buildAdvisorActionPreviewEntries({
      actionType: primaryAction.actionType,
      entityType: signal.entityType,
      entityId: signal.entityId,
      payload: primaryAction.payload,
    }, copy.previewFields).slice(0, 3)
    : []

  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className={severityClass(signal.severity)}>{severityLabelFor(copy, signal.severity)}</Badge>
        <span className="text-[11px] text-muted-foreground">{domainLabelFor(copy, signal.domain, signal.domainLabel)}</span>
      </div>
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">{advisorTextFor(copy, signal.title)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{advisorTextFor(copy, signal.summary)}</p>
        </div>
      </div>
      {signal.facts.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground">{copy.whyFlagged}</p>
          {signal.facts.slice(0, 3).map((fact, index) => (
            <div key={`${fact.label}:${fact.value}`} className="grid grid-cols-[18px_minmax(0,1fr)] gap-2 text-[11px]">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">{index + 1}</span>
              <div className="min-w-0">
                <span className="text-muted-foreground">{factLabelFor(copy, fact.label)}: </span>
                <span className="font-medium">{factValueFor(copy, fact)}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {signal.sources.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {signal.sources.slice(0, 2).map((source) => (
            <Button key={`${source.entityType}:${source.entityId}`} variant="outline" size="sm" className="h-7 px-2 text-[11px]" asChild>
              <Link href={source.href}>
                <FileText className="h-3 w-3" />
                {source.label}
              </Link>
            </Button>
          ))}
        </div>
      ) : null}
      {primaryAction && preview.length > 0 ? (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-background px-3 py-2 dark:border-zinc-700">
          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
                <Inbox className="h-3 w-3" />
                <span>{copy.recommendedStep}</span>
              </div>
              <p className="line-clamp-2 text-xs font-semibold text-foreground">{advisorTextFor(copy, primaryAction.label)}</p>
            </div>
            <Badge variant="outline" className="shrink-0 text-[10px]">{copy.requiresApproval}</Badge>
          </div>
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">{copy.actionPreview}</p>
          <div className="space-y-1">
            {preview.map((item) => (
              <div key={`${signal.id}:record-preview:${item.label}`} className="grid grid-cols-[82px_minmax(0,1fr)] gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{item.label}</span>
                <span className="truncate font-medium" title={previewValueFor(copy, item.label, item.value)}>{previewValueFor(copy, item.label, item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {primaryAction && actionKey ? (
        <Button
          size="sm"
          variant={queued === actionKey ? "outline" : "default"}
          // h-auto + whitespace-normal: the label ("Send for approval: <action>")
          // is long and the AI rail is only ~340px — a nowrap button (Button's
          // default) overflowed the column and was clipped at the viewport edge.
          // Let it wrap to two lines instead of spilling.
          className="mt-3 h-auto w-full justify-center whitespace-normal py-2 text-center leading-snug"
          onClick={() => onQueue(signal, primaryAction)}
          disabled={queued === actionKey || queueing === actionKey}
          aria-label={queued === actionKey ? copy.queuedForApproval : `${copy.sendForApproval}: ${actionTypeLabelFor(copy, primaryAction.actionType)}`}
        >
          {queueing === actionKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : queued === actionKey ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Inbox className="h-3.5 w-3.5" />}
          <span className="min-w-0">{queued === actionKey ? copy.queuedForApproval : `${copy.sendForApproval}: ${actionTypeLabelFor(copy, primaryAction.actionType)}`}</span>
        </Button>
      ) : null}
    </div>
  )
}

function severityClass(severity: AdvisorSignal["severity"]) {
  if (severity === "critical") return "border-red-300 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
  if (severity === "high") return "border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300"
  return "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
}
