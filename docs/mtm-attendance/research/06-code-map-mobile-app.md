> Разведка 2026-10-13 для `docs/mtm-attendance/README.md`. Отчёт собран помощником-исследователем:
> пути и номера строк верны на эту дату, перед использованием сверяй с кодом. `<repo>` — корень репозитория.

All findings below are from `rashadoni/leaddrive-mtm` at `main` of 2026-10-12 (HEAD `9cefb74`). Paths are relative to `<WT>/MTMobileApp`, where `<WT>` = the root of a checkout of `rashadoni/leaddrive-mtm`. `node_modules` is not installed in either checkout, so library internals could not be read.

On Android the app root is `src/runtime/AndroidApp.tsx` (via `App.android.ts`), not `App.tsx`.

## 1. Workday flow

**Screens**
- `src/screens/today/TodayScreen.tsx` is the main one:
  - start/finish: `syncWorkday` (188-205), triggered by `requestWorkdayAction` (229), with an end-of-day confirm sheet (796-802);
  - break/resume: `toggleWorkdayBreak` (210-227), button at 520-547;
  - labels `todayV2.breakDay` "Fasilə", `todayV2.resumeDay` "Davam et", `todayV2.endDay` "Günü bitir" are in `src/i18n/mobile-resources.ts:1217-1237`.
- `src/screens/dashboard/DashboardScreen.android.tsx:346-358` (`toggleWorkday`) does start/end only.
- `src/screens/route/RouteScreen.tsx:1628-1641` (`handleStartWorkday`) does start only.

**Store**: `src/store/workday.ts`
- `start` (180-191), `end` (192-203), `pause` (204-215), `resume` (216-224), `reconcileFromServer` (225-290).
- Local state lives under AsyncStorage `@mtm_active_workday_v1` and `@mtm_finished_workday_v1`; each is one global slot whose `key` field is `tenantId:userId` (`workdayKey`, line 127).
- `pause`/`resume` are refused locally unless the workday is `CONFIRMED` (209, 218).
- `start` is refused locally if this account already finished today (183-184).

**Endpoint**: there is no dedicated workday endpoint. All four actions go into the generic outbox and are sent by `api.syncPush` (`src/services/api.ts:601-620`) as `POST {base}/mobile/sync/push`, where base is `https://<server>/api/v1/mtm`.

Request body:
```
{ clientId?: "<rf-… device id>", operations: [ { operationId, entity:"workdays", op:"create", data, clientTimestamp, attempts, nextAttemptAt, scopeKey, status } ] }
```
(The whole stored outbox item is sent, because `flushOutbox` passes the items straight through — `outbox.ts:205`.)

`data` per action (`workday.ts:189, 199, 211, 220`):

| Action | `data` |
|---|---|
| START | `{ action:"START", id:"wd-<Date.now()>-<random>", occurredAt }` |
| FINISH | `{ action:"FINISH", workdayId, occurredAt }` |
| PAUSE | `{ action:"PAUSE", workdayId, occurredAt }` |
| RESUME | `{ action:"RESUME", workdayId, occurredAt }` |

- **Timestamps**: `occurredAt` is `new Date().toISOString()` from the phone clock at the moment of the tap. `clientTimestamp` is `Date.now()` at enqueue (`outbox.ts:66`). Neither is a server time or a monotonic clock.
- **Coordinates, accuracy, mock flag**: none. A workday action carries no location at all.
- **Device**: only `clientId` in the body (commented "observational only", `api.ts:608-611`) plus the headers `x-field-device-id` and `x-field-apk-version` that every authenticated request gets (`api.ts:393-402`).
- The workday id is generated on the phone; the server creates the row with that id (comment at `workday.ts:116-118`).

**Offline queue**
- `src/services/outbox.ts`: AsyncStorage `@mtm_sync_outbox_v1`, each item scoped by `scopeKey = tenantId:userId` (`offline-scope.ts`).
- Drained by `flushRouteFieldOutbox` → `flushOutbox` in `src/services/sync-engine.ts:103-108`, as the `routeOutbox` pipeline of `runMobileSync` (227-240).
- Sync runs on login, on network regained, on app foreground (`AndroidApp.tsx:63-85, 193-207`), and right after each workday action via `refreshRouteFieldSession()` (`src/services/field-session.ts:14-65`).
- A queued action keeps its original `occurredAt` and `clientTimestamp`; retries only change `attempts`/`nextAttemptAt` (`outbox.ts:104-123`). There is no separate "sent at" field.
- A manual retry of a conflict gets a new `operationId` and a new `clientTimestamp`, but `data.occurredAt` stays (`outbox.ts:158-188`).
- A START is not trusted until the next bootstrap shows the workday open: state goes `START_PENDING` → `CONFIRMED` in `reconcileFromServer`. GPS tracking only starts for a `CONFIRMED`, non-paused workday (`AndroidApp.tsx:49-54`).

## 2. Device identity

**What exists**: `src/services/field-device-id.ts`
- An installation id `rf-<base36 time>-<rand>-<rand>-<rand>`, built from `Date.now()` and `Math.random()` (23-28).
- Stored in AsyncStorage under `@leaddrive_route_field_v3:device-id`.
- The file comment states it is not derived from Android hardware and "is not an authentication credential" (17-22).
- Nothing in the app removes it: logout only removes `@mtm_token` and `@mtm_agent` (`api.ts:525`). So it survives logout and account switch, and is lost on app-data clear or reinstall (`android:allowBackup="false"` in the manifest).

**Where it is sent today**
- Header `x-field-device-id` (plus `x-field-apk-version: 3.3.0+44`) on every request that has a token: `api.ts:393-402`, the session probe (328-332), and photo upload (1077-1080).
- Not sent on `POST /mobile/auth` (login): no token exists yet, so the header block is skipped, and the login body is `{ email, password, organizationSlug? }` (`api.ts:496-499`).
- Sent on `/mobile/bootstrap` and `/mobile/location` as a header only.
- Body `clientId` on `/mobile/sync/push` (`api.ts:612-618`).
- Explicit header on `POST /mobile/route-commands`, which fails without it (`api.ts:643-657`).
- Body `deviceId` on push registration: `POST /api/v2/mtm/mobile/route-field/device-tokens` with `{ token, platform:"android", deviceId, appVersion }` (`src/services/push-registration.ts:93-114`, `api.ts:904-914`).

**FCM token**
- Read through the custom native module `FieldPush` (`android/app/src/main/java/com/mtmobileapp/FieldPushService.kt:51-84`).
- Registered after login (`src/store/auth.ts:68`).
- On logout it is unregistered server-side and deleted, so the next agent gets a fresh token (`push-registration.ts:121-142`). It is therefore per-session, not a stable device identifier.

**Libraries in `package.json`**
- `react-native-device-info ^15.0.2` is a dependency but is imported nowhere; the only mention is a TODO comment at `App.tsx:25`. Android ID, model, brand and OS version are not read anywhere, in JS or Kotlin.
- Firebase Messaging is present natively (`android/app/build.gradle:145-146`), not as an RN package.
- `play-services-location:21.3.0` is present (`build.gradle:140`).
- Not found: `react-native-keychain`, any Keystore/EncryptedSharedPreferences use, Play Integrity, SafetyNet. The auth token itself is in plain AsyncStorage (`@mtm_token`).

## 3. Location reading

**`src/services/location-fix.ts`**
- `readLocationFix()` (53-66): high-accuracy read with 15 s timeout and `maximumAge 0`; falls back to low-accuracy, 10 s, `maximumAge 30 s`.
- `readRoughLocation()` (45-51): low-accuracy, 8 s, `maximumAge 120 s`; returns null on failure.
- Both return `LocationFixReading` (`src/screens/base/organization-location-fix-model.ts:41-48`): `latitude`, `longitude`, `accuracy?` (metres), `timestamp` (ms, the fix's own time, falling back to `Date.now()`), `mocked?`.
- `mocked` is read from the top-level `position.mocked` of `@react-native-community/geolocation` 3.4.0 (`location-fix.ts:25-31`) and only passed on if it is a boolean. I could not confirm the library sets it, because `node_modules` is absent.

**Mock detection today** exists in exactly one flow, «Клиент здесь» (customer pin correction):
- client check `locationFixProblem` returns `"mock"` (`organization-location-fix-model.ts:103`);
- payload `agent: { latitude, longitude, accuracyMeters, fixAgeSeconds, isMock? }` (117-138);
- sent to `POST /api/v2/mtm/mobile/route-field/organizations/:id/location-request` (`api.ts:869-879`);
- server refusal code `MTM_LOCATION_REQUEST_MOCK_LOCATION` (line 151);
- the same flow enforces accuracy ≤ 100 m and fix age ≤ 120 s (lines 20-26).

**Everything else has no mock flag**
- Background tracking (`src/services/location.android.ts`): `POST /mobile/location` with `{ latitude, longitude, accuracy?, speed?, heading?, altitude?, workdayId?, recordedAt, clientLocationId }` (282-314). `recordedAt` is the fix's own timestamp.
- The native fused stream `android/.../FieldLocationModule.kt:67-78` emits lat, lng, timestamp, accuracy, speed, heading, altitude, isMoving. It does not emit `isMock` / `isFromMockProvider`.
- Unsent GPS points go to `src/services/location-outbox.ts` (`@mtm_gps_outbox_v1`, capacity 600). This queue is one global key, not scoped per account; points carry `workdayId`.
- Visit check-in/out (`src/services/visit-outbox.ts:67-121`): `checkInAt`/`checkOutAt` from the phone clock, `checkInLat`/`checkInLng` only. The screens keep only latitude/longitude from the reading (`VisitScreen.tsx:572-612`, `RouteScreen.tsx:1746-1760`), so no accuracy, fix age or mock flag is sent.
- `src/services/self-location-share.ts` (manager one-shot): no mock flag.

## 4. Login

- **Server step**: `src/screens/server/ServerScreen.tsx:52-59` calls `api.pingServer` → `GET /mobile/ping`, then stores the domain in `@mtm_server`.
- **Login**: `src/screens/auth/LoginScreen.tsx:55-77` takes email + password (no code/OTP/QR login found) → `useAuthStore.login` (`src/store/auth.ts:57-72`) → `api.login` (`api.ts:487-517`).
- **Storage**: the bearer token goes to `@mtm_token` and the agent object to `@mtm_agent` (id, name, email, role, organizationId, organizationName, optional code). Only the email is kept for "remember me" (`@mtm_saved_login`); the password is never stored.
- **Logout** (`ProfileScreen.tsx:120-124` → `auth.ts:74-84`): unregisters the push token, removes token + agent, clears in-memory scope. "Switch server" (`auth.ts:101-111`) also removes server and saved email.
- **Revocation**: a 401 confirmed by a bootstrap probe forces logout (`api.ts:365-378`).
- **Several accounts one after another**: yes. One session at a time, and nothing binds the installation to an agent.
  - Per-account data kept on the phone after logout: outbox items (by `scopeKey`), the optimistic visit (`@mtm_active_visit_v2:<scope>`), sync cache and sync status.
  - Shared across accounts: the device id, the GPS outbox, and the single workday slot (which carries its owner's `key`).
  - `clearOutbox` and `clearQueue` are never called from app code (tests only), so a previous agent's unsent operations stay on disk until that agent logs in again.

## 5. Bootstrap switches

- **Request**: `GET /mobile/bootstrap` (`api.ts:555-557`), fetched by `src/store/bootstrap.ts:52-79` and mapped by `toBootstrap` in `src/services/bootstrap.ts:365-440`.
- **Policies read** (lines 407-425): `photoWatermark`, `canPlanOwnRoutes`, `fieldContactsEnabled`, `pharmacyPromotionsEnabled`, `checkInGeofenceRadiusMeters`, `contactClasses`, `agentPermissions`.
- **Other fields read**: `tenant`, `principal`, `capabilities`, `timezone`, `maps`, `routeTargetTypes`, `workday {id,status,workDate,startedAt,pausedAt,completedAt}`, `manifest`.
- **Helper**: `src/lib/agent-permissions.ts`
  - `AgentPermissionId` union (11-20) lists the known switches.
  - `agentMay(policies, id)` (43-45) hides only on an explicit `false`.
  - `agentMayCheckInOutsideZone` (57-59) is the opposite pattern: it requires an explicit `true`, for a feature that did not exist before its switch. That is the pattern a new attendance feature would follow.
  - Refusal code is `MTM_AGENT_PERMISSION_DISABLED`.
- **Where a new switch goes**:
  - If it lives inside `policies.agentPermissions`, no parser change is needed (`parseAgentPermissions` keeps any boolean key); add the id to the union and a helper.
  - If it is a new top-level policy, add it to `BootstrapPolicies` (`bootstrap.ts:92-128`) and to `toBootstrap`.
- **Usage examples**:
  - `useBootstrapStore((s) => agentMay(s.data?.policies, "customerLocationRequest"))` at `RouteOrganizationDetailScreen.android.tsx:292`;
  - `RouteContactsList.android.tsx:114`;
  - tab-level gating by `fieldContactsEnabled` at `src/navigation/AppNavigatorAndroidV2.tsx:181, 254`.
- **Screen registration**: `AppNavigatorAndroidV2.tsx:125-143` (More and Clients stacks) and 306-321 (root stack).
- **Manifest caveat**: it has `modules.workforceHrm`, but `ROUTE_FIELD_PROFILE.excludedModules` lists `workforceHrm` (`src/runtime/route-field-profile.ts:25`), with comments saying this APK never opens HRM data.

## 6. QR / camera

- `react-native-vision-camera ^4.7.3` is installed and the `CAMERA` permission is in the manifest.
- Its only use is `src/components/PhotoCaptureModal.tsx:13-17, 85-87, 306-312`: `Camera`, `useCameraDevice("back")`, `useCameraPermission`, with `photo={true}`.
- No QR or barcode scanning code was found: no `useCodeScanner`/`codeScanner`, no ML Kit or ZXing, and no `VisionCamera_enableCodeScanner` in `android/gradle.properties` or the gradle files. The only "barcode" hit is an icon name.

## Summary

**What the phone already sends that the server could use**
- `x-field-device-id` (stable per installation, survives account changes) and `x-field-apk-version` on every authenticated request; `clientId` on sync push; `deviceId` + FCM token on device-token registration.
- Workday START/FINISH/PAUSE/RESUME with a phone-clock `occurredAt`, a client-generated workday id and an idempotent `operationId`.
- GPS points during a confirmed workday: lat/lng, accuracy, speed, heading, altitude, `recordedAt` (fix time), `workdayId`, `clientLocationId`.
- Visit check-in/out coordinates with phone-clock times.
- `isMock`, `accuracyMeters` and `fixAgeSeconds`, but only on the customer location-request endpoint.

**What is available on the phone but not sent**
- The mock flag (`position.mocked`), accuracy and fix age for workday actions and visit check-ins; workday actions carry no location at all.
- `isFromMockProvider` on the native fused stream: the `Location` object is in hand in `FieldLocationModule.kt` but the field is not emitted.
- The device id at login (the header is skipped because there is no token yet).
- Any hardware/OS identity (Android ID, model, manufacturer, OS version): `react-native-device-info` is installed but unused.
- Any trusted time: all timestamps are phone clock; no server-time offset or elapsed-realtime value is captured.
- The FCM token as a secondary identifier: sent, but rotated on every logout.

**What would need a new native dependency or native work**
- QR scanning: no new package, but it is a native build change — vision-camera 4's code scanner has to be enabled in the Android build (gradle flag pulling in ML Kit), plus a new screen.
- A device identity the server can verify (hardware-backed key, attestation): needs Play Integrity and/or a Keystore module such as `react-native-keychain` or a custom Kotlin module; none is present. The current id is a random string in plain AsyncStorage.
- Mock flag on the fused stream: no dependency, a one-field Kotlin change in `FieldLocationModule.kt`.
- Android ID / model: no new dependency, only starting to use `react-native-device-info`.
- Secure token storage: would need Keychain/Keystore; not present.
