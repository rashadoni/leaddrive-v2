/**
 * A public booking link (/book/<slug>): GET the page and its free times, POST
 * a booking. The slug is public; what it reveals is what the organization
 * chose to publish. Rate limits come from the proxy (/api/v1/public/*).
 */
import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { runWithTenant } from "@/lib/rls-context"
import { createBooking, findBookingPageBySlug, publicBookingView } from "@/lib/booking/book"

const bookSchema = z.object({
  startsAt: z.string().max(40).refine((value) => !Number.isNaN(Date.parse(value)), "Invalid time"),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[\d\s()-]{7,24}$/, "Invalid phone"),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  note: z.string().trim().max(1000).optional(),
  // Left empty by people; filled by form-filling bots.
  website: z.string().max(200).optional(),
})

export async function GET(_req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await findBookingPageBySlug(slug)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  try {
    const view = await runWithTenant(found.orgId, () => publicBookingView(found.orgId, found.pageId))
    if (!view) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: view }, { headers: { "Cache-Control": "no-store" } })
  } catch (e) {
    console.error("[public/booking] view failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await findBookingPageBySlug(slug)
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 })
  const parsed = bookSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message, code: "INVALID" }, { status: 400 })
  if (parsed.data.website) return NextResponse.json({ error: "Invalid", code: "INVALID" }, { status: 400 })

  try {
    const result = await runWithTenant(found.orgId, () => createBooking(found.orgId, found.pageId, {
      startsAt: parsed.data.startsAt,
      name: parsed.data.name,
      phone: parsed.data.phone,
      email: parsed.data.email || null,
      note: parsed.data.note || null,
    }))
    if (result.ok) return NextResponse.json({ success: true, data: result.booking }, { status: 201 })
    if (result.reason === "not_found") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ error: "This time is taken", code: "TAKEN" }, { status: 409 })
  } catch (e) {
    console.error("[public/booking] book failed", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
