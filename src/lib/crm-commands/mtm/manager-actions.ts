import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { checkPermission } from "@/lib/permissions"
import { getTenantCapabilityAccess } from "@/lib/tenant-capability-access"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { getMtmSettings } from "@/lib/mtm-settings"
import { dateInputValueInTimezone, isValidTimezone } from "@/lib/timezone"
import { isAgentInRouteScope, resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { isMtmTaskManager } from "@/lib/mtm/task-access"
import { notifyAgentOfAssignedTask } from "@/lib/mtm/task-assigned-notify"
import { createFieldMessage } from "@/lib/mtm/field-message-send"
import { MTM_TEAM_MESSAGES_PUSH_CHANNEL, notifyAgents } from "@/lib/mtm/push-notify"
import { sanitizeOperationalText } from "@/lib/mtm/operational-announcement"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { decideAttendanceRequestInTransaction } from "@/lib/mtm/attendance-request-decision"
import type { CrmCommandActorContext } from "../actor-context"
import {
  dispatchOrDeferCommandEffects,
  type CrmCommandExecutionContext,
} from "../execution-context"
import {
  CrmCommandError,
  forbiddenError,
  notFoundError,
  staleWriteError,
  validationError,
} from "../errors"
import {
  assignFieldContactCommandSchema,
  decideAttendanceRequestCommandSchema,
  giveFieldTaskCommandSchema,
  publishFieldRouteCommandSchema,
  sendFieldMessageCommandSchema,
} from "../schemas/mtm"
import { MtmRoutePublishError, publishMtmRouteInTransaction } from "@/lib/mtm/route-publish"
import { MTM_ROUTE_AUDIT_ACTION } from "@/lib/mtm/route-audit"
import { canManageFieldMasterData } from "@/lib/mtm/field-scope"
import { buildContactAssignmentPreview, contactAssignmentRequestHash } from "@/lib/mtm/contact-bulk-assignment"
import { executeContactAssignmentInTransaction } from "@/lib/mtm/contact-bulk-assignment-execute"

/**
 * Что начальник делает в «Маршрутах и поле» руками — одной командой на любой
 * вход, этап 2 «всё, что делают руками — голосом» (владелец 2026-11-08).
 *
 * По проду за 60 дней в Zeytun начальники руками давали полевые задачи,
 * писали агентам и решали заявки на отпуск и опоздание. Команды здесь
 * собраны из тех же кирпичей, что экран и телефон начальника (создание
 * задачи с событием CREATED и уведомлением агенту, `createFieldMessage`,
 * `decideAttendanceRequestInTransaction`), и проверяют то же, что они:
 * право на модуль, возможность тенанта, роль в MTM и команду начальника.
 *
 * Личность MTM («кто я в поле, чья у меня команда») сервер выводит из
 * пользователя CRM (`resolveMtmRouteActor`); ни идентификатор агента-автора,
 * ни команда от вызывающего не принимаются.
 */

type Db = Prisma.TransactionClient

async function inTransaction<T>(
  execution: CrmCommandExecutionContext | undefined,
  work: (db: Db) => Promise<T>,
): Promise<T> {
  if (execution?.transaction) return work(execution.transaction)
  return prisma.$transaction((tx: Prisma.TransactionClient) => work(tx))
}

async function requireCapability(organizationId: string, capability: "route-field" | "personnel"): Promise<void> {
  const access = await getTenantCapabilityAccess(organizationId, capability)
  if (!access.allowed) throw forbiddenError(`${capability} is not enabled for this organization`)
}

async function requireMtmActor(db: Db, actor: CrmCommandActorContext): Promise<MtmRouteActor> {
  if (!actor.userId) throw forbiddenError("A person acts in the field module")
  const mtmActor = await resolveMtmRouteActor(db, {
    organizationId: actor.organizationId,
    userId: actor.userId,
    webRole: actor.role,
  })
  if (!mtmActor) throw forbiddenError("MTM agent is inactive")
  return mtmActor
}

/** Имя автора, как его покажут агенту: из строки пользователя, а не из запроса. */
async function actorName(db: Db, actor: CrmCommandActorContext): Promise<string> {
  if (!actor.userId) return ""
  const user = await db.user.findFirst({
    where: { id: actor.userId, organizationId: actor.organizationId },
    select: { name: true, email: true },
  })
  return user?.name?.trim() || user?.email || ""
}

/* ─── Полевая задача агенту ─────────────────────────────────────────────── */


/**
 * «Дай задачу агенту» — три поля, как в строке «Полевых задач» и на телефоне
 * начальника: кому, что сделать, срок. Та же строка задачи, то же событие
 * CREATED, тот же журнал MTM, и агент узнаёт о ней сразу — колокольчик и
 * всплывающий пуш (task-assigned-notify.ts).
 */
export async function giveFieldTaskCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: { id: string; title: string; agentId: string; dueDate: Date | null } }> {
  const parsed = giveFieldTaskCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid field task")
  if (!checkPermission(actor.role, "mtm", "write")) throw forbiddenError()
  await requireCapability(actor.organizationId, "route-field")
  const orgId = actor.organizationId
  const input = parsed.data
  const dueDate = input.dueDate ? new Date(input.dueDate) : null
  const now = new Date()
  // Минута на дорогу от квитанции до кнопки; задачу не дают просроченной.
  if (dueDate && dueDate.getTime() < now.getTime() - 60_000) throw validationError("The due date has already passed")

  const settings = await getMtmSettings(orgId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"

  const { task, giver } = await inTransaction(execution, async (db) => {
    const mtmActor = await requireMtmActor(db, actor)
    if (!isMtmTaskManager(mtmActor) && mtmActor.agentId !== input.agentId) {
      throw forbiddenError("Cannot assign another agent")
    }
    if (!isAgentInRouteScope(mtmActor, input.agentId)) throw forbiddenError("Cannot assign an agent outside your team")
    if (mtmActor.role === "AGENT" && !settings.taskSelfCreate) throw forbiddenError("Self-created tasks are disabled")
    const agent = await db.mtmAgent.findFirst({
      where: { id: input.agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true },
    })
    if (!agent) throw notFoundError("Agent not found")
    const name = await actorName(db, actor)

    const created = await db.mtmTask.create({
      data: { organizationId: orgId, agentId: agent.id, title: input.title, priority: "MEDIUM", dueDate },
      select: { id: true, title: true, agentId: true, dueDate: true },
    })
    await db.mtmTaskEvent.create({
      data: {
        organizationId: orgId,
        taskId: created.id,
        agentId: agent.id,
        type: "CREATED",
        occurredAt: now,
        toStatus: "PENDING",
        evidence: {
          kind: "MTM_TASK_CREATED",
          actorAgentId: mtmActor.agentId,
          actorRole: mtmActor.role,
          actorName: name,
          channel: actor.source === "voice" ? "voice" : "web",
        },
      },
    })
    await writeMtmAudit({
      organizationId: orgId,
      agentId: agent.id,
      action: "TASK_CREATE",
      entity: "task",
      entityId: created.id,
      metadataKind: "task_create",
      newData: { title: created.title, dueDate: created.dueDate, priority: "MEDIUM", channel: actor.source },
      actorUserId: actor.userId,
    }, db)
    return { task: created, giver: { agentId: mtmActor.agentId, name } }
  })

  dispatchOrDeferCommandEffects(execution, async () => {
    await notifyAgentOfAssignedTask({
      organizationId: orgId,
      taskId: task.id,
      agentId: task.agentId,
      taskTitle: task.title,
      dueDate: task.dueDate,
      timezone,
      giverAgentId: giver.agentId,
      giverName: giver.name,
    })
  })
  return { entity: task }
}

/* ─── Личное сообщение агенту ───────────────────────────────────────────── */


/**
 * «Напиши Айтан, что …» — личное сообщение агенту, как из «Операций»: та же
 * личная ветка переписки, тот же пуш на телефон в канале сообщений команды,
 * тот же журнал. Агенту пишет начальник; агент агенту отсюда не пишет.
 */
export async function sendFieldMessageCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: { id: string; threadId: string } }> {
  const parsed = sendFieldMessageCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid message")
  if (!checkPermission(actor.role, "mtm", "write")) throw forbiddenError()
  const orgId = actor.organizationId
  const body = sanitizeOperationalText(parsed.data.body)
  if (!body) throw validationError("Message body is empty after sanitization")

  const sentAt = new Date()
  const { result, senderName, agentId } = await inTransaction(execution, async (db) => {
    const mtmActor = await requireMtmActor(db, actor)
    if (mtmActor.role === "AGENT") throw forbiddenError("Only a manager writes to the team")
    if (!isAgentInRouteScope(mtmActor, parsed.data.agentId)) throw forbiddenError("This agent is not in your team")
    if (mtmActor.agentId === parsed.data.agentId) throw validationError("Cannot message yourself")
    const recipient = await db.mtmAgent.findFirst({
      where: { id: parsed.data.agentId, organizationId: orgId, status: "ACTIVE" },
      select: { id: true, name: true },
    })
    if (!recipient) throw notFoundError("Agent not found")
    const senderName = await actorName(db, actor)
    const result = await createFieldMessage(db, {
      organizationId: orgId,
      type: "DIRECT",
      subject: null,
      body,
      recipients: [recipient],
      sender: { agentId: mtmActor.agentId, userId: actor.userId, name: senderName },
      acknowledgementRequired: false,
      notificationTitle: `Message from ${senderName}`,
      sentAt,
    })
    await writeMtmAudit({
      organizationId: orgId,
      agentId: mtmActor.agentId,
      action: "MESSAGE_DIRECT_SEND",
      entity: "message_thread",
      entityId: result.threadId,
      metadataKind: "field_message",
      newData: { recipientAgentIds: [recipient.id], acknowledgementRequired: false, keyMessage: false, channel: actor.source },
      actorUserId: actor.userId,
    }, db)
    return { result, senderName, agentId: recipient.id }
  })

  // Пуш — после коммита: несработавший пуш не отменяет отправленного.
  dispatchOrDeferCommandEffects(execution, async () => {
    await notifyAgents({
      client: prisma,
      organizationId: orgId,
      agentIds: [agentId],
      title: senderName,
      body,
      data: { target: "Messages", threadId: result.threadId },
      channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
    })
  })
  return { entity: { id: result.message.id, threadId: result.threadId } }
}

/* ─── Решение по заявке на отпуск, отсутствие, опоздание ───────────────── */


/** Ошибки библиотеки заявок — словами команд CRM, с тем же статусом. */
function attendanceCommandError(error: AttendanceRequestError): CrmCommandError {
  if (error.status === 404) return notFoundError(error.code)
  if (error.status === 403) return new CrmCommandError("FORBIDDEN", error.code, 403, { code: error.code })
  if (error.status === 400 || error.status === 413) {
    return new CrmCommandError("VALIDATION_FAILED", error.code, 400, { code: error.code })
  }
  return staleWriteError(error.code)
}

/**
 * Одобрить или отклонить заявку сотрудника — ТА ЖЕ функция, что кнопки на
 * экране «Решения» (`decideAttendanceRequestInTransaction`): права
 * проверяющего, его команда, запрет решать свою заявку, двухшаговое
 * согласование с HR, исправление времени, журнал и запись в колокольчик
 * сотрудника. Пуш на телефон — после коммита, как у экрана.
 *
 * Отказ без причины не принимается (правило библиотеки): сотрудник должен
 * знать, почему.
 */
export async function decideAttendanceRequestCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: { id: string; status: string; passedToHr: boolean } }> {
  const parsed = decideAttendanceRequestCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid decision")
  if (!actor.userId) throw forbiddenError("A person decides a request")
  const reviewer = { organizationId: actor.organizationId, userId: actor.userId, principalType: "session" as const }
  const input = parsed.data

  const outcome = await inTransaction(execution, async (db) => {
    const current = await db.mtmHrmRequest.findFirst({
      where: { id: input.attendanceRequestId, organizationId: actor.organizationId },
      select: { updatedAt: true },
    })
    if (!current) throw notFoundError("MTM_ATTENDANCE_REQUEST_NOT_FOUND")
    try {
      return await decideAttendanceRequestInTransaction(db, reviewer, input.attendanceRequestId, {
        decision: input.decision,
        version: input.expectedUpdatedAt
          ? new Date(input.expectedUpdatedAt).toISOString()
          : current.updatedAt.toISOString(),
        note: input.note ?? null,
      })
    } catch (error) {
      if (error instanceof AttendanceRequestError) throw attendanceCommandError(error)
      throw error
    }
  })

  const notice = outcome.notice
  if (notice) {
    dispatchOrDeferCommandEffects(execution, async () => {
      await notifyAgents({
        client: prisma,
        organizationId: actor.organizationId,
        agentIds: [notice.agentId],
        title: notice.title,
        body: notice.body,
        data: { target: "AttendanceRequests", requestId: input.attendanceRequestId },
        channelId: MTM_TEAM_MESSAGES_PUSH_CHANNEL,
      })
    })
  }
  return {
    entity: { id: outcome.request.id, status: outcome.request.status, passedToHr: outcome.passedToHr },
  }
}

/* ─── Опубликовать маршрут ──────────────────────────────────────────────── */

/**
 * «Опубликуй маршрут Эльвиры на завтра» — ТА ЖЕ публикация, что кнопка на
 * экране маршрутов (`publishMtmRouteInTransaction`): права начальника,
 * версия, блокировки расписания, конфликты с чужими маршрутами, уведомление
 * агентам. Журнал MTM — в той же транзакции.
 */
export async function publishFieldRouteCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: { id: string; publishedVersion: number | null } }> {
  const parsed = publishFieldRouteCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid route")
  if (!checkPermission(actor.role, "mtm", "write")) throw forbiddenError()
  await requireCapability(actor.organizationId, "route-field")
  const input = parsed.data

  return inTransaction(execution, async (db) => {
    const mtmActor = await requireMtmActor(db, actor)
    const expectedVersion = input.expectedVersion ?? (await db.mtmRoute.findFirst({
      where: { id: input.routeId, organizationId: actor.organizationId, deletedAt: null },
      select: { version: true },
    }))?.version
    if (expectedVersion === undefined) throw notFoundError("Route not found")
    let outcome
    try {
      outcome = await publishMtmRouteInTransaction(db, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        actor: mtmActor,
        routeId: input.routeId,
        expectedVersion,
        overrideReason: input.overrideReason ?? null,
      })
    } catch (error) {
      if (!(error instanceof MtmRoutePublishError)) throw error
      if (error.status === 404) throw notFoundError("Route not found")
      if (error.status === 403) throw forbiddenError("This route is not yours to publish")
      if (error.code === "ROUTE_VERSION_CONFLICT") throw staleWriteError("The route changed after it was reviewed")
      throw new CrmCommandError("VALIDATION_FAILED", error.code, 400, { code: error.code, ...error.details })
    }
    if (outcome.kind === "already") {
      return { entity: { id: outcome.route.id, publishedVersion: outcome.route.publishedVersion } }
    }
    await writeMtmAudit({
      organizationId: actor.organizationId,
      agentId: outcome.route.agentId,
      action: MTM_ROUTE_AUDIT_ACTION.ROUTE_PUBLISH,
      entity: "route",
      entityId: outcome.route.id,
      metadataKind: "route_publish",
      oldData: { status: outcome.route.status, version: outcome.route.version },
      newData: {
        status: "PLANNED",
        version: outcome.publishedVersion,
        publishedVersion: outcome.publishedVersion,
        conflicts: outcome.planningSignals.conflicts,
        coordination: outcome.planningSignals.coordination,
        managerOverride: outcome.managerOverride,
        channel: actor.source,
      },
      actorUserId: actor.userId,
    }, db)
    return { entity: { id: outcome.route.id, publishedVersion: outcome.publishedVersion } }
  })
}

/* ─── Привязать клиента к сотруднику ────────────────────────────────────── */

/**
 * «Назначь доктора Алиева Эльвире» — ТА ЖЕ запись, что «Привязать» на экране
 * клиентов (`executeContactAssignmentInTransaction`): первый сотрудник клиента
 * — главный, следующий — дополнительный, никого не отвязывает; сверка
 * предпросмотра, итог операции и журнал MTM.
 *
 * Транзакция обязана быть Serializable — исполнитель голосовых действий
 * открывает её такой для этого действия (action-execution.ts).
 */
export async function assignFieldContactCommand(
  actor: CrmCommandActorContext,
  rawInput: unknown,
  execution?: CrmCommandExecutionContext,
): Promise<{ entity: { id: string; contactId: string } }> {
  const parsed = assignFieldContactCommandSchema.safeParse(rawInput)
  if (!parsed.success) throw validationError(parsed.error.issues[0]?.message ?? "Invalid assignment")
  if (!checkPermission(actor.role, "mtm", "write")) throw forbiddenError()
  await requireCapability(actor.organizationId, "route-field")
  const input = parsed.data
  const settings = await getMtmSettings(actor.organizationId)
  const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
  const effectiveFrom = dateInputValueInTimezone(new Date(), timezone)
  const name = await actorName(execution?.transaction ?? (prisma as unknown as Db), actor)

  const run = async (db: Db) => {
    const mtmActor = await requireMtmActor(db, actor)
    if (!canManageFieldMasterData(mtmActor)) throw forbiddenError("Only a field manager assigns clients")
    if (!isAgentInRouteScope(mtmActor, input.agentId)) throw forbiddenError("This agent is not in your team")
    const preview = await buildContactAssignmentPreview(db, {
      organizationId: actor.organizationId,
      contactIds: [input.fieldContactId],
      mode: "ASSIGN",
      targetAgentId: input.agentId,
      sourceAgentId: null,
      effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
      actor: mtmActor,
    })
    const row = preview.rows[0]
    if (!row?.assignable) {
      throw new CrmCommandError("VALIDATION_FAILED", row?.issues.join(", ") || "CONTACT_NOT_AVAILABLE", 400, {
        issues: row?.issues ?? ["CONTACT_NOT_AVAILABLE"],
      })
    }
    const body = {
      contactIds: [input.fieldContactId],
      mode: "ASSIGN" as const,
      targetAgentId: input.agentId,
      sourceAgentId: null,
      effectiveFrom,
      reason: input.reason ?? `Voice: ${name}`.slice(0, 500),
      previewToken: input.previewToken ?? preview.previewToken,
      idempotencyKey: `voice:${actor.actionIntentId ?? globalThis.crypto.randomUUID()}`,
    }
    try {
      const result = await executeContactAssignmentInTransaction(db, {
        organizationId: actor.organizationId,
        userId: actor.userId,
        actor: mtmActor,
        body,
        requestHash: contactAssignmentRequestHash(body),
      })
      const assignmentId = result.changed[0]?.assignmentId ?? body.idempotencyKey
      return { entity: { id: assignmentId, contactId: input.fieldContactId } }
    } catch (error) {
      if (error instanceof Error && error.message === "STALE_PREVIEW") {
        throw staleWriteError("The client's assignments changed after it was reviewed")
      }
      if (error instanceof Error && error.message === "NOTHING_TO_ASSIGN") {
        throw validationError("This client cannot be assigned")
      }
      throw error
    }
  }

  if (execution?.transaction) return run(execution.transaction)
  return prisma.$transaction((tx: Prisma.TransactionClient) => run(tx), {
    isolationLevel: "Serializable",
  })
}
