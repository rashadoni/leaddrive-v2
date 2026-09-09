/**
 * T9 Proactive Service — shared enum-as-const declarations.
 *
 * Mirrors the DB CHECK constraints in
 * `prisma/migrations/20260529130000_add_t9_proactive_service/migration.sql`.
 * If you change one, change the other in the SAME commit — drift
 * between Prisma `String` columns and DB CHECK lists is silent until
 * a route layer sends a typo'd value that the DB rejects with an
 * opaque constraint-violation 500.
 *
 * Slice-2 cron + route layer should import from this file rather than
 * hand-typing strings. TypeScript narrowing via the `*Type` literal
 * unions catches typos at compile time.
 */

/** Polymorphic target — keys aligned to Prisma `@@map` table names
 *  (`contacts`, `companies`, `deals`) so slice-2 join logic can derive
 *  the source table directly. */
export const ENTITY_TYPES = ["contact", "company", "deal"] as const
export type EntityType = (typeof ENTITY_TYPES)[number]

/** Alert trigger taxonomy — slice-2 cron emits a fixed set; "custom"
 *  reserved for manual / API-triggered alerts so an admin tool can
 *  surface things outside the cron's purview. */
export const TRIGGER_TYPES = [
  "churn_risk",
  "health_drop",
  "engagement_low",
  "payment_overdue",
  "contract_expiring",
  "no_activity",
  "custom",
] as const
export type TriggerType = (typeof TRIGGER_TYPES)[number]

/** Alert severity — drives badge color + notification routing. */
export const SEVERITIES = ["info", "warning", "critical"] as const
export type Severity = (typeof SEVERITIES)[number]
