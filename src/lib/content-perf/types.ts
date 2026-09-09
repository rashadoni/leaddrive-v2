/**
 * M10 Content Performance AI — shared enum-as-const declarations.
 *
 * Mirrors the DB CHECK constraints in
 * `prisma/migrations/20260529140000_add_m10_content_score/migration.sql`.
 * Drift between this file and the DB CHECK list surfaces as opaque
 * constraint-violation 500s — bump both in one commit.
 */

export const CONTENT_ENTITY_TYPES = [
  "email_template",
  "campaign",
  "campaign_variant",
] as const

export type ContentEntityType = (typeof CONTENT_ENTITY_TYPES)[number]
