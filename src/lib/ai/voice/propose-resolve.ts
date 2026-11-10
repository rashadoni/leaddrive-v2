import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { getMtmSettings } from "@/lib/mtm-settings"
import { dateInputValueInTimezone, isValidTimezone, localDateTimeToUtc } from "@/lib/timezone"
import { loadVoiceWallClockTimezone } from "./reporting-timezone"
import { quickTaskDueDate } from "@/lib/mtm/task-quick-due"
import { resolveMtmRouteActor, type MtmRouteActor } from "@/lib/mtm/route-permissions"
import { buildContactAssignmentPreview } from "@/lib/mtm/contact-bulk-assignment"
import { applyRecordFilter } from "@/lib/sharing-rules"
import type { AuthResult } from "@/lib/api-auth"
import {
  VOICE_PROPOSE_ACTION_TYPES,
  VOICE_PROPOSE_SCHEMAS,
  type VoiceProposeToolName,
} from "./propose-tools"
import type { AiVoiceActionType } from "./action-registry"
import { matchDealStage, type PipelineStageOption } from "./deal-stage-match"
import {
  PHONE_ORDER_TOOLS,
  resolvePhoneOrderProposal,
  type PhoneOrderClarifyCode,
  type PhoneOrderProposeTool,
} from "./propose-phone-order"

/**
 * Turn what the model said into what the CRM can be asked to do
 * (roadmap V1.2-V1.4).
 *
 * The model hands over names. This module is the only place those names
 * become identifiers, and it does so under the caller's own tenant and record
 * filters — the same ones a click goes through. Three rules:
 *
 * 1. **Nothing is trusted from the model but words.** No id ever crosses this
 *    boundary. A resolved id is one this code read from the database for this
 *    user, in this organization.
 * 2. **Ambiguity is a question, not a guess.** Zero or several matches return
 *    a clarification with enough detail to choose. Picking "the first Aysel"
 *    would put a real task on a real person's list because two colleagues
 *    share a first name.
 * 3. **The open record beats a name.** An update with no `leadName` targets
 *    whatever lead the user is looking at, which is both the least ambiguous
 *    reading of "change the phone" and the one the user can verify at a
 *    glance.
 */

type CompanyRow = Readonly<{ id: string; name: string }>
type ContactRow = Readonly<{ id: string; fullName: string }>

export type VoiceProposeResolution =
  | Readonly<{
    kind: "resolved"
    actionType: AiVoiceActionType
    payload: Record<string, unknown>
    targetEntityId?: string
  }>
  /** The model must ask the user before a draft can be prepared. */
  | Readonly<{
    kind: "clarify"
    code:
      | "ASSIGNEE_NOT_FOUND"
      | "ASSIGNEE_AMBIGUOUS"
      | "LEAD_NOT_FOUND"
      | "LEAD_AMBIGUOUS"
      | "LEAD_TARGET_REQUIRED"
      | "COMPANY_NOT_FOUND"
      | "COMPANY_AMBIGUOUS"
      | "CONTACT_NOT_FOUND"
      | "CONTACT_AMBIGUOUS"
      | "TASK_NOT_FOUND"
      | "TASK_AMBIGUOUS"
      | "TASK_TARGET_REQUIRED"
      | "DEAL_NOT_FOUND"
      | "DEAL_AMBIGUOUS"
      | "DEAL_TARGET_REQUIRED"
      | "DEAL_STAGE_NOT_FOUND"
      | "DEAL_STAGE_AMBIGUOUS"
      | "CHECKLIST_ITEM_NOT_FOUND"
      | "CHECKLIST_ITEM_AMBIGUOUS"
      | "FIELD_AGENT_NOT_FOUND"
      | "FIELD_AGENT_AMBIGUOUS"
      | "ATTENDANCE_REQUEST_NOT_FOUND"
      | "ATTENDANCE_REQUEST_AMBIGUOUS"
      | "FIELD_ROUTE_NOT_FOUND"
      | "FIELD_ROUTE_AMBIGUOUS"
      | "FIELD_CONTACT_NOT_FOUND"
      | "FIELD_CONTACT_AMBIGUOUS"
      | "CONTACT_TARGET_REQUIRED"
      | "RECORD_NOT_FOUND"
      | "RECORD_AMBIGUOUS"
      | "RECORD_TARGET_REQUIRED"
      | "TICKET_NOT_FOUND"
      | "TICKET_AMBIGUOUS"
      | "TICKET_TARGET_REQUIRED"
      | PhoneOrderClarifyCode
    field:
      | "assigneeName" | "leadName" | "companyName" | "contactName" | "taskTitle" | "dealName" | "status" | "stage"
      | "itemTitle" | "agentName" | "kind" | "day" | "clientName" | "recordName" | "ticket"
      | "order" | "line" | "product"
    candidates: readonly Readonly<{ id: string; label: string }>[]
  }>
  | Readonly<{ kind: "invalid"; issues: readonly Readonly<{ path: string; message: string }>[] }>

/** What the browser says is on screen. Never model output. */
export type VoiceScreenContext = Readonly<{
  recordType?: string
  recordId?: string
  /** IANA-пояс браузера: только если у пользователя и организации пояса нет. */
  timeZone?: string
}>

const MAX_CANDIDATES = 5

/** The selected shapes, named so the callbacks below are not implicitly any. */
type UserRow = Readonly<{ id: string; name: string; email: string }>
type LeadRow = Readonly<{ id: string; contactName: string; companyName: string | null }>

function personLabel(user: Readonly<{ name: string; email: string }>): string {
  return user.name.trim() || user.email
}

/**
 * Find one colleague by the name the user spoke.
 *
 * Matching is `contains`, case-insensitive, because people say "Aysel" for
 * "Aysel Məmmədova". That deliberately produces several matches often, which
 * is why the ambiguous branch exists rather than an ordering heuristic.
 */
/**
 * Кому НОВЫЙ лид вообще может принадлежать.
 *
 * `createLeadCommand` принимает в владельцы лида только роль `sales` — это
 * единственная команда с таким правилом, остальные берут любого активного
 * сотрудника. Если не сузить поиск здесь, разговор идёт так: «назначь Лейлу»
 * (она менеджер) — квитанция послушно показывает Лейлу, человек нажимает
 * «Создать», и команда отказывает чужой английской фразой. Тот же класс, на
 * который жаловался владелец 2026-11-05: «клиент не поймёт и я сам не понял».
 *
 * Поэтому в поиск попадают только те, кто может быть владельцем лида, и
 * ненайденное имя превращается в вопрос СО СПИСКОМ продавцов — до черновика,
 * а не после кнопки.
 */
const LEAD_OWNER_ROLE = "sales"

async function resolveAssignee(
  auth: AuthResult,
  spokenName: string,
  /** Роль, без которой запись не примет владельца. */
  requiredRole?: string,
): Promise<
  | Readonly<{ ok: true; userId: string }>
  | Readonly<{ ok: false; code: "ASSIGNEE_NOT_FOUND" | "ASSIGNEE_AMBIGUOUS"; candidates: Readonly<{ id: string; label: string }>[] }>
> {
  const users = await prisma.user.findMany({
    where: {
      organizationId: auth.orgId,
      isActive: true,
      ...(requiredRole ? { role: requiredRole } : {}),
      OR: [
        { name: { contains: spokenName, mode: "insensitive" } },
        { email: { contains: spokenName, mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES + 1,
  })

  if (users.length === 1) return { ok: true, userId: users[0].id }

  // An exact full-name match settles the common "two Aysels, one of them is
  // exactly who was named" case without guessing between genuine near-misses.
  const exact = users.filter((user: UserRow) => personLabel(user).toLowerCase() === spokenName.toLowerCase())
  if (exact.length === 1) return { ok: true, userId: exact[0].id }

  return {
    ok: false,
    code: users.length === 0 ? "ASSIGNEE_NOT_FOUND" : "ASSIGNEE_AMBIGUOUS",
    candidates: users.slice(0, MAX_CANDIDATES).map((user: UserRow) => ({
      id: user.id,
      label: personLabel(user),
    })),
  }
}

function leadLabel(lead: LeadRow): string {
  return lead.companyName?.trim()
    ? `${lead.contactName} (${lead.companyName.trim()})`
    : lead.contactName
}

async function resolveLeadByName(
  auth: AuthResult,
  spokenName: string,
): Promise<
  | Readonly<{ ok: true; leadId: string }>
  | Readonly<{ ok: false; code: "LEAD_NOT_FOUND" | "LEAD_AMBIGUOUS"; candidates: Readonly<{ id: string; label: string }>[] }>
> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "lead", {
    organizationId: auth.orgId,
    OR: [
      { contactName: { contains: spokenName, mode: "insensitive" } },
      { companyName: { contains: spokenName, mode: "insensitive" } },
    ],
  })
  const leads = await prisma.lead.findMany({
    where,
    select: { id: true, contactName: true, companyName: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_CANDIDATES + 1,
  })

  if (leads.length === 1) return { ok: true, leadId: leads[0].id }
  const exact = leads.filter(
    (lead: LeadRow) => lead.contactName.trim().toLowerCase() === spokenName.toLowerCase(),
  )
  if (exact.length === 1) return { ok: true, leadId: exact[0].id }

  return {
    ok: false,
    code: leads.length === 0 ? "LEAD_NOT_FOUND" : "LEAD_AMBIGUOUS",
    candidates: leads.slice(0, MAX_CANDIDATES).map((lead: LeadRow) => ({
      id: lead.id,
      label: leadLabel(lead),
    })),
  }
}

/**
 * The lead behind an id the browser supplied, if the caller may see it.
 *
 * Used only to name a deal after the lead the user is converting. The id came
 * from the browser's location, not the model, and this read goes through the
 * same record filter as everything else — so an id for someone else's lead
 * simply resolves to nothing.
 */
async function readLeadLabel(auth: AuthResult, leadId: string): Promise<string | null> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "lead", {
    id: leadId,
    organizationId: auth.orgId,
  })
  const leads = await prisma.lead.findMany({
    where,
    select: { id: true, contactName: true, companyName: true },
    take: 1,
  })
  const lead = leads[0] as LeadRow | undefined
  return lead ? (lead.companyName?.trim() || lead.contactName.trim() || null) : null
}

/**
 * One company or contact by the name the user spoke.
 *
 * Same shape as the colleague lookup, and for the same reason: `contains`
 * matching finds "Azmart" inside "Azmart MMC", which is how people talk, and
 * that routinely produces several rows. An exact match settles the common
 * case; anything else is a question.
 */
type NamedMatch =
  | Readonly<{ ok: true; id: string }>
  | Readonly<{ ok: false; ambiguous: boolean; candidates: Readonly<{ id: string; label: string }>[] }>

function matchNamedRecord(
  rows: readonly Readonly<{ id: string; label: string }>[],
  spokenName: string,
): NamedMatch {
  if (rows.length === 1) return { ok: true, id: rows[0].id }
  const exact = rows.filter((row) => row.label.trim().toLowerCase() === spokenName.toLowerCase())
  if (exact.length === 1) return { ok: true, id: exact[0].id }
  return {
    ok: false,
    ambiguous: rows.length > 0,
    candidates: rows.slice(0, MAX_CANDIDATES),
  }
}

async function resolveCompany(auth: AuthResult, spokenName: string) {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "company", {
    organizationId: auth.orgId,
    name: { contains: spokenName, mode: "insensitive" },
  })
  const rows = await prisma.company.findMany({
    where,
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES + 1,
  })
  return matchNamedRecord(
    (rows as CompanyRow[]).map((row: CompanyRow) => ({ id: row.id, label: row.name })),
    spokenName,
  )
}

async function resolveContact(auth: AuthResult, spokenName: string) {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "contact", {
    organizationId: auth.orgId,
    fullName: { contains: spokenName, mode: "insensitive" },
  })
  const rows = await prisma.contact.findMany({
    where,
    select: { id: true, fullName: true, email: true, company: { select: { name: true } } },
    orderBy: { fullName: "asc" },
    take: MAX_CANDIDATES + 1,
  }) as ContactCandidateRow[]
  const match = matchNamedRecord(
    rows.map((row) => ({ id: row.id, label: row.fullName })),
    spokenName,
  )
  if (match.ok) return match
  // Вопрос «какой?» со словами, по которым людей различают: у двух
  // «Rashad Rahimov» (так на проде 2026-11-09) одинаковое имя — нужна
  // компания или почта, иначе выбрать не из чего.
  const detail = new Map(rows.map((row) => [
    row.id,
    [row.fullName, row.company?.name?.trim() || row.email?.trim() || null].filter(Boolean).join(" · "),
  ]))
  return {
    ...match,
    candidates: match.candidates.map((candidate) => ({ ...candidate, label: detail.get(candidate.id) ?? candidate.label })),
  }
}

type ContactCandidateRow = Readonly<{
  id: string
  fullName: string
  email: string | null
  company: Readonly<{ name: string }> | null
}>

/**
 * The first stage of the organization's default pipeline.
 *
 * `createDealCommand` falls back to the literal name "LEAD" when no stage is
 * given and then checks it against that pipeline's real stage names, so an
 * organization whose first stage is called "Yeni" or "Новый" cannot create a
 * deal without one. Stage names are never hardcoded here: this reads the
 * organization's own configured stages, which is the same rule the rest of the
 * codebase follows for `Deal.stage`.
 *
 * Null means no default pipeline exists, and the command's own pipeline-less
 * path is then correct.
 */
async function resolveEntryStage(auth: AuthResult): Promise<string | null> {
  const pipeline = await prisma.pipeline.findFirst({
    where: { organizationId: auth.orgId, isDefault: true, isActive: true },
    select: { id: true },
  })
  if (!pipeline) return null
  const stage = await prisma.pipelineStage.findFirst({
    where: { organizationId: auth.orgId, pipelineId: pipeline.id, isActive: true },
    orderBy: { sortOrder: "asc" },
    select: { name: true },
  })
  return stage?.name ?? null
}

type TaskRow = Readonly<{ id: string; title: string }>

/** Инструменты, у которых цель — одна задача: словами или открытая на экране. */
const TASK_TARGET_TOOLS: ReadonlySet<string> = new Set([
  "propose_update_task",
  "propose_add_task_comment",
  "propose_add_task_checklist_item",
  "propose_set_task_checklist_item_done",
  "propose_log_task_time",
])
type DealRow = Readonly<{ id: string; name: string }>

/** One task by the title the user spoke, among the tasks this user may see. */
async function resolveTaskByTitle(auth: AuthResult, spokenTitle: string) {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "task", {
    organizationId: auth.orgId,
    title: { contains: spokenTitle, mode: "insensitive" },
  })
  const rows = await prisma.task.findMany({
    where,
    select: { id: true, title: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_CANDIDATES + 1,
  })
  return matchNamedRecord(
    (rows as TaskRow[]).map((row: TaskRow) => ({ id: row.id, label: row.title })),
    spokenTitle,
  )
}

/**
 * Одна подзадача ЭТОЙ задачи по названию, которое сказал человек.
 *
 * Ищется только среди подзадач уже найденной задачи — та же задача, что
 * покажет квитанция. Не нашлось по вхождению («отметь, что ga4 настроен», а
 * подзадача «ga4 quraşdırılması») — вопрос со списком подзадач задачи, а не
 * отказ: человек выберет из того, что есть, а не будет угадывать формулировку.
 */
async function resolveChecklistItem(auth: AuthResult, taskId: string, spokenTitle: string) {
  const byTitle = await prisma.taskChecklist.findMany({
    where: { organizationId: auth.orgId, taskId, title: { contains: spokenTitle, mode: "insensitive" } },
    select: { id: true, title: true },
    orderBy: { sortOrder: "asc" },
    take: MAX_CANDIDATES + 1,
  }) as TaskRow[]
  if (byTitle.length > 0) {
    return matchNamedRecord(byTitle.map((row) => ({ id: row.id, label: row.title })), spokenTitle)
  }
  const all = await prisma.taskChecklist.findMany({
    where: { organizationId: auth.orgId, taskId },
    select: { id: true, title: true },
    orderBy: { sortOrder: "asc" },
    take: MAX_CANDIDATES,
  }) as TaskRow[]
  return { ok: false as const, ambiguous: false, candidates: all.map((row) => ({ id: row.id, label: row.title })) }
}

/** Инструменты начальника в «Маршрутах и поле» (этап 2). */
const FIELD_MANAGER_TOOLS: ReadonlySet<string> = new Set([
  "propose_give_field_task",
  "propose_send_field_message",
  "propose_decide_attendance_request",
  "propose_publish_field_route",
  "propose_assign_field_contact",
])

/**
 * Один клиент поля по словам человека: каждое сказанное слово должно найтись
 * в его имени, фамилии, отчестве или отображаемом имени. «Доктор Алиев
 * Рашад» — три слова, и «доктор» не мешает: слово, которого нет ни у кого,
 * отбрасывается, если без него остаётся хоть одно.
 */
async function resolveFieldContact(auth: AuthResult, spokenName: string) {
  const words = spokenName.split(/\s+/).map((word) => word.trim()).filter((word) => word.length >= 2)
  const wordWhere = (word: string) => ({
    OR: [
      { firstName: { contains: word, mode: "insensitive" as const } },
      { lastName: { contains: word, mode: "insensitive" as const } },
      { middleName: { contains: word, mode: "insensitive" as const } },
      { displayName: { contains: word, mode: "insensitive" as const } },
    ],
  })
  const find = (used: string[]) => prisma.mtmContact.findMany({
    where: { organizationId: auth.orgId, deletedAt: null, AND: used.map(wordWhere) },
    select: { id: true, displayName: true, firstName: true, lastName: true, middleName: true },
    orderBy: { displayName: "asc" },
    take: MAX_CANDIDATES + 1,
  }) as Promise<Array<{ id: string; displayName: string; firstName: string; lastName: string; middleName: string | null }>>
  let rows = words.length > 0 ? await find(words) : []
  if (rows.length === 0 && words.length > 1) {
    // Титул или ослышанное слово: ищем без каждого слова по очереди.
    for (const skipped of words) {
      rows = await find(words.filter((word) => word !== skipped))
      if (rows.length > 0) break
    }
  }
  const label = (row: (typeof rows)[number]) => row.displayName?.trim()
    || [row.lastName, row.firstName, row.middleName].filter(Boolean).join(" ")
  return matchNamedRecord(rows.map((row) => ({ id: row.id, label: label(row) })), spokenName)
}

/**
 * Один полевой сотрудник по имени — только из КОМАНДЫ этого начальника
 * (`scopedAgentIds`; у администратора — вся организация), только активный и
 * не он сам. «Айтан» среди двух Айтан — вопрос, а не первая попавшаяся: иначе
 * задача или отказ в отпуске уйдут не тому человеку.
 */
async function resolveFieldAgent(
  auth: AuthResult,
  mtmActor: MtmRouteActor,
  spokenName: string,
  /** Только эта роль: клиентов привязывают к полевым агентам, не к начальникам. */
  role?: "AGENT",
) {
  const rows = await prisma.mtmAgent.findMany({
    where: {
      organizationId: auth.orgId,
      status: "ACTIVE",
      fieldDeletedAt: null,
      ...(role ? { role } : {}),
      name: { contains: spokenName, mode: "insensitive" },
      ...(mtmActor.scopedAgentIds !== null ? { id: { in: [...mtmActor.scopedAgentIds] } } : {}),
      ...(mtmActor.agentId ? { NOT: { id: mtmActor.agentId } } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: MAX_CANDIDATES + 1,
  }) as Array<{ id: string; name: string }>
  return matchNamedRecord(rows.map((row) => ({ id: row.id, label: row.name })), spokenName)
}

type PendingAttendanceRow = Readonly<{
  id: string
  startDate: Date
  endDate: Date
  updatedAt: Date
  attendanceDetails: unknown
}>

function attendanceKind(row: PendingAttendanceRow): string | null {
  const details = row.attendanceDetails
  return details && typeof details === "object" && typeof (details as { kind?: unknown }).kind === "string"
    ? (details as { kind: string }).kind
    : null
}

/** «ANNUAL_LEAVE 2026-11-10 – 2026-11-12»: вид и дни — то, по чему человек выбирает. */
function attendanceLabel(row: PendingAttendanceRow): string {
  const start = row.startDate.toISOString().slice(0, 10)
  const end = row.endDate.toISOString().slice(0, 10)
  return `${attendanceKind(row) ?? "REQUEST"} ${start === end ? start : `${start} – ${end}`}`
}

/** One deal by the name the user spoke, among the deals this user may see. */
async function resolveDealByName(auth: AuthResult, spokenName: string) {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "deal", {
    organizationId: auth.orgId,
    name: { contains: spokenName, mode: "insensitive" },
  })
  const rows = await prisma.deal.findMany({
    where,
    select: { id: true, name: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_CANDIDATES + 1,
  })
  return matchNamedRecord(
    (rows as DealRow[]).map((row: DealRow) => ({ id: row.id, label: row.name })),
    spokenName,
  )
}

/**
 * The stored status that a spoken task status means, for THIS task.
 *
 * A board task lives in the Kanban vocabulary (todo / in_progress / done) and
 * a list task in the legacy one (pending / in_progress / completed /
 * cancelled). Writing "completed" onto a board task would leave it in no
 * column; writing "done" onto a list task would skip the list's own "done".
 * Null means the meaning has no value for this task (a board has no
 * "cancelled"), which becomes a question to the user rather than a guess.
 */
async function taskStatusFor(
  auth: AuthResult,
  taskId: string,
  spoken: string,
): Promise<string | null> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "task", {
    id: taskId,
    organizationId: auth.orgId,
  })
  const tasks = await prisma.task.findMany({ where, select: { id: true, divisionId: true }, take: 1 })
  const task = tasks[0] as Readonly<{ id: string; divisionId: string | null }> | undefined
  if (!task) return null
  const board: Record<string, string> = { open: "todo", in_progress: "in_progress", done: "done" }
  const list: Record<string, string> = {
    open: "pending",
    in_progress: "in_progress",
    done: "completed",
    cancelled: "cancelled",
  }
  return (task.divisionId ? board : list)[spoken] ?? null
}

/**
 * The stages this deal can actually be moved to.
 *
 * Its own pipeline when it has one, the organisation's default pipeline
 * otherwise — the same source the board uses. Never a hardcoded list:
 * `Deal.stage` is a free string and every organisation configures its own.
 */
async function pipelineStagesForDeal(
  auth: AuthResult,
  dealId: string,
): Promise<readonly PipelineStageOption[]> {
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "deal", {
    id: dealId,
    organizationId: auth.orgId,
  })
  const deals = await prisma.deal.findMany({ where, select: { id: true, pipelineId: true }, take: 1 })
  const deal = deals[0] as Readonly<{ id: string; pipelineId: string | null }> | undefined
  if (!deal) return []
  let pipelineId = deal.pipelineId
  if (!pipelineId) {
    const pipeline = await prisma.pipeline.findFirst({
      where: { organizationId: auth.orgId, isDefault: true, isActive: true },
      select: { id: true },
    })
    pipelineId = pipeline?.id ?? null
  }
  if (!pipelineId) return []
  const stages = await prisma.pipelineStage.findMany({
    where: { organizationId: auth.orgId, pipelineId, isActive: true },
    select: { name: true, displayName: true, isWon: true, isLost: true },
    orderBy: { sortOrder: "asc" },
  })
  return stages as PipelineStageOption[]
}

/** Record types a voice task may be attached to from the current screen. */
const RELATABLE_SCREEN_TYPES = new Set(["lead", "deal", "contact", "company", "ticket"])

export async function resolveVoiceProposal(
  auth: AuthResult,
  tool: VoiceProposeToolName,
  rawArgs: unknown,
  screen: VoiceScreenContext,
): Promise<VoiceProposeResolution> {
  const parsed = VOICE_PROPOSE_SCHEMAS[tool].safeParse(rawArgs)
  if (!parsed.success) {
    return {
      kind: "invalid",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join(".") || "(root)",
        message: issue.message,
      })),
    }
  }

  const args = parsed.data as Record<string, unknown>
  // Телефонный заказ: своя развязка слов — заказ, строка, товар каталога.
  if (PHONE_ORDER_TOOLS.has(tool)) {
    return resolvePhoneOrderProposal(auth, tool as PhoneOrderProposeTool, args, screen)
  }
  const actionType = VOICE_PROPOSE_ACTION_TYPES[tool]
  const payload: Record<string, unknown> = {}
  let targetEntityId: string | undefined

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue
    // Handled below; these are instructions to the resolver, not CRM fields.
    if (
      key === "assigneeName"
      || key === "leadName"
      || key === "relateToCurrentRecord"
      || key === "taskTitle"
      || key === "dealName"
      || key === "itemTitle"
      || (key === "ticket" && TICKET_TOOLS.has(tool))
    ) continue
    payload[key] = value
  }

  if (typeof args.assigneeName === "string") {
    const assignee = await resolveAssignee(
      auth,
      args.assigneeName,
      tool === "propose_create_lead" ? LEAD_OWNER_ROLE : undefined,
    )
    if (!assignee.ok) {
      return { kind: "clarify", code: assignee.code, field: "assigneeName", candidates: assignee.candidates }
    }
    payload.assignedTo = assignee.userId
  }

  if (tool === "propose_create_task" && args.relateToCurrentRecord === true) {
    // Silently ignored when the screen is not a record page: an unattached
    // task is still the task the user asked for, and the receipt shows it.
    if (screen.recordType && screen.recordId && RELATABLE_SCREEN_TYPES.has(screen.recordType)) {
      payload.relatedType = screen.recordType
      payload.relatedId = screen.recordId
    }
  }

  if (tool === "propose_update_lead" || tool === "propose_convert_lead_to_deal") {
    if (typeof args.leadName === "string") {
      const lead = await resolveLeadByName(auth, args.leadName)
      if (!lead.ok) {
        return { kind: "clarify", code: lead.code, field: "leadName", candidates: lead.candidates }
      }
      targetEntityId = lead.leadId
    } else if (screen.recordType === "lead" && screen.recordId) {
      targetEntityId = screen.recordId
    } else {
      return {
        kind: "clarify",
        code: "LEAD_TARGET_REQUIRED",
        field: "leadName",
        candidates: [],
      }
    }
  }

  if (tool === "propose_update_lead" && Object.keys(payload).length === 0) {
    return {
      kind: "invalid",
      issues: [{ path: "(root)", message: "Name at least one field to change" }],
    }
  }

  if (tool === "propose_convert_lead_to_deal" && typeof payload.dealTitle !== "string") {
    // "Convert this lead" is the whole sentence people actually say. Naming
    // the deal after the lead is deterministic, and the receipt shows the name
    // before anything is created — unlike a title the model would invent.
    const label = targetEntityId ? await readLeadLabel(auth, targetEntityId) : null
    if (!label) {
      return {
        kind: "clarify",
        code: "LEAD_NOT_FOUND",
        field: "leadName",
        candidates: [],
      }
    }
    payload.dealTitle = label
  }

  if (TASK_TARGET_TOOLS.has(tool)) {
    if (typeof args.taskTitle === "string") {
      const task = await resolveTaskByTitle(auth, args.taskTitle)
      if (!task.ok) {
        return {
          kind: "clarify",
          code: task.ambiguous ? "TASK_AMBIGUOUS" : "TASK_NOT_FOUND",
          field: "taskTitle",
          candidates: task.candidates,
        }
      }
      targetEntityId = task.id
    } else if (screen.recordType === "task" && screen.recordId) {
      targetEntityId = screen.recordId
    } else {
      return { kind: "clarify", code: "TASK_TARGET_REQUIRED", field: "taskTitle", candidates: [] }
    }
    if (tool === "propose_update_task" && typeof args.status === "string") {
      const status = await taskStatusFor(auth, targetEntityId, args.status)
      if (!status) {
        return {
          kind: "invalid",
          issues: [{ path: "status", message: `This task has no "${args.status}" status` }],
        }
      }
      payload.status = status
    }
  }

  if (tool === "propose_set_task_checklist_item_done" && targetEntityId) {
    const item = await resolveChecklistItem(auth, targetEntityId, String(args.itemTitle ?? ""))
    if (!item.ok) {
      return {
        kind: "clarify",
        code: item.ambiguous ? "CHECKLIST_ITEM_AMBIGUOUS" : "CHECKLIST_ITEM_NOT_FOUND",
        field: "itemTitle",
        // Названия, как везде: модель идентификатора не получает.
        candidates: item.candidates.map((candidate) => ({ id: candidate.label, label: candidate.label })),
      }
    }
    payload.checklistItemId = item.id
    // «Отметь подзадачу» — это «сделано»; снова открыть — только сказанным false.
    payload.completed = args.completed === false ? false : true
  }

  if (tool === "propose_update_deal" || tool === "propose_move_deal_stage") {
    if (typeof args.dealName === "string") {
      const deal = await resolveDealByName(auth, args.dealName)
      if (!deal.ok) {
        return {
          kind: "clarify",
          code: deal.ambiguous ? "DEAL_AMBIGUOUS" : "DEAL_NOT_FOUND",
          field: "dealName",
          candidates: deal.candidates,
        }
      }
      targetEntityId = deal.id
    } else if (screen.recordType === "deal" && screen.recordId) {
      targetEntityId = screen.recordId
    } else {
      return { kind: "clarify", code: "DEAL_TARGET_REQUIRED", field: "dealName", candidates: [] }
    }
  }

  if (tool === "propose_move_deal_stage" && targetEntityId) {
    const stages = await pipelineStagesForDeal(auth, targetEntityId)
    const match = matchDealStage(String(args.stage ?? ""), stages)
    if (!match.ok) {
      return {
        kind: "clarify",
        code: match.ambiguous ? "DEAL_STAGE_AMBIGUOUS" : "DEAL_STAGE_NOT_FOUND",
        field: "stage",
        // Names only, as everywhere else: the model never receives an id, and
        // the user hears the stages their own pipeline has.
        candidates: match.options.slice(0, MAX_CANDIDATES).map((option) => ({
          id: option.name,
          label: option.displayName || option.name,
        })),
      }
    }
    // The stored spelling of the stage, not the spoken one.
    payload.stage = match.stage.name
  }

  if ((tool === "propose_update_task" || tool === "propose_update_deal") && Object.keys(payload).length === 0) {
    return {
      kind: "invalid",
      issues: [{ path: "(root)", message: "Name at least one field to change" }],
    }
  }

  if (tool === "propose_create_deal" || tool === "propose_update_deal") {
    if (typeof args.companyName === "string") {
      const company = await resolveCompany(auth, args.companyName)
      if (!company.ok) {
        return {
          kind: "clarify",
          code: company.ambiguous ? "COMPANY_AMBIGUOUS" : "COMPANY_NOT_FOUND",
          field: "companyName",
          candidates: company.candidates,
        }
      }
      payload.companyId = company.id
      delete payload.companyName
    }
    if (typeof args.contactName === "string") {
      const contact = await resolveContact(auth, args.contactName)
      if (!contact.ok) {
        return {
          kind: "clarify",
          code: contact.ambiguous ? "CONTACT_AMBIGUOUS" : "CONTACT_NOT_FOUND",
          field: "contactName",
          candidates: contact.candidates,
        }
      }
      payload.contactId = contact.id
      delete payload.contactName
    }
    if (tool === "propose_create_deal") {
      const stage = await resolveEntryStage(auth)
      if (stage) payload.stage = stage
    }
  }

  if (FIELD_MANAGER_TOOLS.has(tool)) {
    // Полезная нагрузка собирается заново: слова модели (имя, «завтра»,
    // «одобрить») — не поля команды.
    for (const key of Object.keys(payload)) delete payload[key]
    const mtmActor = auth.userId
      ? await resolveMtmRouteActor(prisma, { organizationId: auth.orgId, userId: auth.userId, webRole: auth.role })
      : null
    if (!mtmActor || mtmActor.role === "AGENT") {
      return {
        kind: "invalid",
        issues: [{ path: "(root)", message: "Only a field manager of the team can do this; say so to the user" }],
      }
    }
    // Клиентов поля привязывают только к агентам (contact-bulk-assignment.ts:
    // TARGET_AGENT_UNAVAILABLE для любой другой роли). Искать среди начальников
    // значит найти человека, к которому привязать нельзя: так 2026-11-08 в
    // LeadDrive Inc. «Farid Aliyev» (MANAGER) получил отказ уже после выбора.
    const agent = await resolveFieldAgent(
      auth,
      mtmActor,
      String(args.agentName ?? ""),
      tool === "propose_assign_field_contact" ? "AGENT" : undefined,
    )
    if (!agent.ok) {
      return {
        kind: "clarify",
        code: agent.ambiguous ? "FIELD_AGENT_AMBIGUOUS" : "FIELD_AGENT_NOT_FOUND",
        field: "agentName",
        candidates: agent.candidates,
      }
    }

    if (tool === "propose_give_field_task") {
      const settings = await getMtmSettings(auth.orgId)
      const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
      let dueDate: Date | null
      try {
        dueDate = quickTaskDueDate(String(args.due ?? "none"), new Date(), timezone)
      } catch {
        return { kind: "invalid", issues: [{ path: "due", message: "That day has already passed" }] }
      }
      payload.agentId = agent.id
      payload.title = args.title
      payload.dueDate = dueDate ? dueDate.toISOString() : null
    } else if (tool === "propose_send_field_message") {
      payload.agentId = agent.id
      payload.body = args.message
    } else if (tool === "propose_publish_field_route") {
      const settings = await getMtmSettings(auth.orgId)
      const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
      const today = dateInputValueInTimezone(new Date(), timezone)
      const spokenDay = String(args.day)
      const dayKey = spokenDay === "today"
        ? today
        : spokenDay === "tomorrow"
          ? new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)
          : spokenDay
      const routes = await prisma.mtmRoute.findMany({
        where: {
          organizationId: auth.orgId,
          date: new Date(`${dayKey}T00:00:00.000Z`),
          deletedAt: null,
          OR: [{ agentId: agent.id }, { assignments: { some: { agentId: agent.id, removedAt: null } } }],
        },
        select: { id: true, name: true, status: true, version: true, date: true },
        orderBy: { createdAt: "asc" },
        take: MAX_CANDIDATES + 1,
      }) as Array<{ id: string; name: string | null; status: string; version: number; date: Date }>
      const drafts = routes.filter((route) => route.status === "DRAFT")
      if (drafts.length !== 1) {
        return {
          kind: "clarify",
          code: drafts.length === 0 ? "FIELD_ROUTE_NOT_FOUND" : "FIELD_ROUTE_AMBIGUOUS",
          field: "day",
          // Что у сотрудника в этот день есть — с состоянием: «уже
          // опубликован» тоже ответ.
          candidates: (drafts.length === 0 ? routes : drafts).map((route) => ({
            id: route.id,
            label: `${route.name?.trim() || dayKey} (${route.status})`,
          })),
        }
      }
      payload.routeId = drafts[0].id
      payload.expectedVersion = drafts[0].version
      if (typeof args.overrideReason === "string") payload.overrideReason = args.overrideReason
    } else if (tool === "propose_assign_field_contact") {
      const contact = await resolveFieldContact(auth, String(args.clientName ?? ""))
      if (!contact.ok) {
        return {
          kind: "clarify",
          code: contact.ambiguous ? "FIELD_CONTACT_AMBIGUOUS" : "FIELD_CONTACT_NOT_FOUND",
          field: "clientName",
          candidates: contact.candidates,
        }
      }
      // Тот же предпросмотр, что у окна «Привязать» на экране: если клиента
      // привязать нельзя, человек слышит почему — до квитанции, а не после
      // кнопки. Его отпечаток уходит в квитанцию: изменилось что-то у клиента
      // до подтверждения — запись не пройдёт вслепую.
      const settings = await getMtmSettings(auth.orgId)
      const timezone = isValidTimezone(settings.timezone) ? settings.timezone : "UTC"
      const effectiveFrom = dateInputValueInTimezone(new Date(), timezone)
      const preview = await buildContactAssignmentPreview(prisma, {
        organizationId: auth.orgId,
        contactIds: [contact.id],
        mode: "ASSIGN",
        targetAgentId: agent.id,
        sourceAgentId: null,
        effectiveFrom: new Date(`${effectiveFrom}T00:00:00.000Z`),
        actor: mtmActor,
      })
      const row = preview.rows[0]
      if (!row?.assignable) {
        return {
          kind: "invalid",
          issues: [{
            path: "clientName",
            message: `This client cannot be attached: ${(row?.issues ?? ["CONTACT_NOT_AVAILABLE"]).join(", ")}. Say why in plain words`,
          }],
        }
      }
      payload.fieldContactId = contact.id
      payload.agentId = agent.id
      if (typeof args.reason === "string") payload.reason = args.reason
      payload.previewToken = preview.previewToken
    } else {
      const reject = args.decision === "reject"
      if (reject && typeof args.reason !== "string") {
        return {
          kind: "invalid",
          issues: [{ path: "reason", message: "A refusal needs a reason the employee will read: ask the user why, then call again" }],
        }
      }
      const pending = await prisma.mtmHrmRequest.findMany({
        where: {
          organizationId: auth.orgId,
          agentId: agent.id,
          status: "PENDING",
          attendanceDetails: { not: Prisma.DbNull },
        },
        select: { id: true, startDate: true, endDate: true, updatedAt: true, attendanceDetails: true },
        orderBy: { startDate: "asc" },
        take: 20,
      }) as PendingAttendanceRow[]
      const matching = pending.filter((row) => (
        (typeof args.kind !== "string" || attendanceKind(row) === args.kind)
        && (typeof args.startDate !== "string" || row.startDate.toISOString().slice(0, 10) === args.startDate)
      ))
      if (matching.length !== 1) {
        return {
          kind: "clarify",
          code: matching.length === 0 ? "ATTENDANCE_REQUEST_NOT_FOUND" : "ATTENDANCE_REQUEST_AMBIGUOUS",
          field: "kind",
          // Что открыто у этого сотрудника — чтобы спросить, а не гадать.
          candidates: (matching.length === 0 ? pending : matching)
            .slice(0, MAX_CANDIDATES)
            .map((row) => ({ id: row.id, label: attendanceLabel(row) })),
        }
      }
      const request = matching[0]
      payload.attendanceRequestId = request.id
      payload.decision = reject ? "REJECTED" : "APPROVED"
      if (typeof args.reason === "string") payload.note = args.reason
      // Версия, которую человек утверждает: изменилась заявка — квитанция
      // устарела, и решение не уходит вслепую.
      payload.expectedUpdatedAt = request.updatedAt.toISOString()
    }
  }

  if (tool === "propose_create_contact" || tool === "propose_update_contact") {
    if (tool === "propose_update_contact") {
      // Имя контакта здесь — «какой», а не новое значение (новое — fullName).
      delete payload.contactName
      if (typeof args.contactName === "string") {
        const contact = await resolveContact(auth, args.contactName)
        if (!contact.ok) {
          return {
            kind: "clarify",
            code: contact.ambiguous ? "CONTACT_AMBIGUOUS" : "CONTACT_NOT_FOUND",
            field: "contactName",
            candidates: contact.candidates,
          }
        }
        targetEntityId = contact.id
      } else if (screen.recordType === "contact" && screen.recordId) {
        targetEntityId = screen.recordId
      } else {
        return { kind: "clarify", code: "CONTACT_TARGET_REQUIRED", field: "contactName", candidates: [] }
      }
    }
    if (typeof args.companyName === "string") {
      const company = await resolveCompany(auth, args.companyName)
      if (!company.ok) {
        return {
          kind: "clarify",
          code: company.ambiguous ? "COMPANY_AMBIGUOUS" : "COMPANY_NOT_FOUND",
          field: "companyName",
          candidates: company.candidates,
        }
      }
      payload.companyId = company.id
      delete payload.companyName
    }
    if (tool === "propose_update_contact" && Object.keys(payload).length === 0) {
      return { kind: "invalid", issues: [{ path: "(root)", message: "Name at least one field to change" }] }
    }
  }

  if (tool === "propose_create_ticket") {
    // Клиент тикета — карточкой CRM, по имени; сказанное слово в тикет не идёт.
    delete payload.contactName
    delete payload.companyName
    if (typeof args.contactName === "string") {
      const contact = await resolveContact(auth, args.contactName)
      if (!contact.ok) {
        return { kind: "clarify", code: contact.ambiguous ? "CONTACT_AMBIGUOUS" : "CONTACT_NOT_FOUND", field: "contactName", candidates: contact.candidates }
      }
      payload.contactId = contact.id
    }
    if (typeof args.companyName === "string") {
      const company = await resolveCompany(auth, args.companyName)
      if (!company.ok) {
        return { kind: "clarify", code: company.ambiguous ? "COMPANY_AMBIGUOUS" : "COMPANY_NOT_FOUND", field: "companyName", candidates: company.candidates }
      }
      payload.companyId = company.id
    }
  }

  if (TICKET_TOOLS.has(tool) && tool !== "propose_create_ticket") {
    if (typeof args.ticket === "string") {
      const ticket = await resolveTicket(auth, args.ticket)
      if (!ticket.ok) {
        return {
          kind: "clarify",
          code: ticket.ambiguous ? "TICKET_AMBIGUOUS" : "TICKET_NOT_FOUND",
          field: "ticket",
          candidates: ticket.candidates,
        }
      }
      targetEntityId = ticket.id
    } else if (screen.recordType === "ticket" && screen.recordId) {
      targetEntityId = screen.recordId
    } else {
      return { kind: "clarify", code: "TICKET_TARGET_REQUIRED", field: "ticket", candidates: [] }
    }
    // Слова модели — в поля команды.
    if (tool === "propose_add_ticket_note") {
      delete payload.note
      payload.comment = args.note
    }
    if (tool === "propose_reply_to_ticket") {
      delete payload.message
      payload.comment = args.message
    }
    if (tool === "propose_update_ticket" && Object.keys(payload).length === 0) {
      return { kind: "invalid", issues: [{ path: "(root)", message: "Name at least one field to change" }] }
    }
  }

  if (tool === "propose_log_activity") {
    // Полезная нагрузка — заново: вид и имя карточки — не поля записи.
    for (const key of Object.keys(payload)) delete payload[key]
    const record = await resolveActivityRecord(
      auth,
      args.recordType as ActivityRecordType | undefined,
      typeof args.recordName === "string" ? args.recordName : undefined,
      screen,
    )
    if (!record.ok) return record.clarify
    targetEntityId = record.id
    payload.type = args.kind
    payload.subject = args.subject
    if (typeof args.details === "string" && args.details) payload.description = args.details
    if (typeof args.when === "string") {
      let timezone = "UTC"
      try {
        timezone = await loadVoiceWallClockTimezone(auth.orgId, auth.userId, screen.timeZone)
      } catch {
        return { kind: "invalid", issues: [{ path: "when", message: "The organization's time zone could not be read; try again" }] }
      }
      try {
        payload.scheduledAt = localDateTimeToUtc(args.when, timezone).toISOString()
      } catch {
        return { kind: "invalid", issues: [{ path: "when", message: "Use a real local date and time" }] }
      }
    }
    return {
      kind: "resolved",
      actionType: ACTIVITY_ACTION_TYPES[record.type],
      payload,
      targetEntityId,
    }
  }

  return {
    kind: "resolved",
    actionType,
    payload,
    ...(targetEntityId ? { targetEntityId } : {}),
  }
}

const TICKET_TOOLS: ReadonlySet<string> = new Set([
  "propose_create_ticket",
  "propose_add_ticket_note",
  "propose_reply_to_ticket",
  "propose_update_ticket",
])

/**
 * Тикет по словам человека: номер («TK-0012», «тикет 12») или слова темы,
 * имени клиента. Видимость — та же, что у очереди (правила записей).
 */
async function resolveTicket(auth: AuthResult, spoken: string) {
  const digits = spoken.replace(/\D/g, "")
  const numberOnly = /^[\p{L}\s#№-]*\d+$/u.test(spoken.trim()) && digits.length > 0 && digits.length <= 8
  const contains = { contains: spoken, mode: "insensitive" as const }
  const where = await applyRecordFilter(auth.orgId, auth.userId, auth.role, "ticket", {
    organizationId: auth.orgId,
    ...(numberOnly
      ? {
          OR: [
            { ticketNumber: { equals: spoken.trim(), mode: "insensitive" as const } },
            { ticketNumber: { endsWith: `-${digits.padStart(4, "0")}` } },
            { ticketNumber: { endsWith: `-${digits}` } },
          ],
        }
      : {
          OR: [
            { subject: contains },
            { requesterName: contains },
            { contact: { is: { fullName: contains } } },
          ],
        }),
  })
  const rows = await prisma.ticket.findMany({
    where,
    select: { id: true, ticketNumber: true, subject: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_CANDIDATES + 1,
  }) as Array<{ id: string; ticketNumber: string; subject: string }>
  if (rows.length === 1) return { ok: true as const, id: rows[0].id }
  return {
    ok: false as const,
    ambiguous: rows.length > 0,
    candidates: rows.slice(0, MAX_CANDIDATES).map((row) => ({ id: row.id, label: `${row.ticketNumber} · ${row.subject}` })),
  }
}

type ActivityRecordType = "contact" | "company" | "deal" | "lead"

const ACTIVITY_ACTION_TYPES: Readonly<Record<ActivityRecordType, AiVoiceActionType>> = {
  contact: "log_contact_activity",
  company: "log_company_activity",
  deal: "log_deal_activity",
  lead: "log_lead_activity",
}

type ClarifyResolution = Extract<VoiceProposeResolution, { kind: "clarify" }>

/**
 * Карточка, в ленту которой пишется заметка, звонок или встреча (этап 3).
 *
 * Без имени — открытая на экране. С именем и видом — поиск в этом виде.
 * С именем без вида — поиск во всех четырёх: одно совпадение берётся, иначе
 * вопрос со списком «вид · имя», чтобы человек сказал, какую карточку он имел
 * в виду, — «Азмарт» бывает и компанией, и сделкой.
 */
async function resolveActivityRecord(
  auth: AuthResult,
  recordType: ActivityRecordType | undefined,
  recordName: string | undefined,
  screen: VoiceScreenContext,
): Promise<
  | Readonly<{ ok: true; type: ActivityRecordType; id: string }>
  | Readonly<{ ok: false; clarify: ClarifyResolution }>
> {
  if (!recordName) {
    const onScreen = screen.recordType as ActivityRecordType | undefined
    if (
      onScreen && screen.recordId && onScreen in ACTIVITY_ACTION_TYPES
      && (!recordType || recordType === onScreen)
    ) {
      return { ok: true, type: onScreen, id: screen.recordId }
    }
    return {
      ok: false,
      clarify: { kind: "clarify", code: "RECORD_TARGET_REQUIRED", field: "recordName", candidates: [] },
    }
  }

  const types: ActivityRecordType[] = recordType ? [recordType] : ["contact", "company", "deal", "lead"]
  const found: Array<{ type: ActivityRecordType; id: string; label: string; exact: boolean }> = []
  for (const type of types) {
    const match = type === "contact"
      ? await resolveContact(auth, recordName)
      : type === "company"
        ? await resolveCompany(auth, recordName)
        : type === "deal"
          ? await resolveDealByName(auth, recordName)
          : await resolveLeadByName(auth, recordName).then((lead) => lead.ok
            ? { ok: true as const, id: lead.leadId }
            : { ok: false as const, ambiguous: lead.code === "LEAD_AMBIGUOUS", candidates: lead.candidates })
    if (match.ok) {
      found.push({ type, id: match.id, label: "", exact: true })
    } else {
      for (const candidate of match.candidates) {
        found.push({ type, id: candidate.id, label: candidate.label, exact: false })
      }
    }
  }
  const settled = found.filter((row) => row.exact)
  if (settled.length === 1) return { ok: true, type: settled[0].type, id: settled[0].id }
  const options = found.filter((row) => row.exact ? true : settled.length === 0)
  return {
    ok: false,
    clarify: {
      kind: "clarify",
      code: options.length === 0 ? "RECORD_NOT_FOUND" : "RECORD_AMBIGUOUS",
      field: "recordName",
      candidates: options.slice(0, MAX_CANDIDATES).map((row) => ({
        id: row.id,
        label: `${row.type} · ${row.label || recordName}`,
      })),
    },
  }
}
