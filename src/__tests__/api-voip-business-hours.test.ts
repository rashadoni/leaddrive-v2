import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  wrappers: [] as Array<{ module: string; action: string }>,
  findUnique: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (
    module: string,
    action: string,
    handler: (req: NextRequest, auth: { orgId: string; userId: string; role: string }) => unknown,
  ) => {
    mocks.wrappers.push({ module, action });
    return (req: NextRequest) => handler(req, {
      orgId: "org_voip_only",
      userId: "admin_1",
      role: "admin",
    });
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessHours: {
      findUnique: mocks.findUnique,
      upsert: mocks.upsert,
    },
  },
}));

import { GET, PUT } from "@/app/api/v1/voip/business-hours/route";

const storedRow = {
  id: "bh_voice",
  organizationId: "org_voip_only",
  channelType: "voice",
  timezone: "Asia/Baku",
  schedule: { mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] } },
  holidays: [],
  isActive: true,
  welcomeMessage: null,
  awayMessage: null,
  createdBy: "admin_1",
  createdAt: new Date("2026-08-09T00:00:00Z"),
  updatedAt: new Date("2026-08-09T00:00:00Z"),
};

function jsonRequest(body: unknown) {
  return new NextRequest("https://app.leaddrivecrm.org/api/v1/voip/business-hours", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function bearerRequest(method: "GET" | "PUT", body?: unknown) {
  return new NextRequest("https://app.leaddrivecrm.org/api/v1/voip/business-hours", {
    method,
    headers: {
      authorization: "Bearer ld_test",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(storedRow);
  mocks.upsert.mockResolvedValue(storedRow);
});

describe("VoIP-scoped voice calling hours", () => {
  it("registers both handlers behind the VoIP admin gate", () => {
    expect(mocks.wrappers).toEqual([
      { module: "voip", action: "admin" },
      { module: "voip", action: "admin" },
    ]);
  });

  it("loads the exact voice schedule without an Inbox dependency", async () => {
    const res = await GET(new NextRequest("https://app.leaddrivecrm.org/api/v1/voip/business-hours"));

    expect(res.status).toBe(200);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: {
        organizationId_channelType: {
          organizationId: "org_voip_only",
          channelType: "voice",
        },
      },
    });
  });

  it("saves only a voice schedule and strips message fields", async () => {
    const res = await PUT(jsonRequest({
      channelType: "voice",
      timezone: "Asia/Baku",
      schedule: {
        mon: { enabled: true, intervals: [{ start: "10:00", end: "17:00" }] },
      },
      holidays: [],
      isActive: true,
      welcomeMessage: "must not be stored",
      awayMessage: "must not be stored",
    }));

    expect(res.status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        organizationId_channelType: {
          organizationId: "org_voip_only",
          channelType: "voice",
        },
      },
      create: expect.objectContaining({
        organizationId: "org_voip_only",
        channelType: "voice",
        welcomeMessage: null,
        awayMessage: null,
      }),
    }));
  });

  it("rejects attempts to write a non-voice schedule", async () => {
    const res = await PUT(jsonRequest({
      channelType: "telegram",
      timezone: "Asia/Baku",
      schedule: {},
      holidays: [],
      isActive: true,
    }));

    expect(res.status).toBe(400);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("rejects bearer/API-key access before reading or mutating", async () => {
    const getRes = await GET(bearerRequest("GET"));
    const putRes = await PUT(bearerRequest("PUT", {
      channelType: "voice",
      timezone: "Asia/Baku",
      schedule: {},
      holidays: [],
      isActive: true,
    }));

    expect(getRes.status).toBe(403);
    expect(putRes.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
