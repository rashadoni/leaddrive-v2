import { describe, it, expect, vi, beforeEach } from "vitest"
import crypto from "crypto"
import { readFileSync } from "node:fs"
import { Prisma } from "@prisma/client"

/**
 * Meta App Review security gate.
 *
 * Every assertion here corresponds to a question on Meta's Data Handling questionnaire, and to a
 * claim made in `docs/meta-app-review-security-answers.md`. The point is that the answers given to
 * Meta cannot drift away from the code without a red test: a security questionnaire is a set of
 * factual claims about a running system, and the expensive failure mode is answering "yes, we do
 * that" about something the code stopped doing.
 */

const findFirst = vi.fn()
const findMany = vi.fn()
const create = vi.fn()

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelMessage: {
      findFirst: (...a: any[]) => findFirst(...a),
      create: (...a: any[]) => create(...a),
    },
    channelConfig: { findMany: (...a: any[]) => findMany(...a) },
  },
  logAudit: vi.fn(),
}))

import { alreadyIngested, isDuplicateInsert } from "@/lib/social/meta-inbound-idempotency"
import { publicChannelConfig } from "@/lib/channels/public-channel-config"
import { changedCredentialFields } from "@/lib/channels/channel-credential-audit"
import { normalizeOAuthReturnKey, oauthReturnUrl } from "@/lib/social/oauth-return"

beforeEach(() => {
  findFirst.mockReset()
  findMany.mockReset()
  create.mockReset()
})

// ── 1. Webhook replay / duplicate events ────────────────────────────────────────────────────────
describe("webhook replay protection", () => {
  it("recognises a redelivered provider message id, scoped to the tenant", async () => {
    findFirst.mockResolvedValue({ id: "existing" })
    expect(await alreadyIngested("org_1", "whatsapp", "wamid.ABC")).toBe(true)
    const where = findFirst.mock.calls[0][0].where
    // Scoped: a provider id is not unique across tenants, and two tenants can hold the same id
    // when both connected the same asset. An un-scoped lookup would leak existence across tenants.
    expect(where.organizationId).toBe("org_1")
    expect(where.channelType).toBe("whatsapp")
    expect(where.direction).toBe("inbound")
    expect(where.externalId).toBe("wamid.ABC")
  })

  it("treats a first delivery as new", async () => {
    findFirst.mockResolvedValue(null)
    expect(await alreadyIngested("org_1", "whatsapp", "wamid.NEW")).toBe(false)
  })

  it("does not query at all without an id or org", async () => {
    expect(await alreadyIngested("org_1", "whatsapp", null)).toBe(false)
    expect(await alreadyIngested("", "whatsapp", "wamid.X")).toBe(false)
    expect(findFirst).not.toHaveBeenCalled()
  })

  it("recognises a REAL Prisma unique violation", () => {
    // The positive case matters on its own: `isDuplicateInsert` is an `instanceof` check, so if it
    // silently stopped matching, the guard would be dead and every negative assertion below would
    // still pass. This is the test that would go red.
    const real = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    })
    expect(isDuplicateInsert(real)).toBe(true)
  })

  it("treats ONLY a unique violation as a duplicate, never a generic failure", () => {
    // Swallowing anything else here would silently drop a genuine inbound message.
    const otherPrismaError = new Prisma.PrismaClientKnownRequestError("Record not found", {
      code: "P2025",
      clientVersion: "test",
    })
    expect(isDuplicateInsert(otherPrismaError)).toBe(false)
    // A duck-typed lookalike must not pass either — only a genuine Prisma error counts.
    expect(isDuplicateInsert({ code: "P2002", name: "PrismaClientKnownRequestError" })).toBe(false)
    expect(isDuplicateInsert(new Error("connection reset"))).toBe(false)
    expect(isDuplicateInsert(null)).toBe(false)
  })

  it("the three Meta channels are covered by the partial unique index", () => {
    const sql = readFileSync(
      "prisma/migrations/20260920160000_meta_inbound_idempotency/migration.sql",
      "utf8",
    )
    for (const ch of ["whatsapp", "facebook", "instagram"]) expect(sql).toContain(`'${ch}'`)
    expect(sql).toContain("UNIQUE INDEX")
    expect(sql).toContain(`"direction" = 'inbound'`)
  })

  it("both Meta webhooks ask the guard before inserting", () => {
    const wa = readFileSync("src/app/api/v1/webhooks/whatsapp/route.ts", "utf8")
    const fb = readFileSync("src/app/api/v1/webhooks/facebook/route.ts", "utf8")
    expect(wa).toContain("alreadyIngested(orgId, \"whatsapp\", messageId)")
    expect(wa).toContain("isDuplicateInsert(e)")
    expect(fb).toContain("isDuplicateInsert(e)")
  })
})

// ── 2. Secret leakage ───────────────────────────────────────────────────────────────────────────
describe("secrets never cross the API boundary", () => {
  it("strips every credential and reports only presence", () => {
    const row = {
      id: "cfg_1",
      channelType: "facebook",
      appId: "2414060595720618",
      appSecret: "REAL_APP_SECRET",
      verifyToken: "REAL_VERIFY_TOKEN",
      apiKey: "REAL_PAGE_TOKEN",
      accessToken: "REAL_ACCESS_TOKEN",
      botToken: "REAL_BOT_TOKEN",
      settings: { webhookSecret: "REAL_WEBHOOK_SECRET", igLogin: true },
    }
    const out = publicChannelConfig(row)
    const serialized = JSON.stringify(out)
    for (const secret of [
      "REAL_APP_SECRET", "REAL_VERIFY_TOKEN", "REAL_PAGE_TOKEN",
      "REAL_ACCESS_TOKEN", "REAL_BOT_TOKEN", "REAL_WEBHOOK_SECRET",
    ]) {
      expect(serialized, `${secret} must not appear in an API response`).not.toContain(secret)
    }
    // Presence is still reported, so the UI can say "stored" without holding the value.
    expect(out.hasAppSecret).toBe(true)
    expect(out.hasVerifyToken).toBe(true)
    // The App ID is a PUBLIC identifier the tenant must be able to read back.
    expect(out.appId).toBe("2414060595720618")
  })

  it("drops an unknown future credential by NAME, not by a hand-maintained list", () => {
    const out = publicChannelConfig({
      channelType: "facebook",
      settings: { someNewClientSecret: "LEAKED", providerApiKey: "LEAKED2", tokenExpiresAt: "2026-01-01" },
    })
    const serialized = JSON.stringify(out)
    expect(serialized).not.toContain("LEAKED")
    expect(serialized).not.toContain("LEAKED2")
    // Non-secret metadata survives — over-redaction breaks the UI and teaches people to bypass it.
    expect(serialized).toContain("tokenExpiresAt")
  })

  it("the audit trail records credential field NAMES, never values", () => {
    const fields = changedCredentialFields({
      appSecret: "REAL_SECRET_VALUE",
      verifyToken: "REAL_TOKEN_VALUE",
      configName: "renamed",
    })
    expect(fields).toEqual(["appSecret", "verifyToken"])
    expect(JSON.stringify(fields)).not.toContain("REAL_SECRET_VALUE")
  })

  it("a blank field is not reported as a credential change", () => {
    // Blank means "keep the stored value" on this API. An audit that cried wolf on every rename
    // would be an audit nobody reads.
    expect(changedCredentialFields({ appSecret: "", verifyToken: "   ", configName: "x" })).toEqual([])
    expect(changedCredentialFields(null)).toEqual([])
  })

  it("no route logs a credential value", () => {
    for (const f of [
      "src/app/api/v1/webhooks/whatsapp/route.ts",
      "src/app/api/v1/webhooks/facebook/route.ts",
      "src/app/api/v1/webhooks/instagram/route.ts",
      "src/app/api/v1/social/oauth/preflight/route.ts",
    ]) {
      const src = readFileSync(f, "utf8")
      // Interpolating a credential into a log line is the shape we forbid.
      expect(src, `${f} interpolates a secret into a log`).not.toMatch(
        /console\.(log|warn|error)\([^)]*\$\{[^}]*(appSecret|verifyToken|accessToken|apiKey)[^}]*\}/,
      )
    }
  })

  it("preflight reports presence as booleans and returns no secret value", () => {
    const src = readFileSync("src/app/api/v1/social/oauth/preflight/route.ts", "utf8")
    expect(src).toContain("hasAppSecret: Boolean(")
    expect(src).toContain("hasVerifyToken: Boolean(")
    // The shape that would leak: putting the value itself on the response object.
    expect(src).not.toMatch(/\bappSecret:\s*(pinned|tenant|cfg|row|waRow)/)
    expect(src).not.toMatch(/\bverifyToken:\s*(pinned|tenant|cfg|row|waRow)/)
  })
})

// ── 3. OAuth state / CSRF / redirect allowlist ──────────────────────────────────────────────────
describe("OAuth state and redirect handling", () => {
  it("accepts only whitelisted return keys — never a caller-supplied path", () => {
    expect(normalizeOAuthReturnKey("channels-facebook")).toBe("channels-facebook")
    for (const hostile of [
      "//evil.com", "/\\evil.com", "https://evil.com", "../../etc/passwd",
      "constructor", "__proto__", "toString", null, undefined, "",
    ]) {
      expect(normalizeOAuthReturnKey(hostile as string), `${String(hostile)} must not resolve`).toBeNull()
    }
  })

  it("an unknown key lands on the fixed default, never on an attacker origin", () => {
    const url = oauthReturnUrl("https://evil.com", { connected: "facebook" })
    expect(url.startsWith("/")).toBe(true)
    expect(url).not.toContain("evil.com")
  })

  it("state is HMAC-signed, so a tampered orgId is rejected", () => {
    // Reproduces what the callbacks verify: payload + "." + HMAC(payload).
    const SECRET = "test-secret"
    const payload = JSON.stringify({ orgId: "org_victim", state: "n", ts: Date.now() })
    const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("hex")

    const tamperedPayload = JSON.stringify({ orgId: "org_attacker", state: "n", ts: Date.now() })
    const recomputed = crypto.createHmac("sha256", SECRET).update(tamperedPayload).digest("hex")
    expect(recomputed).not.toBe(sig)
  })

  it("the callbacks enforce signature, expiry and a session-org match", () => {
    for (const f of [
      "src/app/api/v1/social/oauth/facebook/callback/route.ts",
      "src/app/api/v1/social/oauth/instagram/callback/route.ts",
    ]) {
      const src = readFileSync(f, "utf8")
      expect(src).toContain("bad_signature")
      expect(src, "state must expire").toContain("30 * 60 * 1000")
      // Cookie-less path gives no CSRF proof, so a matching session is required there.
      expect(src).toContain("no_session")
      expect(src).toContain("org_mismatch")
    }
  })

  it("a pinned flow never falls back to the shared app in the callback", () => {
    for (const f of [
      "src/app/api/v1/social/oauth/facebook/callback/route.ts",
      "src/app/api/v1/social/oauth/instagram/callback/route.ts",
    ]) {
      const src = readFileSync(f, "utf8")
      expect(src).toContain('if (payload.app && !pinnedApp) return redirectError(req, "not_configured", ret)')
    }
  })
})

// ── 4. Cross-tenant routing ─────────────────────────────────────────────────────────────────────
describe("cross-tenant isolation", () => {
  it("a ?t= webhook refuses the shared env secret", () => {
    // Otherwise an env-signed payload addressed to any org slug would pass the signature AND be
    // org-scoped to that tenant — a cross-tenant write.
    for (const f of [
      "src/app/api/v1/webhooks/facebook/route.ts",
      "src/app/api/v1/webhooks/instagram/route.ts",
      "src/app/api/v1/webhooks/whatsapp/route.ts",
    ]) {
      expect(readFileSync(f, "utf8")).toContain("refusing env fallback")
    }
  })

  it("WhatsApp binds the tenant to the payload's phone_number_id", () => {
    const src = readFileSync("src/app/api/v1/webhooks/whatsapp/route.ts", "utf8")
    expect(src).toContain("doesn't match its ChannelConfig. Ignoring.")
  })

  it("channel configuration is admin-only and closed to API keys", () => {
    const src = readFileSync("src/lib/channels-access.ts", "utf8")
    expect(src).toContain("requireSessionAuth")
    expect(src).toContain('session.role !== "admin" && session.role !== "superadmin"')
  })

  it("every channel mutation is scoped by organizationId", () => {
    const src = readFileSync("src/app/api/v1/channels/[id]/route.ts", "utf8")
    for (const m of src.match(/where: \{[^}]*id[,:][^}]*\}/g) || []) {
      // `id` alone is guessable across tenants; the org scope is the boundary.
      if (m.includes("organizationId")) continue
      expect(m, `unscoped where clause: ${m}`).not.toMatch(/\bid\b/)
    }
  })
})

// ── 5. Lifecycle: disconnect clears credentials ─────────────────────────────────────────────────
describe("disconnect and deletion", () => {
  it("disconnect nulls every credential column and deactivates the row", () => {
    const src = readFileSync("src/app/api/v1/channels/[id]/route.ts", "utf8")
    const block = src.slice(src.indexOf('["facebook", "instagram", "whatsapp"].includes'))
    for (const field of ["botToken: null", "apiKey: null", "appSecret: null", "accessToken: null", "verifyToken: null"]) {
      expect(block, `disconnect must clear ${field}`).toContain(field)
    }
    expect(block).toContain("isActive: false")
    // The OAuth token held alongside it must go too, or "disconnected" is untrue.
    expect(block).toContain("accessToken: null,\n              tokenExpiresAt: null,")
  })

  it("every channel mutation writes an audit entry", () => {
    const byId = readFileSync("src/app/api/v1/channels/[id]/route.ts", "utf8")
    const list = readFileSync("src/app/api/v1/channels/route.ts", "utf8")
    expect(list).toContain('action: "create"')
    expect(byId).toContain('action: "update"')
    expect(byId).toContain('action: "disconnect"')
    expect(byId).toContain('action: "delete"')
  })
})

// ── 6. Published policy matches the code ────────────────────────────────────────────────────────
describe("the published policy does not overclaim", () => {
  const privacy = JSON.parse(readFileSync("messages/en.json", "utf8")).privacy

  it("does not claim every channel credential is encrypted", () => {
    // Verified on production 2026-09-20: social_accounts tokens are 100% AES-256-GCM ("v1:"),
    // channel_configs credentials are 0% — plaintext at the column level. The policy says so.
    expect(privacy.p4).toMatch(/AES-256-GCM/)
    expect(privacy.p4).toMatch(/not every ChannelConfig credential is currently field-encrypted/i)
  })

  it("does not promise a backup protection production does not run", () => {
    // Verified on production 2026-09-20: the encrypted/Object-Lock backup timer is disabled and its
    // last run failed on 2026-09-07; an unencrypted pg_dump runs instead. See §4 of
    // docs/meta-app-review-security-answers.md — this is the blocker that gates the submission.
    expect(privacy.p7_note).toMatch(/30/)
    expect(`${privacy.p4} ${privacy.p7_note}`).not.toMatch(/encrypted backups|immutable retention/i)
  })
})
