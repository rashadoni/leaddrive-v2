"use client"

/**
 * Call this lead yourself, through the CRM.
 *
 * The lead card only ever offered a `tel:` link, which hands the number to the
 * operating system and leaves no trace here: no call record, no recording, no
 * post-call analysis, no task. Everything the AI call produces was missing from
 * every call a salesperson made by hand.
 *
 * The button places the call through the same provider the AI calls use, so the
 * conversation lands in the lead's history like any other. The system rings the
 * salesperson on their own number — the one in their profile — and connects
 * them to the customer.
 *
 * It steps aside where the browser softphone is available. The two buttons are
 * not two kinds of call: they are two places to pick up the same one, a phone
 * or this tab. Offering both asks the salesperson to understand a distinction
 * that changes nothing for the customer — and the phone one is the half that
 * goes wrong, because it needs a number in the profile and silently reaches an
 * extension nobody answers when that is empty. So where the browser can take
 * the call, it takes it, and this button is not shown at all.
 *
 * It is hidden, not deleted: organisations without the softphone still have
 * only this path, and for them nothing changes.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Phone, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"

export function LeadManualCallAction({
  leadId,
  phone,
}: {
  leadId: string
  phone: string | null | undefined
}) {
  const t = useTranslations("voip")
  const [calling, setCalling] = useState(false)
  // `null` until the answer arrives. Rendering nothing while unknown would make
  // the button appear late on every load for the organisations that still rely
  // on it; assuming "no softphone" would flash a second button and take it away
  // again for the ones that have it. Unknown is its own state, and it shows
  // this button — the safe default is the path that works without any of the
  // softphone's moving parts.
  const [browserCalls, setBrowserCalls] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/v1/voip/capabilities", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : { browserCalls: false }))
      .then((d) => {
        if (!cancelled) setBrowserCalls(d?.browserCalls === true)
      })
      .catch(() => {
        if (!cancelled) setBrowserCalls(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!phone) return null
  if (browserCalls === true) return null

  async function placeCall() {
    setCalling(true)
    try {
      const res = await fetch("/api/v1/calls", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          // Required by the route: without it every click is refused before the
          // body is even read. A fresh key per click is correct — two clicks
          // mean the rep really wants a second attempt.
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ provider: "voip", toNumber: phone, leadId }),
      })
      const json = await res.json()
      if (!res.ok) {
        // Backend codes are for logs, not for people: show a sentence, and keep
        // the raw code only when we have no wording for it.
        const key = typeof json?.error === "string" ? json.error : ""
        const known = ["voice_contact_blocked", "active_voice_call_exists", "choose_call_provider", "invalid_phone_number", "agent_phone_required", "agent_phone_unsupported"]
        toast.error(known.includes(key) ? t(`manualCallError.${key}`) : t("manualCallFailed"))
        return
      }
      // Say which phone is about to ring. Promising "yours" while the shared
      // line answers is what makes a rep click again and dial the customer twice.
      toast.success(json?.agentLeg === "shared" ? t("manualCallPlacedShared") : t("manualCallPlaced"))
    } catch {
      toast.error(t("manualCallFailed"))
    } finally {
      setCalling(false)
    }
  }

  return (
    <Button
      variant="outline"
      className="gap-1.5"
      onClick={placeCall}
      disabled={calling}
      title={t("manualCallHint")}
    >
      {calling
        ? <Loader2 className="h-4 w-4 animate-spin" />
        : <Phone className="h-4 w-4 text-emerald-600" />}
      {t("manualCall")}
    </Button>
  )
}
