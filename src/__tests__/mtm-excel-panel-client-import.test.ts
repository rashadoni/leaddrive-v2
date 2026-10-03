// @vitest-environment jsdom
/**
 * The Excel dialog, as a person loading a client file meets it.
 *
 * The real dialog renders through the real NextIntlClientProvider and the real
 * message files, in all three languages: a plural the formatter cannot parse or
 * a key that resolves to nothing fails here, where check-translations.js —
 * which only compares the languages with each other — sees nothing.
 */
import { act, createElement, type ComponentProps, type FunctionComponent, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { readFileSync } from "fs"
import { afterEach, describe, expect, it, vi } from "vitest"
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl"
import { MtmExcelExchangePanel } from "@/components/mtm/excel-exchange-panel"

const IntlProvider = NextIntlClientProvider as FunctionComponent<
  Omit<ComponentProps<typeof NextIntlClientProvider>, "children"> & { children?: ReactNode }
>

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface ExcelMessages {
  importRestricted: string
  types: Record<string, string>
  previewColumns: Record<string, string>
}

/** What the upload endpoint answers for a checked client file. */
const CHECKED = {
  job: { id: "job-1", status: "READY", originalFileName: "doctors.xlsx" },
  summary: {
    totalRows: 12, createRows: 12, updateRows: 0, unchangedRows: 0, skippedRows: 0, errorRows: 0,
    warningRows: 11, requiresConflictOverride: false, createInstitutions: 3, assignRows: 9,
  },
  preview: [{ rowNumber: 2, externalCode: "TRP.001", displayName: "Səfərov Tural", specialty: "Terapevt", institution: "Sağlam Ailə Klinikası", agent: "Elvin Sahə" }],
  errors: [],
  warnings: Array.from({ length: 8 }, (_, index) => ({ rowNumber: index + 2, code: "NO_INSTITUTION", message: `warning text ${index + 1}` })),
  warningCount: 11,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

let root: Root | null = null

async function settle() {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

async function openPanel(locale: string, importableTypes: string[]) {
  const messages = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as AbstractIntlMessages
  const problems: string[] = []
  const uploads: FormData[] = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      uploads.push(init.body as FormData)
      return json({ success: true, data: CHECKED }, 201)
    }
    return json({ success: true, data: { jobs: [], capabilities: { canImport: importableTypes.includes("CUSTOMERS"), importableTypes } } })
  }))
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(
      IntlProvider,
      { locale, messages, onError: (error) => { problems.push(error.message) } },
      createElement(MtmExcelExchangePanel, { open: true, onClose: () => {}, initialType: "CONTACTS" }),
    ))
  })
  await settle()
  return { own: messages.mtmExcel as unknown as ExcelMessages, problems, uploads }
}

async function chooseFile() {
  const input = document.body.querySelector<HTMLInputElement>("input[type=file]")!
  Object.defineProperty(input, "files", { configurable: true, value: [new File(["x"], "doctors.xlsx")] })
  await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })) })
  await settle()
}

function uploadButton() {
  return document.body.querySelector<HTMLInputElement>("input[type=file]")!.nextElementSibling as HTMLButtonElement
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  vi.unstubAllGlobals()
  document.body.innerHTML = ""
})

describe("Excel dialog: loading clients", () => {
  it.each(["en", "ru", "az"])("shows the checked file in %s: what will be added, what to look at, and no message keys", async (locale) => {
    const { own, problems, uploads } = await openPanel(locale, ["CUSTOMERS", "CONTACTS", "ROUTES", "SALES_FACTS", "PLAN_FACT"])

    const select = document.body.querySelector("select")!
    expect(select.value).toBe("CONTACTS")
    const options = Array.from(select.querySelectorAll("option")).map((option) => option.textContent)
    expect(options.slice(0, 2)).toEqual([own.types.CUSTOMERS, own.types.CONTACTS])
    // Institutions and clients must not read as the same thing.
    expect(own.types.CUSTOMERS).not.toBe(own.types.CONTACTS)

    await chooseFile()
    expect(uploads).toHaveLength(1)
    expect(uploads[0].get("type")).toBe("CONTACTS")
    // The row messages come back in the language the person reads.
    expect(uploads[0].get("locale")).toBe(locale)

    const warnings = document.body.querySelector("[data-testid='mtm-excel-warnings']")!
    expect(warnings.textContent).toContain("11")
    expect(warnings.textContent).toContain("warning text 1")
    expect(warnings.textContent).toContain("warning text 8")
    // Eleven in all, eight listed: the rest is counted, not dropped silently.
    expect(warnings.textContent).toMatch(/3/)
    const extras = document.body.querySelector("[data-testid='mtm-excel-contacts-extras']")!
    expect(extras.textContent).toMatch(/3/)
    expect(extras.textContent).toMatch(/9/)
    const headers = Array.from(document.body.querySelectorAll("th")).map((cell) => cell.textContent)
    expect(headers).toEqual(["rowNumber", "externalCode", "displayName", "specialty", "institution", "agent"].map((key) => own.previewColumns[key]))

    const text = document.body.textContent ?? ""
    expect(text).not.toContain("mtmExcel.")
    expect(problems).toEqual([])
  })

  it("lets a manager without the Excel opt-in load clients, and nothing else", async () => {
    const { own } = await openPanel("en", ["CONTACTS"])

    expect(uploadButton().disabled).toBe(false)
    expect(document.body.textContent).not.toContain(own.importRestricted)

    const select = document.body.querySelector("select")!
    await act(async () => {
      select.value = "CUSTOMERS"
      select.dispatchEvent(new Event("change", { bubbles: true }))
    })
    await settle()

    expect(uploadButton().disabled).toBe(true)
    expect(document.body.textContent).toContain(own.importRestricted)
  })
})
