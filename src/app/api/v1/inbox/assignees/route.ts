import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { hiddenChannelIdsFor, visibleChannelWhere } from "@/lib/inbox/channel-access"
import { loadInboxAssigneeHolders } from "@/lib/inbox/assignee-conversations"

/**
 * GET — everyone who holds an open conversation, for the inbox's «Ответственный» filter
 * (lib/inbox/assignee-filter). Unlike the assign list it names people who no longer work here:
 * their conversations are the ones to find. Numbers hidden from the caller are not counted in.
 */
export const GET = withRlsAuth("inbox", "read", async (_req, auth) => {
  try {
    const holders = await loadInboxAssigneeHolders({
      organizationId: auth.orgId,
      visibleChannels: visibleChannelWhere(await hiddenChannelIdsFor(auth)),
    })
    return NextResponse.json({ success: true, data: holders })
  } catch (e) {
    console.error("[inbox assignees]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
