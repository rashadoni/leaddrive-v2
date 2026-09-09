import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync("src/app/(dashboard)/social-monitoring/page.tsx", "utf8")
const replyChannels = readFileSync("src/components/social/social-reply-channels-card.tsx", "utf8")

describe("Social Monitoring AI reply queue UI", () => {
  it("keeps Replies and Agent available in Brand Protection workspaces and deep links", () => {
    expect(page).toContain('{ value: "replies" as const, label: t("views.replies")')
    expect(page).toContain('{ value: "agent" as const, label: t("views.agent")')
    expect(page).toContain('!["monitors", "mentions", "replies", "agent"].includes(nextView)')
    expect(page).not.toMatch(/brandProtectionOnly\s*&&\s*nextView\s*===\s*"replies"/)
  })

  it("loads the server reply queue and exposes a clear draft action with status", () => {
    expect(page).toContain('params.set("queue", "ai_replies")')
    expect(page).toContain('t("actionAiDraft")')
    expect(page).toContain('t(`aiStatus.${m.aiDrafts[0].status}`)')
    expect(page).toContain('stats?.replyQueueTotal')
  })

  it("keeps live controls disabled in Brand Protection mode", () => {
    expect(page).toContain('!settings?.brandProtectionOnly')
    expect(page).toContain('<SocialReplyChannelsCard brandProtectionOnly={brandProtectionOnly} />')
    expect(replyChannels).toContain('disabled={brandProtectionOnly || saving')
    expect(replyChannels).toContain('brandProtectionOnly ? ["dry_run"] as const : SEND_MODES')
  })
})
