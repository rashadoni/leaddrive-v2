import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRlsAuth } from "@/lib/with-rls";

const QUEUE_STRATEGIES = [
  "least_loaded",
  "round_robin",
  "skill_match",
] as const;

const updateQueueSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    skillTags: z.array(z.string()).optional(),
    strategy: z.enum(QUEUE_STRATEGIES).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

interface FlowQueueReference {
  id: string;
  name: string;
  graph: unknown;
}

function normalizeSkillTags(tags: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    ),
  );
}

function graphReferencesQueue(graph: unknown, queueId: string): boolean {
  if (!graph || typeof graph !== "object") return false;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return false;

  return nodes.some((node) => {
    if (!node || typeof node !== "object") return false;
    const data = (node as { data?: unknown }).data;
    if (!data || typeof data !== "object") return false;
    const action = (data as { action?: unknown }).action;
    if (!action || typeof action !== "object") return false;
    const config = (action as { config?: unknown }).config;
    if (!config || typeof config !== "object") return false;
    const candidate =
      (config as { queueId?: unknown; teamQueueId?: unknown }).queueId ??
      (config as { queueId?: unknown; teamQueueId?: unknown }).teamQueueId;
    return candidate === queueId;
  });
}

function teamQueueErrorResponse(error: unknown) {
  if ((error as { code?: string })?.code === "P2002") {
    return NextResponse.json(
      { error: "A queue with this name already exists." },
      { status: 409 },
    );
  }
  console.error("[team-queues] route error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const PATCH = withRlsAuth(
  "inbox",
  "write",
  async (
    req: NextRequest,
    auth,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    const body = await req.json();
    const parsed = updateQueueSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const data: {
      name?: string;
      skillTags?: string[];
      strategy?: (typeof QUEUE_STRATEGIES)[number];
      isActive?: boolean;
    } = {};
    if (parsed.data.name !== undefined) data.name = parsed.data.name.trim();
    if (parsed.data.skillTags !== undefined)
      data.skillTags = normalizeSkillTags(parsed.data.skillTags);
    if (parsed.data.strategy !== undefined)
      data.strategy = parsed.data.strategy;
    if (parsed.data.isActive !== undefined)
      data.isActive = parsed.data.isActive;

    try {
      const result = await prisma.teamQueue.updateMany({
        where: { id, organizationId: auth.orgId },
        data,
      });
      if (result.count === 0)
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });

      const queue = await prisma.teamQueue.findFirst({
        where: { id, organizationId: auth.orgId },
      });
      return NextResponse.json({ success: true, data: queue });
    } catch (error) {
      return teamQueueErrorResponse(error);
    }
  },
);

export const DELETE = withRlsAuth(
  "inbox",
  "delete",
  async (
    _req: NextRequest,
    auth,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    const { id } = await params;
    try {
      const flows: FlowQueueReference[] =
        await prisma.conversationFlow.findMany({
          where: { organizationId: auth.orgId },
          select: { id: true, name: true, graph: true },
        });
      const blockers = flows.filter((flow) =>
        graphReferencesQueue(flow.graph, id),
      );
      if (blockers.length > 0) {
        return NextResponse.json(
          {
            error: "Queue is used by a conversation flow.",
            data: {
              flowIds: blockers.map((flow) => flow.id),
              flowNames: blockers.map((flow) => flow.name),
            },
          },
          { status: 409 },
        );
      }

      const result = await prisma.teamQueue.deleteMany({
        where: { id, organizationId: auth.orgId },
      });
      if (result.count === 0)
        return NextResponse.json({ error: "Queue not found" }, { status: 404 });
      return NextResponse.json({ success: true, data: { deleted: id } });
    } catch (error) {
      return teamQueueErrorResponse(error);
    }
  },
);
