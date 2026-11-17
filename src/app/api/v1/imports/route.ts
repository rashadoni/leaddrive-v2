import { NextResponse } from "next/server"
import { withRlsAuth } from "@/lib/with-rls"
import { checkPermission } from "@/lib/permissions"
import { checkRateLimit } from "@/lib/rate-limit"
import { orgHasModule } from "@/lib/api-auth"
import type { ModuleId } from "@/lib/modules"
import { readSpreadsheet, SpreadsheetError, MAX_IMPORT_BYTES } from "@/lib/imports/spreadsheet"
import { IMPORT_ENTITIES, IMPORT_FIELDS, suggestMapping, type ImportEntity } from "@/lib/imports/entities"
import { applyImport, validateMapping } from "@/lib/imports/apply"

/**
 * Import from Excel or CSV (docs/sales-procurement/README.md, task 7.4).
 *
 * One endpoint, three steps, the file sent each time (nothing is kept on the
 * server between them):
 *   step=read    → the columns, the first rows and the suggested field per column;
 *   step=check   → with a mapping: what would be created, the duplicates, the row errors;
 *   step=import  → the same, written.
 *
 * Who may import is who may create the thing: companies / contacts / suppliers
 * (`procurement` write) / products (`offers` write, the sales catalogue). The
 * route's own gate is reading the shared customer base; the entity decides the rest.
 */
const SCOPE: Record<ImportEntity, string> = { companies: "companies", contacts: "contacts", suppliers: "procurement", products: "offers" }
const MODULE_OF: Record<ImportEntity, ModuleId | null> = { companies: null, contacts: null, suppliers: "procurement", products: "sales" }

export const POST = withRlsAuth("companies", "read", async (req, { orgId, userId, role }) => {
  if (Number(req.headers.get("content-length") ?? 0) > MAX_IMPORT_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "The file is larger than 5 MB", code: "TOO_BIG" }, { status: 413 })
  }
  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: "The upload arrived incomplete" }, { status: 400 })
  const entity = String(form.get("entity") ?? "") as ImportEntity
  if (!IMPORT_ENTITIES.includes(entity)) return NextResponse.json({ error: "Unknown import", code: "UNKNOWN_ENTITY" }, { status: 400 })
  if (!checkPermission(role, SCOPE[entity], "write")) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  // The tenant module of the thing imported, as its own routes would ask.
  const tenantModule = MODULE_OF[entity]
  if (tenantModule && role !== "superadmin" && !(await orgHasModule(orgId, tenantModule))) {
    return NextResponse.json({ error: "Module not enabled", code: "MODULE_DISABLED" }, { status: 403 })
  }
  const step = String(form.get("step") ?? "read")
  if (step === "import" && !checkRateLimit(`import:${userId}`, { maxRequests: 10, windowMs: 60_000 })) {
    return NextResponse.json({ error: "Too many imports. Please try again later." }, { status: 429 })
  }
  const file = form.get("file") as File | null
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 })
  let sheet
  try {
    sheet = await readSpreadsheet(file.name, Buffer.from(await file.arrayBuffer()))
  } catch (failure) {
    if (failure instanceof SpreadsheetError) return NextResponse.json({ error: failure.message, code: failure.code }, { status: 400 })
    throw failure
  }
  if (step === "read") {
    return NextResponse.json({
      success: true,
      data: { headers: sheet.headers, sample: sheet.rows.slice(0, 10), total: sheet.rows.length, mapping: suggestMapping(sheet.headers, entity), fields: IMPORT_FIELDS[entity].map(({ key, required }) => ({ key, required: !!required })) },
    })
  }
  let mapping: (string | null)[]
  try {
    mapping = JSON.parse(String(form.get("mapping") ?? "[]"))
  } catch {
    return NextResponse.json({ error: "Invalid mapping", code: "INVALID_MAPPING" }, { status: 400 })
  }
  const mappingError = Array.isArray(mapping) ? validateMapping(entity, sheet.headers, mapping) : "Invalid mapping"
  if (mappingError) return NextResponse.json({ error: mappingError, code: "INVALID_MAPPING" }, { status: 400 })
  const outcome = await applyImport({ orgId, userId, role, entity, sheet, mapping, dryRun: step !== "import" })
  return NextResponse.json({ success: true, data: outcome })
})
