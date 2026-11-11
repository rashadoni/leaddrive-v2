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
import { bookingDb as prisma } from "./db"
import { WHATSAPP_BOOKING_SETTING } from "./whatsapp-setting"

export const BOOKING_FLOW_NAME = "leaddrive-booking-v1"
/**
 * The one screen the published form has. The agent names it in every message
 * it sends, so it lives beside the form rather than being typed twice.
 */
export const BOOKING_FLOW_SCREEN = "BOOK"

export type WhatsAppFlow = {
  id: string
  name: string
  status: string
  categories: string[]
  /**
   * What Meta refuses to publish and why, in its own words. Publishing answers
   * only «make sure a valid Flow JSON is used»; the list of what is actually
   * wrong lives on the flow itself, and without asking for it the next step is
   * guesswork (2026-11-11).
   */
  errors: string[]
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
  const url = `${WHATSAPP_GRAPH_API_BASE}/${config.businessAccountId}/flows?fields=id,name,status,categories,validation_errors&limit=50`
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
        errors: Array.isArray(item.validation_errors)
          ? item.validation_errors.map((value) => {
            const row = (value ?? {}) as Record<string, unknown>
            const where = [row.line_start, row.column_start].filter((part) => part !== undefined).join(":")
            return [row.error_type, row.message, row.pointers ? JSON.stringify(row.pointers) : "", where]
              .filter(Boolean).map((part) => String(part)).join(" · ")
          })
          : [],
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
        id: BOOKING_FLOW_SCREEN,
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
              // The name the client already told WhatsApp, pre-filled. It lives
              // on the FORM, not on the field: Meta refused `init-value` inside
              // TextInput outright — «Property 'init-value' is not allowed in
              // 'TextInput' component» — and that one line was the whole reason
              // the form would not publish (2026-11-11).
              "init-values": { client: "${data.client}" },
              children: [
                { type: "RadioButtonsGroup", name: "time", label: "Vaxt", required: true, "data-source": "${data.times}" },
                { type: "TextInput", name: "client", label: "Adınız", "input-type": "text", required: true },
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
      if (!flowId) {
        // «Flow was created, but publishing failed» — the form exists under the
        // name we asked for, and the upload and publish below are what tell us
        // WHY it was refused.
        const after = await flowsCapability(organizationId, opts)
        flowId = (after.supported ? after.booking?.id : null) ?? null
      }
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
  steps.push({
    step: "status",
    ok: published?.status === "PUBLISHED",
    detail: published
      ? [`${published.id} ${published.status}`, ...published.errors].join(" | ")
      : "not listed",
  })
  // What is published is what the agent may send. Written here and nowhere
  // else, so a form that failed to publish never becomes the thing clients
  // see — and reported as a step of its own, because a form Meta published
  // that we then failed to write down would never appear in a single chat
  // and nothing on the screen would say why.
  const remembered = await rememberBookingFlow(organizationId, published?.status === "PUBLISHED" ? published.id : null)
    .then(() => null, (error: unknown) => error instanceof Error ? error.message : "write failed")
  steps.push({ step: "remember", ok: !remembered, detail: remembered ?? (published?.status === "PUBLISHED" ? `the agent will send ${published.id}` : "no published form; the agent sends the list") })
  return { ok: published?.status === "PUBLISHED", flowId, steps }
}

/**
 * Remove the booking form from this account.
 *
 * Only a form that was never published: a published one may be open on a
 * client's phone right now, and deleting it turns that into an error they
 * cannot answer. Published forms are retired through Meta's own deprecation,
 * not from here.
 *
 * Written because a form was created on the wrong tenant (2026-11-11): the
 * screen that made it must be able to take it back, or the only way out is
 * somebody's Meta console.
 */
export async function deleteBookingFlow(
  organizationId: string,
  opts?: { channelConfigId?: string | null },
): Promise<{ ok: boolean; detail: string }> {
  const capability = await flowsCapability(organizationId, opts)
  if (!capability.supported) return { ok: false, detail: capability.detail }
  if (!capability.booking) return { ok: true, detail: "nothing to delete" }
  if (capability.booking.status === "PUBLISHED") {
    return { ok: false, detail: `the form is published (${capability.booking.id}); a published form is not deleted from here` }
  }
  const config = await resolveWhatsAppConfig(organizationId, opts?.channelConfigId ? { channelConfigId: opts.channelConfigId } : {})
  if (!config) return { ok: false, detail: "WhatsApp is not connected for this organisation" }
  try {
    const res = await fetch(`${WHATSAPP_GRAPH_API_BASE}/${capability.booking.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(20_000),
    })
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    if (res.ok) await rememberBookingFlow(organizationId, null)
    return { ok: res.ok, detail: body ? JSON.stringify(body) : `HTTP ${res.status}` }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "request failed" }
  }
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

/**
 * Remember which form this organisation may send, or forget it.
 *
 * One key in the booking setting the agent already reads, set in place: the
 * rest of that object belongs to the screen that saves the rules, and reading
 * it and writing it back around them is how template names were lost once
 * (2026-11-10).
 */
/**
 * Stop sending the form, leaving it on the account.
 *
 * The way back for a number whose form misbehaves: Meta will not let a
 * published form be deleted, so forgetting it is the only thing the screen
 * can do, and the agent falls back to the list of times it sent before.
 */
export async function forgetBookingFlow(organizationId: string): Promise<void> {
  await rememberBookingFlow(organizationId, null)
}

async function rememberBookingFlow(organizationId: string, flowId: string | null): Promise<void> {
  // The inner set makes sure the key exists before the outer one writes into
  // it: `jsonb_set` on a path whose parent is missing changes nothing at all,
  // and a number that published a form before its booking card was ever saved
  // would have kept the form a secret.
  await prisma.$executeRawUnsafe(
    `UPDATE organizations SET settings = jsonb_set(
       jsonb_set(
         COALESCE(settings::jsonb, '{}'::jsonb),
         '{${WHATSAPP_BOOKING_SETTING}}',
         COALESCE(CASE WHEN jsonb_typeof(settings::jsonb -> '${WHATSAPP_BOOKING_SETTING}') = 'object'
                       THEN settings::jsonb -> '${WHATSAPP_BOOKING_SETTING}' END, '{}'::jsonb),
         true),
       '{${WHATSAPP_BOOKING_SETTING},flowId}', $2::jsonb, true)
     WHERE id = $1`,
    organizationId, JSON.stringify(flowId),
  )
}

/**
 * A form submitted in WhatsApp, read as the tap it is.
 *
 * Meta delivers it as an ordinary incoming message whose `interactive` holds
 * `nfm_reply` — not `list_reply` — so a webhook that only knows tapped rows
 * sees a message with no words in it and hands the client to a ticket. What
 * comes back is the row the client picked (the same id the menu row carries,
 * so one handler answers both) and the name they typed, which beats the name
 * WhatsApp knows them by: in a salon the phone belongs to one person and the
 * appointment often to another.
 */
export function flowTap(interactive: unknown): { replyId: string; name: string | null } | null {
  if (!interactive || typeof interactive !== "object") return null
  const reply = (interactive as { nfm_reply?: unknown }).nfm_reply
  if (!reply || typeof reply !== "object") return null
  const submitted = readFlowReply((reply as { response_json?: unknown }).response_json)
  if (!submitted) return null
  return { replyId: submitted.time, name: submitted.client || null }
}
