import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const pages = [
  readFileSync("src/app/(dashboard)/inbox/page.tsx", "utf8"),
  readFileSync("src/app/(dashboard)/inbox/legacy/page.tsx", "utf8"),
]
const route = readFileSync("src/app/api/v1/inbox/route.ts", "utf8")

describe("manual inbox Chatwoot idempotency contract", () => {
  it.each(pages)("retains one UUID for retry and rotates it only when the payload changes", (source) => {
    expect(source).toContain('useRef<{ key: string; payload: string } | null>(null)')
    expect(source).toContain("sendOperationRef.current?.payload === deliveryPayload")
    expect(source).toContain("crypto.randomUUID()")
    expect(source).toContain("sendOperationRef.current = { key: deliveryIdempotencyKey, payload: deliveryPayload }")
    expect(source).toContain("deliveryIdempotencyKey,")
    expect(source).toContain("sendOperationRef.current = null")
    expect(source).toContain("sendUnknownAttemptId")
    expect(source).toContain("delivery-reconciliation")
    expect(source).toContain('confirmation: "verified_in_chatwoot"')
    expect(source).toContain("window.confirm(prompt)")
  })

  it("accepts only a UUID from the browser and fixes its namespace server-side", () => {
    expect(route).toContain("deliveryIdempotencyKey: z.string().uuid().optional()")
    expect(route).toContain('{ source: "manual", key: deliveryIdempotencyKey }')
    expect(route).toContain('channel === "tiktok" && !deliveryIdempotencyKey')
    expect(route).toContain("attemptId: result.attemptId")
  })
})
