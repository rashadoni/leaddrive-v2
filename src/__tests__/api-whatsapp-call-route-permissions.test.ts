import { describe, expect, it, vi } from "vitest"

const rls = vi.hoisted(() => ({
  registrations: [] as Array<{ moduleName: string | undefined; action: string | undefined }>,
}))

vi.mock("@/lib/with-rls", () => ({
  withRlsAuth: (moduleName: string | undefined, action: string | undefined, handler: unknown) => {
    rls.registrations.push({ moduleName, action })
    return handler
  },
}))

import "@/app/api/v1/calls/whatsapp/[id]/session/route"
import "@/app/api/v1/calls/whatsapp/[id]/action/route"
import "@/app/api/v1/calls/whatsapp/smoke/route"

describe("WhatsApp call controls route permissions", () => {
  it("use inbox write access instead of the regular VoIP add-on", () => {
    expect(rls.registrations).toEqual([
      { moduleName: "inbox", action: "write" },
      { moduleName: "inbox", action: "write" },
      { moduleName: "settings", action: "write" },
    ])
    expect(rls.registrations).not.toContainEqual({ moduleName: "voip", action: "write" })
  })
})
