import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => {
  const prisma = {
    lead: { findFirst: vi.fn() },
    voiceSuppression: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    voiceConsent: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
    },
    $queryRaw: vi.fn(),
    $executeRaw: vi.fn(),
    $transaction:
      vi.fn<(operation: unknown, options?: unknown) => Promise<unknown>>(),
  };
  return {
    prisma,
    auth: {
      orgId: "org-1",
      userId: "seller-1",
      role: "sales",
      email: "seller@example.test",
      name: "Seller",
    },
    checkPermission: vi.fn(() => true),
    applyRecordFilter:
      vi.fn<
        (
          orgId: string,
          userId: string,
          role: string,
          entityType: string,
          where: Record<string, unknown>,
        ) => Promise<Record<string, unknown>>
      >(),
  };
});

vi.mock("@/lib/prisma", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/permissions", () => ({
  checkPermission: mocks.checkPermission,
}));
vi.mock("@/lib/sharing-rules", () => ({
  applyRecordFilter: mocks.applyRecordFilter,
}));
vi.mock("@/lib/constants", () => ({
  isManagerOrAbove: (role: string) =>
    ["manager", "admin", "superadmin"].includes(role),
}));
vi.mock("@/lib/with-rls", () => ({
  withRlsAuth:
    (
      _module: string,
      _action: string,
      handler: (
        request: NextRequest,
        auth: typeof mocks.auth,
        context: unknown,
      ) => Promise<Response>,
    ) =>
    (request: NextRequest, context: unknown) =>
      handler(request, mocks.auth, context),
}));

import { GET, POST } from "@/app/api/v1/leads/[id]/voice-permission/route";
import { hmacToken } from "@/lib/secure-token";

const REQUEST_KEY = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-08-10T10:00:00.000Z");
const LEAD_VERSION = "2026-08-10T09:00:00.000Z";
const PHONE_FINGERPRINT = hmacToken(
  "org-1\0+994501234567",
  "lead-voice-permission-phone-v1",
);

function request(
  method: "GET" | "POST",
  body?: unknown,
  headers?: Record<string, string>,
) {
  return new NextRequest(
    "http://localhost/api/v1/leads/lead-1/voice-permission",
    {
      method,
      headers: {
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

function context() {
  return { params: Promise.resolve({ id: "lead-1" }) };
}

function mutation(
  action: "block" | "allow",
  overrides: Record<string, unknown> = {},
) {
  return {
    action,
    idempotencyKey: REQUEST_KEY,
    leadVersion: LEAD_VERSION,
    ...(action === "allow" ? { confirmation: true } : {}),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.auth, {
    orgId: "org-1",
    userId: "seller-1",
    role: "sales",
  });
  mocks.checkPermission.mockReturnValue(true);
  mocks.applyRecordFilter.mockImplementation(
    async (
      _orgId: string,
      _userId: string,
      _role: string,
      _entityType: string,
      where: Record<string, unknown>,
    ) => ({ ...where, OR: [{ assignedTo: "seller-1" }] }),
  );
  mocks.prisma.lead.findFirst.mockResolvedValue({
    id: "lead-1",
    phone: "050 123 45 67",
    updatedAt: new Date(LEAD_VERSION),
  });
  mocks.prisma.voiceSuppression.findMany.mockResolvedValue([]);
  mocks.prisma.voiceSuppression.findUnique.mockResolvedValue(null);
  mocks.prisma.voiceSuppression.upsert.mockResolvedValue({
    id: "suppression-1",
    isActive: true,
    source: "lead_card",
    reason: "customer_sales_call_blocked",
    createdBy: "seller-1",
  });
  mocks.prisma.voiceSuppression.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.voiceConsent.findMany.mockResolvedValue([]);
  mocks.prisma.voiceConsent.findUnique.mockResolvedValue(null);
  mocks.prisma.voiceConsent.upsert.mockResolvedValue({
    id: "consent-1",
    status: "allowed",
    source: "lead_card_manager_confirmation",
    reason: "manager_confirmed_sales_voice_contact",
    confirmedBy: "manager-1",
    confirmedAt: NOW,
  });
  mocks.prisma.voiceConsent.updateMany.mockResolvedValue({ count: 0 });
  mocks.prisma.auditLog.findFirst.mockResolvedValue(null);
  mocks.prisma.auditLog.findMany.mockResolvedValue([]);
  mocks.prisma.auditLog.create.mockResolvedValue({ id: "audit-1" });
  mocks.prisma.$queryRaw.mockResolvedValue([{ id: "lead-1" }]);
  mocks.prisma.$executeRaw.mockResolvedValue(0);
  mocks.prisma.$transaction.mockImplementation(async (operation: unknown) => {
    if (typeof operation !== "function")
      throw new Error("interactive transaction required");
    return operation(mocks.prisma);
  });
});

describe("GET /api/v1/leads/:id/voice-permission", () => {
  it("is cookie-only and rejects bearer principals before reading a lead", async () => {
    const response = await GET(
      request("GET", undefined, {
        authorization: "Bearer ld_example",
      }),
      context(),
    );

    expect(response.status).toBe(403);
    expect(mocks.prisma.lead.findFirst).not.toHaveBeenCalled();
  });

  it("applies tenant record visibility plus exact seller assignment", async () => {
    mocks.prisma.lead.findFirst.mockResolvedValueOnce(null);

    const response = await GET(request("GET"), context());

    expect(response.status).toBe(404);
    expect(mocks.applyRecordFilter).toHaveBeenCalledWith(
      "org-1",
      "seller-1",
      "sales",
      "lead",
      { id: "lead-1", organizationId: "org-1" },
    );
    expect(mocks.prisma.lead.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "lead-1",
        organizationId: "org-1",
        assignedTo: "seller-1",
      }),
      select: { phone: true, updatedAt: true },
    });
  });

  it("returns only permission state and never returns the canonical phone or audit actor", async () => {
    mocks.prisma.voiceConsent.findMany.mockResolvedValueOnce([
      {
        scope: "sales",
        status: "allowed",
        expiresAt: null,
        confirmedAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const response = await GET(request("GET"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body).toEqual({
      success: true,
      data: {
        state: "allowed",
        suppressionActive: false,
        globalBlockActive: false,
        salesBlockActive: false,
        durableConsent: "allowed",
        changedAt: NOW.toISOString(),
        leadVersion: LEAD_VERSION,
        phoneReady: true,
        canBlock: true,
        canManage: false,
      },
    });
    expect(JSON.stringify(body)).not.toContain("994");
    expect(JSON.stringify(body)).not.toContain("seller-1");
    expect(JSON.stringify(body)).not.toContain("phoneE164");
  });

  it("treats a stored blocked sales consent as a phone-level call block", async () => {
    mocks.prisma.voiceConsent.findMany.mockResolvedValueOnce([
      {
        scope: "sales",
        status: "blocked",
        expiresAt: null,
        confirmedAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const response = await GET(request("GET"), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      state: "blocked",
      suppressionActive: false,
      globalBlockActive: false,
      salesBlockActive: true,
      durableConsent: "blocked",
    });
  });

  it("returns only phone-bound sales permission events to a manager", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" });
    mocks.applyRecordFilter.mockImplementation(
      async (
        _orgId: string,
        _userId: string,
        _role: string,
        _entityType: string,
        where: Record<string, unknown>,
      ) => where,
    );
    mocks.prisma.auditLog.findMany.mockResolvedValueOnce([
      {
        action: "voice_contact_block",
        createdAt: NOW,
        newValue: {
          phoneFingerprint: PHONE_FINGERPRINT,
          scope: "sales",
        },
      },
    ]);

    const response = await GET(request("GET"), context());
    const body = await response.json();

    expect(body.data.recentEvents).toEqual([
      {
        action: "block",
        occurredAt: NOW.toISOString(),
      },
    ]);
    expect(mocks.prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          entityName: "lead-1",
          AND: expect.arrayContaining([
            {
              newValue: {
                path: ["phoneFingerprint"],
                equals: PHONE_FINGERPRINT,
              },
            },
            { newValue: { path: ["scope"], equals: "sales" } },
          ]),
        }),
      }),
    );
    expect(JSON.stringify(body)).not.toContain(PHONE_FINGERPRINT);
  });
});

describe("POST /api/v1/leads/:id/voice-permission", () => {
  it("rejects non-JSON and cross-site interactive mutations before auth or DB work", async () => {
    const nonJson = new NextRequest(
      "http://localhost/api/v1/leads/lead-1/voice-permission",
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      },
    );
    const nonJsonResponse = await POST(nonJson, context());
    const crossSiteResponse = await POST(
      request("POST", mutation("block"), {
        "sec-fetch-site": "cross-site",
      }),
      context(),
    );

    expect(nonJsonResponse.status).toBe(415);
    expect(crossSiteResponse.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects arbitrary browser numbers and does not start a transaction", async () => {
    const response = await POST(
      request(
        "POST",
        mutation("block", {
          toNumber: "+10000000000",
        }),
      ),
      context(),
    );

    expect(response.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("lets the assigned seller create a durable sales block from canonical Lead.phone", async () => {
    mocks.prisma.voiceSuppression.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          scope: "sales",
          isActive: true,
          expiresAt: null,
          updatedAt: NOW,
        },
      ]);

    const response = await POST(request("POST", mutation("block")), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.prisma.voiceSuppression.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_phoneE164_scope: {
            organizationId: "org-1",
            phoneE164: "+994501234567",
            scope: "sales",
          },
        },
        create: expect.objectContaining({
          isActive: true,
          source: "lead_card",
          createdBy: "seller-1",
        }),
      }),
    );
    expect(mocks.prisma.voiceConsent.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        userId: "seller-1",
        action: "voice_contact_block",
        entityType: "lead_voice_permission",
        entityId: REQUEST_KEY,
        entityName: "lead-1",
        newValue: expect.objectContaining({
          operation: "block",
          leadId: "lead-1",
          leadVersion: LEAD_VERSION,
          phoneFingerprint: PHONE_FINGERPRINT,
          scope: "sales",
          source: "lead_card",
          affectedRows: expect.objectContaining({
            suppression: expect.objectContaining({
              rowId: "suppression-1",
              before: expect.objectContaining({ state: "missing" }),
              after: expect.objectContaining({ state: "active" }),
            }),
            consent: null,
          }),
        }),
      }),
    });
    expect(body.data.state).toBe("blocked");
    expect(JSON.stringify(body)).not.toContain("994");
    expect(JSON.stringify(body)).not.toContain(PHONE_FINGERPRINT);

    const accessibleLeadRead =
      mocks.prisma.lead.findFirst.mock.invocationCallOrder[0];
    const leadRowLock = mocks.prisma.$queryRaw.mock.invocationCallOrder[0];
    const canonicalLeadRead =
      mocks.prisma.lead.findFirst.mock.invocationCallOrder[1];
    const permissionLock = mocks.prisma.$executeRaw.mock.invocationCallOrder[0];
    expect(accessibleLeadRead).toBeLessThan(leadRowLock);
    expect(leadRowLock).toBeLessThan(canonicalLeadRead);
    expect(canonicalLeadRead).toBeLessThan(permissionLock);
    const rowLockQuery = mocks.prisma.$queryRaw.mock.calls[0][0] as {
      strings: readonly string[];
      values: unknown[];
    };
    expect(rowLockQuery.strings.join(" ")).toContain('FROM "leads"');
    expect(rowLockQuery.strings.join(" ")).toContain("FOR UPDATE");
    expect(rowLockQuery.values).toEqual(["lead-1", "org-1"]);
    expect(mocks.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: "ReadCommitted" }),
    );
  });

  it("does not let a seller remove suppression or record durable consent", async () => {
    const response = await POST(request("POST", mutation("allow")), context());

    expect(response.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
    expect(mocks.prisma.voiceSuppression.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.voiceConsent.upsert).not.toHaveBeenCalled();
  });

  it("changes only sales-scope rows when a manager confirms permission", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" });
    mocks.applyRecordFilter.mockImplementation(
      async (
        _orgId: string,
        _userId: string,
        _role: string,
        _entityType: string,
        where: Record<string, unknown>,
      ) => where,
    );
    mocks.prisma.voiceSuppression.findUnique.mockResolvedValueOnce({
      id: "suppression-1",
      isActive: true,
      source: "lead_card",
      reason: "customer_sales_call_blocked",
      createdBy: "seller-1",
    });
    mocks.prisma.voiceConsent.findUnique.mockResolvedValueOnce({
      id: "consent-1",
      status: "blocked",
      source: "customer_request",
      reason: "customer_declined",
      confirmedBy: "customer-actor",
      confirmedAt: NOW,
    });
    mocks.prisma.voiceSuppression.findMany
      .mockResolvedValueOnce([
        {
          scope: "sales",
          isActive: true,
          expiresAt: null,
          updatedAt: NOW,
        },
      ])
      .mockResolvedValueOnce([]);
    mocks.prisma.voiceConsent.findMany
      .mockResolvedValueOnce([
        {
          scope: "sales",
          status: "blocked",
          expiresAt: null,
          confirmedAt: NOW,
          updatedAt: NOW,
        },
      ])
      .mockResolvedValueOnce([
        {
          scope: "sales",
          status: "allowed",
          expiresAt: null,
          confirmedAt: NOW,
          updatedAt: NOW,
        },
      ]);

    const response = await POST(request("POST", mutation("allow")), context());

    expect(response.status).toBe(200);
    const leadWhere = mocks.prisma.lead.findFirst.mock.calls[0][0].where;
    expect(leadWhere).not.toHaveProperty("assignedTo");
    expect(mocks.prisma.voiceSuppression.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: "org-1",
          phoneE164: "+994501234567",
          scope: "sales",
          isActive: true,
        }),
        data: expect.objectContaining({ isActive: false }),
      }),
    );
    expect(mocks.prisma.voiceConsent.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.voiceConsent.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_phoneE164_scope: {
            organizationId: "org-1",
            phoneE164: "+994501234567",
            scope: "sales",
          },
        },
        create: expect.objectContaining({
          scope: "sales",
          status: "allowed",
          confirmedBy: "manager-1",
          source: "lead_card_manager_confirmation",
        }),
      }),
    );
    const auditWrite = mocks.prisma.auditLog.create.mock.calls[0][0];
    expect(auditWrite.data.newValue).toMatchObject({
      scope: "sales",
      affectedRows: {
        suppression: {
          rowId: "suppression-1",
          before: { state: "active" },
          after: { state: "inactive" },
        },
        consent: {
          rowId: "consent-1",
          before: {
            state: "blocked",
            source: "customer_request",
            reason: "customer_declined",
          },
          after: {
            state: "allowed",
            source: "lead_card_manager_confirmation",
            reason: "manager_confirmed_sales_voice_contact",
          },
        },
      },
    });
    expect(JSON.stringify(auditWrite.data.newValue)).not.toContain("+994");
    expect(
      JSON.stringify(mocks.prisma.voiceSuppression.updateMany.mock.calls[0][0]),
    ).not.toContain('"all"');
    expect(
      JSON.stringify(mocks.prisma.voiceConsent.upsert.mock.calls[0][0]),
    ).not.toContain('"all"');
  });

  it("never removes a broader all-scope restriction", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" });
    mocks.prisma.voiceSuppression.findMany.mockResolvedValueOnce([
      {
        scope: "all",
        isActive: true,
        expiresAt: null,
        updatedAt: NOW,
      },
    ]);

    const response = await POST(request("POST", mutation("allow")), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "broader_restriction_active",
    });
    expect(mocks.prisma.voiceSuppression.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.voiceConsent.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("row-locks the lead and fails closed when its version changed before linearization", async () => {
    mocks.prisma.lead.findFirst
      .mockResolvedValueOnce({
        id: "lead-1",
        phone: "050 123 45 67",
        updatedAt: new Date(LEAD_VERSION),
      })
      .mockResolvedValueOnce({
        id: "lead-1",
        phone: "050 123 45 67",
        updatedAt: new Date("2026-08-10T09:05:00.000Z"),
      });

    const response = await POST(request("POST", mutation("block")), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "lead_version_conflict",
    });
    expect(mocks.prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.findFirst).not.toHaveBeenCalled();
    expect(mocks.prisma.voiceSuppression.upsert).not.toHaveBeenCalled();
  });

  it("replays the same request key without a second permission write or audit row", async () => {
    mocks.prisma.auditLog.findFirst.mockResolvedValueOnce({
      action: "voice_contact_block",
      entityName: "lead-1",
      userId: "seller-1",
      newValue: {
        operation: "block",
        leadId: "lead-1",
        leadVersion: LEAD_VERSION,
        phoneFingerprint: PHONE_FINGERPRINT,
        scope: "sales",
        source: "lead_card",
      },
    });
    mocks.prisma.voiceSuppression.findMany.mockResolvedValueOnce([
      {
        scope: "sales",
        isActive: true,
        expiresAt: null,
        updatedAt: NOW,
      },
    ]);

    const response = await POST(request("POST", mutation("block")), context());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.replayed).toBe(true);
    expect(mocks.prisma.voiceSuppression.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.voiceConsent.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("fails closed when a request key is reused for a different operation", async () => {
    Object.assign(mocks.auth, { role: "manager", userId: "manager-1" });
    mocks.prisma.auditLog.findFirst.mockResolvedValueOnce({
      action: "voice_contact_block",
      entityName: "lead-1",
      userId: "manager-1",
      newValue: {
        operation: "block",
        leadId: "lead-1",
        leadVersion: LEAD_VERSION,
        phoneFingerprint: PHONE_FINGERPRINT,
        scope: "sales",
        source: "lead_card",
      },
    });

    const response = await POST(request("POST", mutation("allow")), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "idempotency_conflict",
    });
    expect(mocks.prisma.voiceSuppression.updateMany).not.toHaveBeenCalled();
    expect(mocks.prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it("fails closed when replay metadata is bound to another lead version", async () => {
    mocks.prisma.auditLog.findFirst.mockResolvedValueOnce({
      action: "voice_contact_block",
      entityName: "lead-1",
      userId: "seller-1",
      newValue: {
        operation: "block",
        leadId: "lead-1",
        leadVersion: "2026-08-10T08:00:00.000Z",
        phoneFingerprint: PHONE_FINGERPRINT,
        scope: "sales",
        source: "lead_card",
      },
    });

    const response = await POST(request("POST", mutation("block")), context());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "idempotency_conflict",
    });
    expect(mocks.prisma.voiceSuppression.upsert).not.toHaveBeenCalled();
  });
});
