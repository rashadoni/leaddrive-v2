/**
 * The contract wizard (src/lib/clm/contract-wizard.ts).
 *
 * GET  ?deal=<id>  — what the wizard starts from: the active templates, our
 *                    side from «Settings → Invoices» with the banks it may
 *                    name, and the deal's money and company when opened from one.
 * POST { preview: true }  — the document as it will be, nothing written.
 * POST { preview: false } — the company card gains what it lacked (and the bank
 *                    when asked), and the draft contract with its first version
 *                    is made, in one transaction.
 *
 * Auth: contracts:write. Writing a company card also needs companies:write;
 * without it the wizard still makes a contract for a company that needs no change.
 */
import { NextResponse } from "next/server"
import { z } from "zod"
import type { Prisma } from "@prisma/client"
import { prisma, logAudit } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { createNotification } from "@/lib/notifications"
import { routeNewCompanyToTerritories } from "@/lib/territory-routing"
import { getFieldPermissions, filterWritableFields } from "@/lib/field-filter"
import { normaliseVoen } from "@/lib/companies/az-taxpayer-registry"
import { companyWithVoen } from "@/lib/companies/voen-duplicate"
import { BANK_FIELDS, bankRequisitesSchema, emptyBank, readBank } from "@/lib/companies/bank-requisites"
import type { TemplateClause, TemplateVariable } from "@/lib/contract-lifecycle/types"
import { createContractDraft, generateContractNumber } from "@/lib/clm/create-contract-draft"
import {
  companyChanges,
  counterpartyParty,
  defaultEndDate,
  ourSide,
  wizardText,
  type CompanyRow,
  type CounterpartyInput,
  type WizardTemplate,
} from "@/lib/clm/contract-wizard"
import { isStandardField } from "@/lib/clm/standard-fields"
import { normalizeContractRow } from "@/lib/prisma-decimal"

const COMPANY_SELECT = {
  id: true,
  name: true,
  voen: true,
  address: true,
  director: true,
  externalSource: true,
  bankName: true,
  bankCode: true,
  bankSwift: true,
  bankAccount: true,
  bankVoen: true,
  bankCorrAccount: true,
} as const

async function loadOurSide(orgId: string) {
  const [organization, accounts] = await Promise.all([
    prisma.organization.findUnique({ where: { id: orgId }, select: { name: true, settings: true } }),
    prisma.bankAccount.findMany({
      where: { organizationId: orgId, isActive: true },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      select: { id: true, accountName: true, accountNumber: true, bankName: true, bankCode: true, swiftCode: true, currency: true },
    }),
  ])
  const settings = (organization?.settings ?? {}) as Record<string, unknown>
  return ourSide(settings.invoice as Record<string, unknown> | undefined, organization?.name ?? "", accounts)
}

async function loadDeal(orgId: string, dealId: string) {
  return prisma.deal.findFirst({
    where: { id: dealId, organizationId: orgId },
    select: { id: true, name: true, valueAmount: true, currency: true, company: { select: COMPANY_SELECT } },
  })
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = Number(typeof value === "object" ? String(value) : value)
  return Number.isFinite(n) ? n : null
}

export const GET = withRlsAuth("contracts", "write", async (req, { orgId }) => {
  const dealId = new URL(req.url).searchParams.get("deal")
  try {
    const [our, templates, deal] = await Promise.all([
      loadOurSide(orgId),
      prisma.contractTemplate.findMany({
        where: { organizationId: orgId, isActive: true },
        orderBy: { name: "asc" },
        select: { id: true, name: true, description: true, defaultContractType: true, clauses: true, variables: true },
      }),
      dealId ? loadDeal(orgId, dealId) : Promise.resolve(null),
    ])
    return NextResponse.json({
      success: true,
      data: {
        our: our.party,
        ourBanks: our.banks,
        templates: templates.map((t: { id: string; name: string; description: string | null; defaultContractType: string; clauses: unknown; variables: unknown }) => {
          const variables = (Array.isArray(t.variables) ? t.variables : []) as unknown as TemplateVariable[]
          return {
            id: t.id,
            name: t.name,
            description: t.description,
            defaultContractType: t.defaultContractType,
            clauseCount: Array.isArray(t.clauses) ? t.clauses.length : 0,
            // what a person may have to type: the template's own fields, not the standard ones
            ownFieldCount: variables.filter((v) => !isStandardField(v.name)).length,
          }
        }),
        deal: deal
          ? {
              id: deal.id,
              name: deal.name,
              valueAmount: toNumber(deal.valueAmount),
              currency: deal.currency,
              company: deal.company ? { ...deal.company, bank: readBank(deal.company) } : null,
            }
          : null,
      },
    })
  } catch (e) {
    console.error("[contracts/wizard GET]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v?.trim() ? v.trim().replace(/\s+/g, " ") : null))

const bodySchema = z.object({
  preview: z.boolean().default(true),
  templateId: z.string().max(64).nullable(),
  dealId: z.string().max(64).nullable().optional(),
  /** An existing company the person picked; else found by VÖEN, else created. */
  companyId: z.string().max(64).nullable().optional(),
  counterparty: z.object({
    voen: z.string().max(40).nullable().optional(),
    name: z.string().trim().min(1).max(200),
    address: optionalText(500),
    director: optionalText(200),
    bank: bankRequisitesSchema.optional(),
    saveBank: z.boolean().default(false),
  }),
  /** `settings`, a BankAccount id, or null for no bank of ours in the text. */
  ourBank: z.string().max(64).nullable().optional(),
  typed: z.record(z.string(), z.union([z.string().max(5000), z.number(), z.boolean()])).default({}),
  title: z.string().trim().max(255).optional(),
  lang: z.enum(["az", "ru", "en"]).default("az"),
})

export const POST = withRlsAuth("contracts", "write", async (req, { orgId, userId, role }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const input = parsed.data

  const voenRaw = input.counterparty.voen?.trim() ?? ""
  const voen = voenRaw ? normaliseVoen(voenRaw) : null
  if (voenRaw && !voen) return NextResponse.json({ error: "VÖEN is ten digits", code: "INVALID_VOEN" }, { status: 400 })

  try {
    // ── What the text is made of ─────────────────────────────────────────
    const [our, templateRow, deal] = await Promise.all([
      loadOurSide(orgId),
      input.templateId
        ? prisma.contractTemplate.findFirst({ where: { id: input.templateId, organizationId: orgId } })
        : Promise.resolve(null),
      input.dealId ? loadDeal(orgId, input.dealId) : Promise.resolve(null),
    ])
    if (input.templateId && !templateRow) return NextResponse.json({ error: "Template not found" }, { status: 404 })
    if (templateRow && !templateRow.isActive) return NextResponse.json({ error: "Template is not active" }, { status: 422 })
    if (input.dealId && !deal) return NextResponse.json({ error: "Deal not found" }, { status: 404 })

    const ourBank = input.ourBank ? our.banks.find((b) => b.id === input.ourBank) : undefined
    if (input.ourBank && !ourBank) return NextResponse.json({ error: "Unknown bank account", code: "INVALID_OUR_BANK" }, { status: 400 })

    const bank = emptyBank()
    for (const field of BANK_FIELDS) bank[field] = input.counterparty.bank?.[field] ?? null
    const counterpartyInput: CounterpartyInput = {
      voen,
      name: input.counterparty.name,
      address: input.counterparty.address,
      director: input.counterparty.director,
      bank,
      saveBank: input.counterparty.saveBank,
    }

    // ── Which company card this is ────────────────────────────────────────
    const companyId = input.companyId ?? deal?.company?.id ?? (voen ? (await companyWithVoen(orgId, voen))?.id : null) ?? null
    const company: CompanyRow | null = companyId
      ? await prisma.company.findFirst({ where: { id: companyId, organizationId: orgId }, select: COMPANY_SELECT })
      : null
    if (companyId && !company) return NextResponse.json({ error: "Company not found" }, { status: 404 })
    const changes = company ? companyChanges(company, counterpartyInput) : {}

    const template: WizardTemplate | null = templateRow
      ? {
          id: templateRow.id,
          name: templateRow.name,
          version: templateRow.version,
          defaultContractType: templateRow.defaultContractType,
          defaultDurationMonths: templateRow.defaultDurationMonths,
          clauses: templateRow.clauses as unknown as TemplateClause[],
          variables: (Array.isArray(templateRow.variables) ? templateRow.variables : []) as unknown as TemplateVariable[],
        }
      : null
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const amount = toNumber(deal?.valueAmount)
    const currency = deal?.currency ?? null
    const ourParty = { ...our.party, bank: ourBank?.bank ?? emptyBank() }
    const text = wizardText({
      template,
      our: ourParty,
      counterparty: counterpartyParty(counterpartyInput),
      date: today,
      amount,
      currency,
      typed: input.typed,
      lang: input.lang,
      preview: input.preview,
    })
    if ("error" in text) {
      return NextResponse.json({ error: "Variable substitution failed", code: "TEMPLATE_INVALID", details: text.details }, { status: 422 })
    }

    const companyPlan = company
      ? { action: "update" as const, id: company.id, name: company.name, fields: Object.keys(changes) }
      : { action: "create" as const, id: null, name: counterpartyInput.name, fields: [] as string[] }

    if (input.preview) {
      return NextResponse.json({
        success: true,
        data: { renderedBody: text.renderedBody, missing: text.missing, asked: text.asked, standard: text.standard, company: companyPlan },
      })
    }

    // ── Create ────────────────────────────────────────────────────────────
    if (text.missing.length > 0) {
      return NextResponse.json({ error: "Fill in the remaining fields", code: "MISSING_FIELDS", missing: text.missing }, { status: 400 })
    }
    const writesCompany = !company || Object.keys(changes).length > 0
    if (writesCompany && !checkPermission(role, "companies", "write")) {
      return NextResponse.json({ error: "No right to change companies", code: "COMPANY_WRITE_DENIED" }, { status: 403 })
    }
    const fieldPerms = writesCompany ? await getFieldPermissions(orgId, role, "company") : {}

    const title = input.title || (template ? `${template.name} — ${counterpartyInput.name}` : counterpartyInput.name)
    const startDate = today
    const endDate = defaultEndDate(startDate, template?.defaultDurationMonths ?? null)

    const outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      let companyRef: { id: string; name: string; created: boolean }
      if (company) {
        const allowed = filterWritableFields(changes, fieldPerms, role)
        if (Object.keys(allowed).length > 0) {
          await tx.company.updateMany({ where: { id: company.id, organizationId: orgId }, data: allowed })
        }
        companyRef = { id: company.id, name: company.name, created: false }
      } else {
        const data = filterWritableFields(
          {
            name: counterpartyInput.name,
            voen: counterpartyInput.voen,
            address: counterpartyInput.address,
            director: counterpartyInput.director,
            status: "active",
            ...(counterpartyInput.saveBank ? counterpartyInput.bank : {}),
          },
          fieldPerms,
          role,
        )
        const created = await tx.company.create({ data: { organizationId: orgId, name: counterpartyInput.name, ...data } })
        companyRef = { id: created.id, name: created.name, created: true }
      }
      const contract = await createContractDraft(tx, {
        organizationId: orgId,
        userId,
        contractNumber: generateContractNumber(),
        title,
        type: template?.defaultContractType ?? "other",
        templateId: template?.id ?? null,
        templateVersion: template?.version ?? null,
        renderedBody: text.renderedBody,
        companyId: companyRef.id,
        dealId: deal?.id ?? null,
        startDate,
        endDate,
        valueAmount: amount ?? undefined,
        currency: currency ?? undefined,
      })
      return { contract, company: companyRef }
    })

    logAudit(orgId, "create", "contract", outcome.contract.id, outcome.contract.title, {
      newValue: { via: "wizard", templateId: template?.id ?? null, companyId: outcome.company.id, dealId: deal?.id ?? null },
      ...(userId ? { userId } : {}),
    })
    if (outcome.company.created) {
      logAudit(orgId, "create", "company", outcome.company.id, outcome.company.name)
      createNotification({
        organizationId: orgId,
        type: "info",
        title: "Новая компания",
        message: `Добавлена компания «${outcome.company.name}»`,
        entityType: "company",
        entityId: outcome.company.id,
      }).catch(() => {})
      routeNewCompanyToTerritories(prisma, {
        orgId,
        company: { id: outcome.company.id, name: outcome.company.name, country: null, industry: null, employeeCount: null },
      }).catch(() => {})
    } else if (Object.keys(changes).length > 0) {
      logAudit(orgId, "update", "company", outcome.company.id, outcome.company.name, { newValue: { via: "contract-wizard", ...changes } })
    }

    return NextResponse.json(
      { success: true, data: { contract: normalizeContractRow(outcome.contract), company: outcome.company } },
      { status: 201 },
    )
  } catch (e) {
    console.error("[contracts/wizard POST]", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
