import { expect, it } from "vitest"
import { identityDirectoryPhone } from "./directory-contact"
const current = { cutoverAt: new Date("2026-10-25T00:00:00Z"), phoneClaim: { normalizedPhone: "+994507770021" } }
it("shows the verified common number on a separate module card with no legacy phone", () => {
  expect(identityDirectoryPhone({ userAccount: current, legacyPhone: null })).toBe(current.phoneClaim.normalizedPhone)
})
it("does not display a released legacy number or a staged replacement as current ownership", () => {
  expect(identityDirectoryPhone({ userAccount: { ...current, phoneClaim: null }, legacyPhone: "+994507770022" })).toBeNull()
  expect(identityDirectoryPhone({ userAccount: { ...current, cutoverAt: null }, legacyPhone: "+994507770022" })).toBe("+994507770022")
})
it("keeps the immutable canonical actor owner authoritative over a legacy user link", () => {
  expect(identityDirectoryPhone({ boundAccount: current, userAccount: { ...current, phoneClaim: { normalizedPhone: "+994507770023" } }, legacyPhone: "+994507770024" })).toBe(current.phoneClaim.normalizedPhone)
  expect(identityDirectoryPhone({ boundAccount: { ...current, phoneClaim: null }, legacyPhone: "+994507770024" })).toBeNull()
})
