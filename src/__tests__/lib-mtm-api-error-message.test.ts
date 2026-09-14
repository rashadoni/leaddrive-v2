import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { mtmApiErrorKey } from "@/lib/mtm/api-error-message"

describe("MTM API refusals get a localized explanation", () => {
  it("maps known codes before the status", () => {
    expect(mtmApiErrorKey({ error: "This view needs a field scope", code: "MTM_FIELD_SCOPE_REQUIRED" }, 403)).toBe("fieldScopeRequired")
    expect(mtmApiErrorKey({ code: "MTM_POLICY_SCOPE_FORBIDDEN" }, 403)).toBe("policyScopeForbidden")
    expect(mtmApiErrorKey({ code: "MTM_POLICY_READ_ONLY" })).toBe("policyReadOnly")
    expect(mtmApiErrorKey({ code: "MTM_AGENT_OUT_OF_SCOPE" })).toBe("agentOutOfScope")
  })

  it("falls back by status, then to a generic sentence", () => {
    expect(mtmApiErrorKey({ error: "Forbidden" }, 403)).toBe("forbidden")
    expect(mtmApiErrorKey(null, 401)).toBe("unauthorized")
    expect(mtmApiErrorKey({ code: "SOMETHING_NEW" }, 500)).toBe("generic")
    expect(mtmApiErrorKey("not json")).toBe("generic")
  })

  it("has every key in every language", () => {
    const keys = ["fieldScopeRequired", "agentOutOfScope", "policyAdminRequired", "policyScopeForbidden", "policyReadOnly", "forbidden", "unauthorized", "generic"]
    const missing: string[] = []
    for (const locale of ["en", "ru", "az"]) {
      const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
      for (const key of keys) if (typeof messages.mtmApiErrors?.[key] !== "string") missing.push(`${locale}.${key}`)
    }
    expect(missing).toEqual([])
  })

  it("is used where a web user without a field card used to get English or an empty dropdown", () => {
    const files = [
      "src/app/(dashboard)/mtm/agents/page.tsx",
      "src/app/(dashboard)/mtm/settings/visit-policy-settings.tsx",
      "src/components/mtm/route-form.tsx",
      "src/components/mtm/visit-form.tsx",
      "src/components/mtm/route-planning-matrix.tsx",
      "src/components/mtm/route-builder.tsx",
      "src/components/mtm/task-form.tsx",
      "src/components/mtm/route-week-plan.tsx",
    ]
    const missing = files.filter((file) => !readFileSync(file, "utf8").includes("useMtmApiError()"))
    expect(missing).toEqual([])
    expect(readFileSync(files[0], "utf8")).not.toContain("Failed to load agents")
  })
})
