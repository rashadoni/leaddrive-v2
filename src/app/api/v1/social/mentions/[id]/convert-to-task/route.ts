import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import { CONVERTED_STATUS } from "@/lib/social/mention-status"

/**
 * Convert a social mention into a Task. Same atomic claim pattern as the Lead
 * and Ticket converters: create → try to claim → rollback on race.
 */
export const POST = withSocialMonitoringMutationFence("tasks", "write", async (_req, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const userId = auth.userId
  const { id } = await params

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (mention.taskId) {
    return NextResponse.json(
      { error: "Already converted", data: { taskId: mention.taskId } },
      { status: 409 },
    )
  }

  const rawSubject = mention.text.split(/\r?\n/)[0]
  const title = `[${mention.platform}] ${rawSubject.length > 80 ? rawSubject.slice(0, 77) + "…" : rawSubject}`
  const description = [
    `Platform: ${mention.platform}`,
    mention.authorName ? `Author: ${mention.authorName}${mention.authorHandle ? " (@" + mention.authorHandle + ")" : ""}` : null,
    mention.url ? `URL: ${mention.url}` : null,
    mention.sentiment ? `Sentiment: ${mention.sentiment}` : null,
    "",
    "Content:",
    mention.text,
  ].filter(Boolean).join("\n")

  const priority = mention.sentiment === "negative" ? "high" : "medium"

  const task = await prisma.task.create({
    data: {
      organizationId: orgId,
      title,
      description,
      priority,
      status: "pending",
      assignedTo: userId || null,
      createdBy: userId || null,
    },
  })

  const claim = await prisma.socialMention.updateMany({
    where: { id: mention.id, taskId: null },
    data: {
      taskId: task.id,
      status: CONVERTED_STATUS.taskId,
      handledAt: new Date(),
      handledBy: userId,
    },
  })
  if (claim.count === 0) {
    await prisma.task.delete({ where: { id: task.id } }).catch(() => {})
    const winner = await prisma.socialMention.findUnique({
      where: { id: mention.id },
      select: { taskId: true },
    })
    return NextResponse.json(
      { error: "Already converted", data: winner?.taskId ? { taskId: winner.taskId } : null },
      { status: 409 },
    )
  }

  return NextResponse.json({ success: true, data: { taskId: task.id } })
})
