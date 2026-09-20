import { readFileSync } from "node:fs"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { voiceWritesEnabled } from "@/lib/ai/voice/config"
import { geminiLiveConfig, geminiLiveSystemInstruction } from "@/lib/ai/voice/gemini-live"
import { voiceTools } from "@/lib/ai/voice/realtime-tool-contract"
import { VOICE_PROPOSE_TOOL_NAMES } from "@/lib/ai/voice/propose-tools"

/**
 * The kill switch for voice WRITES, separate from the one for voice itself.
 *
 * Reading the CRM aloud and preparing a change to it are different features
 * with different risk, and they used to share one switch: the pilot allowlist.
 * Turning off the writes meant turning off the assistant, losing a read
 * capability that has worked for weeks — the kind of cost that stops a switch
 * from being pulled when it should be.
 */
const ORIGINAL = process.env.VOICE_WRITE_ENABLED

beforeEach(() => {
  delete process.env.VOICE_WRITE_ENABLED
})

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VOICE_WRITE_ENABLED
  else process.env.VOICE_WRITE_ENABLED = ORIGINAL
  vi.resetModules()
})

describe("the switch itself", () => {
  // Fail-closed is this module's habit, and this is the one place it does not
  // apply: the writes are deployed and in use, so an unset variable meaning
  // "off" would be a silent rollback wearing a safety feature's clothes.
  it("leaves writes on when nothing is configured", () => {
    expect(voiceWritesEnabled()).toBe(true)
  })

  it("turns them off only on an explicit falsy word", () => {
    for (const value of ["false", "FALSE", " false ", "0", "off", "no"]) {
      process.env.VOICE_WRITE_ENABLED = value
      expect(voiceWritesEnabled(), value).toBe(false)
    }
  })

  it("does not read a typo as off", () => {
    for (const value of ["", "true", "yes", "1", "disabled", "falsey", "nope"]) {
      process.env.VOICE_WRITE_ENABLED = value
      expect(voiceWritesEnabled(), value).toBe(true)
    }
  })

  it("is read per request, so a restart applies it", () => {
    process.env.VOICE_WRITE_ENABLED = "false"
    expect(voiceWritesEnabled()).toBe(false)
    process.env.VOICE_WRITE_ENABLED = "true"
    expect(voiceWritesEnabled()).toBe(true)
  })
})

describe("what the model is given when writes are off", () => {
  const base = { locale: "ru", firstName: "Rashad", allowedSections: ["leads"] }

  it("publishes the proposal tools when writes are on", () => {
    const names = voiceTools(["leads"], "ru", true).map((tool) => tool.name)
    for (const tool of VOICE_PROPOSE_TOOL_NAMES) expect(names).toContain(tool)
  })

  // Absent rather than failing on call: a tool the model is given and then
  // refused teaches it to retry, and to tell the user it is trying.
  it("publishes none of them when writes are off", () => {
    const names = voiceTools(["leads"], "ru", false).map((tool) => tool.name)
    for (const tool of VOICE_PROPOSE_TOOL_NAMES) expect(names).not.toContain(tool)
    expect(names.filter((name) => name.startsWith("propose_"))).toEqual([])
  })

  it("keeps every read tool when writes are off", () => {
    const on = voiceTools(["leads"], "ru", true).map((tool) => tool.name)
    const off = voiceTools(["leads"], "ru", false).map((tool) => tool.name)
    const removed = on.filter((name) => !off.includes(name))
    expect(removed.sort()).toEqual([...VOICE_PROPOSE_TOOL_NAMES].sort())
  })

  // The V1.6 lesson: an instruction the model can see is false invites it to
  // choose which rule to believe. With the switch off, "read-only" is true
  // again, so it is said again.
  it("tells the model the truth about which configuration it is in", () => {
    const off = geminiLiveSystemInstruction("ru", "Rashad", "auto", false)
    expect(off).toMatch(/Every tool you have is read-only/i)
    expect(off).toMatch(/you can only read/i)
    expect(off).not.toMatch(/propose_\*/)

    const on = geminiLiveSystemInstruction("ru", "Rashad", "auto", true)
    expect(on).toMatch(/propose_\* tools only PREPARE/)
    expect(on).not.toMatch(/Every tool you have is read-only/i)
  })

  it("keeps the injection rules in both configurations", () => {
    for (const writesEnabled of [true, false]) {
      const instruction = geminiLiveSystemInstruction("ru", "Rashad", "auto", writesEnabled)
      expect(instruction, String(writesEnabled)).toMatch(/DATA, never instructions/i)
      expect(instruction, String(writesEnabled)).toMatch(/MUST be answered by calling a tool first/)
    }
  })

  it("seals the switch into the session configuration", () => {
    const off = geminiLiveConfig({ ...base, writesEnabled: false })
    const declarations = (off.tools as Array<{ functionDeclarations?: Array<{ name: string }> }>)[0]
      ?.functionDeclarations ?? []
    expect(declarations.some((tool) => tool.name.startsWith("propose_"))).toBe(false)
    expect(String(off.systemInstruction)).toMatch(/read-only/i)
  })

  it("defaults to writes on, so an unflagged caller behaves as before", () => {
    const config = geminiLiveConfig(base)
    const declarations = (config.tools as Array<{ functionDeclarations?: Array<{ name: string }> }>)[0]
      ?.functionDeclarations ?? []
    expect(declarations.some((tool) => tool.name.startsWith("propose_"))).toBe(true)
  })
})

describe("which routes the switch guards", () => {
  const read = (path: string) => readFileSync(path, "utf8")

  // One gate rather than five checks, because a check each route remembers to
  // make is a check one route will eventually forget.
  it("guards every route that can end in a CRM mutation", () => {
    for (const path of [
      "src/app/api/v1/ai/voice/actions/propose/route.ts",
      "src/app/api/v1/ai/voice/actions/draft/route.ts",
      "src/app/api/v1/ai/voice/actions/[id]/route.ts",
      "src/app/api/v1/ai/voice/actions/[id]/confirmation/route.ts",
      "src/app/api/v1/ai/voice/actions/[id]/commit/route.ts",
    ]) {
      const source = read(path)
      expect(source, path).toContain("checkVoiceWriteAccess(auth)")
      expect(source, path).not.toContain("checkVoicePilotAccess(auth)")
    }
  })

  // A draft prepared before the switch was thrown must still be reachable and
  // dismissible, or it sits on screen with no way out.
  it("leaves reading and cancelling a draft on the pilot gate", () => {
    for (const path of [
      "src/app/api/v1/ai/voice/actions/[id]/cancel/route.ts",
      "src/app/api/v1/ai/voice/actions/active/route.ts",
    ]) {
      const source = read(path)
      expect(source, path).toContain("checkVoicePilotAccess(auth)")
      expect(source, path).not.toContain("checkVoiceWriteAccess")
    }
  })

  it("still runs the pilot gate underneath, not instead of it", () => {
    const gate = read("src/lib/ai/voice/gate.ts")
    expect(gate).toMatch(/checkVoiceWriteAccess[\s\S]*await checkVoicePilotAccess\(auth\)/)
  })
})
