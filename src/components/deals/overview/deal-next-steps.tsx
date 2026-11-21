"use client"

/**
 * «What to do now» — the one place on the deal page that says what is wrong
 * and lets it be put right on the spot: money owed, nobody answering for the
 * deal, nobody to talk to, what the next stage asks for, and what is planned.
 * A form opens under its own row; nothing here is a modal.
 *
 * Which steps there are is decided by `buildNextSteps`
 * (src/lib/deals/deal-overview.ts); this file draws them and sends the
 * action. After every action the page re-reads the deal, so a step is ticked
 * because the server says so, not because a button was pressed.
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { useLocale, useTranslations } from "next-intl"
import {
  ArrowRight, Banknote, CalendarClock, CalendarPlus, Check, ChevronDown, ChevronUp, CircleAlert, CircleCheck,
  Contact, ListChecks, Loader2, RotateCcw, Send, Trash2, UserRound,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"
import { daysUntil, type NextStep, type NextSteps, type StageKind } from "@/lib/deals/deal-overview"

export interface PlannedTask { id: string; title: string; dueDate: string | null; status: string }

interface Person { id: string; name: string | null; email: string }
interface ContactOption { id: string; fullName: string; position?: string | null; companyId?: string | null }

export const money = (value: number, currency: string) =>
  `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${currency}`

/** A day as a person says it: «24 ноября». The year is said only when it is not this one. */
export const dayMonth = (iso: string, locale: string, now = new Date()) => {
  const date = new Date(iso)
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }) }).format(date)
}

const isoDay = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

async function send(url: string, method: string, body: unknown, orgId?: string): Promise<void> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...(orgId ? { "x-organization-id": orgId } : {}) },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const json = await res.json().catch(() => ({}))
    throw new Error(json?.message || json?.error || String(res.status))
  }
}

function InlineForm({ onSubmit, onCancel, busy, error, submitLabel, children }: {
  onSubmit: () => void; onCancel: () => void; busy: boolean; error: string; submitLabel: string; children: ReactNode
}) {
  const tc = useTranslations("common")
  return (
    <form
      noValidate
      onSubmit={(event: FormEvent) => { event.preventDefault(); onSubmit() }}
      className="mx-4 mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-border bg-muted/30 p-3 sm:ml-[62px]"
    >
      {children}
      <Button type="submit" size="sm" className="h-9" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}</Button>
      <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onCancel} disabled={busy}>{tc("cancel")}</Button>
      {error && <p role="alert" className="flex w-full items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400"><CircleAlert className="h-4 w-4 shrink-0" />{error}</p>}
    </form>
  )
}

function Field({ label, htmlFor, grow, children }: { label: string; htmlFor: string; grow?: boolean; children: ReactNode }) {
  return (
    <div className={cn("min-w-[150px] space-y-1.5", grow ? "flex-[3]" : "flex-1")}>
      <Label htmlFor={htmlFor} className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function DealNextSteps({
  dealId, orgId, currentUserId, deal, kind, stageLabel, nextStageLabel, lostReason, result, tasks,
  canWrite, canInvoice, canTask, form, onForm, onChanged, onMoveNext, onReopen, onOpenSection, onEditDeal,
}: {
  dealId: string
  orgId?: string
  currentUserId?: string
  deal: { assignedTo: string | null; assignedToName?: string | null; contactId: string | null; contact: { fullName: string; phone: string | null; email: string | null } | null; companyId?: string | null; expectedClose: string | null }
  kind: StageKind
  stageLabel: string
  nextStageLabel: string | null
  lostReason: string | null
  result: NextSteps
  tasks: PlannedTask[]
  canWrite: boolean
  canInvoice: boolean
  canTask: boolean
  /** The open form: `<step id>:<action>` or `plan`. The page holds it, so a tile can open one. */
  form: string | null
  onForm: (form: string | null) => void
  onChanged: () => void
  onMoveNext: () => void
  onReopen: () => void
  onOpenSection: (section: string, part: string) => void
  onEditDeal: () => void
}) {
  const t = useTranslations("dealPage")
  const locale = useLocale()
  const now = useMemo(() => new Date(), [])
  const [showDone, setShowDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [people, setPeople] = useState<Person[] | null>(null)
  const [contacts, setContacts] = useState<ContactOption[] | null>(null)
  const [search, setSearch] = useState("")
  const [values, setValues] = useState<Record<string, string>>({})
  const value = (key: string, fallback = "") => values[key] ?? fallback
  const setValue = (key: string, next: string) => { setValues((all) => ({ ...all, [key]: next })); setError("") }

  // A form that opens starts clean: the last one's error and search are not its own.
  useEffect(() => { setError(""); setSearch("") }, [form])

  const headers = orgId ? { "x-organization-id": orgId } : undefined
  useEffect(() => {
    if (form === "owner:set" && people === null) {
      fetch("/api/v1/users?limit=100", { headers }).then((r) => r.json())
        .then((j) => setPeople(j.success ? (j.data?.users || j.data || []) : []))
        .catch(() => setPeople([]))
    }
    if (form === "contact:set" && contacts === null) {
      fetch("/api/v1/contacts?limit=200", { headers }).then((r) => r.json())
        .then((j) => setContacts(j.success ? (j.data?.contacts || j.data || []) : []))
        .catch(() => setContacts([]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form])

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true)
    setError("")
    try {
      await action()
      toast.success(done)
      onForm(null)
      onChanged()
    } catch (failure) {
      setError(failure instanceof Error && failure.message && !/^\d+$/.test(failure.message) ? failure.message : t("actionFailed"))
    } finally {
      setBusy(false)
    }
  }
  const putDeal = (body: Record<string, unknown>) => send(`/api/v1/deals/${dealId}`, "PUT", body, orgId)

  const { steps, left, done, morePayments } = result
  const total = steps.length
  const lost = kind === "lost"
  const formStep = form && form !== "plan" ? form.slice(0, form.lastIndexOf(":")) : null
  const rows = left > 0 || showDone || formStep ? steps : []

  let title: string
  let sub = ""
  let extra: ReactNode = null
  if (lost) {
    title = t("lostTitle")
    sub = lostReason ? t("lostReasonIs", { reason: lostReason }) : ""
    if (canWrite) extra = <Button size="sm" variant="outline" className="gap-1.5" onClick={onReopen}><RotateCcw className="h-4 w-4" />{t("reopen")}</Button>
  } else if (left > 0) {
    title = t("todoTitle")
    sub = t("todoStage", { stage: stageLabel })
  } else if (nextStageLabel) {
    title = t("stageReady")
    if (canWrite) extra = <Button size="sm" className="gap-1.5" onClick={onMoveNext}>{t("moveTo", { stage: nextStageLabel })}<ArrowRight className="h-4 w-4" /></Button>
  } else {
    title = t("allDone")
    sub = t("allDoneSub")
  }

  const stepView = (step: NextStep): { icon: ReactNode; title: string; sub: string; hint: string; actions: Array<{ key: string; label: string; icon?: ReactNode; primary?: boolean; onClick?: () => void }> } => {
    switch (step.kind) {
      case "pay": {
        const inv = step.invoice
        return {
          icon: <CircleAlert />,
          title: t("stepPay", { amount: money(inv.balanceDue, inv.currency) }),
          sub: step.overdueDays > 0 ? t("stepPayOverdue", { number: inv.invoiceNumber, days: step.overdueDays })
            : step.urgent ? t("stepPayOverdueNoDate", { number: inv.invoiceNumber })
              : inv.dueDate ? t("stepPayDue", { number: inv.invoiceNumber, date: dayMonth(inv.dueDate, locale, now) }) : t("stepPayNoDue", { number: inv.invoiceNumber }),
          hint: t("stepPayHint"),
          actions: canInvoice ? [
            { key: "send", label: t("sendInvoiceAgain"), icon: <Send className="h-4 w-4" /> },
            { key: "record", label: t("recordPayment"), icon: <Banknote className="h-4 w-4" />, primary: true },
          ] : [],
        }
      }
      case "paid":
        return { icon: <CircleCheck />, title: t("stepPaid"), sub: t("stepPaidSub"), hint: t("stepPayHint"), actions: [] }
      case "owner":
        return {
          icon: <UserRound />,
          title: step.done ? t("stepOwnerDone", { name: deal.assignedToName || t("someone") }) : t("stepOwner"),
          sub: step.done ? t("stepOwnerDoneSub") : t("stepOwnerSub"),
          hint: t("stepOwnerHint"),
          actions: canWrite ? [{ key: "set", label: step.done ? t("change") : t("assign") }] : [],
        }
      case "contact":
        return {
          icon: <Contact />,
          title: step.done ? t("stepContactDone", { name: deal.contact?.fullName || t("someone") }) : t("stepContact"),
          sub: step.done ? (deal.contact?.phone || deal.contact?.email || t("stepContactNoPhone")) : t("stepContactSub"),
          hint: t("stepContactHint"),
          actions: canWrite ? [{ key: "set", label: step.done ? t("change") : t("add") }] : [],
        }
      case "rule": {
        const field = step.rule.fieldName
        const action = !canWrite ? []
          : field === "expectedClose" ? [{ key: "date", label: step.done ? t("change") : t("fill") }]
            : field === "valueAmount" ? [{ key: "go", label: t("openProducts"), onClick: () => onOpenSection("sale", "items") }]
              : step.rule.ruleType === "task_completed" ? [{ key: "go", label: t("plan"), onClick: () => onForm("plan") }]
                : [{ key: "go", label: step.done ? t("change") : t("fill"), onClick: onEditDeal }]
        return {
          icon: <ListChecks />,
          title: step.rule.errorMessage || field,
          sub: nextStageLabel ? t("stepRuleSub", { stage: nextStageLabel }) : "",
          hint: t("stepRuleHint"),
          actions: action,
        }
      }
    }
  }

  const stepForm = (step: NextStep, action: string) => {
    const id = `${step.id}:${action}`
    const cancel = () => onForm(null)
    if (step.kind === "pay" && action === "record") {
      const inv = step.invoice
      const amountKey = `${id}:amount`
      const dateKey = `${id}:date`
      const submit = () => {
        const amount = Number(value(amountKey, String(inv.balanceDue)).replace(",", "."))
        if (!(amount > 0)) return setError(t("errAmount"))
        if (amount > inv.balanceDue + 0.005) return setError(t("errOverpay", { amount: money(inv.balanceDue, inv.currency) }))
        void run(() => send(`/api/v1/invoices/${inv.id}/payments`, "POST", { amount, paymentDate: value(dateKey, isoDay(now)) }, orgId), t("paymentRecorded", { amount: money(amount, inv.currency) }))
      }
      return (
        <InlineForm onSubmit={submit} onCancel={cancel} busy={busy} error={error} submitLabel={t("recordPayment")}>
          <Field label={t("amountIn", { currency: inv.currency })} htmlFor={amountKey}><Input id={amountKey} inputMode="decimal" autoFocus value={value(amountKey, String(inv.balanceDue))} onChange={(e) => setValue(amountKey, e.target.value)} /></Field>
          <Field label={t("paymentDate")} htmlFor={dateKey}><Input id={dateKey} type="date" value={value(dateKey, isoDay(now))} onChange={(e) => setValue(dateKey, e.target.value)} /></Field>
        </InlineForm>
      )
    }
    if (step.kind === "pay" && action === "send") {
      const inv = step.invoice
      const key = `${id}:email`
      const submit = () => {
        const email = value(key, deal.contact?.email || "").trim()
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setError(t("errEmail"))
        void run(() => send(`/api/v1/invoices/${inv.id}/send`, "POST", { recipientEmail: email }, orgId), t("invoiceSent", { email }))
      }
      return (
        <InlineForm onSubmit={submit} onCancel={cancel} busy={busy} error={error} submitLabel={t("sendInvoice")}>
          <Field label={t("sendTo")} htmlFor={key} grow><Input id={key} type="email" autoFocus autoComplete="off" placeholder="name@company.az" value={value(key, deal.contact?.email || "")} onChange={(e) => setValue(key, e.target.value)} /></Field>
        </InlineForm>
      )
    }
    if (step.kind === "rule" && action === "date") {
      const key = `${id}:date`
      const submit = () => {
        const day = value(key, deal.expectedClose ? deal.expectedClose.slice(0, 10) : "")
        if (!day) return setError(t("errDate"))
        void run(() => putDeal({ expectedClose: day }), t("saved"))
      }
      return (
        <InlineForm onSubmit={submit} onCancel={cancel} busy={busy} error={error} submitLabel={t("save")}>
          <Field label={t("expectedClose")} htmlFor={key}><Input id={key} type="date" autoFocus value={value(key, deal.expectedClose ? deal.expectedClose.slice(0, 10) : "")} onChange={(e) => setValue(key, e.target.value)} /></Field>
        </InlineForm>
      )
    }
    if ((step.kind === "owner" || step.kind === "contact") && action === "set") {
      const isOwner = step.kind === "owner"
      const list = isOwner
        ? (people ?? []).map((p) => ({ id: p.id, name: p.name || p.email, sub: "" }))
        // The customer's own people first: they are who the deal is most likely about.
        : [...(contacts ?? [])].sort((a, b) => Number(b.companyId === deal.companyId) - Number(a.companyId === deal.companyId))
          .map((c) => ({ id: c.id, name: c.fullName, sub: c.position || "" }))
      const loading = isOwner ? people === null : contacts === null
      const needle = search.trim().toLowerCase()
      const shown = list.filter((item) => !needle || item.name.toLowerCase().includes(needle)).slice(0, 8)
      const selected = isOwner ? deal.assignedTo : deal.contactId
      const pick = (item: { id: string; name: string }) => void run(
        () => putDeal(isOwner ? { assignedTo: item.id } : { contactId: item.id }),
        isOwner ? t("ownerSet", { name: item.name }) : t("contactSet", { name: item.name }),
      )
      return (
        <div className="mx-4 mb-4 space-y-3 rounded-xl border border-border bg-muted/30 p-3 sm:ml-[62px]">
          {list.length > 8 && (
            <Input aria-label={t("search")} placeholder={t("search")} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" autoFocus />
          )}
          {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
            <div className="flex flex-wrap gap-2">
              {shown.map((item) => (
                <Button key={item.id} type="button" size="sm" variant={item.id === selected ? "selected" : "outline"} className="h-9 gap-2" disabled={busy} onClick={() => pick(item)}>
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-bold" aria-hidden>{item.name.slice(0, 1).toUpperCase()}</span>
                  {item.name}{item.sub && <span className="font-normal text-muted-foreground">{item.sub}</span>}
                </Button>
              ))}
              {shown.length === 0 && <p className="text-sm text-muted-foreground">{isOwner ? t("noPeople") : t("noContacts")}</p>}
              <Button type="button" size="sm" variant="ghost" className="h-9" onClick={cancel}>{t("cancel")}</Button>
            </div>
          )}
          {error && <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400"><CircleAlert className="h-4 w-4 shrink-0" />{error}</p>}
        </div>
      )
    }
    return null
  }

  const planForm = () => {
    const submit = () => {
      const text = value("plan:title").trim()
      const day = value("plan:date", isoDay(new Date(now.getTime() + 3 * 86_400_000)))
      if (!text) return setError(t("errPlanText"))
      if (!day) return setError(t("errDate"))
      // Nine in the morning of that day, the viewer's clock: the reminder rings then.
      const due = new Date(`${day}T09:00:00`).toISOString()
      const assignee = deal.assignedTo || currentUserId
      void run(async () => {
        await send("/api/v1/tasks", "POST", { title: text, dueDate: due, remindAt: due, relatedType: "deal", relatedId: dealId, ...(assignee ? { assignedTo: assignee } : {}) }, orgId)
        setValues((all) => ({ ...all, "plan:title": "" }))
      }, t("planned", { date: dayMonth(due, locale, now) }))
    }
    return (
      <InlineForm onSubmit={submit} onCancel={() => onForm(null)} busy={busy} error={error} submitLabel={t("plan")}>
        <Field label={t("planWhat")} htmlFor="deal-plan-title" grow><Input id="deal-plan-title" autoFocus placeholder={t("planPlaceholder")} maxLength={200} value={value("plan:title")} onChange={(e) => setValue("plan:title", e.target.value)} /></Field>
        <Field label={t("planWhen")} htmlFor="deal-plan-date"><Input id="deal-plan-date" type="date" value={value("plan:date", isoDay(new Date(now.getTime() + 3 * 86_400_000)))} onChange={(e) => setValue("plan:date", e.target.value)} /></Field>
      </InlineForm>
    )
  }

  const when = (iso: string | null) => {
    if (!iso) return t("planNoDate")
    const days = daysUntil(iso, now)
    if (days < 0) return t("planLate", { days: -days })
    if (days === 0) return t("today")
    if (days === 1) return t("tomorrow")
    return t("planIn", { date: dayMonth(iso, locale, now), days })
  }

  const taskAction = (task: PlannedTask, complete: boolean) => void run(
    () => send(`/api/v1/tasks/${task.id}`, "PATCH", { status: complete ? "completed" : "cancelled" }, orgId),
    complete ? t("planDone") : t("planRemoved"),
  )

  return (
    <section data-tour-id="deal-next-steps" aria-label={title} className="rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5 sm:px-[18px]">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {sub && <span className="hidden text-[13px] text-muted-foreground sm:inline">{sub}</span>}
        <span className="flex-1" />
        {total > 0 && (
          <>
            <span className="flex gap-1" aria-hidden>
              {steps.map((step) => <span key={step.id} className={cn("h-[5px] w-4 rounded-full transition-colors sm:w-[26px]", step.done ? "bg-emerald-600" : "bg-border")} />)}
            </span>
            <span className="whitespace-nowrap text-[13px] text-muted-foreground">{t("progress", { done, total })}</span>
          </>
        )}
        {extra}
        {total > 0 && left === 0 && (
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" aria-expanded={showDone} onClick={() => setShowDone((v) => !v)}>
            {showDone ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}{showDone ? t("hideSteps") : t("showSteps")}
          </Button>
        )}
      </div>

      {rows.map((step) => {
        const view = stepView(step)
        const open = formStep === step.id ? form!.slice(form!.lastIndexOf(":") + 1) : null
        return (
          <div key={step.id} data-step={step.id} className={cn("border-t border-border", step.urgent && "bg-red-50/60 dark:bg-red-950/20")}>
            <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3 sm:px-[18px]">
              <Hint text={view.hint}>
                <span tabIndex={0} className={cn(
                  "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full [&_svg]:h-4 [&_svg]:w-4",
                  step.done ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                    : step.urgent ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-muted text-muted-foreground",
                )}>{step.done ? <Check /> : view.icon}</span>
              </Hint>
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className={cn("text-sm", step.done ? "font-medium text-muted-foreground" : "font-semibold")}>{view.title}</p>
                {view.sub && <p className={cn("text-[13px]", step.urgent ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>{view.sub}</p>}
              </div>
              {!open && view.actions.length > 0 && (
                <div className="flex flex-wrap gap-2 max-sm:w-full max-sm:pl-[44px]">
                  {view.actions.map((action) => (
                    <Button key={action.key} size="sm" variant={action.primary ? "default" : "outline"} className="gap-1.5" onClick={action.onClick ?? (() => onForm(`${step.id}:${action.key}`))}>
                      {action.icon}{action.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
            {open && stepForm(step, open)}
          </div>
        )
      })}

      {morePayments > 0 && rows.length > 0 && (
        <div className="border-t border-border px-4 py-2.5 sm:px-[18px]">
          <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => onOpenSection("money", "invoices")}>{t("moreInvoices", { count: morePayments })}<ArrowRight className="h-4 w-4" /></Button>
        </div>
      )}

      <div className="border-t border-border" data-step="plan">
        <div className="flex min-h-[54px] flex-wrap items-center gap-2.5 px-4 py-2.5 sm:px-[18px]">
          <span className="text-sm font-semibold">{t("plannedTitle")}</span>
          {tasks.length === 0 && <span className="hidden text-[13px] text-muted-foreground sm:inline">{t("plannedEmpty")}</span>}
          <span className="flex-1" />
          {canTask && form !== "plan" && (
            <Hint text={t("planHint")}>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onForm("plan")}><CalendarPlus className="h-4 w-4" />{t("plan")}</Button>
            </Hint>
          )}
        </div>
        {form === "plan" && planForm()}
        {tasks.map((task) => {
          const late = task.dueDate ? daysUntil(task.dueDate, now) < 0 : false
          return (
            <div key={task.id} data-plan={task.id} className="flex flex-wrap items-center gap-x-3.5 gap-y-2 border-t border-border px-4 py-3 sm:px-[18px]">
              <span className={cn("flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full", late ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" : "bg-muted text-muted-foreground")}><CalendarClock className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1 basis-[220px]">
                <p className="text-sm font-semibold">{task.title}</p>
                <p className={cn("text-[13px]", late ? "text-red-700 dark:text-red-400" : "text-muted-foreground")}>{when(task.dueDate)}</p>
              </div>
              {canTask && (
                <div className="flex gap-2 max-sm:w-full max-sm:pl-[44px]">
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => taskAction(task, true)}><Check className="h-4 w-4" />{t("markDone")}</Button>
                  <Hint text={t("planRemoveHint")}>
                    <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" aria-label={t("planRemoveHint")} disabled={busy} onClick={() => taskAction(task, false)}><Trash2 className="h-4 w-4" /></Button>
                  </Hint>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
