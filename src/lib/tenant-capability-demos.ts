import { TENANT_CAPABILITY_CATALOG } from "@/lib/tenant-capabilities"

export interface TenantCapabilityDemo {
  capabilityId: string
  headline: string
  promise: string
  workflow: string[]
  sampleSignals: string[]
  guardrails: string[]
}

const DEFAULT_DEMO: Omit<TenantCapabilityDemo, "capabilityId"> = {
  headline: "Preview how this capability changes the tenant workflow.",
  promise: "The demo explains value and operating impact without enabling live behavior.",
  workflow: [
    "Review the tenant use case and required owner module.",
    "Request access from the marketplace.",
    "LeadDrive approves the entitlement from the superadmin panel.",
    "The capability appears in navigation only after approval.",
  ],
  sampleSignals: [
    "No customer data is changed during preview.",
    "No background jobs or integrations are started.",
    "No app installation rows are created by opening a demo.",
  ],
  guardrails: [
    "Live activation requires admin approval.",
    "Connector apps still require an install executor and rollback record.",
    "Disabled or hidden capabilities must remain preserved for audit.",
  ],
}

const DEMOS: Record<string, Omit<TenantCapabilityDemo, "capabilityId">> = {
  "route-field": {
    headline: "Coordinate field teams, visits, photos, route plans, and retail execution in one operational surface.",
    promise: "Route & Field turns CRM accounts into field work: who visits whom, what they must check, and what supervisors can verify.",
    workflow: [
      "Plan territories, routes, visit tasks, and agent assignments.",
      "Agents complete visits from mobile with photos, notes, orders, and GPS context.",
      "Supervisors track coverage, missed visits, alerts, and route performance.",
      "Managers review execution KPIs before changing the customer plan.",
    ],
    sampleSignals: [
      "Visit completion rate",
      "Photo evidence coverage",
      "Late route alerts",
      "Agent workload by territory",
    ],
    guardrails: [
      "Requires MTM entitlement before users see field modules.",
      "Mobile routes must keep explicit tenant checks.",
      "Disabling keeps visit history and photos for audit.",
    ],
  },
  "da-vinci-ai": {
    headline: "Turn CRM activity into recommendations, summaries, next actions, and controlled automation.",
    promise: "Da Vinci AI is an assistive layer: it should see only modules the tenant is entitled to use.",
    workflow: [
      "Read allowed CRM context and recent activity.",
      "Generate recommendations, summaries, or draft actions.",
      "Route risky actions through review mode before autopilot.",
      "Write audit events for security and compliance review.",
    ],
    sampleSignals: [
      "Recommended next best action",
      "Lead and deal scoring changes",
      "Support reply drafts",
      "Anomaly and briefing alerts",
    ],
    guardrails: [
      "AI tools must be filtered by tenant capability.",
      "Sensitive fields need redaction and audit logging.",
      "Autopilot should stay separate from review mode.",
    ],
  },
  "ai-security-monitoring": {
    headline: "Give security teams visibility into AI usage without breaking productive AI workflows.",
    promise: "Security monitoring records AI requests, risk flags, and retention controls while keeping the CRM features intact.",
    workflow: [
      "Capture AI request metadata and sensitivity indicators.",
      "Apply redaction or DLP policy before sending cloud requests.",
      "Expose audit views and export hooks for infosec.",
      "Alert on unusual volume, risky modules, or policy violations.",
    ],
    sampleSignals: [
      "Sensitive-field exposure attempts",
      "AI request volume by module",
      "Blocked prompt actions",
      "Retention and export status",
    ],
    guardrails: [
      "Do not alter AI prompts in ways that break hooks or analytics.",
      "Use observe mode before enforce mode.",
      "Keep retention policy explicit per tenant.",
    ],
  },
}

export function getTenantCapabilityDemo(capabilityId: string): TenantCapabilityDemo | null {
  const definition = TENANT_CAPABILITY_CATALOG.find((capability) => capability.id === capabilityId)
  if (!definition) return null
  return {
    capabilityId,
    ...(DEMOS[capabilityId] ?? DEFAULT_DEMO),
  }
}
