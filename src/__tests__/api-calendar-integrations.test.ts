import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest, NextResponse } from "next/server"

vi.mock("@/lib/prisma", () => ({
  prisma: {
    ticket: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    event: { findMany: vi.fn() },
    activity: { findMany: vi.fn() },
    user: { findFirst: vi.fn(), update: vi.fn() },
    account: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    channelConfig: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  },
  logAudit: vi.fn(),
}))

vi.mock("@/lib/api-auth", () => ({
  getSession: vi.fn(),
  getOrgId: vi.fn(),
  requireAuth: vi.fn(),
  requireSessionAuth: vi.fn(),
  isAuthError: vi.fn((v) => v instanceof NextResponse),
}))
vi.mock("@/lib/auth", () => ({
  auth: vi.fn().mockResolvedValue({ user: { id: "user-1", email: "a@b.com", organizationId: "org-1" } }),
}))
vi.mock("@/lib/constants", () => ({
  PAGE_SIZE: { DEFAULT: 50, CALENDAR_AGENT: 200 },
}))
vi.mock("@/lib/google-calendar", () => ({
  listCalendarEvents: vi.fn(),
  createCalendarEvent: vi.fn(),
}))
vi.mock("@/lib/slack", () => ({
  sendSlackNotification: vi.fn(),
}))
vi.mock("googleapis", () => {
  const MockOAuth2 = vi.fn().mockImplementation(function (this: any) {
    this.generateAuthUrl = vi.fn().mockReturnValue("https://accounts.google.com/o/oauth2/auth?fake=1")
    this.getToken = vi.fn().mockResolvedValue({
      tokens: {
        access_token: "at-123",
        refresh_token: "rt-123",
        expiry_date: Date.now() + 3600000,
        token_type: "Bearer",
        scope: "https://www.googleapis.com/auth/calendar.events",
      },
    })
  })
  return {
    google: {
      auth: { OAuth2: MockOAuth2 },
    },
  }
})

import { GET as GET_AGENT } from "@/app/api/v1/calendar/agent/route"
import { GET as GET_FEED } from "@/app/api/v1/calendar/feed/[token]/route"
import { POST as GENERATE_TOKEN } from "@/app/api/v1/calendar/generate-token/route"
import { GET as GET_TOKEN } from "@/app/api/v1/calendar/token/route"
import { GET as GCAL_CONNECT } from "@/app/api/v1/integrations/google-calendar/connect/route"
import { GET as GCAL_CALLBACK } from "@/app/api/v1/integrations/google-calendar/callback/route"
import { GET as GCAL_STATUS, DELETE as GCAL_DISCONNECT } from "@/app/api/v1/integrations/google-calendar/status/route"
import { GET as GCAL_LIST, POST as GCAL_CREATE } from "@/app/api/v1/integrations/google-calendar/route"
import { GET as SLACK_GET, POST as SLACK_POST, PUT as SLACK_PUT, DELETE as SLACK_DELETE } from "@/app/api/v1/integrations/slack/route"
import { prisma } from "@/lib/prisma"
import { getOrgId, getSession, requireAuth, requireSessionAuth } from "@/lib/api-auth"
import { auth } from "@/lib/auth"
import { listCalendarEvents, createCalendarEvent } from "@/lib/google-calendar"
import { sendSlackNotification } from "@/lib/slack"

function makeReq(url: string, init?: ConstructorParameters<typeof NextRequest>[1]): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), init)
}

function makeParams<T extends Record<string, string>>(obj: T): { params: Promise<T> } {
  return { params: Promise.resolve(obj) }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getOrgId).mockResolvedValue("org-1")
  // The slack integration route uses requireAuth; default to a valid admin auth.
  vi.mocked(requireAuth).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" } as any)
  vi.mocked(requireSessionAuth).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" } as any)
  vi.mocked(auth).mockResolvedValue({ user: { id: "user-1", email: "a@b.com", organizationId: "org-1" } } as any)
  // google-calendar routes now read userId from the withRls-passed session (getSession), not auth()
  vi.mocked(getSession).mockResolvedValue({ orgId: "org-1", userId: "user-1", role: "admin", email: "a@b.com", name: "Test" } as any)
})

// ─── GET /api/v1/calendar/agent ─────────────────────────────────────

describe("GET /api/v1/calendar/agent", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(getOrgId).mockResolvedValue(null as any)
    vi.mocked(getSession).mockResolvedValue(null as any)

    const res = await GET_AGENT(makeReq("http://localhost:3000/api/v1/calendar/agent?from=2026-04-01&to=2026-04-07"))
    expect(res.status).toBe(401)
  })

  it("returns 400 when from or to missing", async () => {
    const res = await GET_AGENT(makeReq("http://localhost:3000/api/v1/calendar/agent?from=2026-04-01"))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toContain("from and to query params required")
  })

  it("returns aggregated calendar items with counts", async () => {
    vi.mocked(prisma.ticket.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { id: "ev1", name: "Standup", status: "scheduled", type: "meeting", startDate: new Date("2026-04-03T10:00:00Z"), endDate: new Date("2026-04-03T11:00:00Z"), location: "Zoom", isOnline: true },
    ] as any)
    vi.mocked(prisma.activity.findMany).mockResolvedValue([] as any)

    const res = await GET_AGENT(makeReq("http://localhost:3000/api/v1/calendar/agent?from=2026-04-01&to=2026-04-07"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.items).toHaveLength(1)
    expect(json.data.items[0].type).toBe("event")
    expect(json.data.counts.events).toBe(1)
    expect(json.data.counts.tickets).toBe(0)
  })
})

// ─── GET /api/v1/calendar/feed/:token ───────────────────────────────

describe("GET /api/v1/calendar/feed/:token", () => {
  it("returns 401 for invalid token", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await GET_FEED(makeReq("http://localhost:3000/api/v1/calendar/feed/bad-token"), makeParams({ token: "bad-token" }))
    expect(res.status).toBe(401)
  })

  it("requires a fresh active token owner and active organization", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null)

    const res = await GET_FEED(
      makeReq("http://localhost:3000/api/v1/calendar/feed/disabled-token"),
      makeParams({ token: "disabled-token" }),
    )

    expect(res.status).toBe(401)
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: {
        calendarToken: "disabled-token",
        isActive: true,
        organization: { isActive: true },
      },
      select: { id: true, organizationId: true },
    })
    expect(prisma.task.findMany).not.toHaveBeenCalled()
  })

  it("scopes the feed to the token owner's primary and collaborator tasks", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", organizationId: "org-1", calendarToken: "valid-token" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([
      { id: "t1", title: "Follow up", description: "Call John", status: "todo", priority: "high", dueDate: new Date("2026-04-15"), relatedType: "call" },
    ] as any)

    const res = await GET_FEED(makeReq("http://localhost:3000/api/v1/calendar/feed/valid-token"), makeParams({ token: "valid-token" }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/calendar")
    expect(res.headers.get("cache-control")).toContain("no-store")
    expect(res.headers.get("x-content-type-options")).toBe("nosniff")
    const body = await res.text()
    expect(body).toContain("BEGIN:VCALENDAR")
    expect(body).toContain("[Call] Follow up")
    expect(body).toContain("PRIORITY:1")
    expect(prisma.task.findMany).toHaveBeenCalledWith({
      where: {
        organizationId: "org-1",
        dueDate: { not: null },
        deletedAt: null,
        OR: [
          { assignedTo: "u1" },
          { collaborators: { some: { userId: "u1" } } },
        ],
      },
      orderBy: { dueDate: "asc" },
    })
  })

  it("escapes CR/LF in task-controlled calendar fields", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1", organizationId: "org-1" } as any)
    vi.mocked(prisma.task.findMany).mockResolvedValue([{
      id: "t-injection",
      title: "Review\rATTENDEE:mailto:attacker@example.com\nEnd",
      description: "Line one\r\nLOCATION:Injected",
      status: "todo",
      priority: "low",
      dueDate: new Date("2026-04-15"),
      relatedType: null,
    }] as any)

    const res = await GET_FEED(
      makeReq("http://localhost:3000/api/v1/calendar/feed/valid-token"),
      makeParams({ token: "valid-token" }),
    )
    const body = await res.text()

    expect(body).toContain("SUMMARY:Review\\nATTENDEE:mailto:attacker@example.com\\nEnd")
    expect(body).toContain("DESCRIPTION:Line one\\nLOCATION:Injected")
    expect(body).not.toContain("\rATTENDEE:")
    expect(body).not.toContain("\r\nLOCATION:Injected")
  })
})

// ─── POST /api/v1/calendar/generate-token ───────────────────────────

describe("POST /api/v1/calendar/generate-token", () => {
  it("returns 401 when no session", async () => {
    vi.mocked(auth).mockResolvedValue(null as any)
    vi.mocked(requireSessionAuth).mockResolvedValue(new NextResponse(null, { status: 401 }) as never)

    const res = await GENERATE_TOKEN(makeReq("http://localhost:3000/api/v1/calendar/generate-token", { method: "POST" }))
    expect(res.status).toBe(401)
  })

  it("generates token and returns feedUrl", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ id: "u1" } as any)
    vi.mocked(prisma.user.update).mockResolvedValue({} as any)

    const res = await GENERATE_TOKEN(makeReq("http://localhost:3000/api/v1/calendar/generate-token", { method: "POST" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.token).toBeDefined()
    expect(json.data.feedUrl).toContain("/api/v1/calendar/feed/")
  })
})

// ─── GET /api/v1/calendar/token ─────────────────────────────────────

describe("GET /api/v1/calendar/token", () => {
  it("returns existing token and feedUrl", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ calendarToken: "abc123" } as any)

    const res = await GET_TOKEN(makeReq("http://localhost:3000/api/v1/calendar/token"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.token).toBe("abc123")
    expect(json.data.feedUrl).toContain("abc123")
  })

  it("returns null token when user has no calendar token", async () => {
    vi.mocked(prisma.user.findFirst).mockResolvedValue({ calendarToken: null } as any)

    const res = await GET_TOKEN(makeReq("http://localhost:3000/api/v1/calendar/token"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.token).toBeNull()
    expect(json.data.feedUrl).toBeNull()
  })
})

// ─── GET /api/v1/integrations/google-calendar/connect ───────────────

describe("GET /api/v1/integrations/google-calendar/connect", () => {
  it("returns 500 when Google OAuth not configured", async () => {
    // env vars not set — the route checks process.env.GOOGLE_CLIENT_ID
    const originalClientId = process.env.GOOGLE_CLIENT_ID
    const originalClientSecret = process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET

    const res = await GCAL_CONNECT(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/connect"))
    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json.error).toBe("Google OAuth not configured")

    // restore
    if (originalClientId) process.env.GOOGLE_CLIENT_ID = originalClientId
    if (originalClientSecret) process.env.GOOGLE_CLIENT_SECRET = originalClientSecret
  })

  it("returns OAuth URL when configured", async () => {
    process.env.GOOGLE_CLIENT_ID = "test-client-id"
    process.env.GOOGLE_CLIENT_SECRET = "test-client-secret"

    const res = await GCAL_CONNECT(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/connect"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.url).toBeDefined()

    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
  })
})

// ─── GET /api/v1/integrations/google-calendar/callback ──────────────

describe("GET /api/v1/integrations/google-calendar/callback", () => {
  it("redirects with error when error param present", async () => {
    const res = await GCAL_CALLBACK(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/callback?error=access_denied"))
    expect(res.status).toBe(307)
    const location = res.headers.get("location") || ""
    expect(location).toContain("gcal=error")
    expect(location).toContain("access_denied")
  })

  it("redirects with error when code or state missing", async () => {
    const res = await GCAL_CALLBACK(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/callback"))
    expect(res.status).toBe(307)
    const location = res.headers.get("location") || ""
    expect(location).toContain("missing_params")
  })
})

// ─── GET /api/v1/integrations/google-calendar/status ────────────────

describe("GET /api/v1/integrations/google-calendar/status", () => {
  it("returns connected=false when no account found", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null)

    const res = await GCAL_STATUS(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/status"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.connected).toBe(false)
  })

  it("returns connected=true when account has refresh token", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      provider: "google-calendar", scope: "calendar.events", expires_at: Math.floor(Date.now() / 1000) - 100, refresh_token: "rt-123",
    } as any)

    const res = await GCAL_STATUS(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/status"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.data.connected).toBe(true)
    expect(json.data.provider).toBe("google-calendar")
  })

  it("DELETE disconnects google calendar", async () => {
    vi.mocked(prisma.account.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await GCAL_DISCONNECT(makeReq("http://localhost:3000/api/v1/integrations/google-calendar/status", { method: "DELETE" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(prisma.account.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1", provider: "google-calendar" },
    })
  })
})

// ─── GET/POST /api/v1/integrations/google-calendar ──────────────────

describe("GET /api/v1/integrations/google-calendar", () => {
  it("returns 403 when not connected", async () => {
    vi.mocked(listCalendarEvents).mockRejectedValue(new Error("Google Calendar not connected"))

    const res = await GCAL_LIST(makeReq("http://localhost:3000/api/v1/integrations/google-calendar?days=7"))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.error).toContain("not connected")
  })

  it("returns calendar events", async () => {
    vi.mocked(listCalendarEvents).mockResolvedValue([
      { id: "ev1", summary: "Meeting", start: { dateTime: "2026-04-14T10:00:00Z" } },
    ] as any)

    const res = await GCAL_LIST(makeReq("http://localhost:3000/api/v1/integrations/google-calendar?days=7"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /api/v1/integrations/google-calendar", () => {
  it("returns 400 for invalid event data", async () => {
    const res = await GCAL_CREATE(makeReq("http://localhost:3000/api/v1/integrations/google-calendar", {
      method: "POST",
      body: JSON.stringify({ description: "no summary" }),
    }))
    expect(res.status).toBe(400)
  })

  it("creates event and returns 201", async () => {
    vi.mocked(createCalendarEvent).mockResolvedValue({ id: "gcal-ev1", summary: "New Event" } as any)

    const res = await GCAL_CREATE(makeReq("http://localhost:3000/api/v1/integrations/google-calendar", {
      method: "POST",
      body: JSON.stringify({ summary: "New Event", startTime: "2026-04-15T10:00:00Z" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.summary).toBe("New Event")
  })
})

// ─── /api/v1/integrations/slack ─────────────────────────────────────

describe("GET /api/v1/integrations/slack", () => {
  it("returns 401 when no orgId", async () => {
    vi.mocked(requireAuth).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }) as any)

    const res = await SLACK_GET(makeReq("http://localhost:3000/api/v1/integrations/slack"))
    expect(res.status).toBe(401)
  })

  it("returns slack configs", async () => {
    vi.mocked(prisma.channelConfig.findMany).mockResolvedValue([
      { id: "sc1", configName: "General", channelType: "slack", webhookUrl: "https://hooks.slack.com/services/x", isActive: true },
    ] as any)

    const res = await SLACK_GET(makeReq("http://localhost:3000/api/v1/integrations/slack"))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data).toHaveLength(1)
  })
})

describe("POST /api/v1/integrations/slack", () => {
  it("sends test message when action=test", async () => {
    vi.mocked(sendSlackNotification).mockResolvedValue(true as any)

    const res = await SLACK_POST(makeReq("http://localhost:3000/api/v1/integrations/slack", {
      method: "POST",
      body: JSON.stringify({ action: "test", webhookUrl: "https://hooks.slack.com/services/x" }),
    }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.message).toBe("Test message sent")
  })

  it("creates slack config and returns 201", async () => {
    vi.mocked(prisma.channelConfig.create).mockResolvedValue({
      id: "sc-new", configName: "Alerts", channelType: "slack", webhookUrl: "https://hooks.slack.com/services/y", isActive: true,
    } as any)

    const res = await SLACK_POST(makeReq("http://localhost:3000/api/v1/integrations/slack", {
      method: "POST",
      body: JSON.stringify({ configName: "Alerts", webhookUrl: "https://hooks.slack.com/services/y" }),
    }))
    expect(res.status).toBe(201)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.configName).toBe("Alerts")
  })

  it("returns 400 for invalid config data", async () => {
    const res = await SLACK_POST(makeReq("http://localhost:3000/api/v1/integrations/slack", {
      method: "POST",
      body: JSON.stringify({ configName: "", webhookUrl: "not-a-url" }),
    }))
    expect(res.status).toBe(400)
  })
})

describe("PUT /api/v1/integrations/slack", () => {
  it("returns 400 when id missing", async () => {
    const res = await SLACK_PUT(makeReq("http://localhost:3000/api/v1/integrations/slack", {
      method: "PUT",
      body: JSON.stringify({ configName: "Updated" }),
    }))
    expect(res.status).toBe(400)
  })

  it("returns 404 when config not found", async () => {
    vi.mocked(prisma.channelConfig.updateMany).mockResolvedValue({ count: 0 } as any)

    const res = await SLACK_PUT(makeReq("http://localhost:3000/api/v1/integrations/slack", {
      method: "PUT",
      body: JSON.stringify({ id: "sc-missing", configName: "X" }),
    }))
    expect(res.status).toBe(404)
  })
})

describe("DELETE /api/v1/integrations/slack", () => {
  it("returns 400 when id missing", async () => {
    const res = await SLACK_DELETE(makeReq("http://localhost:3000/api/v1/integrations/slack", { method: "DELETE" }))
    expect(res.status).toBe(400)
  })

  it("deletes slack config", async () => {
    vi.mocked(prisma.channelConfig.deleteMany).mockResolvedValue({ count: 1 } as any)

    const res = await SLACK_DELETE(makeReq("http://localhost:3000/api/v1/integrations/slack?id=sc1", { method: "DELETE" }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.data.deleted).toBe("sc1")
  })
})
