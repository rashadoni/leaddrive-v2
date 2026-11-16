import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withInboxSessionWrite } from "@/lib/inbox/route-auth"
import { hiddenChannelIdsFor, visibleChannelWhere } from "@/lib/inbox/channel-access"
import { transferOpenConversations } from "@/lib/inbox/assignee-conversations"

/**
 * POST — «hand over all»: every open conversation and website chat `from` holds goes to `to`, in one
 * press and one transaction (lib/inbox/assignee-conversations `transferOpenConversations`). The
 * selection on the screen carries fifty at a time; a manager who left with hundreds is not handed
 * over in rounds.
 *
 * `from` is whatever the conversations name — a deleted account or an id that is no user at all
 * included. `to` must be somebody who can answer: a working account of this organization that is
 * not an outside reviewer — the same people the assign list offers (`/api/v1/users/assignable`).
 * There is no «to nobody»: an open conversation without an owner is what the AI auto-reply takes.
 */

const transferSchema = z.object({
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64),
})

export const POST = withInboxSessionWrite(async (req, auth) => {
  const parsed = transferSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 })
  const { from, to } = parsed.data
  if (from === to) return NextResponse.json({ error: "Invalid assignee" }, { status: 400 })

  const target = await prisma.user.findFirst({
    where: { id: to, organizationId: auth.orgId, isActive: true, anonymizedAt: null, role: { not: "reviewer" } },
    select: { id: true },
  })
  if (!target) return NextResponse.json({ error: "Invalid assignee" }, { status: 400 })

  try {
    const moved = await transferOpenConversations({
      organizationId: auth.orgId,
      fromUserId: from,
      toUserId: to,
      actorUserId: auth.userId,
      visibleChannels: visibleChannelWhere(await hiddenChannelIdsFor(auth)),
    })
    return NextResponse.json({ success: true, data: { ...moved, total: moved.conversations + moved.webChats } })
  } catch (e) {
    console.error("[inbox assignees transfer]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
