/**
 * Fail-closed guard for every script that writes into `public/marketing/`.
 *
 * Why this exists
 * ---------------
 * `public/marketing/` is inside `public/`, so Next.js serves it to anonymous
 * visitors. On 2026-08-31 all 29 files there turned out to be captures of the
 * live tenant «Güvən Technology LLC»: client company names, an invoice ledger
 * with overdue balances, a top-10-clients-by-revenue table, the vendor's own
 * P&L, and the full name, work e-mail and mobile number of three client-side
 * contacts. See `docs/isms/evidence/2026-08-31-marketing-screenshots-data-exposure.md`.
 *
 * The failure was not that redaction was missing. `capture-screenshots.mjs`
 * already carried an anonymiser — a list of literal strings to replace. It
 * failed for the two reasons a denylist always eventually fails:
 *
 *   1. It fails OPEN. Anything not on the list is published. Of the real
 *      identifiers that leaked, none were on it: AGRARCO, AGHDAM GARDEN HOTEL,
 *      ATS FOOD, AZERTEXNOLAYN, Synergia Academy, Afigroup, Pharmastore,
 *      Azmade, Emil Rahimsoy, elvin.abushev@…, tarlan.mammadli@…, +994 50 377
 *      83 38, 727,938.27, 646,755.
 *   2. A typo silently disables a rule with no error. The list tried to mask
 *      `AGRARGO`; the tenant's actual client is `AGRARCO`. That rule could
 *      never match, and nothing said so.
 *
 * So the control here is inverted. Instead of enumerating what must be hidden,
 * it asserts what must be true: the browser is looking at the designated demo
 * tenant. If that cannot be positively confirmed, nothing is written. A new
 * client signing up tomorrow does not weaken it, because it never depended on
 * knowing their name.
 *
 * The marker scan below is a second, subordinate net. It is deliberately NOT
 * the primary control — treat a marker hit as proof the tenant check was
 * misconfigured, not as routine redaction doing its job.
 */

/**
 * Org names that may appear in a marketing screenshot. Nothing else may.
 *
 * `env` is typed as a loose record rather than left to inference: defaulting to
 * `process.env` would infer `NodeJS.ProcessEnv`, and callers passing a plain
 * object literal — every test does — would fail assignability.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {string}
 */
export function requireDemoTenant(env = process.env) {
  const org = env.SCREENSHOT_DEMO_ORG?.trim() || ""
  if (!org) {
    throw new Error(
      "SCREENSHOT_DEMO_ORG is required.\n" +
        "Set it to the exact organisation name shown in the app header of the demo tenant, e.g.\n" +
        "  SCREENSHOT_DEMO_ORG='Acme Corp'\n" +
        "Capturing without it is refused: that is how the 2026-08-31 exposure happened.",
    )
  }
  return org
}

/**
 * Substrings that must never reach `public/marketing/`.
 *
 * Every entry is something observed in the leaked files, kept so a regression
 * is caught loudly. This list is a tripwire, not a filter — it is not expected
 * to be complete and must never be relied on as if it were.
 */
const REAL_DATA_MARKERS = [
  // Live tenant and operator
  "Güvən Technology", "Güven Technology", "Guven Technology", "Emil Rahimsoy",
  // Client organisations seen in the leaked captures
  "ZEYTUN", "Zeytun", "zeytunpharma", "AGRARCO", "AGHDAM", "ATS FOOD",
  "AZBADAM", "AZERTEXNOLAYN", "AZERBAIJAN FISH FARM", "Azerbaijan Poultry",
  "Azerbaijan Green Energy", "MARS OVERSEAS", "Facility Management Group",
  "Synergia Academy", "Afigroup", "Pharmastore", "Azmade", "Pmdgroup",
  "Promisgroup", "Gimnastika Federasiyası", "AAC\" MMC",
  // Named individuals
  "Elvin Abushev", "Tarlan M. Mammadli", "Jahan Kh. Pashayev",
  // Real corporations named in docs/screenshots (fabricated relationships)
  "SOCAR", "Kapital Bank", "Azercell", "Pasha Holding", "PASHA Bank",
  "Azersun", "AzerGold", "Port of Baku", "Silk Way Airlines", "ASAN Xidmet",
  "ASAN Xidmət", "Bakcell", "Bravo Supermarket", "ABB Sigorta", "abbsigorta",
  // Figures that identify the live tenant's books
  "616 367", "616,367", "646,755", "727,938", "236,130", "2,019,731",
  "1,849,100", "489,861", "59,709", "38,331",
  // Contact details
  "+994 50 377 83 38", "+99450 251-72-23", "+994512060838",
  "rashad.rahimov@", "rashadrahimsoy@", "@zeytunpharma.az", "@azmade.az",
]

/**
 * Confirm the page really shows the demo tenant.
 *
 * `pageText` should be the rendered text of the page about to be captured
 * (`await page.innerText("body")` in Playwright).
 *
 * Throws unless the demo org name is present. Absence is treated as failure,
 * not as "probably fine" — a blank or still-loading page must not be captured
 * either, because it proves nothing about which tenant is logged in.
 *
 * `pageText` admits null/undefined on purpose: those are exactly the cases a
 * caller hits when the page has not rendered, and they must reach the check
 * rather than be blocked by the type system at the call site.
 *
 * @param {string | null | undefined} pageText
 * @param {string} expectedOrg
 * @param {string} [label]
 * @returns {void}
 */
export function assertDemoTenant(pageText, expectedOrg, label = "page") {
  const text = String(pageText || "")

  if (!text.includes(expectedOrg)) {
    throw new Error(
      `Refusing to capture ${label}: expected organisation ${JSON.stringify(expectedOrg)} ` +
        `was not found on the page.\n` +
        `Either the session belongs to a different tenant, or the page had not rendered. ` +
        `Both are reasons to stop, not to continue.`,
    )
  }

  const hits = REAL_DATA_MARKERS.filter((m) => text.includes(m))
  if (hits.length > 0) {
    throw new Error(
      `Refusing to capture ${label}: real-tenant data on screen — ${hits.slice(0, 8).join(", ")}` +
        `${hits.length > 8 ? ` (+${hits.length - 8} more)` : ""}.\n` +
        `The demo org name was present, so this is probably a demo tenant seeded from ` +
        `production data. Fix the seed; do not mask these strings.`,
    )
  }
}

/** Exposed for tests. */
export const __REAL_DATA_MARKERS = REAL_DATA_MARKERS
