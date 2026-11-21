"use client"

/**
 * What opens in place under the stage track instead of a modal: why a stage
 * cannot be entered yet, why the deal is lost, and how to reach the customer.
 */
import { useState, type FormEvent, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import { CircleAlert, Contact, Loader2, Mail, MessageCircle, Plus, TriangleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { ClickToCallButton } from "@/components/call-widget"
import { cn } from "@/lib/utils"

const PANEL = "rounded-xl border border-border bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05)] animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none"

function Mark({ tone, children }: { tone: "warn" | "plain"; children: ReactNode }) {
  return (
    <span className={cn(
      "flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full [&_svg]:h-4 [&_svg]:w-4",
      tone === "warn" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" : "bg-muted text-muted-foreground",
    )}>{children}</span>
  )
}

/** The target stage has rules this deal does not meet: the move did not happen, and this says why. */
export function StageGuardNotice({ stage, messages, onClose }: { stage: string; messages: string[]; onClose: () => void }) {
  const t = useTranslations("dealPage")
  return (
    <div role="alert" data-testid="deal-stage-guard" className={cn(PANEL, "flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3.5 sm:px-[18px]")}>
      <Mark tone="warn"><TriangleAlert /></Mark>
      <div className="min-w-0 flex-1 basis-[240px]">
        <p className="text-sm font-semibold">{t("guardTitle", { stage })}</p>
        <ul className="text-[13px] text-muted-foreground">
          {messages.map((message) => <li key={message}>{message}</li>)}
        </ul>
        <p className="text-[13px] text-muted-foreground">{t("guardHint")}</p>
      </div>
      <Button size="sm" variant="outline" onClick={onClose}>{t("gotIt")}</Button>
    </div>
  )
}

export const LOST_REASONS = ["price", "competitor", "budget", "changedMind", "other"] as const

/** «Lost» asks why before it is set: the reason is what the report on lost deals is made of. */
export function LostReasonForm({ competitors, busy, error, onSubmit, onCancel }: {
  competitors: string[]
  busy: boolean
  error: string
  /** The reason as it is stored in the deal: one line a person can read. */
  onSubmit: (reason: string) => void
  onCancel: () => void
}) {
  const t = useTranslations("dealPage")
  const [reason, setReason] = useState<string | null>(null)
  const [rival, setRival] = useState("")
  const [note, setNote] = useState("")
  const [missing, setMissing] = useState(false)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!reason) { setMissing(true); return }
    const parts = [t(`lostReasons.${reason}`), rival && t("lostTo", { name: rival }), note.trim()].filter(Boolean)
    onSubmit(parts.join(". ").slice(0, 500))
  }
  const shownError = missing ? t("errReason") : error

  return (
    <form noValidate onSubmit={submit} data-testid="deal-lost-form" className={cn(PANEL, "space-y-3 px-4 py-3.5 sm:px-[18px]")}>
      <div>
        <p className="text-sm font-semibold">{t("lostAsk")}</p>
        <p className="text-[13px] text-muted-foreground">{t("lostAskHint")}</p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("lostAsk")}>
        {LOST_REASONS.map((key) => (
          <Button key={key} type="button" size="sm" variant={reason === key ? "selected" : "outline"} aria-pressed={reason === key} className="h-9" onClick={() => { setReason(key); setMissing(false) }}>
            {t(`lostReasons.${key}`)}
          </Button>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {competitors.length > 0 && (
          <div className="min-w-[180px] flex-1 space-y-1.5">
            <Label htmlFor="deal-lost-rival" className="text-xs text-muted-foreground">{t("lostWho")}</Label>
            <Select id="deal-lost-rival" value={rival} onChange={(e) => setRival(e.target.value)}>
              <option value="">{t("lostNobody")}</option>
              {competitors.map((name) => <option key={name} value={name}>{name}</option>)}
            </Select>
          </div>
        )}
        <div className="min-w-[220px] flex-[2] space-y-1.5">
          <Label htmlFor="deal-lost-note" className="text-xs text-muted-foreground">{t("lostNote")}</Label>
          <Input id="deal-lost-note" maxLength={300} placeholder={t("lostNotePlaceholder")} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" className="h-9" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{t("markLost")}</Button>
        <Button type="button" size="sm" variant="ghost" className="h-9" onClick={onCancel} disabled={busy}>{t("cancel")}</Button>
        {shownError && <p role="alert" className="flex items-center gap-1.5 text-sm font-medium text-red-700 dark:text-red-400"><CircleAlert className="h-4 w-4 shrink-0" />{shownError}</p>}
      </div>
    </form>
  )
}

export interface ReachContact { id: string; fullName: string; position?: string | null; phone: string | null; email: string | null }

/**
 * Reach the customer from the deal: a call through the CRM's own phone, a
 * WhatsApp message opened with the text ready, a letter from the feed's
 * composer. WhatsApp opens with the text typed in and the person presses
 * «send» there — the CRM does not claim a message it cannot see leave.
 */
export function ReachPanel({ dealId, companyId, contacts, debt, canWrite, onAddContact, onWriteEmail, onClose }: {
  dealId: string
  companyId?: string
  contacts: ReachContact[]
  /** The unpaid invoice the reminder is about, when there is one. */
  debt: { number: string; amount: string } | null
  canWrite: boolean
  onAddContact: () => void
  onWriteEmail: () => void
  onClose: () => void
}) {
  const t = useTranslations("dealPage")
  const tc = useTranslations("common")
  const [contactId, setContactId] = useState(contacts[0]?.id ?? "")
  const contact = contacts.find((c) => c.id === contactId) ?? contacts[0]
  const templates = [
    ...(debt ? [{ key: "reminder", label: t("tplReminder"), text: t("tplReminderText", debt) }] : []),
    { key: "thanks", label: t("tplThanks"), text: t("tplThanksText") },
    { key: "own", label: t("tplOwn"), text: "" },
  ]
  const [template, setTemplate] = useState(templates[0].key)
  const [text, setText] = useState(templates[0].text)

  if (!contact) {
    return (
      <div data-testid="deal-reach" className={cn(PANEL, "flex flex-wrap items-center gap-x-3.5 gap-y-2 px-4 py-3.5 sm:px-[18px]")}>
        <Mark tone="plain"><Contact /></Mark>
        <div className="min-w-0 flex-1 basis-[240px]">
          <p className="text-sm font-semibold">{t("reachNoContact")}</p>
          <p className="text-[13px] text-muted-foreground">{t("reachNoContactHint")}</p>
        </div>
        {canWrite && <Button size="sm" className="gap-1.5" onClick={onAddContact}><Plus className="h-4 w-4" />{t("addContact")}</Button>}
        <Button size="sm" variant="ghost" onClick={onClose}>{tc("close")}</Button>
      </div>
    )
  }

  const digits = (contact.phone || "").replace(/[^0-9]/g, "")
  return (
    <div data-testid="deal-reach" className={cn(PANEL, "space-y-3 px-4 py-3.5 sm:px-[18px]")}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-[220px]">
          <p className="text-sm font-semibold">{t("reachTitle")}</p>
          <p className="text-[13px] text-muted-foreground">{[contact.fullName, contact.position, contact.phone || t("noPhone")].filter(Boolean).join(" · ")}</p>
        </div>
        {contacts.length > 1 && (
          <Select aria-label={t("reachWho")} value={contact.id} onChange={(e) => setContactId(e.target.value)} className="w-auto min-w-[200px]">
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
          </Select>
        )}
        <Button size="sm" variant="ghost" onClick={onClose}>{tc("close")}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {contact.phone ? (
          <ClickToCallButton
            phone={contact.phone} contactId={contact.id} companyId={companyId} dealId={dealId} contactName={contact.fullName}
            showLabel label={t("reachCall")}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted/50"
          />
        ) : <span className="text-[13px] text-muted-foreground">{t("reachNeedsPhone")}</span>}
        <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={onWriteEmail}><Mail className="h-4 w-4" />{t("reachEmail")}</Button>
      </div>

      {digits && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold"><MessageCircle className="h-4 w-4" />WhatsApp</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t("tplChoose")}>
            {templates.map((item) => (
              <Button key={item.key} type="button" size="sm" variant={template === item.key ? "selected" : "outline"} aria-pressed={template === item.key} onClick={() => { setTemplate(item.key); setText(item.text) }}>
                {item.label}
              </Button>
            ))}
          </div>
          <Textarea aria-label={t("tplText")} rows={3} maxLength={1000} placeholder={t("tplText")} value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`https://wa.me/${digits}${text.trim() ? `?text=${encodeURIComponent(text.trim())}` : ""}`}
              target="_blank" rel="noopener noreferrer" data-crm-button="outline"
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-3.5 text-sm font-medium transition-colors hover:bg-muted/50"
            >
              <MessageCircle className="h-4 w-4" />{t("reachOpenWhatsApp")}
            </a>
            <span className="text-[13px] text-muted-foreground">{t("reachWhatsAppHint")}</span>
          </div>
        </div>
      )}
    </div>
  )
}
