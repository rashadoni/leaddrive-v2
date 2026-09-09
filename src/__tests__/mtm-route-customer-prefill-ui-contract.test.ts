import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

function source(path: string): string {
  return readFileSync(path, "utf8")
}

describe("MTM customer-to-route prefill UI contract", () => {
  it("keeps the builder open across session reloads and clears stale prefill on close", () => {
    const page = source("src/app/(dashboard)/mtm/routes/page.tsx")

    expect(page).toContain('if (!requestedCustomerId) setBuilderOpen(false)')
    expect(page).toContain('const prefillKey = `${String(orgId ?? "")}:${viewerKey}:${requestedCustomerId}:${requestedContactId ?? ""}`')
    expect(page).toContain('handledCustomerPrefill.current === prefillKey')
    expect(page).toContain('next.delete("customerId")')
    expect(page).toContain('next.delete("contactId")')
    expect(page).toContain('clearCustomerPrefill()')
    expect(page).toContain('initialCustomerId={editData ? null : requestedCustomerId}')
  })

  it("reports a failed customer prefill instead of opening an unexplained empty builder", () => {
    const builder = source("src/components/mtm/route-builder.tsx")

    expect(builder).toContain('signal: controller.signal')
    expect(builder).toContain('throw new Error("PREFILL_CUSTOMER_FAILED")')
    expect(builder).toContain('setPrefillState("error")')
    expect(builder).not.toContain('setError(t("prefillCustomerFailed"))')
    expect(builder).toContain('return () => controller.abort()')
  })

  it("shows loading, success, and recovery states where the customer enters the builder", () => {
    const builder = source("src/components/mtm/route-builder.tsx")

    expect(builder).toContain('data-testid="mtm-route-prefill-status"')
    expect(builder).toContain('setPrefillState(!initialData && initialCustomerId ? "loading" : "idle")')
    expect(builder).toContain('setPrefillState("success")')
    expect(builder).toContain('setPrefillState("error")')
    expect(builder).toContain('t("prefillSuccessHint", { name:')
    expect(builder).toContain('setCustomerPickerOpen(false)')
    expect(builder).toContain('t("addAnotherCustomer")')
  })

  it("merges a late prefill response without erasing customers selected during loading", () => {
    const builder = source("src/components/mtm/route-builder.tsx")

    expect(builder).toContain("const alreadySelected = current.some")
    expect(builder).toContain("? current")
    expect(builder).toContain(": [{ customerId: customer.id, contactId: initialContactId ?? null, customer }, ...current]")
    expect(builder).not.toContain("setStops([{ customerId: customer.id")
  })
})
