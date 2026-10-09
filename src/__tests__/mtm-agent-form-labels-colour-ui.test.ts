// @vitest-environment jsdom
/**
 * Labels («метки») and the map colour on an employee's card, as a manager
 * meets them in the form (owner, 2026-10-09).
 *
 * The form is filled from the row of the employee list, and the server saves
 * exactly what it is sent. That is the trap these tests stand on: a form that
 * sent back the labels of a row it opened minutes ago — or of a row that never
 * carried them — would wipe what another manager had set, the next time
 * somebody corrected a phone number. So the labels and the colour leave the
 * form only when this form changed them.
 *
 * The real form, rendered with the Russian copy; only the network is stubbed.
 */
import { act, createElement, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { MTM_AGENT_MAP_COLOR_KEYS, MTM_AGENT_TAG_MAX_COUNT, MTM_AGENT_TAG_MAX_LENGTH } from "@/lib/mtm/agent-tags"

type Catalog = { [key: string]: string | Catalog }
const catalog = (locale: string) => JSON.parse(readFileSync(`messages/${locale}.json`, "utf8")) as Catalog
const ru = catalog("ru")

/** The Russian text for a key, with `{placeholders}` filled; a missing key comes back as the raw key. */
function message(namespace: string, key: string, values: Record<string, string | number> = {}): string {
  let node: string | Catalog | undefined = ru[namespace]
  for (const part of key.split(".")) node = typeof node === "object" ? node[part] : undefined
  if (typeof node !== "string") return `${namespace}.${key}`
  return node.replace(/\{(\w+)\}/g, (placeholder, name: string) => (name in values ? String(values[name]) : placeholder))
}

vi.mock("next-intl", () => ({
  useTranslations: (namespace: string) => (key: string, values?: Record<string, string | number>) =>
    message(namespace, key, values),
}))

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
    open ? createElement("div", null, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
  DialogTitle: ({ children }: { children?: ReactNode }) => createElement("h2", null, children),
  DialogFooter: ({ children }: { children?: ReactNode }) => createElement("div", null, children),
}))

import { MtmAgentForm } from "@/components/mtm/agent-form"

type Card = {
  id: string
  name: string
  email: string
  phone: string
  externalCode: string
  role: string
  status: string
  canPlanOwnRoutes: boolean
  canSelfPublishRoutes: boolean
  managerId: null
  tags?: string[]
  mapColor?: string | null
}

const CARD: Card = {
  id: "agent-1",
  name: "Field Agent",
  email: "agent@example.com",
  phone: "+10000000000",
  externalCode: "AG-001",
  role: "AGENT",
  status: "ACTIVE",
  canPlanOwnRoutes: true,
  canSelfPublishRoutes: false,
  managerId: null,
  tags: ["стажёр", "ночная смена"],
  mapColor: "teal",
}

let root: Root
let container: HTMLDivElement
const fetchMock = vi.fn()
const onSaved = vi.fn()
const onOpenChange = vi.fn()

/** `card: null` is the «Добавить агента» form; by default the labelled card is opened. */
async function show(card: Card | null = CARD) {
  await act(async () => {
    root.render(createElement(MtmAgentForm, { open: true, onOpenChange, onSaved, initialData: card ?? undefined }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
}

/** The employee list the form reads for the manager select — and for the labels already in use. */
function colleagues(agents: Array<{ id: string; name: string; tags?: string[] }>) {
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, data: { agents } }) })
}

const field = (id: string) => container.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement
const labelField = () => field("agent-tags")
const removeButtons = () => [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="Убрать метку"]')]
/** The labels on the card, as the manager reads them. */
const labels = () => removeButtons().map((button) => button.parentElement?.textContent)
const colourButtons = () => [...container.querySelectorAll<HTMLButtonElement>('[role="group"] button')]
const colourName = (button: HTMLButtonElement) => button.getAttribute("aria-label") ?? button.textContent
/** What the form says aloud about the labels field — the reason a label was not added, or nothing. */
const alertText = () => container.querySelector('[role="alert"]')?.textContent ?? null
/** The colour the form shows as chosen, in the manager's words. */
const chosenColour = () => colourButtons().filter((button) => button.getAttribute("aria-pressed") === "true").map(colourName)
const colourButton = (name: string) => colourButtons().find((button) => colourName(button) === name) as HTMLButtonElement

async function type(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

/** Presses Enter in the label field; answers whether the browser was told not to submit the form. */
async function pressEnter() {
  let submitPrevented = false
  await act(async () => {
    submitPrevented = !labelField().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }))
  })
  return submitPrevented
}

async function click(button: HTMLButtonElement) {
  await act(async () => { button.click() })
}

async function save() {
  await act(async () => {
    container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
}

/** Every write the form made: method, address and the body as it left the browser. */
const writes = () => fetchMock.mock.calls
  .map(([url, init]) => ({ url: String(url), init: init as { method?: string; body?: string } | undefined }))
  .filter(({ init }) => init?.method === "PUT" || init?.method === "POST")
  .map(({ url, init }) => ({ method: init?.method, url, body: JSON.parse(init?.body ?? "{}") as Record<string, unknown> }))
const lastWrite = () => writes()[writes().length - 1]

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  fetchMock.mockReset()
  onSaved.mockReset()
  onOpenChange.mockReset()
  colleagues([])
  vi.stubGlobal("fetch", fetchMock)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  container.remove()
  vi.unstubAllGlobals()
})

describe("agent card — the labels a manager puts on an employee", () => {
  it("opens with the labels the card has, and saving another field leaves the labels and the colour out of what is sent", async () => {
    await show()
    expect(labels()).toEqual(["стажёр", "ночная смена"])

    await type(field("phone"), "+10000000001")
    await save()

    expect(writes().map(({ method, url }) => [method, url])).toEqual([["PUT", "/api/v1/mtm/agents/agent-1"]])
    expect(lastWrite().body).toMatchObject({ phone: "+10000000001" })
    // The row this form was opened from may be minutes old. Sent back, its
    // labels would erase what another manager set since; left out, the server
    // keeps what the card has now.
    expect(Object.keys(lastWrite().body)).not.toContain("tags")
    expect(Object.keys(lastWrite().body)).not.toContain("mapColor")
  })

  it("does not send labels that were added and taken off again — the card is as it was opened", async () => {
    await show()

    await type(labelField(), "резерв")
    await pressEnter()
    await click(removeButtons().find((button) => button.getAttribute("aria-label") === "Убрать метку «резерв»") as HTMLButtonElement)
    await save()

    expect(Object.keys(lastWrite().body)).not.toContain("tags")
  })

  it("adds what is typed on Enter — without saving the card half-way — and on a comma", async () => {
    await show()

    await type(labelField(), "  резерв ")
    expect(await pressEnter()).toBe(true)
    expect(labels()).toEqual(["стажёр", "ночная смена", "резерв"])
    expect(labelField().value).toBe("")

    await type(labelField(), "2-я смена,")
    expect(labels()).toEqual(["стажёр", "ночная смена", "резерв", "2-я смена"])
    expect(labelField().value).toBe("")
    // Nothing has been saved yet: the chips are the form's, not the card's.
    expect(writes()).toEqual([])

    await save()
    expect(lastWrite().body.tags).toEqual(["стажёр", "ночная смена", "резерв", "2-я смена"])
  })

  it("takes several labels pasted with commas and keeps the unfinished one in the field", async () => {
    await show({ ...CARD, tags: [] })

    await type(labelField(), "резерв, выездной, ноч")

    expect(labels()).toEqual(["резерв", "выездной"])
    expect(labelField().value).toBe("ноч")
  })

  it("takes a pasted list that is longer than one label may be — the limit is per label, not for the field", async () => {
    await show({ ...CARD, tags: [] })
    // A browser applies an input's maxlength to the whole pasted text: with
    // the field capped at one label's length this list arrived as «стажёр,
    // ночная смена, ре», and «ре» was saved as a label. jsdom does not cut,
    // so the cap itself is what can be pinned here.
    expect(labelField().hasAttribute("maxlength")).toBe(false)

    const pasted = "стажёр, ночная смена, резерв"
    expect(pasted.length).toBeGreaterThan(MTM_AGENT_TAG_MAX_LENGTH)
    await type(labelField(), pasted)

    expect(labels()).toEqual(["стажёр", "ночная смена"])
    expect(labelField().value).toBe("резерв")
    expect(alertText()).toBeNull()

    await save()
    expect(lastWrite().body.tags).toEqual(["стажёр", "ночная смена", "резерв"])
  })

  it("saves a label that was typed but not yet turned into a chip — it is on the screen", async () => {
    await show()
    await type(labelField(), "резерв")

    await save()

    expect(lastWrite().body.tags).toEqual(["стажёр", "ночная смена", "резерв"])
  })

  it("removes a label with its × button, and only that one", async () => {
    await show()

    await click(removeButtons().find((button) => button.getAttribute("aria-label") === "Убрать метку «стажёр»") as HTMLButtonElement)
    expect(labels()).toEqual(["ночная смена"])

    await save()
    expect(lastWrite().body.tags).toEqual(["ночная смена"])
  })

  it("sends an empty list when the last label is removed, so the card really loses it", async () => {
    await show({ ...CARD, tags: ["стажёр"] })

    await click(removeButtons()[0])
    await save()

    expect(lastWrite().body.tags).toEqual([])
  })

  it("does not add the same label twice, whatever the case it is typed in", async () => {
    await show()

    await type(labelField(), "СТАЖЁР")
    await pressEnter()

    expect(labels()).toEqual(["стажёр", "ночная смена"])
    expect(labelField().value).toBe("")
  })

  it("refuses a label that could start a spreadsheet formula, says why, and saves nothing until it is corrected", async () => {
    await show()

    await type(labelField(), "=СУММ")
    await pressEnter()

    expect(labels()).toEqual(["стажёр", "ночная смена"])
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Метка начинается с буквы или цифры")
    // What was typed stays where it can be corrected.
    expect(labelField().value).toBe("=СУММ")

    await save()
    expect(writes()).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()

    await type(labelField(), "сумма")
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await save()
    expect(lastWrite().body.tags).toEqual(["стажёр", "ночная смена", "сумма"])
  })

  it("closes the field at ten labels and says how to add another", async () => {
    const ten = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT }, (_, index) => `группа ${index + 1}`)
    await show({ ...CARD, tags: ten })

    expect(labels()).toEqual(ten)
    expect(labelField().disabled).toBe(true)
    expect(container.textContent).toContain(`Меток уже ${MTM_AGENT_TAG_MAX_COUNT} — больше нельзя`)
    // A full card is not a mistake: said quietly, not as an alert.
    expect(alertText()).toBeNull()

    await click(removeButtons()[0])
    expect(labelField().disabled).toBe(false)
    expect(container.textContent).not.toContain("больше нельзя")
  })

  it("keeps the field open when a pasted list fills the card and leaves a word behind, and says why the save stops", async () => {
    const eight = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT - 2 }, (_, index) => `группа ${index + 1}`)
    await show({ ...CARD, tags: eight })

    await type(labelField(), "икс, игрек, зет")

    expect(labels()).toEqual([...eight, "икс", "игрек"])
    expect(labelField().value).toBe("зет")
    // The word cannot become a label, so it has to stay deletable.
    expect(labelField().disabled).toBe(false)
    expect(alertText()).toContain(`Меток может быть не больше ${MTM_AGENT_TAG_MAX_COUNT}`)

    await save()
    expect(writes()).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()
    expect(alertText()).toContain("Уберите лишнее из поля")

    await type(labelField(), "")
    expect(alertText()).toBeNull()
    await save()
    expect(lastWrite().body.tags).toEqual([...eight, "икс", "игрек"])
  })

  it("does not say «there are already ten» to a card with nine labels and two more pasted", async () => {
    const nine = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT - 1 }, (_, index) => `группа ${index + 1}`)
    await show({ ...CARD, tags: nine })

    await type(labelField(), "икс, игрек,")

    // All or nothing: the card is not filled with a part of the list behind the manager's back.
    expect(labels()).toEqual(nine)
    expect(labelField().value).toBe("икс, игрек,")
    expect(container.textContent).not.toContain(`Меток уже ${MTM_AGENT_TAG_MAX_COUNT}`)
    expect(alertText()).toContain(`Меток может быть не больше ${MTM_AGENT_TAG_MAX_COUNT}`)

    await save()
    expect(writes()).toEqual([])
  })

  it("says that a label is too long — in those words, while it is typed — and adds nothing until it is shortened", async () => {
    await show()
    const fits = "а".repeat(MTM_AGENT_TAG_MAX_LENGTH)

    await type(labelField(), `${fits}а`)
    expect(alertText()).toContain(`Метка не может быть длиннее ${MTM_AGENT_TAG_MAX_LENGTH} знаков`)
    // Not the text about letters and signs: nothing is wrong with the characters.
    expect(alertText()).not.toContain("начинается с буквы")

    await pressEnter()
    expect(labels()).toEqual(["стажёр", "ночная смена"])
    // Not cut to fit: what was typed stays where it can be shortened.
    expect(labelField().value).toBe(`${fits}а`)
    await save()
    expect(writes()).toEqual([])
    expect(onSaved).not.toHaveBeenCalled()

    await type(labelField(), fits)
    expect(alertText()).toBeNull()
    await pressEnter()
    expect(labels()).toEqual(["стажёр", "ночная смена", fits])
  })

  it("says the same of a too long label inside a pasted list, and adds none of the list", async () => {
    await show({ ...CARD, tags: [] })
    const pasted = `резерв, ${"б".repeat(MTM_AGENT_TAG_MAX_LENGTH + 1)}, выездной`

    await type(labelField(), pasted)

    expect(labels()).toEqual([])
    expect(labelField().value).toBe(pasted)
    expect(alertText()).toContain("Метка не может быть длиннее")
  })

  it("takes a label in the spelling colleagues already carry, however it was typed", async () => {
    colleagues([
      { id: "agent-1", name: "Field Agent", tags: ["ночная смена"] },
      { id: "agent-2", name: "Second Agent", tags: ["Стажёр", "VIP №1"] },
    ])
    await show({ ...CARD, tags: ["ночная смена"] })

    // One group spelled two ways is two values in the map's filter — each
    // ticked alone shows a part of the trainees.
    await type(labelField(), "стажёр")
    await pressEnter()
    expect(labels()).toEqual(["ночная смена", "Стажёр"])

    // Also for a pasted list, and for the word still in the field at save.
    await type(labelField(), "резерв, vip  №1")
    await save()
    expect(lastWrite().body.tags).toEqual(["ночная смена", "Стажёр", "резерв", "VIP №1"])
  })

  it("lets the spelling be corrected on the only card that carries the label", async () => {
    // The list the form reads holds this card too. Were its own labels
    // «already in use», the retyped word would turn back into the old spelling.
    colleagues([{ id: "agent-1", name: "Field Agent", tags: ["Стажёр"] }])
    await show({ ...CARD, tags: ["Стажёр"] })

    await click(removeButtons()[0])
    await type(labelField(), "стажёр")
    await pressEnter()
    await save()

    expect(lastWrite().body.tags).toEqual(["стажёр"])
  })

  it("offers the labels other employees already have, without the ones on this card", async () => {
    colleagues([
      { id: "agent-1", name: "Field Agent", tags: ["стажёр", "ночная смена"] },
      { id: "agent-2", name: "Second Agent", tags: ["резерв", "Стажёр"] },
      { id: "agent-3", name: "Third Agent", tags: ["выездной", "резерв"] },
      { id: "agent-4", name: "Fourth Agent" },
    ])
    await show()

    const offered = [...container.querySelectorAll<HTMLOptionElement>("#agent-tags-known option")].map((option) => option.value)
    expect(offered).toEqual(["выездной", "резерв"])
    expect(labelField().getAttribute("list")).toBe("agent-tags-known")
  })

  it("tells the manager who sees the labels and the colour — managers, and never the employee himself", async () => {
    await show()

    // What is said here is what the API enforces (api-mtm-agents, -locations
    // and -activity tests): not on the phone, and not under his own web login.
    expect(container.textContent).toContain("Метки видят только руководители: сам сотрудник свои метки не видит — ни в приложении на телефоне, ни под своим логином.")
    expect(container.textContent).toContain("Цвет видят только руководители: сам сотрудник его не видит — ни в приложении на телефоне, ни под своим логином.")
    expect(container.textContent).toContain(`Меток может быть не больше ${MTM_AGENT_TAG_MAX_COUNT}`)
  })

  it("has the words for every refusal in Russian, English and Azerbaijani, with the number standing as a word of its own", () => {
    for (const locale of ["ru", "en", "az"]) {
      const forms = catalog(locale).mtmForms as Record<string, string>
      for (const key of ["tagsHint", "tagsLimit", "tagsOverLimit", "tagTooLong"]) {
        expect(forms[key], `${locale}.${key}`).toContain("{max}")
        // A case ending glued onto the number reads wrongly for half the numbers.
        expect(forms[key], `${locale}.${key}`).not.toMatch(/\{max\}[\p{L}\p{N}'’-]/u)
      }
      expect(forms.tagRefused, locale).toBeTruthy()
    }
  })
})

describe("agent card — the employee's colour on the map", () => {
  it("offers the eight colours by name, in the palette's order, and a worded «Без цвета»", async () => {
    await show({ ...CARD, mapColor: null })

    expect(colourButtons().map(colourName)).toEqual([
      "Розовый", "Фуксия", "Фиолетовый", "Тёмно-синий", "Голубой", "Бирюзовый", "Салатовый", "Чёрный", "Без цвета",
    ])
    expect(colourButtons()[8].textContent).toBe("Без цвета")
    expect(chosenColour()).toEqual(["Без цвета"])
  })

  it("shows the colour the card has, in words as well as by its swatch", async () => {
    await show()

    expect(chosenColour()).toEqual(["Бирюзовый"])
    expect(container.querySelector('[role="group"]')?.textContent).toContain("Бирюзовый")
  })

  it("saves the chosen colour as its palette key, never as a hex", async () => {
    await show()

    await click(colourButton("Розовый"))
    expect(chosenColour()).toEqual(["Розовый"])
    await save()

    expect(lastWrite().body.mapColor).toBe("pink")
    expect(JSON.stringify(lastWrite().body)).not.toContain("#")
  })

  it("takes the colour off with «Без цвета»", async () => {
    await show()

    await click(colourButton("Без цвета"))
    expect(chosenColour()).toEqual(["Без цвета"])
    await save()

    expect(lastWrite().body.mapColor).toBeNull()
  })

  it("shows a colour this build does not know as «Без цвета» — the same as the map draws it", async () => {
    await show({ ...CARD, mapColor: "orange" })

    expect(chosenColour()).toEqual(["Без цвета"])
  })

  it("leaves a colour this build does not know on the card when something else is saved, and takes it off when «Без цвета» is pressed", async () => {
    // Such a key was written by a newer build; an older one that merely
    // corrected a phone number must not erase it.
    await show({ ...CARD, mapColor: "orange" })
    await type(field("phone"), "+10000000001")
    await save()
    expect(Object.keys(lastWrite().body)).not.toContain("mapColor")

    await click(colourButton("Без цвета"))
    await save()
    expect(lastWrite().body.mapColor).toBeNull()
  })

  it("does not send the colour when the manager comes back to the one the card has", async () => {
    await show()

    await click(colourButton("Розовый"))
    await click(colourButton("Бирюзовый"))
    await save()

    expect(Object.keys(lastWrite().body)).not.toContain("mapColor")
  })

  it("outlines every colour that is not chosen, so a dark one does not vanish on the dark theme", async () => {
    await show()

    // «Чёрный» (#0f172a) on the dark dialog (#0f131a) was an empty gap. What
    // is seen cannot be measured without a browser, so the outline's class is
    // pinned: thin on the unchosen buttons, and never beside the chosen ring.
    const [chosen, ...others] = [colourButton("Бирюзовый"), ...colourButtons().slice(0, MTM_AGENT_MAP_COLOR_KEYS.length).filter((button) => colourName(button) !== "Бирюзовый")]
    expect(others).toHaveLength(MTM_AGENT_MAP_COLOR_KEYS.length - 1)
    for (const button of others) expect(button.classList.contains("ring-1"), colourName(button) ?? "").toBe(true)
    expect([chosen.classList.contains("ring-2"), chosen.classList.contains("ring-1")]).toEqual([true, false])
  })

  it("has a name for every colour in Russian, English and Azerbaijani", () => {
    for (const locale of ["ru", "en", "az"]) {
      const names = (catalog(locale).mtmForms as Catalog).mapColors as Record<string, string>
      expect(Object.keys(names), locale).toEqual([...MTM_AGENT_MAP_COLOR_KEYS])
      expect(new Set(Object.values(names)).size, locale).toBe(MTM_AGENT_MAP_COLOR_KEYS.length)
    }
  })
})

describe("agent card — what the form sends for labels and colour", () => {
  it("creates a new employee with the labels and the colour set in the form", async () => {
    await show(null)
    await type(field("name"), "New Agent")
    await type(field("agent-password"), "Field-Agent-2026!")
    await type(labelField(), "стажёр")
    await pressEnter()
    await click(colourButton("Тёмно-синий"))

    await save()

    expect(writes().map(({ method, url }) => [method, url])).toEqual([["POST", "/api/v1/mtm/agents"]])
    expect(lastWrite().body).toMatchObject({ name: "New Agent", tags: ["стажёр"], mapColor: "navy" })
  })

  it("creates a new employee without labels and without a colour when none were set", async () => {
    await show(null)
    await type(field("name"), "New Agent")
    await type(field("agent-password"), "Field-Agent-2026!")

    await save()

    expect(lastWrite().body).toMatchObject({ tags: [], mapColor: null })
  })

  it("does not wipe labels it was never shown: a card that arrived without them is saved without them", async () => {
    // A row from an answer that did not carry the two fields. Empty in the
    // form is then «unknown», not «none» — sending it would erase the card's.
    const bare: Card = { ...CARD }
    delete bare.tags
    delete bare.mapColor
    await show(bare)
    expect(labels()).toEqual([])

    await type(field("phone"), "+10000000001")
    await save()

    expect(lastWrite().body.phone).toBe("+10000000001")
    expect(Object.keys(lastWrite().body)).not.toContain("tags")
    expect(Object.keys(lastWrite().body)).not.toContain("mapColor")
  })

  it("leaves no untranslated key or unfilled placeholder on the screen", async () => {
    const ten = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT }, (_, index) => `группа ${index + 1}`)
    await show({ ...CARD, tags: ten })

    const drawn = [
      container.textContent ?? "",
      ...[...container.querySelectorAll("[aria-label], [title], [placeholder]")].flatMap((element) =>
        ["aria-label", "title", "placeholder"].map((name) => element.getAttribute(name) ?? "")),
    ].join("\n")
    expect(drawn).not.toMatch(/mtmForms\.|common\.|\{\w+\}/)
  })
})
