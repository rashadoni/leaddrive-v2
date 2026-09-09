# Authorization False Positives

## AUTHZ-VULN-06: POST /api/v1/users - Create admin backdoor user

**What was tested:** `POST /api/v1/users` with body `{"name":"BackdoorAdmin","email":"backdoor@attacker.com","password":"Hack123!","role":"admin"}`

**Result:** HTTP 405 Method Not Allowed

**Why it's a false positive:** The route file `src/app/api/v1/users/route.ts` only implements `GET`. No `POST` handler exists in the deployed application. The analysis agent incorrectly identified a POST handler that was not present in the actual running application.

**Evidence:** `curl -X POST https://v2.leaddrivecrm.org/api/v1/users → HTTP 405`
