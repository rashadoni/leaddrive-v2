// Plan-tier feature/addon defaults applied when provisioning a new tenant.
// DB PlanTemplate rows are canonical (getPlanDefaults in plan-templates.ts);
// this const is ONLY the DB-miss fallback for the 3 legacy keys. Features are
// in the GROUP-module vocabulary (narrow-union catalog) and MUST mirror
// scripts/seed-plan-templates.mjs exactly — the drift guards in
// lib-plan-catalog.test.ts fail CI when a key here leaves the catalog.
// IMPORTANT: when you ADD a feature to any `features` array below, also run
// `node scripts/backfill-plan-features.mjs --execute` on every active server
// (LeadDrive shared + each per-client server). Existing tenants are
// provisioned only once — the sidebar reads `Organization.features` directly,
// so a tenant created before the new feature was added won't see it until
// backfilled. The script is idempotent; re-running on already-up-to-date
// orgs is a no-op.
export const TENANT_PLANS = {
  starter: {
    maxUsers: 3,
    maxContacts: 500,
    // `sales` is a BASE group-module (deals/leads/quotes live there now) — every
    // plan, even starter, MUST include it or the tenant loses the pipeline.
    features: ["crm", "sales", "settings"] as string[],
    addons: [] as string[],
  },
  professional: {
    maxUsers: 25,
    maxContacts: 10000,
    features: [
      "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "support", "finance",
      "analytics", "settings", "whatsapp", "complaints_register",
    ] as string[],
    addons: ["ai", "channels"] as string[],
  },
  enterprise: {
    maxUsers: -1, // unlimited
    maxContacts: -1,
    features: [
      "crm", "sales", "contracts", "marketing", "loyalty", "omnichannel", "social",
      "voip", "support", "finance",
      "analytics", "mtm", "health", "insurance", "public-sector", "media",
      "energy", "settings", "whatsapp", "complaints_register",
    ] as string[],
    addons: ["ai", "channels", "finance", "mtm", "voip"] as string[],
  },
} as const

export type TenantPlan = keyof typeof TENANT_PLANS

// NOTE: getPlanDefaults moved to src/lib/plan-templates.ts (server-only, DB-backed).
// This file stays pure data (no prisma) so it remains importable from client components.

export const PLAN_LABELS: Record<TenantPlan, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
}
