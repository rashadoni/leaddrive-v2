import { describe, expect, it } from "vitest"

import { recordingResponse } from "@/lib/calls/recording-response"

// Owner, 2026-11-27: the call player in the order card could not seek. The browser seeks by
// asking for a byte range; the route answered every request with the whole file from zero.
const wave = Buffer.from(Array.from({ length: 100 }, (_, i) => i))

async function bytes(res: Response) {
  return Buffer.from(await res.arrayBuffer())
}

describe("recordingResponse", () => {
  it("says it accepts ranges on a plain request", async () => {
    const res = recordingResponse(wave, null, "c1")
    expect(res.status).toBe(200)
    expect(res.headers.get("accept-ranges")).toBe("bytes")
    expect(res.headers.get("content-length")).toBe("100")
    expect((await bytes(res)).equals(wave)).toBe(true)
  })

  it("answers a seek with exactly the bytes asked for", async () => {
    const res = recordingResponse(wave, "bytes=40-59", "c1")
    expect(res.status).toBe(206)
    expect(res.headers.get("content-range")).toBe("bytes 40-59/100")
    expect((await bytes(res)).equals(wave.subarray(40, 60))).toBe(true)
  })

  it("serves an open-ended range to the end and a suffix range from the end", async () => {
    const open = recordingResponse(wave, "bytes=90-", "c1")
    expect(open.headers.get("content-range")).toBe("bytes 90-99/100")
    expect((await bytes(open)).length).toBe(10)
    const suffix = recordingResponse(wave, "bytes=-5", "c1")
    expect(suffix.headers.get("content-range")).toBe("bytes 95-99/100")
  })

  it("refuses a range past the end with 416", () => {
    const res = recordingResponse(wave, "bytes=200-300", "c1")
    expect(res.status).toBe(416)
    expect(res.headers.get("content-range")).toBe("bytes */100")
  })
})
