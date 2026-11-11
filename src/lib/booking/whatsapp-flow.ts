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

/**
 * The form itself, in Meta's own schema.
 *
 * One screen, because a salon's client answers one question: which time. The
 * times are not in this JSON — they are handed to the screen when the message
 * is sent (`data.times`), so one published form serves every service, every
 * master and every day.
 *
 * Version 7.2 is the floor Meta's own tooling accepts; a published form keeps
 * working as the schema moves, which is why the version lives here, next to
 * the screen it describes, and not in a setting somebody forgets.
 */
export function bookingFlowJson(): Record<string, unknown> {
  return {
    version: "7.2",
    screens: [
      {
        id: "BOOK",
        title: "Yazılış",
        terminal: true,
        data: {
          service: { type: "string", __example__: "Saç kəsimi, 45 dəq" },
          times: {
            type: "array",
            items: {
              type: "object",
              properties: { id: { type: "string" }, title: { type: "string" }, description: { type: "string" } },
            },
            __example__: [{ id: "1", title: "14:00", description: "Leyla" }],
          },
          client: { type: "string", __example__: "" },
        },
        layout: {
          type: "SingleColumnLayout",
          children: [
            { type: "TextBody", text: "${data.service}" },
            {
              type: "Form",
              name: "booking",
              children: [
                { type: "RadioButtonsGroup", name: "time", label: "Vaxt", required: true, "data-source": "${data.times}" },
                { type: "TextInput", name: "client", label: "Adınız", "input-type": "text", required: true, "init-value": "${data.client}" },
                {
                  type: "Footer",
                  label: "Təsdiqlə",
                  "on-click-action": { name: "complete", payload: { time: "${form.time}", client: "${form.client}" } },
                },
              ],
            },
          ],
        },
      },
    ],
  }
}

export type FlowSetupStep = { step: string; ok: boolean; detail: string }

/**
 * Create the booking form on this number's account and publish it, reporting
 * every step in Meta's own words.
 *
 * Nothing here is taken on faith: Meta's create call is documented in several
 * mutually contradicting ways, so the single-call form is tried first and the
 * older create → upload → publish sequence second, and whichever answered is
 * written down. A setup that fails silently is how a feature ships against an
 * account that never had it.
 */
export async function ensureBookingFlow(
  organizationId: string,
  opts?: { channelConfigId?: string | null },
): Promise<{ ok: boolean; flowId: string | null; steps: FlowSetupStep[] }> {
  const steps: FlowSetupStep[] = []
  const capability = await flowsCapability(organizationId, opts)
  if (!capability.supported) {
    steps.push({ step: "capability", ok: false, detail: capability.detail })
    return { ok: false, flowId: null, steps }
  }
  const config = await resolveWhatsAppConfig(organizationId, opts?.channelConfigId ? { channelConfigId: opts.channelConfigId } : {})
  if (!config?.businessAccountId) {
    steps.push({ step: "capability", ok: false, detail: "no businessAccountId" })
    return { ok: false, flowId: null, steps }
  }
  const auth = { Authorization: `Bearer ${config.accessToken}` }
  const json = JSON.stringify(bookingFlowJson())
  const say = async (response: Response) => {
    const body = await response.json().catch(() => null) as Record<string, unknown> | null
    return { body, text: body ? JSON.stringify(body) : `HTTP ${response.status}` }
  }

  let flowId = capability.booking?.id ?? null
  if (!flowId) {
    // One call, the way the current documentation describes it.
    const once = await fetch(`${WHATSAPP_GRAPH_API_BASE}/${config.businessAccountId}/flows`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ name: BOOKING_FLOW_NAME, categories: ["APPOINTMENT_BOOKING"], flow_json: json, publish: true }),
      signal: AbortSignal.timeout(20_000),
    }).catch((error: unknown) => error instanceof Error ? error : new Error("request failed"))
    if (once instanceof Error) {
      steps.push({ step: "create", ok: false, detail: once.message })
    } else {
      const said = await say(once)
      flowId = typeof said.body?.id === "string" ? said.body.id : null
      steps.push({ step: "create", ok: once.ok && Boolean(flowId), detail: said.text })
    }
  } else {
    steps.push({ step: "create", ok: true, detail: `already exists: ${flowId}` })
  }
  if (!flowId) return { ok: false, flowId: null, steps }

  // The older sequence: upload the screens, then publish. Harmless when the
  // single call already did both — Meta answers that the form is published.
  const form = new FormData()
  form.set("asset_type", "FLOW_JSON")
  form.set("name", "flow.json")
  form.set("file", new Blob([json], { type: "application/json" }), "flow.json")
  const upload = await fetch(`${WHATSAPP_GRAPH_API_BASE}/${flowId}/assets`, { method: "POST", headers: auth, body: form, signal: AbortSignal.timeout(20_000) })
    .catch((error: unknown) => error instanceof Error ? error : new Error("request failed"))
  steps.push(upload instanceof Error
    ? { step: "upload", ok: false, detail: upload.message }
    : { step: "upload", ok: upload.ok, detail: (await say(upload)).text })

  const publish = await fetch(`${WHATSAPP_GRAPH_API_BASE}/${flowId}/publish`, { method: "POST", headers: auth, signal: AbortSignal.timeout(20_000) })
    .catch((error: unknown) => error instanceof Error ? error : new Error("request failed"))
  steps.push(publish instanceof Error
    ? { step: "publish", ok: false, detail: publish.message }
    : { step: "publish", ok: publish.ok, detail: (await say(publish)).text })

  const after = await flowsCapability(organizationId, opts)
  const published = after.supported ? after.booking : null
  steps.push({ step: "status", ok: published?.status === "PUBLISHED", detail: published ? `${published.id} ${published.status}` : "not listed" })
  return { ok: published?.status === "PUBLISHED", flowId, steps }
}

/**
 * What a client sent back from the form.
 *
 * Meta puts everything in one string — `interactive.nfm_reply.response_json` —
 * and the token we issued is inside it, not beside it. A submission that does
 * not parse, or that names no time, is not a booking: it is read as nothing,
 * and the message takes the ordinary path.
 */
export function readFlowReply(responseJson: unknown): { token: string | null; time: string; client: string } | null {
  if (typeof responseJson !== "string" || !responseJson.trim()) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(responseJson)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const value = parsed as Record<string, unknown>
  const time = typeof value.time === "string" ? value.time.trim() : ""
  if (!time) return null
  return {
    token: typeof value.flow_token === "string" && value.flow_token ? value.flow_token : null,
    time,
    client: typeof value.client === "string" ? value.client.trim() : "",
  }
}
