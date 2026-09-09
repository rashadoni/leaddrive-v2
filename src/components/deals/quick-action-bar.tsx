"use client"

import { useState, useMemo, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Button } from "@/components/ui/button"
import { StickyNote, Mail, Send, Loader2, ChevronDown, AlertCircle, Check, Paperclip, X } from "lucide-react"
import { useTranslations } from "next-intl"
import { cn } from "@/lib/utils"

type ActionType = "note" | "email"

const MAX_FILES = 3
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export interface DealContact {
  id: string
  fullName: string
  email: string | null
  isPrimary?: boolean
}

interface QuickActionBarProps {
  dealId: string
  orgId?: string
  contacts?: DealContact[]
  onActivityAdded?: () => void
  labels: {
    notePlaceholder: string
    note: string
    email: string
    send: string
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function QuickActionBar({ dealId, orgId, contacts = [], onActivityAdded, labels }: QuickActionBarProps) {
  const t = useTranslations("deals")
  const [activeType, setActiveType] = useState<ActionType>("note")
  const [text, setText] = useState("")
  const [emailSubject, setEmailSubject] = useState("")
  const [emailBody, setEmailBody] = useState("")
  const [attachments, setAttachments] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [showContactPicker, setShowContactPicker] = useState(false)
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Filter contacts with email
  const emailContacts = useMemo(() => contacts.filter(c => c.email), [contacts])

  const [selectedContactId, setSelectedContactId] = useState<string | null>(null)

  // Set default contact when contacts load
  useEffect(() => {
    if (emailContacts.length > 0 && !selectedContactId) {
      const primary = emailContacts.find(c => c.isPrimary)
      setSelectedContactId(primary?.id || emailContacts[0]?.id || null)
    }
  }, [emailContacts, selectedContactId])

  const selectedContact = emailContacts.find(c => c.id === selectedContactId) || null

  const headers: Record<string, string> = {
    ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const remaining = MAX_FILES - attachments.length
    const toAdd = files.slice(0, remaining)

    for (const f of toAdd) {
      if (f.size > MAX_FILE_SIZE) {
        setSendResult({ success: false, message: t("qabFileTooLarge", { name: f.name }) })
        return
      }
    }

    setAttachments(prev => [...prev, ...toAdd])
    // Reset input so same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    setSendResult(null)
    try {
      if (activeType === "email") {
        if (!selectedContact?.email || !emailSubject.trim() || !emailBody.trim()) return

        // Build FormData for file upload support
        const fd = new FormData()
        fd.append("contactId", selectedContact.id)
        fd.append("subject", emailSubject.trim())
        fd.append("body", emailBody.trim())
        for (const file of attachments) {
          fd.append("files", file)
        }

        const res = await fetch(`/api/v1/deals/${dealId}/send-email`, {
          method: "POST",
          headers, // no Content-Type — browser sets multipart boundary
          body: fd,
        })
        const json = await res.json()
        if (json.success) {
          const attachInfo = json.attachmentCount > 0 ? ` (${json.attachmentCount} ${t("qabAttachments")})` : ""
          setSendResult({
            success: json.emailSent,
            message: json.emailSent
              ? `${t("qabSent")} → ${json.recipientEmail}${attachInfo}`
              : `${t("qabRecorded")} (SMTP: ${json.emailError || t("qabNotConfigured")})`,
          })
          setEmailSubject("")
          setEmailBody("")
          setAttachments([])
          onActivityAdded?.()
        } else {
          setSendResult({ success: false, message: json.error || t("qabError") })
        }
      } else if (activeType === "note") {
        if (!text.trim()) return
        await fetch("/api/v1/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            type: "note",
            subject: text.trim(),
            description: "",
            relatedType: "deal",
            relatedId: dealId,
          }),
        })
        setText("")
        onActivityAdded?.()
      }
    } finally {
      setSubmitting(false)
    }
  }

  // Auto-clear send result after 4s
  useEffect(() => {
    if (!sendResult) return
    const t = setTimeout(() => setSendResult(null), 4000)
    return () => clearTimeout(t)
  }, [sendResult])

  const types: { key: ActionType; icon: typeof StickyNote; label: string }[] = [
    { key: "note", icon: StickyNote, label: labels.note },
    { key: "email", icon: Mail, label: labels.email },
  ]

  const emailDisabled = activeType === "email" && (!selectedContact?.email || !emailSubject.trim() || !emailBody.trim())
  const noteDisabled = activeType === "note" && !text.trim()

  return (
    <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 bg-card p-3 space-y-2.5">
      {/* Type selector */}
      <div className="flex items-center gap-1">
        {types.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => { setActiveType(key); setSendResult(null) }}
            className={cn(
              "relative flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              activeType === key
                ? "text-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            )}
          >
            {activeType === key && (
              <motion.div
                layoutId="quickActionTab"
                className="absolute inset-0 bg-muted rounded-lg"
                transition={{ duration: 0.2, ease: "easeInOut" }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {label}
            </span>
          </button>
        ))}
      </div>

      {/* Content area */}
      <AnimatePresence mode="wait">
        {activeType === "email" ? (
          <motion.div
            key="email-form"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="space-y-2"
          >
            {emailContacts.length === 0 ? (
              /* No contacts warning */
              <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 dark:text-amber-400 rounded-lg px-3 py-2">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {t("qabAddContactWithEmail")}
              </div>
            ) : (
              <>
                {/* Recipient selector */}
                <div className="relative">
                  <button
                    onClick={() => setShowContactPicker(!showContactPicker)}
                    className="w-full flex items-center gap-2 text-xs border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 bg-background hover:bg-muted/50 transition-colors"
                  >
                    <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">{t("qabTo")}:</span>
                    <span className="font-medium truncate">
                      {selectedContact?.fullName} &lt;{selectedContact?.email}&gt;
                    </span>
                    {emailContacts.length > 1 && (
                      <ChevronDown className={cn("h-3 w-3 ml-auto text-muted-foreground transition-transform", showContactPicker && "rotate-180")} />
                    )}
                  </button>

                  {/* Dropdown */}
                  {showContactPicker && emailContacts.length > 1 && (
                    <div className="absolute z-20 top-full mt-1 left-0 right-0 bg-popover border border-zinc-200 dark:border-zinc-700 rounded-lg shadow-lg py-1">
                      {emailContacts.map(c => (
                        <button
                          key={c.id}
                          onClick={() => { setSelectedContactId(c.id); setShowContactPicker(false) }}
                          className={cn(
                            "w-full text-left px-3 py-1.5 text-xs hover:bg-muted/50 flex items-center gap-2",
                            c.id === selectedContactId && "bg-muted"
                          )}
                        >
                          <span className="font-medium">{c.fullName}</span>
                          <span className="text-muted-foreground">&lt;{c.email}&gt;</span>
                          {c.isPrimary && <span className="ml-auto text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-1.5 rounded">Primary</span>}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Subject */}
                <input
                  className="w-full h-9 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground/60"
                  placeholder={t("qabSubjectPlaceholder")}
                  value={emailSubject}
                  onChange={e => setEmailSubject(e.target.value)}
                />

                {/* Body */}
                <textarea
                  className="w-full border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground/60 resize-none min-h-[80px]"
                  placeholder={t("qabBodyPlaceholder")}
                  rows={3}
                  value={emailBody}
                  onChange={e => setEmailBody(e.target.value)}
                />

                {/* Attachments */}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {attachments.map((file, i) => (
                      <div
                        key={`${file.name}-${i}`}
                        className="flex items-center gap-1.5 bg-muted/60 rounded-md px-2 py-1 text-xs"
                      >
                        <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="truncate max-w-[140px]">{file.name}</span>
                        <span className="text-muted-foreground shrink-0">({formatFileSize(file.size)})</span>
                        <button
                          onClick={() => removeAttachment(i)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.webp,.txt,.csv,.zip,.rar"
                  onChange={handleFileSelect}
                />

                {/* Actions row: attach + result + send */}
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={attachments.length >= MAX_FILES}
                    className={cn(
                      "flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-1.5 py-1 rounded",
                      attachments.length >= MAX_FILES && "opacity-40 cursor-not-allowed"
                    )}
                    title={attachments.length >= MAX_FILES ? t("qabMaxFiles", { max: MAX_FILES }) : t("qabAttachFile")}
                  >
                    <Paperclip className="h-3.5 w-3.5" />
                    <span>{attachments.length > 0 ? `${attachments.length}/${MAX_FILES}` : t("qabAttach")}</span>
                  </button>

                  {sendResult && (
                    <div className={cn(
                      "flex items-center gap-1.5 text-xs px-2 py-1 rounded-md",
                      sendResult.success
                        ? "bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-400"
                    )}>
                      {sendResult.success ? <Check className="h-3 w-3" /> : <AlertCircle className="h-3 w-3" />}
                      {sendResult.message}
                    </div>
                  )}
                  <Button
                    size="sm"
                    disabled={emailDisabled || submitting}
                    onClick={handleSubmit}
                    className="gap-1.5 shrink-0 ml-auto"
                  >
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {labels.send}
                  </Button>
                </div>
              </>
            )}
          </motion.div>
        ) : (
          /* Note */
          <motion.div
            key="note"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            className="flex items-center gap-2"
          >
            <input
              className="flex-1 h-9 border border-zinc-200 dark:border-zinc-700 rounded-lg px-3 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 placeholder:text-muted-foreground/60"
              placeholder={labels.notePlaceholder}
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && text.trim()) handleSubmit() }}
            />
            <Button
              size="sm"
              disabled={noteDisabled || submitting}
              onClick={handleSubmit}
              className="gap-1.5 shrink-0"
            >
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
              {labels.send}
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
