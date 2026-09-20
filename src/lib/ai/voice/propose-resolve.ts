import { prisma } from "@/lib/prisma"
import { applyRecordFilter } from "@/lib/sharing-rules"
import type { AuthResult } from "@/lib/api-auth"
import {
  VOICE_PROPOSE_ACTION_TYPES,
  VOICE_PROPOSE_SCHEMAS,
  type VoiceProposeToolName,
} from "./propose-tools"
import type { AiVoiceActionType } from "./action-registry"

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
    code: "ASSIGNEE_NOT_FOUND" | "ASSIGNEE_AMBIGUOUS" | "LEAD_NOT_FOUND" | "LEAD_AMBIGUOUS" | "LEAD_TARGET_REQUIRED"
    field: "assigneeName" | "leadName"
    candidates: readonly Readonly<{ id: string; label: string }>[]
  }>
  | Readonly<{ kind: "invalid"; issues: readonly Readonly<{ path: string; message: string }>[] }>

/** What the browser says is on screen. Never model output. */
export type VoiceScreenContext = Readonly<{
  recordType?: string
  recordId?: string
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
async function resolveAssignee(
  auth: AuthResult,
  spokenName: string,
): Promise<
  | Readonly<{ ok: true; userId: string }>
  | Readonly<{ ok: false; code: "ASSIGNEE_NOT_FOUND" | "ASSIGNEE_AMBIGUOUS"; candidates: Readonly<{ id: string; label: string }>[] }>
> {
  const users = await prisma.user.findMany({
    where: {
      organizationId: auth.orgId,
      isActive: true,
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
  const actionType = VOICE_PROPOSE_ACTION_TYPES[tool]
  const payload: Record<string, unknown> = {}
  let targetEntityId: string | undefined

  for (const [key, value] of Object.entries(args)) {
    if (value === undefined) continue
    // Handled below; these are instructions to the resolver, not CRM fields.
    if (key === "assigneeName" || key === "leadName" || key === "relateToCurrentRecord") continue
    payload[key] = value
  }

  if (typeof args.assigneeName === "string") {
    const assignee = await resolveAssignee(auth, args.assigneeName)
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

  if (tool === "propose_update_lead") {
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

    if (Object.keys(payload).length === 0) {
      return {
        kind: "invalid",
        issues: [{ path: "(root)", message: "Name at least one field to change" }],
      }
    }
  }

  return {
    kind: "resolved",
    actionType,
    payload,
    ...(targetEntityId ? { targetEntityId } : {}),
  }
}
