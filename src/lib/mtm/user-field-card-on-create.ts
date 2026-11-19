import type { NextRequest } from "next/server"
import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { writeMtmAudit } from "@/lib/mtm-audit"
import { writeWithMtmAgentCode } from "@/lib/mtm/agent-external-code"
import { withLegacyCredentialMaintenance } from "@/lib/identity/legacy-credential-write"
import { phonesMatch } from "@/lib/mtm/mobile-login-phone"
import type { ASSIGNABLE_FIELD_CARD_ROLES } from "@/lib/user-access-summary"

/**
 * «Добавить пользователя» with an employee card chosen in the same form — one
 * transaction, not two requests (Zeytun, 2026-11-19).
 *
 * With attendance on, the database gives every new active user an EMPLOYEE
 * card the moment the user row is inserted (mtm_attendance_provision_user), and
 * then refuses a second card for that user and refuses to take the first one
 * away. The form used to save the user first and link the chosen card after,
 * so every choice except «no card» ended in «This user conflicts with an
 * existing employee card» — the user saved, the card not.
 *
 * Order here: the user is inserted inactive (the trigger leaves inactive users
 * alone), the chosen card gets the link, and only then is the user activated —
 * the trigger finds exactly one card, keeps it and puts it in attendance. With
 * attendance off the triggers do nothing and the result is the same.
 */
export type FieldCardOnCreate =
  | { kind: "new"; role: typeof ASSIGNABLE_FIELD_CARD_ROLES[number] }
  | { kind: "existing"; id: string }

export type FieldCardOnCreateResult<T> =
  | { ok: true; user: T; agentId: string }
  | { ok: false; code: "FIELD_CARD_UNAVAILABLE" | "IDENTITY_CREDENTIAL_FLOW_REQUIRED" | "MTM_AGENT_CODE_TAKEN" }

class CardTaken extends Error {}

/** A card nobody holds: never linked, or linked to a CRM user who was deleted (Zeytun, 2026-11-19:
 * the IT head's own card, personnel number 0002, stayed on his deleted login). */
const FREE_CARD = { OR: [{ userId: null }, { user: { anonymizedAt: { not: null } } }] } satisfies Prisma.MtmAgentWhereInput

/**
 * The card a new user with this number takes back: the one card of a deleted user that still
 * carries the number — the number is how the app knows the person. Deletion has cleared the
 * number since 2026-11-19, so only cards deleted before keep one.
 */
export async function cardLeftByDeletedUser(organizationId: string, phone: string | null): Promise<string | null> {
  if (!phone) return null
  const cards = await prisma.mtmAgent.findMany({
    where: { organizationId, status: "ACTIVE", fieldDeletedAt: null, phone: { not: null }, user: { anonymizedAt: { not: null } } },
    select: { id: true, phone: true },
  })
  const matches = cards.filter((card: { id: string; phone: string | null }) => phonesMatch(card.phone, phone))
  return matches.length === 1 ? matches[0].id : null
}

export async function createUserWithFieldCard<T extends { id: string }>(input: {
  organizationId: string
  fieldCard: FieldCardOnCreate
  name: string
  active: boolean
  /** Inserts the user row INACTIVE; `active` decides whether it is switched on after the link. */
  createInactiveUser: (tx: Prisma.TransactionClient) => Promise<T>
  req?: NextRequest
}): Promise<FieldCardOnCreateResult<T>> {
  const { organizationId, fieldCard } = input
  const activate = async (tx: Prisma.TransactionClient, userId: string) => {
    if (input.active) await tx.user.update({ where: { id: userId }, data: { isActive: true }, select: { id: true } })
  }

  if (fieldCard.kind === "existing") {
    const card = await prisma.mtmAgent.findFirst({
      where: { organizationId, id: fieldCard.id, status: "ACTIVE", fieldDeletedAt: null, ...FREE_CARD },
      select: { id: true, name: true, role: true, userId: true },
    })
    if (!card) return { ok: false, code: "FIELD_CARD_UNAVAILABLE" }
    try {
      // The same fence a card relink takes on «Сотрудники MTM» (agents/[id] PUT).
      const result = await withLegacyCredentialMaintenance(prisma, organizationId, [{ kind: "ACTOR", actorId: card.id }], async (tx) => {
        const user = await input.createInactiveUser(tx)
        const linked = await tx.mtmAgent.updateMany({
          where: { organizationId, id: card.id, status: "ACTIVE", fieldDeletedAt: null, ...FREE_CARD },
          data: { userId: user.id },
        })
        if (linked.count !== 1) throw new CardTaken()
        await activate(tx, user.id)
        await writeMtmAudit({
          organizationId, agentId: card.id, action: "AGENT_UPDATE", entity: "agent", entityId: card.id,
          metadataKind: "agent_update", oldData: card, newData: { userId: user.id }, req: input.req,
        }, tx)
        return user
      })
      if (!result.allowed) return { ok: false, code: "IDENTITY_CREDENTIAL_FLOW_REQUIRED" }
      return { ok: true, user: result.value, agentId: card.id }
    } catch (error) {
      if (error instanceof CardTaken) return { ok: false, code: "FIELD_CARD_UNAVAILABLE" }
      throw error
    }
  }

  // A new card: the defaults «Сотрудники MTM → Добавить» gives one, and the next
  // code in the organization's sequence. A code taken a moment earlier rolls the
  // whole transaction back, the user too, and it is drawn again.
  const saved = await writeWithMtmAgentCode(prisma, organizationId, null, (externalCode) => prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const user = await input.createInactiveUser(tx)
    const agent = await tx.mtmAgent.create({
      data: {
        organizationId, name: input.name, externalCode, role: fieldCard.role, userId: user.id,
        canPlanOwnRoutes: true, canSelfPublishRoutes: false,
      },
      select: { id: true, name: true, externalCode: true, role: true },
    })
    await activate(tx, user.id)
    await writeMtmAudit({
      organizationId, agentId: agent.id, action: "AGENT_CREATE", entity: "agent", entityId: agent.id,
      metadataKind: "agent_create", newData: { ...agent, userId: user.id }, req: input.req,
    }, tx)
    return { user, agentId: agent.id }
  }, { timeout: 15_000 }))
  if (!saved.ok) return { ok: false, code: "MTM_AGENT_CODE_TAKEN" }
  return { ok: true, ...saved.value }
}
