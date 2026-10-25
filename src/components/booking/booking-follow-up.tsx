"use client"

import { lazy, Suspense, useState } from "react"
import { useTranslations } from "next-intl"
import { ClipboardCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import type { WorkspaceBooking } from "./booking-workspace"

const TaskForm = lazy(() => import("@/components/task-form").then((module) => ({ default: module.TaskForm })))

/** Ordinary tasks retain their existing field, board and workflow rules. */
export function BookingFollowUp({ booking }: { booking: WorkspaceBooking }) {
  const t = useTranslations("booking")
  const [open, setOpen] = useState(false)
  const [saved, setSaved] = useState(false)
  const [initial] = useState(() => ({
    title: t("followUpTitle", { name: booking.name }),
    description: `/meetings?booking=${encodeURIComponent(booking.id)}`,
    ...(booking.leadId ? { relatedType: "lead", relatedId: booking.leadId, relatedName: booking.name } : {}),
  }))
  if (!booking.canCreateFollowUp) return null
  return <CrmSection title={t("followUpSection")} icon={<ClipboardCheck aria-hidden="true" className="h-4 w-4" />}>
    <Button variant="outline" className="h-auto max-w-full whitespace-normal py-2.5" onClick={() => { setSaved(false); setOpen(true) }}>{t("createFollowUp")}</Button>
    {saved ? <p role="status" className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">{t("followUpSaved")}</p> : null}
    {open ? <Suspense fallback={<p role="status">{t("workspaceLoading")}</p>}><TaskForm open={open} onOpenChange={setOpen} onSaved={() => { setOpen(false); setSaved(true) }} initialData={initial} /></Suspense> : null}
  </CrmSection>
}
