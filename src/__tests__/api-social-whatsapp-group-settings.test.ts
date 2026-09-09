import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

type AuthContext = { orgId: string; userId: string; role: string }
type RouteHandler = (req: NextRequest, auth: AuthContext) => Promise<Response>

const db: {
  channel: { id: string; settings: Record<string, unknown> } | null
} = {
  channel: {
    id: "wa-1",
    settings: {
      whatsappSurveyTemplate: "survey_default",
      socialLeadGroup: { id: "120363@g.us", name: "TikTok leads" },
    },
  },
}

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (_module: string, _action: string, handler: RouteHandler) =>
    (req: NextRequest) => handler(req, { orgId: "org-1", userId: "user-1", role: "manager" }),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    channelConfig: {
      findFirst: vi.fn(async () => db.channel),
      update: vi.fn(async ({ data }) => {
        if (db.channel) db.channel = { ...db.channel, settings: data.settings }
        return db.channel
      }),
    },
  },
}))

import { GET, PUT } from "@/app/api/v1/social/whatsapp-group-settings/route"
import { prisma } from "@/lib/prisma"

function request(body?: unknown) {
  return new NextRequest("http://localhost/api/v1/social/whatsapp-group-settings", {
    method: body === undefined ? "GET" : "PUT",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.channel = {
    id: "wa-1",
    settings: {
      whatsappSurveyTemplate: "survey_default",
      socialLeadGroup: { id: "120363@g.us", name: "TikTok leads" },
    },
  }
})

describe("social WhatsApp group settings API", () => {
  it("reads the configured social lead group", async () => {
    const res = await GET(request())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({
      success: true,
      data: {
        channelConnected: true,
        groupId: "120363@g.us",
        groupName: "TikTok leads",
      },
    })
  })

  it("saves the group without deleting other WhatsApp settings", async () => {
    const res = await PUT(request({ groupId: "999@g.us", groupName: "New leads" }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data).toMatchObject({ channelConnected: true, groupId: "999@g.us", groupName: "New leads" })
    expect(prisma.channelConfig.update).toHaveBeenCalledWith({
      where: { id: "wa-1" },
      data: {
        settings: {
          whatsappSurveyTemplate: "survey_default",
          socialLeadGroup: { id: "999@g.us", name: "New leads" },
        },
      },
    })
  })

  it("does not create a fake WhatsApp channel when the channel is missing", async () => {
    db.channel = null

    const getRes = await GET(request())
    const getJson = await getRes.json()
    const putRes = await PUT(request({ groupId: "999@g.us" }))

    expect(getRes.status).toBe(200)
    expect(getJson.data).toEqual({ channelConnected: false, groupId: "", groupName: "" })
    expect(putRes.status).toBe(404)
    expect(prisma.channelConfig.update).not.toHaveBeenCalled()
  })
})
