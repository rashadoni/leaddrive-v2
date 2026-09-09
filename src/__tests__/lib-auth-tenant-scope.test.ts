/**
 * Auth tenant-scoping (F-36) — regression net.
 *
 * `loginSchema` + `buildLoginUserWhere` + `buildJwtRefreshWhere` live in
 * `src/lib/auth-credentials.ts` and are imported by the NextAuth
 * `authorize()` callback at `src/lib/auth.ts`. The tests below import
 * the SAME functions, so a prod-side change (e.g. raising `min(8)` to
 * `min(12)`) immediately surfaces here.
 *
 * Coverage:
 *   • loginSchema: legacy / org-scoped / boundary rejections
 *   • buildLoginUserWhere: legacy bare filter / org-scoped join /
 *     multi-tenant isolation
 *   • buildJwtRefreshWhere: id-only lookup, null on missing sub
 *     (no email-fallback regression)
 *   • maskLegacyAuthEmail: PII-safe log signal
 */

import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import {
  loginSchema,
  buildLoginUserWhere,
  buildTenantLoginUserWhere,
  buildJwtRefreshWhere,
  maskLegacyAuthEmail,
  pickCandidateByPassword,
} from "@/lib/auth-credentials"

describe("loginSchema (real prod schema)", () => {
  it("accepts email + 8-char password without slug (legacy)", () => {
    const r = loginSchema.safeParse({ email: "a@b.com", password: "12345678" })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.organizationSlug).toBeUndefined()
  })

  it("accepts org-scoped credentials", () => {
    const r = loginSchema.safeParse({
      email: "admin@leaddrive.com",
      password: "demo1234",
      organizationSlug: "leaddrive",
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.organizationSlug).toBe("leaddrive")
  })

  it("rejects 7-char password (regression: the 401 that bit us mid-session)", () => {
    const r = loginSchema.safeParse({ email: "a@b.com", password: "demo123" })
    expect(r.success).toBe(false)
  })

  it("rejects malformed email", () => {
    const r = loginSchema.safeParse({ email: "not-an-email", password: "12345678" })
    expect(r.success).toBe(false)
  })

  it("rejects empty organizationSlug (treat as absent, not 'any org')", () => {
    const r = loginSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      organizationSlug: "",
    })
    expect(r.success).toBe(false)
  })

  it("rejects slug > 80 chars", () => {
    const r = loginSchema.safeParse({
      email: "a@b.com",
      password: "12345678",
      organizationSlug: "a".repeat(81),
    })
    expect(r.success).toBe(false)
  })
})

describe("buildLoginUserWhere (F-36 contract)", () => {
  it("legacy: no slug → bare email + isActive filter", () => {
    const where = buildLoginUserWhere({
      email: "a@b.com",
      password: "12345678",
    })
    expect(where.email).toBe("a@b.com")
    expect(where.isActive).toBe(true)
    expect(where.organization).toBeUndefined()
  })

  it("org-scoped: slug → joins on organization.slug", () => {
    const where = buildLoginUserWhere({
      email: "admin@leaddrive.com",
      password: "demo1234",
      organizationSlug: "leaddrive",
    })
    expect(where.organization).toEqual({ slug: "leaddrive" })
    expect(where.email).toBe("admin@leaddrive.com")
    expect(where.isActive).toBe(true)
  })

  it("different slugs produce different where clauses (multi-tenant isolation)", () => {
    const a = buildLoginUserWhere({
      email: "c@x.com",
      password: "12345678",
      organizationSlug: "tenant-a",
    })
    const b = buildLoginUserWhere({
      email: "c@x.com",
      password: "12345678",
      organizationSlug: "tenant-b",
    })
    expect(a.organization?.slug).toBe("tenant-a")
    expect(b.organization?.slug).toBe("tenant-b")
    expect(a).not.toEqual(b)
  })
})

describe("buildJwtRefreshWhere (F-36 hardening)", () => {
  it("uses token.sub as the user id, not email", () => {
    const where = buildJwtRefreshWhere({ sub: "user-cuid-1" })
    expect(where).toEqual({ id: "user-cuid-1" })
    // Explicitly: must NOT carry email
    expect((where as any)?.email).toBeUndefined()
  })

  it("returns null when token has no subject (refuse email-fallback)", () => {
    const where = buildJwtRefreshWhere({})
    expect(where).toBe(null)
    const where2 = buildJwtRefreshWhere({ sub: null })
    expect(where2).toBe(null)
  })
})

describe("maskLegacyAuthEmail (PII-safe log)", () => {
  it("keeps first 3 chars of local part + first char of domain", () => {
    expect(maskLegacyAuthEmail("admin@leaddrive.com")).toBe("adm…@l…")
    expect(maskLegacyAuthEmail("rashad@example.org")).toBe("ras…@e…")
  })

  it("handles malformed input without throwing", () => {
    // No @ at all
    expect(maskLegacyAuthEmail("noatsign")).toBe("noa…@?…")
    // Missing local part (architect-flagged edge case)
    expect(maskLegacyAuthEmail("@nodomain.com")).toBe("?…@n…")
    // Missing domain
    expect(maskLegacyAuthEmail("local@")).toBe("loc…@?…")
    // Empty string — falls through both branches
    expect(maskLegacyAuthEmail("")).toBe("?…@?…")
  })
})

describe("tenant credentials authorize source invariant", () => {
  it("loads the organization outside RLS and attaches it after the scoped user query", () => {
    const source = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8")
    expect(source).toContain("const users = await runWithTenant(organization.id")
    expect(source).toContain("return users.map((user: (typeof users)[number]) => ({ ...user, organization }))")
    expect(source).not.toContain("where: buildTenantLoginUserWhere(parsed.data.email, organization.id),\n                  include: { organization: true }")
  })
})

describe("buildTenantLoginUserWhere (RLS-scoped credentials lookup)", () => {
  it("uses the resolved organization id instead of a relation join", () => {
    expect(buildTenantLoginUserWhere("admin@example.com", "org_123")).toEqual({
      email: "admin@example.com",
      isActive: true,
      organizationId: "org_123",
    })
  })
})

// ─── pickCandidateByPassword (architect Q4) ─────────────────────────────
//
// The legacy `authorize()` fallback iterates `findMany({email})` and
// runs bcrypt.compare per row — first-bcrypt-match-wins. The loop body
// is extracted to `pickCandidateByPassword` in auth-credentials.ts, so
// this test asserts against the REAL helper imported by prod
// `authorize()`. Drift becomes a compile error.
//
// Real bcryptjs hashing at cost=4 keeps the suite fast.
import bcrypt from "bcryptjs"

describe("pickCandidateByPassword (real helper imported from authorize)", () => {
  it("picks the candidate whose hash matches, not the first row", async () => {
    const pw = "correct-password-1"
    const candidates = [
      { id: "user-A", passwordHash: await bcrypt.hash("wrong-password-A", 4) },
      { id: "user-B", passwordHash: await bcrypt.hash(pw, 4) }, // <-- correct
      { id: "user-C", passwordHash: await bcrypt.hash("wrong-password-C", 4) },
    ]
    const user = await pickCandidateByPassword(candidates, pw)
    expect(user?.id).toBe("user-B")
  })

  it("returns null when no candidate matches", async () => {
    const candidates = [
      { id: "x", passwordHash: await bcrypt.hash("aaaaaaaa", 4) },
      { id: "y", passwordHash: await bcrypt.hash("bbbbbbbb", 4) },
    ]
    const user = await pickCandidateByPassword(candidates, "zzzzzzzz")
    expect(user).toBe(null)
  })

  it("skips OAuth-only candidates (passwordHash null) without crashing", async () => {
    const candidates = [
      { id: "oauth-only", passwordHash: null },
      { id: "creds", passwordHash: await bcrypt.hash("password1", 4) },
    ]
    const user = await pickCandidateByPassword(candidates, "password1")
    expect(user?.id).toBe("creds")
  })

  it("skips empty-string passwordHash (defensive — empty hash is never a valid bcrypt)", async () => {
    const candidates = [
      { id: "empty", passwordHash: "" },
      { id: "real", passwordHash: await bcrypt.hash("password1", 4) },
    ]
    const user = await pickCandidateByPassword(candidates, "password1")
    expect(user?.id).toBe("real")
  })

  it("returns null for empty candidate list", async () => {
    const user = await pickCandidateByPassword([], "anything")
    expect(user).toBe(null)
  })
})
