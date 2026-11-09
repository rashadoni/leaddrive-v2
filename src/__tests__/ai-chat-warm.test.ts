/**
 * Da Vinci's chat is warmed by the deploy (2026-11-08: the first question
 * after a deploy waited 13.2 s for its first word, the next 1.2 s), and every
 * turn logs its prep / first-word / total times so a cold start shows up in
 * the log instead of needing a production restart to reproduce.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { NextRequest } from "next/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const loaded = vi.hoisted(() => [] as string[])
vi.mock("@/app/api/v1/ai/chat/route", () => {
  loaded.push("chat")
  return { POST: vi.fn() }
})
vi.mock("@/lib/ai/read-tool-executor", () => {
  loaded.push("read-tools")
  return { executeReadTool: vi.fn() }
})

import { POST } from "@/app/api/cron/ai-chat-warm/route"
import { startChatTiming } from "@/lib/ai/chat-timing"

const request = (secret?: string) =>
  new NextRequest("http://localhost:3001/api/cron/ai-chat-warm", {
    method: "POST",
    headers: secret ? { "x-cron-secret": secret } : {},
  })

describe("the deploy's Da Vinci warm-up", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_SECRET", "test-cron-secret")
    loaded.length = 0
  })
  afterEach(() => vi.unstubAllEnvs())

  it("loads nothing for a caller without the cron secret", async () => {
    const response = await POST(request("wrong"))
    expect(response.status).toBe(401)
    expect(loaded).toEqual([])
  })

  it("loads the chat route and the lazily loaded read tools", async () => {
    const response = await POST(request("test-cron-secret"))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ outcome: "warm" })
    expect(loaded.sort()).toEqual(["chat", "read-tools"])
  })

  it("is called by the deploy with the cron secret, next to the station's warm-ups", () => {
    const deploy = readFileSync(join(process.cwd(), "scripts/server-deploy.sh"), "utf8")
    const block = deploy.slice(deploy.indexOf("WARM_PIDS=()"), deploy.indexOf('wait "${WARM_PIDS[@]}"'))
    expect(block).toContain('-H "x-cron-secret: ${CRON_SECRET:-}"')
    expect(block).toContain('"$HEALTH_URL/api/cron/ai-chat-warm"')
    // Before the health checks, so the process is warm before nginx's users find it idle.
    expect(deploy.indexOf("/api/cron/ai-chat-warm")).toBeLessThan(deploy.indexOf("Health check attempt $i/5"))
  })
})

describe("the chat's timing line", () => {
  it("logs prep, first word and total, numbers only", () => {
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      let clock = 1_000
      const timing = startChatTiming(() => clock)
      clock = 1_300
      timing.modelCall()
      clock = 1_800
      timing.firstText()
      clock = 1_900
      timing.firstText()
      clock = 3_000
      timing.finish(200, true)
      timing.finish(200, true)
      const lines = writes.filter((line) => line.includes('"ai_chat_timing"'))
      expect(lines).toHaveLength(1)
      const line = JSON.parse(lines[0])
      expect(line).toMatchObject({ prepMs: 300, firstTextMs: 800, totalMs: 2000, status: 200, streamed: true })
      expect(Object.keys(line).sort()).toEqual(
        ["evt", "firstTextMs", "prepMs", "proc", "status", "streamed", "totalMs", "turn", "uptimeS"].sort(),
      )
    } finally {
      spy.mockRestore()
    }
  })

  it("counts the turns of this process, so the first after a start is visible", () => {
    const first = startChatTiming()
    const second = startChatTiming()
    const writes: string[] = []
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk))
      return true
    })
    try {
      first.finish(200, false)
      second.finish(200, false)
    } finally {
      spy.mockRestore()
    }
    const [a, b] = writes.filter((line) => line.includes('"ai_chat_timing"')).map((line) => JSON.parse(line))
    expect(b.turn).toBe(a.turn + 1)
    // Never reached the model: no prep time, first word is the end.
    expect(a.prepMs).toBeNull()
    expect(a.firstTextMs).toBe(a.totalMs)
  })
})
