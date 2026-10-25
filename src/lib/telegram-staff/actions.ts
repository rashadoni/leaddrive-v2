/**
 * Writes the bot may propose, and their execution on «Təsdiqlə».
 *
 * The model never writes. It calls propose_create_lead / propose_create_task;
 * that stores a pending TelegramStaffAction and the bot shows what will be
 * created with two buttons. Only the press by the same linked employee, within
 * ten minutes, runs the ordinary CRM command — the same one the web form uses,
 * with that employee's role and field permissions. A second press finds the
 * action no longer pending and writes nothing.
 */
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { checkPermission } from "@/lib/permissions"
import { createLeadCommand } from "@/lib/crm-commands/lead/create-lead"
import { createTaskCommand } from "@/lib/crm-commands/task/create-task"
import type { StaffActor } from "./actor"

export const ACTION_TTL_MS = 10 * 60_000

export const proposeLeadSchema = z.strictObject({
  contactName: z.string().trim().min(1).max(200),
  phone: z.string().trim().max(50).optional(),
  email: z.string().trim().email().max(200).optional(),
  companyName: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
})

export const proposeTaskSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  dueDate: z.string().trim().refine((value) => !Number.isNaN(Date.parse(value)), "dueDate must be an ISO date").optional(),
  description: z.string().trim().max(2000).optional(),
  board: z.string().trim().max(100).optional(),
})

export type ActionKind = "create_lead" | "create_task"

/** The JSON schemas the model sees for the two proposal tools. */
export const PROPOSE_TOOLS = [
  {
    name: "propose_create_lead",
    description: "Prepare a new lead for the employee to confirm with a button. Nothing is created until they press it. Ask for the person's name if it is missing; never invent a phone or e-mail.",
    input_schema: z.toJSONSchema(proposeLeadSchema),
  },
  {
    name: "propose_create_task",
    description: "Prepare a task for the employee to confirm with a button; it is assigned to them. Nothing is created until they press it. dueDate is ISO 8601 in Asia/Baku time. board is the exact name of a task board, only if the employee named one; otherwise leave it out and the task goes to their task list.",
    input_schema: z.toJSONSchema(proposeTaskSchema),
  },
] as const

const KIND_BY_TOOL: Record<string, ActionKind> = { propose_create_lead: "create_lead", propose_create_task: "create_task" }
const PERMISSION: Record<ActionKind, [string, "write"]> = { create_lead: ["leads", "write"], create_task: ["tasks", "write"] }

export function isProposeTool(name: string): boolean {
  return name in KIND_BY_TOOL
}

/** Store the proposal. Returns what to tell the model, and the action id when there is one. */
export async function proposeAction(actor: StaffActor, linkId: string, toolName: string, input: unknown, now = new Date()): Promise<{ result: string; actionId?: string }> {
  const kind = KIND_BY_TOOL[toolName]
  const [module, action] = PERMISSION[kind]
  if (!checkPermission(actor.role, module, action)) return { result: "NOT_PERMITTED: this employee's role cannot create this." }
  const parsed = (kind === "create_lead" ? proposeLeadSchema : proposeTaskSchema).safeParse(input)
  if (!parsed.success) return { result: `BAD_ARGUMENTS: ${parsed.error.issues[0]?.message ?? "invalid"}` }

  let payload: Record<string, unknown> = parsed.data
  if (kind === "create_task" && parsed.data && "board" in parsed.data && parsed.data.board) {
    const board = await prisma.division.findFirst({
      where: { organizationId: actor.orgId, isActive: true, isDepartment: false, name: { equals: parsed.data.board, mode: "insensitive" } },
      select: { id: true, name: true },
    })
    if (!board) return { result: `BOARD_NOT_FOUND: no task board named «${parsed.data.board}». Ask which board, or leave it out.` }
    payload = { ...parsed.data, board: board.name, divisionId: board.id }
  }

  // One open proposal at a time: a new one replaces the one not yet pressed.
  await prisma.telegramStaffAction.updateMany({ where: { organizationId: actor.orgId, linkId, status: "pending" }, data: { status: "cancelled", decidedAt: now } })
  const row = await prisma.telegramStaffAction.create({
    data: { organizationId: actor.orgId, linkId, kind, payload: payload as object, expiresAt: new Date(now.getTime() + ACTION_TTL_MS) },
    select: { id: true },
  })
  return { result: "PROPOSED: the employee now sees the preview with a confirm button. Do not say it is created.", actionId: row.id }
}

/** The preview the employee confirms — exactly what will be written. */
export function actionPreview(kind: string, payload: Record<string, unknown>, labels: PreviewLabels): string {
  const lines = [labels.question]
  const add = (label: string, value: unknown) => {
    if (typeof value === "string" && value.trim()) lines.push(`${label}: ${value.trim()}`)
  }
  if (kind === "create_lead") {
    add(labels.lead, payload.contactName)
    add(labels.phone, payload.phone)
    add(labels.email, payload.email)
    add(labels.company, payload.companyName)
    add(labels.note, payload.note)
  } else {
    add(labels.task, payload.title)
    add(labels.due, typeof payload.dueDate === "string" ? formatDue(payload.dueDate) : undefined)
    add(labels.board, payload.board)
    add(labels.note, payload.description)
  }
  return lines.join("\n")
}

export interface PreviewLabels { question: string; lead: string; phone: string; email: string; company: string; note: string; task: string; due: string; board: string }

function formatDue(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  const baku = new Date(date.getTime() + 4 * 3600_000)
  return `${pad(baku.getUTCDate())}.${pad(baku.getUTCMonth() + 1)}.${baku.getUTCFullYear()} ${pad(baku.getUTCHours())}:${pad(baku.getUTCMinutes())}`
}

export type DecideOutcome =
  | { status: "done"; kind: ActionKind; entityId: string }
  | { status: "cancelled" | "expired" | "gone" | "not_yours" }
  | { status: "failed"; message: string }

/** «Təsdiqlə» or «Ləğv et» on a proposal, by the employee whose link made it. */
export async function decideAction(actor: StaffActor, linkId: string, actionId: string, confirm: boolean, now = new Date()): Promise<DecideOutcome> {
  const row = await prisma.telegramStaffAction.findFirst({ where: { id: actionId, organizationId: actor.orgId }, select: { id: true, linkId: true, kind: true, payload: true, status: true, expiresAt: true } })
  if (!row) return { status: "gone" }
  if (row.linkId !== linkId) return { status: "not_yours" }
  if (row.status !== "pending") return { status: "gone" }
  if (!confirm) {
    await prisma.telegramStaffAction.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "cancelled", decidedAt: now } })
    return { status: "cancelled" }
  }
  if (row.expiresAt <= now) {
    await prisma.telegramStaffAction.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "expired", decidedAt: now } })
    return { status: "expired" }
  }
  const claimed = await prisma.telegramStaffAction.updateMany({ where: { id: row.id, status: "pending" }, data: { status: "running", decidedAt: now } })
  if (claimed.count !== 1) return { status: "gone" }

  const kind = row.kind as ActionKind
  const payload = row.payload as Record<string, unknown>
  const commandActor = { organizationId: actor.orgId, userId: actor.userId, role: actor.role, source: "telegram" as const, actionIntentId: row.id }
  try {
    let entityId: string
    if (kind === "create_lead") {
      const notes = typeof payload.note === "string" ? payload.note : undefined
      const result = await createLeadCommand(commandActor, {
        contactName: payload.contactName,
        ...(payload.phone ? { phone: payload.phone } : {}),
        ...(payload.email ? { email: payload.email } : {}),
        ...(payload.companyName ? { companyName: payload.companyName } : {}),
        ...(notes ? { notes } : {}),
        source: "telegram_bot",
      })
      entityId = result.entity.id
    } else {
      const result = await createTaskCommand(commandActor, {
        title: payload.title,
        assignedTo: actor.userId,
        ...(payload.description ? { description: payload.description } : {}),
        ...(payload.dueDate ? { dueDate: payload.dueDate } : {}),
        ...(payload.divisionId ? { divisionId: payload.divisionId } : {}),
      })
      entityId = result.entity.id
    }
    await prisma.telegramStaffAction.update({ where: { id: row.id }, data: { status: "done", resultId: entityId } })
    return { status: "done", kind, entityId }
  } catch (error) {
    const message = (error instanceof Error ? error.message : "Failed").slice(0, 300)
    await prisma.telegramStaffAction.update({ where: { id: row.id }, data: { status: "failed", error: message } })
    return { status: "failed", message }
  }
}
