import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/prisma", () => ({
  prisma: {},
}))

import { sendFacebookMessage, sendInstagramMessage } from "@/lib/facebook"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch)
})

describe("Meta message send token transport", () => {
  it("sends Facebook page tokens in the Authorization header, not the URL", async () => {
    await expect(sendFacebookMessage("psid-1", "hello", "PAGE_TOKEN", "org-1")).resolves.toBe(true)

    const fetchMock = vi.mocked(global.fetch)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://graph.facebook.com/v20.0/me/messages")
    expect(String(url)).not.toContain("PAGE_TOKEN")
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer PAGE_TOKEN",
    })
  })

  it("sends Instagram page tokens in the Authorization header, not the URL", async () => {
    await expect(sendInstagramMessage("igsid-1", "hello", "PAGE_TOKEN", "org-1")).resolves.toBe(true)

    const fetchMock = vi.mocked(global.fetch)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe("https://graph.facebook.com/v20.0/me/messages")
    expect(String(url)).not.toContain("PAGE_TOKEN")
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer PAGE_TOKEN",
    })
  })
})
