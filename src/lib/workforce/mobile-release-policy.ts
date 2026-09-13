export const WORKFORCE_ANDROID_VERSION_CODE_HEADER = "x-workforce-app-version-code"

const MAX_ANDROID_VERSION_CODE = 2_147_483_647

type WorkforceAndroidReleaseEnvironment = Record<string, string | undefined>

export type WorkforceAndroidReleasePolicy = {
  platform: "ANDROID"
  policyVersion: string | null
  status:
    | "NOT_APPLICABLE"
    | "NOT_CONFIGURED"
    | "POLICY_INVALID"
    | "CLIENT_VERSION_REQUIRED"
    | "CLIENT_VERSION_INVALID"
    | "UPDATE_REQUIRED"
    | "CLIENT_TOO_NEW"
    | "UPDATE_AVAILABLE"
    | "SUPPORTED"
  clientVersionCode: number | null
  minimumVersionCode: number | null
  recommendedVersionCode: number | null
  maximumVersionCode: number | null
  maySubmitNewWorkforceActions: boolean
  recovery: "NONE" | "DRAIN_THEN_UPDATE" | "CONTACT_SUPPORT"
}

function versionCode(value: string | undefined): number | null {
  if (value == null || value === "" || !/^[1-9]\d{0,9}$/.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed <= MAX_ANDROID_VERSION_CODE ? parsed : null
}

function configured(value: string | undefined): boolean {
  return value != null && value !== ""
}

/**
 * Additive Android compatibility contract for a future Workforce client.
 *
 * The policy is inert until a minimum version is deliberately configured.
 * That preserves installed legacy Field clients while still allowing an
 * exact, server-owned forced-update decision once a signed Workforce build
 * exists. A client version is only a compatibility hint; authorization and
 * attendance proof remain independently enforced by every mutation endpoint.
 */
export function resolveWorkforceAndroidReleasePolicy(input: {
  workforceEnabled: boolean
  clientVersionCode: string | null
  environment?: WorkforceAndroidReleaseEnvironment
}): WorkforceAndroidReleasePolicy {
  if (!input.workforceEnabled) {
    return {
      platform: "ANDROID",
      policyVersion: null,
      status: "NOT_APPLICABLE",
      clientVersionCode: null,
      minimumVersionCode: null,
      recommendedVersionCode: null,
      maximumVersionCode: null,
      maySubmitNewWorkforceActions: false,
      recovery: "NONE",
    }
  }

  const environment = input.environment ?? process.env
  const rawMinimum = environment.WORKFORCE_ANDROID_MIN_VERSION_CODE
  const rawRecommended = environment.WORKFORCE_ANDROID_RECOMMENDED_VERSION_CODE
  const rawMaximum = environment.WORKFORCE_ANDROID_MAX_VERSION_CODE
  if (![rawMinimum, rawRecommended, rawMaximum].some(configured)) {
    return {
      platform: "ANDROID",
      policyVersion: null,
      status: "NOT_CONFIGURED",
      clientVersionCode: versionCode(input.clientVersionCode ?? undefined),
      minimumVersionCode: null,
      recommendedVersionCode: null,
      maximumVersionCode: null,
      maySubmitNewWorkforceActions: true,
      recovery: "NONE",
    }
  }

  const minimum = versionCode(rawMinimum)
  const recommended = configured(rawRecommended) ? versionCode(rawRecommended) : minimum
  const maximum = configured(rawMaximum) ? versionCode(rawMaximum) : null
  const policyValid = minimum != null
    && recommended != null
    && recommended >= minimum
    && (maximum == null || (maximum >= recommended && maximum >= minimum))
  if (!policyValid) {
    return {
      platform: "ANDROID",
      policyVersion: null,
      status: "POLICY_INVALID",
      clientVersionCode: versionCode(input.clientVersionCode ?? undefined),
      minimumVersionCode: null,
      recommendedVersionCode: null,
      maximumVersionCode: null,
      maySubmitNewWorkforceActions: false,
      recovery: "CONTACT_SUPPORT",
    }
  }

  const policyVersion = `android-v1:${minimum}:${recommended}:${maximum ?? "open"}`
  if (input.clientVersionCode == null || input.clientVersionCode === "") {
    return {
      platform: "ANDROID",
      policyVersion,
      status: "CLIENT_VERSION_REQUIRED",
      clientVersionCode: null,
      minimumVersionCode: minimum,
      recommendedVersionCode: recommended,
      maximumVersionCode: maximum,
      maySubmitNewWorkforceActions: false,
      recovery: "DRAIN_THEN_UPDATE",
    }
  }

  const client = versionCode(input.clientVersionCode)
  if (client == null) {
    return {
      platform: "ANDROID",
      policyVersion,
      status: "CLIENT_VERSION_INVALID",
      clientVersionCode: null,
      minimumVersionCode: minimum,
      recommendedVersionCode: recommended,
      maximumVersionCode: maximum,
      maySubmitNewWorkforceActions: false,
      recovery: "CONTACT_SUPPORT",
    }
  }

  const common = {
    platform: "ANDROID" as const,
    policyVersion,
    clientVersionCode: client,
    minimumVersionCode: minimum,
    recommendedVersionCode: recommended,
    maximumVersionCode: maximum,
  }
  if (client < minimum) {
    return {
      ...common,
      status: "UPDATE_REQUIRED",
      maySubmitNewWorkforceActions: false,
      recovery: "DRAIN_THEN_UPDATE",
    }
  }
  if (maximum != null && client > maximum) {
    return {
      ...common,
      status: "CLIENT_TOO_NEW",
      maySubmitNewWorkforceActions: false,
      recovery: "CONTACT_SUPPORT",
    }
  }
  if (client < recommended) {
    return {
      ...common,
      status: "UPDATE_AVAILABLE",
      maySubmitNewWorkforceActions: true,
      recovery: "NONE",
    }
  }
  return {
    ...common,
    status: "SUPPORTED",
    maySubmitNewWorkforceActions: true,
    recovery: "NONE",
  }
}
