import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const androidRoot = resolve(process.cwd(), "apps/workforce-android")
const read = (path: string) => readFileSync(resolve(androidRoot, path), "utf8")

describe("Workforce Android foundation", () => {
  it("keeps the source project Android-first and refuses an implicit production release identity", () => {
    const build = read("app/build.gradle.kts")
    expect(build).toContain("id(\"com.android.application\")")
    expect(build).toContain("id(\"org.jetbrains.kotlin.plugin.compose\")")
    expect(build).toContain("compileSdk = 37")
    expect(build).toContain("WORKFORCE_APPLICATION_ID")
    expect(build).toContain("invalid.release.workforce")
    expect(build).toContain("WORKFORCE_API_BASE_URL")
    expect(build).not.toMatch(/applicationId\s*=\s*\"com\.leaddrive\.workforce\"/)
  })

  it("does not declare background location or backup of employee session data", () => {
    const manifest = read("app/src/main/AndroidManifest.xml")
    const dataRules = read("app/src/main/res/xml/data_extraction_rules.xml")
    expect(manifest).toContain("ACCESS_FINE_LOCATION")
    expect(manifest).toContain("CAMERA")
    expect(manifest).not.toContain("ACCESS_BACKGROUND_LOCATION")
    expect(manifest).not.toContain("foregroundServiceType=\"location\"")
    expect(manifest).toContain("android:allowBackup=\"false\"")
    expect(dataRules).toContain("<exclude domain=\"sharedpref\" path=\".\" />")
    expect(dataRules).toContain("<exclude domain=\"database\" path=\".\" />")
  })

  it("keeps the Android data layer limited to Workforce login/bootstrap and secure local session state", () => {
    const api = read("app/src/main/java/com/leaddrive/workforce/android/data/WorkforceApiClient.kt")
    const store = read("app/src/main/java/com/leaddrive/workforce/android/data/WorkforceSecureStore.kt")
    expect(api).toContain('"/api/v1/mtm/mobile/auth"')
    expect(api).toContain('"/api/v1/mtm/mobile/bootstrap"')
    expect(api).not.toContain('"/api/v1/mtm/mobile/routes')
    expect(api).not.toContain('"/api/v1/mtm/mobile/visits')
    expect(api).toContain('"x-workforce-client"')
    expect(api).toContain('"x-workforce-app-version-code"')
    expect(store).toContain("AndroidKeyStore")
    expect(store).toContain("AES/GCM/NoPadding")
    expect(store).toContain("clearForLogout")
  })

  it("uses an attested non-exportable Android key without handling biometric data", () => {
    const deviceKey = read("app/src/main/java/com/leaddrive/workforce/android/security/WorkforceDeviceKeyManager.kt")
    expect(deviceKey).toContain("setAttestationChallenge(challenge)")
    expect(deviceKey).toContain("setUserAuthenticationRequired(true)")
    expect(deviceKey).toContain("setUserAuthenticationParameters")
    expect(deviceKey).toContain("KeyProperties.KEY_ALGORITHM_EC")
    expect(deviceKey).not.toMatch(/BiometricPrompt|FingerprintManager|faceTemplate|biometricTemplate/i)
  })

  it("bounds pull-request Android CI to the affected paths and cancels superseded work", () => {
    const workflow = readFileSync(resolve(process.cwd(), ".github/workflows/workforce-android.yml"), "utf8")
    expect(workflow).toContain("pull_request:")
    expect(workflow).toContain('      - "apps/workforce-android/**"')
    expect(workflow).toContain("concurrency:")
    expect(workflow).toContain("cancel-in-progress: true")
    expect(workflow).toContain("runs-on: ubuntu-24.04")
  })
})
