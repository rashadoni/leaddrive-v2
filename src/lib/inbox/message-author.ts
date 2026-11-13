/**
 * Who wrote an outbound message, for the badge under it in the inbox thread.
 *
 * Three honest answers and one fallback (owner 2026-11-13: «мы должны знать, кто отвечал
 * клиентам», after «Müəllif qeydə alınmayıb» under a reply typed in the Instagram app was read as
 * «something failed to save»):
 *   • the AI;
 *   • a person in the CRM — the name of whoever was signed in when it was sent;
 *   • the platform's own app on a phone (lib/inbox/meta-dm-app-echo, whatsapp-app-echo). Meta
 *     reports only the account, never which person held the phone, so this says WHERE it was
 *     written instead of pretending to know WHO;
 *   • unknown — rows older than any of the above.
 */
export type MessageAuthor =
  | { kind: "ai" }
  | { kind: "app"; app: string }
  | { kind: "person"; name: string }
  | { kind: "operator" }
  | { kind: "unknown" }

/** A message's stored metadata — any shape; only the keys below are read. */
export type MessageAuthorMetadata = Record<string, unknown> | null | undefined

/** The app a team answers from on each platform — Messenger, not "Facebook", is what they open. */
const APP_BY_CHANNEL: Record<string, string> = {
  instagram: "Instagram",
  facebook: "Messenger",
  whatsapp: "WhatsApp Business",
}

export function messageAuthor(metadata: MessageAuthorMetadata, channelType: string | null | undefined): MessageAuthor {
  const meta = metadata ?? {}
  if (meta.aiAutoReply === true || meta.aiGenerated === true || meta.authorType === "ai") return { kind: "ai" }
  if (meta.sentFromBusinessApp === true || meta.source === "business_app") {
    const channel = (channelType ?? "").toLowerCase()
    return { kind: "app", app: APP_BY_CHANNEL[channel] ?? (channel ? channel[0].toUpperCase() + channel.slice(1) : "") }
  }
  if (typeof meta.authorName === "string" && meta.authorName.trim()) return { kind: "person", name: meta.authorName.trim() }
  if (meta.authorType === "operator") return { kind: "operator" }
  return { kind: "unknown" }
}
