/**
 * What happens to the tasks a call creates — as a setting, not a deploy.
 *
 *   GET — the current choices plus the boards and pipelines to choose among,
 *         so the settings page needs one request instead of three.
 *   PUT — save them. Admin only, like every other org-wide setting.
 *
 * Until now the board was a feature flag written by a script and the due window
 * was a constant in the source, which meant every tenant needed an engineer for
 * a decision that is theirs to make.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { withRls, withRlsAuth } from "@/lib/with-rls"
import { logAudit } from "@/lib/prisma"
import { INBOX_QUALIFICATION_BOARD_PREFIX } from "@/lib/chatbot-engine"
import { replaceOrgValueFlags } from "@/lib/org-features"
import { SALES_BOARD_PREFIX, salesBoardId } from "@/lib/tasks/sales-board"
import {
  COMMITMENT_DUE_DAYS_PREFIX,
  DEFAULT_COMMITMENT_DUE_DAYS,
  MAX_COMMITMENT_DUE_DAYS,
  MIN_COMMITMENT_DUE_DAYS,
  commitmentDueDays,
} from "@/lib/tasks/call-task-settings"

const BodySchema = z.object({
  /** null clears the choice: automated tasks then live in the task list only. */
  boardId: z.string().min(1).max(64).nullable(),
  dueDays: z.number().int().min(MIN_COMMITMENT_DUE_DAYS).max(MAX_COMMITMENT_DUE_DAYS),
  /** Per-pipeline overrides. Absent pipelines are left untouched. */
  pipelineBoards: z.record(z.string().min(1).max(64), z.string().min(1).max(64).nullable())
    .refine((value) => Object.keys(value).length <= 200, "Too many pipelines")
    .optional(),
})

async function boardsAndPipelines(orgId: string) {
  const [boards, pipelines] = await Promise.all([
    prisma.division.findMany({
      where: { organizationId: orgId, isActive: true, isDepartment: false },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.pipeline.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, taskBoardId: true },
      orderBy: { sortOrder: "asc" },
    }),
  ])
  return { boards, pipelines }
}

export const GET = withRls(async (_req, { orgId }) => {
  try {
    const org = await prisma.organization.findFirst({
      where: { id: orgId },
      select: { features: true },
    })
    const { boards, pipelines } = await boardsAndPipelines(orgId)
    // Only offer choices that still exist. A board can be archived at any time,
    // and handing its id back would make the page echo it on save and fail
    // validation with an error naming no field the operator can see.
    const live = new Set(boards.map((board) => board.id))
    const storedBoardId = salesBoardId(org?.features)
    return NextResponse.json({
      success: true,
      data: {
        boardId: storedBoardId && live.has(storedBoardId) ? storedBoardId : null,
        dueDays: commitmentDueDays(org?.features),
        defaultDueDays: DEFAULT_COMMITMENT_DUE_DAYS,
        boards,
        pipelines: pipelines.map((pipeline) => ({
          ...pipeline,
          taskBoardId: pipeline.taskBoardId && live.has(pipeline.taskBoardId)
            ? pipeline.taskBoardId
            : null,
        })),
      },
    })
  } catch (e) {
    console.error("[settings/call-tasks GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

export const PUT = withRlsAuth("settings", "write", async (req, auth) => {
  // Belt and braces, exactly as /api/v1/settings/ai-features does it: the
  // permission matrix already limits `settings` to admins, and this check keeps
  // holding if that matrix is ever loosened.
  if (auth.role !== "admin" && auth.role !== "superadmin") {
    return NextResponse.json({ error: "Admin role required" }, { status: 403 })
  }
  const orgId = auth.orgId

  try {
    const parsed = BodySchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid settings" },
        { status: 400 },
      )
    }
    const { boardId, dueDays, pipelineBoards } = parsed.data

    // Every board named here must be this tenant's own, active, and a board
    // rather than a department. A board id from elsewhere would not leak
    // anything — the resolver filters by organization — it would silently
    // resolve to nothing, which looks exactly like the feature being broken.
    const named = [boardId, ...Object.values(pipelineBoards ?? {})].filter(
      (value): value is string => typeof value === "string",
    )
    if (named.length > 0) {
      const found = await prisma.division.findMany({
        where: {
          id: { in: [...new Set(named)] },
          organizationId: orgId,
          isActive: true,
          isDepartment: false,
        },
        select: { id: true },
      })
      if (found.length !== new Set(named).size) {
        return NextResponse.json({ error: "Unknown board" }, { status: 400 })
      }
    }

    const pipelineIds = Object.keys(pipelineBoards ?? {})
    if (pipelineIds.length > 0) {
      const owned = await prisma.pipeline.count({
        where: { id: { in: pipelineIds }, organizationId: orgId },
      })
      if (owned !== pipelineIds.length) {
        return NextResponse.json({ error: "Unknown pipeline" }, { status: 400 })
      }
    }

    // Both org-level values live in the same jsonb array, so they are rewritten
    // in one statement: a half-applied save would leave a board pointing at a
    // window nobody chose.
    // The legacy inbox flag names the same board — `salesBoardId` falls back to
    // it — so it has to go with the new choice. Leaving it would make "no board"
    // silently keep filing tasks on the board the admin just cleared.
    const additions = [
      ...(boardId ? [`${SALES_BOARD_PREFIX}${boardId}`] : []),
      `${COMMITMENT_DUE_DAYS_PREFIX}${dueDays}`,
    ]

    await prisma.$transaction([
      replaceOrgValueFlags(
        orgId,
        [SALES_BOARD_PREFIX, COMMITMENT_DUE_DAYS_PREFIX, INBOX_QUALIFICATION_BOARD_PREFIX],
        additions,
      ),
      ...pipelineIds.map((pipelineId) =>
        prisma.pipeline.updateMany({
          where: { id: pipelineId, organizationId: orgId },
          data: { taskBoardId: pipelineBoards?.[pipelineId] ?? null },
        }),
      ),
    ])

    await logAudit(orgId, "update", "organization", orgId, "call task settings", {
      userId: auth.userId,
      newValue: { callTaskBoard: boardId, callTaskDueDays: dueDays, pipelineBoards: pipelineBoards ?? {} },
    }).catch(() => {})

    const { boards, pipelines } = await boardsAndPipelines(orgId)
    return NextResponse.json({
      success: true,
      data: { boardId, dueDays, defaultDueDays: DEFAULT_COMMITMENT_DUE_DAYS, boards, pipelines },
    })
  } catch (e) {
    console.error("[settings/call-tasks PUT]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
