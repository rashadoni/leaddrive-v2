import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { resolveMtmRouteActor } from "@/lib/mtm/route-permissions"
import { isTenantCapabilityEnabled } from "@/lib/tenant-capabilities"
import { withMtmRlsAuth } from "@/lib/with-mtm-rls-auth"

type OperationsReceipt = { agentId: string; type: string; occurredAt: Date }
type OperationsThread = {
  id: string
  type: string
  subject: string | null
  lastMessageAt: Date
  createdByUserId: string | null
  participants: Array<{ role: string; agent: { id: string; name: string; role: string } }>
  messages: Array<{
    id: string
    senderAgentId: string | null
    senderUserId: string | null
    senderName: string
    body: string | null
    acknowledgementRequired: boolean
    sentAt: Date
    attachmentDocument: { id: string; fileName: string; mimeType: string; sizeBytes: number } | null
    receipts: OperationsReceipt[]
  }>
}
type OperationsDocument = {
  id: string
  title: string | null
  fileName: string
  mimeType: string
  sizeBytes: number
  checksumSha256: string | null
  createdAt: Date
  assignments: Array<{
    id: string
    required: boolean
    assignedAt: Date
    expiresAt: Date | null
    readAt: Date | null
    downloadedAt: Date | null
    agent: { id: string; name: string }
  }>
}
type OperationsHrmRequest = { status: string }

function forbidden() {
  return NextResponse.json({ error: "Forbidden", code: "MTM_OPERATIONS_SCOPE_DENIED" }, { status: 403 })
}

async function workforceEnabled(organizationId: string): Promise<boolean> {
  try {
    const organization = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { plan: true, addons: true, features: true, modules: true },
    })
    return Boolean(organization && isTenantCapabilityEnabled("workforce-hrm", organization))
  } catch (error) {
    // Operations also contains Route messages and documents. Keep those
    // available, but fail the HRM portion closed when entitlement cannot be
    // proven rather than leaking it through this mixed compatibility route.
    console.warn("[MTM/operations GET] Workforce capability lookup failed", error)
    return false
  }
}

export const GET = withMtmRlsAuth("mtm", "read", async (_req, auth) => {
  const actor = await resolveMtmRouteActor(prisma, {
    organizationId: auth.orgId,
    userId: auth.userId,
    webRole: auth.role,
    agentId: auth.agentId,
  })
  if (!actor || actor.role === "AGENT") return forbidden()

  const agentScope = actor.scopedAgentIds === null
    ? undefined
    : { in: [...actor.scopedAgentIds] }
  const threadScope = actor.scopedAgentIds === null
    ? {}
    : {
        OR: [
          { createdByUserId: auth.userId },
          ...(actor.agentId
            ? [
                { createdByAgentId: actor.agentId },
                { participants: { some: { agentId: actor.agentId, archivedAt: null } } },
              ]
            : []),
        ],
      }

  try {
    const canReviewHrm = await workforceEnabled(auth.orgId)
    const [agents, threads, documents, hrmRequests] = await Promise.all([
      prisma.mtmAgent.findMany({
        where: {
          organizationId: auth.orgId,
          status: "ACTIVE",
          ...(agentScope ? { id: agentScope } : {}),
        },
        orderBy: [{ role: "asc" }, { name: "asc" }],
        take: 500,
        select: {
          id: true,
          name: true,
          role: true,
          avatar: true,
          team: { select: { id: true, name: true } },
        },
      }),
      prisma.mtmMessageThread.findMany({
        where: { organizationId: auth.orgId, ...threadScope },
        orderBy: { lastMessageAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          subject: true,
          lastMessageAt: true,
          createdByUserId: true,
          participants: {
            where: { archivedAt: null },
            orderBy: { joinedAt: "asc" },
            select: {
              role: true,
              agent: { select: { id: true, name: true, role: true } },
            },
          },
          messages: {
            orderBy: { sentAt: "desc" },
            take: 1,
            select: {
              id: true,
              senderAgentId: true,
              senderUserId: true,
              senderName: true,
              body: true,
              acknowledgementRequired: true,
              sentAt: true,
              attachmentDocument: {
                select: { id: true, fileName: true, mimeType: true, sizeBytes: true },
              },
              receipts: { select: { agentId: true, type: true, occurredAt: true } },
            },
          },
        },
      }),
      prisma.mtmDocument.findMany({
        where: {
          organizationId: auth.orgId,
          deletedAt: null,
          ...(agentScope
            ? {
                OR: [
                  { uploadedByUserId: auth.userId },
                  ...(actor.agentId ? [{ uploadedByAgentId: actor.agentId }] : []),
                  { assignments: { some: { agentId: agentScope } } },
                ],
              }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          title: true,
          fileName: true,
          mimeType: true,
          sizeBytes: true,
          checksumSha256: true,
          createdAt: true,
          assignments: {
            ...(agentScope ? { where: { agentId: agentScope } } : {}),
            orderBy: { assignedAt: "asc" },
            select: {
              id: true,
              required: true,
              assignedAt: true,
              expiresAt: true,
              readAt: true,
              downloadedAt: true,
              agent: { select: { id: true, name: true } },
            },
          },
        },
      }),
      canReviewHrm
        ? prisma.mtmHrmRequest.findMany({
            where: {
              organizationId: auth.orgId,
              ...(agentScope ? { agentId: agentScope } : {}),
            },
            orderBy: [{ status: "asc" }, { submittedAt: "desc" }],
            take: 200,
            select: {
              id: true,
              type: true,
              status: true,
              startDate: true,
              endDate: true,
              requestedStartAt: true,
              requestedEndAt: true,
              reason: true,
              decisionNote: true,
              submittedAt: true,
              decidedAt: true,
              cancelledAt: true,
              agent: { select: { id: true, name: true, role: true } },
            },
          })
        : Promise.resolve([]),
    ])

    return NextResponse.json({
      success: true,
      data: {
        agents,
        threads: (threads as OperationsThread[]).map((thread) => {
          const lastMessage = thread.messages[0] ?? null
          return {
            ...thread,
            lastMessage,
            messages: undefined,
            acknowledgement: lastMessage?.acknowledgementRequired
              ? {
                  required: thread.participants.length,
                  acknowledged: new Set(lastMessage.receipts
                    .filter((receipt) => receipt.type === "ACKNOWLEDGED")
                    .map((receipt) => receipt.agentId)).size,
                  read: new Set(lastMessage.receipts
                    .filter((receipt) => receipt.type === "READ" || receipt.type === "ACKNOWLEDGED")
                    .map((receipt) => receipt.agentId)).size,
                }
              : null,
          }
        }),
        documents: (documents as OperationsDocument[]).map((document) => ({
          ...document,
          downloadUrl: `/api/v1/mtm/operations/documents/${document.id}/download`,
        })),
        hrmRequests,
        counts: {
          pendingHrm: (hrmRequests as OperationsHrmRequest[]).filter((request) => request.status === "PENDING").length,
          acknowledgementDue: (threads as OperationsThread[]).reduce((count, thread) => {
            const message = thread.messages[0]
            if (!message?.acknowledgementRequired) return count
            const acknowledged = new Set(message.receipts
              .filter((receipt) => receipt.type === "ACKNOWLEDGED")
              .map((receipt) => receipt.agentId)).size
            return count + Math.max(0, thread.participants.length - acknowledged)
          }, 0),
          requiredDocumentsUnread: (documents as OperationsDocument[]).reduce((count, document) => count + document.assignments
            .filter((assignment) => assignment.required && !assignment.readAt).length, 0),
        },
        capabilities: {
          canMessage: true,
          canAssignDocuments: true,
          canReviewHrm,
          privateStorage: true,
          externalCloudStorage: false,
        },
      },
    })
  } catch (error) {
    console.error("[MTM/operations GET]", error)
    return NextResponse.json({ error: "Failed to load field operations" }, { status: 500 })
  }
})
