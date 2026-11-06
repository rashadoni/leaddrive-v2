/**
 * Owner's queue task 10 (client through the owner, 2026-11-06: «если был отказ
 * из-за того, что не было на складе — режим ожидания и перезванивал той же
 * аптеке сам в определённые времена»; owner: «рабочее время, когда может
 * звонить, — в настройках VoIP»). When products a pharmacy waited for are in
 * stock again, the line's AI calls that pharmacy back, names them, and takes
 * the order as on an incoming call.
 *
 * Off unless the order organization's settings say
 * `pharmacyPhoneOrders.waitlistCallback.enabled: true`; with `testPhoneE164`
 * every callback goes to that number instead of the pharmacy's (the owner's
 * first calls). One callback at a time on the line's channel, only inside the
 * organization's voice calling hours (business hours, channel "voice"), one
 * call per pharmacy per arrival: a placed or failed callback is not repeated.
 *
 * The call is an ordinary outbound AI call of the line's channel; its CallLog
 * carries the marker below in consentAudit, and the line's pilot
 * (zeytun-inbound-pilot.ts) takes only such an outbound call: the pharmacy is
 * the marker's, the opening names what arrived.
 */
import { randomUUID } from "node:crypto"
import type { PrismaClient } from "@prisma/client"

import { decryptForTenantBound } from "../../crypto/tenant-pii-encryption"
import { evaluateBusinessHours, isValidTimeZone } from "../../inbox/business-hours"
import { runWithTenant } from "../../rls-context"
import { PHONE_ORDERS_TABLE } from "./phone-orders"
import { listWaitlist } from "./zeytun-waitlist"

export const CALLBACK_MARKER = "pharmacyWaitlistCallback"
/** Only products back within this long are called about: older news the pharmacy hears on its next call. */
export const CALLBACK_ARRIVED_WITHIN_MS = 48 * 3_600_000
/** A callback names at most this many products; the rest the agent finds when asked. */
export const CALLBACK_ITEMS_MAX = 3
/** An outbound AI call of the channel younger than this, not ended, is in progress: no second one. */
const ACTIVE_CALL_MS = 20 * 60_000

export type CallbackSettings = { enabled: boolean; testPhoneE164: string | null }
export function waitlistCallbackSettings(settings: unknown): CallbackSettings {
  const orders = (settings as { pharmacyPhoneOrders?: { waitlistCallback?: { enabled?: unknown; testPhoneE164?: unknown } } } | null)
    ?.pharmacyPhoneOrders?.waitlistCallback
  const test = typeof orders?.testPhoneE164 === "string" && /^\+994\d{9}$/.test(orders.testPhoneE164) ? orders.testPhoneE164 : null
  return { enabled: orders?.enabled === true, testPhoneE164: test }
}

export type CallbackMarker = { version: 1; providerCallId: string; grantId: string; orderOrganizationId: string
  pharmacyName: string | null; pharmacyGuid: string | null; items: { externalId: string; name: string }[]; test: boolean }

export function callbackMarker(audit: unknown, providerCallId: string): CallbackMarker | null {
  const marker = (audit as Record<string, unknown> | null)?.[CALLBACK_MARKER] as Partial<CallbackMarker> | undefined
  if (!marker || marker.version !== 1 || marker.providerCallId !== providerCallId || typeof marker.grantId !== "string"
    || typeof marker.orderOrganizationId !== "string" || !Array.isArray(marker.items) || !marker.items.length) return null
  return marker as CallbackMarker
}

/** What the pharmacy hears first: who calls, what it asked for is in stock, whether to order. */
export function callbackOpening(marker: Pick<CallbackMarker, "pharmacyName" | "items">): string {
  const names = marker.items.map(item => item.name).join(", ")
  return `Salam! Zeytun Pharmaceuticals-dan zəng edirəm${marker.pharmacyName ? `, ${marker.pharmacyName} apteki ilə danışıram?` : "."}`
    + ` Siz soruşmuşdunuz: ${names} — artıq anbarımızdadır. Sifariş etmək istərdinizmi?`
}

/** For the line's prompt: the callback's facts, as data. */
export function callbackNote(marker: CallbackMarker): string {
  return `<callback>\nThis call is OUTBOUND: Zeytun calls the pharmacy back because products it asked for while they were sold out are in stock now: ${
    marker.items.map(item => item.name).join("; ")}. The opening already said so. If they want them, search each and take the order as usual; `
    + "if they do not, thank them and say the closing sentence. Never insist, never call back yourself.\n</callback>"
}

export type CallbackGroup = { key: string; orderId: string; pharmacyName: string | null; pharmacyGuid: string | null
  rows: string[]; items: { externalId: string; name: string }[] }

/** The pharmacy whose waited-for products came back first, not yet called about. */
export async function dueCallbackGroup(db: PrismaClient, organizationId: string, now = new Date()): Promise<CallbackGroup | null> {
  const listed = (await listWaitlist(db, organizationId)).filter(row => row.state === "arrived" && row.orderId
    && row.arrivedAt && now.getTime() - Date.parse(row.arrivedAt) <= CALLBACK_ARRIVED_WITHIN_MS)
  if (!listed.length) return null
  const fresh = await runWithTenant(organizationId, () => db.pharmacyWaitlistItem.findMany({
    where: { organizationId, id: { in: listed.map(row => row.id) }, callbackAt: null },
    select: { id: true, externalId: true, productName: true, pharmacyGuid: true, pharmacyName: true, companyId: true, orderId: true, arrivedAt: true },
    orderBy: { arrivedAt: "asc" },
  }))
  const first = fresh[0]
  if (!first?.orderId) return null
  const key = first.pharmacyGuid ?? first.companyId ?? first.orderId
  const same = fresh.filter(row => (row.pharmacyGuid ?? row.companyId ?? row.orderId) === key)
  const items = same.filter((row, index) => same.findIndex(other => other.externalId === row.externalId) === index)
  return { key, orderId: first.orderId, pharmacyName: first.pharmacyName, pharmacyGuid: first.pharmacyGuid, rows: same.map(row => row.id),
    items: items.slice(0, CALLBACK_ITEMS_MAX).map(row => ({ externalId: row.externalId, name: row.productName })) }
}

export type CallbackPlacement = { status: "off" | "outside_hours" | "busy" | "nothing_due" | "no_phone" | "no_channel" | "placed" | "failed"
  providerCallId?: string; items?: number }

export type CallbackChannel = { id: string; configName: string | null; phoneNumber: string | null; apiKey: string | null; settings: unknown }
export type CallbackDeps = {
  db: PrismaClient
  now?: Date
  /** The line's grant: its organization, channel and order organization. */
  grant: { id: string; organizationId: string; channelConfigId: string; orderOrganizationId: string }
  /** Places the AI call on the channel (getVoipProvider(...).initiateCall with voiceAgent). */
  dial: (input: { channel: CallbackChannel; toNumber: string; correlationId: string })
    => Promise<{ success: boolean; error?: string }>
}

export async function placeWaitlistCallback(deps: CallbackDeps): Promise<CallbackPlacement> {
  const { db, grant } = deps
  const now = deps.now ?? new Date()
  const org = await db.organization.findUnique({ where: { id: grant.orderOrganizationId }, select: { settings: true } })
  const settings = waitlistCallbackSettings(org?.settings)
  if (!settings.enabled) return { status: "off" }
  const hours = await runWithTenant(grant.organizationId, () => db.businessHours.findFirst({
    where: { organizationId: grant.organizationId, channelType: "voice", isActive: true },
    select: { id: true, timezone: true, schedule: true, holidays: true, isActive: true } }))
  // As for an AI call to a lead (manual-lead-call.ts): hours that are missing or say nothing are closed,
  // never the helper's fail-open default for inbox auto-away.
  const open = hours?.timezone && isValidTimeZone(hours.timezone) ? evaluateBusinessHours(hours, now) : null
  if (!open?.open || (open.reason !== "inside_hours" && open.reason !== "holiday_hours")) return { status: "outside_hours" }
  const active = await runWithTenant(grant.organizationId, () => db.callLog.count({ where: { organizationId: grant.organizationId,
    channelConfigId: grant.channelConfigId, direction: "outbound", callMode: "ai", endedAt: null,
    createdAt: { gte: new Date(now.getTime() - ACTIVE_CALL_MS) } } }))
  if (active) return { status: "busy" }
  const group = await dueCallbackGroup(db, grant.orderOrganizationId, now)
  if (!group) return { status: "nothing_due" }
  const order = await runWithTenant(grant.orderOrganizationId, () => db.pharmacyPhoneOrder.findFirst({
    where: { id: group.orderId, organizationId: grant.orderOrganizationId }, select: { callerPhone: true } }))
  const phone = settings.testPhoneE164 ?? (order ? decryptForTenantBound(grant.orderOrganizationId, PHONE_ORDERS_TABLE, "callerPhone", order.callerPhone) : null)
  const markRows = (status: "placed" | "failed", callId: string) => runWithTenant(grant.orderOrganizationId, () => db.pharmacyWaitlistItem.updateMany({
    where: { organizationId: grant.orderOrganizationId, id: { in: group.rows }, callbackAt: null },
    data: { callbackAt: now, callbackCallId: callId, callbackStatus: status } }))
  if (!phone || !/^\+\d{8,15}$/.test(phone)) {
    await markRows("failed", "no_phone")
    return { status: "no_phone" }
  }
  const channel = await runWithTenant(grant.organizationId, () => db.channelConfig.findFirst({
    where: { id: grant.channelConfigId, organizationId: grant.organizationId, channelType: "voip", isActive: true },
    select: { id: true, configName: true, phoneNumber: true, apiKey: true, settings: true } })) as CallbackChannel | null
  if (!channel) return { status: "no_channel" }
  const providerCallId = randomUUID()
  const marker: CallbackMarker = { version: 1, providerCallId, grantId: grant.id, orderOrganizationId: grant.orderOrganizationId,
    pharmacyName: group.pharmacyName, pharmacyGuid: group.pharmacyGuid, items: group.items, test: settings.testPhoneE164 !== null }
  // The record first: the station asks the CRM about this call the moment it is answered.
  await runWithTenant(grant.organizationId, () => db.callLog.create({ data: {
    organizationId: grant.organizationId, channelConfigId: channel.id, provider: "asterisk", providerCallId, direction: "outbound",
    callMode: "ai", status: "initiated", fromNumber: channel.phoneNumber ?? "", toNumber: phone, targetPhoneE164: phone,
    consentAudit: { [CALLBACK_MARKER]: marker } } }))
  await markRows("placed", providerCallId)
  const placed = await deps.dial({ channel, toNumber: phone, correlationId: providerCallId }).catch(() => ({ success: false }))
  if (!placed.success) {
    await runWithTenant(grant.orderOrganizationId, () => db.pharmacyWaitlistItem.updateMany({
      where: { organizationId: grant.orderOrganizationId, callbackCallId: providerCallId }, data: { callbackStatus: "failed" } }))
    await runWithTenant(grant.organizationId, () => db.callLog.updateMany({ where: { organizationId: grant.organizationId, providerCallId },
      data: { status: "failed", endedAt: now } }))
    return { status: "failed", providerCallId }
  }
  return { status: "placed", providerCallId, items: group.items.length }
}
