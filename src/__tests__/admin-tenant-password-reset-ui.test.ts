import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const pageSource = readFileSync(
  path.resolve(__dirname, "../app/admin/tenants/[id]/page.tsx"),
  "utf8",
)
const componentSource = readFileSync(
  path.resolve(__dirname, "../app/admin/tenants/[id]/tenant-admin-password-reset.tsx"),
  "utf8",
)

describe("admin tenant password reset UI", () => {
  it("offers the action only for an explicitly selected tenant administrator", () => {
    expect(pageSource).toContain('user.role === "admin"')
    expect(pageSource).toContain("<TenantAdminPasswordReset")
    expect(componentSource).toContain("tenantId: string")
    expect(componentSource).toContain("user.email")
  })

  it("uses the dedicated cross-tenant route and never sends tenant context headers", () => {
    expect(componentSource).toContain(
      "`/api/v1/admin/tenants/${tenantId}/users/${user.id}/reset-password`",
    )
    expect(componentSource).not.toContain("x-organization-id")
  })

  it("pins the password constraints, explicit session warning, and accessible action", () => {
    expect(componentSource).toContain("minLength={12}")
    expect(componentSource).toContain("maxLength={72}")
    expect(componentSource).toContain('t("passwordResetConfirmation")')
    expect(componentSource).toContain('aria-label={t("passwordResetUserNamed"')
    expect(componentSource).toContain("data-dialog-initial-focus")
  })
})
