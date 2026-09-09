/**
 * Photo upload load scenario — k6
 *
 * Simulates field agents uploading visit-evidence photos.
 * Endpoint: POST /api/v1/mtm/photos (multipart/form-data)
 *
 * Response shape: { success: true, data: photo } at 201
 * SLO: P99 < 2 000 ms (multipart + file write + BullMQ enqueue)
 *
 * IMPORTANT — SETUP REQUIRED:
 *   - `agentId` must be a real cuid from the DB (set AGENT_CUID_LIST env var).
 *   - The JWT in AGENT_TOKEN must belong to the same org as the agents.
 *   - Rate limit: 30 uploads/min per agent (photos/route.ts). Under 351 VUs this
 *     may trigger 429 — raise the rate limit in .env.test or use more agent IDs.
 *
 *   Real photo fixture (recommended for bandwidth-accurate testing):
 *     Place a 2–4 MB JPEG at tests/load/fixtures/visit-evidence-sample.jpg then:
 *       import { open } from "k6/experimental/fs"
 *       const samplePhoto = open("./fixtures/visit-evidence-sample.jpg", "b")
 *     The minimal JPEG below validates format but does not test disk I/O at scale.
 */

import http from "k6/http"
import encoding from "k6/encoding"
import { sleep, check } from "k6"
import { Trend, Counter, Rate } from "k6/metrics"
import {
  RAMP_STAGES,
  SHARED_THRESHOLDS,
  authHeaders,
  baseUrl,
} from "../config.js"

const photoUploadLatency = new Trend("photo_upload_latency", true)
const photoUploadErrors = new Counter("photo_upload_errors")
const photoSuccessRate = new Rate("photo_success_rate")

export const options = {
  stages: RAMP_STAGES,
  thresholds: {
    ...SHARED_THRESHOLDS,
    photo_upload_latency: [
      { threshold: "p(95)<1500", abortOnFail: false },
      { threshold: "p(99)<2000", abortOnFail: false },
    ],
    // At least 90% of uploads should succeed (201) — leaves headroom for 429s under peak
    photo_success_rate: [{ threshold: "rate>0.90", abortOnFail: false }],
  },
}

/**
 * Minimal valid JPEG — 1×1 white pixel (12-byte magic number passes validation).
 * Replace with a real visit-evidence photo for bandwidth-accurate I/O simulation.
 * Route validates magic number (first 12 bytes): FFD8FF = JPEG.
 */
const MINIMAL_JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U" +
  "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARC" +
  "AABAAEDASIA/9oADAMBAAIRAxEAPwCgABmX/9k="

/**
 * Agent pool — must be real cuids from the mars tenant DB.
 * Set AGENT_CUID_LIST=id1,id2,... env var.
 */
function randomAgentId() {
  const list = (__ENV.AGENT_CUID_LIST ?? "").split(",").filter(Boolean)  // eslint-disable-line no-undef
  if (list.length === 0) {
    console.warn("AGENT_CUID_LIST not set — photo uploads will fail schema validation")
    return "placeholder-set-AGENT_CUID_LIST"
  }
  return list[__VU % list.length]  // eslint-disable-line no-undef
}

function randomVisitId() {
  const list = (__ENV.VISIT_CUID_LIST ?? "").split(",").filter(Boolean)  // eslint-disable-line no-undef
  if (list.length === 0) return ""
  return list[Math.floor(Math.random() * list.length)]
}

export default function photoUploadScenario() {
  const url = `${baseUrl()}/api/v1/mtm/photos`
  const token = __ENV.AGENT_TOKEN  // eslint-disable-line no-undef
  if (!token) throw new Error("AGENT_TOKEN env var required")

  const jpegBytes = encoding.b64decode(MINIMAL_JPEG_B64, "rawstd")
  const visitId = Math.random() < 0.7 ? randomVisitId() : ""

  const data = {
    file: http.file(jpegBytes, "visit-evidence.jpg", "image/jpeg"),
    agentId: randomAgentId(),
    ...(visitId ? { visitId } : {}),
  }

  const res = http.post(url, data, {
    headers: { "Authorization": `Bearer ${token}` },
  })
  photoUploadLatency.add(res.timings.duration)

  let body
  try { body = JSON.parse(res.body) } catch { body = {} }

  const ok = check(res, {
    "photo: status 201": (r) => r.status === 201,
    // Response: { success: true, data: { id, url, ... } }
    "photo: data.id present": () => typeof body?.data?.id === "string",
  })

  // 429 (rate limit hit) is not an error — it's expected under heavy load
  // Track true success rate (201) separately from server errors (5xx)
  photoSuccessRate.add(res.status === 201 ? 1 : 0)
  if (res.status >= 500) photoUploadErrors.add(1)
  // Suppress 400 on placeholder IDs (graceful no-env degradation)
  if (!ok && res.status !== 400 && res.status !== 429) photoUploadErrors.add(1)

  sleep(8 + Math.random() * 7)  // 8–15 s between uploads
}
