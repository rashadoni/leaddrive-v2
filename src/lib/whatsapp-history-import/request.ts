/**
 * Ask Meta for a coexistence number's contacts and chat history.
 *
 * Meta's rules, verbatim from «Onboarding WhatsApp Business app users»: «you have 24 hours to
 * synchronize their contacts and messaging history, otherwise they must be offboarded and they must
 * complete the flow again», and for each of the two requests «You can only perform this step once».
 * Contacts are step 1 and history step 2, and that is the order used here. An accepted request only
 * means Meta took it — «it does not indicate whether the business shared their messaging history» —
 * the answer comes later as webhooks (lib/whatsapp-history-import/import).
 *
 * So the request is made once, right after the number is connected, and its outcome is kept on the
 * channel (`settings.historyImport`) as the evidence: the `request_id` Meta asks to keep for support,
 * or the refusal in Meta's words. A refused request may be asked again inside the 24 hours; an
 * accepted one never is.
 */
import { prisma } from "@/lib/prisma"
import { redactOAuthProviderText } from "@/lib/oauth-redaction"

export const HISTORY_IMPORT_SETTING = "historyImport"
export const SYNC_WINDOW_MS = 24 * 3600_000

/** The version coexistence was published under; overridable without a release. */
function syncGraph(): string {
  const version = process.env.WHATSAPP_COEXISTENCE_SYNC_GRAPH_VERSION?.trim() || "v23.0"
  return `https://graph.facebook.com/${/^v\d+\.\d+$/.test(version) ? version : "v23.0"}`
}

export type SyncKind = "contacts" | "history"
const SYNC_TYPE: Record<SyncKind, string> = { contacts: "smb_app_state_sync", history: "history" }

export type SyncRequestRecord = {
  requestedAt: string
  requestId?: string
  error?: string
  errorCode?: number
}
export type HistoryImportSetting = { contacts?: SyncRequestRecord; history?: SyncRequestRecord }

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function readHistoryImportSetting(settings: unknown): HistoryImportSetting {
  const raw = rec(rec(settings)[HISTORY_IMPORT_SETTING])
  const one = (value: unknown): SyncRequestRecord | undefined => {
    const r = rec(value)
    return typeof r.requestedAt === "string" ? r as SyncRequestRecord : undefined
  }
  return { contacts: one(raw.contacts), history: one(raw.history) }
}

/** Inside Meta's 24 hours after the number was connected? */
export function insideSyncWindow(settings: unknown, now: Date = new Date()): boolean {
  const onboardedAt = Date.parse(String(rec(settings).onboardedAt ?? ""))
  return Number.isFinite(onboardedAt) && now.getTime() - onboardedAt < SYNC_WINDOW_MS && now.getTime() >= onboardedAt - 60_000
}

async function askMeta(phoneNumberId: string, token: string, kind: SyncKind): Promise<SyncRequestRecord> {
  const requestedAt = new Date().toISOString()
  try {
    const res = await fetch(`${syncGraph()}/${phoneNumberId}/smb_app_data`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", sync_type: SYNC_TYPE[kind] }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = rec(await res.json().catch(() => ({})))
    const error = rec(json.error)
    if (res.ok && !json.error) {
      return { requestedAt, ...(typeof json.request_id === "string" ? { requestId: json.request_id } : { requestId: "accepted" }) }
    }
    return {
      requestedAt,
      error: redactOAuthProviderText(String(error.error_user_msg || error.message || `HTTP ${res.status}`)).slice(0, 300),
      ...(typeof error.code === "number" ? { errorCode: error.code } : {}),
    }
  } catch (err) {
    return { requestedAt, error: redactOAuthProviderText(String((err as Error)?.message || err)).slice(0, 300) }
  }
}

/**
 * Request what is still to be requested, contacts first, and record the outcome on the channel.
 * A kind that already has an accepted request is never asked for again.
 */
export async function requestCoexistenceSync(input: {
  organizationId: string
  channelConfigId: string
  phoneNumberId: string
  token: string
  /** Start over: a fresh onboarding is a fresh 24 hours, and Meta takes one request of each again. */
  fresh?: boolean
}): Promise<HistoryImportSetting> {
  const row = await prisma.channelConfig.findFirst({
    where: { id: input.channelConfigId, organizationId: input.organizationId },
    select: { settings: true },
  })
  const before = input.fresh ? {} : readHistoryImportSetting(row?.settings)
  const next: HistoryImportSetting = { ...before }
  for (const kind of ["contacts", "history"] as const) {
    if (before[kind]?.requestId) continue
    next[kind] = await askMeta(input.phoneNumberId, input.token, kind)
  }
  // Read again before writing: the request took seconds, and settings may have moved meanwhile.
  const latest = await prisma.channelConfig.findFirst({
    where: { id: input.channelConfigId, organizationId: input.organizationId },
    select: { settings: true },
  })
  await prisma.channelConfig.update({
    where: { id: input.channelConfigId },
    data: { settings: { ...rec(latest?.settings), [HISTORY_IMPORT_SETTING]: next } as never },
  })
  console.log(
    `[WA History] smb_app_data channel=${input.channelConfigId}`
    + ` contacts=${next.contacts?.requestId ? "accepted" : next.contacts?.error ? `refused(${next.contacts.errorCode ?? "?"})` : "-"}`
    + ` history=${next.history?.requestId ? "accepted" : next.history?.error ? `refused(${next.history.errorCode ?? "?"})` : "-"}`,
  )
  return next
}
