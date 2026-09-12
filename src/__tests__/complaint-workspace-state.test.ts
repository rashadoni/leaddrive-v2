import { describe, expect, it } from "vitest"

import {
  complaintChildHref,
  complaintRegistryPath,
  complaintScrollStorageKey,
  safeComplaintReturnTo,
} from "@/lib/complaints/workspace-state"

describe("complaint registry navigation state", () => {
  it("serializes the current registry query", () => {
    expect(complaintRegistryPath(new URLSearchParams("q=printer&status=open"))).toBe("/complaints?q=printer&status=open")
    expect(complaintRegistryPath(new URLSearchParams())).toBe("/complaints")
  })

  it("accepts only registry return targets", () => {
    expect(safeComplaintReturnTo("/complaints?q=printer")).toBe("/complaints?q=printer")
    expect(safeComplaintReturnTo("https://attacker.example/complaints")).toBe("/complaints")
    expect(safeComplaintReturnTo("//attacker.example/complaints")).toBe("/complaints")
    expect(safeComplaintReturnTo("/complaints/new")).toBe("/complaints")
    expect(safeComplaintReturnTo("/complaints/id-1")).toBe("/complaints")
  })

  it("threads one safe return target through child routes and scroll storage", () => {
    expect(complaintChildHref("/complaints/id-1", "/complaints?riskLevel=high")).toBe(
      "/complaints/id-1?returnTo=%2Fcomplaints%3FriskLevel%3Dhigh",
    )
    expect(complaintScrollStorageKey("/complaints?riskLevel=high")).toContain("riskLevel=high")
  })
})
