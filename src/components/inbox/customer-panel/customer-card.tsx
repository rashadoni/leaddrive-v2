"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { useLocale, useTranslations } from "next-intl"
import { AtSign, Languages, Mail, Phone } from "lucide-react"
import { formatDate } from "@/lib/format-date"
import { cn } from "@/lib/utils"
import { ChannelBadge } from "./journey-card"
import { PanelCard } from "./panel-card"

function languageName(code: string, locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(code)
    return name ? name.charAt(0).toUpperCase() + name.slice(1) : code
  } catch {
    return code
  }
}

/**
 * Who this is — the top card of the owner-approved mock-up (2026-11-15): the customer, what he is
 * to the company and since when, every channel he writes on, and how to reach him. Only what the
 * CRM knows: a row with nothing in it is not drawn (the mock-up's district has no field anywhere).
 */
export function CustomerCard({ name, initials, tintClass, stageLabel, since, channels, phone, phoneControl, email, handle, language, crmHref }: {
  name: string
  initials: string
  tintClass: string
  stageLabel: string | null
  since: string | null
  channels: string[]
  phone: string | null
  /** The real call control for this thread's phone (VoIP or WhatsApp), drawn beside the number. */
  phoneControl?: ReactNode
  email: string | null
  /** The address the customer writes from, when it is not the phone or e-mail above. */
  handle: string | null
  language: string | null
  crmHref: string | null
}) {
  const t = useTranslations("inboxPanel")
  const locale = useLocale()
  const sinceText = since ? t("customerSince", { date: formatDate(new Date(since), locale, { day: "numeric", month: "long" }) }) : null
  const subtitle = [stageLabel, sinceText].filter(Boolean).join(" · ")
  const rows: { key: string; icon: typeof Phone; value: string; extra?: ReactNode }[] = []
  if (phone) rows.push({ key: "phone", icon: Phone, value: phone, extra: phoneControl })
  if (email) rows.push({ key: "email", icon: Mail, value: email })
  if (handle) rows.push({ key: "handle", icon: AtSign, value: handle })
  if (language) rows.push({ key: "language", icon: Languages, value: languageName(language, locale) })

  return (
    <PanelCard testId="inbox-panel-customer">
      <div className="flex items-center gap-3">
        <div className={cn("flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-full text-lg font-semibold text-white", tintClass)}>
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[15px] font-semibold leading-tight">{name}</b>
          {subtitle ? <span className="block truncate text-[11px] font-medium text-muted-foreground">{subtitle}</span> : null}
          {channels.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1" aria-label={t("channelsLabel")}>
              {channels.map((channel) => <ChannelBadge key={channel} channel={channel} className="h-[18px] w-[18px]" />)}
            </div>
          ) : null}
        </div>
      </div>
      {rows.length > 0 ? (
        <div className="mt-2.5 space-y-1">
          {rows.map((row) => (
            <div key={row.key} className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
              <row.icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate" title={row.value}>{row.value}</span>
              {row.extra}
            </div>
          ))}
        </div>
      ) : null}
      {crmHref ? (
        <Link href={crmHref} className="mt-2 inline-block text-[11px] font-semibold text-primary hover:underline">{t("openCrmContact")}</Link>
      ) : null}
    </PanelCard>
  )
}
