import type { Booking, Prisma } from "@prisma/client"
import { z } from "zod"
import { appendDomainEvent, eventProducerVersion } from "@/lib/event-platform/append"

const types = ["imported", "created", "rescheduled", "cancelled", "completed", "no_show", "outcome_corrected"] as const
export type BookingEvent = (typeof types)[number]
const eventData = z.object({
  bookingId: z.string().min(1), hostUserId: z.string().min(1),
  startsAt: z.string().datetime(), endsAt: z.string().datetime(),
  status: z.enum(["confirmed", "cancelled", "completed", "no_show"]),
  actorUserId: z.string().nullable(), actorType: z.enum(["employee", "customer", "import"]), imported: z.boolean(),
}).strict()

/** Only structural facts enter the immutable ledger; notes and contact details stay in Booking. */
export async function appendBookingEvent(tx: Prisma.TransactionClient, row: Booking, type: BookingEvent, actorUserId: string | null) {
  if (!types.includes(type)) throw new TypeError("Unknown booking event")
  const data = eventData.parse({ bookingId: row.id, hostUserId: row.hostUserId, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), status: row.status, actorUserId, actorType: type === "imported" ? "import" : actorUserId ? "employee" : "customer", imported: type === "imported" })
  const result = await appendDomainEvent(tx, {
    organizationId: row.organizationId, domain: "sales", aggregateType: "booking", aggregateId: row.id,
    expectedVersion: row.version, eventType: `sales.booking-${type.replaceAll("_", "-")}.v1`,
    source: "/booking", dataSchema: `urn:leaddrive:schema:sales.booking-${type.replaceAll("_", "-")}:v1`,
    classification: "confidential", producer: "booking-commands", producerVersion: eventProducerVersion(), data,
  })
  return { eventId: result.eventId, version: Number(result.aggregateVersion) }
}

export async function ensureBookingBaseline(tx: Prisma.TransactionClient, row: Booking) {
  if (row.version > 0) return row
  const event = await appendBookingEvent(tx, row, "imported", null)
  return tx.booking.update({ where: { id: row.id }, data: { version: event.version, source: "legacy" } })
}
