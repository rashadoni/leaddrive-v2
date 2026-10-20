import { beforeEach, describe, expect, it, vi } from "vitest"
import { createHash } from "node:crypto"

/**
 * A public reply an integration posts through an API key, as the customer and
 * the agent then read it.
 *
 * A comment with no `userId` and no sender prefix is the customer's own portal
 * reply (`portalCommentView`), and the agent's page names the contact as its
 * author. So whatever an API key writes must carry a team author, or the
 * customer reads the team's answer under their own name.
 *
 * Checked 2026-10-19: it does. An API key's principal carries `userId` =
 * `ApiKey.createdBy`, the admin who issued it (only a browser session can issue
 * one), and both writers below store that id. The codebase also says that id is
 * an audit field, not an impersonation grant (`withRlsSessionAuth`,
 * `audit-actor-context`) — the change that would act on it by blanking the
 * key's `userId` turns every integration reply into the customer's words, and
 * nothing else would notice.
 *
 * No browser session exists in this test: the real auth stack resolves the key
 * from the `Authorization` header, the real routes write, and the real portal
 * and agent GETs read back what was stored.
 */

const RAW_KEY = "ld_" + "a".repeat(64)
const KEY_HASH = createHash("sha256").update(RAW_KEY).digest("hex")
const CUSTOMER = { contactId: "contact-1", organizationId: "org-1", companyId: null, fullName: "Aysel Məmmədova", email: "aysel@example.az" }

type StoredComment = { id: string; ticketId: string; comment: string; userId: string | null; isInternal: boolean; createdAt: Date; attachments: unknown[] }

const mocks = vi.hoisted(() => ({
  comments: [] as StoredComment[],
  getPortalUser: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }))
vi.mock("@/lib/portal-auth", () => ({ getPortalUser: mocks.getPortalUser }))
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(async () => undefined) }))
vi.mock("@/lib/whatsapp", () => ({ sendWhatsAppMessage: vi.fn() }))
vi.mock("@/lib/rls-context", () => ({
  runWithRlsBypass: vi.fn(async (work: () => Promise<unknown>) => work()),
  runWithTenant: vi.fn(async (_orgId: string, work: () => Promise<unknown>) => work()),
  enterTenantContext: vi.fn(),
}))
vi.mock("@/lib/prisma", () => {
  const ticketRow = () => ({
    id: "tk-1", organizationId: "org-1", ticketNumber: "TK-0042", subject: "Order missing", description: null,
    status: "in_progress", priority: "medium", category: "general", categoryRef: null, tags: [],
    contactId: "contact-1", companyId: null, assignedTo: null, createdBy: null, firstResponseAt: null,
    satisfactionRating: null, satisfactionComment: null, requesterName: null, requesterEmail: null, requesterPhone: null,
    createdAt: new Date(), updatedAt: new Date(), resolvedAt: null, closedAt: null,
    slaDueAt: null, slaFirstResponseDueAt: null,
    comments: mocks.comments.map((comment) => ({ ...comment })),
    closureRequests: [], entitlementMilestones: [],
  })
  const team = [{ id: "user-key-issuer", name: "Rashad Rahimov", email: "rashad@example.az" }]
  const prisma = {
    apiKey: {
      findFirst: vi.fn(async ({ where }: { where: { keyHash: string } }) => where.keyHash === KEY_HASH
        ? {
            id: "key-1", organizationId: "org-1", name: "Zapier", keyHash: KEY_HASH, isActive: true, expiresAt: null,
            scopes: ["write:tickets"], createdBy: "user-key-issuer",
            organization: { isActive: true, plan: "enterprise", addons: [], features: ["support"], modules: { support: true } },
          }
        : null),
      update: vi.fn(async () => ({})),
    },
    ticket: { findFirst: vi.fn(async () => ticketRow()), update: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({ count: 1 })) },
    ticketComment: {
      create: vi.fn(async ({ data }: { data: Omit<StoredComment, "id" | "createdAt" | "attachments"> }) => {
        const row: StoredComment = { id: `c${mocks.comments.length}`, ...data, createdAt: new Date(), attachments: [] }
        mocks.comments.push(row)
        return row
      }),
    },
    ticketMacro: {
      findFirst: vi.fn(async () => ({
        id: "macro-1", organizationId: "org-1", isActive: true,
        actions: [{ type: "add_comment", value: "We have shipped your order today." }],
      })),
      update: vi.fn(async () => ({})),
    },
    user: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => team.filter((user) => where.id.in.includes(user.id))),
      findFirst: vi.fn(async () => null),
    },
    contact: {
      findFirst: vi.fn(async () => ({ id: "contact-1", fullName: "Aysel Məmmədova", email: "aysel@example.az", phone: null, preferredLanguage: null })),
    },
    company: { findFirst: vi.fn(async () => null) },
    auditLog: { findFirst: vi.fn(async () => null), create: vi.fn(async () => ({})) },
    fieldPermission: { findMany: vi.fn(async () => []) },
    entitlementTicketMilestone: { findMany: vi.fn(async () => []) },
    $queryRaw: vi.fn(async () => []),
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(prisma)),
  }
  return { prisma, logAudit: vi.fn() }
})

import { NextRequest } from "next/server"
import { POST as applyMacro } from "@/app/api/v1/ticket-macros/[id]/apply/route"
import { POST as postComment } from "@/app/api/v1/tickets/[id]/comments/route"
import { GET as agentTicket } from "@/app/api/v1/tickets/[id]/route"
import { GET as portalTicket } from "@/app/api/v1/public/portal-tickets/[id]/route"

const withKey = { authorization: `Bearer ${RAW_KEY}`, "content-type": "application/json" }

function viaKey(path: string, body: unknown) {
  return new NextRequest(`http://localhost${path}`, { method: "POST", headers: withKey, body: JSON.stringify(body) })
}

/** The customer opens the ticket in the portal. */
async function customerReads() {
  const res = await portalTicket(new NextRequest("http://localhost/api/v1/public/portal-tickets/tk-1"), { params: Promise.resolve({ id: "tk-1" }) })
  expect(res.status).toBe(200)
  return (await res.json()).data.comments as Array<{ comment: string; author: string; isAgent: boolean; authorName: string | null }>
}

/** The ticket as the agent's page loads it (read with the same key: the reader does not change who the author is). */
async function agentReads() {
  const res = await agentTicket(new NextRequest("http://localhost/api/v1/tickets/tk-1", { headers: withKey }), { params: Promise.resolve({ id: "tk-1" }) })
  expect(res.status).toBe(200)
  return (await res.json()).data.comments as Array<{ comment: string; userName: string | null }>
}

async function expectTheTeamsReply(text: string) {
  expect(mocks.comments).toHaveLength(1)
  expect(mocks.comments[0]).toMatchObject({ comment: text, isInternal: false })

  const [portal] = await customerReads()
  expect(portal).toMatchObject({ comment: text, author: "agent", isAgent: true })
  expect(portal.authorName).not.toBe(CUSTOMER.fullName)

  const [agent] = await agentReads()
  expect(agent.comment).toBe(text)
  expect(agent.userName).not.toBe(CUSTOMER.fullName)
}

beforeEach(() => {
  mocks.comments.length = 0
  mocks.getPortalUser.mockResolvedValue(CUSTOMER)
})

describe("a public reply an integration posts through an API key", () => {
  it("is the team's on both sides when a macro writes it", async () => {
    const res = await applyMacro(viaKey("/api/v1/ticket-macros/macro-1/apply", { ticketId: "tk-1" }), { params: Promise.resolve({ id: "macro-1" }) })
    expect(res.status).toBe(200)
    await expectTheTeamsReply("We have shipped your order today.")
  })

  it("is the team's on both sides when posted to the ticket's comments", async () => {
    const res = await postComment(viaKey("/api/v1/tickets/tk-1/comments", { comment: "Your refund is on its way." }), { params: Promise.resolve({ id: "tk-1" }) })
    expect(res.status).toBe(201)
    await expectTheTeamsReply("Your refund is on its way.")
  })
})
