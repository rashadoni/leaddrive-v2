import { describe, it, expect, vi, beforeEach } from "vitest"
import crypto from "crypto"
import type { NextRequest } from "next/server"

/**
 * Meta's Deauthorize and Data Deletion callbacks for the Instagram-Login app.
 *
 * These endpoints are public and switch a business's channel off, so the properties under test are:
 * nothing changes without a valid signature; with one, exactly the Instagram-Login rows of the named
 * account lose their token and go inactive (a Facebook-Login row for the same account is another
 * app's grant and stays); a deletion request answers Meta with a code whose status page can tell a
 * real request from an invented one, and puts a person on the remaining deletion.
 */

// A stand-in for Prisma's rows and arguments, which differ per call; typing them is the real client's job.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>
const db = vi.hoisted(() => ({ channelConfig: [] as Row[], connections: [] as Row[], audits: [] as Row[] }))
const sendEmail = vi.hoisted(() => vi.fn(async () => ({ success: true })))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findMany: vi.fn(async ({ where }: Row) => {
        const ids = where.OR.map((c: Row) => c.pageId ?? c.settings?.equals)
        return db.channelConfig
          .filter((r) => r.channelType === where.channelType)
          .filter((r) => ids.includes(r.pageId) || ids.includes(r.settings?.igScopedId))
          .map((r) => ({ ...r }))
      }),
      updateMany: vi.fn(async ({ where, data }: Row) => {
        for (const r of db.channelConfig) {
          if (r.id === where.id && r.organizationId === where.organizationId) Object.assign(r, data)
        }
        return { count: 1 }
      }),
    },
    channelConnection: {
      updateMany: vi.fn(async ({ where, data }: Row) => {
        db.connections.push({ where, data })
        return { count: 1 }
      }),
    },
  },
  logAudit: vi.fn(async (...args: unknown[]) => {
    db.audits.push(args)
  }),
}))
vi.mock("@/lib/email", () => ({ sendEmail }))

import { parseMetaSignedRequest } from "@/lib/social/meta-signed-request"
import { POST as deauthorize } from "@/app/api/v1/webhooks/instagram/deauthorize/route"
import { POST as dataDeletion, GET as deletionStatus } from "@/app/api/v1/webhooks/instagram/data-deletion/route"

const SECRET = "ig-app-secret"

function signed(payload: object, secret = SECRET): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const sig = crypto.createHmac("sha256", secret).update(body).digest("base64url")
  return `${sig}.${body}`
}
function formReq(url: string, signedRequest?: string): NextRequest {
  const form = new URLSearchParams()
  if (signedRequest !== undefined) form.set("signed_request", signedRequest)
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form,
  }) as unknown as NextRequest
}
const DEAUTH_URL = "https://app.leaddrivecrm.org/api/v1/webhooks/instagram/deauthorize"
const DELETE_URL = "https://app.leaddrivecrm.org/api/v1/webhooks/instagram/data-deletion"
const row = (id: string) => db.channelConfig.find((r) => r.id === id)!

beforeEach(() => {
  process.env.INSTAGRAM_APP_SECRET = SECRET
  db.audits.length = 0
  db.connections.length = 0
  sendEmail.mockClear()
  db.channelConfig.splice(0, db.channelConfig.length,
    // An Instagram-Login connection in two workspaces, matched by the professional account id.
    { id: "ig_a", organizationId: "org_a", channelType: "instagram", pageId: "1784", configName: "@shop", isActive: true, apiKey: "TOKEN_A", accessToken: null, settings: { igLogin: true, username: "shop", inboxSubscribed: true } },
    { id: "ig_b", organizationId: "org_b", channelType: "instagram", pageId: "1784", configName: "@shop", isActive: true, apiKey: "TOKEN_B", accessToken: null, settings: { igLogin: true, username: "shop" } },
    // Same account through Facebook Login: another app's Page token, not revoked by the Instagram app.
    { id: "fb_ig", organizationId: "org_a", channelType: "instagram", pageId: "1784", configName: "Page / @shop", isActive: true, apiKey: "PAGE_TOKEN", accessToken: null, settings: {} },
    // Matched only through the app-scoped id stored at connect.
    { id: "ig_scoped", organizationId: "org_c", channelType: "instagram", pageId: "1799", configName: "@other", isActive: true, apiKey: "TOKEN_C", accessToken: null, settings: { igLogin: true, igScopedId: "2601" } },
  )
})

describe("parseMetaSignedRequest", () => {
  it("accepts Meta's format signed with the app secret", () => {
    expect(parseMetaSignedRequest(signed({ algorithm: "HMAC-SHA256", user_id: "1784" }), SECRET)).toMatchObject({ user_id: "1784" })
  })
  it("rejects another secret, a tampered payload and a non-HMAC algorithm", () => {
    expect(parseMetaSignedRequest(signed({ algorithm: "HMAC-SHA256", user_id: "1784" }, "other"), SECRET)).toBeNull()
    const [sig] = signed({ algorithm: "HMAC-SHA256", user_id: "1784" }).split(".")
    const forged = Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "9999" })).toString("base64url")
    expect(parseMetaSignedRequest(`${sig}.${forged}`, SECRET)).toBeNull()
    expect(parseMetaSignedRequest(signed({ algorithm: "none", user_id: "1784" }), SECRET)).toBeNull()
  })
})

describe("deauthorize callback", () => {
  it("changes nothing without a valid signature", async () => {
    const before = structuredClone(db.channelConfig)
    expect((await deauthorize(formReq(DEAUTH_URL, signed({ algorithm: "HMAC-SHA256", user_id: "1784" }, "wrong")))).status).toBe(400)
    expect((await deauthorize(formReq(DEAUTH_URL))).status).toBe(400)
    expect(db.channelConfig).toEqual(before)
    expect(db.audits).toEqual([])
  })

  it("switches off every Instagram-Login row of the account and wipes its token, in every workspace", async () => {
    const res = await deauthorize(formReq(DEAUTH_URL, signed({ algorithm: "HMAC-SHA256", user_id: "1784", issued_at: 1 })))
    expect(res.status).toBe(200)
    for (const id of ["ig_a", "ig_b"]) {
      expect(row(id)).toMatchObject({ isActive: false, apiKey: null, accessToken: null })
      expect(row(id).settings).toMatchObject({ inboxSubscribed: false, revokedByMeta: { reason: "deauthorize" } })
      expect(row(id).settings.username).toBe("shop") // deauthorize alone keeps the handle
    }
    expect(row("fb_ig")).toMatchObject({ isActive: true, apiKey: "PAGE_TOKEN" })
    expect(row("ig_scoped")).toMatchObject({ isActive: true, apiKey: "TOKEN_C" })
    expect(db.connections.map((c) => c.where.channelConfigId).sort()).toEqual(["ig_a", "ig_b"])
    expect(db.audits.map((a) => a[1])).toEqual(["disconnect", "disconnect"])
  })

  it("also finds an account named by its app-scoped id", async () => {
    await deauthorize(formReq(DEAUTH_URL, signed({ algorithm: "HMAC-SHA256", user_id: "2601" })))
    expect(row("ig_scoped")).toMatchObject({ isActive: false, apiKey: null })
    expect(row("ig_a")).toMatchObject({ isActive: true })
  })
})

describe("data deletion callback", () => {
  it("answers Meta with a status URL and a code, revokes the account and removes its handle", async () => {
    const res = await dataDeletion(formReq(DELETE_URL, signed({ algorithm: "HMAC-SHA256", user_id: "1784" })))
    expect(res.status).toBe(200)
    const json = (await res.json()) as { url: string; confirmation_code: string }
    expect(json.confirmation_code).toMatch(/^LD-[0-9A-Z]+-[0-9A-F]{12}$/)
    expect(json.url).toBe(`https://app.leaddrivecrm.org/api/v1/webhooks/instagram/data-deletion?code=${json.confirmation_code}`)
    expect(row("ig_a")).toMatchObject({ isActive: false, apiKey: null, configName: "Instagram account (data deletion requested)" })
    expect(row("ig_a").settings).not.toHaveProperty("username")
    expect(row("fb_ig")).toMatchObject({ isActive: true })
    expect(db.audits.map((a) => [a[1], (a[5] as Row).newValue.confirmationCode])).toEqual([
      ["data_deletion_request", json.confirmation_code],
      ["data_deletion_request", json.confirmation_code],
    ])
    // The 30-day part of the policy needs a person: the privacy mailbox gets the request.
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ subject: `Meta data deletion request ${json.confirmation_code}`, transactional: true }))
  })

  it("its status page confirms a code we issued and refuses one we did not", async () => {
    const res = await dataDeletion(formReq(DELETE_URL, signed({ algorithm: "HMAC-SHA256", user_id: "5555" })))
    const { confirmation_code: code } = (await res.json()) as { confirmation_code: string }

    const ok = await deletionStatus(new Request(`${DELETE_URL}?code=${code}`) as unknown as NextRequest)
    expect(ok.status).toBe(200)
    expect(await ok.text()).toContain(`Data deletion request ${code}`)

    const forged = code.replace(/.$/, (c) => (c === "A" ? "B" : "A"))
    const bad = await deletionStatus(new Request(`${DELETE_URL}?code=${forged}`) as unknown as NextRequest)
    expect(bad.status).toBe(404)
    expect(await bad.text()).toContain("Unknown request")
  })

  it("changes nothing and sends nothing without a valid signature", async () => {
    const before = structuredClone(db.channelConfig)
    expect((await dataDeletion(formReq(DELETE_URL, "garbage"))).status).toBe(400)
    expect(db.channelConfig).toEqual(before)
    expect(sendEmail).not.toHaveBeenCalled()
  })
})
