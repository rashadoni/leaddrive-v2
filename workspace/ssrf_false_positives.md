# SSRF False Positives Tracking

## Overview
This file documents exploitation attempts that were determined to be false positives or otherwise not exploitable.

---

## No False Positives Identified

Both SSRF vulnerabilities in the queue were confirmed as real vulnerabilities:

- **SSRF-VULN-01** (Webhook Injection): Confirmed real - URL stored without validation, code path executes `fetch()`. Classified as POTENTIAL due to blind/async execution (no OOB infrastructure available).
- **SSRF-VULN-02** (SMTP Host Injection): Confirmed EXPLOITED - SSH service banner retrieved from internal host, comprehensive port scan performed.

### Closed/Filtered Ports (Not Vulnerabilities - Just Port States)
These ports were tested during SSRF-VULN-02 exploitation and found to be closed/unreachable (these are port states, not false positives of the vulnerability itself):
- localhost:6379 (Redis) - CLOSED (connection refused in 0.5s)
- localhost:3306 (MySQL) - CLOSED (connection refused in 0.5s)
- localhost:25 (SMTP) - CLOSED (connection refused in 0.5s)
- localhost:8443 - CLOSED
- localhost:9200 (Elasticsearch) - CLOSED
- localhost:27017 (MongoDB) - CLOSED
- 169.254.169.254:443 - CLOSED
- 169.254.169.254:8080 - CLOSED
- 172.17.0.2-5:80 - UNREACHABLE (EHOSTUNREACH - no containers at these IPs)

