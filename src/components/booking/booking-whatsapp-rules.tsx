"use client"

/**
 * What the WhatsApp agent may book by itself. Everything the salon does not
 * tick here it still offers and holds, but brings to a person first — so
 * narrowing a rule never makes the salon slower to answer, only slower to
 * commit. The rules themselves are src/lib/booking/whatsapp-rules.ts.
 */
import { useTranslations } from "next-intl"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
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

function Chips({ label, count, children }: { label: string; count: string; children: React.ReactNode }) {
  return <div className="rounded-lg border border-border p-3.5">
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm font-semibold">{label}</span>
      <span className="text-xs font-semibold text-muted-foreground">{count}</span>
    </div>
    <div className="mt-2.5 flex flex-wrap gap-1.5">{children}</div>
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

export function BookingWhatsAppRules({ rules, services, hosts, disabled, onChange }: {
  rules: AutonomyRules
  services: RuleService[]
  hosts: { id: string; name: string }[]
  disabled: boolean
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

  return <div className="mt-6">
    <h3 className="text-sm font-bold">{t("waRulesTitle")}</h3>
    <p className="mt-0.5 text-xs text-muted-foreground">{t("waRulesHint")}</p>

    <div className={cn("mt-4 space-y-3", disabled ? "pointer-events-none opacity-50" : "")}>
      <Chips label={t("waRulesServices")} count={t("waRulesChosen", { chosen: (rules.serviceIds ?? services.map((item) => item.id)).length, total: services.length })}>
        {services.map((service) => {
          const chosen = rules.serviceIds ?? services.map((item) => item.id)
          return <Chip key={service.id} on={chosen.includes(service.id)} onClick={() => onChange({ ...rules, serviceIds: toggle(rules.serviceIds, service.id, services.map((item) => item.id)) })}>
            {service.title}
          </Chip>
        })}
      </Chips>

      <Chips label={t("waRulesHosts")} count={t("waRulesChosen", { chosen: (rules.hostIds ?? hosts.map((item) => item.id)).length, total: hosts.length })}>
        {hosts.map((host) => {
          const chosen = rules.hostIds ?? hosts.map((item) => item.id)
          return <Chip key={host.id} on={chosen.includes(host.id)} onClick={() => onChange({ ...rules, hostIds: toggle(rules.hostIds, host.id, hosts.map((item) => item.id)) })}>
            {host.name}
          </Chip>
        })}
      </Chips>

      <div className="rounded-lg border border-border p-3.5">
        <span className="text-sm font-semibold">{t("waRulesHours")}</span>
        <p className="mt-1 text-xs text-muted-foreground">{t("waRulesHoursHint")}</p>
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {WEEK_ORDER.map((day) => <Chip
            key={day}
            on={openDays.includes(day)}
            onClick={() => onChange({ ...rules, hours: buildHours(openDays.includes(day) ? openDays.filter((item) => item !== day) : [...openDays, day], interval) })}
          >{t(`weekday_${day}`)}</Chip>)}
        </div>
        {openDays.length ? <div className="mt-3 flex flex-wrap items-center gap-2">
          {(["start", "end"] as const).map((edge) => <Input
            key={edge}
            type="time"
            className="h-9 w-28"
            aria-label={t(edge === "start" ? "waRulesFrom" : "waRulesTo")}
            value={interval[edge]}
            onChange={(event) => event.target.value && onChange({ ...rules, hours: buildHours(openDays, { ...interval, [edge]: event.target.value }) })}
          />)}
        </div> : <p className="mt-2 text-xs font-semibold text-muted-foreground">{t("waRulesAnyHour")}</p>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-border p-3.5">
          <Label htmlFor="wa-rules-price" className="text-sm font-semibold">{t("waRulesMaxPrice")}</Label>
          <Input
            id="wa-rules-price"
            className="mt-2 h-9"
            inputMode="decimal"
            placeholder={t("waRulesNoLimit")}
            value={rules.maxPrice === null ? "" : String(rules.maxPrice)}
            onChange={(event) => {
              const text = event.target.value.replace(/[^\d.,]/g, "").slice(0, 12)
              const amount = text.trim() ? Number(text.replace(",", ".")) : null
              onChange({ ...rules, maxPrice: amount === null || !Number.isFinite(amount) ? null : amount })
            }}
          />
        </div>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3.5">
          <Checkbox checked={rules.newClients} onCheckedChange={(on) => onChange({ ...rules, newClients: on })} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{t("waRulesNewClients")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{t("waRulesNewClientsHint")}</span>
          </span>
        </label>
      </div>
    </div>
  </div>
}
