import { NextResponse } from "next/server"
import { z } from "zod"
import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { mtmExcelAttachment } from "@/lib/mtm/excel-contract"
import {
  ATTENDANCE_IMPORT_CHUNK, ATTENDANCE_IMPORT_MAX_BYTES, applyAttendanceImport, buildAttendanceImportCurrentList, buildAttendanceImportErrors,
  buildAttendanceImportTemplate, previewAttendanceImport, type AttendanceImportLocale,
} from "@/lib/mtm/attendance-employee-import"

/**
 * Personnel → Employees → «Загрузить сотрудников» (owner, 2026-11-05).
 * GET  ?file=template|current&locale=az — the template, or everyone active as a file to edit and load back.
 * POST multipart `file` + `action`:
 *   preview — what each row would do; writes nothing;
 *   apply   — `rows` = [{ row, key }] from the preview, at most 25 per request;
 *   errors  — the rows with errors as a file, the reason in the last column.
 * The file is read and dropped: it is not kept anywhere.
 */
const locale = (value: string | null): AttendanceImportLocale => value === "ru" || value === "en" ? value : "az"
const Rows = z.array(z.object({ row: z.number().int().min(2).max(100_000), key: z.string().regex(/^[a-f0-9]{32}$/) }).strict()).min(1).max(ATTENDANCE_IMPORT_CHUNK)

function actorOf(auth: { orgId: string; userId: string; principalType: string }) {
  if (auth.principalType !== "session") throw new AttendanceRequestError("MTM_ATTENDANCE_EMPLOYEE_ADMIN_REQUIRED", 403)
  return { organizationId: auth.orgId, userId: auth.userId, principalType: "session" as const }
}
const xlsx = (bytes: Buffer, name: string) => new NextResponse(new Uint8Array(bytes), { status: 200, headers: mtmExcelAttachment(name) })

export const GET = withMtmAttendanceAuth("read", async (req, auth) => {
  try {
    const actor = actorOf(auth), params = new URL(req.url).searchParams, lang = locale(params.get("locale"))
    if (params.get("file") === "current") return xlsx(await buildAttendanceImportCurrentList(actor, lang), "employees.xlsx")
    if (params.get("file") === "template") return xlsx(await buildAttendanceImportTemplate(lang), "employees-template.xlsx")
    throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_INVALID", 400)
  } catch (error) { return attendanceRequestFailure(error) }
})

export const POST = withMtmAttendanceAuth("write", async (req, auth) => {
  try {
    const actor = actorOf(auth)
    const length = Number(req.headers.get("content-length") ?? 0)
    if (length > ATTENDANCE_IMPORT_MAX_BYTES + 64 * 1024) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_TOO_LARGE", 413)
    const form = await req.formData().catch(() => null)
    const file = form?.get("file"), action = String(form?.get("action") ?? "")
    if (!(file instanceof File) || !file.name.toLowerCase().endsWith(".xlsx")) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_NOT_XLSX", 415)
    if (file.size <= 0 || file.size > ATTENDANCE_IMPORT_MAX_BYTES) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_TOO_LARGE", 413)
    const bytes = Buffer.from(await file.arrayBuffer())
    if (action === "preview") return attendanceRequestResponse(await previewAttendanceImport(actor, bytes, file.name.slice(0, 255)))
    if (action === "errors") return xlsx(await buildAttendanceImportErrors(actor, bytes, locale(String(form?.get("locale") ?? ""))), "employees-errors.xlsx")
    if (action === "apply") {
      let rows: unknown
      try { rows = JSON.parse(String(form?.get("rows") ?? "")) } catch { rows = null }
      const parsed = Rows.safeParse(rows)
      if (!parsed.success) throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_INVALID", 400)
      return attendanceRequestResponse({ results: await applyAttendanceImport(actor, bytes, parsed.data) })
    }
    throw new AttendanceRequestError("MTM_ATTENDANCE_IMPORT_INVALID", 400)
  } catch (error) { return attendanceRequestFailure(error) }
})
