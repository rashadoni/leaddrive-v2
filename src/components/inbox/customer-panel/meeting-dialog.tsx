"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BookingCreatePanel } from "@/components/booking/booking-create-panel"

type BookingContext = {
  timezone: string
  hosts: { id: string; name: string; isActive: boolean; canReceiveBookings: boolean }[]
  pages: { id: string; title: string; hostIds: string[]; isActive: boolean; category: string | null }[]
}

/**
 * «Görüş» from the inbox panel: the Meetings module's own booking form (the one the workspace opens),
 * with the conversation's customer already filled in and linked. A booking made here is the same
 * Booking as one made in «Görüşlər» — its host's task, reminders and calendar follow by themselves.
 */
export function MeetingDialog({ open, onOpenChange, client }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  client: { type: "contact" | "lead"; id: string; name: string; phone: string; email: string | null }
}) {
  const t = useTranslations("inboxPanel")
  const context = useQuery({
    queryKey: ["inbox-panel-booking-context"],
    enabled: open,
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/v1/bookings/context", { signal, cache: "no-store" })
      const body = await res.json().catch(() => null) as { data?: BookingContext } | null
      if (!res.ok || !body?.data) throw new Error(String(res.status))
      return body.data
    },
  })
  const pages = context.data?.pages.filter((page) => page.isActive && page.hostIds.length) ?? []
  const hosts = context.data?.hosts.filter((host) => host.isActive && host.canReceiveBookings) ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange} widthClassName="max-w-3xl" maxHeightClassName="max-h-[92vh]">
      <DialogHeader>
        <DialogTitle>{t("meetingTitle", { name: client.name })}</DialogTitle>
      </DialogHeader>
      <DialogContent>
        <div className="space-y-4" data-testid="inbox-panel-meeting-dialog">
          {context.isLoading ? <p role="status" className="text-sm text-muted-foreground">{t("meetingLoading")}</p> : null}
          {context.isError ? <p role="alert" className="text-sm text-destructive">{t("meetingNoAccess")}</p> : null}
          {context.data && pages.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("meetingNoServices")}{" "}
              <Link href="/meetings/services" className="font-medium text-primary hover:underline">{t("meetingServicesLink")}</Link>
            </p>
          ) : null}
          {context.data && pages.length > 0 ? (
            <BookingCreatePanel
              pages={pages}
              hosts={hosts}
              timezone={context.data.timezone}
              initialClient={{
                link: { type: client.type, id: client.id, name: client.name, subtitle: client.phone || client.email || "" },
                phone: client.phone,
                email: client.email,
              }}
              onSaved={() => {
                toast.success(t("meetingSaved"))
                onOpenChange(false)
              }}
            />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
