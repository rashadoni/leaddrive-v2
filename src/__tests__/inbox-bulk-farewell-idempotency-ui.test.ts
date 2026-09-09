import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const page = readFileSync("src/app/(dashboard)/inbox/page.tsx", "utf8")
const en = readFileSync("messages/en.json", "utf8")
const ru = readFileSync("messages/ru.json", "utf8")

describe("bulk farewell idempotency UI contract", () => {
  it("keeps one client operationId across a transport retry", () => {
    expect(page).toContain("bulkCloseOperationIdRef")
    expect(page).toContain("bulkCloseOperationIdRef.current = crypto.randomUUID()")
    expect(page).toContain("const operationId = bulkCloseOperationIdRef.current ?? crypto.randomUUID()")
    expect(page).toContain("operationId,")
  })

  it("closes the action UI after an explicit delivery-unknown result and says not to resend", () => {
    expect(page).toMatch(/bulkDeliveryUnknown[\s\S]*bulkCloseOperationIdRef\.current = null[\s\S]*setBulkCloseOpen\(false\)/)
    expect(en).toContain("Check Chatwoot and do not send the farewell again")
    expect(ru).toContain("Проверьте Chatwoot и не отправляйте сообщение повторно")
  })
})
