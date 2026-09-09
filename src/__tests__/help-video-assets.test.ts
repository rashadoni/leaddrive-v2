import { describe, expect, it } from "vitest"
import {
  formatHelpVideoTitle,
  getHelpVideoAsset,
  getHelpVideoForPath,
  getHelpVideoForSlug,
  isHelpVideoBlockedByVoiceover,
  resolveHelpVideoRouteEntry,
  type HelpVideoLocale,
} from "@/content/help/video-assets"
import { HELP_VIDEO_AVAILABILITY } from "@/content/help/video-availability.generated"
import { collectAvailability } from "../../scripts/help-video/sync-video-availability.mjs"

const LOCALES: readonly HelpVideoLocale[] = ["az", "en", "ru"]

describe("help video availability", () => {
  it("keeps the generated manifest in sync with the recorded assets", () => {
    // Guards the whole feature: recording a new guide without re-running
    // `npm run help-video:sync` would leave the card hidden, and deleting an
    // asset without syncing would bring back the 404 → "not uploaded yet" card.
    expect(HELP_VIDEO_AVAILABILITY).toEqual(collectAvailability())
  })

  it("offers a video only for sections that actually have one", () => {
    for (const locale of LOCALES) {
      expect(getHelpVideoForPath("/deals", locale)?.slug).toBe("deals")
      expect(getHelpVideoForPath("/deals/abc123", locale)?.slug).toBe("deal-detail")
      expect(getHelpVideoForPath("/ai/actions", locale)?.slug).toBe("ai-actions")
      expect(getHelpVideoForPath("/inbox/automation", locale)?.slug).toBe("inbox-automation")
      expect(getHelpVideoForPath("/leads", locale)?.slug).toBe("leads")
      expect(getHelpVideoForPath("/quotes", locale)?.slug).toBe("quotes")
      expect(getHelpVideoForPath("/sequences", locale)?.slug).toBe("sequences")
      expect(getHelpVideoForPath("/forecast", locale)?.slug).toBe("forecast")
      expect(getHelpVideoForPath("/forecast/snapshots", locale)?.slug).toBe("forecast-snapshots")
      expect(getHelpVideoForPath("/forecast/waterfall", locale)?.slug).toBe("forecast-waterfall")
      expect(getHelpVideoForPath("/forecast/velocity", locale)?.slug).toBe("forecast-velocity")
      expect(getHelpVideoForPath("/settings/pipelines", locale)?.slug).toBe("pipelines")
      expect(getHelpVideoForPath("/settings/quotas", locale)?.slug).toBe("quotas")
      expect(getHelpVideoForPath("/settings/territories", locale)?.slug).toBe("territories")
      expect(getHelpVideoForPath("/settings/web-to-lead", locale)?.slug).toBe("web-to-lead")
      expect(getHelpVideoForPath("/boards", locale)?.slug).toBe("boards")
      expect(getHelpVideoForPath("/settings/sales-forecast", locale)?.slug).toBe("sales-forecast-settings")
      expect(getHelpVideoForPath("/settings/lead-rules", locale)?.slug).toBe("lead-rules")
    }
  })

  it("shows no card on registered sections whose guide was never recorded", () => {
    // The regression this suite exists for: the registry lists every section,
    // so an unrecorded one used to render a card whose <video> 404'd into
    // "Video hələ yüklənməyib". (/leads was the reported case; it has a guide
    // since 2026-07-29, so the assertion moved to still-unrecorded sections.)
    for (const path of ["/campaign-roi", "/mtm/map", "/contracts", "/reports", "/companies"]) {
      expect(resolveHelpVideoRouteEntry(path)).not.toBeNull() // still registered…
      expect(getHelpVideoForPath(path, "az")).toBeNull() // …but not offered
      expect(getHelpVideoForPath(path, "en")).toBeNull()
      expect(getHelpVideoForPath(path, "ru")).toBeNull()
    }
  })

  it("hides the help-drawer video button for unrecorded sections", () => {
    expect(getHelpVideoForSlug("ai-actions", "en")?.slug).toBe("ai-actions")
    expect(getHelpVideoForSlug("campaign-roi", "en")).toBeNull()
    expect(getHelpVideoForSlug("crm-dashboard", "en")).toBeNull()
  })

  it("refuses to build asset URLs for a locale that was never recorded", () => {
    const entry = resolveHelpVideoRouteEntry("/contracts")!

    expect(() => getHelpVideoAsset(entry, "az")).toThrow(/no recorded asset/)
  })

  it("does not auto-open the dashboard video on dashboard routes", () => {
    expect(getHelpVideoForPath("/dashboard", "en")).toBeNull()
  })
})

describe("help video assets", () => {
  it("keeps help video titles readable for acronyms", () => {
    expect(formatHelpVideoTitle("campaign-roi")).toBe("Campaign ROI")
    expect(formatHelpVideoTitle("ai-scoring")).toBe("AI Scoring")
    expect(formatHelpVideoTitle("mtm-settings")).toBe("MTM Settings")
    expect(formatHelpVideoTitle("loyalty-pos")).toBe("Loyalty POS")
  })

  it("versions help video asset URLs so the CDN serves the re-recorded guides", () => {
    const entry = getHelpVideoForSlug("deals", "ru")

    expect(entry).not.toBeNull()
    expect(getHelpVideoAsset(entry!, "ru").videoSrc).toBe(
      "/api/help-videos/deals.ru.VOICE.mp4?v=20260729-boards-guide",
    )
    expect(getHelpVideoAsset(entry!, "ru").posterSrc).toBe(
      "/api/help-videos/deals.ru.poster.jpg?v=20260729-boards-guide",
    )
  })

  // az is voiced by Gemini Kore (re-recorded 2026-07-28), en/ru by Azure.
  it("registers the approved AI Advisor tutorial", () => {
    expect(getHelpVideoForPath("/ai/actions", "en")?.slug).toBe("ai-actions")
    expect(isHelpVideoBlockedByVoiceover("ai-actions")).toBe(false)
    expect(formatHelpVideoTitle("ai-actions")).toBe("AI Advisor")
  })

  it("registers the approved Azure-voiced WhatsApp Business Calling tutorial", () => {
    expect(
      getHelpVideoForPath("/settings/channels/connect/whatsapp-business-calls", "en")?.slug
    ).toBe("whatsapp-business-calls")
    expect(formatHelpVideoTitle("whatsapp-business-calls")).toBe("WhatsApp Business Calling")
  })

  it("registers training videos for relocated operational sections", () => {
    const cases = [
      ["/settings/channels", "channels"],
      ["/settings/channels/connect/whatsapp-business", "channels"],
      ["/settings/channels/connect/facebook", "channels"],
      ["/settings/channels/connect/instagram", "channels"],
      ["/settings/channels/connect/tiktok", "channels"],
      ["/settings/channels/connect/atl-sms?stage=connect&mode=new", "channels"],
      ["/settings/web-to-lead", "web-to-lead"],
      ["/settings/lead-rules", "lead-rules"],
      ["/settings/sales-forecast", "sales-forecast-settings"],
      ["/settings/escalation", "escalation"],
      ["/mtm", "mtm-overview"],
      ["/mtm/map", "mtm-map"],
      ["/mtm/routes", "mtm-routes"],
      ["/mtm/visits", "mtm-visits"],
      ["/mtm/tasks", "mtm-tasks"],
      ["/mtm/customers", "mtm-customers"],
      ["/mtm/photos", "mtm-photos"],
      ["/mtm/alerts", "mtm-alerts"],
      ["/mtm/agents", "mtm-agents"],
      ["/mtm/analytics", "mtm-analytics"],
      ["/mtm/leaderboard", "mtm-leaderboard"],
      ["/mtm/activity", "mtm-activity"],
      ["/mtm/reports", "mtm-reports"],
      ["/mtm/settings", "mtm-settings"],
    ] as const

    // Registry coverage only — these sections stay ready for a future
    // recording; the card appears the moment their assets ship.
    for (const [path, slug] of cases) {
      expect(resolveHelpVideoRouteEntry(path)?.slug).toBe(slug)
    }
  })

  it("registers training videos for every marketing and loyalty sidebar section", () => {
    const cases = [
      ["/cdp/insights", "cdp-insights"],
      ["/cdp/merge-queue", "cdp-merge-queue"],
      ["/campaigns", "campaigns"],
      ["/segments", "segments"],
      ["/loyalty/builder", "loyalty-builder"],
      ["/loyalty/dashboard", "loyalty-dashboard"],
      ["/loyalty/tiers", "loyalty-tiers"],
      ["/loyalty/earn-rules", "loyalty-earn-rules"],
      ["/loyalty/promo-codes", "loyalty-promo-codes"],
      ["/loyalty/pos", "loyalty-pos"],
      ["/email-templates", "email-templates"],
      ["/email-log", "email-log"],
      ["/attribution/models", "attribution-models"],
      ["/campaign-roi", "campaign-roi"],
      ["/ai-scoring", "ai-scoring"],
      ["/journeys", "journeys"],
      ["/events", "events"],
      ["/surveys", "surveys"],
      ["/accounts/engagement", "account-engagement"],
    ] as const

    for (const [path, slug] of cases) {
      expect(resolveHelpVideoRouteEntry(path)?.slug).toBe(slug)
    }
  })
})
