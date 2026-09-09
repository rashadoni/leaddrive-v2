import { describe, it, expect } from "vitest"
import { resolveModuleFromPath, checkPermission } from "@/lib/permissions"

// Security-critical: self-service "/users/me/*" routes MUST be ungated (module
// null) so non-admins can manage their OWN profile, while admin user-management
// ("/users", "/users/[id]") MUST stay gated by the `users` module.
describe("resolveModuleFromPath — self-service /me carve-out", () => {
  it("returns null for /users/me and its subpaths (no module RBAC)", () => {
    expect(resolveModuleFromPath("/api/v1/users/me")).toBeNull()
    expect(resolveModuleFromPath("/api/v1/users/me/change-password")).toBeNull()
    expect(resolveModuleFromPath("/api/v1/users/me/avatar")).toBeNull()
    expect(resolveModuleFromPath("/api/v1/users/me/revoke-sessions")).toBeNull()
    expect(resolveModuleFromPath("/api/v1/users/me/preferences")).toBeNull()
  })

  it("still gates admin user-management under the `users` module", () => {
    expect(resolveModuleFromPath("/api/v1/users")).toBe("users")
    expect(resolveModuleFromPath("/api/v1/users/clxabc123")).toBe("users")
  })

  it("path-confusion: only true /me routes are carved out — look-alikes stay gated (Codex)", () => {
    // No-slash look-alike user id that starts with "me" → NOT a /me route → must
    // still resolve to the `users` admin module (never accidentally ungated).
    expect(resolveModuleFromPath("/api/v1/users/meevil")).toBe("users")
    expect(resolveModuleFromPath("/api/v1/users/me-collab")).toBe("users")
    // Case variant is not our route → falls through to the users prefix (gated),
    // never silently ungated.
    expect(resolveModuleFromPath("/api/v1/users/ME")).toBe("users")
    // Encoded-slash traversal does not match startsWith("/api/v1/users/me/") →
    // stays gated (does NOT ungate an admin path).
    expect(resolveModuleFromPath("/api/v1/users/me%2F..%2Fclxadmin")).toBe("users")
  })

  it("consequence: a non-admin (sales/support) is denied admin user-management but the /me carve-out is ungated", () => {
    // sales/support have `users: []` → denied on the admin route…
    expect(checkPermission("sales", "users", "read")).toBe(false)
    expect(checkPermission("support", "users", "write")).toBe(false)
    // …and the /me path resolves to null, so requireAuth applies NO module check
    // (authentication alone gates it). Pinning the null return is the guarantee.
    expect(resolveModuleFromPath("/api/v1/users/me")).toBeNull()
  })
})
