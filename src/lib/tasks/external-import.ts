import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { generateTaskKey } from "@/lib/tasks/task-key"
import { slugifyConfigName } from "@/lib/tasks/config-type"
import { STATUS_TO_STAGE } from "@/lib/tasks/board-columns"

/**
 * Bringing another tool's tasks onto a board (2026-11-06: Zeytun's marketing
 * board moved over from Bordio, 1772 tasks with their deadlines, assignees and
 * comments).
 *
 * The payload is source-neutral: whoever reads the other tool (for Bordio — a
 * script in the owner's browser, the tool has no export of its own) turns each
 * task into the shape below, and this module writes it the way the CRM keeps
 * tasks:
 *
 *  - the other tool's task type («DIGITAL MARKETING») becomes an org TaskType,
 *    its project («Pharmastore») the select custom field `brand` — both are
 *    already board / list filters;
 *  - people are matched by e-mail inside the organization. An e-mail nobody in
 *    the organization has is refused unless the caller says to import anyway —
 *    otherwise a run before the users exist would silently drop every assignee;
 *  - nobody is told: no bell, push or e-mail per task. A handover of hundreds of
 *    finished tasks is not something anyone has to act on;
 *  - `externalSource` + `externalId` make a second run update the tasks it
 *    already brought (title, status, dates, people) instead of adding copies.
 *    Comments and checklist items are written only when the task is created, so
 *    a re-run cannot duplicate them;
 *  - a task already brought onto ANOTHER board is refused, unless the caller
 *    says `relocate`: then it moves here (Bordio's projects became their own
 *    boards after the first run had put everything on one — owner, 2026-11-06).
 *    It takes this board's next key, its old key stays reserved, and the move
 *    is written to the task's history.
 */

export const EXTERNAL_IMPORT_MAX_TASKS = 200

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date")
const email = z.string().trim().toLowerCase().max(320)

export const externalTaskSchema = z.strictObject({
  externalId: z.string().min(1).max(100),
  // The other tool's own human key ("ZEYT-35"), kept in the activity log only.
  externalKey: z.string().max(60).nullable().optional(),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(50_000).nullable().optional(),
  status: z.enum(["backlog", "todo", "in_progress", "testing", "review", "done", "cancelled"]),
  priority: z.enum(["low", "medium", "high", "urgent", "critical"]).nullable().optional(),
  type: z.strictObject({
    label: z.string().trim().min(1).max(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/u).optional(),
  }).nullable().optional(),
  brand: z.string().trim().min(1).max(120).nullable().optional(),
  dueDate: isoDate.nullable().optional(),
  createdAt: isoDate.optional(),
  completedAt: isoDate.nullable().optional(),
  // First e-mail is the primary assignee, the rest become co-assignees.
  assigneeEmails: z.array(email).max(20).default([]),
  creatorEmail: email.nullable().optional(),
  checklist: z.array(z.strictObject({
    title: z.string().trim().min(1).max(500),
    completed: z.boolean(),
    // Bordio subtasks have their own assignee and deadline (2026-11-07).
    assigneeEmail: email.nullable().optional(),
    dueDate: isoDate.nullable().optional(),
    completedAt: isoDate.nullable().optional(),
  })).max(200).default([]),
  // Bordio-style card fields (2026-11-07). Absent = leave as it is on a re-run.
  startDate: isoDate.nullable().optional(),
  reporterEmail: email.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  followerEmails: z.array(email).max(50).optional(),
  estimatedMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  // The other tool's own history of the task («changed the due date to …»),
  // shown in the card's time line in its words. `externalId` keeps a re-run
  // from writing an event twice.
  events: z.array(z.strictObject({
    externalId: z.string().min(1).max(120),
    at: isoDate,
    actorEmail: email.nullable().optional(),
    actorName: z.string().trim().max(200).nullable().optional(),
    text: z.string().trim().min(1).max(2000),
  })).max(1000).optional(),
  comments: z.array(z.strictObject({
    authorEmail: email.nullable().optional(),
    authorName: z.string().trim().max(200).nullable().optional(),
    createdAt: isoDate,
    text: z.string().trim().min(1).max(20_000),
  })).max(500).default([]),
})

export const externalImportSchema = z.strictObject({
  source: z.string().regex(/^[a-z0-9_-]{1,40}$/u, "source must be a short lowercase name"),
  dryRun: z.boolean().default(false),
  // Import even though some e-mails match nobody in the organization: those
  // people are left off (an unmatched comment author is named in the text).
  allowUnmatched: z.boolean().default(false),
  // Move tasks this source already put on another board of the organization.
  relocate: z.boolean().default(false),
  // On tasks already brought over: rebuild the subtasks from the payload (with
  // their assignees and deadlines) and add the events not written yet.
  // Messages are never touched again.
  refreshDetails: z.boolean().default(false),
  tasks: z.array(externalTaskSchema).min(1).max(EXTERNAL_IMPORT_MAX_TASKS),
})

export type ExternalTask = z.infer<typeof externalTaskSchema>
export type ExternalImportInput = z.infer<typeof externalImportSchema>

export const BRAND_FIELD_NAME = "brand"
const BRAND_FIELD_LABEL = "Brend"
const POSITION_STEP = 1024

export interface ExternalImportResult {
  dryRun: boolean
  created: number
  updated: number
  /** Of `updated`: tasks that move here from another board (`relocate`). */
  moved: number
  /** E-mails in the payload that match nobody in the organization, with how often they occur. */
  unmatchedEmails: Record<string, number>
  /** Task types / brands that do not exist yet (created by a real run). */
  newTaskTypes: string[]
  newBrands: string[]
}

export class ExternalImportError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: unknown) {
    super(message)
  }
}

type Tx = Prisma.TransactionClient

function laneFor(status: ExternalTask["status"], columns: Array<{ key: string; mapsToStatus: string }>): string | null {
  const stage = STATUS_TO_STAGE[status] ?? status
  return columns.find((column) => column.mapsToStatus === stage)?.key ?? null
}

function isFinished(status: ExternalTask["status"]) {
  return status === "done" || status === "cancelled"
}

/**
 * Write one batch. Runs inside the caller's transaction and tenant scope; the
 * whole batch lands or none of it does, so a failed request is simply resent.
 */
export async function importExternalTasks(
  tx: Tx,
  args: { organizationId: string; actorUserId: string | null; divisionId: string; input: ExternalImportInput },
): Promise<ExternalImportResult> {
  const { organizationId, actorUserId, divisionId, input } = args

  const division = await tx.division.findFirst({
    where: { id: divisionId, organizationId, isActive: true },
    select: { id: true, key: true, name: true, isDepartment: true, boardColumns: { select: { key: true, mapsToStatus: true } } },
  })
  if (!division) throw new ExternalImportError("Board not found", 404)
  if (division.isDepartment) throw new ExternalImportError("A department holds no tasks — import into one of its sections", 400)

  const ids = input.tasks.map((task) => task.externalId)
  if (new Set(ids).size !== ids.length) throw new ExternalImportError("externalId repeats inside the batch", 400)

  // ── people ────────────────────────────────────────────────────────────────
  const wanted = new Map<string, number>()
  const want = (value: string | null | undefined) => {
    if (value) wanted.set(value, (wanted.get(value) ?? 0) + 1)
  }
  for (const task of input.tasks) {
    task.assigneeEmails.forEach(want)
    want(task.creatorEmail)
    want(task.reporterEmail)
    task.followerEmails?.forEach(want)
    task.checklist.forEach((item) => want(item.assigneeEmail))
    task.events?.forEach((event) => want(event.actorEmail))
    task.comments.forEach((comment) => want(comment.authorEmail))
  }
  const users = wanted.size === 0 ? [] : await tx.user.findMany({
    where: { organizationId, email: { in: [...wanted.keys()], mode: "insensitive" } },
    select: { id: true, email: true, isActive: true },
  })
  const userByEmail = new Map(users.map((user) => [user.email.toLowerCase(), user]))
  const unmatchedEmails: Record<string, number> = {}
  for (const [address, count] of wanted) if (!userByEmail.has(address)) unmatchedEmails[address] = count

  // ── types and brands ──────────────────────────────────────────────────────
  const typeLabels = new Map<string, { label: string; color?: string }>()
  for (const task of input.tasks) {
    if (task.type) typeLabels.set(slugifyConfigName(task.type.label), task.type)
  }
  const existingTypes = typeLabels.size === 0 ? [] : await tx.taskType.findMany({
    where: { organizationId, name: { in: [...typeLabels.keys()] } },
    select: { name: true, isActive: true },
  })
  const newTaskTypes = [...typeLabels.keys()].filter((name) => !existingTypes.some((type) => type.name === name))

  const brandField = await tx.customField.findFirst({
    where: { organizationId, entityType: "task", fieldName: BRAND_FIELD_NAME },
    select: { id: true, options: true, fieldType: true },
  })
  if (brandField && brandField.fieldType !== "select" && input.tasks.some((task) => task.brand)) {
    throw new ExternalImportError(`The task field "${BRAND_FIELD_NAME}" exists and is not a list`, 409)
  }
  const brands = [...new Set(input.tasks.map((task) => task.brand).filter((brand): brand is string => Boolean(brand)))]
  const newBrands = brands.filter((brand) => !(brandField?.options ?? []).includes(brand))

  const existing = await tx.task.findMany({
    where: { organizationId, externalSource: input.source, externalId: { in: ids } },
    select: { id: true, externalId: true, divisionId: true, taskKey: true, customFields: true, deletedAt: true },
  })
  const existingById = new Map(existing.map((task) => [task.externalId!, task]))
  const elsewhere = existing.filter((task) => task.divisionId !== division.id)
  if (elsewhere.length > 0 && !input.relocate) {
    throw new ExternalImportError(`Task ${elsewhere[0].externalId} was already imported onto another board`, 409)
  }
  const fromBoards = elsewhere.length === 0 ? [] : await tx.division.findMany({
    where: { organizationId, id: { in: [...new Set(elsewhere.map((task) => task.divisionId).filter((id): id is string => Boolean(id)))] } },
    select: { id: true, name: true },
  })
  const boardName = new Map(fromBoards.map((board) => [board.id, board.name]))

  const base: ExternalImportResult = {
    dryRun: input.dryRun,
    created: ids.filter((id) => !existingById.has(id)).length,
    updated: existingById.size,
    moved: elsewhere.length,
    unmatchedEmails,
    newTaskTypes,
    newBrands,
  }
  if (input.dryRun) return base
  if (Object.keys(unmatchedEmails).length > 0 && !input.allowUnmatched) {
    throw new ExternalImportError("Some e-mails match nobody in this organization", 422, { unmatchedEmails })
  }

  // ── configuration first, so every task below validates against it ─────────
  if (newTaskTypes.length > 0) {
    const max = await tx.taskType.aggregate({ where: { organizationId }, _max: { sortOrder: true } })
    let sortOrder = (max._max.sortOrder ?? -1) + 1
    for (const name of newTaskTypes) {
      const type = typeLabels.get(name)!
      await tx.taskType.create({
        data: { organizationId, name, displayName: type.label, color: type.color ?? "#6B7280", sortOrder: sortOrder++ },
      })
    }
  }
  const inactiveTypes = existingTypes.filter((type) => !type.isActive).map((type) => type.name)
  if (inactiveTypes.length > 0) {
    await tx.taskType.updateMany({ where: { organizationId, name: { in: inactiveTypes } }, data: { isActive: true } })
  }
  if (brands.length > 0) {
    if (!brandField) {
      await tx.customField.create({
        data: {
          organizationId,
          entityType: "task",
          fieldName: BRAND_FIELD_NAME,
          fieldLabel: BRAND_FIELD_LABEL,
          fieldType: "select",
          options: brands,
        },
      })
    } else if (newBrands.length > 0) {
      await tx.customField.update({ where: { id: brandField.id }, data: { options: [...brandField.options, ...newBrands] } })
    }
  }

  // ── tasks ─────────────────────────────────────────────────────────────────
  const userId = (address: string | null | undefined) => {
    const user = address ? userByEmail.get(address) : undefined
    return user?.id ?? null
  }
  const activeUserId = (address: string) => {
    const user = userByEmail.get(address)
    return user?.isActive ? user.id : null
  }

  const firstKey = await generateTaskKey(tx, organizationId, division.key)
  let nextNumber = Number(firstKey.slice(division.key.length + 1))
  const positionRow = await tx.task.aggregate({
    where: { organizationId, divisionId: division.id },
    _max: { boardPosition: true },
  })
  let nextPosition = (positionRow._max.boardPosition ?? 0) + POSITION_STEP
  const now = new Date()

  for (const task of input.tasks) {
    const people = [...new Set(task.assigneeEmails.map(activeUserId).filter((id): id is string => Boolean(id)))]
    const [assignedTo = null, ...collaboratorIds] = people
    const finished = isFinished(task.status)
    const completedAt = finished ? new Date(task.completedAt ?? task.createdAt ?? now) : null
    const fields = {
      title: task.title,
      description: task.description || null,
      status: task.status,
      priority: task.priority ?? "medium",
      type: task.type ? slugifyConfigName(task.type.label) : "task",
      dueDate: task.dueDate ? new Date(task.dueDate) : null,
      completedAt,
      assignedTo,
      boardColumnKey: laneFor(task.status, division.boardColumns),
      ...(task.startDate !== undefined ? { startDate: task.startDate ? new Date(task.startDate) : null } : {}),
      ...(task.reporterEmail !== undefined ? { reporterId: userId(task.reporterEmail) } : {}),
      ...(task.tags !== undefined ? { tags: [...new Set(task.tags)] } : {}),
      ...(task.estimatedMinutes !== undefined
        ? { estimatedHours: task.estimatedMinutes ? Math.round((task.estimatedMinutes / 60) * 100) / 100 : null }
        : {}),
    }
    const writeChecklist = (taskId: string) => tx.taskChecklist.createMany({
      data: task.checklist.map((item, sortOrder) => ({
        organizationId, taskId, title: item.title, completed: item.completed, sortOrder,
        assignedTo: userId(item.assigneeEmail),
        dueDate: item.dueDate ? new Date(item.dueDate) : null,
        completedAt: item.completed ? new Date(item.completedAt ?? task.completedAt ?? task.createdAt ?? now) : null,
      })),
    })
    const writeDetails = async (taskId: string, isNew: boolean) => {
      const followers = [...new Set((task.followerEmails ?? []).map(userId).filter((id): id is string => Boolean(id)))]
      if (followers.length > 0) {
        await tx.taskFollower.createMany({ data: followers.map((id) => ({ organizationId, taskId, userId: id })), skipDuplicates: true })
      }
      if (!isNew && input.refreshDetails) {
        await tx.taskChecklist.deleteMany({ where: { organizationId, taskId } })
        if (task.checklist.length > 0) await writeChecklist(taskId)
      }
      if (task.events?.length) {
        const written = isNew ? [] : await tx.taskActivity.findMany({
          where: { organizationId, taskId, action: "external_event" },
          select: { metadata: true },
        })
        const seen = new Set(written.map((row) => (row.metadata as { externalEventId?: string } | null)?.externalEventId).filter(Boolean))
        const fresh = task.events.filter((event) => !seen.has(event.externalId))
        if (fresh.length > 0) {
          await tx.taskActivity.createMany({
            data: fresh.map((event) => ({
              organizationId, taskId, userId: userId(event.actorEmail), action: "external_event", createdAt: new Date(event.at),
              metadata: { importedFrom: input.source, externalEventId: event.externalId, text: event.text, actorName: event.actorName ?? null },
            })),
          })
        }
      }
    }

    const previous = existingById.get(task.externalId)
    if (previous) {
      const customFields = { ...((previous.customFields as Record<string, unknown> | null) ?? {}) }
      if (task.brand) customFields[BRAND_FIELD_NAME] = task.brand
      else delete customFields[BRAND_FIELD_NAME]
      const moving = previous.divisionId !== division.id
      await tx.task.update({
        where: { id: previous.id },
        data: {
          ...fields,
          customFields: customFields as Prisma.InputJsonValue,
          ...(moving ? { divisionId: division.id, taskKey: `${division.key}-${nextNumber++}`, boardPosition: nextPosition } : {}),
        },
      })
      if (moving) {
        nextPosition += POSITION_STEP
        await tx.taskActivity.create({
          data: {
            organizationId,
            taskId: previous.id,
            userId: actorUserId,
            action: "board_changed",
            oldValue: (previous.divisionId && boardName.get(previous.divisionId)) ?? null,
            newValue: division.name,
            metadata: { importedFrom: input.source, externalId: task.externalId, previousTaskKey: previous.taskKey },
          },
        })
      }
      await tx.taskCollaborator.deleteMany({ where: { taskId: previous.id } })
      if (collaboratorIds.length > 0) {
        await tx.taskCollaborator.createMany({
          data: collaboratorIds.map((collaborator) => ({ organizationId, taskId: previous.id, userId: collaborator })),
          skipDuplicates: true,
        })
      }
      await writeDetails(previous.id, false)
      continue
    }

    const createdAt = task.createdAt ? new Date(task.createdAt) : now
    const created = await tx.task.create({
      data: {
        organizationId,
        divisionId: division.id,
        taskKey: `${division.key}-${nextNumber++}`,
        boardPosition: nextPosition,
        createdBy: userId(task.creatorEmail) ?? actorUserId,
        createdAt,
        externalSource: input.source,
        externalId: task.externalId,
        customFields: (task.brand ? { [BRAND_FIELD_NAME]: task.brand } : {}) as Prisma.InputJsonValue,
        ...fields,
      },
      select: { id: true },
    })
    nextPosition += POSITION_STEP

    if (collaboratorIds.length > 0) {
      await tx.taskCollaborator.createMany({
        data: collaboratorIds.map((collaborator) => ({ organizationId, taskId: created.id, userId: collaborator })),
        skipDuplicates: true,
      })
    }
    if (task.checklist.length > 0) await writeChecklist(created.id)
    await writeDetails(created.id, true)
    if (task.comments.length > 0) {
      await tx.taskComment.createMany({
        data: task.comments.map((comment) => {
          const author = userId(comment.authorEmail)
          const name = comment.authorName || comment.authorEmail
          return {
            organizationId,
            taskId: created.id,
            userId: author,
            content: author || !name ? comment.text : `${name}: ${comment.text}`,
            createdAt: new Date(comment.createdAt),
          }
        }),
      })
    }
    // History the board reports read (cycle time, flow): when it was made and,
    // for a finished task, when it was finished — at the other tool's dates.
    const origin = { importedFrom: input.source, externalId: task.externalId, externalKey: task.externalKey ?? null }
    await tx.taskActivity.create({
      data: { organizationId, taskId: created.id, userId: actorUserId, action: "created", newValue: "todo", metadata: origin, createdAt },
    })
    if (task.status !== "todo" && task.status !== "backlog") {
      await tx.taskActivity.create({
        data: {
          organizationId,
          taskId: created.id,
          userId: actorUserId,
          action: "status_changed",
          oldValue: "todo",
          newValue: task.status,
          metadata: origin,
          createdAt: completedAt ?? createdAt,
        },
      })
    }
  }

  return base
}
