import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(path, "utf8")

function filesUnder(path: string): string[] {
  if (!existsSync(path)) return []
  if (!statSync(path).isDirectory()) return [path]
  return readdirSync(path).flatMap((entry) => filesUnder(join(path, entry)))
}

describe("Gemini-only voice provider fences", () => {
  it("makes the browser gate require the exact Gemini provider selector", () => {
    const gate = read("src/lib/ai/voice/gate.ts")
    expect(gate).toContain('cfg.realtimeProvider !== "gemini_live"')
    expect(gate).toContain("voice_provider_not_gemini_live")
  })

  it("does not leave any dispatchable workflow that writes legacy OpenAI voice settings", () => {
    const retiredWorkflows = [
      ".github/workflows/stage-pbx-control-plane.yml",
      ".github/workflows/set-pbx-voice-speed.yml",
      ".github/workflows/voice-realtime-section-eval.yml",
    ].map(read).join("\n")
    expect(retiredWorkflows).not.toContain("OPENAI_API_KEY:")
    expect(retiredWorkflows).not.toContain("VOICE_ENGINE=openai_realtime")
    expect(retiredWorkflows).not.toContain("OPENAI_REALTIME_SPEED")
    expect(retiredWorkflows.match(/exit 1/g)?.length).toBe(3)

    const pbxStage = read("scripts/pbx/fanum-pbx-stage")
    expect(pbxStage).toContain("legacy OpenAI voice configuration is retired")
    const allowlist = pbxStage.slice(
      pbxStage.indexOf("readonly ALLOWED_ENV_KEYS="),
      pbxStage.indexOf("# --- preconditions"),
    )
    expect(allowlist).not.toContain("OPENAI_API_KEY")

    const evaluator = read("scripts/voice-realtime-section-eval.mjs")
    expect(evaluator).not.toContain("api.openai.com")
    expect(evaluator).not.toContain("OPENAI_API_KEY")
    expect(existsSync("src/lib/ai/voice/realtime-event-lifecycle.ts")).toBe(false)
  })

  it("keeps every browser voice runtime path free of the retired OpenAI handshake", () => {
    expect(existsSync("src/lib/ai/voice/openai-realtime.ts")).toBe(false)
    expect(existsSync("src/app/api/v1/ai/voice/session/connect/route.ts")).toBe(false)
    const runtime = [
      "src/components/ai/voice-console.tsx",
      ...filesUnder("src/lib/ai/voice"),
      ...filesUnder("src/app/api/v1/ai/voice/session"),
    ].filter((path) => /\.(?:ts|tsx|js|mjs)$/.test(path)).map(read).join("\n")
    expect(runtime).not.toContain("api.openai.com")
    expect(runtime).not.toContain("OPENAI_REALTIME")
    expect(runtime).not.toMatch(/["']\/api\/v1\/ai\/voice\/session\/connect["']/)
  })

  it("installs Gemini activation atomically without putting the API key in SSH argv", () => {
    const workflow = read(".github/workflows/set-voice-env.yml")
    expect(workflow).toContain("group: production-deploy")
    expect(workflow).toContain('[ "$GITHUB_REF" = "refs/heads/main" ]')
    expect(workflow.indexOf('Require the protected production branch')).toBeLessThan(workflow.indexOf('actions/checkout'))
    expect(workflow.indexOf('Require the protected production branch')).toBeLessThan(workflow.indexOf('GEMINI_LIVE_SETUP_PROBE'))
    expect(workflow).toContain('GEMINI_LIVE_RESUMPTION_PROBE: "1"')
    expect(workflow).toContain('[ "$REMOTE_SHA" = "$GITHUB_SHA" ]')
    expect(workflow).toContain(".next/standalone/.deploy-sha")
    expect(workflow).toContain('write_var VOICE_REALTIME_PROVIDER "gemini_live"')
    expect(workflow).toContain('[ -n "$VOICE_PILOT_ORG_ID" ] ||')
    expect(workflow).toContain('VOICE_PILOT_USER_IDS="$(read_env_value "$CANDIDATE" VOICE_PILOT_USER_IDS)"')
    expect(workflow).toContain('VOICE_MONTHLY_MINUTES="$(read_env_value "$CANDIDATE" VOICE_MONTHLY_MINUTES)"')
    expect(workflow).toContain('VOICE_MAX_SESSION_SECONDS="$(read_env_value "$CANDIDATE" VOICE_MAX_SESSION_SECONDS)"')
    expect(workflow).toContain('VOICE_MAX_TOOL_CALLS="$(read_env_value "$CANDIDATE" VOICE_MAX_TOOL_CALLS)"')
    expect(workflow).toContain('mv -f "$ENV_NEXT" "$ENV"')
    expect(workflow).toContain("rollback()")
    expect(workflow).not.toContain("GEMINI_API_KEY='$GEMINI_API_KEY'")
    expect(workflow).not.toContain("ssh-keyscan")
  })

  it("drains fresh browser sessions and rejects partial provider env before deploy", () => {
    const deploy = read("scripts/server-deploy.sh")
    expect(deploy).toContain('VOICE_REALTIME_PROVIDER:-}" = "gemini_live"')
    expect(deploy).toContain("require_env GEMINI_API_KEY")
    expect(deploy).toContain("recent active browser voice sessions must drain before deployment")
    expect(deploy).toContain("lastHeartbeatAt")
    expect(deploy).toContain("CURRENT_TIMESTAMP - interval '90 seconds'")
  })
})
