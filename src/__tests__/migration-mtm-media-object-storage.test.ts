import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const migration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829090000_mtm_media_object_storage_foundation/migration.sql",
), "utf8")
const relationMetadataMigration = readFileSync(join(
  process.cwd(),
  "prisma/migrations/20260829120000_mtm_media_object_prisma_relation_uniqueness/migration.sql",
), "utf8")
const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8")

describe("MTM media object storage migration", () => {
  it("is additive and keeps v1 photo/document storage intact", () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS "mtm_media_objects"')
    expect(migration).not.toContain('ALTER TABLE "mtm_photos"')
    expect(migration).not.toContain('ALTER TABLE "mtm_documents"')
    expect(migration).not.toContain('DROP TABLE')
    expect(schema).toContain("mediaObject MtmMediaObject?")
    expect(schema).toContain("storageKey        String")
  })

  it("enforces tenant safety and retention fences from first deployment", () => {
    expect(migration).toContain('FOREIGN KEY ("organizationId", "uploaderAgentId") REFERENCES "mtm_agents"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "photoId") REFERENCES "mtm_photos"("organizationId", "id")')
    expect(migration).toContain('FOREIGN KEY ("organizationId", "documentId") REFERENCES "mtm_documents"("organizationId", "id")')
    expect(migration).toContain('ALTER TABLE "mtm_media_objects" ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('ALTER TABLE "mtm_media_objects" FORCE ROW LEVEL SECURITY')
    expect(migration).toContain('CREATE POLICY tenant_isolation ON "mtm_media_objects"')
    expect(migration).toContain('"mtm_media_objects_state_check"')
    expect(migration).toContain('"mtm_media_objects_relation_kind_check"')
  })

  it("pins a single mobile idempotency authority and never cascades media deletion", () => {
    expect(migration).toContain('"mtm_media_objects_organizationId_uploaderAgentId_clientMediaId_key"')
    expect(migration).toContain('ON DELETE RESTRICT ON UPDATE CASCADE')
    expect(schema).toContain("@@unique([organizationId, uploaderAgentId, clientMediaId])")
  })

  it("keeps tenant-scoped one-to-one metadata additive without weakening media ownership", () => {
    expect(schema).toContain("@@unique([organizationId, photoId])")
    expect(schema).toContain("@@unique([organizationId, documentId])")
    expect(relationMetadataMigration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_organizationId_photoId_key"')
    expect(relationMetadataMigration).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "mtm_media_objects_organizationId_documentId_key"')
    expect(relationMetadataMigration).not.toContain("DROP ")
    expect(relationMetadataMigration).not.toContain("ALTER TABLE")
  })
})
