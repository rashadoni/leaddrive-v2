"use client"

import { lazy, Suspense, useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
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
  return <section className="space-y-2 border-t pt-4">
    <Button variant="outline" onClick={() => { setSaved(false); setOpen(true) }}>{t("createFollowUp")}</Button>
    {saved ? <p role="status" className="text-sm text-muted-foreground">{t("followUpSaved")}</p> : null}
    {open ? <Suspense fallback={<p role="status">{t("workspaceLoading")}</p>}><TaskForm open={open} onOpenChange={setOpen} onSaved={() => { setOpen(false); setSaved(true) }} initialData={initial} /></Suspense> : null}
  </section>
}
