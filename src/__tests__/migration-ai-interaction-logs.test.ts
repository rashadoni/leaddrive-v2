import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const PRE_PHASE4 = "20260406195000_create_ai_interaction_logs"
const PHASE4 = "20260406200000_phase4_enterprise_features"
const PRE_AGENT_PASSWORD = "20260410145000_create_mtm_agents"
const AGENT_PASSWORD = "20260410150000_add_agent_password"
const PRE_PROJECT_FKS = "20260414180000_create_project_management"
const PROJECT_FKS = "20260414181533_add_project_fk_relations"
const PRE_AI_ALERT_INDEX = "20260414205000_create_ai_alerts"
const AI_ALERT_INDEX = "20260414210000_add_ai_alert_index"
const MTM_CORE = "20260511190000_create_mtm_core_tables"
const MTM_PHASE2 = "20260512_mtm_phase2_schema"
const PRE_EMAIL_INSIGHTS = "20260517065000_create_email_logs"
const EMAIL_INSIGHTS = "20260517070000_email_log_insights"
const PRE_INVENTORY = "20260517205000_create_products"
const INVENTORY = "20260517210000_inventory"
const HEALTH = "20260518120000_health"
const PRE_REVENUE_INTELLIGENCE = "20260520095000_create_pipelines"
const REVENUE_INTELLIGENCE = "20260520100000_revenue_intelligence"
const LEGACY_MTM_ORDERS = "20260521145000_create_legacy_mtm_orders"
const MTM_SOFT_DELETE = "20260521150000_mtm_soft_delete"
const BILLING_CORE = "20260525255000_create_legacy_billing_core"
const INVOICE_DECIMAL = "20260525260000_invoice_money_decimal"
const PRE_UPLOAD_INDEX = "20260528035000_create_contract_files"
const UPLOAD_INDEX = "20260528040000_uploads_cross_tenant_indices"
const PRE_CONVERSATION_SNOOZE = "20260606115000_create_social_conversations"
const CONVERSATION_SNOOZE = "20260606120000_add_social_conversation_snoozed_until"
const PRE_LEAD_INTERACTIONS = "20260607255000_create_channel_messages"
const LEAD_INTERACTIONS = "20260607260000_lead_interaction_links"
const PRE_ATTRIBUTION_WRITEPATH = "20260613190000_create_events"
const ATTRIBUTION_WRITEPATH = "20260614000000_attribution_writepath"
const PRE_CALL_PROVIDER_ARCH = "20260628105000_add_call_log_provider"
const CALL_PROVIDER_ARCH = "20260628110000_call_provider_session_architecture"
const PRE_CHANNEL_CONNECTIONS = "20260630205000_add_channel_config_provider_fields"
const CHANNEL_CONNECTIONS = "20260630210000_add_channel_connections"

describe("fresh database AI interaction migration order", () => {
  it("creates the base table idempotently before Phase 4 alters it", () => {
    expect(PRE_PHASE4.localeCompare(PHASE4)).toBeLessThan(0)

    const sql = readFileSync(resolve("prisma/migrations", PRE_PHASE4, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ai_interaction_logs"')
    expect(sql).toContain('CONSTRAINT "ai_interaction_logs_pkey" PRIMARY KEY ("id")')
    expect(sql).not.toContain('"agentConfigId"')
    expect(sql).not.toContain('"agentType"')

    const phase4 = readFileSync(resolve("prisma/migrations", PHASE4, "migration.sql"), "utf8")
    expect(phase4).toContain('ALTER TABLE "ai_interaction_logs" ADD COLUMN "agentConfigId" TEXT')
    expect(phase4).toContain('ALTER TABLE "ai_interaction_logs" ADD COLUMN "agentType" TEXT')
  })

  it("creates MTM agents before the password migration alters the table", () => {
    expect(PRE_AGENT_PASSWORD.localeCompare(AGENT_PASSWORD)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_AGENT_PASSWORD, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "mtm_agents"')
    expect(sql).toContain('CREATE TYPE "MtmAgentRole"')
    expect(sql).not.toContain('"passwordHash"')

    const next = readFileSync(resolve("prisma/migrations", AGENT_PASSWORD, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "mtm_agents" ADD COLUMN "passwordHash" TEXT')
  })

  it("creates project tables before the FK-only migration", () => {
    expect(PRE_PROJECT_FKS.localeCompare(PROJECT_FKS)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_PROJECT_FKS, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "projects"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "project_tasks"')
    expect(sql).not.toContain('CONSTRAINT "projects_managerId_fkey"')
    expect(sql).not.toContain('CONSTRAINT "projects_dealId_fkey"')

    const next = readFileSync(resolve("prisma/migrations", PROJECT_FKS, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "projects" ADD CONSTRAINT "projects_managerId_fkey"')
    expect(next).toContain('ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_assignedTo_fkey"')
  })

  it("creates AI alerts before the index-only migration", () => {
    expect(PRE_AI_ALERT_INDEX.localeCompare(AI_ALERT_INDEX)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_AI_ALERT_INDEX, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ai_alerts"')
    expect(sql).not.toContain('"ai_alerts_organizationId_type_createdAt_idx"')

    const next = readFileSync(resolve("prisma/migrations", AI_ALERT_INDEX, "migration.sql"), "utf8")
    expect(next).toContain('CREATE INDEX "ai_alerts_organizationId_type_createdAt_idx"')
  })

  it("creates MTM core tables before the first guarded delta", () => {
    expect(MTM_CORE.localeCompare(MTM_PHASE2)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", MTM_CORE, "migration.sql"), "utf8")
    for (const table of ["mtm_customers", "mtm_routes", "mtm_visits", "mtm_photos", "mtm_audit_logs"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`)
    }
    expect(sql).not.toContain('"geofenceRadius"')
    expect(sql).not.toContain('"metadataKind"')
    expect(sql).not.toContain('"deletedAt"')

    const next = readFileSync(resolve("prisma/migrations", MTM_PHASE2, "migration.sql"), "utf8")
    expect(next).toContain('ADD COLUMN IF NOT EXISTS "geofenceRadius"')
    expect(next).toContain('ADD COLUMN IF NOT EXISTS "metadataKind"')
  })

  it("creates email logs before insight columns are added", () => {
    expect(PRE_EMAIL_INSIGHTS.localeCompare(EMAIL_INSIGHTS)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_EMAIL_INSIGHTS, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "email_logs"')
    expect(sql).not.toContain('"insights"')
    expect(sql).not.toContain('"leadId"')

    const next = readFileSync(resolve("prisma/migrations", EMAIL_INSIGHTS, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "email_logs" ADD COLUMN "insights" JSONB')
  })

  it("creates products before inventory adds its product FK", () => {
    expect(PRE_INVENTORY.localeCompare(INVENTORY)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_INVENTORY, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "products"')
    expect(sql).not.toContain('"sku"')
    expect(sql).not.toContain('"productType"')

    const next = readFileSync(resolve("prisma/migrations", INVENTORY, "migration.sql"), "utf8")
    expect(next).toContain('REFERENCES "products"("id")')
  })

  it("does not add the encounter FK before health_encounters exists", () => {
    const sql = readFileSync(resolve("prisma/migrations", HEALTH, "migration.sql"), "utf8")
    const guard = sql.indexOf("to_regclass('public.health_encounters')")
    const create = sql.indexOf('CREATE TABLE "health_encounters"')
    expect(guard).toBeGreaterThan(-1)
    expect(create).toBeGreaterThan(guard)
    expect(sql).toContain("20260519230000_fix_health_fk_order")
  })

  it("creates pipelines before revenue intelligence references them", () => {
    expect(PRE_REVENUE_INTELLIGENCE.localeCompare(REVENUE_INTELLIGENCE)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_REVENUE_INTELLIGENCE, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "pipelines"')
    expect(sql).toContain('ALTER TABLE "pipeline_stages" ADD COLUMN IF NOT EXISTS "pipelineId" TEXT')

    const next = readFileSync(resolve("prisma/migrations", REVENUE_INTELLIGENCE, "migration.sql"), "utf8")
    expect(next).toContain('REFERENCES "pipelines"("id")')
  })

  it("provides the transient MTM orders table required by legacy deltas", () => {
    expect(LEGACY_MTM_ORDERS.localeCompare(MTM_SOFT_DELETE)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", LEGACY_MTM_ORDERS, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "mtm_orders"')
    expect(sql).toContain('"totalAmount" DOUBLE PRECISION')

    const next = readFileSync(resolve("prisma/migrations", MTM_SOFT_DELETE, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "mtm_orders"')
  })

  it("creates billing Float columns before Decimal conversion migrations", () => {
    expect(BILLING_CORE.localeCompare(INVOICE_DECIMAL)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", BILLING_CORE, "migration.sql"), "utf8")
    for (const table of ["invoices", "invoice_items", "invoice_payments", "bills", "bill_payments"]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`)
    }
    expect(sql).toContain('"totalAmount" DOUBLE PRECISION')

    const next = readFileSync(resolve("prisma/migrations", INVOICE_DECIMAL, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "invoices"')
    expect(next).toContain('TYPE NUMERIC(18, 4)')
  })

  it("creates contract files before upload ownership uniqueness is added", () => {
    expect(PRE_UPLOAD_INDEX.localeCompare(UPLOAD_INDEX)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_UPLOAD_INDEX, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "contract_files"')
    expect(sql).not.toContain('contract_files_organizationId_fileName_key')

    const next = readFileSync(resolve("prisma/migrations", UPLOAD_INDEX, "migration.sql"), "utf8")
    expect(next).toContain('ADD CONSTRAINT "contract_files_organizationId_fileName_key"')
  })

  it("creates social conversations before inbox deltas", () => {
    expect(PRE_CONVERSATION_SNOOZE.localeCompare(CONVERSATION_SNOOZE)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_CONVERSATION_SNOOZE, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "social_conversations"')
    expect(sql).not.toContain('"snoozedUntil"')
    expect(sql).not.toContain('"aiReplyClaimToken"')
    expect(sql).not.toContain('"tags"')

    const next = readFileSync(resolve("prisma/migrations", CONVERSATION_SNOOZE, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "social_conversations" ADD COLUMN "snoozedUntil"')
  })

  it("creates channel messages before lead timeline links", () => {
    expect(PRE_LEAD_INTERACTIONS.localeCompare(LEAD_INTERACTIONS)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_LEAD_INTERACTIONS, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "channel_messages"')
    expect(sql).not.toContain('"leadId"')

    const next = readFileSync(resolve("prisma/migrations", LEAD_INTERACTIONS, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "channel_messages" ADD COLUMN "leadId" TEXT')
  })

  it("creates events before attribution adds campaign ownership", () => {
    expect(PRE_ATTRIBUTION_WRITEPATH.localeCompare(ATTRIBUTION_WRITEPATH)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_ATTRIBUTION_WRITEPATH, "migration.sql"), "utf8")
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "events"')
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "event_participants"')
    expect(sql).not.toContain('"campaignId"')

    const next = readFileSync(resolve("prisma/migrations", ATTRIBUTION_WRITEPATH, "migration.sql"), "utf8")
    expect(next).toContain('ALTER TABLE "events" ADD COLUMN "campaignId" TEXT')
  })

  it("adds call provider before provider-session indexes use it", () => {
    expect(PRE_CALL_PROVIDER_ARCH.localeCompare(CALL_PROVIDER_ARCH)).toBeLessThan(0)
    const sql = readFileSync(resolve("prisma/migrations", PRE_CALL_PROVIDER_ARCH, "migration.sql"), "utf8")
    expect(sql).toContain('ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT \'twilio\'')

    const next = readFileSync(resolve("prisma/migrations", CALL_PROVIDER_ARCH, "migration.sql"), "utf8")
    expect(next).toContain('ON "call_logs" ("organizationId", "provider", "status")')
  })

  it("adds legacy channel config fields before channel connection backfill", () => {
    expect(PRE_CHANNEL_CONNECTIONS.localeCompare(CHANNEL_CONNECTIONS)).toBeLessThan(0)
    const prerequisite = readFileSync(
      resolve("prisma/migrations", PRE_CHANNEL_CONNECTIONS, "migration.sql"),
      "utf8",
    )
    expect(prerequisite).toContain('ADD COLUMN IF NOT EXISTS "settings" JSONB')

    const sql = readFileSync(resolve("prisma/migrations", CHANNEL_CONNECTIONS, "migration.sql"), "utf8")
    expect(sql).toContain("'baseUrl', \"settings\"->>'baseUrl'")
  })
})
