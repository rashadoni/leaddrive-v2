import { describe, it, expect } from "vitest"
import {
  resolveHeaders,
  parseComplaintType,
  parseRiskLevel,
  parseStatus,
  riskToPriority,
  parseDate,
  rowToComplaint,
  complaintToExportRow,
  EXPORT_HEADERS,
} from "@/lib/complaints-mapper"

describe("complaints-mapper", () => {
  describe("resolveHeaders", () => {
    it("resolves the exact Azerbaijani header row from the client template", () => {
      const headers = [
        "Sıra", "Müştərinin ad və soyadı", "Ay", "Il", "Müraciət tarixi",
        "Daxil olan şikayət mənbəyi", "Şikayət və ya təklif", "Marka",
        "İstehsal Sahəsi", "Şikayət və təklif olunan məhsul çeşidi",
        "Şikayət obyekti", "Şikayət obyekti 2", "Əlaqə nömrəsi",
        "Şikayət məzmunu", "Aidiyyatı şöbə (şəxs)", "Cavab", "Status",
        "Önəmlilik dərəcəsi",
      ]
      const r = resolveHeaders(headers)
      expect(r.externalRegistryNumber).toBe(0)
      expect(r.customerName).toBe(1)
      expect(r.requestDate).toBe(4)
      expect(r.source).toBe(5)
      expect(r.complaintType).toBe(6)
      expect(r.brand).toBe(7)
      expect(r.content).toBe(13)
      expect(r.response).toBe(15)
      expect(r.status).toBe(16)
      expect(r.riskLevel).toBe(17)
    })

    it("is case-insensitive and trims whitespace", () => {
      const r = resolveHeaders(["  SIRA ", "MARKA", "cavab"])
      expect(r.externalRegistryNumber).toBe(0)
      expect(r.brand).toBe(1)
      expect(r.response).toBe(2)
    })

    it("accepts Russian/English aliases", () => {
      const r = resolveHeaders(["Номер", "Клиент", "Дата", "Бренд"])
      expect(r.externalRegistryNumber).toBe(0)
      expect(r.customerName).toBe(1)
      expect(r.requestDate).toBe(2)
      expect(r.brand).toBe(3)
    })
  })

  describe("parseComplaintType", () => {
    it.each([
      ["şikayət", "complaint"],
      ["Şikayət", "complaint"],
      ["təklif", "suggestion"],
      ["предложение", "suggestion"],
      ["suggestion", "suggestion"],
      ["", "complaint"],
    ])("%s → %s", (input, expected) => {
      expect(parseComplaintType(input)).toBe(expected)
    })
  })

  describe("parseRiskLevel", () => {
    it("maps orta riskli → medium", () => expect(parseRiskLevel("orta riskli")).toBe("medium"))
    it("maps yüksək riskli → high", () => expect(parseRiskLevel("yüksək riskli")).toBe("high"))
    it("maps aşağı riskli → low", () => expect(parseRiskLevel("aşağı riskli")).toBe("low"))
    it("returns null on empty", () => expect(parseRiskLevel("")).toBeNull())
    it("returns null on unknown", () => expect(parseRiskLevel("xxx")).toBeNull())
  })

  describe("parseStatus", () => {
    it("ok → resolved", () => expect(parseStatus("ok")).toBe("resolved"))
    it("not ok → escalated", () => expect(parseStatus("not ok")).toBe("escalated"))
    it("empty → open", () => expect(parseStatus("")).toBe("open"))
    it("'в работе' → in_progress", () => expect(parseStatus("в работе")).toBe("in_progress"))
  })

  describe("riskToPriority", () => {
    it("high risk → high priority", () => expect(riskToPriority("high")).toBe("high"))
    it("low risk → low priority", () => expect(riskToPriority("low")).toBe("low"))
    it("medium risk → medium priority", () => expect(riskToPriority("medium")).toBe("medium"))
    it("null risk → medium (default)", () => expect(riskToPriority(null)).toBe("medium"))
  })

  describe("parseDate", () => {
    it("passes Date through", () => {
      const d = new Date("2026-02-06")
      expect(parseDate(d)).toEqual(d)
    })
    it("parses ISO strings", () => {
      const d = parseDate("2026-02-06")
      expect(d).toBeInstanceOf(Date)
      expect(d?.getUTCFullYear()).toBe(2026)
    })
    it("parses Excel serial numbers", () => {
      // 46054 = 2026-02-06 in Excel 1900 system
      const d = parseDate(46054)
      expect(d?.getUTCFullYear()).toBe(2026)
      expect(d?.getUTCMonth()).toBe(1) // February
    })
    it("returns null on garbage", () => {
      expect(parseDate("not a date")).toBeNull()
      expect(parseDate(null)).toBeNull()
    })
  })

  describe("rowToComplaint — end-to-end mapping of a real client row", () => {
    const headers = resolveHeaders([
      "Sıra", "Müştərinin ad və soyadı", "Ay", "Il", "Müraciət tarixi",
      "Daxil olan şikayət mənbəyi", "Şikayət və ya təklif", "Marka",
      "İstehsal Sahəsi", "Şikayət və təklif olunan məhsul çeşidi",
      "Şikayət obyekti", "Şikayət obyekti 2", "Əlaqə nömrəsi",
      "Şikayət məzmunu", "Aidiyyatı şöbə (şəxs)", "Cavab", "Status",
      "Önəmlilik dərəcəsi",
    ])

    it("maps row 254 (high-risk foreign object) correctly", () => {
      const row = [
        254, "Adı qeyd olunmayan", "Fevral", 2026, new Date("2026-02-02"),
        "Satış nümayəndəsi", "Şikayət", "Çörəkçi", "Çörəkçi", "Baton ekstra",
        "Keyfiyyət", "yad cisim aşkarlanma", "055-795-65-28",
        "Yad cismin olması iddia edilir", "Keyfiyyət nəzarət şöbəsi",
        "Müştəri ilə əlaqə saxlanıldı", "not ok", "yüksək riskli",
      ]
      const c = rowToComplaint(row, headers)
      expect(c).not.toBeNull()
      expect(c!.externalRegistryNumber).toBe(254)
      expect(c!.customerName).toBe("Adı qeyd olunmayan")
      expect(c!.source).toBe("sales_rep")
      expect(c!.complaintType).toBe("complaint")
      expect(c!.brand).toBe("Çörəkçi")
      expect(c!.productCategory).toBe("Baton ekstra")
      expect(c!.riskLevel).toBe("high")
      expect(c!.priority).toBe("high")
      expect(c!.status).toBe("escalated")
      expect(c!.phone).toBe("055-795-65-28")
    })

    it("maps Qaynar xətt source → hotline", () => {
      const row = [250, "X", null, null, null, "Qaynar xətt", "şikayət", "Çörəkçi", null, null, null, null, null, "content", null, null, "ok", "orta riskli"]
      const c = rowToComplaint(row, headers)
      expect(c!.source).toBe("hotline")
      expect(c!.status).toBe("resolved")
      expect(c!.riskLevel).toBe("medium")
    })

    it("maps e-poçt source → email", () => {
      const row = [252, "X", null, null, null, "e-poçt vasitəsilə", "şikayət", "Çörəkçi", null, null, null, null, null, "content", null, null, "ok", "orta riskli"]
      const c = rowToComplaint(row, headers)
      expect(c!.source).toBe("email")
    })

    it("skips empty rows", () => {
      const row = [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null]
      expect(rowToComplaint(row, headers)).toBeNull()
    })
  })

  describe("complaintToExportRow", () => {
    it("produces a row shaped exactly like the source template", () => {
      const row = complaintToExportRow({
        externalRegistryNumber: 250,
        customerName: "Nicat",
        requestDate: new Date(Date.UTC(2026, 1, 6)),
        source: "hotline",
        complaintType: "complaint",
        brand: "Çörəkçi",
        productionArea: "Çörəkçi",
        productCategory: "Kruassan",
        complaintObject: "Qiymət artımı",
        complaintObjectDetail: "Qiymət artımı",
        phone: "055 775 45 44",
        content: "Müştəri narazıdır",
        responsibleDepartment: "Marketing",
        response: "cavab mətni",
        status: "resolved",
        riskLevel: "medium",
        priority: "medium",
      })
      expect(row).toHaveLength(EXPORT_HEADERS.length)
      expect(row[0]).toBe(250)
      expect(row[2]).toBe("Fevral")
      expect(row[3]).toBe(2026)
      expect(row[6]).toBe("şikayət")
      expect(row[16]).toBe("ok")
      expect(row[17]).toBe("orta riskli")
    })

    it("maps suggestion + escalated + high correctly", () => {
      const row = complaintToExportRow({
        externalRegistryNumber: null, customerName: null, requestDate: null,
        source: null, complaintType: "suggestion",
        brand: null, productionArea: null, productCategory: null,
        complaintObject: null, complaintObjectDetail: null, phone: null,
        content: "x", responsibleDepartment: null, response: null,
        status: "escalated", riskLevel: "high", priority: "high",
      })
      expect(row[6]).toBe("təklif")
      expect(row[16]).toBe("not ok")
      expect(row[17]).toBe("yüksək riskli")
    })
  })
})
