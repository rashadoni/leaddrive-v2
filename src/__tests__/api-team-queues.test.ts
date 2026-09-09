import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const db: {
  queues: any[];
  flows: any[];
  created: any;
  updatedData: any;
  updateCount: number;
  deleteCount: number;
} = {
  queues: [],
  flows: [],
  created: null,
  updatedData: null,
  updateCount: 1,
  deleteCount: 1,
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    teamQueue: {
      findMany: vi.fn(async () => db.queues),
      findFirst: vi.fn(async () => db.queues[0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        db.created = data;
        return { id: "q_1", ...data };
      }),
      updateMany: vi.fn(async ({ data }: any) => {
        db.updatedData = data;
        return { count: db.updateCount };
      }),
      deleteMany: vi.fn(async () => ({ count: db.deleteCount })),
    },
    conversationFlow: {
      findMany: vi.fn(async () => db.flows),
    },
  },
}));

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth:
    (_module: any, _action: any, handler: any) => (req: any, ctx: any) =>
      handler(req, { orgId: "org_1", userId: "u_1" }, ctx),
}));

import { GET, POST } from "@/app/api/v1/team-queues/route";
import { PATCH, DELETE } from "@/app/api/v1/team-queues/[id]/route";
import { prisma } from "@/lib/prisma";

const req = (url: string, init?: any) => new NextRequest(url, init) as any;
const json = (method: string, body: unknown) =>
  req("http://localhost/api/v1/team-queues", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id = "q_1") => ({ params: Promise.resolve({ id }) }) as any;

beforeEach(() => {
  db.queues = [];
  db.flows = [];
  db.created = null;
  db.updatedData = null;
  db.updateCount = 1;
  db.deleteCount = 1;
  vi.clearAllMocks();
});

describe("GET /team-queues", () => {
  it("lists queues tenant-scoped and active-first", async () => {
    db.queues = [{ id: "q_1", name: "Sales" }];
    const res = await GET(req("http://localhost/api/v1/team-queues"));
    expect(res.status).toBe(200);
    expect(prisma.teamQueue.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
    });
  });
});

describe("POST /team-queues", () => {
  it("creates a queue with normalized skills and defaults", async () => {
    const res = await POST(
      json("POST", { name: " Sales ", skillTags: ["Sales", " sales ", ""] }),
    );
    expect(res.status).toBe(201);
    expect(db.created).toMatchObject({
      organizationId: "org_1",
      name: "Sales",
      skillTags: ["sales"],
      strategy: "least_loaded",
      isActive: true,
      createdBy: "u_1",
    });
  });

  it("rejects unknown fields", async () => {
    const res = await POST(json("POST", { name: "Sales", priority: 10 }));
    expect(res.status).toBe(400);
  });
});

describe("PATCH /team-queues/[id]", () => {
  it("updates by id + org with normalized skills", async () => {
    db.queues = [{ id: "q_1", name: "Sales" }];
    const res = await PATCH(
      json("PATCH", { strategy: "round_robin", skillTags: ["VIP", "vip"] }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(prisma.teamQueue.updateMany).toHaveBeenCalledWith({
      where: { id: "q_1", organizationId: "org_1" },
      data: { strategy: "round_robin", skillTags: ["vip"] },
    });
  });

  it("404s when queue is outside this org", async () => {
    db.updateCount = 0;
    const res = await PATCH(
      json("PATCH", { name: "Renamed" }),
      params("missing"),
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /team-queues/[id]", () => {
  it("deletes by id + org when no flow references it", async () => {
    const res = await DELETE(
      req("http://localhost/api/v1/team-queues/q_1", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(200);
    expect(prisma.conversationFlow.findMany).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      select: { id: true, name: true, graph: true },
    });
    expect(prisma.teamQueue.deleteMany).toHaveBeenCalledWith({
      where: { id: "q_1", organizationId: "org_1" },
    });
  });

  it("409s when a conversation flow still references the queue", async () => {
    db.flows = [
      {
        id: "flow_1",
        name: "TikTok routing",
        graph: {
          nodes: [
            {
              id: "a1",
              data: {
                action: { type: "assign_to_queue", config: { queueId: "q_1" } },
              },
            },
          ],
        },
      },
    ];
    const res = await DELETE(
      req("http://localhost/api/v1/team-queues/q_1", { method: "DELETE" }),
      params(),
    );
    expect(res.status).toBe(409);
    expect(prisma.teamQueue.deleteMany).not.toHaveBeenCalled();
  });

  it("404s when no queue was deleted", async () => {
    db.deleteCount = 0;
    const res = await DELETE(
      req("http://localhost/api/v1/team-queues/missing", { method: "DELETE" }),
      params("missing"),
    );
    expect(res.status).toBe(404);
  });
});
