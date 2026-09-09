import { NextRequest, NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { provisionTenant, validateSlug, type TenantInput } from "@/lib/tenant-provisioning"
import { sendEmail } from "@/lib/email"
import { getWelcomeTenantEmail } from "@/lib/emails/welcome-tenant"
import { PLAN_LABELS, type TenantPlan } from "@/lib/tenant-plans"
import { createDnsRecord, isCloudflareConfigured } from "@/lib/cloudflare-dns"
import { logAudit } from "@/lib/prisma"
import { checkRateLimit } from "@/lib/rate-limit"
import { runWithRlsBypass } from "@/lib/rls-context"
import { execFile } from "child_process"
import path from "path"
import { z } from "zod"

const TENANT_DEMO_SEED_CONFIRMATION = "tenant-demo-seed-v1"

// Optional custom scaffolding passed from the new-tenant wizard (Phase 2). Unknown keys
// in the request body are stripped by zod; absent fields → provisionTenant uses DEFAULT_*.
const scaffoldingSchema = z.object({
  pipelineStages: z.array(z.object({ name: z.string().min(1), displayName: z.string().min(1), color: z.string(), probability: z.number().int().min(0).max(100), sortOrder: z.number().int(), isWon: z.boolean().optional(), isLost: z.boolean().optional() })).min(1, "at least one pipeline stage is required").optional(),
  taskTypes: z.array(z.object({ name: z.string().min(1), displayName: z.string().min(1), color: z.string(), sortOrder: z.number().int() })).optional(),
  eventTypes: z.array(z.object({ name: z.string().min(1), displayName: z.string().min(1), color: z.string(), sortOrder: z.number().int() })).optional(),
  currencies: z.array(z.object({ code: z.string().min(1), name: z.string().min(1), symbol: z.string(), exchangeRate: z.number().positive(), isBase: z.boolean().optional() })).refine((cs) => cs.filter((c) => c.isBase).length <= 1, "at most one base currency").optional(),
})

const provisioningV2Schema = z.object({
  idempotencyKey: z.string().min(8).max(160).optional(),
  primaryBrand: z.object({
    name: z.string().trim().min(1).max(160),
    legalName: z.string().trim().max(240).optional(),
    description: z.string().trim().max(4000).optional(),
    website: z.string().trim().url().optional(),
    aliases: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
    languages: z.array(z.string().trim().min(2).max(32)).max(20).optional(),
    geographies: z.array(z.string().trim().min(2).max(80)).max(50).optional(),
    supportEmail: z.string().trim().email().optional(),
    voice: z.string().trim().max(500).optional(),
    customInstructions: z.string().trim().max(8000).optional(),
  }).optional(),
  channels: z.array(z.enum([
    "email",
    "webchat",
    "whatsapp",
    "facebook",
    "instagram",
    "tiktok",
    "telegram",
  ])).max(7).optional(),
  providers: z.array(z.object({
    providerKey: z.enum(["serpapi", "bright_data", "apify"]),
    billingMode: z.enum(["disabled", "platform", "byok"]),
    enabled: z.boolean().optional(),
    spendPolicy: z.object({
      sourceOfTruth: z.enum(["provider_account", "tenant_policy"]).optional(),
      maxPerRunUsd: z.number().nonnegative().optional(),
      dailyBudgetUsd: z.number().nonnegative().optional(),
      monthlyBudgetUsd: z.number().nonnegative().optional(),
    }).optional(),
  })).max(3).superRefine((providers, ctx) => {
    const seen = new Set<string>()
    providers.forEach((provider, index) => {
      if (seen.has(provider.providerKey)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate provider "${provider.providerKey}"`,
          path: [index, "providerKey"],
        })
      }
      seen.add(provider.providerKey)
    })
  }).optional(),
})

// GET /api/v1/admin/tenants — List all tenants
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  return runWithRlsBypass(async () => {
    const tenants = await prisma.organization.findMany({
      include: {
        _count: {
          select: {
            users: true,
            contacts: true,
            deals: true,
            companies: true,
            tickets: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({
      data: tenants.map((t: Prisma.OrganizationGetPayload<{ include: { _count: { select: { users: true; contacts: true; deals: true; companies: true; tickets: true } } } }>) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        plan: t.plan,
        isActive: t.isActive,
        serverType: t.serverType,
        maxUsers: t.maxUsers,
        maxContacts: t.maxContacts,
        provisionedAt: t.provisionedAt,
        provisionedBy: t.provisionedBy,
        createdAt: t.createdAt,
        _count: t._count,
      })),
    })
  })
}

// POST /api/v1/admin/tenants — Provision new tenant
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  // Rate limit: max 10 tenants per hour
  const rateLimitKey = `tenant-provision:${auth.userId}`
  if (!checkRateLimit(rateLimitKey, { maxRequests: 10, windowMs: 3600000 })) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Max 10 tenants per hour." },
      { status: 429 }
    )
  }

  return runWithRlsBypass(async () => {
   try {
    const body = await req.json()
    const { companyName, slug, plan, adminName, adminEmail, branding, features, seedDemoData } = body

    // Validation
    if (!companyName || !slug || !adminName || !adminEmail) {
      return NextResponse.json(
        { error: "Required fields: companyName, slug, adminName, adminEmail" },
        { status: 400 }
      )
    }

    // Validate email format
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 })
    }

    // Validate slug
    const slugCheck = await validateSlug(slug)
    if (!slugCheck.valid && slugCheck.error !== `Slug "${slug}" is already taken`) {
      return NextResponse.json({ error: slugCheck.error }, { status: 400 })
    }

    // Validate plan against the active PlanTemplate catalog (DB-driven, not a hardcoded list)
    const planKey = plan || "starter"
    const planRow = await prisma.planTemplate.findFirst({ where: { key: planKey, isActive: true } })
    if (!planRow) {
      return NextResponse.json({ error: `Invalid or inactive plan "${planKey}"` }, { status: 400 })
    }

    // Validate optional custom scaffolding (stages / task types / event types / currencies)
    const scaffolding = scaffoldingSchema.safeParse(body)
    if (!scaffolding.success) {
      return NextResponse.json({ error: scaffolding.error.issues[0].message }, { status: 400 })
    }
    const provisioningV2 = provisioningV2Schema.safeParse(body)
    if (!provisioningV2.success) {
      return NextResponse.json({ error: provisioningV2.error.issues[0].message }, { status: 400 })
    }

    // Provision
    const input: TenantInput = {
      companyName,
      slug,
      plan: planKey,
      adminName,
      adminEmail,
      branding,
      features,
      provisionedBy: auth.userId,
      ...provisioningV2.data,
      ...scaffolding.data,
    }

    const result = await provisionTenant(input)

    // Create DNS record (best-effort)
    let dnsResult = null
    if (isCloudflareConfigured()) {
      try {
        dnsResult = await createDnsRecord(slug)
        if (!dnsResult.success) {
          console.error("[TENANT] DNS creation failed:", dnsResult.error)
        }
      } catch (dnsError) {
        console.error("[TENANT] DNS creation failed:", dnsError)
      }
    }

    // Send welcome email (best-effort, don't fail provisioning)
    let emailSent = false
    try {
      const planLabel = planRow.name || PLAN_LABELS[(result.organization.plan as TenantPlan)] || result.organization.plan
      const emailData = getWelcomeTenantEmail({
        companyName: result.organization.name,
        loginUrl: result.url,
        adminEmail: result.user.email,
        tempPassword: result.tempPassword,
        planName: planLabel,
      })
      await sendEmail({
        to: result.user.email,
        subject: emailData.subject,
        html: emailData.html,
      })
      emailSent = true
    } catch (emailError) {
      console.error("[TENANT] Welcome email failed:", emailError)
    }

    // Seed demo data (non-blocking, runs in background)
    let seedStarted = false
    if (seedDemoData) {
      try {
        // In standalone mode, process.cwd() is .next/standalone/ — resolve to project root
        const projectRoot = process.env.APP_DIR || path.resolve(process.cwd(), "../..")
        const scriptPath = path.join(projectRoot, "scripts/seed-tenant-demo.mjs")
        execFile(process.execPath, [
          scriptPath,
          `--slug=${slug}`,
        ], {
          cwd: projectRoot,
          timeout: 300000,
          env: {
            ...process.env,
            CONFIRM_PROD: TENANT_DEMO_SEED_CONFIRMATION,
            SEED_PASSWORD: result.tempPassword,
          },
        }, (err, stdout, stderr) => {
          if (err) {
            console.error(`[TENANT] Seed script error for ${slug}:`, err.message)
            if (stderr) console.error("[TENANT] Seed stderr:", stderr)
          } else {
            console.log(`[TENANT] Seed complete for ${slug}:\n${stdout}`)
          }
        })
        seedStarted = true
        console.log(`[TENANT] Seed script started for ${slug}`)
      } catch (seedError) {
        console.error("[TENANT] Failed to start seed script:", seedError)
      }
    }

    // Audit log
    logAudit(auth.orgId, "create", "tenant", result.organization.id, result.organization.name, {
      newValue: { slug, plan: plan || "starter", adminEmail, seedDemoData: !!seedDemoData },
    })

    return NextResponse.json({
      success: true,
      data: {
        organization: result.organization,
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        tempPassword: result.tempPassword,
        url: result.url,
        dnsCreated: dnsResult?.success || false,
        emailSent,
        seedStarted,
        provisioning: result.provisioning,
      },
    }, { status: 201 })
   } catch (error: unknown) {
    console.error("[TENANT] Provisioning error:", error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Provisioning failed" },
      { status: 500 }
    )
   }
  })
}
