import { describe, expect, it } from "vitest"
import { resolveWorkforceAndroidReleasePolicy } from "@/lib/workforce/mobile-release-policy"

const configured = {
  WORKFORCE_ANDROID_MIN_VERSION_CODE: "100",
  WORKFORCE_ANDROID_RECOMMENDED_VERSION_CODE: "120",
  WORKFORCE_ANDROID_MAX_VERSION_CODE: "199",
}

describe("Workforce Android release policy", () => {
  it("stays inert until an accountable release version is configured", () => {
    expect(resolveWorkforceAndroidReleasePolicy({
      workforceEnabled: true,
      clientVersionCode: null,
      environment: {},
    })).toMatchObject({
      status: "NOT_CONFIGURED",
      policyVersion: null,
      maySubmitNewWorkforceActions: true,
    })
  })

  it("does not advertise Workforce release access when the tenant capability is off", () => {
    expect(resolveWorkforceAndroidReleasePolicy({
      workforceEnabled: false,
      clientVersionCode: "120",
      environment: configured,
    })).toMatchObject({
      status: "NOT_APPLICABLE",
      clientVersionCode: null,
      maySubmitNewWorkforceActions: false,
    })
  })

  it("requires an exact version only after the policy is configured", () => {
    expect(resolveWorkforceAndroidReleasePolicy({
      workforceEnabled: true,
      clientVersionCode: null,
      environment: configured,
    })).toMatchObject({
      status: "CLIENT_VERSION_REQUIRED",
      minimumVersionCode: 100,
      recommendedVersionCode: 120,
      maximumVersionCode: 199,
      maySubmitNewWorkforceActions: false,
      recovery: "DRAIN_THEN_UPDATE",
    })
  })

  it("returns forced, recommended, supported and too-new outcomes deterministically", () => {
    expect(resolveWorkforceAndroidReleasePolicy({ workforceEnabled: true, clientVersionCode: "99", environment: configured }))
      .toMatchObject({ status: "UPDATE_REQUIRED", maySubmitNewWorkforceActions: false })
    expect(resolveWorkforceAndroidReleasePolicy({ workforceEnabled: true, clientVersionCode: "110", environment: configured }))
      .toMatchObject({ status: "UPDATE_AVAILABLE", maySubmitNewWorkforceActions: true })
    expect(resolveWorkforceAndroidReleasePolicy({ workforceEnabled: true, clientVersionCode: "120", environment: configured }))
      .toMatchObject({ status: "SUPPORTED", maySubmitNewWorkforceActions: true })
    expect(resolveWorkforceAndroidReleasePolicy({ workforceEnabled: true, clientVersionCode: "200", environment: configured }))
      .toMatchObject({ status: "CLIENT_TOO_NEW", maySubmitNewWorkforceActions: false, recovery: "CONTACT_SUPPORT" })
  })

  it("fails closed for malformed clients and incoherent server policy", () => {
    expect(resolveWorkforceAndroidReleasePolicy({ workforceEnabled: true, clientVersionCode: "1.2.3", environment: configured }))
      .toMatchObject({ status: "CLIENT_VERSION_INVALID", maySubmitNewWorkforceActions: false })
    expect(resolveWorkforceAndroidReleasePolicy({
      workforceEnabled: true,
      clientVersionCode: "120",
      environment: {
        WORKFORCE_ANDROID_MIN_VERSION_CODE: "120",
        WORKFORCE_ANDROID_RECOMMENDED_VERSION_CODE: "100",
      },
    })).toMatchObject({ status: "POLICY_INVALID", maySubmitNewWorkforceActions: false })
  })
})
