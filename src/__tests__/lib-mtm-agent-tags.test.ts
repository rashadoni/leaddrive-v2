import { describe, expect, it } from "vitest"
import {
  MTM_AGENT_MAP_COLORS,
  MTM_AGENT_MAP_COLOR_KEYS,
  MTM_AGENT_TAG_MAX_COUNT,
  MTM_AGENT_TAG_MAX_LENGTH,
  isMtmAgentMapColorKey,
  mtmAgentMapColorHex,
  mtmAgentNotesReader,
  normalizeMtmAgentTags,
  readsMtmAgentNotes,
  validateMtmAgentTags,
  withoutMtmAgentNotes,
} from "@/lib/mtm/agent-tags"

// The labels and the colour a manager puts on an employee's card. The rules are
// read by the card form, the API, the live map's list, its Excel export and the
// marker, so each sentence below is something one of them relies on.

describe("an employee's labels as they are stored", () => {
  it("keeps what the manager typed, without the stray spaces", () => {
    expect(normalizeMtmAgentTags(["  стажёр ", "ночная   смена", "Bakı 2"])).toEqual(["стажёр", "ночная смена", "Bakı 2"])
  })

  it("drops an empty entry instead of storing a blank label", () => {
    expect(normalizeMtmAgentTags(["", "   ", "резерв", "\t\n"])).toEqual(["резерв"])
  })

  it("keeps one of two labels that differ only by case — the spelling typed first", () => {
    expect(normalizeMtmAgentTags(["Vip", "VIP", "vip", "Резерв", "резерв"])).toEqual(["Vip", "Резерв"])
  })

  it("reads a letter pasted as a base letter plus a combining mark as that letter", () => {
    // «ş» and «й» the way a file name copied on a Mac carries them.
    const decomposed = ["şəhər", "йод"]
    const stored = normalizeMtmAgentTags(decomposed)

    expect(stored).toEqual(["şəhər", "йод"])
    expect(validateMtmAgentTags(decomposed)).toEqual({ ok: true, tags: ["şəhər", "йод"] })
  })
})

describe("what the API accepts as labels", () => {
  it("accepts ten labels and returns them the way they will be stored", () => {
    const ten = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT }, (_, index) => ` группа ${index + 1} `)

    expect(validateMtmAgentTags(ten)).toEqual({
      ok: true,
      tags: ten.map((tag) => tag.trim()),
    })
  })

  it("refuses the eleventh label", () => {
    const eleven = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT + 1 }, (_, index) => `группа ${index + 1}`)

    expect(validateMtmAgentTags(eleven)).toMatchObject({ ok: false, reason: "count" })
  })

  it("does not count the same label twice against the limit", () => {
    const tenAndARepeat = [...Array.from({ length: MTM_AGENT_TAG_MAX_COUNT }, (_, index) => `группа ${index + 1}`), "ГРУППА 1"]

    expect(validateMtmAgentTags(tenAndARepeat)).toMatchObject({ ok: true })
  })

  it("accepts a label of twenty-four characters and refuses one of twenty-five", () => {
    const longest = "а".repeat(MTM_AGENT_TAG_MAX_LENGTH)

    expect(validateMtmAgentTags([longest])).toEqual({ ok: true, tags: [longest] })
    expect(validateMtmAgentTags([`${longest}а`])).toMatchObject({ ok: false, reason: "length" })
  })

  it.each([
    ["=SUM(A1:A9)"],
    ["+994 50"],
    ["-скидка"],
    ["@менеджер"],
  ])("refuses %s — a label can never start a spreadsheet formula", (formula) => {
    expect(validateMtmAgentTags([formula])).toMatchObject({ ok: false, reason: "characters" })
  })

  it("refuses the value the map's list keeps for «without labels», and any underscore", () => {
    expect(validateMtmAgentTags(["__none__"])).toMatchObject({ ok: false, reason: "characters" })
    expect(validateMtmAgentTags(["ночная_смена"])).toMatchObject({ ok: false, reason: "characters" })
  })

  it("refuses a comma, because the list's Excel cell joins labels with commas", () => {
    expect(validateMtmAgentTags(["север, юг"])).toMatchObject({ ok: false, reason: "characters" })
  })

  it("refuses markup, quotes and invisible characters", () => {
    for (const label of ["<b>vip</b>", "vip\"", "vip'", "a​b", "a;b", "a&b"]) {
      expect(validateMtmAgentTags([label]), label).toMatchObject({ ok: false, reason: "characters" })
    }
  })

  it("accepts the signs people really put in a label", () => {
    const labels = ["A+", "2-я смена", "цех № 5", "C#", "Bakı/Sumqayıt", "исп. срок", "3 kurs"]

    expect(validateMtmAgentTags(labels)).toEqual({ ok: true, tags: labels })
  })

  it("refuses anything that is not a list of strings", () => {
    for (const value of [null, undefined, "vip", { 0: "vip" }, ["vip", 7], [["vip"]]]) {
      expect(validateMtmAgentTags(value), JSON.stringify(value)).toMatchObject({ ok: false, reason: "type" })
    }
  })

  it("accepts no labels at all", () => {
    expect(validateMtmAgentTags([])).toEqual({ ok: true, tags: [] })
  })

  it("keeps the fullest set of labels inside one Excel cell of the list's export", () => {
    // The export route refuses the whole file when a cell is over 300 characters.
    const fullest = Array.from({ length: MTM_AGENT_TAG_MAX_COUNT }, (_, index) =>
      `${index}`.padEnd(MTM_AGENT_TAG_MAX_LENGTH, "я"))

    expect(validateMtmAgentTags(fullest)).toMatchObject({ ok: true })
    expect(fullest.join(", ").length).toBeLessThanOrEqual(300)
  })
})

describe("the colour of an employee on the map", () => {
  it("offers eight colours, each with its own hex", () => {
    expect(MTM_AGENT_MAP_COLOR_KEYS).toHaveLength(8)
    expect(Object.keys(MTM_AGENT_MAP_COLORS).sort()).toEqual([...MTM_AGENT_MAP_COLOR_KEYS].sort())
    const hexes = MTM_AGENT_MAP_COLOR_KEYS.map((key) => mtmAgentMapColorHex(key))
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    expect(new Set(hexes).size).toBe(8)
  })

  it("never offers a colour the marker already uses to say how fresh the GPS point is", () => {
    // Fill of the marker: online, delayed, no signal (src/components/mtm/live-map.tsx).
    const freshness = ["#15803d", "#b45309", "#64748b"]

    expect(Object.values(MTM_AGENT_MAP_COLORS).filter((hex) => freshness.includes(hex))).toEqual([])
  })

  it("draws no ring for a card without a colour", () => {
    expect(mtmAgentMapColorHex(null)).toBeNull()
    expect(mtmAgentMapColorHex(undefined)).toBeNull()
    expect(mtmAgentMapColorHex("")).toBeNull()
  })

  it("draws no ring for a key it does not know — never the stored text itself", () => {
    // The marker is an HTML string: whatever comes back here is written into it.
    for (const stored of ["#ff0000", "red", "PINK", "pink;background:url(x)", "constructor", "toString", "__proto__", "hasOwnProperty"]) {
      expect(mtmAgentMapColorHex(stored), stored).toBeNull()
      expect(isMtmAgentMapColorKey(stored), stored).toBe(false)
    }
  })
})

// The labels and the colour are the managers' notes ABOUT a person. Three
// routes give them out — the employee list, the live map and the journal — and
// each asks this one rule who is reading.
describe("who reads the labels and the colour", () => {
  const reads = (caller: Parameters<typeof mtmAgentNotesReader>[0], agentId: string) =>
    readsMtmAgentNotes(mtmAgentNotesReader(caller), agentId)

  it("an administrator of the organization reads every card, his own included", () => {
    expect(reads({ webSession: true, actor: { agentId: null, role: "ADMIN" } }, "agent-1")).toBe(true)
    // He administers his own card too: nothing is kept from him.
    expect(reads({ webSession: true, actor: { agentId: "head-1", role: "ADMIN" } }, "head-1")).toBe(true)
  })

  it.each(["MANAGER", "SUPERVISOR"])("a %s reads the cards of his people and never his own", (role) => {
    const caller = { webSession: true, actor: { agentId: "lead-1", role } }

    expect(reads(caller, "agent-1")).toBe(true)
    expect(reads(caller, "lead-1")).toBe(false)
  })

  it("a field employee reads none — under a web login as little as on his phone", () => {
    const caller = { webSession: true, actor: { agentId: "agent-1", role: "AGENT" } }

    expect(mtmAgentNotesReader(caller)).toEqual({ kind: "nobody" })
    expect(reads(caller, "agent-1")).toBe(false)
    expect(reads(caller, "agent-2")).toBe(false)
  })

  it("nobody reads them without a browser session, whatever role the caller was resolved to", () => {
    // An integration key is answered as an administrator of the whole
    // organization; only the session tells it from a person.
    for (const role of ["ADMIN", "MANAGER", "SUPERVISOR", "AGENT"]) {
      expect(mtmAgentNotesReader({ webSession: false, actor: { agentId: "card-1", role } }), role).toEqual({ kind: "nobody" })
    }
  })

  it("whatever is unclear reads nothing", () => {
    expect(mtmAgentNotesReader({ webSession: true, actor: null })).toEqual({ kind: "nobody" })
    expect(mtmAgentNotesReader({ webSession: true, actor: undefined })).toEqual({ kind: "nobody" })
    // A role this build does not know, and a manager whose own card is not known.
    expect(mtmAgentNotesReader({ webSession: true, actor: { agentId: "card-1", role: "DIRECTOR" } })).toEqual({ kind: "nobody" })
    expect(mtmAgentNotesReader({ webSession: true, actor: { agentId: null, role: "MANAGER" } })).toEqual({ kind: "nobody" })
    // «Truthy» is not «a browser session»: the routes pass an exact comparison.
    expect(mtmAgentNotesReader({ webSession: "api_key" as unknown as boolean, actor: { agentId: null, role: "ADMIN" } })).toEqual({ kind: "nobody" })
    // A row that names no card is not shown to a reader who must not see his own.
    expect(readsMtmAgentNotes({ kind: "all-but-own", ownAgentId: "lead-1" }, null)).toBe(false)
  })
})

describe("a journal row without the labels and the colour", () => {
  it("loses the two keys and keeps the rest — in a copy, the row itself is not changed", () => {
    const snapshot = { name: "Field Agent", phone: "+10000000000", tags: ["стажёр"], mapColor: "teal" }

    expect(withoutMtmAgentNotes(snapshot)).toEqual({ name: "Field Agent", phone: "+10000000000" })
    expect(snapshot).toEqual({ name: "Field Agent", phone: "+10000000000", tags: ["стажёр"], mapColor: "teal" })
  })

  it("leaves alone what is not a snapshot of fields", () => {
    expect(withoutMtmAgentNotes(null)).toBeNull()
    expect(withoutMtmAgentNotes(undefined)).toBeUndefined()
    expect(withoutMtmAgentNotes("tags")).toBe("tags")
    expect(withoutMtmAgentNotes(["tags", "mapColor"])).toEqual(["tags", "mapColor"])
  })
})
