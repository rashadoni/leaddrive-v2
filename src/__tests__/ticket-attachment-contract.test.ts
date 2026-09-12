import { readFileSync } from "fs"
import path from "path"
import { describe, expect, it } from "vitest"

const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf8")

describe("ticket attachment persistence and access contract", () => {
  it("keeps schema and migration guarantees aligned", () => {
    const schema = read("prisma/schema.prisma")
    const migration = read("prisma/migrations/20260904233000_add_ticket_attachments_and_comment_idempotency/migration.sql")
    const rlsMigration = read("prisma/migrations/20260912203500_ticket_attachments_rls/migration.sql")

    expect(schema).toContain("model TicketAttachment")
    expect(schema).toContain("@@unique([organizationId, fileName])")
    expect(schema).toContain("@@unique([ticketId, clientRequestId])")
    expect(schema).toContain("@@index([organizationId, ticketId, commentId])")
    expect(migration).toContain('CREATE TABLE "ticket_attachments"')
    expect(migration).toContain('REFERENCES "tickets"("id") ON DELETE CASCADE')
    expect(migration).toContain('REFERENCES "ticket_comments"("id") ON DELETE SET NULL')
    expect(migration).toContain('CREATE UNIQUE INDEX "ticket_comments_ticketId_clientRequestId_key"')
    expect(rlsMigration).toContain('ALTER TABLE "ticket_attachments" ENABLE ROW LEVEL SECURITY')
    expect(rlsMigration).toContain('ALTER TABLE "ticket_attachments" FORCE ROW LEVEL SECURITY')
    expect(rlsMigration).toContain('CREATE POLICY tenant_isolation ON "ticket_attachments"')
    expect(rlsMigration).toMatch(/USING \("organizationId" = current_setting\('app\.org_id', true\)\)/)
    expect(rlsMigration).toMatch(/WITH CHECK \("organizationId" = current_setting\('app\.org_id', true\)\)/)
    expect(rlsMigration).not.toContain("app.rls_bypass")
  })

  it("requires ticket RBAC and tenant ownership before serving bytes", () => {
    const policy = read("src/lib/upload-path-policy.ts")
    const proxy = read("src/app/api/v1/uploads/[...path]/route.ts")

    expect(policy).toMatch(/PROXIED_UPLOAD_SUBDIRS\s*=\s*\[[\s\S]*?"tickets"/)
    expect(proxy).toContain('["tickets", "tickets"]')
    expect(proxy).toMatch(/subdir === "tickets"[\s\S]*?ticketAttachment\.findFirst\([\s\S]*?organizationId: auth\.orgId/)
  })
})
