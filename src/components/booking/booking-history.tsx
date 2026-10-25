"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslations, useLocale } from "next-intl"
import { History } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CrmSection } from "@/components/ui/crm-section"
import { formatDate, formatTime } from "@/lib/format-date"
import type { WorkspaceBooking } from "./booking-workspace"

export interface BookingHistoryItem { id: string; type: string; when: string; version: number; actorName?: string | null; actorType?: string; reason?: string | null; note?: string | null }
interface HistoryPage { items: BookingHistoryItem[]; nextCursor: number | null }
const LABELS: Record<string, string> = { "sales.booking-created.v1": "bookingCreated", "sales.booking-imported.v1": "historyImported", "sales.booking-rescheduled.v1": "historyRescheduled", "sales.booking-cancelled.v1": "meetingCancelled", "sales.booking-completed.v1": "meetingCompleted", "sales.booking-no-show.v1": "meetingNoShow", "sales.booking-outcome-corrected.v1": "historyCorrected" }

export function BookingHistory({ booking, timezone, cacheScope }: { booking: WorkspaceBooking; timezone: string; cacheScope: string }) {
  const t = useTranslations("booking"), locale = useLocale()
  const history = useInfiniteQuery({
    queryKey: ["booking-history", cacheScope, booking.id, booking.version],
    initialPageParam: null as number | null,
    initialData: { pages: [{ items: booking.history ?? [], nextCursor: booking.historyNextCursor ?? null }], pageParams: [null] },
    queryFn: async ({ signal, pageParam }): Promise<HistoryPage> => {
      const response = await fetch(`/api/v1/bookings/${encodeURIComponent(booking.id)}/history${pageParam ? `?before=${pageParam}` : ""}`, { signal, cache: "no-store" })
      const body = await response.json()
      if (!response.ok || !body.success) throw new Error("history unavailable")
      return body.data
    }, getNextPageParam: (last) => last.nextCursor ?? undefined, retry: false, staleTime: 30_000, refetchOnWindowFocus: false,
  })
  return <CrmSection title={t("workspaceHistory")} icon={<History aria-hidden="true" className="h-4 w-4" />}>
    <ol className="ml-1 space-y-4 border-l border-border pl-4">
      <li className="relative space-y-1 text-sm">
        <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-muted-foreground ring-4 ring-card" />
        <p className="font-medium">{t("bookingCreated")}</p>
        <p className="text-xs text-muted-foreground">{formatDate(booking.createdAt, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })}</p>
      </li>
      {history.data.pages.flatMap((page) => page.items).map((event) => <li key={event.id} className="relative space-y-1 text-sm">
        <span aria-hidden="true" className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-muted-foreground ring-4 ring-card" />
        <p className="font-medium">{t(LABELS[event.type] ?? "historyChanged")}</p>
        <p className="break-words text-xs text-muted-foreground">{event.actorName || t(`actor_${["employee", "customer", "import"].includes(event.actorType ?? "") ? event.actorType : "unknown"}`)}</p>
        <p className="text-xs text-muted-foreground">{formatDate(event.when, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })} · {formatTime(event.when, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })}</p>
        {event.reason ? <p className="whitespace-pre-wrap break-words">{event.reason}</p> : null}
        {event.note ? <p className="whitespace-pre-wrap break-words text-muted-foreground">{event.note}</p> : null}
      </li>)}
    </ol>
    {history.isError ? <p role="alert" className="mt-3 text-sm text-destructive">{t("errLoad")}</p> : null}
    {history.hasNextPage ? <Button variant="ghost" size="sm" className="mt-3" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{t("moreHistory")}</Button> : null}
    {booking.legacyDetails ? <p className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">{t("legacyDetailsHint")}</p> : null}
  </CrmSection>
}
