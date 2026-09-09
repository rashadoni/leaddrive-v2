import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

interface BusinessHoursRow {
  id: string;
  organizationId: string;
  channelType: string;
  timezone: string;
  schedule: unknown;
  holidays: unknown;
  isActive: boolean;
  welcomeMessage: string | null;
  awayMessage: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface BusinessHoursUpsertArgs {
  where: Record<string, unknown>;
  update: Record<string, unknown>;
  create: Record<string, unknown> & {
    organizationId: string;
    channelType: string;
    createdBy: string | null;
  };
}

const db = vi.hoisted(() => ({
  rows: [] as BusinessHoursRow[],
  upsertArgs: null as BusinessHoursUpsertArgs | null,
  role: "superadmin" as "superadmin" | "admin" | "manager",
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    businessHours: {
      findMany: vi.fn(async () => db.rows),
      upsert: vi.fn(async (args: BusinessHoursUpsertArgs) => {
        db.upsertArgs = args;
        return {
          ...args.create,
          id: "bh_1",
          organizationId: args.create.organizationId,
          channelType: args.create.channelType,
          createdBy: args.create.createdBy,
          createdAt: new Date("2026-06-24T00:00:00Z"),
          updatedAt: new Date("2026-06-24T00:00:00Z"),
        };
      }),
    },
  },
}));

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth:
    (
      _module: string,
      _action: string,
      handler: (req: NextRequest, auth: { orgId: string; userId: string; role: string }, ctx?: unknown) => unknown,
    ) => (req: NextRequest, ctx?: unknown) =>
      handler(req, { orgId: "org_1", userId: "u_1", role: db.role }, ctx),
}));

vi.mock("@/lib/api-auth", () => ({
  orgHasModule: vi.fn(async () => true),
  moduleDisabledResponse: vi.fn(() => new Response("", { status: 403 })),
}));

import { GET, PUT } from "@/app/api/v1/business-hours/route";
import { prisma } from "@/lib/prisma";

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) =>
  new NextRequest(url, init);
const jsonReq = (body: unknown) =>
  req("http://localhost/api/v1/business-hours", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  db.rows = [];
  db.upsertArgs = null;
  db.role = "superadmin";
  vi.clearAllMocks();
});

describe("GET /api/v1/business-hours", () => {
  it("lists business-hours configs tenant-scoped", async () => {
    db.rows = [{
      id: "bh_1",
      organizationId: "org_1",
      channelType: "telegram",
      timezone: "Asia/Baku",
      schedule: {},
      holidays: [],
      isActive: true,
      welcomeMessage: "Welcome",
      awayMessage: "Away",
      createdBy: "u_1",
      createdAt: new Date("2026-06-24T00:00:00Z"),
      updatedAt: new Date("2026-06-24T00:00:00Z"),
    }];

    const res = await GET(req("http://localhost/api/v1/business-hours"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.businessHours.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: [{ channelType: "asc" }],
    });
    expect(body.data[0].templateGraph.metadata.builder).toBe("business-hours-template-v1");
  });

  it("rejects unsupported channel filters", async () => {
    const res = await GET(req("http://localhost/api/v1/business-hours?channelType=slack"));
    expect(res.status).toBe(400);
    expect(prisma.businessHours.findMany).not.toHaveBeenCalled();
  });
});

describe("PUT /api/v1/business-hours", () => {
  it("accepts a dedicated voice calling-hours schedule", async () => {
    const res = await PUT(jsonReq({
      channelType: "voice",
      timezone: "Asia/Baku",
      schedule: {
        mon: { enabled: true, intervals: [{ start: "10:00", end: "17:00" }] },
      },
      isActive: true,
    }));

    expect(res.status).toBe(200);
    expect(prisma.businessHours.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_channelType: { organizationId: "org_1", channelType: "voice" } },
    }));
    expect(db.upsertArgs?.create).toMatchObject({
      organizationId: "org_1",
      channelType: "voice",
      welcomeMessage: null,
      awayMessage: null,
    });
  });

  it("rejects voice calling-hours changes from a non-admin", async () => {
    db.role = "manager";

    const res = await PUT(jsonReq({
      channelType: "voice",
      timezone: "Asia/Baku",
      schedule: {
        mon: { enabled: true, intervals: [{ start: "10:00", end: "17:00" }] },
      },
      isActive: true,
    }));

    expect(res.status).toBe(403);
    expect(prisma.businessHours.upsert).not.toHaveBeenCalled();
  });

  it("rejects bearer/API-key changes to voice calling hours", async () => {
    const res = await PUT(req("http://localhost/api/v1/business-hours", {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer ld_test",
      },
      body: JSON.stringify({
        channelType: "voice",
        timezone: "Asia/Baku",
        schedule: {},
        isActive: true,
      }),
    }));

    expect(res.status).toBe(403);
    expect(prisma.businessHours.upsert).not.toHaveBeenCalled();
  });

  it("keeps ordinary channel schedules writable for existing inbox roles", async () => {
    db.role = "manager";

    const res = await PUT(jsonReq({
      channelType: "telegram",
      timezone: "Asia/Baku",
      schedule: {
        mon: { enabled: true, intervals: [{ start: "10:00", end: "17:00" }] },
      },
      isActive: true,
    }));

    expect(res.status).toBe(200);
    expect(prisma.businessHours.upsert).toHaveBeenCalledTimes(1);
  });

  it("upserts one row per org and channel", async () => {
    const res = await PUT(jsonReq({
      channelType: "whatsapp",
      timezone: "Asia/Baku",
      schedule: {
        mon: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
        tue: { enabled: true, intervals: [{ start: "09:00", end: "18:00" }] },
      },
      holidays: [{ date: "2026-12-31", name: "New Year Eve" }],
      welcomeMessage: "  We are online.  ",
      awayMessage: "  We are closed.  ",
    }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(prisma.businessHours.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_channelType: { organizationId: "org_1", channelType: "whatsapp" } },
    }));
    const upsertArgs = db.upsertArgs;
    if (!upsertArgs) throw new Error("businessHours.upsert was not called");
    expect(upsertArgs.create).toMatchObject({
      organizationId: "org_1",
      channelType: "whatsapp",
      createdBy: "u_1",
      timezone: "Asia/Baku",
      welcomeMessage: "We are online.",
      awayMessage: "We are closed.",
      isActive: true,
    });
    expect(body.data.templateGraph.metadata.actions).toEqual([
      "business_hours_gate",
      "send_reply:welcome",
      "send_reply:away",
    ]);
  });

  it("rejects unknown fields and invalid intervals", async () => {
    const res = await PUT(jsonReq({
      channelType: "telegram",
      timezone: "UTC",
      schedule: {
        mon: { enabled: true, intervals: [{ start: "18:00", end: "09:00" }] },
      },
      surprise: true,
    }));

    expect(res.status).toBe(400);
    expect(prisma.businessHours.upsert).not.toHaveBeenCalled();
  });

  it("rejects invalid timezones before writing", async () => {
    const res = await PUT(jsonReq({
      channelType: "telegram",
      timezone: "Mars/Olympus",
    }));

    expect(res.status).toBe(400);
    expect(prisma.businessHours.upsert).not.toHaveBeenCalled();
  });
});
