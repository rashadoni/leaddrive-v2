import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { channelVisible, hiddenChannelIdsFor } from "@/lib/inbox/channel-access"
import { historyImportDetail, inboxHistoryImports } from "@/lib/whatsapp-history-import/status"

/**
 * The WhatsApp import screen of the inbox (lib/whatsapp-history-import).
 *
 * GET                      — the imports to show as a banner over the conversation list: coming
 *                            now, or arrived in the last three days, on numbers this person sees.
 * GET ?channel=<channelId> — everything the import screen shows for one number. It names customers
 *                            and quotes their messages, so it answers only for a channel this person
 *                            may see (lib/inbox/channel-access) — a hidden one is a 404.
 */
export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const hidden = await hiddenChannelIdsFor(auth)
  const channelId = new URL(req.url).searchParams.get("channel")
  if (channelId) {
    if (!channelVisible(hidden, channelId)) return NextResponse.json({ error: "Not found" }, { status: 404 })
    const detail = await historyImportDetail(auth.orgId, channelId)
    if (!detail || detail.state === "not_coexistence") return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json(detail)
  }
  const imports = await inboxHistoryImports(auth.orgId, (id) => channelVisible(hidden, id))
  return NextResponse.json({ imports })
})
