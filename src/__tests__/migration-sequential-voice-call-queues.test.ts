import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

const migration = readFileSync(
  join(process.cwd(), "prisma/migrations/20260810103000_sequential_voice_call_queues/migration.sql"),
  "utf8",
)

describe("sequential voice call queue migration", () => {
  it("ships one-active-queue and one-active-item database fences", () => {
    expect(migration).toContain('"voice_call_queues_org_active_org_key"')
    expect(migration).toContain('"voice_call_queue_items_org_active_org_key"')
    expect(migration).toContain('"voice_call_queue_items_org_active_owner_key"')
    expect(migration).toContain('"voice_call_queue_items_org_queued_lead_key"')
    expect(migration).toContain('"voice_call_queue_items_org_queued_phone_key"')
    expect(migration).toContain('"voice_call_sessions_org_active_organization_key"')
    expect(migration).toContain('"activeOrganizationKey" = "organizationId"')
    expect(migration).toContain('"activeOwnerKey" = "organizationId" || \':\' || "ownerUserId"')
  })

  it("keeps creation non-dispatching and all new tables tenant isolated", () => {
    expect(migration).toContain('"status" TEXT NOT NULL DEFAULT \'prepared\'')
    expect(migration).toContain('ALTER TABLE "voice_call_queues" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "voice_call_queue_items" FORCE ROW LEVEL SECURITY')
    expect(migration).not.toContain("voiceQueueEnabled=true")
  })
})
