import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATION = "20260716070000_mtm_mobile_messages_documents_hrm"
const sql = readFileSync(resolve("prisma/migrations", MIGRATION, "migration.sql"), "utf8")
const uploadRoute = readFileSync(resolve("src/app/api/v1/mtm/mobile/documents/upload/route.ts"), "utf8")
const deployScript = readFileSync(resolve("scripts/server-deploy.sh"), "utf8")
const documentStorage = readFileSync(resolve("src/lib/mtm/mobile-document.ts"), "utf8")

describe("MTM mobile messages, documents, and HRM migration", () => {
  it("creates every communication and HRM record", () => {
    for (const table of [
      "mtm_message_threads",
      "mtm_message_participants",
      "mtm_messages",
      "mtm_message_receipts",
      "mtm_documents",
      "mtm_document_assignments",
      "mtm_hrm_requests",
    ]) expect(sql).toContain(`CREATE TABLE "${table}"`)
  })

  it("pins durable mobile identities and direct-conversation uniqueness", () => {
    expect(sql).toContain("mtm_message_threads_organizationId_directKey_key")
    expect(sql).toContain("mtm_messages_organizationId_senderAgentId_clientMessageId_key")
    expect(sql).toContain("mtm_message_receipts_organizationId_agentId_clientReceiptId_key")
    expect(sql).toContain("mtm_documents_organizationId_clientDocumentId_key")
    expect(sql).toContain("mtm_hrm_requests_organizationId_agentId_clientRequestId_key")
  })

  it("forces tenant RLS on all seven tables", () => {
    expect(sql.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(7)
    expect(sql.match(/current_setting\('app\.org_id', true\)/g)).toHaveLength(14)
  })

  it("blocks executable/spoofed metadata and inconsistent HRM dates at the database boundary", () => {
    expect(sql).toContain("mtm_documents_size_check")
    expect(sql).toContain("mtm_documents_storage_key_check")
    expect(sql).toContain("mtm_messages_content_check")
    expect(sql).toContain("mtm_hrm_requests_dates_check")
    expect(sql).toContain("mtm_hrm_requests_correction_check")
  })

  it("keeps document bytes private and persistent across standalone deploys", () => {
    expect(uploadRoute).toContain("mobileDocumentStorageRoot")
    expect(uploadRoute).not.toContain('"public", "uploads"')
    expect(deployScript).toContain('MTM_DOCUMENT_STORAGE_DIR_RESOLVED="$(canonical_external_path')
    expect(deployScript).toContain('append_env_if_missing "MTM_DOCUMENT_STORAGE_DIR"')
    expect(documentStorage).toContain("MTM_DOCUMENT_STORAGE_DIR must stay inside the canonical production upload root")
  })
})
