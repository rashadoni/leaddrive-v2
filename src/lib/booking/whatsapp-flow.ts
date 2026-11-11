/**
 * Whether this number can show a FORM inside WhatsApp, and which ones it has.
 *
 * WhatsApp Flows is Meta's form: the client taps a button in the chat and a
 * native sheet opens with dropdowns, a day to pick and a time to tap — the
 * thing three quick-reply buttons and a ten-row list cannot be (owner,
 * 2026-11-11, having seen what a competitor's reel pretends to do).
 *
 * This module asks one question and answers it honestly, because the answer
 * is not in anybody's documentation: the salon's number runs in coexistence
 * (the WhatsApp Business app and the Cloud API on one number), and Meta lists
 * what coexistence takes away — groups, calls, the catalog — without saying a
 * word about Flows. So we ask the number itself before a line of the form is
 * written. A capability nobody can confirm is a capability you measure.
 */
import { resolveWhatsAppConfig, WHATSAPP_GRAPH_API_BASE } from "@/lib/whatsapp"

export const BOOKING_FLOW_NAME = "leaddrive-booking-v1"

export type WhatsAppFlow = {
  id: string
  name: string
  status: string
  categories: string[]
}

export type FlowsCapability =
  /** The number can hold Flows; `flows` is what it holds today. */
  | { supported: true; flows: WhatsAppFlow[]; booking: WhatsAppFlow | null }
  /**
   * It cannot, and why in Meta's own words. `reason` is for the screen,
   * `detail` for the person who has to act on it.
   */
  | { supported: false; reason: "no-channel" | "no-business-account" | "refused"; detail: string }

/**
 * Meta answers a request for a product the account does not have with an
 * ordinary error, not with an empty list, so «supported» means exactly one
 * thing: the account answered with a list of Flows.
 */
export async function flowsCapability(
  organizationId: string,
  opts?: { channelConfigId?: string | null },
): Promise<FlowsCapability> {
  const config = await resolveWhatsAppConfig(organizationId, opts?.channelConfigId ? { channelConfigId: opts.channelConfigId } : {})
  if (!config) return { supported: false, reason: "no-channel", detail: "WhatsApp is not connected for this organisation" }
  if (!config.businessAccountId) {
    return { supported: false, reason: "no-business-account", detail: "the channel has no businessAccountId; set it in /settings/channels/whatsapp" }
  }
  const url = `${WHATSAPP_GRAPH_API_BASE}/${config.businessAccountId}/flows?fields=id,name,status,categories&limit=50`
  try {
    const res = await fetch(url, { headers: { Authorization: `Bearer ${config.accessToken}` }, signal: AbortSignal.timeout(15_000) })
    const data = await res.json().catch(() => null) as { data?: unknown[]; error?: { message?: string; code?: number } } | null
    if (!res.ok || !Array.isArray(data?.data)) {
      return { supported: false, reason: "refused", detail: data?.error?.message ?? `HTTP ${res.status}` }
    }
    const flows: WhatsAppFlow[] = data.data.map((row) => {
      const item = (row ?? {}) as Record<string, unknown>
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? ""),
        status: String(item.status ?? ""),
        categories: Array.isArray(item.categories) ? item.categories.map((value) => String(value)) : [],
      }
    }).filter((flow) => flow.id)
    return { supported: true, flows, booking: flows.find((flow) => flow.name === BOOKING_FLOW_NAME) ?? null }
  } catch (error) {
    return { supported: false, reason: "refused", detail: error instanceof Error ? error.message : "request failed" }
  }
}
