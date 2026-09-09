import type { ModuleId } from "@/lib/modules"

/**
 * Source-of-truth profiles from ADR-001:
 * A = event-sourced aggregate, B = transactional state plus domain event,
 * C = immutable provider/ingress receipt.
 */
export const EVENT_SOURCE_PROFILES = ["A", "B", "C"] as const
export type EventSourceProfile = (typeof EVENT_SOURCE_PROFILES)[number]

export const EVENT_MIGRATION_WAVES = [0, 1, 2, 3, 4, 5] as const
export type EventMigrationWave = (typeof EVENT_MIGRATION_WAVES)[number]

/** Action-like permission arguments are deliberately not business domains. */
export const BUSINESS_UNGATED_EVENT_SCOPES = [
  "commerce",
  "data-cloud",
  "education",
  "financial-services",
  "nonprofit",
  "revenue-recognition",
  "tpm",
] as const
export type BusinessUngatedEventScope =
  (typeof BUSINESS_UNGATED_EVENT_SCOPES)[number]

export type EventGovernanceScope = ModuleId | BusinessUngatedEventScope

export type EventDomainImplementation =
  | Readonly<{
      status: "planned"
    }>
  | Readonly<{
      status: "implemented"
      /**
       * An implemented entry can still be a narrow pilot. These boundaries
       * prevent a pilot from claiming that its entire product module migrated.
       */
      boundaries: readonly string[]
    }>

export interface EventDomainCatalogEntry {
  /** Stable governance identity; it must not be reused when a UI label changes. */
  readonly domainId: string
  readonly title: string
  /** Product/permission vocabulary covered by this domain. */
  readonly scopes: readonly EventGovernanceScope[]
  readonly profiles: readonly EventSourceProfile[]
  readonly migrationWave: EventMigrationWave
  readonly implementation: EventDomainImplementation
}

const planned = { status: "planned" } as const

/**
 * Machine-readable event-platform adoption boundary.
 *
 * A module or intentionally ungated business vertical must be represented
 * here before it can ship. "implemented" is intentionally narrow: today it
 * describes only the Finance Fund aggregate pilot, not all of Finance.
 */
export const EVENT_DOMAIN_CATALOG = [
  {
    domainId: "crm",
    title: "CRM",
    scopes: ["crm"],
    profiles: ["B"],
    migrationWave: 3,
    implementation: planned,
  },
  {
    domainId: "sales",
    title: "Sales",
    scopes: ["sales"],
    profiles: ["A", "B"],
    migrationWave: 3,
    implementation: planned,
  },
  {
    domainId: "contracts",
    title: "Contracts",
    scopes: ["contracts"],
    profiles: ["A", "B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "marketing",
    title: "Marketing",
    scopes: ["marketing"],
    profiles: ["B", "C"],
    migrationWave: 3,
    implementation: planned,
  },
  {
    domainId: "loyalty",
    title: "Loyalty",
    scopes: ["loyalty"],
    profiles: ["A"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "omnichannel",
    title: "Omnichannel",
    scopes: ["omnichannel"],
    profiles: ["B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "social",
    title: "Social monitoring and legal",
    scopes: ["social"],
    profiles: ["A", "B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "voip",
    title: "VoIP and telephony",
    scopes: ["voip"],
    profiles: ["B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "support",
    title: "Support",
    scopes: ["support"],
    profiles: ["A", "B"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "finance",
    title: "Finance",
    scopes: ["finance"],
    profiles: ["A", "B", "C"],
    migrationWave: 2,
    implementation: {
      status: "implemented",
      boundaries: ["fund"],
    },
  },
  {
    domainId: "analytics",
    title: "Analytics and reports",
    scopes: ["analytics"],
    profiles: ["B"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "mtm",
    title: "Route, field force, workforce, and pharmacy promotion",
    scopes: ["mtm"],
    profiles: ["A", "B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "health",
    title: "Health Cloud",
    scopes: ["health"],
    profiles: ["B", "C"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "insurance",
    title: "Insurance Cloud",
    scopes: ["insurance"],
    profiles: ["A", "B", "C"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "public-sector",
    title: "Public Sector Cloud",
    scopes: ["public-sector"],
    profiles: ["A", "B"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "media",
    title: "Media Cloud",
    scopes: ["media"],
    profiles: ["B", "C"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "energy",
    title: "Energy and Utilities",
    scopes: ["energy"],
    profiles: ["B", "C"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "settings",
    title: "Platform tenancy, settings, metadata, and workflows",
    scopes: ["settings"],
    profiles: ["A", "B"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "ai",
    title: "AI and automation",
    scopes: ["ai"],
    profiles: ["B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "sms-otp",
    title: "Authentication and SMS OTP",
    scopes: ["sms-otp"],
    profiles: ["B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "commerce",
    title: "Commerce and inventory",
    scopes: ["commerce"],
    profiles: ["A", "B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "data-cloud",
    title: "Data Cloud",
    scopes: ["data-cloud"],
    profiles: ["B"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "education",
    title: "Education Cloud",
    scopes: ["education"],
    profiles: ["A", "B"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "financial-services",
    title: "Financial Services Cloud",
    scopes: ["financial-services"],
    profiles: ["B", "C"],
    migrationWave: 4,
    implementation: planned,
  },
  {
    domainId: "nonprofit",
    title: "Nonprofit",
    scopes: ["nonprofit"],
    profiles: ["A", "B"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "revenue-recognition",
    title: "Revenue recognition",
    scopes: ["revenue-recognition"],
    profiles: ["A"],
    migrationWave: 2,
    implementation: planned,
  },
  {
    domainId: "tpm",
    title: "Trade promotion management",
    scopes: ["tpm"],
    profiles: ["A", "B", "C"],
    migrationWave: 2,
    implementation: planned,
  },
] as const satisfies readonly EventDomainCatalogEntry[]
