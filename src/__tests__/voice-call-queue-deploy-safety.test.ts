import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const workflow = readFileSync(
  join(process.cwd(), ".github/workflows/deploy.yml"),
  "utf8",
)

describe("sequential AI-call production deploy safety", () => {
  it("runs the complete AI-call safety preflight before atomic production deployment", () => {
    const preflightName = "- name: Pre-deploy AI-call safety preflight"
    const deployName = "- name: Deploy atomically on production"
    const preflightIndex = workflow.indexOf(preflightName)
    const deployIndex = workflow.indexOf(deployName)

    expect(preflightIndex).toBeGreaterThanOrEqual(0)
    expect(deployIndex).toBeGreaterThan(preflightIndex)

    const preflight = workflow.slice(preflightIndex, deployIndex)

    expect(preflight).toContain(
      'process.env.VOICE_CALL_QUEUE_EXECUTION_ENABLED === "true"',
    )
    expect(preflight).toContain("settings->>'voiceQueueEnabled'")
    expect(preflight).toContain("proof.config.queueEnabledCount !== 0")

    expect(preflight).toContain("FROM voice_call_sessions")
    expect(preflight).toContain('"endedAt" IS NULL')
    expect(preflight).toContain("proof.active.count !== 0")

    expect(preflight).toContain("settings->>'voiceAgentPrompt'")
    expect(preflight).toContain("proof.config.voiceAgentConfigCount < 1")
    expect(preflight).toContain("proof.config.emptyPromptCount !== 0")
  })
})
