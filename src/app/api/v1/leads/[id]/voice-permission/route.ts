import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import type { AuthResult } from "@/lib/api-auth";
import { isManagerOrAbove } from "@/lib/constants";
import { checkPermission } from "@/lib/permissions";
import { prisma } from "@/lib/prisma";
import { hmacToken } from "@/lib/secure-token";
import { applyRecordFilter } from "@/lib/sharing-rules";
import { guardInteractiveJsonMutation } from "@/lib/social/review-apply-request";
import { normalizeManualLeadPhone } from "@/lib/voice-agent/manual-lead-call";
import { lockVoiceContactPermission } from "@/lib/voice-agent/voice-permission-lock";
import { withRlsAuth } from "@/lib/with-rls";

export const dynamic = "force-dynamic";

const mutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("block"),
      idempotencyKey: z.string().uuid(),
      leadVersion: z.string().datetime({ offset: true }),
    })
    .strict(),
  z
    .object({
      action: z.literal("allow"),
      idempotencyKey: z.string().uuid(),
      leadVersion: z.string().datetime({ offset: true }),
      confirmation: z.literal(true),
    })
    .strict(),
]);

type RouteContext = { params: Promise<{ id: string }> };
type PermissionState = "allowed" | "blocked" | "unknown";
type PublicPermissionEvent = {
  action: "block" | "allow";
  occurredAt: string;
};
type StoredPermissionState = {
  state: PermissionState;
  suppressionActive: boolean;
  globalBlockActive: boolean;
  salesBlockActive: boolean;
  durableConsent: PermissionState;
  changedAt: string | null;
};
type PermissionMutationResult =
  | { phoneUnavailable: true }
  | {
      phoneUnavailable: false;
      state: StoredPermissionState;
      leadVersion: string;
      phoneFingerprint: string;
      replayed: boolean;
    };

type PermissionDb = Pick<
  Prisma.TransactionClient,
  "lead" | "voiceConsent" | "voiceSuppression" | "auditLog"
>;

class InaccessibleLeadError extends Error {}
class IdempotencyConflictError extends Error {}
class LeadVersionConflictError extends Error {}
class BroaderRestrictionActiveError extends Error {}

function privateJson(body: unknown, init?: ResponseInit): NextResponse {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

function notFound(): NextResponse {
  return privateJson({ error: "Not found" }, { status: 404 });
}

function forbidden(): NextResponse {
  return privateJson({ error: "Forbidden" }, { status: 403 });
}

function rejectNonCookiePrincipal(request: NextRequest): NextResponse | null {
  // This endpoint changes a person's contact permission from a human-operated
  // CRM screen. API keys, mobile bearer tokens, and service credentials are not
  // accepted even if they carry otherwise-valid VoIP scopes.
  return request.headers.has("authorization")
    ? privateJson({ error: "Session authentication required" }, { status: 403 })
    : null;
}

function canWritePermission(auth: Pick<AuthResult, "role">): boolean {
  return (
    checkPermission(auth.role, "voip", "write") &&
    checkPermission(auth.role, "leads", "write")
  );
}

function canBlockPermission(auth: Pick<AuthResult, "role">): boolean {
  return isManagerOrAbove(auth.role) || auth.role === "sales";
}

async function accessibleLeadWhere(
  auth: Pick<AuthResult, "orgId" | "userId" | "role">,
  leadId: string,
) {
  const visibleWhere = await applyRecordFilter(
    auth.orgId,
    auth.userId,
    auth.role,
    "lead",
    { id: leadId, organizationId: auth.orgId },
  );

  // Sharing rules may make another seller's lead readable. Contact-permission
  // mutations stay owner-pinned for sellers; manager-or-above is the only
  // assignment override.
  return {
    ...visibleWhere,
    ...(!isManagerOrAbove(auth.role) ? { assignedTo: auth.userId } : {}),
  };
}

function activeAt(expiresAt: Date | null, now: Date): boolean {
  return !expiresAt || expiresAt > now;
}

async function readPermissionState(
  db: PermissionDb,
  organizationId: string,
  phoneE164: string,
  now: Date,
): Promise<StoredPermissionState> {
  const [suppressions, consents] = await Promise.all([
    db.voiceSuppression.findMany({
      where: {
        organizationId,
        phoneE164,
        scope: { in: ["sales", "all"] },
      },
      select: { scope: true, isActive: true, expiresAt: true, updatedAt: true },
    }),
    db.voiceConsent.findMany({
      where: {
        organizationId,
        phoneE164,
        scope: { in: ["sales", "all"] },
      },
      select: {
        scope: true,
        status: true,
        expiresAt: true,
        confirmedAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const activeSuppressions = suppressions.filter(
    (entry) => entry.isActive && activeAt(entry.expiresAt, now),
  );
  const suppressionActive = activeSuppressions.length > 0;
  const effectiveConsents = consents.filter((entry) =>
    activeAt(entry.expiresAt, now),
  );
  const consentBlocked = effectiveConsents.some(
    (entry) => entry.status === "blocked",
  );
  const consentAllowed = effectiveConsents.some(
    (entry) => entry.status === "allowed",
  );
  const globalBlockActive =
    activeSuppressions.some((entry) => entry.scope === "all") ||
    effectiveConsents.some(
      (entry) => entry.scope === "all" && entry.status === "blocked",
    );
  const salesBlockActive =
    activeSuppressions.some((entry) => entry.scope === "sales") ||
    effectiveConsents.some(
      (entry) => entry.scope === "sales" && entry.status === "blocked",
    );
  const durableConsent: PermissionState = consentBlocked
    ? "blocked"
    : consentAllowed
      ? "allowed"
      : "unknown";
  const state: PermissionState =
    suppressionActive || consentBlocked
      ? "blocked"
      : consentAllowed
        ? "allowed"
        : "unknown";

  const timestamps = [
    ...suppressions.map((entry) => entry.updatedAt),
    ...consents.flatMap((entry) => [entry.confirmedAt, entry.updatedAt]),
  ].filter((value): value is Date => value instanceof Date);
  const changedAt =
    timestamps.length > 0
      ? new Date(
          Math.max(...timestamps.map((value) => value.getTime())),
        ).toISOString()
      : null;

  return {
    state,
    suppressionActive,
    globalBlockActive,
    salesBlockActive,
    durableConsent,
    changedAt,
  };
}

function publicState(params: {
  state: Awaited<ReturnType<typeof readPermissionState>>;
  leadVersion: string;
  phoneReady: boolean;
  canBlock: boolean;
  canManage: boolean;
  replayed?: boolean;
  recentEvents?: PublicPermissionEvent[];
}) {
  return {
    state: params.state.state,
    suppressionActive: params.state.suppressionActive,
    globalBlockActive: params.state.globalBlockActive,
    salesBlockActive: params.state.salesBlockActive,
    durableConsent: params.state.durableConsent,
    changedAt: params.state.changedAt,
    leadVersion: params.leadVersion,
    phoneReady: params.phoneReady,
    canBlock: params.canBlock && params.phoneReady,
    canManage: params.canManage && params.phoneReady,
    ...(params.replayed === undefined ? {} : { replayed: params.replayed }),
    ...(params.recentEvents === undefined
      ? {}
      : { recentEvents: params.recentEvents }),
  };
}

async function recentPermissionEvents(
  organizationId: string,
  leadId: string,
  phoneFingerprint: string,
): Promise<PublicPermissionEvent[]> {
  const rows: Array<{
    action: string;
    createdAt: Date;
    newValue: Prisma.JsonValue | null;
  }> = await prisma.auditLog.findMany({
    where: {
      organizationId,
      entityType: "lead_voice_permission",
      entityName: leadId,
      action: { in: ["voice_contact_block", "voice_contact_allow"] },
      AND: [
        { newValue: { path: ["phoneFingerprint"], equals: phoneFingerprint } },
        { newValue: { path: ["scope"], equals: "sales" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { action: true, createdAt: true, newValue: true },
  });
  return rows.flatMap((row) => {
    const metadata = jsonRecord(row.newValue);
    if (
      metadata?.phoneFingerprint !== phoneFingerprint ||
      metadata?.scope !== "sales"
    ) {
      return [];
    }
    const action =
      row.action === "voice_contact_block"
        ? ("block" as const)
        : row.action === "voice_contact_allow"
          ? ("allow" as const)
          : null;
    return action ? [{ action, occurredAt: row.createdAt.toISOString() }] : [];
  });
}

function jsonRecord(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type SuppressionAuditRow = {
  id: string;
  isActive: boolean;
  source: string | null;
  reason: string;
  createdBy: string | null;
};

type ConsentAuditRow = {
  id: string;
  status: string;
  source: string | null;
  reason: string | null;
  confirmedBy: string | null;
  confirmedAt: Date | null;
};

function suppressionAuditState(row: SuppressionAuditRow | null) {
  return row
    ? {
        state: row.isActive ? "active" : "inactive",
        source: row.source,
        reason: row.reason,
        actorId: row.createdBy,
      }
    : { state: "missing", source: null, reason: null, actorId: null };
}

function consentAuditState(row: ConsentAuditRow | null) {
  return row
    ? {
        state: row.status,
        source: row.source,
        reason: row.reason,
        actorId: row.confirmedBy,
        confirmedAt: row.confirmedAt?.toISOString() ?? null,
      }
    : {
        state: "missing",
        source: null,
        reason: null,
        actorId: null,
        confirmedAt: null,
      };
}

function permissionPhoneFingerprint(
  organizationId: string,
  phoneE164: string,
): string {
  return hmacToken(
    `${organizationId}\0${phoneE164}`,
    "lead-voice-permission-phone-v1",
  );
}

async function lockLeadRow(
  tx: Prisma.TransactionClient,
  organizationId: string,
  leadId: string,
): Promise<void> {
  // The lead row is the serialization boundary for phone/assignment edits.
  // Lock it before reading the canonical phone, then take the phone-scoped
  // advisory lock used by dispatch. Parameterized identifiers keep the lock
  // tenant-bound without accepting any browser-supplied phone value.
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id"
    FROM "leads"
    WHERE "id" = ${leadId}
      AND "organizationId" = ${organizationId}
    FOR UPDATE
  `);
  if (rows.length !== 1 || rows[0]?.id !== leadId) {
    throw new InaccessibleLeadError();
  }
}

function isRetryableMutationConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2034" || error.code === "P2002")
  );
}

async function withMutationRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isRetryableMutationConflict(error)) throw error;
    }
  }
  throw lastError;
}

const getWithAuth = withRlsAuth(
  "voip",
  "read",
  async (_request, auth, { params }: RouteContext) => {
    if (!checkPermission(auth.role, "leads", "read")) return forbidden();
    const { id: leadId } = await params;
    const where = await accessibleLeadWhere(auth, leadId);
    const lead = await prisma.lead.findFirst({
      where,
      select: { phone: true, updatedAt: true },
    });
    if (!lead) return notFound();

    const normalizedPhone = normalizeManualLeadPhone(lead.phone);
    const writable = canWritePermission(auth);
    const canBlock = writable && canBlockPermission(auth);
    const canManage = writable && isManagerOrAbove(auth.role);
    if (!normalizedPhone) {
      return privateJson({
        success: true,
        data: publicState({
          state: {
            state: "unknown",
            suppressionActive: false,
            globalBlockActive: false,
            salesBlockActive: false,
            durableConsent: "unknown",
            changedAt: null,
          },
          leadVersion: lead.updatedAt.toISOString(),
          phoneReady: false,
          canBlock,
          canManage,
        }),
      });
    }

    const eventsPromise = canManage
      ? recentPermissionEvents(
          auth.orgId,
          leadId,
          permissionPhoneFingerprint(auth.orgId, normalizedPhone.e164),
        )
      : Promise.resolve<PublicPermissionEvent[] | undefined>(undefined);
    const [state, recentEvents] = await Promise.all([
      readPermissionState(prisma, auth.orgId, normalizedPhone.e164, new Date()),
      eventsPromise,
    ]);
    return privateJson({
      success: true,
      data: publicState({
        state,
        leadVersion: lead.updatedAt.toISOString(),
        phoneReady: true,
        canBlock,
        canManage,
        recentEvents,
      }),
    });
  },
);

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  return rejectNonCookiePrincipal(request) ?? getWithAuth(request, context);
}

const postWithAuth = withRlsAuth(
  "voip",
  "write",
  async (request, auth, { params }: RouteContext) => {
    if (!checkPermission(auth.role, "leads", "write")) return forbidden();
    const body = await request.json().catch(() => null);
    const parsed = mutationSchema.safeParse(body);
    if (!parsed.success) {
      return privateJson({ error: "Invalid request" }, { status: 400 });
    }
    if (!canBlockPermission(auth)) return forbidden();
    if (parsed.data.action === "allow" && !isManagerOrAbove(auth.role))
      return forbidden();

    const { id: leadId } = await params;
    const where = await accessibleLeadWhere(auth, leadId);
    const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;

    try {
      const result = await withMutationRetry<PermissionMutationResult>(() =>
        prisma.$transaction(
          async (
            tx: Prisma.TransactionClient,
          ): Promise<PermissionMutationResult> => {
            // Resolve an accessible tenant candidate, then lock its physical row.
            // A concurrent phone/assignment edit must commit either before this
            // lock (and be observed below) or after this permission transaction.
            const leadCandidate = await tx.lead.findFirst({
              where,
              select: { id: true },
            });
            if (!leadCandidate) throw new InaccessibleLeadError();
            await lockLeadRow(tx, auth.orgId, leadCandidate.id);

            // Re-read visibility, version and canonical phone while the lead row
            // lock is held. Browser input can never select or override the number.
            const lead = await tx.lead.findFirst({
              where,
              select: { id: true, phone: true, updatedAt: true },
            });
            if (!lead) throw new InaccessibleLeadError();
            const leadVersion = lead.updatedAt.toISOString();
            if (leadVersion !== parsed.data.leadVersion) {
              throw new LeadVersionConflictError();
            }
            const normalizedPhone = normalizeManualLeadPhone(lead.phone);
            if (!normalizedPhone) {
              return { phoneUnavailable: true as const };
            }

            // Permission changes and provider dispatch acquire the same
            // transaction-scoped advisory lock. The lead row remains locked while
            // waiting, so its canonical phone cannot change underneath the write.
            await lockVoiceContactPermission(
              tx,
              auth.orgId,
              normalizedPhone.e164,
            );
            const phoneFingerprint = permissionPhoneFingerprint(
              auth.orgId,
              normalizedPhone.e164,
            );
            const now = new Date();

            const replay = await tx.auditLog.findFirst({
              where: {
                organizationId: auth.orgId,
                entityType: "lead_voice_permission",
                entityId: parsed.data.idempotencyKey,
              },
              select: {
                action: true,
                entityName: true,
                newValue: true,
                userId: true,
              },
            });
            if (replay) {
              const replayMeta = jsonRecord(replay.newValue);
              const expectedAuditAction =
                parsed.data.action === "block"
                  ? "voice_contact_block"
                  : "voice_contact_allow";
              if (
                replay.action !== expectedAuditAction ||
                replay.entityName !== lead.id ||
                replay.userId !== auth.userId ||
                replayMeta?.operation !== parsed.data.action ||
                replayMeta?.leadId !== lead.id ||
                replayMeta?.source !== "lead_card" ||
                replayMeta?.leadVersion !== parsed.data.leadVersion ||
                replayMeta?.scope !== "sales" ||
                replayMeta?.phoneFingerprint !== phoneFingerprint
              ) {
                throw new IdempotencyConflictError();
              }
              const state = await readPermissionState(
                tx,
                auth.orgId,
                normalizedPhone.e164,
                now,
              );
              return {
                phoneUnavailable: false as const,
                state,
                leadVersion,
                phoneFingerprint,
                replayed: true,
              };
            }

            const suppressionKey = {
              organizationId_phoneE164_scope: {
                organizationId: auth.orgId,
                phoneE164: normalizedPhone.e164,
                scope: "sales",
              },
            };
            const consentKey = {
              organizationId_phoneE164_scope: {
                organizationId: auth.orgId,
                phoneE164: normalizedPhone.e164,
                scope: "sales",
              },
            };
            const [beforeSuppression, beforeConsent, currentState] =
              await Promise.all([
                tx.voiceSuppression.findUnique({
                  where: suppressionKey,
                  select: {
                    id: true,
                    isActive: true,
                    source: true,
                    reason: true,
                    createdBy: true,
                  },
                }),
                parsed.data.action === "allow"
                  ? tx.voiceConsent.findUnique({
                      where: consentKey,
                      select: {
                        id: true,
                        status: true,
                        source: true,
                        reason: true,
                        confirmedBy: true,
                        confirmedAt: true,
                      },
                    })
                  : Promise.resolve(null),
                readPermissionState(tx, auth.orgId, normalizedPhone.e164, now),
              ]);
            if (
              parsed.data.action === "allow" &&
              currentState.globalBlockActive
            ) {
              throw new BroaderRestrictionActiveError();
            }

            let suppressionChange: Prisma.InputJsonObject | null = null;
            let consentChange: Prisma.InputJsonObject | null = null;
            if (parsed.data.action === "block") {
              const afterSuppression = await tx.voiceSuppression.upsert({
                where: suppressionKey,
                create: {
                  organizationId: auth.orgId,
                  phoneE164: normalizedPhone.e164,
                  scope: "sales",
                  reason: "customer_sales_call_blocked",
                  source: "lead_card",
                  isActive: true,
                  expiresAt: null,
                  createdBy: auth.userId,
                },
                update: {
                  reason: "customer_sales_call_blocked",
                  source: "lead_card",
                  isActive: true,
                  expiresAt: null,
                  createdBy: auth.userId,
                },
                select: {
                  id: true,
                  isActive: true,
                  source: true,
                  reason: true,
                  createdBy: true,
                },
              });
              suppressionChange = {
                rowId: afterSuppression.id,
                before: suppressionAuditState(beforeSuppression),
                after: suppressionAuditState(afterSuppression),
              };
            } else {
              const managerSource = "lead_card_manager_confirmation";
              await tx.voiceSuppression.updateMany({
                where: {
                  organizationId: auth.orgId,
                  phoneE164: normalizedPhone.e164,
                  scope: "sales",
                  isActive: true,
                },
                data: { isActive: false, expiresAt: now },
              });
              if (beforeSuppression) {
                suppressionChange = {
                  rowId: beforeSuppression.id,
                  before: suppressionAuditState(beforeSuppression),
                  after: suppressionAuditState({
                    ...beforeSuppression,
                    isActive: false,
                  }),
                };
              }
              const afterConsent = await tx.voiceConsent.upsert({
                where: consentKey,
                create: {
                  organizationId: auth.orgId,
                  phoneE164: normalizedPhone.e164,
                  scope: "sales",
                  status: "allowed",
                  source: managerSource,
                  reason: "manager_confirmed_sales_voice_contact",
                  confirmedAt: now,
                  confirmedBy: auth.userId,
                  expiresAt: null,
                },
                update: {
                  status: "allowed",
                  source: managerSource,
                  reason: "manager_confirmed_sales_voice_contact",
                  confirmedAt: now,
                  confirmedBy: auth.userId,
                  expiresAt: null,
                },
                select: {
                  id: true,
                  status: true,
                  source: true,
                  reason: true,
                  confirmedBy: true,
                  confirmedAt: true,
                },
              });
              consentChange = {
                rowId: afterConsent.id,
                before: consentAuditState(beforeConsent),
                after: consentAuditState(afterConsent),
              };
            }

            const state = await readPermissionState(
              tx,
              auth.orgId,
              normalizedPhone.e164,
              now,
            );

            // One append-only audit row is also the request replay ledger. It records
            // actor, fixed source, server timestamp, operation, and lead identity,
            // but never stores or returns the phone number.
            const auditValue: Prisma.InputJsonObject = {
              operation: parsed.data.action,
              leadId: lead.id,
              leadVersion,
              phoneFingerprint,
              scope: "sales",
              source: "lead_card",
              affectedRows: {
                suppression: suppressionChange,
                consent: consentChange,
              },
              effectiveState: {
                before: currentState.state,
                after: state.state,
              },
              occurredAt: now.toISOString(),
            };
            await tx.auditLog.create({
              data: {
                organizationId: auth.orgId,
                userId: auth.userId,
                action:
                  parsed.data.action === "block"
                    ? "voice_contact_block"
                    : "voice_contact_allow",
                entityType: "lead_voice_permission",
                entityId: parsed.data.idempotencyKey,
                entityName: lead.id,
                newValue: auditValue,
                userAgent,
              },
            });

            return {
              phoneUnavailable: false as const,
              state,
              leadVersion,
              phoneFingerprint,
              replayed: false,
            };
          },
          // READ COMMITTED is required here: if this transaction waits for a
          // dispatch/permission advisory-lock holder, the post-lock rechecks must
          // see the winner's commit rather than a pre-wait snapshot.
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        ),
      );

      if (result.phoneUnavailable) {
        return privateJson(
          { success: false, code: "phone_unavailable" },
          { status: 409 },
        );
      }

      const recentEvents = isManagerOrAbove(auth.role)
        ? await recentPermissionEvents(
            auth.orgId,
            leadId,
            result.phoneFingerprint,
          )
        : undefined;
      return privateJson({
        success: true,
        data: publicState({
          state: result.state,
          leadVersion: result.leadVersion,
          phoneReady: true,
          canBlock: true,
          canManage: isManagerOrAbove(auth.role),
          replayed: result.replayed,
          recentEvents,
        }),
      });
    } catch (error) {
      if (error instanceof InaccessibleLeadError) return notFound();
      if (error instanceof LeadVersionConflictError) {
        return privateJson(
          { error: "Lead changed", code: "lead_version_conflict" },
          { status: 409 },
        );
      }
      if (error instanceof BroaderRestrictionActiveError) {
        return privateJson(
          {
            error: "Broader restriction remains active",
            code: "broader_restriction_active",
          },
          { status: 409 },
        );
      }
      if (error instanceof IdempotencyConflictError) {
        return privateJson(
          { error: "Idempotency key conflict", code: "idempotency_conflict" },
          { status: 409 },
        );
      }
      console.error("[lead-voice-permission] mutation failed", {
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return privateJson({ error: "Internal server error" }, { status: 500 });
    }
  },
);

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const guard = guardInteractiveJsonMutation(request);
  if (guard) {
    guard.headers.set("Cache-Control", "private, no-store");
    return guard;
  }
  return postWithAuth(request, context);
}
