import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createOutboundMediaLink, readOutboundMediaToken } from "@/lib/inbox/outbound-media-link"

/**
 * The address Meta fetches an outgoing Instagram / Messenger attachment from. It is public, so
 * what matters is what it CANNOT be made to do: reach another file, another organisation, or work
 * after the send is over.
 */
const ORG = "org_zeytun"
const FILE = "0123456789abcdef.jpg"
const NOW = 1_800_000_000_000

const tokenOf = (link: string) => link.split("/api/v1/public/inbox-media/")[1].split("/")[0]

let saved: string | undefined
beforeEach(() => {
  saved = process.env.NEXTAUTH_SECRET
  process.env.NEXTAUTH_SECRET = "test-secret-test-secret-test-secret"
})
afterEach(() => {
  if (saved === undefined) delete process.env.NEXTAUTH_SECRET
  else process.env.NEXTAUTH_SECRET = saved
})

describe("outbound media link", () => {
  it("grants exactly the file it was made for", () => {
    const link = createOutboundMediaLink(`/uploads/inbox/${ORG}/${FILE}`, ORG, NOW)!
    expect(link.endsWith(`/${FILE}`)).toBe(true)
    expect(readOutboundMediaToken(tokenOf(link), NOW + 60_000)).toEqual({
      organizationId: ORG, uploadUrl: `/uploads/inbox/${ORG}/${FILE}`, fileName: FILE,
    })
  })

  it("is dead after ten minutes", () => {
    const token = tokenOf(createOutboundMediaLink(`/uploads/inbox/${ORG}/${FILE}`, ORG, NOW)!)
    expect(readOutboundMediaToken(token, NOW + 9 * 60_000)).not.toBeNull()
    expect(readOutboundMediaToken(token, NOW + 11 * 60_000)).toBeNull()
  })

  it("cannot be rewritten to another organisation or another file", () => {
    const token = tokenOf(createOutboundMediaLink(`/uploads/inbox/${ORG}/${FILE}`, ORG, NOW)!)
    const [, signature] = token.split(".")
    for (const forged of [
      { o: "org_other", f: FILE, e: NOW + 600_000 },
      { o: ORG, f: "ffffffffffffffff.pdf", e: NOW + 600_000 },
      { o: ORG, f: FILE, e: NOW + 86_400_000 },
    ]) {
      const payload = Buffer.from(JSON.stringify(forged)).toString("base64url")
      expect(readOutboundMediaToken(`${payload}.${signature}`, NOW)).toBeNull()
    }
  })

  it("is not signed by a different server secret", () => {
    const token = tokenOf(createOutboundMediaLink(`/uploads/inbox/${ORG}/${FILE}`, ORG, NOW)!)
    process.env.NEXTAUTH_SECRET = "another-secret-another-secret-another"
    expect(readOutboundMediaToken(token, NOW)).toBeNull()
  })

  it("is not made for another organisation's upload, a path, or without a secret", () => {
    expect(createOutboundMediaLink(`/uploads/inbox/org_other/${FILE}`, ORG, NOW)).toBeNull()
    expect(createOutboundMediaLink(`/uploads/inbox/${ORG}/../../etc/passwd`, ORG, NOW)).toBeNull()
    expect(createOutboundMediaLink(`/uploads/logos/${ORG}/${FILE}`, ORG, NOW)).toBeNull()
    delete process.env.NEXTAUTH_SECRET
    delete process.env.AUTH_SECRET
    expect(createOutboundMediaLink(`/uploads/inbox/${ORG}/${FILE}`, ORG, NOW)).toBeNull()
  })
})
