import { NextRequest, NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { bookingAccess } from "@/lib/booking/access"
import { orgHasModule } from "@/lib/api-auth"
import { checkPermission } from "@/lib/permissions"
import { customerPhonesHiddenFrom } from "@/lib/customer-phone-privacy"
import { searchBookingClients } from "@/lib/booking/client-search"

/**
 * The customers the staff booking panel offers while a name or a number is
 * typed. It answers out of two modules at once, so — exactly as the command
 * palette does — a person from whom CRM (or Sales) was hidden finds neither
 * here: this path belongs to bookings and no module gate of theirs runs on it.
 */
export const GET = withRlsAuth("bookings", "read", async (req: NextRequest, auth) => {
  const access = await bookingAccess(auth)
  if (access instanceof NextResponse) return access

  const hidden = new Set(auth.hiddenModules ?? [])
  const [crm, sales] = await Promise.all([
    hidden.has("crm") ? Promise.resolve(false) : orgHasModule(auth.orgId, "crm"),
    hidden.has("sales") ? Promise.resolve(false) : orgHasModule(auth.orgId, "sales"),
  ])

  const items = await searchBookingClients({
    orgId: auth.orgId,
    userId: auth.userId,
    role: auth.role,
    query: req.nextUrl.searchParams.get("q") ?? "",
    contacts: crm && checkPermission(auth.role, "contacts", "read"),
    leads: sales && checkPermission(auth.role, "leads", "read"),
    phonesHidden: customerPhonesHiddenFrom(auth),
  })

  return NextResponse.json({ success: true, data: { items } }, { headers: { "Cache-Control": "private, no-store" } })
})
