import { FIELD_CARD_ROLES, fieldAccessOutcome, type FieldCardRole } from "@/lib/user-access-summary"
import { effectiveHiddenModules } from "@/lib/user-module-access"

/**
 * The roster behind Route & Field → "Access & permissions": every CRM login of
 * the organization, and the field scope it works with.
 *
 * Field scope is not a property of the login. It is the ACTIVE employee card
 * linked to it (resolveMtmRouteActor) — so "give this person access" means
 * create or link a card, "change what they see" means change the card's role,
 * and "take it away" means unlink it. This file turns the two lists the API
 * already serves (users, employee cards) into rows, and a chosen access level
 * into the writes that make it true. The writes go through the existing
 * admin-only, audited agent endpoints; nothing here widens who may do what.
 */

export interface AccessUser {
  id: string
  name: string
  email: string
  role: string
  isActive: boolean
  hiddenModules?: string[] | null
}

export interface AccessCard {
  id: string
  name: string
  email: string | null
  role: string
  status: string
  userId: string | null
  createdAt: string
  canPlanOwnRoutes?: boolean | null
  canSelfPublishRoutes?: boolean | null
}

export type AccessRow =
  /** A CRM administrator: the whole organization, no card involved. */
  | { kind: "organization"; user: AccessUser }
  /** The module is hidden from this person in their user card. */
  | { kind: "hidden"; user: AccessUser }
  /** Works as this card. */
  | { kind: "card"; user: AccessUser; card: AccessCard; role: FieldCardRole }
  /**
   * No card: the module refuses them. `reusable` is an unlinked card that is
   * plainly the same person (same email) — granting access links it instead of
   * making a second card for someone who already reports from the field.
   */
  | { kind: "none"; user: AccessUser; reusable: AccessCard | null }

export const ACCESS_NONE = "none"
export type AccessChoice = FieldCardRole | typeof ACCESS_NONE

const oldestFirst = (a: AccessCard, b: AccessCard) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)

export function buildAccessRoster(
  users: readonly AccessUser[],
  cards: readonly AccessCard[],
): { rows: AccessRow[]; mobileOnly: number } {
  const active = cards.filter((card) => card.status === "ACTIVE")
  const reused = new Set<string>()
  const rows = users
    .filter((user) => user.isActive)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((user): AccessRow => {
      // The card this login acts as: its oldest ACTIVE one, as the resolver picks.
      const card = active.filter((candidate) => candidate.userId === user.id).sort(oldestFirst)[0] ?? null
      const outcome = fieldAccessOutcome(user.role, card)
      if (outcome.kind === "organization") return { kind: "organization", user }
      if (effectiveHiddenModules(user.role, user.hiddenModules).includes("mtm")) return { kind: "hidden", user }
      if (outcome.kind === "card" && card) return { kind: "card", user, card, role: outcome.role }
      const email = user.email.trim().toLowerCase()
      const reusable = active
        .filter((candidate) => candidate.userId === null && candidate.email?.trim().toLowerCase() === email)
        .sort(oldestFirst)[0] ?? null
      if (reusable) reused.add(reusable.id)
      return { kind: "none", user, reusable }
    })
  const mobileOnly = active.filter((card) => card.userId === null && !reused.has(card.id)).length
  return { rows, mobileOnly }
}

export function accessChoiceOf(row: AccessRow): AccessChoice | null {
  if (row.kind === "card") return row.role
  if (row.kind === "none") return ACCESS_NONE
  return null
}

export interface AccessWrite {
  url: string
  method: "POST" | "PUT"
  body: Record<string, unknown>
}

/** The writes that take `row` to `choice`. Empty when nothing changes or nothing can. */
export function accessWrites(row: AccessRow, choice: AccessChoice): AccessWrite[] {
  if (choice !== ACCESS_NONE && !FIELD_CARD_ROLES.includes(choice)) return []
  if (row.kind === "card") {
    if (choice === row.role) return []
    const url = `/api/v1/mtm/agents/${row.card.id}`
    // Taking access away unlinks the login; the card and its history stay.
    return [{ url, method: "PUT", body: choice === ACCESS_NONE ? { userId: null } : { role: choice } }]
  }
  if (row.kind === "none") {
    if (choice === ACCESS_NONE) return []
    return row.reusable
      ? [{ url: `/api/v1/mtm/agents/${row.reusable.id}`, method: "PUT", body: { userId: row.user.id, role: choice } }]
      : [{ url: "/api/v1/mtm/agents", method: "POST", body: { name: row.user.name, role: choice, userId: row.user.id } }]
  }
  return []
}
