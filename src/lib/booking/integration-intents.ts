import { randomUUID } from "node:crypto"
import type { Booking, Prisma } from "@prisma/client"
import { enqueueEffect } from "@/lib/event-platform/effects"

/** Effects contain only scoped record references, never client PII or cancel capabilities. */
export async function queueBookingEffects(tx: Prisma.TransactionClient, row: Booking, eventId: string, options: { customerNotice?: boolean; secretId?: string } = {}) {
  const common = { organizationId: row.organizationId, sourceEventId: eventId, mode: "live" as const }
  const payload = { bookingId: row.id, version: row.version, secretId: options.secretId ?? null }
  await enqueueEffect(tx, { ...common, effectType: "booking.project", effectKey: `${row.id}:${row.version}`, destination: "crm", payload })
  await ensureLegacyBinding(tx, row)
  const bindings = await tx.bookingIntegrationBinding.findMany({ where: { organizationId: row.organizationId, bookingId: row.id } })
  const active = row.status !== "cancelled"
  const account = active ? await tx.account.findFirst({ where: { userId: row.hostUserId, provider: { in: ["google-calendar", "google"] } }, select: { id: true, providerAccountId: true }, orderBy: { provider: "asc" } }) : null
  let matching = bindings.find((binding) => binding.hostUserId === row.hostUserId && binding.accountId === account?.id && binding.desiredState === "present")
  if (account && !matching && row.status === "confirmed" && row.startsAt > new Date() && row.source !== "legacy") {
    const generation = randomUUID()
    matching = await tx.bookingIntegrationBinding.create({ data: { organizationId: row.organizationId, bookingId: row.id, hostUserId: row.hostUserId, accountId: account.id, calendarId: "primary", generation, providerEventId: generation.replaceAll("-", ""), desiredVersion: row.version } })
    bindings.push(matching)
  }
  for (const binding of bindings) {
    const desiredState = active && binding.id === matching?.id ? "present" : "absent"
    await tx.bookingIntegrationBinding.update({ where: { id: binding.id }, data: { desiredState, desiredVersion: row.version, ...(binding.state !== "reconciliation_required" ? { state: "pending" } : {}) } })
    await enqueueEffect(tx, { ...common, effectType: "booking.calendar", effectKey: `${binding.id}:${row.version}`, destination: binding.id, payload: { ...payload, bindingId: binding.id } })
  }
  await enqueueEffect(tx, { ...common, effectType: "booking.notify", effectKey: `${row.id}:${row.version}`, destination: row.hostUserId, payload })
  await enqueueEffect(tx, { ...common, effectType: "booking.push", effectKey: `${row.id}:${row.version}`, destination: row.hostUserId, payload })
  await enqueueEffect(tx, { ...common, effectType: "booking.host-email", effectKey: `${row.id}:${row.version}`, destination: row.hostUserId, payload })
  if (options.customerNotice && row.email) await enqueueEffect(tx, { ...common, effectType: "booking.email", effectKey: `${row.id}:${row.version}`, destination: "customer", payload })
}


export async function ensureLegacyBinding(tx: Prisma.TransactionClient, row: Booking) {
  if (!row.googleEventId) return
  const existing = await tx.bookingIntegrationBinding.findFirst({ where: { organizationId: row.organizationId, bookingId: row.id, providerEventId: row.googleEventId } })
  if (existing) return
  const account = await tx.account.findFirst({ where: { userId: row.hostUserId, provider: { in: ["google-calendar", "google"] } }, select: { id: true }, orderBy: { provider: "asc" } })
  await tx.bookingIntegrationBinding.create({ data: { organizationId: row.organizationId, bookingId: row.id, hostUserId: row.hostUserId, accountId: account?.id ?? "unavailable", generation: "legacy", providerEventId: row.googleEventId, desiredVersion: row.version, desiredState: row.status === "cancelled" ? "absent" : "present" } })
}
