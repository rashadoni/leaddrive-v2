/**
 * How the activity journal names the object a record is about.
 *
 * Field UX audit 2026-09-05, task C12. The row used to read
 * `mtm_pharmacy_promotion_execution · 4f2a9c`: a table name and the last six
 * characters of an id. Neither is language, and the fragment is not even
 * enough to look the record up — it exists to look precise.
 *
 * Sixty-five different entity values are written across the codebase, most of
 * them internal. Translating all of them would be a dictionary nobody
 * maintains, so the rule is: name the handful a manager actually meets, and
 * call everything else a record. The id moves to the tooltip, where support
 * can still copy it without it shouting at everyone else.
 */
export const MTM_ACTIVITY_ENTITIES = [
  "visit",
  "task",
  "route",
  "agent",
  "customer",
  "contact",
  "photo",
  "workday",
  "document",
  "message",
] as const

export type MtmActivityEntity = (typeof MTM_ACTIVITY_ENTITIES)[number]

/** Singular, plural and prefixed spellings all mean the same object. */
export function mtmActivityEntityKey(entity: string | null | undefined): MtmActivityEntity | null {
  if (typeof entity !== "string") return null
  const normalized = entity.trim().toLowerCase().replace(/^mtm_/, "").replace(/s$/, "")
  return (MTM_ACTIVITY_ENTITIES as readonly string[]).includes(normalized)
    ? (normalized as MtmActivityEntity)
    : null
}

export type MtmActivityEntityText = {
  /** What the row says. Never a table name, never an id. */
  label: string
  /** Full id for the tooltip, or null when there is none. */
  title: string | null
}

/**
 * @param t translator scoped to the activity page namespace; it must know
 *   `entity.<name>` for the list above and `entity.record` for the rest.
 */
export function mtmActivityEntityText(
  entry: { entity?: string | null; entityId?: string | null },
  t: (key: string) => string,
): MtmActivityEntityText {
  const key = mtmActivityEntityKey(entry.entity)
  const id = typeof entry.entityId === "string" && entry.entityId.trim() ? entry.entityId.trim() : null
  return { label: t(key ? `entity.${key}` : "entity.record"), title: id }
}
