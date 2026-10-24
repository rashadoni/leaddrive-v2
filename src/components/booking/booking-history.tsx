"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { useTranslations, useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
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
  return <section className="space-y-3 border-t pt-4">
    <h3 className="text-sm font-medium">{t("workspaceHistory")}</h3>
    <p className="text-xs text-muted-foreground">{t("bookingCreated")} · {formatDate(booking.createdAt, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })}</p>
    {history.data.pages.flatMap((page) => page.items).map((event) => <div key={event.id} className="space-y-1 text-sm"><p>{t(LABELS[event.type] ?? "historyChanged")}</p><p className="text-xs text-muted-foreground">{event.actorName || t(`actor_${["employee", "customer", "import"].includes(event.actorType ?? "") ? event.actorType : "unknown"}`)}</p><p className="text-xs text-muted-foreground">{formatDate(event.when, locale, { day: "numeric", month: "long", year: "numeric", timeZone: timezone })} · {formatTime(event.when, locale, { hour: "2-digit", minute: "2-digit", timeZone: timezone })}</p>{event.reason ? <p className="whitespace-pre-wrap break-words">{event.reason}</p> : null}{event.note ? <p className="whitespace-pre-wrap break-words text-muted-foreground">{event.note}</p> : null}</div>)}
    {history.isError ? <p role="alert" className="text-sm text-destructive">{t("errLoad")}</p> : null}
    {history.hasNextPage ? <Button variant="ghost" size="sm" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>{t("moreHistory")}</Button> : null}
    {booking.legacyDetails ? <p className="text-xs text-muted-foreground">{t("legacyDetailsHint")}</p> : null}
  </section>
}
