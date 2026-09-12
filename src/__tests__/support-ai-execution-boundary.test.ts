import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8")
}

describe("Support AI execution boundary", () => {
  it.each([
    "src/app/api/v1/tickets/ai/route.ts",
    "src/app/api/v1/tickets/ai-categorize/route.ts",
    "src/app/api/v1/complaints/ai-categorize/route.ts",
    "src/app/api/v1/public/portal-chat/route.ts",
    "src/app/api/v1/webhooks/whatsapp/route.ts",
    "src/lib/complaint-ai.ts",
    "src/app/api/cron/ai-auto-actions/route.ts",
  ])("keeps the server-side Support gate on %s", (path) => {
    expect(source(path)).toContain("isSupportAiEnabled")
  })

  it.each([
    "src/app/api/v1/tickets/route.ts",
    "src/app/api/v1/tickets/[id]/route.ts",
    "src/app/api/v1/tickets/[id]/comments/route.ts",
    "src/app/api/v1/complaints/route.ts",
    "src/app/api/v1/complaints/[id]/route.ts",
    "src/app/api/v1/public/portal-tickets/route.ts",
    "src/app/api/v1/public/portal-tickets/[id]/route.ts",
  ])("does not gate manual Support work in %s", (path) => {
    expect(source(path)).not.toContain("isSupportAiEnabled")
    expect(source(path)).not.toContain("SUPPORT_AI_DISABLED_FEATURE")
  })

  it.each([
    "src/lib/inbox/ai-assist.ts",
    "src/lib/social/ai-autoreply.ts",
    "src/app/api/cron/inbox-autonomous-agent/route.ts",
  ])("does not couple Omnichannel execution to the Support switch in %s", (path) => {
    expect(source(path)).not.toContain("isSupportAiEnabled")
    expect(source(path)).not.toContain("SUPPORT_AI_DISABLED_FEATURE")
  })
})
