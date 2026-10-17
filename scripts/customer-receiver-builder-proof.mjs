/** Targeted component smoke, synthetic local API. No Next build or ERP traffic. */
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createServer } from "vite"
import { chromium } from "playwright"

const root = process.cwd()
const temporary = await mkdtemp(path.join(tmpdir(), "receiver-builder-proof-"))
const output = path.resolve(process.argv[2] ?? path.join(temporary, "evidence"))
await mkdir(output, { recursive: true })
await writeFile(path.join(temporary, "index.html"), '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Receiver builder proof</title></head><body style="margin:0;padding:24px;background:#f3f4f7;font-family:sans-serif"><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>')
await writeFile(path.join(temporary, "main.tsx"), 'import {createRoot} from "react-dom/client"; import {ReceiverBuilder} from "@/components/settings/receiver-builder"; const locale=new URLSearchParams(location.search).get("locale")||"ru"; createRoot(document.getElementById("root")!).render(<ReceiverBuilder locale={locale as "ru"|"en"|"az"}/>);')
await writeFile(path.join(temporary, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", target: "ES2022" } }))

const server = await createServer({ configFile: false, root: temporary,
  plugins: [{ name: "receiver-proof-api", configureServer(instance) { instance.middlewares.use(apiMiddleware) } }],
  resolve: { alias: { "@": path.join(root, "src"), "react": path.join(root, "node_modules/react"), "react-dom": path.join(root, "node_modules/react-dom") } },
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root, temporary, path.resolve(root, "node_modules")] } },
})
const { defaultBuilderProfile, builderProfileSchema } = await server.ssrLoadModule(path.join(root, "src/lib/integrations/customer-receiver/constructor/profile.ts"))
const { previewBuilderResource, syntheticBuilderInput } = await server.ssrLoadModule(path.join(root, "src/lib/integrations/customer-receiver/constructor/engine.ts"))
const { BUILDER_FIELDS } = await server.ssrLoadModule(path.join(root, "src/lib/integrations/customer-receiver/constructor/catalog.ts"))
const { RECEIVER_COPY } = await server.ssrLoadModule(path.join(root, "src/components/settings/receiver-builder-copy.ts"))
const { exportBuilderAudit } = await server.ssrLoadModule(path.join(root, "src/lib/integrations/customer-receiver/constructor/audit-export.ts"))
const { buildReceivingApiProposal } = await server.ssrLoadModule(path.join(root, "src/lib/integrations/customer-receiver/constructor/api-proposal.ts"))
let drafts = [], previews = 0, saves = 0, exports = 0
async function apiMiddleware(request, response, next) {
  if (request.url === "/receiver-proof/bump") { if (drafts[0]) drafts[0].revision += 1; response.end("ok"); return }
  if (request.url.startsWith("/api/v1/integrations/customer-receiver/logs?")) {
    const parameters = new URL(request.url, "http://localhost").searchParams
    const result = exportBuilderAudit({ organizationId: "org-demo", environment: parameters.get("environment"), from: parameters.get("from"), to: parameters.get("to"), generatedAt: new Date().toISOString(), rows: [{ id: "audit-demo", organizationId: "org-demo", userId: "user-demo", action: "receiver_draft_created", entityType: "receiver_draft", entityId: "draft-1", newValue: { environment: parameters.get("environment") }, createdAt: new Date(Date.now() - 1000) }] })
    response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify({ success: true, data: result })); return
  }
  if (request.url !== "/api/v1/integrations/customer-receiver") { next(); return }
  response.setHeader("Content-Type", "application/json")
  const send = (status, value) => { response.statusCode = status; response.end(JSON.stringify(value)) }
  if (request.method === "GET") { send(200, { success: true, data: { drafts, fields: BUILDER_FIELDS, defaultProfile: defaultBuilderProfile(), hasMore: false, externalSendingAvailable: false } }); return }
  try {
    let body = ""; for await (const chunk of request) { body += chunk; if (Buffer.byteLength(body) > 256 * 1024) { send(413, {}); return } }
    const input = JSON.parse(body), parsed = builderProfileSchema.safeParse(input.profile)
    if (!parsed.success) { send(400, {}); return }
    if (input.action === "preview") {
      previews += 1
      try { send(200, { success: true, data: previewBuilderResource({ profile: parsed.data, resource: input.resource, ...syntheticBuilderInput("org-demo", input.resource, input.sample) }) }) }
      catch { send(422, {}) }
      return
    }
    if (input.action === "export_profile" || input.action === "export_contract") {
      exports += 1
      send(200, { success: true, data: input.action === "export_contract" ? buildReceivingApiProposal(parsed.data) : parsed.data }); return
    }
    const existing = drafts.find((entry) => entry.id === input.id)
    if ((existing?.revision ?? 0) !== input.expectedRevision) { send(409, {}); return }
    const history = existing ? [{ revision: existing.revision, profile: existing.profile, recordedAt: existing.updatedAt }, ...(existing.history ?? [])].slice(0, 20) : []
    const draft = { id: existing?.id ?? `draft-${drafts.length + 1}`, revision: input.expectedRevision + 1, profile: parsed.data, history, updatedAt: new Date().toISOString() }
    drafts = [draft, ...drafts.filter((entry) => entry.id !== draft.id)]; saves += 1
    send(existing ? 200 : 201, { success: true, data: draft })
  } catch { send(400, {}) }
}

let browser
try {
  await server.listen()
  const address = server.httpServer.address()
  const origin = `http://127.0.0.1:${address.port}`
  browser = await chromium.launch({ headless: true, ...(process.env.RECEIVER_PROOF_BROWSER ? { executablePath: process.env.RECEIVER_PROOF_BROWSER } : {}) })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } })
  const consoleErrors = [], externalRequests = []
  page.on("pageerror", (error) => consoleErrors.push(error.message))
  page.on("request", (request) => { if (!request.url().startsWith(origin) && !request.url().startsWith("blob:")) externalRequests.push(request.url()) })
  const c = RECEIVER_COPY.ru
  await page.goto(origin)
  await page.getByRole("button", { name: c.preview, exact: true }).waitFor()
  await page.waitForFunction(() => !document.querySelector(".rb-preview button").disabled)
  await page.getByRole("button", { name: c.preview, exact: true }).click()
  await page.locator(".rb-preview pre").filter({ hasText: "DEMO CUSTOMER" }).waitFor()
  await page.getByLabel(c.name, { exact: true }).fill("AAC / Constructor proof")
  await page.getByRole("button", { name: c.save, exact: true }).click()
  await page.getByRole("status").filter({ hasText: c.saved }).waitFor()
  await page.getByRole("tab", { name: c.data, exact: true }).focus()
  await page.keyboard.press("ArrowRight")
  assert.equal(await page.getByRole("tab", { name: c.rules, exact: true }).getAttribute("aria-selected"), "true")
  await page.getByRole("tab", { name: c.data, exact: true }).click()
  await page.getByLabel(c.resource, { exact: true }).first().selectOption("deals")
  await page.getByLabel(c.sample, { exact: true }).selectOption("precision")
  await page.getByRole("button", { name: c.preview, exact: true }).click()
  await page.getByRole("alert").filter({ hasText: c.sampleFailure }).waitFor()
  await page.getByLabel(c.scale, { exact: true }).fill("4")
  await page.getByRole("button", { name: c.preview, exact: true }).click()
  await page.locator(".rb-preview pre").filter({ hasText: "1500.1234" }).waitFor()
  await page.screenshot({ path: path.join(output, "desktop.png") })
  await page.request.get(origin + "/receiver-proof/bump")
  await page.getByRole("button", { name: c.save, exact: true }).click()
  await page.getByRole("alert").filter({ hasText: c.conflict }).waitFor()
  page.on("dialog", (dialog) => dialog.accept())
  await page.getByRole("button", { name: c.retry, exact: true }).click()
  await page.waitForFunction(() => document.querySelector(".rb-version").textContent.includes("2"))
  await page.getByLabel(c.name, { exact: true }).fill("Updated profile")
  await page.getByRole("button", { name: c.save, exact: true }).click()
  await page.waitForFunction(() => document.querySelector(".rb-version").textContent.includes("3"))
  await page.getByLabel(c.history, { exact: true }).selectOption("2")
  assert.equal(await page.getByLabel(c.name, { exact: true }).inputValue(), "AAC / Constructor proof")
  await page.getByRole("button", { name: c.save, exact: true }).click()
  await page.waitForFunction(() => document.querySelector(".rb-version").textContent.includes("4"))
  await page.getByRole("tab", { name: c.review, exact: true }).click()
  await page.getByRole("button", { name: c.logExport, exact: true }).click()
  await page.getByRole("link", { name: "security-events.jsonl", exact: true }).waitFor()
  assert.equal(await page.getByRole("link", { name: "manifest.json", exact: true }).count(), 1)
  const downloadPromise = page.waitForEvent("download")
  await page.getByRole("button", { name: c.export, exact: true }).click()
  assert.equal((await downloadPromise).suggestedFilename(), "receiver-profile.json")
  const contractDownload = page.waitForEvent("download")
  await page.getByRole("button", { name: c.contractExport, exact: true }).click()
  const contract = await contractDownload
  assert.equal(contract.suggestedFilename(), "receiver-openapi-proposal.json")
  const contractText = await readFile(await contract.path(), "utf8")
  const proposal = JSON.parse(contractText)
  assert.equal(proposal.openapi, "3.1.0")
  assert.equal(proposal["x-leaddrive-operational"], false)
  assert.equal(proposal.servers, undefined)
  await writeFile(path.join(output, "receiver-openapi-proposal.json"), contractText)
  await page.locator('input[type="file"]').setInputFiles({ name: "invalid-profile.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...defaultBuilderProfile(), lifecycle: "active" })) })
  await page.getByRole("alert").filter({ hasText: c.invalid }).waitFor()
  await page.getByRole("tab", { name: c.data, exact: true }).click()
  await page.setViewportSize({ width: 390, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "phone overflow")
  await page.screenshot({ path: path.join(output, "phone.png") })
  await page.getByRole("tab", { name: c.review, exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "phone audit links overflow")
  for (const locale of ["en", "az"]) {
    await page.goto(origin + `/?locale=${locale}`)
    await page.getByRole("heading", { name: RECEIVER_COPY[locale].title, exact: true }).waitFor()
    await page.waitForFunction(() => !document.querySelector(".rb-preview button").disabled)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${locale} phone overflow`)
  }
  assert.deepEqual(consoleErrors, [])
  assert.deepEqual(externalRequests, [])
  const evidence = { mode: "standalone_actual_component_with_synthetic_local_api", databaseChecked: false, actualErpConnectionChecked: false, passed: true, locales: ["ru", "en", "az"], desktop: "1440x1050", phone: "390x900", checks: ["preview", "draft_save", "keyboard_tabs", "precision_rejection_and_override", "stale_revision_recovery", "history_restore_as_new_revision", "audit_jsonl_schema_manifest_links", "profile_export", "api_contract_download", "active_profile_import_rejected", "phone_no_overflow", "no_external_requests"], saves, previews, exports, consoleErrors, externalRequests }
  await writeFile(path.join(output, "result.json"), JSON.stringify(evidence, null, 2) + "\n")
  console.log(JSON.stringify(evidence))
} catch (error) {
  const page = browser?.contexts()[0]?.pages()[0]
  if (page) {
    await page.screenshot({ path: path.join(output, "failure.png") })
    await writeFile(path.join(output, "failure.json"), JSON.stringify({ error: String(error), visibleText: await page.locator("body").innerText() }, null, 2))
  }
  throw error
} finally {
  await browser?.close(); await server.close()
  if (!output.startsWith(temporary + path.sep)) await rm(temporary, { recursive: true, force: true })
}
