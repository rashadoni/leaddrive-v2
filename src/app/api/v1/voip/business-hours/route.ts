import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withRlsAuth } from "@/lib/with-rls";
import {
  businessHoursUpsertSchema,
  serializeBusinessHours,
  upsertBusinessHours,
} from "@/lib/inbox/business-hours-api";

function routeError(error: unknown) {
  console.error("[voip-business-hours] route error:", error);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}

function rejectApiCredential(req: Request): NextResponse | null {
  return req.headers.has("authorization")
    ? NextResponse.json({ error: "Session authentication required" }, { status: 403 })
    : null;
}

/**
 * Voice calling hours belong to the independently purchasable VoIP module.
 * Keeping this endpoint VoIP-scoped lets a VoIP-only tenant admin configure the
 * mandatory safety window without purchasing or enabling Omni-channel/Inbox.
 */
export const GET = withRlsAuth("voip", "admin", async (req, auth) => {
  const apiCredentialError = rejectApiCredential(req);
  if (apiCredentialError) return apiCredentialError;
  try {
    const row = await prisma.businessHours.findUnique({
      where: {
        organizationId_channelType: {
          organizationId: auth.orgId,
          channelType: "voice",
        },
      },
    });
    return NextResponse.json({
      success: true,
      data: row ? serializeBusinessHours(row) : null,
    });
  } catch (error) {
    return routeError(error);
  }
});

export const PUT = withRlsAuth("voip", "admin", async (req, auth) => {
  const apiCredentialError = rejectApiCredential(req);
  if (apiCredentialError) return apiCredentialError;
  const body = await req.json().catch(() => ({}));
  const parsed = businessHoursUpsertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }
  if (parsed.data.channelType !== "voice") {
    return NextResponse.json({ error: "Only voice calling hours are accepted" }, { status: 400 });
  }

  try {
    const row = await upsertBusinessHours({
      organizationId: auth.orgId,
      userId: auth.userId ?? null,
      input: {
        ...parsed.data,
        channelType: "voice",
        welcomeMessage: null,
        awayMessage: null,
      },
    });
    return NextResponse.json({ success: true, data: serializeBusinessHours(row) });
  } catch (error) {
    return routeError(error);
  }
});
