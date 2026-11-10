import { redirect } from "next/navigation"
import { BOOKING_WORKSPACE_ENABLED } from "@/lib/booking/release-phase"
import { Suspense } from "react"
import { BookingWorkspace } from "@/components/booking/booking-workspace"

/**
 * The section's four screens are four addresses now (/meetings, …/services,
 * …/whatsapp, …/team). Links shared or bookmarked while they were tabs still
 * carry `?tab=pages` and `?tab=team`, so those are sent on rather than quietly
 * opening the day.
 */
export default async function MeetingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  if (!BOOKING_WORKSPACE_ENABLED) redirect("/tasks")
  const { tab } = await searchParams
  if (tab === "pages") redirect("/meetings/services")
  if (tab === "team") redirect("/meetings/team")
  return <Suspense><BookingWorkspace section="meetings" /></Suspense>
}
