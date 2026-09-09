import { chromium } from "playwright"

const baseURL = (process.env.SOCIAL_SMOKE_BASE_URL || "").replace(/\/$/, "")
const email = process.env.SOCIAL_SMOKE_EMAIL || ""
const password = process.env.SOCIAL_SMOKE_PASSWORD || ""
const organizationSlug = process.env.SOCIAL_SMOKE_ORG_SLUG || "brandprotection"

const MONETARY_ROUTE_ADAPTERS = new Set([
  "APIFY_ASYNC",
  "BRIGHT_DATA_SNAPSHOT",
  "TIKTOK_BUSINESS_API",
  "X_API",
])

function isPaidCommentsSource(source) {
  return source?.ownership !== "owned"
    && (source?.url || source?.handle)
    && Array.isArray(source?.routePlans)
    && source.routePlans.some((route) => (
      route?.capability === "READ_EXTERNAL_COMMENTS"
      && [route?.primaryAdapter, ...(route?.fallbackAdapters || [])]
        .some((adapter) => MONETARY_ROUTE_ADAPTERS.has(adapter))
    ))
}

if (!baseURL || !email || !password) {
  throw new Error("social_smoke_credentials_not_configured")
}

const browser = await chromium.launch({ headless: true })
try {
  const context = await browser.newContext({ baseURL, locale: "en-US" })
  const csrfResponse = await context.request.get("/api/auth/csrf")
  if (!csrfResponse.ok()) throw new Error("csrf_request_failed")
  const { csrfToken } = await csrfResponse.json()

  const loginResponse = await context.request.post("/api/auth/callback/credentials", {
    headers: {
      // Match next-auth/react's signIn() protocol. Auth.js only converts its
      // callback redirect into the JSON response below when this header is
      // present; accepting an arbitrary 302 hid CredentialsSignin failures.
      "X-Auth-Return-Redirect": "1",
    },
    form: {
      csrfToken,
      email,
      password,
      organizationSlug,
      callbackUrl: `${baseURL}/social-monitoring?smoke=authenticated`,
    },
  })
  if (!loginResponse.ok()) {
    throw new Error(`credentials_callback_failed_${loginResponse.status()}`)
  }
  const loginPayload = await loginResponse.json().catch(() => null)
  if (!loginPayload?.url) throw new Error("credentials_callback_payload_invalid")
  const loginRedirect = new URL(loginPayload.url, baseURL)
  const loginError = loginRedirect.searchParams.get("error")
  if (loginError) throw new Error(`credentials_callback_rejected_${loginError}`)

  const authCookies = await context.cookies(baseURL)
  if (!authCookies.some((cookie) => cookie.name.endsWith("authjs.session-token"))) {
    throw new Error("authenticated_cookie_missing")
  }

  const sourcesResponse = await context.request.get("/api/v1/social/monitoring-sources?limit=200&targetKind=direct")
  if (!sourcesResponse.ok()) throw new Error(`monitoring_sources_api_failed_${sourcesResponse.status()}`)
  const payload = await sourcesResponse.json()
  if (payload?.success === false || !Array.isArray(payload?.data?.sources)) {
    throw new Error("monitoring_sources_payload_invalid")
  }
  const paidCommentsSource = payload.data.sources.find(isPaidCommentsSource)

  const policyResponse = await context.request.get("/api/v1/social/paid-run-policy")
  if (!policyResponse.ok()) throw new Error(`paid_run_policy_api_failed_${policyResponse.status()}`)
  const policyPayload = await policyResponse.json()
  const paidRunReport = policyPayload?.data
  if (!paidRunReport?.policy || !paidRunReport?.usage) {
    throw new Error("paid_run_policy_payload_invalid")
  }
  const paidRunAuthorized = Boolean(
    paidRunReport.globalEnforcementEnabled
    && paidRunReport.policy.manualRunsEnabled
    && !paidRunReport.policy.emergencyStopped
    && paidRunReport.policy.maxPerRunUsd > 0
    && paidRunReport.usage.dayRemainingUsd > 0
    && paidRunReport.usage.monthRemainingUsd > 0
  )

  const page = await context.newPage()
  let providerRunRequestCount = 0
  let directPickerRequestCount = 0
  page.on("request", (request) => {
    const requestUrl = new URL(request.url())
    if (request.method() === "POST" && /\/api\/v1\/social\/monitoring-sources\/[^/]+\/run$/.test(requestUrl.pathname)) {
      providerRunRequestCount += 1
    }
    if (
      request.method() === "GET"
      && requestUrl.pathname === "/api/v1/social/monitoring-sources"
      && requestUrl.searchParams.get("targetKind") === "direct"
    ) {
      directPickerRequestCount += 1
    }
  })

  await page.goto("/social-monitoring?view=sources&smoke=authenticated", { waitUntil: "domcontentloaded" })
  if (new URL(page.url()).pathname === "/login") throw new Error("authenticated_session_not_established")

  if (paidCommentsSource?.id) {
    const runButton = page.getByTestId(`social-source-run-${paidCommentsSource.id}`)
    await runButton.waitFor({ state: "visible", timeout: 60_000 })
    await runButton.click()

    const capabilitySelect = page.getByTestId("social-paid-run-capability")
    await capabilitySelect.waitFor({ state: "visible", timeout: 15_000 })
    await capabilitySelect.selectOption("READ_EXTERNAL_COMMENTS")

    await page.getByTestId("social-paid-run-policy-status").waitFor({ state: "visible", timeout: 15_000 })

    const automaticCap = page.getByTestId("social-paid-run-automatic-cap")
    const confirmButton = page.getByTestId("social-paid-run-confirm")
    if (paidRunAuthorized) {
      await automaticCap.waitFor({ state: "visible", timeout: 15_000 })
      if (!/\d/.test((await automaticCap.textContent()) || "")) {
        throw new Error("paid_comments_automatic_cap_missing")
      }
      if (await confirmButton.isDisabled()) {
        throw new Error("paid_comments_run_not_authorized")
      }
    } else {
      if (await automaticCap.count()) {
        throw new Error("paid_comments_cap_visible_while_blocked")
      }
      if (!(await confirmButton.isDisabled())) {
        throw new Error("paid_comments_run_enabled_while_blocked")
      }
    }
  } else {
    console.warn("Paid comments dialog smoke skipped: no external comments source is configured for this clean tenant")
  }
  if (providerRunRequestCount !== 0) throw new Error("paid_comments_smoke_started_provider_run")

  // A new monitoring searches providers globally. It must not load or expose
  // the old saved-source picker, and the smoke never saves or starts a run.
  directPickerRequestCount = 0
  await page.goto("/social-monitoring?view=monitors&smoke=global-search", { waitUntil: "domcontentloaded" })
  // The wizard can disappear between two steps of this flow: the click opens it,
  // then a re-render of the page subtree takes it away again. `domcontentloaded`
  // guarantees markup, never a settled client tree — and on this app it does not
  // even guarantee the button: the dashboard layout renders a spinner until the
  // session resolves, so nothing under /social-monitoring is in the SSR HTML.
  // This bit the deploy that switched the production build to Turbopack (later
  // hydration), and again on 2026-08-11, when the layout keyed the page subtree
  // on the JWT iat and remounted everything on the first session refetch.
  //
  // Retry the open instead of widening the timeout. The assertion below is
  // untouched: a wizard that genuinely fails to mount still fails the smoke,
  // it just no longer fails for being clicked one moment too early.
  const newProfileButton = page.getByTestId("social-profile-new")
  const profileName = page.locator("#profile-name")

  // «Новый мониторинг» намеренно заблокирован, пока идёт сбор:
  //   disabled={Boolean(runningProfileId) || bulkActive || bulkJobMutating}
  // Сбор идёт по крону и длится десятками минут — на проде задание висело в
  // WAITING_PROVIDER с 17:08 до 17:56 и завалило деплой, хотя приложение было
  // исправно. Гейт, падающий от штатного состояния тенанта, бесполезен: он
  // блокирует выкатку случайным образом.
  //
  // Поэтому ждём разблокировки ограниченное время, а если сбор всё ещё идёт —
  // пропускаем эту часть с явным предупреждением, как уже сделано для диалога
  // платных прогонов. Пропуск виден в логе, а не растворяется в «зелёном».
  await newProfileButton.waitFor({ state: "visible", timeout: 30_000 })
  let wizardReachable = false
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (await newProfileButton.isEnabled()) {
      wizardReachable = true
      break
    }
    await page.waitForTimeout(5_000)
  }
  if (!wizardReachable) {
    console.warn(
      "Global-search wizard smoke skipped: a monitoring run is in progress, so «new monitoring» is disabled by design",
    )
  } else {
  await newProfileButton.click()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await profileName.count()) break
    await page.waitForTimeout(2_000)
    // The button is gone once the wizard replaces the list, so re-click only
    // while it is still on screen.
    if (await newProfileButton.count()) await newProfileButton.click().catch(() => {})
  }
  await profileName.fill(`Global search smoke ${Date.now()}`)
  const nextButton = page.getByTestId("social-profile-next")
  await nextButton.waitFor({ state: "visible", timeout: 15_000 })
  await nextButton.click()
  // Both flaky failures of this step were a torn-down page, not a broken wizard
  // («element was detached from the DOM» on the click; the step-2 hint absent for
  // 30s after a click that had already succeeded). A bare locator timeout named
  // neither cause and no evidence was uploaded, because the screenshot below only
  // runs on success. So: still fail — a wizard that cannot reach step 2 must fail
  // the gate — but say which of the two it was, and leave a picture behind.
  try {
    await page.getByTestId("social-profile-global-search-hint").waitFor({ state: "visible", timeout: 30_000 })
  } catch (err) {
    await page.screenshot({ path: "social-monitoring-wizard-smoke.png", fullPage: true }).catch(() => {})
    if (!(await page.getByTestId("social-profile-wizard").count())) {
      throw new Error("social_profile_wizard_disappeared_mid_flow")
    }
    throw err
  }
  if (await page.getByTestId("social-profile-select-all").count()) {
    throw new Error("social_profile_source_picker_still_present")
  }
  if (await page.getByTestId("social-profile-external-source-hint").count()) {
    throw new Error("social_profile_source_picker_hint_still_present")
  }
  if (await page.locator("#saved-source-search").count()) {
    throw new Error("social_profile_source_search_still_present")
  }
  if (directPickerRequestCount !== 0) {
    throw new Error("social_profile_source_picker_api_requested")
  }
  await page.screenshot({ path: "social-monitoring-wizard-smoke.png", fullPage: true })
  }

  console.log(
    `Authenticated Social Monitoring smoke passed: tenant API + ${
      paidCommentsSource?.id ? "paid comments dialog (no provider run)" : "clean tenant without a paid comments source"
    } + ${
      wizardReachable ? "global-search wizard without a saved-source picker" : "wizard skipped (monitoring run in progress)"
    }`,
  )
} finally {
  await browser.close()
}
