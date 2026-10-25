import manifest from "./time-app-release-manifest.json"

export const TIME_APP_PACKAGE = "com.leaddrive.attendance"
export const TIME_APP_CHANNEL = "time-stable"
export const TIME_APP_CERTIFICATE = "d6e9a6a76bb7c12e0ed81e2094f56e356e6f0d12b07ba35a2ed6598a88cecf2b"
export const TIME_APP_ORIGIN = "https://app.leaddrivecrm.org"
export const TIME_APP_STORE_URL = "https://play.google.com/store/apps/details?id=com.leaddrive.attendance"
const RELEASES = "https://github.com/rashadoni/leaddrive-mtm/releases/download"

export type TimeAppRelease = {
  versionName: string
  versionCode: number
  publishedAt: string
  sourceSha: string
  sourceBranch: "main"
  apkSha256: string
  signingCertificateSha256: string
  apkUrl: string
  tag: string
}

/** A reviewed manifest promotes one accepted Time build. QA artifacts and the
 * unrelated Route & Field release feed never participate. See the release runbook. */
export function parseTimeAppRelease(raw: unknown): TimeAppRelease | null {
  if (!raw || typeof raw !== "object") return null
  const envelope = raw as Record<string, unknown>
  if (envelope.schemaVersion !== 1 || envelope.packageName !== TIME_APP_PACKAGE || envelope.channel !== TIME_APP_CHANNEL) return null
  if (!envelope.release || typeof envelope.release !== "object") return null
  const release = envelope.release as Record<string, unknown>
  const { versionName, versionCode, sourceSha, sourceBranch, publishedAt, apkSha256, signingCertificateSha256, tag, apkUrl } = release
  if (typeof versionName !== "string" || !/^\d+\.\d+\.\d+$/.test(versionName)) return null
  if (typeof versionCode !== "number" || !Number.isSafeInteger(versionCode) || versionCode <= 0) return null
  if (typeof sourceSha !== "string" || !/^[0-9a-f]{40}$/.test(sourceSha) || sourceBranch !== "main") return null
  if (typeof apkSha256 !== "string" || !/^[0-9a-f]{64}$/.test(apkSha256) || signingCertificateSha256 !== TIME_APP_CERTIFICATE) return null
  if (typeof publishedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(publishedAt) || !Number.isFinite(Date.parse(publishedAt))) return null
  // Exact asset and tag, not a repo-wide prefix that could name a Field APK.
  if (typeof tag !== "string" || typeof apkUrl !== "string" || tag !== `time-v${versionName}-${versionCode}` || apkUrl !== `${RELEASES}/${tag}/leaddrive-time-${versionName}-${versionCode}.apk`) return null
  return { versionName, versionCode, sourceSha, sourceBranch, publishedAt, apkSha256, signingCertificateSha256, tag, apkUrl }
}

/** No network fetch or stale cache: withdrawal via a reviewed null manifest
 * immediately disables the download in the deployed version. */
export function latestTimeAppRelease(): TimeAppRelease | null {
  return parseTimeAppRelease(manifest)
}

/** Enable only after the Time listing and signing continuity are verified. */
export function timeAppStoreUrl(): string | null {
  return process.env.TIME_APP_STORE_URL?.trim() === TIME_APP_STORE_URL ? TIME_APP_STORE_URL : null
}
