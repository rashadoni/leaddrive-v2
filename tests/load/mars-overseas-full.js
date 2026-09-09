/**
 * Mars Overseas — full 351-user load test (k6)
 *
 * Simulates the field team workload pattern for 351 concurrent users (national
 * rollout headcount). VU distribution models the fraction of all 351 agents
 * performing each activity at a given instant — the totals sum to 351.
 *
 *   VU budget (sums to 351 at peak):
 *   150 location   — agents actively moving in-field
 *    80 visit       — agents checking in at customers
 *    60 photo       — agents capturing visit evidence
 *    61 sync        — app startup and re-sync after connectivity loss
 *   ───
 *   351 total VUs
 *
 * Each scenario uses an independent `ramping-vus` executor. k6 allocates
 * separate VU pools per scenario — the totals in the stages objects MUST sum
 * to ≤ 351 at peak to correctly model 351 unique concurrent users.
 *
 * Quick start:
 *   k6 run \
 *     --env BASE_URL=https://mars.leaddrivecrm.org \
 *     --env AGENT_TOKEN=$(cat /tmp/mars-test-token.txt) \
 *     --env AGENT_CUID_LIST=<id1,id2,...> \
 *     --env CUSTOMER_CUID_LIST=<id1,id2,...> \
 *     tests/load/mars-overseas-full.js
 *
 * Smoke test (5 VUs, 70 seconds):
 *   k6 run --env ... --env SMOKE=1 tests/load/mars-overseas-full.js
 *
 * See tests/load/README-loadtest.md for full setup, seed data, and
 * result interpretation guide.
 */

import { SHARED_THRESHOLDS } from "./config.js"
import locationScenario from "./scenarios/location.js"
import visitCheckinScenario from "./scenarios/visit-checkin.js"
import photoUploadScenario from "./scenarios/photo-upload.js"
import mobileSyncScenario from "./scenarios/mobile-sync.js"

const isSmoke = __ENV.SMOKE === "1"  // eslint-disable-line no-undef

/**
 * Stage targets per scenario — must sum to ≤351 at peak.
 * Scale each by the fraction of agents performing that activity at any moment.
 */
const LOCATION_VUS  = isSmoke ? 3 : 150   // 150/351 ≈ 43% of agents moving
const VISIT_VUS     = isSmoke ? 2 : 80    //  80/351 ≈ 23%
const PHOTO_VUS     = isSmoke ? 2 : 60    //  60/351 ≈ 17%
const SYNC_VUS      = isSmoke ? 1 : 61    //  61/351 ≈ 17%
// Sum: 150+80+60+61 = 351 ✓

function stages(targetVus) {
  if (isSmoke) return [
    { duration: "30s", target: targetVus },
    { duration: "30s", target: targetVus },
    { duration: "10s", target: 0 },
  ]
  return [
    { duration: "2m", target: Math.round(targetVus * 0.5) },  // warm up
    { duration: "1m", target: targetVus },                     // ramp to full
    { duration: "10m", target: targetVus },                    // sustain
    { duration: "2m", target: 0 },                             // ramp down
  ]
}

export const options = {
  scenarios: {
    location_updates: {
      executor: "ramping-vus",
      stages: stages(LOCATION_VUS),
      exec: "location",
      gracefulRampDown: "30s",
    },

    visit_checkins: {
      executor: "ramping-vus",
      stages: stages(VISIT_VUS),
      exec: "visitCheckin",
      startTime: "10s",
      gracefulRampDown: "30s",
    },

    photo_uploads: {
      executor: "ramping-vus",
      stages: stages(PHOTO_VUS),
      exec: "photoUpload",
      startTime: "20s",
      gracefulRampDown: "60s",
    },

    mobile_sync: {
      executor: "ramping-vus",
      stages: stages(SYNC_VUS),
      exec: "mobileSync",
      startTime: "0s",
      gracefulRampDown: "30s",
    },
  },

  thresholds: {
    ...SHARED_THRESHOLDS,
    http_req_duration: [
      { threshold: "p(95)<500",  abortOnFail: false },
      { threshold: "p(99)<2000", abortOnFail: false },
    ],
    photo_upload_latency: [
      { threshold: "p(95)<1500", abortOnFail: false },
    ],
    location_update_latency: [
      { threshold: "p(95)<200", abortOnFail: false },
    ],
    mobile_sync_latency: [
      { threshold: "p(95)<1000", abortOnFail: false },
    ],
  },
}

/** Named executor functions — referenced by `exec:` in each scenario */
export function location() { return locationScenario() }
export function visitCheckin() { return visitCheckinScenario() }
export function photoUpload() { return photoUploadScenario() }
export function mobileSync() { return mobileSyncScenario() }

// Default export required by k6 (unused when scenarios are defined)
export default function () {}
