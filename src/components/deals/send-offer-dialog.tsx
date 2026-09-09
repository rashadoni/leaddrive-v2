"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Loader2, Send } from "lucide-react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"

interface Offer {
  id: string
  offerNumber: string
  title: string
  totalAmount: number | null
  currency: string
}

export function SendOfferDialog({
  open,
  onClose,
  onSent,
  offer,
  orgId,
  defaultEmail,
}: {
  open: boolean
  onClose: () => void
  onSent: () => void
  offer: Offer
  orgId?: string
  defaultEmail?: string | null
}) {
  const t = useTranslations("offers")
  const [sending, setSending] = useState(false)
  const [email, setEmail] = useState(defaultEmail || "")
  const [subject, setSubject] = useState(
    `${t("emailSubjectPrefix")} ${offer.offerNumber} — ${offer.title}`
  )
  const [message, setMessage] = useState(
    `${t("emailGreeting")}\n\n${t("emailBody")} ${offer.offerNumber}.\n\n${t("emailAmount")}: ${(offer.totalAmount || 0).toFixed(2)} ${offer.currency}\n\n${t("emailRegards")}`
  )

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(orgId ? { "x-organization-id": orgId } : {} as Record<string, string>),
  }

  const handleSend = async () => {
    if (!email.trim()) { toast.error(t("emailRequired")); return }
    setSending(true)
    try {
      const res = await fetch(`/api/v1/offers/${offer.id}/send`, {
        method: "POST",
        headers,
        body: JSON.stringify({ recipientEmail: email, subject, message }),
      })
      const data = await res.json()
      if (data.success) {
        toast.success(t("emailSent"))
        onSent()
      } else {
        toast.error(data.error || "Error sending email")
      }
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("sendTitle")} — {offer.offerNumber}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label>{t("recipientEmail")}</Label>
            <Input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="email@example.com"
            />
          </div>

          <div>
            <Label>{t("emailSubject")}</Label>
            <Input value={subject} onChange={e => setSubject(e.target.value)} />
          </div>

          <div>
            <Label>{t("emailMessage")}</Label>
            <Textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={6}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button onClick={handleSend} disabled={sending}>
              {sending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              {t("send")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
