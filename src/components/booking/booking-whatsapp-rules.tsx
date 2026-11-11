"use client"

/**
 * What the WhatsApp agent may book by itself. Everything the salon does not
 * tick here it still offers and holds, but brings to a person first — so
 * narrowing a rule never makes the salon slower to answer, only slower to
 * commit. The rules themselves are src/lib/booking/whatsapp-rules.ts.
 */
import { useState } from "react"
import { useTranslations } from "next-intl"
import { ChevronDown } from "lucide-react"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { Picked } from "./booking-picked"
import { WEEKDAYS, type Weekday, type WeeklyHours } from "@/lib/booking/availability"
import type { AutonomyRules } from "@/lib/booking/whatsapp-rules"

export interface RuleService {
  id: string
  title: string
  price?: string | null
  priceCurrency?: string | null
}

/** Monday first: the week a person in Baku reads. */
const WEEK_ORDER: Weekday[] = [...WEEKDAYS.slice(1), WEEKDAYS[0]] as Weekday[]
const DEFAULT_INTERVAL = { start: "10:00", end: "18:00" }

function firstInterval(hours: WeeklyHours | null) {
  for (const day of WEEK_ORDER) {
    const interval = hours?.[day]?.[0]
    if (interval) return interval
  }
  return DEFAULT_INTERVAL
}

/** One interval across the ticked days — the shape a salon actually works. */
function buildHours(days: Weekday[], interval: { start: string; end: string }): WeeklyHours | null {
  if (!days.length) return null
  return Object.fromEntries(WEEKDAYS.map((day) => [day, days.includes(day) ? [{ ...interval }] : []])) as WeeklyHours
}

/** One rule, read as a sentence: what it limits on the left, the answer on the right. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
    <span className="w-full shrink-0 text-sm font-medium sm:w-32">{label}</span>
    {children}
  </div>
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button
    type="button"
    aria-pressed={on}
    onClick={onClick}
    className={cn("min-h-8 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      on ? "bg-primary/10 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground hover:text-foreground")}
  >{children}</button>
}

export function BookingWhatsAppRules({ rules, services, hosts, disabled, defaultOpen = false, onChange }: {
  rules: AutonomyRules
  services: RuleService[]
  hosts: { id: string; name: string }[]
  disabled: boolean
  /**
   * Start expanded. A salon that narrowed something wants to see what it
   * narrowed; one that left every rule at «everything» gets the single line.
   */
  defaultOpen?: boolean
  onChange: (rules: AutonomyRules) => void
}) {
  const t = useTranslations("booking")
  const interval = firstInterval(rules.hours)
  const openDays = WEEK_ORDER.filter((day) => (rules.hours?.[day]?.length ?? 0) > 0)

  // A list that holds every item is the same as no list at all — the agent
  // reads «null» as «everything», and so should the next person to open this.
  const toggle = (current: string[] | null, id: string, all: string[]): string[] | null => {
    const chosen = current ?? all
    const next = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id]
    return next.length === all.length ? null : next
  }

  const [open, setOpen] = useState(defaultOpen)
  const serviceIds = services.map((item) => item.id)
  const hostIds = hosts.map((item) => item.id)
  const chosenServices = rules.serviceIds ?? serviceIds
  const chosenHosts = rules.hostIds ?? hostIds

  // The whole rule set in one line, because that is how often it is read:
  // open the card, see what the agent may do, close it.
  const summary = [
    rules.serviceIds === null || chosenServices.length === services.length
      ? t("waRulesSumServicesAll")
      : t("waRulesSumServices", { count: chosenServices.length }),
    rules.hostIds === null || chosenHosts.length === hosts.length
      ? t("waRulesSumHostsAll")
      : t("waRulesSumHosts", { count: chosenHosts.length }),
    openDays.length ? t("waRulesSumHours", { from: interval.start, to: interval.end }) : t("waRulesSumHoursAll"),
    rules.maxPrice === null ? null : t("waRulesSumPrice", { amount: String(rules.maxPrice) }),
    rules.newClients ? t("waRulesSumNewYes") : t("waRulesSumNewNo"),
  ].filter(Boolean).join(" · ")

  return <div className="mt-4 rounded-xl border border-border">
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{t("waRulesTitle")}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-primary">
        {t("waRulesEdit")}
        <ChevronDown className={cn("h-4 w-4 transition-transform", open ? "rotate-180" : "")} aria-hidden="true" />
      </span>
    </button>

    {open ? <div className={cn("space-y-3.5 border-t border-border px-4 py-4", disabled ? "pointer-events-none opacity-50" : "")}>
      <Row label={t("waRulesServices")}>
        <Picked
          items={services.map((item) => ({ id: item.id, name: item.title }))}
          chosen={rules.serviceIds}
          allLabel={t("waRulesAllOf", { count: services.length })}
          addLabel={t("waRulesAddMore", { count: services.length - chosenServices.length })}
          searchLabel={t("hostsSearch")}
          emptyLabel={t("hostsNone")}
          pickLabel={t("waRulesPick")}
          resetLabel={t("waRulesReset")}
          onToggle={(id) => onChange({ ...rules, serviceIds: toggle(rules.serviceIds, id, serviceIds) })}
          onReset={() => onChange({ ...rules, serviceIds: null })}
        />
      </Row>

      <Row label={t("waRulesHosts")}>
        <Picked
          items={hosts}
          chosen={rules.hostIds}
          allLabel={t("waRulesAllOf", { count: hosts.length })}
          addLabel={t("waRulesAddMore", { count: hosts.length - chosenHosts.length })}
          searchLabel={t("hostsSearch")}
          emptyLabel={t("hostsNone")}
          pickLabel={t("waRulesPick")}
          resetLabel={t("waRulesReset")}
          onToggle={(id) => onChange({ ...rules, hostIds: toggle(rules.hostIds, id, hostIds) })}
          onReset={() => onChange({ ...rules, hostIds: null })}
        />
      </Row>

      <Row label={t("waRulesHours")}>
        <div className="inline-flex overflow-hidden rounded-md border border-input" role="group" aria-label={t("waRulesHours")}>
          {WEEK_ORDER.map((day) => {
            const on = openDays.includes(day)
            return <button
              key={day}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ ...rules, hours: buildHours(on ? openDays.filter((item) => item !== day) : [...openDays, day], interval) })}
              className={cn("min-h-9 border-l border-input px-2.5 text-xs font-semibold transition-colors first:border-l-0",
                on ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
            >{t(`weekdayShort_${day}`)}</button>
          })}
        </div>
        {openDays.length ? <span className="flex items-center gap-1.5">
          {(["start", "end"] as const).map((edge) => <span key={edge} className="flex items-center gap-1.5">
            {edge === "end" ? <span className="text-muted-foreground">—</span> : null}
            <Input
              type="time"
              className="h-9 w-24"
              aria-label={t(edge === "start" ? "waRulesFrom" : "waRulesTo")}
              value={interval[edge]}
              onChange={(event) => event.target.value && onChange({ ...rules, hours: buildHours(openDays, { ...interval, [edge]: event.target.value }) })}
            />
          </span>)}
        </span> : <span className="text-xs font-semibold text-muted-foreground">{t("waRulesAnyHour")}</span>}
      </Row>

      <Row label={t("waRulesMaxPrice")}>
        <Input
          id="wa-rules-price"
          className="h-9 w-40"
          inputMode="decimal"
          placeholder={t("waRulesNoLimit")}
          value={rules.maxPrice === null ? "" : String(rules.maxPrice)}
          onChange={(event) => {
            const text = event.target.value.replace(/[^\d.,]/g, "").slice(0, 12)
            const amount = text.trim() ? Number(text.replace(",", ".")) : null
            onChange({ ...rules, maxPrice: amount === null || !Number.isFinite(amount) ? null : amount })
          }}
        />
        <Label className="ml-1 flex cursor-pointer items-center gap-2 text-sm font-normal">
          <Checkbox checked={rules.newClients} onCheckedChange={(on) => onChange({ ...rules, newClients: on })} />
          {t("waRulesNewClients")}
        </Label>
      </Row>

      <p className="text-xs text-muted-foreground">{t("waRulesHint")}</p>
    </div> : null}
  </div>
}
