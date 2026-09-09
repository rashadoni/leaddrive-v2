import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withRlsAuth } from "@/lib/with-rls";

const QUEUE_STRATEGIES = [
  "least_loaded",
  "round_robin",
  "skill_match",
] as const;

const createQueueSchema = z
  .object({
    name: z.string().min(1).max(200),
    skillTags: z.array(z.string()).optional(),
    strategy: z.enum(QUEUE_STRATEGIES).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

function normalizeSkillTags(tags: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (tags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean),
    ),
  );
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

export const GET = withRlsAuth("inbox", "read", async (_req, auth) => {
  try {
    const queues = await prisma.teamQueue.findMany({
      where: { organizationId: auth.orgId },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
    return NextResponse.json({ success: true, data: queues });
  } catch (error) {
    return teamQueueErrorResponse(error);
  }
});

export const POST = withRlsAuth("inbox", "write", async (req, auth) => {
  const body = await req.json();
  const parsed = createQueueSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  try {
    const queue = await prisma.teamQueue.create({
      data: {
        organizationId: auth.orgId,
        name: parsed.data.name.trim(),
        skillTags: normalizeSkillTags(parsed.data.skillTags),
        strategy: parsed.data.strategy ?? "least_loaded",
        isActive: parsed.data.isActive ?? true,
        createdBy: auth.userId ?? null,
      },
    });
    return NextResponse.json({ success: true, data: queue }, { status: 201 });
  } catch (error) {
    return teamQueueErrorResponse(error);
  }
});
