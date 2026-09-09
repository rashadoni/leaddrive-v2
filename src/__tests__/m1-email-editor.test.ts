/**
 * M1 Visual Email Editor — unit tests
 *
 * Coverage:
 *   A. email-templates.ts pure helpers + preset catalogue
 *   B. Structural validation of all 6 preset HTML blobs
 *   C. GrapesEditor component export shape
 *   D. handlePresetSelect logic (extracted inline for unit-testability)
 */

import { describe, it, expect } from "vitest"
import {
  EMAIL_TEMPLATE_PRESETS,
  getEmailTemplatePreset,
  isValidTemplateHtml,
  type EmailTemplatePreset,
} from "@/components/email-editor/email-templates"

// ── A: email-templates.ts pure helpers ────────────────────────────────────────

describe("EMAIL_TEMPLATE_PRESETS catalogue", () => {
  it("exports exactly 6 presets", () => {
    expect(EMAIL_TEMPLATE_PRESETS).toHaveLength(6)
  })

  it("every preset has the required shape", () => {
    for (const p of EMAIL_TEMPLATE_PRESETS) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.description).toBeTruthy()
      expect(p.emoji).toBeTruthy()
      expect(p.category).toBeTruthy()
      expect(typeof p.html).toBe("string")
    }
  })

  it("all preset ids are unique", () => {
    const ids = EMAIL_TEMPLATE_PRESETS.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("contains the six expected ids", () => {
    const ids = EMAIL_TEMPLATE_PRESETS.map(p => p.id)
    expect(ids).toEqual(
      expect.arrayContaining(["welcome", "newsletter", "promo", "followup", "invitation", "thankyou"])
    )
  })
})

describe("getEmailTemplatePreset", () => {
  it("returns the correct preset for each known id", () => {
    const known = ["welcome", "newsletter", "promo", "followup", "invitation", "thankyou"]
    for (const id of known) {
      const p = getEmailTemplatePreset(id)
      expect(p).toBeDefined()
      expect(p?.id).toBe(id)
    }
  })

  it("returns undefined for an unknown id", () => {
    expect(getEmailTemplatePreset("does-not-exist")).toBeUndefined()
  })

  it("returns undefined for empty string", () => {
    expect(getEmailTemplatePreset("")).toBeUndefined()
  })
})

describe("isValidTemplateHtml", () => {
  it("returns true for well-formed 600px wrapper table HTML", () => {
    const p = getEmailTemplatePreset("welcome")!
    expect(isValidTemplateHtml(p.html)).toBe(true)
  })

  it("returns false for empty string", () => {
    expect(isValidTemplateHtml("")).toBe(false)
  })

  it("returns false for table HTML without 600 width marker", () => {
    expect(isValidTemplateHtml("<table><tr><td>hello</td></tr></table>")).toBe(false)
  })

  it("returns true for minimal valid email table", () => {
    expect(isValidTemplateHtml('<table width="600"><tr><td></td></tr></table>')).toBe(true)
  })
})

// ── B: All preset HTML blobs are well-formed email HTML ───────────────────────

describe("preset HTML structure", () => {
  it.each(EMAIL_TEMPLATE_PRESETS)(
    "$id passes isValidTemplateHtml",
    (preset: EmailTemplatePreset) => {
      expect(isValidTemplateHtml(preset.html)).toBe(true)
    }
  )

  it.each(EMAIL_TEMPLATE_PRESETS)(
    "$id uses inline styles",
    (preset: EmailTemplatePreset) => {
      expect(preset.html).toContain("style=")
    }
  )

  it("all presets include an unsubscribe link", () => {
    for (const p of EMAIL_TEMPLATE_PRESETS) {
      expect(p.html).toContain("Отписаться")
    }
  })

  it("all presets include a copyright footer", () => {
    for (const p of EMAIL_TEMPLATE_PRESETS) {
      // footer() helper emits © 2025 LeadDrive CRM
      expect(p.html).toContain("2025")
    }
  })

  it("welcome preset contains client_name merge tag", () => {
    const welcome = getEmailTemplatePreset("welcome")!
    expect(welcome.html).toContain("{{client_name}}")
  })

  it("promo preset contains a gradient hero section", () => {
    const promo = getEmailTemplatePreset("promo")!
    expect(promo.html).toContain("linear-gradient")
    expect(promo.html).toContain("{{date}}")
  })

  it("newsletter preset contains a two-column layout", () => {
    const newsletter = getEmailTemplatePreset("newsletter")!
    // twoColumn() helper renders <td width="48%"> columns
    expect(newsletter.html).toContain('width="48%"')
    expect(newsletter.html).toContain("{{month}}")
    expect(newsletter.html).toContain("{{year}}")
  })

  it("followup preset mentions next steps", () => {
    const followup = getEmailTemplatePreset("followup")!
    expect(followup.html).toContain("{{client_name}}")
    expect(followup.html).toContain("{{service}}")
  })

  it("invitation preset references date and event placeholders", () => {
    const inv = getEmailTemplatePreset("invitation")!
    expect(inv.html).toContain("{{date}}")
    expect(inv.html).toContain("{{service}}")
  })

  it("thankyou preset contains the emoji large display", () => {
    const ty = getEmailTemplatePreset("thankyou")!
    // The template uses font-size:56px for the 🙏 emoji
    expect(ty.html).toContain("56px")
    expect(ty.html).toContain("{{client_name}}")
  })
})

// ── C: GrapesEditor component export shape ────────────────────────────────────

describe("GrapesEditor module exports", () => {
  it("exports GrapesEditor component", async () => {
    const mod = await import("@/components/email-editor/grapes-editor")
    expect(mod.GrapesEditor).toBeDefined()
    expect(typeof mod.GrapesEditor).toBe("object") // forwardRef returns an object
  })

  it("GrapesEditor has the expected displayName", async () => {
    const { GrapesEditor } = await import("@/components/email-editor/grapes-editor")
    expect((GrapesEditor as any).displayName).toBe("GrapesEditor")
  })
})

// ── D: handlePresetSelect logic (pure, extracted for unit-testability) ────────

describe("preset selection logic (handlePresetSelect inline)", () => {
  /** Mirrors the mapping logic from handlePresetSelect in email-template-form */
  function resolvePresetHtml(presetId: string): string {
    return presetId === "blank"
      ? ""
      : (EMAIL_TEMPLATE_PRESETS.find(p => p.id === presetId)?.html ?? "")
  }

  it("blank maps to empty string", () => {
    expect(resolvePresetHtml("blank")).toBe("")
  })

  it("known id maps to non-empty HTML", () => {
    const html = resolvePresetHtml("welcome")
    expect(html.length).toBeGreaterThan(100)
    expect(html).toContain("<table")
  })

  it("all 6 presets resolve to non-empty HTML", () => {
    const known = ["welcome", "newsletter", "promo", "followup", "invitation", "thankyou"]
    for (const id of known) {
      expect(resolvePresetHtml(id).length).toBeGreaterThan(0)
    }
  })

  it("unknown id falls back to empty string (safe default)", () => {
    expect(resolvePresetHtml("nonexistent")).toBe("")
  })
})
