import { describe, expect, it } from "vitest"
import { saveErrorMessage } from "@/components/mtm/customer-form"

const labels = {
  tc: (key: string) => ({ name: "Название", address: "Адрес", city: "Город", phone: "Телефон", notes: "Примечания", failedToSave: "Ошибка сохранения" } as Record<string, string>)[key] ?? key,
  tf: (key: string) => ({ code: "Код", district: "Район", contactPerson: "Контактное лицо", location: "Локация", invalidFields: "Проверьте поля" } as Record<string, string>)[key] ?? key,
}

describe("organization form — what a refused save says", () => {
  it("names the fields the API rejected instead of printing English prose", () => {
    const message = saveErrorMessage({
      error: "Validation failed",
      details: [
        { path: "address", message: "Too small: expected string to have >=1 characters" },
        { path: "phone", message: "Too small: expected string to have >=1 characters" },
        { path: "contactPerson", message: "Too small: expected string to have >=1 characters" },
      ],
    }, labels)
    expect(message).toBe("Проверьте поля: Адрес, Телефон, Контактное лицо")
  })

  it("collapses both coordinate axes into one name and repeats nothing", () => {
    const message = saveErrorMessage({
      error: "Validation failed",
      details: [{ path: "latitude", message: "x" }, { path: "longitude", message: "y" }],
    }, labels)
    expect(message).toBe("Проверьте поля: Локация")
  })

  it("keeps a specific server sentence when there is one", () => {
    expect(saveErrorMessage({ error: "An organization with this code already exists" }, labels))
      .toBe("An organization with this code already exists")
  })

  it("falls back to the screen's own wording, never to the English marker", () => {
    expect(saveErrorMessage({ error: "Validation failed" }, labels)).toBe("Ошибка сохранения")
    expect(saveErrorMessage(null, labels)).toBe("Ошибка сохранения")
  })
})
