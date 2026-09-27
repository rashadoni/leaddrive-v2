import { NextResponse } from "next/server"
import { z } from "zod"

import { prisma } from "@/lib/prisma"
import {
  MACRO_DEFAULT_CATEGORIES,
  canManageTicketMacros,
  customMacroCategoriesFromSettings,
  normalizeMacroCategory,
  settingsWithMacroCategories,
  uniqueMacroCategories,
} from "@/lib/ticket-macros/presentation"
import { withRlsAuth } from "@/lib/with-rls"

const categoryName = z.string().transform(normalizeMacroCategory).pipe(z.string().min(1).max(80))
const createSchema = z.object({ name: categoryName }).strict()
const renameSchema = z.object({ name: categoryName, newName: categoryName }).strict()
const deleteSchema = z.object({ name: categoryName }).strict()

const defaultKeys = new Set(MACRO_DEFAULT_CATEGORIES.map((category) => category.toLocaleLowerCase()))

function forbidden(role: string) {
  return !canManageTicketMacros(role)
    ? NextResponse.json({ error: "Forbidden", code: "MACRO_WRITE_FORBIDDEN" }, { status: 403 })
    : null
}

export const POST = withRlsAuth("tickets", "write", async (req, auth) => {
  const denied = forbidden(auth.role)
  if (denied) return denied
  const parsed = createSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid category.", code: "MACRO_CATEGORY_INVALID" }, { status: 400 })

  try {
    const categories = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
      if (!organization) throw new Error("organization_not_found")
      const custom = customMacroCategoriesFromSettings(organization.settings)
      const existingKeys = new Set([...MACRO_DEFAULT_CATEGORIES, ...custom].map((category) => category.toLocaleLowerCase()))
      if (existingKeys.has(parsed.data.name.toLocaleLowerCase())) return null
      const next = uniqueMacroCategories([...custom, parsed.data.name])
      await tx.organization.update({
        where: { id: auth.orgId },
        data: { settings: settingsWithMacroCategories(organization.settings, next) },
      })
      return next
    }, { isolationLevel: "Serializable" })
    if (!categories) return NextResponse.json({ error: "Category already exists.", code: "MACRO_CATEGORY_CONFLICT" }, { status: 409 })
    return NextResponse.json({ success: true, data: { categories } }, { status: 201 })
  } catch (error) {
    console.error("[ticket-macros/categories POST]", error)
    return NextResponse.json({ error: "Failed to add category.", code: "MACRO_CATEGORY_SAVE_FAILED" }, { status: 500 })
  }
})

export const PATCH = withRlsAuth("tickets", "write", async (req, auth) => {
  const denied = forbidden(auth.role)
  if (denied) return denied
  const parsed = renameSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid category.", code: "MACRO_CATEGORY_INVALID" }, { status: 400 })
  if (defaultKeys.has(parsed.data.name.toLocaleLowerCase())) {
    return NextResponse.json({ error: "Default categories cannot be renamed.", code: "MACRO_CATEGORY_DEFAULT" }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
      if (!organization) throw new Error("organization_not_found")
      const custom = customMacroCategoriesFromSettings(organization.settings)
      const sourceIndex = custom.findIndex((category) => category.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase())
      if (sourceIndex < 0) return "missing" as const
      const collision = [...MACRO_DEFAULT_CATEGORIES, ...custom]
        .some((category) => category.toLocaleLowerCase() === parsed.data.newName.toLocaleLowerCase() && category.toLocaleLowerCase() !== parsed.data.name.toLocaleLowerCase())
      if (collision) return "conflict" as const
      const next = [...custom]
      next[sourceIndex] = parsed.data.newName
      await tx.ticketMacro.updateMany({
        where: { organizationId: auth.orgId, category: parsed.data.name },
        data: { category: parsed.data.newName },
      })
      await tx.organization.update({
        where: { id: auth.orgId },
        data: { settings: settingsWithMacroCategories(organization.settings, next) },
      })
      return uniqueMacroCategories(next)
    }, { isolationLevel: "Serializable" })
    if (result === "missing") return NextResponse.json({ error: "Category not found.", code: "MACRO_CATEGORY_NOT_FOUND" }, { status: 404 })
    if (result === "conflict") return NextResponse.json({ error: "Category already exists.", code: "MACRO_CATEGORY_CONFLICT" }, { status: 409 })
    return NextResponse.json({ success: true, data: { categories: result } })
  } catch (error) {
    console.error("[ticket-macros/categories PATCH]", error)
    return NextResponse.json({ error: "Failed to rename category.", code: "MACRO_CATEGORY_SAVE_FAILED" }, { status: 500 })
  }
})

export const DELETE = withRlsAuth("tickets", "write", async (req, auth) => {
  const denied = forbidden(auth.role)
  if (denied) return denied
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Invalid category.", code: "MACRO_CATEGORY_INVALID" }, { status: 400 })
  if (defaultKeys.has(parsed.data.name.toLocaleLowerCase())) {
    return NextResponse.json({ error: "Default categories cannot be deleted.", code: "MACRO_CATEGORY_DEFAULT" }, { status: 400 })
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const organization = await tx.organization.findUnique({ where: { id: auth.orgId }, select: { settings: true } })
      if (!organization) throw new Error("organization_not_found")
      const custom = customMacroCategoriesFromSettings(organization.settings)
      const exists = custom.some((category) => category.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase())
      if (!exists) return null
      const next = custom.filter((category) => category.toLocaleLowerCase() !== parsed.data.name.toLocaleLowerCase())
      const moved = await tx.ticketMacro.updateMany({
        where: { organizationId: auth.orgId, category: parsed.data.name },
        data: { category: "general" },
      })
      await tx.organization.update({
        where: { id: auth.orgId },
        data: { settings: settingsWithMacroCategories(organization.settings, next) },
      })
      return { categories: uniqueMacroCategories(next), moved: moved.count }
    }, { isolationLevel: "Serializable" })
    if (!result) return NextResponse.json({ error: "Category not found.", code: "MACRO_CATEGORY_NOT_FOUND" }, { status: 404 })
    return NextResponse.json({ success: true, data: result })
  } catch (error) {
    console.error("[ticket-macros/categories DELETE]", error)
    return NextResponse.json({ error: "Failed to delete category.", code: "MACRO_CATEGORY_DELETE_FAILED" }, { status: 500 })
  }
})
