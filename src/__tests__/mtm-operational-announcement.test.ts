import { describe, expect, it } from "vitest"
import {
  isOperationalAnnouncementActive,
  localizedOperationalText,
  operationalLocale,
  parseOperationalAnnouncementMetadata,
  sanitizeOperationalText,
} from "@/lib/mtm/operational-announcement"

const metadata = {
  keyMessage: true,
  messageId: "message-1",
  threadId: "thread-1",
  effectiveFrom: "2026-07-29T08:00:00.000Z",
  effectiveUntil: "2026-08-05T08:00:00.000Z",
  fallbackBody: "Fallback",
  localizations: {
    en: "English",
    ru: "<b>Русский</b>",
  },
}

describe("MTM operational announcement", () => {
  it("normalizes supported locale tags and falls back to English", () => {
    expect(operationalLocale("ru-RU,ru;q=0.9")).toBe("ru")
    expect(operationalLocale("az_AZ")).toBe("az")
    expect(operationalLocale("de-DE")).toBe("en")
  })

  it("removes executable blocks, markup and control characters", () => {
    expect(sanitizeOperationalText(
      "<script>alert('x')</script><style>body{display:none}</style><b>Plan</b>\u0000 changed",
    )).toBe("Plan changed")
  })

  it("parses, sanitizes and localizes valid metadata", () => {
    const parsed = parseOperationalAnnouncementMetadata(metadata)
    expect(parsed).not.toBeNull()
    expect(parsed?.localizations.ru).toBe("Русский")
    expect(localizedOperationalText(parsed!, "Message body", "ru")).toBe("Русский")
    expect(localizedOperationalText(parsed!, "Message body", "az")).toBe("English")
  })

  it("rejects invalid ranges and hides messages outside the active interval", () => {
    expect(parseOperationalAnnouncementMetadata({
      ...metadata,
      effectiveUntil: metadata.effectiveFrom,
    })).toBeNull()

    const parsed = parseOperationalAnnouncementMetadata(metadata)!
    expect(isOperationalAnnouncementActive(parsed, new Date("2026-07-29T07:59:59.999Z"))).toBe(false)
    expect(isOperationalAnnouncementActive(parsed, new Date("2026-07-29T08:00:00.000Z"))).toBe(true)
    expect(isOperationalAnnouncementActive(parsed, new Date("2026-08-05T08:00:00.000Z"))).toBe(false)
  })
})
