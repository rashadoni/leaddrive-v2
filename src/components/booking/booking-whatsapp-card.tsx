"use client"

/**
 * «Запись через WhatsApp» on the services screen: one switch — off, or book
 * right away — and, when the organization has more than one WhatsApp number,
 * the number that answers. What the agent does is
 * src/lib/booking/whatsapp-agent.ts; this only turns it on.
 */
import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import { MessageCircle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Hint } from "@/components/hint"
import { cn } from "@/lib/utils"
import { OFFER_HOLD_MINUTES, type WhatsAppBookingMode, type WhatsAppBookingSetting } from "@/lib/booking/whatsapp-setting"
import { BookingWhatsAppRules, type RuleService } from "./booking-whatsapp-rules"

interface Channel {
  id: string
  name: string
}

export function BookingWhatsAppCard({ services, hosts }: { services: RuleService[]; hosts: { id: string; name: string }[] }) {
  const t = useTranslations("booking")
  const [setting, setSetting] = useState<WhatsAppBookingSetting | null>(null)
  const [channels, setChannels] = useState<Channel[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  // Whether this number can show a FORM inside WhatsApp. Asked on demand and
  // only by an administrator: it is a question to Meta about the account, not
  // a setting of ours, and the answer is not in anybody's documentation
  // (coexistence numbers — src/lib/booking/whatsapp-flow.ts).
  const [flows, setFlows] = useState<{ checking: boolean; answer: string | null }>({ checking: false, answer: null })

  useEffect(() => {
    let alive = true
    void fetch("/api/v1/booking-pages/whatsapp", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((body) => {
        if (!alive || !body?.success) return
        setSetting(body.data.setting)
        setChannels(body.data.channels)
      })
      .catch(() => undefined)
    return () => { alive = false }
  }, [])

  async function save(next: WhatsAppBookingSetting) {
    setSaving(true)
    setError("")
    try {
      const response = await fetch("/api/v1/booking-pages/whatsapp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.success) throw new Error(body?.code ?? "SAVE_FAILED")
      setSetting(body.data.setting)
    } catch {
      setError(t("waBookingSaveError"))
    } finally {
      setSaving(false)
    }
  }

  // Nothing to switch for someone the route refused, and no flicker while it loads.
  if (!setting) return null
  const noNumber = channels.length === 0
  const modes: { mode: WhatsAppBookingMode; label: string }[] = [
    { mode: "off", label: t("waBookingOff") },
    { mode: "book", label: t("waBookingOn") },
  ]

  return (
    <Card data-testid="booking-whatsapp-card">
      <CardContent className="p-5">
        {/* Name and switch on one line: the card sits at the top of the
            screen now, and a switch a row below its own title was the half of
            it people stopped reading. */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300">
              <MessageCircle className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{t("waBookingTitle")}</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">{t("waBookingDesc")}</p>
            </div>
          </div>

          <div role="radiogroup" aria-label={t("waBookingTitle")} className="grid w-full shrink-0 grid-cols-2 gap-1 rounded-lg bg-muted/60 p-1 text-sm font-semibold sm:w-80">
          {modes.map(({ mode, label }) => {
            const active = setting.mode === mode
            const blocked = mode === "book" && noNumber
            return (
              <Hint key={mode} text={blocked ? t("waBookingNoNumber") : null} wrap>
                <button
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={saving || blocked || active}
                  onClick={() => void save({ ...setting, mode })}
                  className={cn(
                    "min-h-10 w-full rounded-md px-3 py-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
                    active ? "bg-card text-primary shadow-sm ring-1 ring-primary/30" : "text-muted-foreground hover:text-foreground",
                    blocked ? "opacity-50" : "",
                  )}
                >
                  {label}
                </button>
              </Hint>
            )
          })}
          </div>
        </div>

        {/* Number and the hold, one line: both answer «which phone and for how
            long», and neither earns a block of its own. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          {channels.length > 1 ? (
            <label className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t("waBookingChannel")}</span>
              <select
                className="h-9 min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                value={setting.channelConfigId ?? ""}
                disabled={saving}
                onChange={(event) => void save({ ...setting, channelConfigId: event.target.value || null })}
              >
                <option value="">{t("waBookingAllNumbers")}</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
          ) : channels.length === 1 ? (
            <span>{t("waBookingNumber", { name: channels[0].name })}</span>
          ) : (
            <span className="text-muted-foreground">{t("waBookingNoNumber")}</span>
          )}
          <span className="text-xs text-muted-foreground">{t("waBookingHint", { minutes: OFFER_HOLD_MINUTES })}</span>
        </div>

        {/* The rules only matter once the agent is on. */}
        {setting.mode === "book" ? <BookingWhatsAppRules
          rules={setting.rules}
          services={services}
          hosts={hosts}
          disabled={saving}
          defaultOpen={setting.rules.serviceIds !== null || setting.rules.hostIds !== null || setting.rules.hours !== null || setting.rules.maxPrice !== null}
          onChange={(rules) => void save({ ...setting, rules })}
        /> : null}
        {setting.mode === "book" ? <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm">
          <span className="text-muted-foreground">{t("waFlowTitle")}</span>
          <button
            type="button"
            className="min-h-11 rounded-lg border px-3 text-sm"
            disabled={flows.checking}
            onClick={() => {
              setFlows({ checking: true, answer: null })
              void fetch("/api/v1/booking-pages/whatsapp/flow", { cache: "no-store" })
                .then((response) => response.ok ? response.json() : null)
                .then((body) => {
                  const data = body?.data
                  setFlows({ checking: false, answer: !data ? t("waFlowFailed")
                    : data.supported ? (data.booking ? t("waFlowReady", { status: String(data.booking.status) }) : t("waFlowSupported"))
                    : t("waFlowNo", { detail: String(data.detail ?? "") }) })
                })
                .catch(() => setFlows({ checking: false, answer: t("waFlowFailed") }))
            }}
          >{flows.checking ? t("saving") : t("waFlowCheck")}</button>
          {flows.answer ? <span role="status">{flows.answer}</span> : null}
        </div> : null}
        {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  )
}
