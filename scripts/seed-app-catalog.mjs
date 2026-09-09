// Idempotent seed for the global app marketplace catalog.
//
// Usage:
//   node scripts/seed-app-catalog.mjs            # dry-run
//   node scripts/seed-app-catalog.mjs --execute  # upsert catalog rows

import { makeScriptPrisma } from "./_rls.mjs"

const prisma = await makeScriptPrisma()

const FIRST_PARTY_CATALOG = [
  {
    slug: "slack-deal-notifier",
    name: "Slack Deal Notifier",
    version: "1.0.0",
    summary: "Post a Slack message every time a deal is won.",
    vendor: "LeadDrive Inc",
    category: "Integrations",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        eventSubscriptions: [
          {
            ref: "deal_won_subscription",
            eventName: "deal_won",
          },
        ],
        webhookSubscriptions: [
          {
            ref: "slack_post_message",
            eventNames: ["deal_won"],
            targetUrl: "https://slack.com/api/chat.postMessage",
            credentialRef: "slack_bot",
          },
        ],
        settingsKeys: [
          {
            key: "channel",
            label: "Slack channel (e.g. #sales-wins)",
            type: "string",
            required: false,
            defaultValue: "#sales-wins",
          },
        ],
      },
      requirements: {
        namedCredentialNames: ["slack_bot"],
      },
    },
  },
  {
    slug: "stripe-webhook-bridge",
    name: "Stripe Webhook Bridge",
    version: "1.0.0",
    summary: "Receive Stripe webhooks + add a stripeCustomerId field to Company.",
    vendor: "LeadDrive Inc",
    category: "Finance",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "company",
            fieldName: "stripe_customer_id",
            fieldLabel: "Stripe Customer ID",
            fieldType: "string",
            required: false,
          },
        ],
        eventSubscriptions: [
          {
            ref: "stripe_event_subscription",
            eventName: "stripe_event",
          },
        ],
        settingsKeys: [
          {
            key: "webhook_secret",
            label: "Stripe webhook signing secret",
            type: "secret",
            required: true,
          },
          {
            key: "mode",
            label: "Mode (test/live)",
            type: "string",
            required: false,
            defaultValue: "test",
          },
        ],
      },
    },
  },
  {
    slug: "customer-health-score",
    name: "Customer Health Score",
    version: "1.0.0",
    summary: "Track a numeric customer-health score on every Company.",
    vendor: "LeadDrive Inc",
    category: "Service",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "company",
            fieldName: "health_score",
            fieldLabel: "Health Score",
            fieldType: "number",
            required: false,
          },
          {
            entityType: "company",
            fieldName: "health_tier",
            fieldLabel: "Health Tier",
            fieldType: "select",
            required: false,
            options: ["red", "yellow", "green"],
          },
        ],
      },
    },
  },
  {
    slug: "lead-scoring-rules",
    name: "Lead Scoring Rules",
    version: "1.0.0",
    summary: "Score leads by engagement, source quality, and sales readiness.",
    vendor: "LeadDrive Inc",
    category: "Sales",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "lead",
            fieldName: "ai_score",
            fieldLabel: "AI Score",
            fieldType: "number",
            required: false,
          },
          {
            entityType: "lead",
            fieldName: "score_tier",
            fieldLabel: "Score Tier",
            fieldType: "select",
            required: false,
            options: ["hot", "warm", "cold"],
          },
        ],
        eventSubscriptions: [
          {
            ref: "lead_score_recompute",
            eventName: "lead_updated",
            codeModuleSlug: "lead_scoring",
          },
        ],
      },
    },
  },
  {
    slug: "duplicate-lead-guard",
    name: "Duplicate Lead Guard",
    version: "1.0.0",
    summary: "Flag likely duplicate leads before agents work the same customer twice.",
    vendor: "LeadDrive Inc",
    category: "Data Quality",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "lead",
            fieldName: "duplicate_risk",
            fieldLabel: "Duplicate Risk",
            fieldType: "number",
            required: false,
          },
          {
            entityType: "lead",
            fieldName: "matched_lead_id",
            fieldLabel: "Matched Lead ID",
            fieldType: "string",
            required: false,
          },
        ],
        eventSubscriptions: [
          {
            ref: "duplicate_lead_scan",
            eventName: "lead_created",
            codeModuleSlug: "duplicate_guard",
          },
        ],
      },
    },
  },
  {
    slug: "sla-escalation-pack",
    name: "SLA Escalation Pack",
    version: "1.0.0",
    summary: "Track ticket SLA state and escalate aging requests to the right queue.",
    vendor: "LeadDrive Inc",
    category: "Support",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "ticket",
            fieldName: "sla_due_at",
            fieldLabel: "SLA Due At",
            fieldType: "date",
            required: false,
          },
          {
            entityType: "ticket",
            fieldName: "sla_state",
            fieldLabel: "SLA State",
            fieldType: "select",
            required: false,
            options: ["ok", "warning", "breached"],
          },
        ],
        eventSubscriptions: [
          {
            ref: "sla_escalation_watch",
            eventName: "ticket_updated",
            codeModuleSlug: "sla_escalation",
          },
        ],
      },
    },
  },
  {
    slug: "whatsapp-conversation-sync",
    name: "WhatsApp Conversation Sync",
    version: "1.0.0",
    summary: "Attach WhatsApp conversation signals to customer and lead records.",
    vendor: "LeadDrive Inc",
    category: "Omni-channel",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "company",
            fieldName: "whatsapp_last_contact",
            fieldLabel: "WhatsApp Last Contact",
            fieldType: "date",
            required: false,
          },
          {
            entityType: "lead",
            fieldName: "whatsapp_opt_in",
            fieldLabel: "WhatsApp Opt-in",
            fieldType: "boolean",
            required: false,
          },
        ],
        eventSubscriptions: [
          {
            ref: "whatsapp_signal_sync",
            eventName: "conversation_received",
            codeModuleSlug: "whatsapp_sync",
          },
        ],
      },
    },
  },
  {
    slug: "campaign-attribution-kit",
    name: "Campaign Attribution Kit",
    version: "1.0.0",
    summary: "Preserve UTM source, campaign, and ROI hints from first touch to deal.",
    vendor: "LeadDrive Inc",
    category: "Marketing",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "lead",
            fieldName: "utm_source",
            fieldLabel: "UTM Source",
            fieldType: "string",
            required: false,
          },
          {
            entityType: "lead",
            fieldName: "utm_campaign",
            fieldLabel: "UTM Campaign",
            fieldType: "string",
            required: false,
          },
          {
            entityType: "deal",
            fieldName: "campaign_roi_hint",
            fieldLabel: "Campaign ROI Hint",
            fieldType: "number",
            required: false,
          },
        ],
      },
    },
  },
  {
    slug: "contract-renewal-alerts",
    name: "Contract Renewal Alerts",
    version: "1.0.0",
    summary: "Create renewal fields and trigger alerts before contracts expire.",
    vendor: "LeadDrive Inc",
    category: "Contracts",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "contract",
            fieldName: "renewal_date",
            fieldLabel: "Renewal Date",
            fieldType: "date",
            required: false,
          },
          {
            entityType: "contract",
            fieldName: "renewal_risk",
            fieldLabel: "Renewal Risk",
            fieldType: "select",
            required: false,
            options: ["low", "medium", "high"],
          },
        ],
        eventSubscriptions: [
          {
            ref: "contract_renewal_watch",
            eventName: "contract_updated",
            codeModuleSlug: "contract_renewal",
          },
        ],
      },
    },
  },
  {
    slug: "sales-forecast-snapshot",
    name: "Sales Forecast Snapshot",
    version: "1.0.0",
    summary: "Store forecast bucket and snapshot amount directly on every deal.",
    vendor: "LeadDrive Inc",
    category: "Analytics",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "forecast_snapshot_amount",
            fieldLabel: "Forecast Snapshot Amount",
            fieldType: "number",
            required: false,
          },
          {
            entityType: "deal",
            fieldName: "forecast_bucket",
            fieldLabel: "Forecast Bucket",
            fieldType: "select",
            required: false,
            options: ["commit", "best_case", "pipeline"],
          },
        ],
        eventSubscriptions: [
          {
            ref: "forecast_snapshot_refresh",
            eventName: "deal_updated",
            codeModuleSlug: "forecast_snapshot",
          },
        ],
      },
    },
  },
  {
    slug: "web-to-lead-capture-kit",
    name: "Web-to-Lead Capture Kit",
    version: "1.0.0",
    summary: "Add web form metadata and default routing settings for inbound leads.",
    vendor: "LeadDrive Inc",
    category: "Marketing",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "lead",
            fieldName: "web_form_id",
            fieldLabel: "Web Form ID",
            fieldType: "string",
            required: false,
          },
        ],
        settingsKeys: [
          {
            key: "source_label",
            label: "Default source label",
            type: "string",
            required: false,
            defaultValue: "Website",
          },
          {
            key: "auto_assign",
            label: "Auto-assign new web leads",
            type: "boolean",
            required: false,
            defaultValue: true,
          },
        ],
      },
    },
  },
  {
    slug: "audit-log-exporter",
    name: "Audit Log Exporter",
    version: "1.0.0",
    summary: "Forward security audit events to a SIEM or compliance archive.",
    vendor: "LeadDrive Inc",
    category: "Security",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        webhookSubscriptions: [
          {
            ref: "audit_log_export",
            eventNames: ["audit_event"],
            targetUrl: "https://integrations.leaddrivecrm.org/audit/export",
          },
        ],
        settingsKeys: [
          {
            key: "destination",
            label: "Destination name",
            type: "string",
            required: false,
            defaultValue: "SIEM",
          },
        ],
      },
    },
  },
  {
    slug: "field-visit-planner",
    name: "Field Visit Planner",
    version: "1.0.0",
    summary: "Add visit cadence fields for route and field-sales planning.",
    vendor: "LeadDrive Inc",
    category: "Field Sales",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "company",
            fieldName: "visit_frequency_days",
            fieldLabel: "Visit Frequency Days",
            fieldType: "number",
            required: false,
          },
          {
            entityType: "company",
            fieldName: "route_priority",
            fieldLabel: "Route Priority",
            fieldType: "select",
            required: false,
            options: ["a", "b", "c"],
          },
        ],
        eventSubscriptions: [
          {
            ref: "route_plan_refresh",
            eventName: "company_updated",
            codeModuleSlug: "field_visit_planner",
          },
        ],
      },
    },
  },
  {
    slug: "erp-order-sync",
    name: "ERP Order Sync",
    version: "1.0.0",
    summary: "Subscribe to order events and prepare outbound sync to ERP systems.",
    vendor: "LeadDrive Inc",
    category: "Operations",
    iconUrl: null,
    docsUrl: null,
    isPublic: true,
    manifest: {
      schemaVersion: 1,
      capabilities: {
        customFields: [
          {
            entityType: "deal",
            fieldName: "erp_order_id",
            fieldLabel: "ERP Order ID",
            fieldType: "string",
            required: false,
          },
        ],
        webhookSubscriptions: [
          {
            ref: "erp_order_sync",
            eventNames: ["order_created", "order_updated"],
            targetUrl: "https://integrations.leaddrivecrm.org/erp/orders",
          },
        ],
        settingsKeys: [
          {
            key: "sync_mode",
            label: "Sync mode",
            type: "string",
            required: false,
            defaultValue: "near_real_time",
          },
        ],
      },
    },
  },
]

async function main() {
  const execute = process.argv.includes("--execute")
  const mode = execute ? "EXECUTE" : "DRY-RUN"
  console.log(`[seed-app-catalog] mode=${mode}`)

  for (const app of FIRST_PARTY_CATALOG) {
    console.log(`  ${execute ? "upsert" : "would upsert"} ${app.slug}`)
    if (!execute) continue

    await prisma.app.upsert({
      where: { slug: app.slug },
      create: {
        slug: app.slug,
        name: app.name,
        version: app.version,
        summary: app.summary,
        vendor: app.vendor,
        category: app.category,
        iconUrl: app.iconUrl,
        docsUrl: app.docsUrl,
        isPublic: app.isPublic,
        isFirstParty: true,
        manifest: app.manifest,
      },
      update: {
        name: app.name,
        version: app.version,
        summary: app.summary,
        vendor: app.vendor,
        category: app.category,
        iconUrl: app.iconUrl,
        docsUrl: app.docsUrl,
        isPublic: app.isPublic,
        isFirstParty: true,
        manifest: app.manifest,
      },
    })
  }

  console.log(`[seed-app-catalog] done. apps=${FIRST_PARTY_CATALOG.length}`)
}

main()
  .catch((error) => {
    console.error("[seed-app-catalog] failed", error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
