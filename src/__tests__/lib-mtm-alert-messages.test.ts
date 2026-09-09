import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import {
  MTM_ALERT_MESSAGE_KEYS,
  MTM_ALERT_MESSAGE_PARAMS,
  mtmAlertMessage,
  mtmAlertMessageForCustomer,
  readMtmAlertMessage,
} from "@/lib/mtm/alert-messages"

const LOCALES = ["en", "ru", "az"] as const

function messages(locale: string): Record<string, string> {
  const file = JSON.parse(readFileSync(`messages/${locale}.json`, "utf8"))
  return file.mtmAlertsPage?.messages ?? {}
}

describe("mtm alert messages (field UX audit A4)", () => {
  it("has a string for every key in every language", () => {
    for (const locale of LOCALES) {
      const strings = messages(locale)
      for (const key of MTM_ALERT_MESSAGE_KEYS) {
        expect(strings[key], `${locale}.json is missing mtmAlertsPage.messages.${key}`).toBeTypeOf("string")
      }
    }
  })

  it("spends every parameter the generator sends, in every language", () => {
    // The failure this catches is silent and ugly: a translator drops
    // {geofenceRadius} from the Azerbaijani string, and the rep reads "your
    // check-in was 340 m away" with no idea what the limit was. next-intl
    // renders it happily — nothing throws.
    for (const locale of LOCALES) {
      const strings = messages(locale)
      for (const key of MTM_ALERT_MESSAGE_KEYS) {
        for (const param of MTM_ALERT_MESSAGE_PARAMS[key]) {
          expect(
            strings[key],
            `${locale}.json → mtmAlertsPage.messages.${key} never uses {${param}}`,
          ).toContain(`{${param}}`)
        }
      }
    }
  })

  it("invents no parameter the generator does not send", () => {
    for (const locale of LOCALES) {
      const strings = messages(locale)
      for (const key of MTM_ALERT_MESSAGE_KEYS) {
        const used = [...strings[key].matchAll(/\{(\w+)\}/gu)].map((match) => match[1])
        for (const param of used) {
          expect(
            MTM_ALERT_MESSAGE_PARAMS[key],
            `${locale}.json → ${key} asks for {${param}}, which no generator sends`,
          ).toContain(param)
        }
      }
    }
  })

  describe("a customer with no name", () => {
    // An empty name passes the "has all its params" check — an empty string IS
    // a value — and renders «Отметка в «» записана в 12 м». The pairing lives
    // in one place so the next call site cannot forget it.
    it("switches to the sentence that names nobody", () => {
      for (const blank of [undefined, null, "", "   "]) {
        expect(mtmAlertMessageForCustomer("geofenceViolation", blank, {
          distanceMeters: 12,
          geofenceRadius: 100,
        })).toEqual({
          messageKey: "geofenceViolationUnnamed",
          messageParams: { distanceMeters: 12, geofenceRadius: 100 },
        })
      }
    })

    it("keeps the named sentence when there is a name, trimmed", () => {
      expect(mtmAlertMessageForCustomer("agentOutOfZoneCheckIn", "  Clinic One  ", {
        distanceMeters: 12,
        geofenceRadius: 100,
      })).toEqual({
        messageKey: "agentOutOfZoneCheckIn",
        messageParams: { distanceMeters: 12, geofenceRadius: 100, customerName: "Clinic One" },
      })
    })

    it("leaves every named key with a pair", () => {
      // The guard is only as good as its coverage: a named sentence with no
      // unnamed twin would fall back to the empty-quotes render.
      for (const key of MTM_ALERT_MESSAGE_KEYS) {
        if (!MTM_ALERT_MESSAGE_PARAMS[key].includes("customerName")) continue
        const produced = mtmAlertMessageForCustomer(key as never, "", { distanceMeters: 1, geofenceRadius: 1, minutes: 1, thresholdMinutes: 1 })
        expect(produced.messageKey, `${key} has no unnamed variant`).not.toBe(key)
        expect(MTM_ALERT_MESSAGE_PARAMS[produced.messageKey]).not.toContain("customerName")
      }
    })
  })

  it("reads back what a generator wrote", () => {
    const metadata = { routeId: "route-1", ...mtmAlertMessage("routeDeviation", { deviationMeters: 800, thresholdMeters: 500 }) }
    expect(readMtmAlertMessage(metadata)).toEqual({
      kind: "localized",
      key: "routeDeviation",
      params: { deviationMeters: 800, thresholdMeters: 500 },
    })
  })

  it("falls back to the stored sentence for a row written before A4", () => {
    // Millions of alerts predate the dictionary. Showing the old English text
    // is worse than a translation and far better than an empty card.
    expect(readMtmAlertMessage({ customerId: "c-1", distanceMeters: 340 })).toEqual({ kind: "legacy" })
    expect(readMtmAlertMessage(null)).toEqual({ kind: "legacy" })
    expect(readMtmAlertMessage("not an object")).toEqual({ kind: "legacy" })
  })

  it("falls back when the key is unknown to this deployment", () => {
    // A newer server writes a key an older reader has never heard of.
    expect(readMtmAlertMessage({ messageKey: "somethingNewer", messageParams: {} })).toEqual({ kind: "legacy" })
  })

  it("falls back when a number the sentence needs is missing", () => {
    // "You are {deviationMeters} m off route" with no distance is not a
    // message, it is a bug rendered to a rep standing in a pharmacy.
    expect(readMtmAlertMessage({ messageKey: "agentRouteDeviation", messageParams: {} })).toEqual({ kind: "legacy" })
  })
})
