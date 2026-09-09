import { NextResponse } from "next/server";
import type {
  ConversationFlow,
  ConversationFlowRun,
  SocialConversation,
} from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { withRls } from "@/lib/with-rls";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type ConversationFlowRunRow = ConversationFlowRun & {
  flow: Pick<ConversationFlow, "id" | "name" | "trigger" | "status"> | null;
};

type SocialConversationSummary = Pick<
  SocialConversation,
  "id" | "platform" | "contactName" | "status" | "lastMessageAt"
>;

function parseLimit(value: string | null): number {
  if (value == null) return DEFAULT_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, Math.trunc(parsed)));
}

function summarizeState(state: unknown): {
  stepCount: number;
  stop: string | null;
} {
  if (!state || typeof state !== "object") return { stepCount: 0, stop: null };
  const record = state as Record<string, unknown>;
  return {
    stepCount: Array.isArray(record.steps) ? record.steps.length : 0,
    stop: typeof record.stop === "string" ? record.stop : null,
  };
}

export const GET = withRls(async (req, { orgId }) => {
  const { searchParams } = new URL(req.url);
  const flowId = searchParams.get("flowId")?.trim();
  const limit = parseLimit(searchParams.get("limit"));

  const runs: ConversationFlowRunRow[] =
    await prisma.conversationFlowRun.findMany({
      where: {
        organizationId: orgId,
        ...(flowId ? { flowId } : {}),
      },
      orderBy: [{ startedAt: "desc" }],
      take: limit,
      include: {
        flow: {
          select: {
            id: true,
            name: true,
            trigger: true,
            status: true,
          },
        },
      },
    });

  const conversationIds = Array.from(
    new Set(runs.map((run) => run.conversationId).filter(Boolean)),
  );
  const conversations =
    conversationIds.length === 0
      ? []
      : ((await prisma.socialConversation.findMany({
          where: {
            organizationId: orgId,
            id: { in: conversationIds },
          },
          select: {
            id: true,
            platform: true,
            contactName: true,
            status: true,
            lastMessageAt: true,
          },
        })) as SocialConversationSummary[]);
  const conversationById = new Map(
    conversations.map((conversation) => [conversation.id, conversation]),
  );

  return NextResponse.json({
    success: true,
    data: runs.map((run) => ({
      id: run.id,
      flowId: run.flowId,
      conversationId: run.conversationId,
      status: run.status,
      currentNodeId: run.currentNodeId,
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      summary: summarizeState(run.state),
      flow: run.flow,
      conversation: conversationById.get(run.conversationId) ?? null,
    })),
  });
});
