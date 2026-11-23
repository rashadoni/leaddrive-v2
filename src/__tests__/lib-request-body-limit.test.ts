import { describe, expect, it } from "vitest"
import {
  readFormDataRequestWithinLimit,
  readJsonRequestWithinLimit,
} from "@/lib/request-body-limit"

describe("bounded request body parsing", () => {
  it("parses small JSON and rejects declared or streamed oversized JSON", async () => {
    const valid = new Request("http://localhost", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ok" }),
    })
    await expect(readJsonRequestWithinLimit(valid, 64)).resolves.toEqual({
      ok: true,
      value: { name: "ok" },
    })

    const declared = new Request("http://localhost", {
      method: "POST",
      headers: { "content-length": "1000" },
      body: "{}",
    })
    await expect(readJsonRequestWithinLimit(declared, 64)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    })

    const streamed = new Request("http://localhost", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(65))
          controller.close()
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" })
    await expect(readJsonRequestWithinLimit(streamed, 64)).resolves.toEqual({
      ok: false,
      reason: "too_large",
    })
  })

  it("parses multipart within the total-body cap", async () => {
    const form = new FormData()
    form.set("file", new File([new Uint8Array([1, 2, 3])], "a.png", { type: "image/png" }))
    const request = new Request("http://localhost", { method: "POST", body: form })
    const parsed = await readFormDataRequestWithinLimit(request, 4096)
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect((parsed.value.get("file") as File).name).toBe("a.png")
  })
  it("gives up on an oversized copy of a request at once, and leaves the request itself whole", async () => {
    // A copy shares its stream with the original, and cancelling one of the two
    // settles only when the other is cancelled as well. Waiting for that, the
    // reader of a copy never answered (the phone agent's route, 2026-11-23).
    const text = JSON.stringify({ audio: "a".repeat(100_000) })
    const bytes = new TextEncoder().encode(text)
    const request = new Request("https://app.leaddrivecrm.org/x", {
      method: "POST",
      duplex: "half",
      body: new ReadableStream({ start(controller) {
        for (let at = 0; at < bytes.length; at += 8192) controller.enqueue(bytes.subarray(at, at + 8192))
        controller.close()
      } }),
    } as RequestInit)

    const answer = await Promise.race([
      readJsonRequestWithinLimit(request.clone(), 16 * 1024),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ])

    expect(answer).toEqual({ ok: false, reason: "too_large" })
    expect(await request.text()).toBe(text)
  })
})
