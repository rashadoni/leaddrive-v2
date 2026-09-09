import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"
import { logAudit, prisma } from "@/lib/prisma"
import { withRlsAuth } from "@/lib/with-rls"
import {
  SOCIAL_LEGAL_LETTER_LANGUAGES,
  findOpenLegalCasesForPeriod,
  generateLegalLetterDraft,
} from "@/lib/social/legal-case"

const createSchema = z.object({
  title: z.string().trim().max(200).optional(),
  recipient: z.string().trim().max(300).optional(),
  language: z.enum(SOCIAL_LEGAL_LETTER_LANGUAGES).default("az"),
  periodStart: z.coerce.date(),
  periodEnd: z.coerce.date(),
  generateLetter: z.boolean().default(true),
})

export const GET = withRlsAuth("social-legal", "read", async (_req: NextRequest, auth) => {
  const [reports, openCaseCount] = await Promise.all([
    prisma.socialLegalReport.findMany({
      where: { organizationId: auth.orgId },
      include: { _count: { select: { cases: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.socialLegalCase.count({
      where: { organizationId: auth.orgId, status: "open", reportId: null },
    }),
  ])
  type ReportRow = { _count: { cases: number } } & Record<string, unknown>
  return NextResponse.json({
    success: true,
    data: {
      reports: (reports as ReportRow[]).map(({ _count, ...report }) => ({ ...report, caseCount: _count.cases })),
      openCaseCount,
    },
  })
})

/**
 * Bundle the period's open legal cases into a report and (optionally) draft
 * the complaint letter. The letter is a DRAFT for lawyer review — this
 * endpoint never sends anything anywhere.
 */
export const POST = withRlsAuth("social-legal", "write", async (req: NextRequest, auth) => {
  const orgId = auth.orgId
  const parsed = createSchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  const { periodStart, periodEnd, language, generateLetter } = parsed.data
  if (periodEnd.getTime() <= periodStart.getTime()) {
    return NextResponse.json({ error: "periodEnd must be after periodStart" }, { status: 400 })
  }

  const cases = await findOpenLegalCasesForPeriod(orgId, periodStart, periodEnd)
  if (cases.length === 0) {
    return NextResponse.json({ error: "No open legal cases in the selected period" }, { status: 400 })
  }

  const title = parsed.data.title
    || `Legal report ${periodStart.toISOString().slice(0, 10)} – ${periodEnd.toISOString().slice(0, 10)}`
  const report = await prisma.socialLegalReport.create({
    data: {
      organizationId: orgId,
      title,
      recipient: parsed.data.recipient ?? null,
      periodStart,
      periodEnd,
      status: "draft",
      letterLanguage: language,
      createdBy: auth.userId || null,
    },
  })
  await prisma.socialLegalCase.updateMany({
    where: { id: { in: cases.map((item) => item.caseId) }, organizationId: orgId },
    data: { reportId: report.id, status: "included" },
  })

  let letterSkipped: string | undefined
  if (generateLetter) {
    const org = await prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } })
    const letter = await generateLegalLetterDraft({
      organizationId: orgId,
      orgName: org?.name || "Company",
      recipient: parsed.data.recipient ?? null,
      language,
      periodStart,
      periodEnd,
      cases,
    })
    letterSkipped = letter.skipped
    if (letter.letterText) {
      await prisma.socialLegalReport.update({
        where: { id: report.id },
        data: { letterText: letter.letterText, letterSource: "ai" },
      })
      report.letterText = letter.letterText
      report.letterSource = "ai"
    }
  }

  logAudit(orgId, "social_legal_report_created", "social_legal_report", report.id, report.title, {
    newValue: { caseCount: cases.length, letterSource: report.letterSource, letterSkipped: letterSkipped ?? null },
  })

  return NextResponse.json({
    success: true,
    data: { ...report, caseCount: cases.length, ...(letterSkipped ? { letterSkipped } : {}) },
  })
})
