/**
 * When a prospect's Facebook Page connection ends
 * (src/lib/demo-center/demo-social-connection.ts).
 *
 * `demoSocialReleaseReason` is the one answer the webhook, the send path, the
 * demo page and the release cron all share. A row is live only while every
 * reason below is absent, and when several hold at once the first in this
 * order is the one recorded.
 */
import { describe, expect, it } from "vitest"
import type { DemoGrantTimeState } from "@/lib/demo-center/session"
import {
  DEMO_SOCIAL_CONNECT_WINDOW_MS,
  DEMO_SOCIAL_RELEASE_REASONS,
  demoSocialCode,
  demoSocialReleaseReason,
  demoSocialTokenPurpose,
  type DemoSocialLiveness,
} from "@/lib/demo-center/demo-social-connection"
import { hmacToken } from "@/lib/secure-token"
import { readFileSync } from "node:fs"
import path from "node:path"

const NOW = new Date("2026-10-21T10:00:00.000Z")
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

function liveGrant(overrides: Partial<DemoGrantTimeState> = {}): DemoGrantTimeState {
  return {
    status: "ACTIVE",
    linkExpiresAt: minutes(7 * 24 * 60),
    verificationExpiresAt: null,
    sessionStartedAt: minutes(-20),
    sessionLastSeenAt: minutes(-1),
    sessionExpiresAt: minutes(100),
    inactivityMinutes: 30,
    ...overrides,
  }
}

function liveRow(overrides: Partial<DemoSocialLiveness> = {}): DemoSocialLiveness {
  return {
    releaseReason: null,
    grantId: "grant-1",
    grant: liveGrant(),
    connectedAt: minutes(-10),
    createdAt: minutes(-15),
    expiresAt: minutes(600),
    ...overrides,
  }
}

describe("demoSocialReleaseReason", () => {
  it("keeps a connection live while its session is on, it is connected, and the Baku day lasts", () => {
    expect(demoSocialReleaseReason(liveRow(), NOW)).toBeNull()
    // Still connecting, inside the half hour.
    expect(demoSocialReleaseReason(liveRow({ connectedAt: null, createdAt: minutes(-29) }), NOW)).toBeNull()
  })

  it.each<[string, Partial<DemoSocialLiveness>, string]>([
    ["«Ayır» pressed", { releaseReason: "disconnected" }, "disconnected"],
    ["Meta deauthorized the app", { releaseReason: "deauthorized" }, "deauthorized"],
    ["the grant row deleted", { grantId: null, grant: null }, "grant_gone"],
    ["the grant id kept but its row gone", { grant: null }, "grant_gone"],
    ["the link revoked or re-issued", { grant: liveGrant({ status: "REVOKED" }) }, "revoked"],
    ["«Bitir» pressed", { grant: liveGrant({ status: "COMPLETED" }) }, "finished"],
    ["the grant expired", { grant: liveGrant({ status: "EXPIRED" }) }, "session_over"],
    ["two hours over, still ACTIVE in the database", { grant: liveGrant({ sessionExpiresAt: minutes(-1) }) }, "session_over"],
    ["the tab closed 31 minutes ago, still ACTIVE", { grant: liveGrant({ sessionLastSeenAt: minutes(-31) }) }, "session_over"],
    ["a session that never started", { grant: liveGrant({ sessionStartedAt: null }) }, "session_over"],
    ["a grant that is not in a session", { grant: liveGrant({ status: "OTP_VERIFIED" }) }, "session_over"],
    ["a connect started 30 minutes ago and never finished", { connectedAt: null, createdAt: minutes(-30) }, "connect_abandoned"],
    ["23:59 in Baku", { expiresAt: NOW }, "day_over"],
  ])("%s → %s", (_label, overrides, reason) => {
    expect(demoSocialReleaseReason(liveRow(overrides), NOW)).toBe(reason)
  })

  it("records the first reason in priority order when several hold at once", () => {
    const allOver: Partial<DemoSocialLiveness> = {
      releaseReason: "disconnected",
      grantId: null,
      grant: null,
      connectedAt: null,
      createdAt: minutes(-600),
      expiresAt: minutes(-1),
    }
    // Peel the reasons off one by one, from the top of the order.
    expect(demoSocialReleaseReason(liveRow(allOver), NOW)).toBe("disconnected")
    expect(demoSocialReleaseReason(liveRow({ ...allOver, releaseReason: null }), NOW)).toBe("grant_gone")
    const ended = { ...allOver, releaseReason: null, grantId: "grant-1" }
    expect(demoSocialReleaseReason(liveRow({ ...ended, grant: liveGrant({ status: "REVOKED", sessionExpiresAt: minutes(-5) }) }), NOW)).toBe("revoked")
    expect(demoSocialReleaseReason(liveRow({ ...ended, grant: liveGrant({ status: "COMPLETED", sessionExpiresAt: minutes(-5) }) }), NOW)).toBe("finished")
    expect(demoSocialReleaseReason(liveRow({ ...ended, grant: liveGrant({ sessionExpiresAt: minutes(-5) }) }), NOW)).toBe("session_over")
    expect(demoSocialReleaseReason(liveRow({ ...ended, grant: liveGrant() }), NOW)).toBe("connect_abandoned")
    expect(demoSocialReleaseReason(liveRow({ ...ended, grant: liveGrant(), connectedAt: minutes(-500) }), NOW)).toBe("day_over")
  })

  it("never answers with a reason the database refuses", () => {
    const migration = readFileSync(path.join(process.cwd(), "prisma/migrations/20261021090000_demo_social_connections/migration.sql"), "utf8")
    const check = migration.slice(migration.indexOf("demo_social_connections_release_reason_check"))
    const allowed = Array.from(check.slice(0, check.indexOf("));")).matchAll(/'([a-z_]+)'/g), (match) => match[1])
    expect(allowed).toEqual([...DEMO_SOCIAL_RELEASE_REASONS])
  })

  it("uses the half hour it names for an abandoned connect", () => {
    expect(DEMO_SOCIAL_CONNECT_WINDOW_MS).toBe(30 * 60_000)
  })
})

describe("the row's code and token purposes", () => {
  it("derives the Page's code from the grant, in the format the database checks, apart from the WhatsApp code", () => {
    const code = demoSocialCode("grant-abc")
    expect(code).toMatch(/^LD-[0-9A-F]{6}$/)
    expect(demoSocialCode("grant-abc")).toBe(code)
    expect(demoSocialCode("grant-abd")).not.toBe(code)
    // The WhatsApp thread's code for the same grant (demoWhatsAppCode).
    expect(code).not.toBe(`LD-${hmacToken("grant-abc", "demo-whatsapp-code").slice(0, 6).toUpperCase()}`)
  })

  it("gives each row and each kind of token its own purpose, so a cipher cannot be moved", () => {
    expect(demoSocialTokenPurpose("row-1", "user")).toBe("demo-social:user:row-1")
    expect(new Set([
      demoSocialTokenPurpose("row-1", "user"),
      demoSocialTokenPurpose("row-1", "page"),
      demoSocialTokenPurpose("row-2", "page"),
    ]).size).toBe(3)
  })
})
