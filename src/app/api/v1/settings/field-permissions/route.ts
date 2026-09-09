import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma"
import { ENTITY_FIELDS, ENTITY_TYPES } from "@/lib/entity-fields"
import { withRlsAuth } from "@/lib/with-rls"

// GET — returns permission matrix: { [entityType]: { [fieldName]: { [roleId]: access } } }
export const GET = withRlsAuth("settings", "read", async (req, auth) => {
  const { searchParams } = new URL(req.url)
  const entityType = searchParams.get("entityType")

  try {
    const where: any = { organizationId: auth.orgId }
    if (entityType) where.entityType = entityType

    const permissions = await prisma.fieldPermission.findMany({ where })

    // Build matrix
    const matrix: Record<string, Record<string, Record<string, string>>> = {}

    const types = entityType ? [entityType] : ENTITY_TYPES
    for (const et of types) {
      matrix[et] = {}
      const fields = ENTITY_FIELDS[et] || []
      for (const field of fields) {
        matrix[et][field.name] = {}
      }
    }

    // Fill with DB values
    for (const p of permissions) {
      if (matrix[p.entityType]?.[p.fieldName]) {
        matrix[p.entityType][p.fieldName][p.roleId] = p.access
      }
    }

    return NextResponse.json({ success: true, data: matrix })
  } catch (e) {
    console.error("Field permissions GET error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})

const bulkUpdateSchema = z.array(z.object({
  roleId: z.string().min(1),
  entityType: z.string().min(1),
  fieldName: z.string().min(1),
  access: z.enum(["visible", "editable", "hidden"]),
}))

// PUT — bulk update permissions
export const PUT = withRlsAuth("settings", "admin", async (req, auth) => {
  const body = await req.json()
  const parsed = bulkUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    // Validate: admin always editable
    const filtered = parsed.data.filter(p => {
      if (p.roleId === "admin") return false // Skip admin — always editable
      if (!ENTITY_TYPES.includes(p.entityType)) return false
      const fields = ENTITY_FIELDS[p.entityType]
      if (!fields?.some(f => f.name === p.fieldName)) return false
      return true
    })

    // Upsert all permissions in a transaction
    await prisma.$transaction(
      filtered.map(p =>
        prisma.fieldPermission.upsert({
          where: {
            organizationId_roleId_entityType_fieldName: {
              organizationId: auth.orgId,
              roleId: p.roleId,
              entityType: p.entityType,
              fieldName: p.fieldName,
            },
          },
          update: { access: p.access },
          create: {
            organizationId: auth.orgId,
            roleId: p.roleId,
            entityType: p.entityType,
            fieldName: p.fieldName,
            access: p.access,
          },
        })
      )
    )

    return NextResponse.json({ success: true, updated: filtered.length })
  } catch (e) {
    console.error("Field permissions PUT error:", e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
})
