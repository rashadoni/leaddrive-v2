import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  assessManualTaskIntegrity,
  isOwnedSocialContent,
} from "@/lib/social/reply-brand-integrity"
import {
  assessManualEngagementRisk,
  type ManualEngagementCandidate,
  isManualEngagementRiskCandidate,
} from "@/lib/social/manual-engagement-policy"

type ManualTaskRow = {
  [key: string]: unknown
  subjectId: string | null
  mention: ManualEngagementCandidate & {
    id: string
    accountId: string | null
    sourceMetadata: unknown
  }
  subject: {
    id: string
    name: string
    assignedAgentId: string | null
  } | null
  draft: {
    id: string
    subjectId: string | null
    replyText: string | null
    status: string
    engagementMode: string
    language: string | null
    tone: string | null
    reasoning: string | null
    agentSnapshot: unknown
    promptSnapshot: unknown
    createdAt: Date
  } | null
}

export const GET = withRlsAuth("social", "read", async (req: NextRequest, auth) => {
  const status = req.nextUrl.searchParams.get("status")?.trim() || "OPEN"
  const [tasks, subjects, channels] = await Promise.all([
    prisma.manualEngagementTask.findMany({
      where: { organizationId: auth.orgId, status },
      include: {
        mention: {
          select: {
            id: true,
            text: true,
            platform: true,
            accountId: true,
            sourceType: true,
            contentKind: true,
            sentiment: true,
            sourceMetadata: true,
            url: true,
            authorName: true,
            authorHandle: true,
            publishedAt: true,
            createdAt: true,
          },
        },
        subject: {
          select: {
            id: true,
            name: true,
            assignedAgentId: true,
          },
        },
        draft: {
          select: {
            id: true,
            subjectId: true,
            replyText: true,
            status: true,
            engagementMode: true,
            language: true,
            tone: true,
            reasoning: true,
            agentSnapshot: true,
            promptSnapshot: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.monitoringSubject.findMany({
      where: {
        organizationId: auth.orgId,
        status: { in: ["active", "paused"] },
      },
      select: { name: true },
      take: 100,
    }),
    prisma.socialReplyChannelSetting.findMany({
      where: { organizationId: auth.orgId },
      include: {
        senderAccount: {
          select: { id: true, handle: true, displayName: true, isActive: true },
        },
      },
    }),
  ])
  const organizationBrandNames = subjects.map((subject: { name: string }) => subject.name)
  const channelByPlatform = new Map(channels.map(channel => [
    channel.platform.toLowerCase(),
    channel,
  ]))
  const eligibleTasks = (tasks as ManualTaskRow[]).filter(task =>
    isManualEngagementRiskCandidate(task.mention)
    && !isOwnedSocialContent({
      accountId: task.mention.accountId,
      contentKind: task.mention.contentKind,
      sourceType: task.mention.sourceType,
      sourceMetadata: task.mention.sourceMetadata,
      replyIdentityAccountIds: [
        channelByPlatform.get(task.mention.platform?.toLowerCase() || "")?.senderAccountId,
      ].filter((value): value is string => Boolean(value)),
    }),
  )
  const data = eligibleTasks.map(task => {
    const promptSnapshot = task.draft?.promptSnapshot
    const promptVersion = promptSnapshot && typeof promptSnapshot === "object" && !Array.isArray(promptSnapshot)
      ? typeof (promptSnapshot as Record<string, unknown>).version === "string"
        ? (promptSnapshot as Record<string, unknown>).version as string
        : null
      : null
    const agentSnapshot = task.draft?.agentSnapshot
    const agentRecord = agentSnapshot && typeof agentSnapshot === "object" && !Array.isArray(agentSnapshot)
      ? agentSnapshot as Record<string, unknown>
      : null
    const agent = agentRecord
      ? {
          id: typeof agentRecord.id === "string" ? agentRecord.id : null,
          version: typeof agentRecord.version === "number" ? agentRecord.version : null,
          model: typeof agentRecord.model === "string" ? agentRecord.model : null,
          binding: typeof agentRecord.binding === "string" ? agentRecord.binding : null,
        }
      : null
    const platform = task.mention.platform?.toLowerCase() || ""
    const channel = channelByPlatform.get(platform)
    const replyIdentityAccountIds = channel?.senderAccountId ? [channel.senderAccountId] : []
    const promptSenderAccountId = promptSnapshot && typeof promptSnapshot === "object" && !Array.isArray(promptSnapshot)
      ? typeof (promptSnapshot as Record<string, unknown>).senderAccountId === "string"
        ? (promptSnapshot as Record<string, unknown>).senderAccountId as string
        : null
      : null
    return {
      ...task,
      subject: task.subject
        ? {
            id: task.subject.id,
            name: task.subject.name,
            assignedAgentId: task.subject.assignedAgentId,
          }
        : null,
      draft: task.draft
        ? {
            ...task.draft,
            agentSnapshot: undefined,
            agent,
          }
        : null,
      officialResponder: channel?.senderAccountId && channel.senderAccount?.isActive
        ? {
            accountId: channel.senderAccountId,
            name: channel.senderAccount.displayName || channel.senderAccount.handle,
          }
        : null,
      risk: assessManualEngagementRisk(task.mention),
      integrity: assessManualTaskIntegrity({
        mention: task.mention,
        replyIdentityAccountIds,
        subjectId: task.subjectId,
        subjectName: task.subject?.name ?? null,
        draftSubjectId: task.draft?.subjectId ?? null,
        draftReplyText: task.draft?.replyText ?? null,
        draftPromptVersion: promptVersion,
        draftAgentId: agent?.id ?? null,
        draftAgentBinding: agent?.binding ?? null,
        subjectAssignedAgentId: task.subject?.assignedAgentId ?? null,
        draftSenderAccountId: promptSenderAccountId,
        channelSenderAccountId: channel?.senderAccountId && channel.senderAccount?.isActive
          ? channel.senderAccountId
          : null,
      }, organizationBrandNames),
    }
  })
  return NextResponse.json({ success: true, data })
})
