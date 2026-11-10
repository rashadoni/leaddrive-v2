"use client"

import { lazy, Suspense, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { ClipboardCheck } from "lucide-react"
import { formatDate } from "@/lib/format-date"
import { nextVisitAt } from "@/lib/booking/service"
import { dateInputValueInTimezone } from "@/lib/timezone"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import type { WorkspaceBooking } from "./booking-workspace"

const TaskForm = lazy(() => import("@/components/task-form").then((module) => ({ default: module.TaskForm })))

/** Ordinary tasks retain their existing field, board and workflow rules. */
export function BookingFollowUp({ booking, timezone }: { booking: WorkspaceBooking; timezone: string }) {
  const t = useTranslations("booking")
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  // A service with a cycle says when the client is due back, so the task opens
  // on that day instead of today. Nothing is promised to the client by it —
  // somebody still has to do the task.
  const cycleDays = booking.bookingPage.repeatCycleDays ?? null
  const nextVisit = nextVisitAt(booking.startsAt, cycleDays)
  const nextVisitDay = nextVisit ? dateInputValueInTimezone(nextVisit, timezone) : ""
  const [initial] = useState(() => ({
    title: t("followUpTitle", { name: booking.name }),
    description: `/meetings?booking=${encodeURIComponent(booking.id)}`,
    ...(nextVisitDay ? { dueDate: nextVisitDay } : {}),
    // A meeting booked for a customer the CRM already had carries the contact
    // instead of a lead of its own, so the follow-up lands on that customer.
    ...(booking.leadId ? { relatedType: "lead", relatedId: booking.leadId, relatedName: booking.name }
      : booking.contactId ? { relatedType: "contact", relatedId: booking.contactId, relatedName: booking.name } : {}),
  }))
  if (!booking.canCreateFollowUp) return null
  return <CrmSection title={t("followUpSection")} icon={<ClipboardCheck aria-hidden="true" className="h-4 w-4" />}>
    {nextVisit && cycleDays ? <p className="mb-3 text-sm text-muted-foreground">{t("cycleDue", { count: cycleDays, date: formatDate(nextVisit, locale, { day: "numeric", month: "long", timeZone: timezone }) })}</p> : null}
    <Button variant="outline" className="h-auto max-w-full whitespace-normal py-2.5" onClick={() => { setSaved(false); setOpen(true) }}>{t("createFollowUp")}</Button>
    {saved ? <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{t("followUpSaved")}</p> : null}
    {open ? <Suspense fallback={<p role="status">{t("workspaceLoading")}</p>}><TaskForm open={open} onOpenChange={setOpen} onSaved={() => { setOpen(false); setSaved(true) }} initialData={initial} /></Suspense> : null}
  </CrmSection>
}
