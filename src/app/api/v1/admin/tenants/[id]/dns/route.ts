import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"
import { requireSuperAdmin } from "@/lib/superadmin-guard"
import { createDnsRecord, deleteDnsRecord, isCloudflareConfigured } from "@/lib/cloudflare-dns"

// POST /api/v1/admin/tenants/[id]/dns — Create DNS record
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  if (!isCloudflareConfigured()) {
    return NextResponse.json(
      { error: "Cloudflare DNS not configured. Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID in .env" },
      { status: 503 }
    )
  }

  const { id } = await params
  const tenant = await prisma.organization.findUnique({ where: { id } })
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
  }

  const result = await createDnsRecord(tenant.slug, tenant.serverIp || undefined)

  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    message: `DNS record created: ${tenant.slug}.${process.env.NEXT_PUBLIC_BASE_DOMAIN || "leaddrivecrm.org"}`,
    recordId: result.recordId,
  })
}

// DELETE /api/v1/admin/tenants/[id]/dns — Delete DNS record
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin(req)
  if (auth instanceof NextResponse) return auth

  if (!isCloudflareConfigured()) {
    return NextResponse.json(
      { error: "Cloudflare DNS not configured" },
      { status: 503 }
    )
  }

  const { id } = await params
  const tenant = await prisma.organization.findUnique({ where: { id } })
  if (!tenant) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
  }

  const result = await deleteDnsRecord(tenant.slug)

  return NextResponse.json({
    success: result.success,
    message: result.success
      ? `DNS record deleted for ${tenant.slug}`
      : result.error,
  })
}
