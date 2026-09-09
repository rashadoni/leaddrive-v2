import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRlsAuth } from "@/lib/with-rls";
import { orgHasModule, moduleDisabledResponse } from "@/lib/api-auth";
import { isAdmin } from "@/lib/permissions";
import {
  normalizeBusinessHoursChannelType,
} from "@/lib/inbox/business-hours";
import {
  businessHoursUpsertSchema,
  serializeBusinessHours,
  upsertBusinessHours,
} from "@/lib/inbox/business-hours-api";

function businessHoursErrorResponse(error: unknown) {
  console.error("[business-hours] route error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

export const GET = withRlsAuth("inbox", "read", async (req, auth) => {
  const { searchParams } = new URL(req.url);
  const rawChannelType = searchParams.get("channelType");
  const channelType = rawChannelType
    ? normalizeBusinessHoursChannelType(rawChannelType)
    : null;
  if (rawChannelType && channelType !== rawChannelType.trim().toLowerCase()) {
    return NextResponse.json({ error: "Unsupported channelType" }, { status: 400 });
  }

  try {
    const rows = await prisma.businessHours.findMany({
      where: {
        organizationId: auth.orgId,
        ...(channelType ? { channelType } : {}),
      },
      orderBy: [{ channelType: "asc" }],
    });
    return NextResponse.json({
      success: true,
      data: rows.map(serializeBusinessHours),
    });
  } catch (error) {
    return businessHoursErrorResponse(error);
  }
});

export const PUT = withRlsAuth("inbox", "write", async (req, auth) => {
  const body = await req.json().catch(() => ({}));
  const parsed = businessHoursUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const channelType = parsed.data.channelType;
  if (channelType === "voice") {
    if (req.headers.has("authorization")) {
      return NextResponse.json({ error: "Session authentication required" }, { status: 403 });
    }
    if (!isAdmin(auth.role)) {
      return NextResponse.json({ error: "Admin role required for voice calling hours" }, { status: 403 });
    }
    if (auth.role !== "superadmin" && !(await orgHasModule(auth.orgId, "voip"))) {
      return moduleDisabledResponse("voip");
    }
  }

  try {
    const row = await upsertBusinessHours({
      organizationId: auth.orgId,
      userId: auth.userId ?? null,
      input: parsed.data,
    });
    return NextResponse.json({ success: true, data: serializeBusinessHours(row) });
  } catch (error) {
    return businessHoursErrorResponse(error);
  }
});
