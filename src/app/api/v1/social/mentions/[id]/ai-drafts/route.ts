import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { withSocialMonitoringMutationFence } from "@/lib/social/with-monitoring-mutation-fence"
import {
  SOCIAL_AI_REGENERATE_REASONS,
} from "@/lib/social/ai-reply-policy"
import { createSocialMentionAiDraft, socialAiDryRunResult } from "@/lib/social/ai-draft-service"
import { requestSocialReplyEnqueue } from "@/lib/social/outbound-boundary"
import {
  findForeignBrandMentions,
  isOwnedSocialContent,
  TENANT_RESPONDER_REPLY_PROMPT_VERSION,
} from "@/lib/social/reply-brand-integrity"

const createSchema = z.object({
  regenerateReason: z.enum(SOCIAL_AI_REGENERATE_REASONS).optional(),
  sourceDraftId: z.string().min(1).optional(),
  autoSendPositive: z.boolean().optional().default(true),
})

const patchSchema = z.object({
  draftId: z.string().min(1),
  action: z.enum(["approve", "reject", "send_dry_run", "update_text", "enqueue_live"]),
  replyText: z.string().trim().min(1).max(2000).optional(),
  reason: z.string().trim().max(500).optional(),
})

function promptVersion(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const version = (value as Record<string, unknown>).version
  return typeof version === "string" ? version : null
}

function agentBinding(value: unknown): { id: string | null; binding: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { id: null, binding: null }
  }
  const snapshot = value as Record<string, unknown>
  return {
    id: typeof snapshot.id === "string" ? snapshot.id : null,
    binding: typeof snapshot.binding === "string" ? snapshot.binding : null,
  }
}

function snapshotString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const field = (value as Record<string, unknown>)[key]
  return typeof field === "string" ? field : null
}

async function validateDraftBrandBinding(input: {
  organizationId: string
  mentionId: string
  subjectId: string | null
  promptSnapshot: unknown
  agentSnapshot?: unknown
  replyText: string
}) {
  if (!input.subjectId || promptVersion(input.promptSnapshot) !== TENANT_RESPONDER_REPLY_PROMPT_VERSION) {
    return {
      ok: false as const,
      code: "draft_brand_integrity_failed",
      error: "This is a legacy draft. Regenerate it with the tenant responder before approval.",
    }
  }
  const [subject, mention, organizationSubjects] = await Promise.all([
    prisma.monitoringSubject.findFirst({
      where: { organizationId: input.organizationId, id: input.subjectId },
      select: { id: true, name: true, assignedAgentId: true },
    }),
    prisma.socialMention.findFirst({
      where: { organizationId: input.organizationId, id: input.mentionId },
      select: {
        platform: true,
        accountId: true,
        contentKind: true,
        sourceType: true,
        sourceMetadata: true,
      },
    }),
    prisma.monitoringSubject.findMany({
      where: { organizationId: input.organizationId, status: { not: "deleted" } },
      select: { name: true },
      take: 100,
    }),
  ])
  if (!subject || !mention) {
    return {
      ok: false as const,
      code: "draft_brand_integrity_failed",
      error: "The monitored subject or source mention no longer exists.",
    }
  }
  const snapshot = agentBinding(input.agentSnapshot)
  const expectedBinding = subject.assignedAgentId ? "SUBJECT" : "SAFE_DEFAULT"
  if (snapshot.binding !== expectedBinding || (subject.assignedAgentId && snapshot.id !== subject.assignedAgentId)) {
    return {
      ok: false as const,
      code: "draft_agent_binding_failed",
      error: "The draft was not generated with the monitoring subject's current agent binding. Regenerate it.",
    }
  }
  const channel = await prisma.socialReplyChannelSetting.findFirst({
    where: {
      organizationId: input.organizationId,
      platform: mention.platform.toLowerCase(),
    },
    include: {
      senderAccount: {
        select: { id: true, handle: true, displayName: true, isActive: true },
      },
    },
  })
  if (!channel?.senderAccountId || !channel.senderAccount?.isActive) {
    return {
      ok: false as const,
      code: "sender_account_missing",
      error: "Select an active official sender account for this platform first.",
    }
  }
  if (snapshotString(input.promptSnapshot, "senderAccountId") !== channel.senderAccountId) {
    return {
      ok: false as const,
      code: "sender_account_changed",
      error: "The official sender changed after this draft was generated. Regenerate the draft.",
    }
  }
  if (isOwnedSocialContent({
    accountId: mention.accountId,
    contentKind: mention.contentKind,
    sourceType: mention.sourceType,
    sourceMetadata: mention.sourceMetadata,
    replyIdentityAccountIds: [channel.senderAccountId],
  })) {
    return {
      ok: false as const,
      code: "owned_source_not_reply_target",
      error: "This material belongs to the tenant's own sender account and is not an external reply target.",
    }
  }
  const responderName = channel.senderAccount.displayName || channel.senderAccount.handle
  const foreignBrandNames = findForeignBrandMentions(
    input.replyText,
    responderName,
    organizationSubjects.map(item => item.name).filter(name => name !== subject.name),
  )
  if (foreignBrandNames.length > 0) {
    return {
      ok: false as const,
      code: "draft_foreign_brand_failed",
      error: "The draft mentions another monitored brand. Edit or regenerate it before approval.",
    }
  }
  return {
    ok: true as const,
    monitoredSubjectName: subject.name,
    responderName,
  }
}

export const GET = withRlsAuth("social", "read", async (_req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: auth.orgId },
    select: { id: true },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const drafts = await prisma.socialMentionAiDraft.findMany({
    where: { organizationId: auth.orgId, mentionId: id },
    orderBy: { createdAt: "desc" },
  })
  const safeDrafts = drafts.map(draft => {
    const snapshot = draft.agentSnapshot && typeof draft.agentSnapshot === "object" && !Array.isArray(draft.agentSnapshot)
      ? draft.agentSnapshot as Record<string, unknown>
      : null
    return {
      ...draft,
      ...(snapshot ? { agentSnapshot: {
        id: typeof snapshot.id === "string" ? snapshot.id : null,
        name: typeof snapshot.name === "string" ? snapshot.name : null,
        version: typeof snapshot.version === "number" || typeof snapshot.version === "string" ? snapshot.version : null,
        model: typeof snapshot.model === "string" ? snapshot.model : null,
        binding: typeof snapshot.binding === "string" ? snapshot.binding : null,
      } } : {}),
    }
  })
  return NextResponse.json({ success: true, data: safeDrafts })
})

export const POST = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const mention = await prisma.socialMention.findFirst({
    where: { id, organizationId: auth.orgId },
    select: {
      id: true,
      organizationId: true,
      platform: true,
      text: true,
      authorName: true,
      authorHandle: true,
      sentiment: true,
      externalId: true,
      accountId: true,
      contentVersion: true,
      sourceType: true,
      contentKind: true,
      sourceProvider: true,
      sourceMetadata: true,
      url: true,
    },
  })
  if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const organization = await prisma.organization.findUnique({
    where: { id: auth.orgId },
    select: { name: true },
  })

  const created = await createSocialMentionAiDraft({
    organizationId: auth.orgId,
    mention,
    orgName: organization?.name || "the company",
    // Кнопку нажал человек: его выбор материала не переспрашиваем.
    origin: "operator",
    regenerateReason: parsed.data.regenerateReason,
    sourceDraftId: parsed.data.sourceDraftId,
    autoSendPositive: parsed.data.autoSendPositive,
  })
  if (!created) return NextResponse.json({ error: "AI reply generation failed" }, { status: 502 })

  return NextResponse.json({ success: true, data: created })
})

export const PATCH = withSocialMonitoringMutationFence("social", "write", async (req: NextRequest, auth, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const parsed = patchSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })

  const draft = await prisma.socialMentionAiDraft.findFirst({
    where: {
      id: parsed.data.draftId,
      mentionId: id,
      organizationId: auth.orgId,
    },
  })
  if (!draft) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (parsed.data.action === "update_text") {
    if (!parsed.data.replyText) {
      return NextResponse.json({ error: "Draft reply text is required" }, { status: 400 })
    }
    if (draft.status === "blocked" || draft.status === "rejected" || (draft.status === "sent" && draft.sendMode !== "dry_run")) {
      return NextResponse.json({ error: "This AI draft cannot be edited" }, { status: 409 })
    }
    const binding = await validateDraftBrandBinding({
      organizationId: auth.orgId,
      mentionId: id,
      subjectId: draft.subjectId,
      promptSnapshot: draft.promptSnapshot,
      agentSnapshot: draft.agentSnapshot,
      replyText: parsed.data.replyText,
    })
    if (!binding.ok) {
      return NextResponse.json({
        error: binding.error,
        code: binding.code,
      }, { status: 409 })
    }
    const updated = await prisma.socialMentionAiDraft.update({
      where: { id: draft.id },
      data: {
        replyText: parsed.data.replyText,
        status: "needs_approval",
        approvedBy: null,
        approvedAt: null,
        sentAt: null,
        sendResult: {},
        reviewReason: null,
        failureReason: null,
      },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  if (parsed.data.action === "approve") {
    if (draft.status === "blocked") {
      return NextResponse.json({ error: "Blocked AI drafts cannot be approved" }, { status: 409 })
    }
    if (!draft.replyText) {
      return NextResponse.json({ error: "Draft has no reply text" }, { status: 409 })
    }
    const binding = await validateDraftBrandBinding({
      organizationId: auth.orgId,
      mentionId: id,
      subjectId: draft.subjectId,
      promptSnapshot: draft.promptSnapshot,
      agentSnapshot: draft.agentSnapshot,
      replyText: draft.replyText,
    })
    if (!binding.ok) {
      return NextResponse.json({
        error: binding.error,
        code: binding.code,
      }, { status: 409 })
    }
    const updated = await prisma.socialMentionAiDraft.update({
      where: { id: draft.id },
      data: {
        status: "approved",
        approvedBy: auth.userId,
        approvedAt: new Date(),
        reviewReason: parsed.data.reason ?? null,
      },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  if (parsed.data.action === "reject") {
    const updated = await prisma.socialMentionAiDraft.update({
      where: { id: draft.id },
      data: {
        status: "rejected",
        reviewReason: parsed.data.reason ?? null,
      },
    })
    return NextResponse.json({ success: true, data: updated })
  }

  if (draft.status !== "approved") {
    return NextResponse.json({ error: "Draft must be approved before sending" }, { status: 409 })
  }

  if (parsed.data.action === "enqueue_live") {
    if (!draft.replyText) {
      return NextResponse.json({ error: "Draft has no reply text" }, { status: 409 })
    }
    const binding = await validateDraftBrandBinding({
      organizationId: auth.orgId,
      mentionId: id,
      subjectId: draft.subjectId,
      promptSnapshot: draft.promptSnapshot,
      agentSnapshot: draft.agentSnapshot,
      replyText: draft.replyText,
    })
    if (!binding.ok) {
      return NextResponse.json({
        error: binding.error,
        code: binding.code,
      }, { status: 409 })
    }
    const mention = await prisma.socialMention.findFirst({
      where: { id, organizationId: auth.orgId },
      select: {
        id: true,
        platform: true,
        externalId: true,
        sourceType: true,
        sourceProvider: true,
        sourceMetadata: true,
      },
    })
    if (!mention) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const result = await requestSocialReplyEnqueue({
      organizationId: auth.orgId,
      mentionId: mention.id,
      draftId: draft.id,
      requestedBy: auth.userId,
      replyText: draft.replyText,
      platform: mention.platform,
      externalId: mention.externalId,
      sourceType: mention.sourceType,
      sourceProvider: mention.sourceProvider,
      sourceMetadata: mention.sourceMetadata,
    })
    if (result.ok) {
      return NextResponse.json({ success: true, code: result.code, data: result.data }, { status: result.status })
    }
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
  }

  const updated = await prisma.socialMentionAiDraft.update({
    where: { id: draft.id },
    data: {
      status: "approved",
      sentAt: null,
      sendMode: "dry_run",
      sendResult: {
        ...socialAiDryRunResult("approved_send"),
        simulationOnly: true,
        statusUnchanged: "approved",
      },
    },
  })
  return NextResponse.json({ success: true, data: updated })
})
