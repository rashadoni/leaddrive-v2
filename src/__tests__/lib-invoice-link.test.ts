/**
 * Shared invoice→profile linkage helpers — the contract both the CDP
 * materializer and the read route depend on. The headline case is the
 * slice-1 P2 fix: a profile that absorbed multiple contacts must collect
 * invoices from ALL its contact sources, not just primaryContactId.
 */
import { describe, expect, it } from "vitest"
import {
  buildInvoiceLinkMaps,
  linkIds,
  resolveInvoiceProfileId,
  type ProfileLinkRow,
} from "@/lib/unified-profile/invoice-link"

describe("buildInvoiceLinkMaps", () => {
  it("maps EVERY contact source to its profile (multi-contact merge — P2 fix)", () => {
    const profiles: ProfileLinkRow[] = [
      {
        id: "p1",
        primaryContactId: "c1",
        primaryCompanyId: null,
        sources: [
          { sourceType: "contact", sourceId: "c1" },
          { sourceType: "contact", sourceId: "c2" }, // merged second contact
          { sourceType: "web_chat_session", sourceId: "wc1" }, // not invoice-linkable
        ],
      },
    ]
    const maps = buildInvoiceLinkMaps(profiles)
    // both c1 AND c2 resolve to p1 — the undercount fix
    expect(maps.contactToProfile.get("c1")).toBe("p1")
    expect(maps.contactToProfile.get("c2")).toBe("p1")
    // web_chat_session source id is NOT treated as a contact id
    expect(maps.contactToProfile.has("wc1")).toBe(false)
  })

  it("maps companies via primaryCompanyId", () => {
    const maps = buildInvoiceLinkMaps([
      { id: "p1", primaryContactId: null, primaryCompanyId: "co1", sources: [] },
    ])
    expect(maps.companyToProfile.get("co1")).toBe("p1")
  })

  it("linkIds returns the distinct contact + company ids for the OR filter", () => {
    const maps = buildInvoiceLinkMaps([
      {
        id: "p1",
        primaryContactId: "c1",
        primaryCompanyId: "co1",
        sources: [{ sourceType: "contact", sourceId: "c2" }],
      },
    ])
    const { contactIds, companyIds } = linkIds(maps)
    expect(contactIds.sort()).toEqual(["c1", "c2"])
    expect(companyIds).toEqual(["co1"])
  })
})

describe("resolveInvoiceProfileId", () => {
  const maps = buildInvoiceLinkMaps([
    {
      id: "p1",
      primaryContactId: "c1",
      primaryCompanyId: null,
      sources: [{ sourceType: "contact", sourceId: "c2" }],
    },
    { id: "p2", primaryContactId: null, primaryCompanyId: "co2", sources: [] },
  ])

  it("resolves by either the primary or a merged contact", () => {
    expect(resolveInvoiceProfileId({ contactId: "c1", companyId: null }, maps)).toBe("p1")
    expect(resolveInvoiceProfileId({ contactId: "c2", companyId: null }, maps)).toBe("p1")
  })

  it("resolves by company when no contact match", () => {
    expect(resolveInvoiceProfileId({ contactId: null, companyId: "co2" }, maps)).toBe("p2")
  })

  it("prefers contact over company (no double-count)", () => {
    // invoice has both a known contact (→p1) and a known company (→p2): contact wins
    expect(resolveInvoiceProfileId({ contactId: "c1", companyId: "co2" }, maps)).toBe("p1")
  })

  it("returns undefined when neither side maps", () => {
    expect(resolveInvoiceProfileId({ contactId: "unknown", companyId: "unknown" }, maps)).toBeUndefined()
  })
})
