import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"

const escalateSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  assignedTo: z.string().trim().min(1).optional(),
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const orgId = auth.orgId
  const { id } = await params
  const parsed = escalateSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: orgId },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const title = `[${mention.platform}] Escalate social mention`.slice(0, 200)
  const description = [
    parsed.data.reason ? `Reason: ${parsed.data.reason}` : null,
    `Platform: ${mention.platform}`,
    mention.sourceProvider ? `Source provider: ${mention.sourceProvider}` : null,
    mention.authorName ? `Author: ${mention.authorName}${mention.authorHandle ? ` (@${mention.authorHandle})` : ""}` : null,
    mention.url ? `URL: ${mention.url}` : null,
    mention.sentiment ? `Sentiment: ${mention.sentiment}` : null,
    "",
    "Content:",
    mention.text,
  ].filter(Boolean).join("\n")

  const task = await prisma.task.create({
    data: {
      organizationId: orgId,
      title,
      description,
      priority: mention.sentiment === "negative" ? "high" : "medium",
      status: "pending",
      assignedTo: parsed.data.assignedTo || auth.userId || null,
      createdBy: auth.userId || null,
      relatedType: "social_mention",
      relatedId: mention.id,
    },
  })

  await prisma.aiAlert.create({
    data: {
      organizationId: orgId,
      type: "social_manual_escalation",
      severity: mention.sentiment === "negative" ? "critical" : "warning",
      message: `${mention.platform} mention escalated for manual review`,
      metadata: {
        mentionId: mention.id,
        taskId: task.id,
        reason: parsed.data.reason ?? null,
        platform: mention.platform,
      },
    },
  }).catch(() => {})

  await prisma.socialMention.update({
    where: { id: mention.id },
    data: {
      taskId: mention.taskId ?? task.id,
      status: mention.status === "new" ? "reviewed" : mention.status,
      handledAt: new Date(),
      handledBy: auth.userId,
    },
  })

  await logAudit(orgId, "social_mention_escalated", "social_mention", mention.id, mention.platform, {
    newValue: { taskId: task.id, reason: parsed.data.reason ?? null },
  })

  return NextResponse.json({ success: true, data: { taskId: task.id } })
})
