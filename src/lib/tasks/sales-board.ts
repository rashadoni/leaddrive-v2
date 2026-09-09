import { prisma } from "@/lib/prisma"
import { featureFlagValue } from "@/lib/modules"
import { INBOX_QUALIFICATION_BOARD_PREFIX } from "@/lib/chatbot-engine"

/**
 * One board for selling.
 *
 * Sales work arrives from two places — a chat that produced a lead, and a
 * promise made on a call — and until now they were configured separately: the
 * chat side named its board through the inbox-qualification flag, and the call
 * side borrowed that same flag for lack of one of its own. Two settings for one
 * job is how a team ends up with half its work on a board called "social media"
 * and the other half nowhere in particular.
 *
 * So there is one setting, `salesBoard:<divisionId>`, and both paths read it.
 * The old flag stays as the fallback: a tenant that never sets the new one keeps
 * working exactly as before, which is the difference between a migration and an
 * outage.
 */

export const SALES_BOARD_PREFIX = "salesBoard:"

/** The board id a tenant has chosen for sales work, new setting first. */
export function salesBoardId(features: unknown): string | null {
  return featureFlagValue(features, SALES_BOARD_PREFIX)
    ?? featureFlagValue(features, INBOX_QUALIFICATION_BOARD_PREFIX)
}

export type SalesBoardSlot = {
  divisionId: string
  columnKey: string | null
  position: number
}

/**
 * Where a new piece of sales work goes: the first column of the sales board,
 * at the end of the queue.
 *
 * Returns null when the tenant has configured no board. Guessing a destination
 * is worse than the general task list, which at least is honest about being a
 * list.
 */
export async function resolveSalesBoardSlot(
  organizationId: string,
  options?: {
    /**
     * Already-loaded org features. Callers that read the organization anyway —
     * the commitment recorder reads it for the due-window setting — pass them
     * in so one save is not two queries.
     */
    features?: unknown
    /**
     * The lead's pipeline, when the work came from a lead. A pipeline may name
     * its own board, which is how one tenant keeps retail promises and
     * wholesale promises on different walls; the org-wide board is the
     * fallback, never the override.
     */
    pipelineId?: string | null
  },
): Promise<SalesBoardSlot | null> {
  const features = options && "features" in options
    ? options.features
    : (await prisma.organization.findFirst({
        where: { id: organizationId },
        select: { features: true },
      }))?.features

  const pipelineBoardId = options?.pipelineId
    ? (await prisma.pipeline.findFirst({
        where: { id: options.pipelineId, organizationId },
        select: { taskBoardId: true },
      }))?.taskBoardId ?? null
    : null

  // A pipeline's board is a preference, not a cliff. Nothing stops an operator
  // archiving the board a pipeline points at — the id is a plain column with no
  // foreign key — and when that happens the work must fall back to the
  // organization's board rather than quietly land nowhere.
  const candidates = [pipelineBoardId, salesBoardId(features)].filter(
    (value): value is string => Boolean(value),
  )
  if (candidates.length === 0) return null

  let division: { id: string; boardColumns: { key: string }[] } | null = null
  for (const candidate of candidates) {
    division = await prisma.division.findFirst({
      where: { id: candidate, organizationId, isActive: true, isDepartment: false },
      select: {
        id: true,
        boardColumns: { orderBy: { sortOrder: "asc" }, take: 1, select: { key: true } },
      },
    })
    if (division) break
  }
  if (!division) return null

  const columnKey = division.boardColumns[0]?.key ?? null
  // Newest first. Work arriving from a call is the freshest thing a salesperson
  // has, and appending it put a promise made minutes ago under a fortnight of
  // older cards where nobody scrolls. The board sorts by position ascending, so
  // "on top" means below the current minimum — with the same 1024 gap the drag
  // arithmetic uses, leaving room to drop cards above it by hand later.
  const lowest = await prisma.task.aggregate({
    where: { organizationId, divisionId: division.id, boardColumnKey: columnKey },
    _min: { boardPosition: true },
  })
  const first = lowest._min.boardPosition
  return {
    divisionId: division.id,
    columnKey,
    position: typeof first === "number" ? first - 1024 : 1024,
  }
}
