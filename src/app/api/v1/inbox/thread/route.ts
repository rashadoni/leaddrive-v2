import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { hiddenChannelIdsFor } from "@/lib/inbox/channel-access"
import { loadThreadHistory } from "@/lib/inbox/thread-history"

/**
 * GET ?contactId=… | ?conversationId=… — the opened customer's own history across his channels, not only
 * what fell into the inbox list's window of the organization's newest messages (lib/inbox/thread-history).
 */
export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const params = new URL(req.url).searchParams
  const contactId = params.get("contactId")
  const conversationId = params.get("conversationId")
  if (!contactId && !conversationId) {
    return NextResponse.json({ error: "contactId or conversationId is required" }, { status: 400 })
  }
  try {
    const history = await loadThreadHistory({
      organizationId: auth.orgId,
      contactId,
      conversationId,
      hiddenChannelIds: await hiddenChannelIdsFor(auth),
      role: auth.role,
      userId: auth.userId,
    })
    // «Not found» for a hidden number too, so it does not confirm its conversations exist.
    if (!history) return NextResponse.json({ error: "Not found" }, { status: 404 })
    return NextResponse.json({ success: true, data: history })
  } catch (e) {
    console.error("[inbox thread history]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
