import { createHash, randomBytes } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import ExcelJS from "exceljs"
import { makeScriptPrisma } from "./_rls.mjs"

const REQUIRED_CONFIRMATION = "zeytun-phase1-closeout"
if (process.env.CONFIRM_PROD !== REQUIRED_CONFIRMATION) {
  throw new Error(`Set CONFIRM_PROD=${REQUIRED_CONFIRMATION} to run the scoped production Excel gate`)
}

const organizationId = process.env.PILOT_ORG_ID
const requestedBy = process.env.PILOT_REQUESTED_BY
const validPath = process.env.PILOT_VALID_WORKBOOK
const invalidPath = process.env.PILOT_INVALID_WORKBOOK
const baseUrl = process.env.PILOT_BASE_URL ?? "https://app.leaddrivecrm.org"
const runId = process.env.PILOT_RUN_ID ?? "20260715"
if (!organizationId || !requestedBy || !validPath || !invalidPath) {
  throw new Error("PILOT_ORG_ID, PILOT_REQUESTED_BY, PILOT_VALID_WORKBOOK, and PILOT_INVALID_WORKBOOK are required")
}

const prisma = await makeScriptPrisma({ orgId: organizationId })

const rawKey = `ld_${randomBytes(32).toString("hex")}`
const keyHash = createHash("sha256").update(rawKey).digest("hex")
const apiKey = await prisma.apiKey.create({
  data: {
    organizationId,
    name: `[PILOT-PHASE1-${runId}] one-shot Excel gate`,
    keyHash,
    keyPrefix: rawKey.slice(0, 10),
    scopes: ["read:mtm", "write:mtm"],
    expiresAt: new Date(Date.now() + 15 * 60_000),
    createdBy: requestedBy,
  },
})

const headers = { authorization: `Bearer ${rawKey}` }

async function json(response, expectedStatus) {
  const payload = await response.json().catch(() => ({}))
  if (response.status !== expectedStatus) {
    throw new Error(`Expected HTTP ${expectedStatus}, received ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

async function upload(path, filename) {
  const form = new FormData()
  form.set("type", "CUSTOMERS")
  form.set("file", new Blob([await readFile(path)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }), filename)
  return fetch(`${baseUrl}/api/v1/mtm/excel/imports`, { method: "POST", headers, body: form })
}

try {
  const first = await json(await upload(validPath, `phase1-${runId}-customers.xlsx`), 201)
  const summary = first.data?.summary
  if (summary?.createRows !== 1 || summary?.updateRows !== 1 || summary?.unchangedRows !== 1 || summary?.errorRows !== 0) {
    throw new Error(`Unexpected valid preview summary: ${JSON.stringify(summary)}`)
  }
  const validJobId = first.data.job.id

  const applyFirst = await json(await fetch(`${baseUrl}/api/v1/mtm/excel/imports/${validJobId}/apply`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ allowConflictOverride: false }),
  }), 200)
  if (applyFirst.data?.replayed !== false || applyFirst.data?.status !== "COMPLETED") {
    throw new Error(`Unexpected first apply result: ${JSON.stringify(applyFirst)}`)
  }

  const applyReplay = await json(await fetch(`${baseUrl}/api/v1/mtm/excel/imports/${validJobId}/apply`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ allowConflictOverride: false }),
  }), 200)
  if (applyReplay.data?.replayed !== true) throw new Error("Apply replay was not identified as idempotent")

  const uploadReplay = await json(await upload(validPath, `phase1-${runId}-customers-replay.xlsx`), 200)
  if (uploadReplay.data?.reused !== true || uploadReplay.data?.job?.id !== validJobId) {
    throw new Error(`Upload replay did not reuse the first job: ${JSON.stringify(uploadReplay)}`)
  }

  const exportResponse = await fetch(`${baseUrl}/api/v1/mtm/excel/exports/CUSTOMERS`, { headers })
  if (exportResponse.status !== 200) throw new Error(`Customer export failed with HTTP ${exportResponse.status}`)
  const exportPath = `/tmp/mtm-phase1-${runId}-customers-export.xlsx`
  const exportBytes = Buffer.from(await exportResponse.arrayBuffer())
  await writeFile(exportPath, exportBytes)
  const exported = new ExcelJS.Workbook()
  await exported.xlsx.load(exportBytes)
  const customerSheet = exported.getWorksheet("customers")
  const exportedCodes = []
  customerSheet?.eachRow((row, rowNumber) => {
    if (rowNumber > 1) exportedCodes.push(String(row.getCell(1).value ?? ""))
  })
  if (!exportedCodes.includes("000P10715")) throw new Error("Export did not preserve the leading-zero pilot customer code")

  const invalid = await json(await upload(invalidPath, `phase1-${runId}-customers-invalid.xlsx`), 201)
  const invalidSummary = invalid.data?.summary
  if (invalidSummary?.errorRows !== 1 || (invalid.data?.errors?.length ?? 0) < 3) {
    throw new Error(`Unexpected invalid preview result: ${JSON.stringify(invalidSummary)}`)
  }
  const invalidJobId = invalid.data.job.id
  const errorResponse = await fetch(`${baseUrl}/api/v1/mtm/excel/imports/${invalidJobId}/errors?locale=az`, { headers })
  if (errorResponse.status !== 200) throw new Error(`Error workbook failed with HTTP ${errorResponse.status}`)
  const errorPath = `/tmp/mtm-phase1-${runId}-customers-errors.xlsx`
  const errorBytes = Buffer.from(await errorResponse.arrayBuffer())
  await writeFile(errorPath, errorBytes)
  const errorWorkbook = new ExcelJS.Workbook()
  await errorWorkbook.xlsx.load(errorBytes)
  if (!errorWorkbook.worksheets.some((sheet) => sheet.rowCount >= 4)) {
    throw new Error("Error workbook did not contain actionable row errors")
  }

  const invalidApplyResponse = await fetch(`${baseUrl}/api/v1/mtm/excel/imports/${invalidJobId}/apply`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ allowConflictOverride: false }),
  })
  const invalidApply = await json(invalidApplyResponse, 409)
  if (!String(invalidApply.error ?? "").includes("validation errors")) {
    throw new Error(`Invalid apply did not return the expected validation guard: ${JSON.stringify(invalidApply)}`)
  }

  const history = await json(await fetch(`${baseUrl}/api/v1/mtm/excel/imports`, { headers }), 200)
  const historyIds = new Set((history.data?.jobs ?? []).map((job) => job.id))
  if (!historyIds.has(validJobId) || !historyIds.has(invalidJobId)) throw new Error("Import history omitted one of the pilot jobs")

  console.log(JSON.stringify({
    validJobId,
    validSummary: summary,
    applyReplay: applyReplay.data.replayed,
    uploadReused: uploadReplay.data.reused,
    invalidJobId,
    invalidSummary,
    invalidApplyStatus: invalidApplyResponse.status,
    exportPath,
    exportBytes: exportBytes.length,
    errorPath,
    errorBytes: errorBytes.length,
    apiKeyCleanup: "pending",
  }, null, 2))
} finally {
  await prisma.apiKey.deleteMany({ where: { id: apiKey.id } })
  await prisma.$disconnect()
}
