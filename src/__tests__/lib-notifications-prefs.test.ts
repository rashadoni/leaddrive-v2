import { describe, it, expect } from "vitest"
import {
  DEFAULT_SECTION_PUSH,
  shouldPush,
  type NotificationPrefs,
} from "@/lib/notifications/prefs"
import { NAV_GROUP_ORDER } from "@/lib/nav-items"

describe("DEFAULT_SECTION_PUSH", () => {
  it("CRM defaults to push ON (important/busy section)", () => {
    expect(DEFAULT_SECTION_PUSH["CRM"]).toBe(true)
  })

  it("Support defaults to push ON (important/busy section)", () => {
    expect(DEFAULT_SECTION_PUSH["Support"]).toBe(true)
  })

  it("Marketing defaults to push OFF", () => {
    expect(DEFAULT_SECTION_PUSH["Marketing"]).toBe(false)
  })

  it("Finance defaults to push OFF", () => {
    expect(DEFAULT_SECTION_PUSH["Finance"]).toBe(false)
  })

  it("Analytics defaults to push OFF", () => {
    expect(DEFAULT_SECTION_PUSH["Analytics"]).toBe(false)
  })

  it("Communication defaults to push OFF", () => {
    expect(DEFAULT_SECTION_PUSH["Communication"]).toBe(false)
  })

  it("all keys are members of NAV_GROUP_ORDER", () => {
    for (const section of Object.keys(DEFAULT_SECTION_PUSH)) {
      expect(NAV_GROUP_ORDER).toContain(section)
    }
  })
})

describe("shouldPush", () => {
  // ── Section default applies when prefs is empty ──

  it("CRM section push ON by default when prefs is empty", () => {
    expect(shouldPush({}, "CRM")).toBe(true)
  })

  it("Support section push ON by default when prefs is empty", () => {
    expect(shouldPush({}, "Support")).toBe(true)
  })

  it("Marketing section push OFF by default when prefs is empty", () => {
    expect(shouldPush({}, "Marketing")).toBe(false)
  })

  it("Finance section push OFF by default when prefs is empty", () => {
    expect(shouldPush({}, "Finance")).toBe(false)
  })

  it("unknown section defaults to false", () => {
    expect(shouldPush({}, "SomeFutureSection")).toBe(false)
  })

  // ── Explicit push:false blocks push ──

  it("explicit push:false blocks push even for CRM", () => {
    const prefs: NotificationPrefs = { CRM: { push: false } }
    expect(shouldPush(prefs, "CRM")).toBe(false)
  })

  it("explicit push:false blocks push for Support", () => {
    const prefs: NotificationPrefs = { Support: { push: false } }
    expect(shouldPush(prefs, "Support")).toBe(false)
  })

  it("explicit push:true enables push for Marketing (override default off)", () => {
    const prefs: NotificationPrefs = { Marketing: { push: true } }
    expect(shouldPush(prefs, "Marketing")).toBe(true)
  })

  // ── Per-kind override ──

  it("per-kind override false blocks push even when section push is true", () => {
    const prefs: NotificationPrefs = {
      CRM: {
        push: true,
        types: { "deal.won": false },
      },
    }
    expect(shouldPush(prefs, "CRM", "deal.won")).toBe(false)
  })

  it("per-kind override false blocks push even when section uses default (true)", () => {
    const prefs: NotificationPrefs = {
      CRM: {
        push: true,
        types: { "task.created": false },
      },
    }
    expect(shouldPush(prefs, "CRM", "task.created")).toBe(false)
  })

  it("unknown kind defaults to true (no override = enabled)", () => {
    const prefs: NotificationPrefs = { CRM: { push: true } }
    expect(shouldPush(prefs, "CRM", "deal.won")).toBe(true)
    expect(shouldPush(prefs, "CRM", "some.future.kind")).toBe(true)
  })

  it("section push false blocks even when kind override is true", () => {
    const prefs: NotificationPrefs = {
      Marketing: {
        push: false,
        types: { "campaign.sent": true },
      },
    }
    // section off → false regardless of kind override
    expect(shouldPush(prefs, "Marketing", "campaign.sent")).toBe(false)
  })

  it("kind unset + section true → push true", () => {
    const prefs: NotificationPrefs = { Support: { push: true } }
    expect(shouldPush(prefs, "Support", "ticket.created")).toBe(true)
  })

  it("kind set to true + section true → push true", () => {
    const prefs: NotificationPrefs = {
      Support: { push: true, types: { "ticket.created": true } },
    }
    expect(shouldPush(prefs, "Support", "ticket.created")).toBe(true)
  })

  // ── No kind argument ──

  it("no kind argument → only section-level check applies", () => {
    const prefs: NotificationPrefs = { CRM: { push: true } }
    expect(shouldPush(prefs, "CRM")).toBe(true)

    const prefsOff: NotificationPrefs = { CRM: { push: false } }
    expect(shouldPush(prefsOff, "CRM")).toBe(false)
  })

  // ── Section not in prefs, section default applies ──

  it("section missing from prefs falls back to DEFAULT_SECTION_PUSH", () => {
    const prefs: NotificationPrefs = { Support: { push: false } }
    // CRM not in prefs → falls back to DEFAULT_SECTION_PUSH["CRM"] = true
    expect(shouldPush(prefs, "CRM")).toBe(true)
    // Analytics not in prefs → DEFAULT is false
    expect(shouldPush(prefs, "Analytics")).toBe(false)
  })
})
