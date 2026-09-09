/**
 * Read one record's card aloud-ready: the fields a salesperson would glance at,
 * shaped for speech, and nothing else.
 *
 * Counterpart of find_record/open_record: those put a record on the screen,
 * this lets the assistant answer "what is the cashback for Aliyev on this
 * deal" without the user reading the card themselves. Curated per type rather
 * than dumping rows: a voice channel reads everything it is given OUT LOUD, so
 * an extra column here is not clutter, it is a spoken sentence.
 *
 * Boards are the one type deliberately NOT here: their card is a task list,
 * which get_boards_summary already covers, and board visibility has its own
 * per-division resolver on the find path.
 */
import { prisma } from "@/lib/prisma"
import { VOICE_READABLE_TYPES, type VoiceReadableType } from "./record-types"
import { MEDDPICC_BLOCKS, parseMeddpicc } from "@/lib/meddpicc"

const TEXT_LIMIT = 300

function trimmed(value: string | null | undefined): string | undefined {
  const v = (value ?? "").replace(/\s+/g, " ").trim()
  return v ? v.slice(0, TEXT_LIMIT) : undefined
}

function day(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null
}

function money(value: unknown): number {
  // Two decimals, not whole units: a 12.50 unit price rounded to 13 is a
  // wrong number spoken confidently.
  return Math.round(Number(value ?? 0) * 100) / 100
}

export type VoiceReadResult = { error: "BAD_RECORD" } | Record<string, unknown>

/** How much past to read out. A spoken history is not heard past a handful. */
const HISTORY_LIMIT = 8

/**
 * The deal card: amount, odds, MEDDPICC, people with cashback, competitors,
 * and what has actually happened on it.
 *
 * The history is here because without it the assistant could only recite the
 * current state and had to answer "I cannot say anything detailed about this
 * deal" — which the owner reported as the assistant not seeing deals at all.
 * It was right to refuse: a card with no past cannot answer "what happened
 * here". Both sources already exist in the CRM and are what the deal page
 * itself shows — recorded stage transitions, and activities related to the
 * deal — so the assistant now reads the same facts a person would.
 */
async function readDeal(orgId: string, id: string): Promise<VoiceReadResult> {
  const deal = await prisma.deal.findFirst({
    where: { id, organizationId: orgId },
    select: {
      name: true,
      stage: true,
      valueAmount: true,
      currency: true,
      probability: true,
      confidenceLevel: true,
      expectedClose: true,
      createdAt: true,
      meddpicc: true,
      contactRoles: {
        take: 12,
        select: {
          role: true,
          influence: true,
          loyalty: true,
          isPrimary: true,
          cashbackType: true,
          cashbackValue: true,
          contactId: true,
        },
      },
      competitors: {
        take: 8,
        select: {
          name: true,
          product: true,
          strengths: true,
          weaknesses: true,
          threat: true,
        },
      },
    },
  })
  if (!deal) return { error: "BAD_RECORD" }

  // Newest first, and only what the deal itself carries: a transition is a
  // recorded event, not an inference from the current stage.
  const [transitions, activities] = await Promise.all([
    prisma.pipelineStageTransition.findMany({
      where: { organizationId: orgId, dealId: id },
      orderBy: { transitionedAt: "desc" },
      take: HISTORY_LIMIT,
      select: { fromStage: true, toStage: true, transitionedAt: true, transitionType: true },
    }) as Promise<{
      fromStage: string | null
      toStage: string
      transitionedAt: Date
      transitionType: string
    }[]>,
    prisma.activity.findMany({
      where: { organizationId: orgId, relatedType: "deal", relatedId: id },
      orderBy: { createdAt: "desc" },
      take: HISTORY_LIMIT,
      select: { type: true, subject: true, createdAt: true, scheduledAt: true, completedAt: true },
    }) as Promise<{
      type: string
      subject: string | null
      createdAt: Date
      scheduledAt: Date | null
      completedAt: Date | null
    }[]>,
  ])

  // Roles hold only contact ids; names live on the contacts table. One query
  // for all, and a role whose contact vanished keeps its facts under an
  // "unknown contact" name instead of being dropped.
  const contactIds = deal.contactRoles.map((r) => r.contactId)
  const contacts: { id: string; fullName: string; position: string | null }[] =
    contactIds.length
      ? await prisma.contact.findMany({
          where: { id: { in: contactIds }, organizationId: orgId },
          select: { id: true, fullName: true, position: true },
        })
      : []
  const contactById = new Map(contacts.map((c) => [c.id, c]))

  const meddpicc = parseMeddpicc(deal.meddpicc)
  const blocks = MEDDPICC_BLOCKS.map((key) => ({
    block: key,
    score: meddpicc[key]?.score ?? null,
    note: trimmed(meddpicc[key]?.note) ?? null,
  }))
  const scored = blocks.filter((b) => b.score !== null)

  return {
    name: trimmed(deal.name) ?? "",
    stage: deal.stage,
    amount: money(deal.valueAmount),
    currency: deal.currency,
    probabilityPercent: deal.probability,
    confidencePercent: deal.confidenceLevel,
    expectedClose: day(deal.expectedClose),
    createdAt: day(deal.createdAt),
    meddpicc: {
      assessedBlocks: scored.length,
      totalBlocks: MEDDPICC_BLOCKS.length,
      // 8 blocks x 5 points - the same N/40 the deal tab shows.
      scoreOf40: scored.reduce((sum, b) => sum + (b.score ?? 0), 0),
      blocks,
    },
    contacts: deal.contactRoles.map((r) => {
      const contact = contactById.get(r.contactId)
      return {
        name: trimmed(contact?.fullName) ?? "unknown contact",
        position: trimmed(contact?.position) ?? null,
        role: r.role,
        influence: r.influence,
        loyalty: r.loyalty,
        isPrimary: r.isPrimary,
        // Null means no cashback agreed - the assistant says so, not a guess.
        cashback:
          r.cashbackValue === null || r.cashbackValue === undefined
            ? null
            : {
                // A null type is spoken as "type not filled in", never
                // defaulted: 500 stored as fixed must not be read as 500%.
                type: r.cashbackType ?? null,
                value: r.cashbackValue,
              },
      }
    }),
    competitors: deal.competitors.map((c) => ({
      name: trimmed(c.name) ?? "",
      product: trimmed(c.product) ?? null,
      threat: c.threat,
      strengths: trimmed(c.strengths) ?? null,
      weaknesses: trimmed(c.weaknesses) ?? null,
    })),
    // An empty history is a fact, not a gap to paper over: a deal with no
    // recorded transition genuinely has none, and saying so beats inventing a
    // path from the current stage backwards.
    stageHistory: transitions.map((t) => ({
      fromStage: t.fromStage,
      toStage: t.toStage,
      date: day(t.transitionedAt),
      type: t.transitionType,
    })),
    recentActivity: activities.map((a) => ({
      type: a.type,
      subject: trimmed(a.subject) ?? null,
      date: day(a.completedAt ?? a.scheduledAt ?? a.createdAt),
      // Scheduled but not completed is the difference between "we called" and
      // "we meant to call", and the assistant must never blur the two.
      done: a.completedAt !== null,
    })),
  }
}

async function readContact(orgId: string, id: string): Promise<VoiceReadResult> {
  const contact = await prisma.contact.findFirst({
    where: { id, organizationId: orgId },
    select: {
      fullName: true,
      position: true,
      department: true,
      email: true,
      phone: true,
      source: true,
      createdAt: true,
      company: { select: { name: true } },
    },
  })
  if (!contact) return { error: "BAD_RECORD" }
  return {
    name: trimmed(contact.fullName) ?? "",
    position: trimmed(contact.position) ?? null,
    department: trimmed(contact.department) ?? null,
    company: contact.company?.name ?? null,
    email: contact.email ?? null,
    phone: contact.phone ?? null,
    source: contact.source ?? null,
    createdAt: day(contact.createdAt),
  }
}

async function readCompany(orgId: string, id: string): Promise<VoiceReadResult> {
  const company = await prisma.company.findFirst({
    where: { id, organizationId: orgId },
    select: {
      name: true,
      industry: true,
      city: true,
      country: true,
      employeeCount: true,
      website: true,
      phone: true,
      createdAt: true,
      _count: { select: { contacts: true, deals: true } },
    },
  })
  if (!company) return { error: "BAD_RECORD" }
  return {
    name: trimmed(company.name) ?? "",
    industry: trimmed(company.industry) ?? null,
    location: [company.city, company.country].filter(Boolean).join(", ") || null,
    employeeCount: company.employeeCount ?? null,
    website: company.website ?? null,
    phone: company.phone ?? null,
    contactsCount: company._count.contacts,
    dealsCount: company._count.deals,
    createdAt: day(company.createdAt),
  }
}

async function readLead(orgId: string, id: string): Promise<VoiceReadResult> {
  const lead = await prisma.lead.findFirst({
    where: { id, organizationId: orgId },
    select: {
      contactName: true,
      companyName: true,
      status: true,
      source: true,
      interest: true,
      score: true,
      phone: true,
      email: true,
      notes: true,
      createdAt: true,
    },
  })
  if (!lead) return { error: "BAD_RECORD" }
  return {
    name: trimmed(lead.contactName) ?? "",
    company: trimmed(lead.companyName) ?? null,
    status: lead.status,
    source: lead.source ?? null,
    interest: trimmed(lead.interest) ?? null,
    score: lead.score,
    phone: lead.phone ?? null,
    email: lead.email ?? null,
    notes: trimmed(lead.notes) ?? null,
    createdAt: day(lead.createdAt),
  }
}

async function readTicket(orgId: string, id: string): Promise<VoiceReadResult> {
  const ticket = await prisma.ticket.findFirst({
    where: { id, organizationId: orgId },
    select: {
      ticketNumber: true,
      subject: true,
      description: true,
      status: true,
      priority: true,
      category: true,
      createdAt: true,
      contact: { select: { fullName: true } },
      company: { select: { name: true } },
    },
  })
  if (!ticket) return { error: "BAD_RECORD" }
  return {
    number: ticket.ticketNumber,
    subject: trimmed(ticket.subject) ?? "",
    description: trimmed(ticket.description) ?? null,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    contact: ticket.contact?.fullName ?? null,
    company: ticket.company?.name ?? null,
    createdAt: day(ticket.createdAt),
  }
}

async function readInvoice(orgId: string, id: string): Promise<VoiceReadResult> {
  const invoice = await prisma.invoice.findFirst({
    where: { id, organizationId: orgId },
    select: {
      invoiceNumber: true,
      title: true,
      status: true,
      totalAmount: true,
      currency: true,
      issueDate: true,
      dueDate: true,
      company: { select: { name: true } },
      contact: { select: { fullName: true } },
    },
  })
  if (!invoice) return { error: "BAD_RECORD" }
  return {
    number: invoice.invoiceNumber,
    title: trimmed(invoice.title) ?? "",
    status: invoice.status,
    total: money(invoice.totalAmount),
    currency: invoice.currency,
    issueDate: day(invoice.issueDate),
    dueDate: day(invoice.dueDate),
    company: invoice.company?.name ?? null,
    contact: invoice.contact?.fullName ?? null,
  }
}

async function readProject(orgId: string, id: string): Promise<VoiceReadResult> {
  const project = await prisma.project.findFirst({
    where: { id, organizationId: orgId },
    select: {
      name: true,
      code: true,
      description: true,
      status: true,
      priority: true,
      startDate: true,
      endDate: true,
      budget: true,
      _count: { select: { tasks: true } },
    },
  })
  if (!project) return { error: "BAD_RECORD" }
  return {
    name: trimmed(project.name) ?? "",
    code: project.code ?? null,
    description: trimmed(project.description) ?? null,
    status: project.status,
    priority: project.priority,
    startDate: day(project.startDate),
    endDate: day(project.endDate),
    budget: money(project.budget),
    tasksCount: project._count.tasks,
  }
}

async function readContract(orgId: string, id: string): Promise<VoiceReadResult> {
  const contract = await prisma.contract.findFirst({
    where: { id, organizationId: orgId },
    select: {
      contractNumber: true,
      title: true,
      type: true,
      status: true,
      startDate: true,
      endDate: true,
      valueAmount: true,
      company: { select: { name: true } },
    },
  })
  if (!contract) return { error: "BAD_RECORD" }
  return {
    number: contract.contractNumber,
    title: trimmed(contract.title) ?? "",
    type: contract.type,
    status: contract.status,
    startDate: day(contract.startDate),
    endDate: day(contract.endDate),
    value: contract.valueAmount === null ? null : money(contract.valueAmount),
    company: contract.company?.name ?? null,
  }
}

async function readProduct(orgId: string, id: string): Promise<VoiceReadResult> {
  const product = await prisma.product.findFirst({
    where: { id, organizationId: orgId },
    select: {
      name: true,
      description: true,
      category: true,
      sku: true,
      price: true,
      currency: true,
      isActive: true,
    },
  })
  if (!product) return { error: "BAD_RECORD" }
  return {
    name: trimmed(product.name) ?? "",
    description: trimmed(product.description) ?? null,
    category: product.category,
    sku: product.sku ?? null,
    price: money(product.price),
    currency: product.currency,
    active: product.isActive,
  }
}

export { VOICE_READABLE_TYPES }
export type { VoiceReadableType }

const READERS: Record<
  VoiceReadableType,
  (orgId: string, id: string) => Promise<VoiceReadResult>
> = {
  deal: readDeal,
  contact: readContact,
  company: readCompany,
  lead: readLead,
  ticket: readTicket,
  invoice: readInvoice,
  project: readProject,
  contract: readContract,
  product: readProduct,
}

export async function readVoiceRecord(
  orgId: string,
  type: VoiceReadableType,
  id: string,
): Promise<VoiceReadResult> {
  const reader = READERS[type]
  if (!reader) return { error: "BAD_RECORD" }
  return reader(orgId, id)
}
