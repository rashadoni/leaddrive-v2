> Разведка 2026-10-13 для `docs/mtm-attendance/README.md`. Отчёт собран помощником-исследователем:
> пути и номера строк верны на эту дату, перед использованием сверяй с кодом. `<repo>` — корень репозитория.

# Attendance / leave module research: mature-product comparison

Source keys are reference links, resolved in **Sources** at the end. Keys ending in `-s` are search-snippet only (the help centre returned 403 or a login page), so treat them as lower confidence.

## 0. Coverage and confidence

| Status | Products |
|---|---|
| Help-centre pages read | Zoho People, greytHR, Jibble, Connecteam, Buddy Punch, Factorial, Kenjo, Bitrix24 |
| Product page or vendor blog only | Truein [ti], Giriton [gi], DATABASICS [db] |
| Snippet only (help centre blocked the fetcher) | Keka, Deputy, Personio |
| Not found / not retrieved | Darwinbox, BambooHR, Контур.Персонал/Табель, Мой график/Кайрос |
| 1С:ЗУП | Only the T-13 code table (secondary site, partial) [t13] and code-reference rules [zup-codes]. The concept article is paywalled, so its mechanics are not found. |

## 1. Leave / time off

| Aspect | What the documentation shows |
|---|---|
| Built-in types | Factorial ships holidays, sick leave and maternity/paternity [fa-types]. Zoho classifies types as Paid, Unpaid, On Duty or Restricted Holiday [zp-leave]. Kenjo uses three classes: paid, unpaid, and "other absence" where work continues (home office, business travel) [kj-abs]. Jibble, Connecteam and Buddy Punch offer paid/unpaid [jb-pto] [ct-timeoff] [bp-pto-index]. |
| Custom type attributes (Factorial) | Name, colour, name visible to employees, deducted from allowance, counts as paid, half-day allowed, end date required, min/max days, employees may request, attachments allowed, description mandatory, approval required [fa-types]. |
| Custom type attributes (Kenjo) | Public or private visibility. "Excused" if approved, always unexcused, or only with a document. Document optional, mandatory, or mandatory after a threshold (certificate from the 4th sick day). Admin-only creation, probation block, recurring requests [kj-abs]. |
| Custom type attributes (Zoho) | Applicability by gender, marital status, department, designation, location, employment type or named employees. File upload required when leave exceeds N days. Min/max consecutive days, advance notice, past-dated limit. "Clubbing policy" lists types that cannot be combined [zp-leave]. |
| Unit | Zoho: days or hours [zp-leave]. Jibble: days or hours, fixed per policy, with half-day shown in the calendar [jb-pto] [jb-cal]. Kenjo: days or hours, never both for one type per employee; half-days only for day-based policies [kj-abs]. Factorial: days or hours; hourly requests can be forced into 15/30-minute blocks (article title only) [fa-allow] [fa-index]. Personio: a half-day reads its hours from the work schedule [ps-half-s]. |
| Entitlement and accrual | Zoho: fixed, experience-based, grant-based or attendance-based; accrues yearly, monthly, weekly or instantly; minimum worked days threshold [zp-leave]. Factorial: all at once, daily, monthly (1st, 15th or last day) or twice a month; tenure periods add days [fa-allow]. Kenjo: monthly or upfront, in advance or in arrears, fixed or unlimited; cycle starts at hire date or 1 January [kj-abs]. Jibble: none, annual or monthly [jb-pto]. Deputy: a rate per approved timesheet hour (0.1 means 10 hours earn 1) [dp-leave-s]. |
| Proration for mid-cycle hire or exit | Zoho: "Start of Policy", "Start and End of Policy" or "Do Not Prorate" [zp-leave]. Factorial: pro-rated by months to be worked, or full allocation [fa-allow]. Kenjo: none, day-exact or monthly, by start or contract-end date, with a part-time factor (3 ÷ 5 × 24) [kj-abs]. Jibble: annual accrual is prorated [jb-pto]. |
| Carry-over | Zoho: reset on/off, encashment, maximum balance, expiry [zp-leave]. Factorial: limited carry-over with expiry (e.g. three months into the new cycle) [fa-allow]. Kenjo: maximum plus an expiry date that zeroes the balance automatically without notice [kj-abs]. Jibble: amount to carry and when it expires [jb-pto]. Buddy Punch: annual carry-over limit and maximum balance [bp-pto-index]. Personio: carry-over entitlement and expiry are editable [ps-carry-s]. |
| Negative balance | Factorial: "Can the counter go negative?" [fa-allow]. Kenjo: allowed up to a maximum, otherwise blocked [kj-abs]. Zoho: "Exceeded leaves" without limit or until a year-end limit; the excess is set against future credits or marked loss of pay [zp-leave]. Buddy Punch: on/off toggle [bp-pto-index]. |
| Approval | Jibble: up to 3 levels (direct manager, group manager, admin, owner, named people); one approver per level is enough; a rejection at any level ends the request [jb-appr]. Kenjo: two-tier, with delegation while the manager is absent [kj-abs]. Factorial: approval per type, and a "global approver" at the last level has the final say [fa-types] [fa-faq]. Zoho: pending requests are auto-approved or auto-rejected at pay-period processing [zp-pay]. Managers can enter leave on someone's behalf in Deputy [dp-behalf-s] and Connecteam [ct-timeoff]. |
| Who-is-away calendar | Jibble: monthly calendar with scopes (organisation, "Managed by me", personal); approved has a solid border, pending a dotted one; public holidays shown [jb-cal]. Factorial: visible company-wide or restricted [fa-faq]. Zoho: syncs to Google/M365 with event status per leave type [zp-leaveopt]. Buddy Punch: shared time-off calendar [bp-pto-index]. Bitrix24: «График отсутствий» for отпуска, командировки, больничные [bx-overview]. |
| Blackout rules | Factorial: blocked periods per absence type and per employee; the dates cannot be selected; admins exclude individuals for emergencies [fa-blocked]. Kenjo: «Urlaubssperren» per absence policy; a hard block that can be paused [kj-block]. Buddy Punch: blackout dates block employees, but managers and admins can still enter time off [bp-blackout]. |
| Holidays and weekends inside leave | Zoho: sandwich policy (include/exclude, threshold, calendar or business days, extend to adjacent days) [zp-leaveopt]. Jibble: "Exclude public holidays" and "Exclude non-working days" [jb-pto]. Kenjo: two separate decisions, days deducted and hours per day, plus "deduct 0h on public holidays" [kj-deduct]. Factorial: working days or calendar days [fa-allow]. |
| How approved leave shows in the timesheet | Jibble: paid time off "is calculated towards payroll hours"; unpaid is not [jb-pto]. Connecteam: appears in the timesheet with paid/unpaid totals; an overlapping shift raises a conflict [ct-timeoff] [ct-conflicts]. Buddy Punch: PTO hours are added to timesheets [bp-features]. Zoho: can "Restrict attendance entries on approved leave" and include paid leave in payable hours [zp-checkin] [zp-policy]. Factorial: a full-day absence moves the overlapping shift to a manager-only "backup" state [fa-shiftleave]. |
| Cancelling or extending | Zoho: owner, manager or approver may cancel; partial cancellation; mandatory reason; limited to the current or previous n pay periods; a separate "leave extension" request [zp-leavereq]. Factorial: future absences can be deleted; a past absence only by another admin; none once it has begun; the balance is recalculated [fa-delete]. |

## 2. Short absences during the day

| Product | Model | Limits | Effect on late/early calculation |
|---|---|---|---|
| Zoho People | Separate "Hourly permission" request [zp-perm] | Total time per week or month, min and max per request, number of requests per period. Must fall within shift time. Reason and proof can be mandatory. Scoped by location or department [zp-perm]. | Not found. The entry does count as an "office-in" source [zp-office]. |
| Zoho People | "On duty" with hourly or quarter-day duration [zp-od] | Can block future dates; description and documents can be mandatory [zp-od]. | Not found. |
| greytHR | "Permission" (short leave) request [gh-perm] | Hour-wise or session-wise slabs. Daily, weekly and monthly caps on both hours and count (example: 4 hours and 2 requests a week). Past and future day limits. Can be restricted by hours already worked [gh-policy]. | A backdated approved permission flows into Attendance Info on reprocessing [gh-perm]. The vendor says it "helps employees avoid attendance regularization" [gh-search-s]. |
| Keka | "Partial day" request for late arrival or early leaving, plus hourly and quarter-day leave [keka-partial-s] | X minutes within the shift, typically 30–120 [keka-partial-s]. | Expected hours are adjusted, so approved short leave draws no penalty for late login or shortage [keka-pen-s]. |
| Factorial | Hourly absence type [fa-allow] | 15/30-minute request blocks (article title only) [fa-index]. | Half-day and hourly absences do not remove the shift [fa-shiftleave]. Effect on lateness not found. |
| Jibble | Hours-based time-off policy [jb-pto] | Entitlement in hours [jb-pto]. | Not found. |
| Connecteam | Manager sets a shift status [ct-status] | Statuses: On Time, Late In ("arrived late without a valid excuse"), Callout (gave notice), No Show [ct-status]. | The status is the excuse; no request flow found. |
| Bitrix24 | No short-leave request found | «На сколько можно опоздать на смену», minimum hours per day, «Допустимая недоработка за отчётный период» [bx-sched]. | The manager is notified of violations [bx-sched]. |

Zoho's unexcused-lateness rule is the fullest one documented [zp-grace]:
- Grace time applies to first check-in, last check-out, working hours and core hours.
- N deviations are allowed per week, month or pay period, with an option to penalise every nth one.
- The penalty is 0.25, 0.5 or 1 day taken from a chosen leave type.
- Several deviations in one day draw only the highest penalty.
- The employee is emailed.

Three modelling patterns appear:
- **Hours-based leave type with a balance:** Zoho, Jibble, Factorial, Kenjo.
- **Separate "permission" request with period caps and no balance:** Zoho, greytHR.
- **"Partial day" request that shifts expected hours:** Keka.

## 3. Attendance regularization (missed punch / time correction)

| Aspect | What the documentation shows |
|---|---|
| Who submits | Zoho: any employee; managers handle their reports [zp-search-s]; an admin can add a request for any employee [zp-regops]. Keka: employee, or admin on their behalf [keka-reg-s] [keka-behalf-s]. Bitrix24: the employee edits start, breaks and end, and «все изменения отправляются руководителю на подтверждение» [bx-mobile]. |
| Request content | Zoho: date, time range, reason from a list, description and proof (each can be mandatory) [zp-reg]. |
| Limits | Zoho: only within N days of the date (example 7); a cap per period (example 1 day a week); optional future dates; optionally "only on approved remote work days" [zp-reg]. greytHR: past/future day limits and attendance-based restrictions (documented for permissions) [gh-policy]. Bitrix24: «Допустимое редактирование рабочего дня сотрудником» [bx-sched]. |
| Two kinds of correction (Keka) | "Adjust attendance logs", where a penalty may still apply, versus "Regularise to exempt from tracking policy", where the day is exempt [keka-reg-s]. |
| What an approved request does (Zoho) | Either "Create a new check-in / check-out entry" or "Replace the existing first check-in / last check-out entry"; with no approval flow it is applied directly [zp-reg]. |
| Approval | greytHR: 1–5 levels with Forward/Accept/Reject, auto-approve after N days, self-approval option [gh-policy]. Factorial: the manager approves or rejects but cannot edit the request, and sees its effect on total hours [fa-edit]. Kenjo: entries approved singly or in bulk per month [kj-approve]. |
| Before approval | Factorial: "Pending Request" label; a missed clock-out leaves the shift open with a "!" [fa-edit] [fa-missed]. Bitrix24: unconfirmed days are excluded from worked-hours totals and can be filtered [bx-control]. |
| Audit trail | Connecteam: blue dot for "created by an admin", orange for "modified by an admin"; exportable audit log of who and when [ct-audit]. greytHR: admin override by status or by time per session, with remarks; an Override history tab with Excel export [gh-override]. Factorial: activity log of clock-ins, edits, forgotten clock-outs and approvals [fa-log]. Buddy Punch: Deleted Time report and punch-change notifications [bp-reports] [bp-notif]. |
| Original versus corrected, side by side | Not found as a documented timesheet view. The nearest is Connecteam rounding, which keeps the unrounded time on hover and in four export columns [ct-round]. |
| Admin exemption without punches | greytHR "Attendance exception": date range, status and reason, to prevent loss of pay [gh-exc]. |
| Lock | Zoho: no attendance changes after the payroll processing day [zp-pay]. Connecteam: "Can't clock in. This day was locked by your admins" [ct-block]. Factorial: an overtime request is frozen once that day's timesheet is approved [fa-ot]. |

Auto clock-out rules:

| Product | Rule |
|---|---|
| Jibble | At a set time or after N hours; a member may override if allowed [jb-remind]. |
| Connecteam | After N consecutive hours; at shift end or X minutes after; custom limits per weekday. The timesheet shows a red exclamation mark [ct-forget] [ct-limits] [ct-autoflag]. |
| Kenjo | Auto check-out after a set working time. For the daily maximum, either show a conflict or move the check-out to the limit [kj-policy]. |
| Buddy Punch | At the end of the scheduled shift or after N hours [bp-features]. |
| Bitrix24 | Set by the manager in the schedule; a mode exists where only the start is recorded [bx-day] [bx-sched]. |
| Factorial | Deliberately none. The employee confirms "tracked" or "estimated" hours, or the shift stays unresolved [fa-missed]. |
| Zoho | Location tracking can "automatically check out or notify when location data cannot be captured" [zp-methods]. |

## 4. Other day statuses

| Status | How products model it |
|---|---|
| On duty / official business | Zoho: an "On duty" request with admin-defined types (e.g. "Client visit"); full, half, quarter day or hourly; documents; approval [zp-od]. "On Duty" is also a leave classification [zp-leave]. |
| Work from home / remote | Zoho: punches are auto-classified Office-In or Remote-In by source, with six rules for mixed days [zp-office]. Factorial: either an absence type (with or without a counter) or a work location picked at clock-in [fa-wfh]. Kenjo: an "other absence" [kj-abs]. |
| Business trip | Kenjo: "other absence" [kj-abs]. Bitrix24: absence chart [bx-overview]. T-13 code К (06) [t13]. Factorial: travel on a working day is clocked as work [fa-faq]. |
| Training | T-13 codes ПК (07) and ПМ (08) [t13]. Not found as a built-in status in the SaaS products. |
| Compensatory off | Zoho: a scheduler credits weekend/holiday work automatically (in days) or the employee uses "Book Comp Off" (hours allowed); eligibility and expiry settings [zp-compoff]. greytHR has a "Leave Comp Off" page [gh-search-s]. Factorial and Kenjo convert overtime to time off (article titles) [fa-index] [kj-index-att]. T-13 code НВ (28) [t13]. |
| Overtime request | Factorial: filed after the work; pending until approved; multi-level; "only approved hours will count" [fa-ot]. greytHR: overtime policies and approval pages [gh-index]. Zoho: shows overtime and deviation, with a daily maximum above which nothing counts [zp-policy]. Jibble: daily, daily double, weekly, rest-day and public-holiday rules [jb-sched]. |
| Weekend / holiday worked | greytHR labels HOP, WOP and ROP (holiday, weekly off, rest day "but Present") [gh-labels]. Jibble counts rest days and public holidays worked [jb-att]. Factorial records bank-holiday work as extra time or regular time by setting [fa-bank]. T-13 code РВ (03) [t13]. |
| Half-day present | Zoho strict mode marks half or full day from shift hours [zp-policy]. greytHR holds a status per session [gh-override]. |
| Public holiday / weekly off | Zoho: holiday classifications and a reminder email; "Restricted Holiday" is a leave type [zp-holiday] [zp-leave]. Jibble: holiday calendars per group [jb-groups]. |
| Shift swap | Connecteam: a swap is two-way and needs manager approval; a replacement is one-way with optional approval and conflict warnings [ct-swap]. Factorial has a swap request (title only) [fa-index]. Deputy: from the mobile app [dp-blog-s]. |
| Unavailability | Deputy: employees log it and the scheduler shows it [dp-blog-s]. |
| Absent / no-show | Connecteam: No Show versus Callout [ct-status]. Zoho: "absent scheduler" and "present by default" automation [zp-overview]. T-13 code ПР (24) [t13]. |
| Suspension / downtime | T-13 codes НБ (35) and РП (31) [t13]. |
| On-call | Not found. |

T-13 codes retrieved, letter (numeric) [t13]:
- **Work:** Я (01), Н (02), РВ (03), С (04)
- **Trip and training:** К (06), ПК (07), ПМ (08)
- **Leave:** ОТ (09), ОД (10), У (11), УВ (12), Р (14), ОЖ (15), ДО (16), ОЗ (17)
- **Sickness:** Б (19), Т (20)
- **Other:** Г (23), ПР (24), НВ (28), РП (31), НБ (35)

The extracted table is partial and has no weekend or unexplained-absence rows. In 1С:ЗУП the codes live in «Виды использования рабочего времени»; the letter code is 1–3 characters and an employer may define its own set [zup-codes].

## 5. Schedules

| Aspect | What the documentation shows |
|---|---|
| Types | Jibble: Fixed, Flexible (duration per day) and Weekly Flexible (duration per week) [jb-sched]. Bitrix24: фиксированный, посменный, свободный [bx-overview]. Zoho: strict or lenient mode [zp-policy]. |
| Hours calculation | Zoho: "First check-in and last check-out" or "Every valid check-in and check-out"; shift margins before and after [zp-policy]. |
| Early clock-in window | Jibble: blocked outside the window (example 15 minutes early) [jb-policy]. Connecteam: "up to X minutes before" the shift [ct-limits]. Kenjo: a fixed earliest time, blocked before start, or X minutes early counted as paid or unpaid [kj-limits]. |
| Tolerance | Factorial: n minutes before and after schedule, plus worked-hours rounding (up, down, nearest, snap to planned); "overtime that falls into the tolerance range won't be counted" [fa-tol]. Zoho grace is in section 2. |
| Breaks | Zoho: paid or unpaid; automatic or manual; fixed time or by hours worked (45 minutes after 6 hours, 15 more after 8); not inside core hours [zp-breaks]. Connecteam: manual breaks paid or unpaid; automatic breaks always unpaid (30 minutes after 5 hours); a Break Exceptions export [ct-breaks] [ct-export]. Jibble: auto-deduction above a threshold; paid/unpaid applies to the whole schedule [jb-sched]. Kenjo: auto-deduct (30 minutes after 6h 1m), beta, single daily entry only [kj-policy]. Deputy: untaken scheduled breaks are added at clock-out [dp-loc-s]. |
| Rounding | Connecteam: 5, 10, 15 or 30 minutes; originals kept; applies to current and past timesheets [ct-round]. Buddy Punch: 2–30 minutes [bp-features]. Zoho: round-off buffers [zp-policy]. |
| Night shift | Jibble: a movable "end of workday" (e.g. 3am) assigns later entries to the next day [jb-split]. Connecteam: one option, all hours go to the day the shift started [ct-overnight]. Factorial: "the day the shift started" or "their calendar day", from an effective date only [fa-night]. Zoho: late-night hours tracked per location [zp-policy]. |
| Part-time | Kenjo prorates by weekly hours [kj-abs]. Factorial bases working-day allowances on the contract schedule [fa-allow]. Other products: not found. |
| Per group or location | Jibble: member overrides group overrides organisation [jb-groups]. Zoho: policies by user, employment type, department, designation or shift; pay period by employment type, then location, then role [zp-grace] [zp-pay]. Connecteam: geofence per job [ct-geofence]. Kenjo: the work schedule beats a published shift [kj-limits]. |
| Changes over time | Zoho: effective date plus "Update older entries" [zp-policy]. Factorial: a policy timeline, backdating up to 24 months, and past timesheets no longer change [fa-timeline]. Kenjo: rules "gelten nicht rückwirkend" [kj-policy]. |

## 6. Mobile anti-fraud without biometrics

| Control | What the documentation shows |
|---|---|
| Device lock | Jibble: the first device used becomes the dedicated one (phones and tablets only); only owners and admins can reset; the next device used is then locked [jb-lock]. Buddy Punch: "Device Lock" is one of four punch-blocking reasons that alert managers [bp-blocked]. An employee-initiated device-change request with approval: not found. |
| Geofence radius | Kenjo: 0.1, 0.5 or 1 km [kj-geo]. Factorial: 50 m, 100 m, 500 m or 1 km [fa-geo]. Deputy: 100–1000 m [dp-loc-s]. Truein: from 20 m [ti]. Jibble: at least 300 m for automatic clocking [jb-auto]. Connecteam: a slider with no limits stated in the help article [ct-geofence]; a search snippet gave 150–750 m, page unconfirmed [ct-radius-s]. |
| Outside geofence: block or flag | Block: Jibble [jb-geo], Buddy Punch (with manager alert) [bp-blocked]. Either: Kenjo (warn or block; green, yellow or grey marker) [kj-geo], Factorial ("Alert me…" or "Block clock ins…") [fa-geo], Deputy [dp-loc-s], Truein (block, alert or route for approval) [ti]. Connecteam hides the job; a clock-out "anyway" becomes an edit request [ct-geofence]. |
| Leaving the geofence | Connecteam: do nothing, remind, or auto clock-out [ct-geoout]. Jibble: auto in/out, labelled as automated; iOS allows 20 active geofences [jb-auto]. |
| Exemptions | Connecteam excludes individual users [ct-geofence]. Zoho, Buddy Punch and Kenjo assign restrictions per user or policy [zp-restrict] [bp-geoip] [kj-geo]. |
| Mock location | Connecteam: a pop-up says "a third-party location app was identified" and the punch is refused; this also covers VPN [ct-geofence]. Giriton treats a simulated position as no GPS [gi]. Truein flags geofence-edge behaviour, identical punch patterns and impossible travel [ti]. Jibble, Zoho, Kenjo, Factorial and Buddy Punch: not found. |
| Rooted-device detection | Not found in any vendor help centre. It appears only as a signal in a vendor blog [db]. |
| Wi-Fi / IP | Zoho: IP-range restriction [zp-restrict]. Buddy Punch: IP address lock, combined with geofence as either/or [bp-geoip]. SSID-specific restriction: not found. |
| QR | Factorial: a dynamic code on a device at the entrance, scanned in the employee app; "The URL automatically updates every 30 seconds"; cannot be combined with geolocation [fa-qr]. Jibble: the employee shows a personal code to a kiosk; rotation is unspecified; no PIN or geofencing in that mode [jb-qr]. Kenjo and Buddy Punch also offer QR [kj-policy] [bp-features]. |
| NFC | Connecteam: the employee taps a site tag; a location saved on the tag replaces phone GPS for geofence validation; NFC-only mode exists; cloning is not addressed [ct-nfc]. |
| Kiosk with PIN | Buddy Punch: four-digit PINs on a shared tablet [bp-features]. Kenjo: terminal with PIN or QR [kj-policy]. Zoho's kiosk is face-only and ignores IP/geo rules, so it does not fit your constraint [zp-kiosk]. |
| Server time | Factorial stores the device-local time and the server UTC time, showing the latter as a reference [fa-tz]. Other products: not found. |
| Offline punches | Connecteam: none, the apps "require an active internet connection" [ct-offline]. Factorial: device timestamp, Synced/Pending/Failed status, and a prior online login required [fa-offline]. Truein: "Records captured offline are flagged as such" [ti]. Jibble: offline on mobile and desktop [jb-policy]. |
| Same-source rule | Zoho: "Restrict check-out to the same source used for check-in" [zp-checkin]. |
| Shared-device indicator | Buddy Punch records a "Device Used" type per punch [bp-device]. Truein flags "identical punch patterns" [ti]. An explicit "one device, several employees" report: not found in vendor help; it appears only as a signal in [db]. |
| Photo at punch | Always an optional toggle, separate from face matching. Jibble: "Require selfies…" versus "Require verification by Facial Recognition" [jb-rules]. Zoho: "Capture and save photos" versus "Capture and verify photos" [zp-checkin]. Buddy Punch and greytHR likewise [bp-features] [gh-methods]. |
| Location capture | Connecteam: off, optional or required, and at least one device must keep the requirement [ct-gps]. Zoho: "Make location sharing mandatory…" [zp-checkin]. Factorial records coordinates only at clock-in and clock-out [fa-geo]. |

## 7. Reports and export

| Product | Standard reports | Formats, scheduling, customisation |
|---|---|---|
| Jibble | Timesheet; Tracked Time; Attendance Insights (expected days, absentees, attendance %, in late, out early, breaks exceeded, overtime categories, time lost, rest days and holidays worked); time-off requests; leave balances [jb-reports] [jb-att] [jb-help]. | Attendance report is Excel only. Filters by group, member, schedule, member code and position [jb-att]. |
| Buddy Punch | Payroll Export, Time Card, Daily Hours, In/Out Activity, Hours Summary, Hours by Location/Department/Position, PTO Summary, Early/Late, Absence, GPS Activity, Employee Error Log, Deleted Time, Actual vs Scheduled, break time [bp-reports]. | CSV, Excel, PDF. Scheduled email weekly, fortnightly or monthly, including external recipients (paid add-on) [bp-sched]. |
| Connecteam | Payroll Totals, Timesheets, Shift Report (one row per shift, no overnight split), Break Exceptions, Timesheet Audit Log, multi-clock export [ct-export]. | xlsx and PDF. Exports take extra fields; rounding adds unrounded columns [ct-export] [ct-round]. |
| Zoho People | "Expected vs Worked hours", "Presence hours break-up", loss-of-pay and hour-comparison reports on the payroll processing day [zp-reports] [zp-pay]. | Manager access toggle, balance hours carried forward, password-protected exports [zp-reports] [zp-addopt]. Full report list: not found. |
| Factorial | Full export, summary, export with absences, annual balance, time off, data for terminated employees [fa-export] [fa-index]. | Excel and PDF, sent by email and stored in Documents [fa-export]. |
| greytHR | Attendance summary, attendance info, swipe details, override history [gh-index] [gh-override]. | Excel for override history [gh-override]. Muster roll: not found. |
| Bitrix24 | Отчёт по рабочему времени with a filter for unconfirmed days; daily work report set to обязателен, не обязателен or не показывать [bx-control]. | Excel export [bx-control]. |
| Personio | Remaining time-off balances [ps-report-s]. | Not found. |
| 1С:ЗУП | T-13 form [t13]. | Not found. |

Gaps across all products read:
- A generic report builder (choose columns, group by, saved views) was not found; Connecteam's field-selectable exports come closest [ct-export].
- A dedicated regularization log, geofence-violation report or device report was not found; the nearest are Buddy Punch's Error Log and Punch Blocked alert [bp-reports] [bp-blocked] and Kenjo's location markers [kj-geo].

## 8. Notifications and reminders

| Type | What the documentation shows |
|---|---|
| Clock-in/out reminders | Jibble: set at clock-in or clock-out, a second reminder after the scheduled time, defaults from org policy [jb-remind] [jb-policy]. Connecteam: "Remind employees to clock out at" a time per weekday [ct-forget]. Zoho: reminders based on shift hours [zp-checkin]. Buddy Punch: Punch In/Out and Shift Start/End reminders [bp-notif]. |
| Late, early, missed | Buddy Punch: Early In, Late In, Early Out, Late Out, Missed In and Missed Out (N minutes after shift end), to employee, manager or admin by email or push [bp-notif] [bp-missedout]. Connecteam: "A user didn't clock into a shift that started X minutes ago" [ct-late]. Zoho: alerts for late check-in, early check-out, missed check-in and insufficient hours [zp-checkin]. greytHR: email templates for Late In and Early Out, including "consecutive days" variants [gh-notif]. Bitrix24: the manager is notified of violations and of «Невыход на смену» [bx-sched]. |
| Geofence and blocked punches | Buddy Punch: alerts on entering or leaving a geofence (radius of 200 m or more) and on any blocked punch [bp-geoalert] [bp-blocked]. |
| Auto clock-out and limits | Connecteam: push, web push or email, configured per admin [ct-autoflag]. Buddy Punch: daily or weekly overtime alert [bp-notif]. |
| Pending approvals and edits | Connecteam: shift added or edited, pending requests, timesheet submitted [ct-notif]. Buddy Punch: punch changes, time-card reminders, time-off changes [bp-notif]. Jibble: approvers are told only when a request reaches their level [jb-appr]. |
| Timesheet error alerts | Factorial: Missing Clocking (on by default), Missing Clock-Out, Missing Break, Insufficient Break [fa-alerts]. |
| Daily digest to HR | Not found as a named feature. |

## (a) Merged catalogue of day statuses and request types

| Name | Unit | Approval | Timesheet shows as | Seen in |
|---|---|---|---|---|
| Present | day / hours | no | worked hours | all |
| Half-day present | session | no | per-session status | [zp-policy] [gh-override] |
| Absent / no-show | day | no | absent; may auto-convert to leave | [ct-status] [zp-pay] [t13] |
| Callout | shift | manager marks | excused absence | [ct-status] |
| Weekly off / rest day | day | no | off | [jb-pto] [gh-labels] |
| Public holiday | day (half-day not found) | no | holiday | [zp-holiday] [jb-cal] |
| Worked on holiday / weekly off | day / hours | often (overtime or comp-off) | HOP / WOP / ROP; РВ | [gh-labels] [jb-att] [t13] |
| Paid annual leave | day / half / hours | yes | paid leave in payable hours | [jb-pto] [zp-leave] [fa-types] |
| Unpaid leave | day / hours | yes | unpaid, excluded from payroll hours | [jb-pto] [kj-abs] [t13] |
| Sick leave | day | by policy; document by threshold | paid absence | [fa-types] [kj-abs] [t13] |
| Maternity / parental / study leave | day | grant-based | leave | [fa-types] [zp-leave] [t13] |
| Restricted (optional) holiday | day | yes | leave type | [zp-leave] |
| Short leave / permission | minutes / hours | yes, with period caps | permission hours | [zp-perm] [gh-policy] |
| Partial day (late arrival / early leaving) | minutes | yes | expected hours adjusted | [keka-partial-s] [keka-pen-s] |
| On duty / official business | full / half / quarter / hours | yes | on duty (office-in) | [zp-od] [zp-office] |
| Business trip | day | yes | "other absence"; К | [kj-abs] [bx-overview] [t13] |
| Work from home | day | by policy | remote-in, absence type or location tag | [zp-office] [fa-wfh] [kj-abs] |
| Training | day | not found | ПК / ПМ | [t13] |
| Compensatory off earned | day / hours | automatic or request | credit to balance | [zp-compoff] |
| Compensatory off taken | day / hours | yes | leave; НВ | [zp-compoff] [t13] |
| Overtime request | hours | yes, multi-level | pending, then approved extra time | [fa-ot] [gh-index] |
| Regularization | punch / day | yes | new or replaced entry; "Pending Request" | [zp-reg] [fa-edit] [bx-mobile] |
| Exempt-from-policy regularization | day | yes | penalty waived | [keka-reg-s] [gh-exc] |
| Missed clock-out | shift | employee resolves | "!" unresolved, or auto-out flag | [fa-missed] [ct-autoflag] |
| Shift swap / replacement | shift | swap yes; replacement optional | schedule updated | [ct-swap] |
| Unavailability | day / hours | not found | scheduler only | [dp-blog-s] |
| Lateness penalty | 0.25 / 0.5 / 1 day | automatic | leave deducted | [zp-grace] |
| Suspension / downtime | day | HR | НБ / РП | [t13] |
| On-call | — | — | not found | — |

## (b) Top 12 non-biometric anti-fraud controls

Ranked by how many of the products read document each one. The weaknesses are my analysis unless a source is cited.

| # | Control | Description | Weakness |
|---|---|---|---|
| 1 | Geofence at punch | Allow, warn or block by distance from a site [jb-geo] [kj-geo] [fa-geo] [bp-blocked] [ti] [dp-loc-s]. | GPS is imprecise, so users must stand well inside the fence [ct-geofence]. It proves where the phone is, not who holds it. |
| 2 | Mandatory GPS capture shown to the manager | Coordinates, accuracy and address stored per punch [kj-geo] [ct-gps] [zp-checkin]. | A flag only helps if someone reviews it. Desktop location is unreliable [ct-block]. |
| 3 | Locked edits with correction request and audit log | Employees request changes, managers approve, a log records who and when [fa-edit] [ct-audit] [gh-override] [zp-reg] [bx-mobile]. | Managers can rubber-stamp. No product read documents an original-versus-corrected view. |
| 4 | Auto clock-out or daily cap, flagged | Ends forgotten shifts and marks them [ct-autoflag] [jb-remind] [kj-policy] [bp-features]. | It records a time that did not happen, which is why Factorial refuses to do it [fa-missed]. |
| 5 | Schedule-window limiting | No punch before X minutes ahead of the shift or outside set hours [jb-policy] [ct-limits] [kj-limits] [bp-features]. | It needs accurate schedules and blocks legitimate unscheduled work. |
| 6 | Shared kiosk with PIN or personal QR | A fixed on-site device, so no personal phone is involved [bp-features] [kj-policy] [jb-qr]. | PINs and static codes can be shared. Jibble's QR mode has no PIN and no geofence [jb-qr]. |
| 7 | Blocked-punch and exception alerts | Managers are told when a punch is refused or something is missing [bp-blocked] [fa-alerts] [ct-notif]. | Alert fatigue. |
| 8 | Offline policy | Disallow offline punches or flag them [ct-offline] [ti] [fa-offline]. | Disallowing hurts poor-coverage sites. Allowing trusts the device clock [fa-offline]. |
| 9 | Mock-location detection | Refuse the punch when a spoofing app is detected [ct-geofence] [gi]. | The OS flag "can be bypassed" on rooted devices [db]. |
| 10 | IP restriction | Punch only from the office network [zp-restrict] [bp-geoip]. | VPNs defeat IP checks [db]. It is useless for field staff. |
| 11 | One-device lock | The account is bound to the first device used [jb-lock] [bp-blocked]. | Reset is admin-only [jb-lock]. A colleague can still carry the phone. |
| 12 | Site token: rotating QR or NFC tag | A QR that changes every 30 seconds [fa-qr], or a tag carrying the site location [ct-nfc]. | Factorial's QR excludes geolocation [fa-qr]. Tag cloning is not addressed [ct-nfc]. |

Rare or absent in vendor documentation:
- **Server-side timestamp:** only Factorial [fa-tz].
- **Anomaly analytics** (impossible travel, identical patterns): only Truein [ti].
- **Rooted-device detection and a shared-device report:** not found in any vendor help centre.

## (c) Things small vendors forget

| Edge case | How mature documentation handles it |
|---|---|
| Hired or dismissed mid-period | Leave is prorated by start and by contract-end date [zp-leave] [fa-allow] [kj-abs]. Factorial keeps a download for terminated employees [fa-index]. Treatment of days before hire or after exit in the timesheet: not found. |
| Leave overlapping a holiday or weekend | Zoho's sandwich rule, with "Auto-reverse sandwiched weekends and holidays when associated absences are converted" [zp-leaveopt]. In Kenjo a holiday still counts as one deducted day but can cost 0 hours [kj-deduct]. |
| Two check-ins without a check-out | Factorial refuses: "There is already an active shift" [fa-qrfail]. Bitrix24: «Вы не закрыли предыдущий рабочий день» [bx-21604602]. Connecteam raises an overlapping-shift conflict with a "Cut start/end" fix [ct-conflicts]. Kenjo raises an incomplete-entry conflict the next day [kj-policy]. |
| Shift crossing midnight | A configurable day cut-off [jb-split], attribution to the start day [ct-overnight], or a choice of the two [fa-night]. A break begun after midnight is split [fa-night]. Month-end crossing specifically: not found. |
| Time zones | Connecteam applies limits in the clock's time zone and shows them in device-local time [ct-tz]. Factorial stores local time plus server UTC but not the zone [fa-tz]. Bitrix24 has a time-zone choice on the working-time page [bx-control]. |
| Retroactive policy or schedule change | Factorial's timeline protects past timesheets and allows deliberate backdating up to 24 months [fa-timeline]. Zoho has "Update older entries" [zp-policy]. Kenjo rules are never retroactive [kj-policy]. Connecteam rounding rewrites past timesheets [ct-round]. |
| Approved leave cancelled after the day passed | Zoho limits cancellation to the current or previous n pay periods and allows partial cancellation [zp-leavereq]. In Factorial only another admin can delete a past absence, and the shift returns to draft [fa-delete] [fa-shiftleave]. |
| Payroll cut-off with requests pending | Zoho auto-approves or rejects them, auto-converts absences to leave, then locks [zp-pay]. |
| Work logged on a leave day or holiday | Connecteam's "Overlapping Time Off" conflict [ct-conflicts]. Kenjo's overlap conflicts [kj-policy]. Zoho can block entries on approved leave [zp-checkin]. |
| Leave spanning two cycles | Factorial checks both balances across five scenarios and warns [fa-cycles]. |
| Carry-over expiry | Kenjo zeroes the remainder with no notice [kj-abs]. |
| Shift deleted too early for a future absence | In Kenjo this breaks the deduction; delete only after the first absence day [kj-deduct]. |
| Partial-day absence versus the shift | In Factorial only a full-day absence displaces the shift [fa-shiftleave]. |
| Mixed office and remote punches in one day | Zoho's six explicit rules [zp-office]. |
| Several lateness violations in one day | Zoho applies only the highest penalty [zp-grace]. |
| Day with zero planned time | Factorial shows no missed-clock-out prompts [fa-missed]. |
| No GPS fix | Kenjo shows a grey marker [kj-geo]. Zoho auto checks out or notifies [zp-methods]. Giriton refuses the punch [gi]. |
| Clock-out outside the geofence | Connecteam lets the user clock out "anyway" and routes it for approval [ct-geofence]. |
| Blackout exceptions | Factorial excludes named employees [fa-blocked]. Buddy Punch managers bypass the block [bp-blackout]. |
| Document after approval | Not possible in Factorial [fa-faq]. |
| Self-deletion of records | A Factorial admin cannot delete a past absence they created themselves [fa-delete]. |
| Unconfirmed edits | Bitrix24 leaves them out of totals until the manager confirms [bx-control]. |
| Rounding | Connecteam keeps the originals visible and exportable [ct-round]. |
| Automatic break deduction | Kenjo's works only with a single daily entry [kj-policy]. |
| Platform limit | iOS allows at most 20 active geofences for Jibble's automation [jb-auto]. |

## Sources

[zp-reg]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/attendance-regularization-zp
[zp-perm]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/hourly-permissions
[zp-od]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/on-duty-zoho-people
[zp-grace]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/specific-policies
[zp-checkin]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/check-in-and-check-out-preferences
[zp-policy]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/setting-up-attendance-policy-in-zoho-people
[zp-breaks]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/breaks
[zp-restrict]: https://help.zoho.com/portal/en/kb/people/administrator-guide/common-settings/articles/setting-up-permissions-zoho-people
[zp-reports]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/reports-settings
[zp-methods]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/attendance-methods-overview
[zp-office]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/office-in-and-remote-in
[zp-kiosk]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/zoho-people-kiosk-1-10-2024
[zp-overview]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/attendance-overview
[zp-addopt]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/settings/articles/additional-options-in-attendance-service
[zp-regops]: https://help.zoho.com/portal/en/kb/people/administrator-guide/attendance-management/operations/articles/managing-regularization-requests
[zp-search-s]: https://help.zoho.com/portal/en/kb/people/employee-handbook-5-0/attendance/articles/attendance
[zp-pay]: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/pay-period
[zp-leave]: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/setting-up-leave-policies-in-zoho-people
[zp-compoff]: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/compensatory-off-management
[zp-leavereq]: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/leave-request-settings
[zp-leaveopt]: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/additonal-options
[zp-holiday]: https://help.zoho.com/portal/en/kb/people/administrator-guide/leave/settings/articles/holiday-zoho-people
[gh-perm]: https://www.greythr.com/help-admin/attendance-management/apply-short-leave-permission
[gh-policy]: https://www.greythr.com/help-admin/workflows/regularization-permission-policy/
[gh-labels]: https://www.greythr.com/help-admin/attendance-management/attendance-labels-greythr
[gh-methods]: https://www.greythr.com/help-admin/attendance-management/attendance-marking-methods
[gh-exc]: https://www.greythr.com/help-admin/attendance-management/add-attendance-exception
[gh-override]: https://www.greythr.com/help-admin/attendance-management/override-employee-attendance
[gh-notif]: https://www.greythr.com/help-admin/attendance-management/enhanced-email-notifications-attendance
[gh-index]: https://www.greythr.com/help-admin/attendance-management/
[gh-search-s]: https://admin-help.greythr.com/admin/answers/122746416
[keka-reg-s]: https://help.keka.com/hc/en-us/articles/39946614770321-How-can-an-employee-Regularize-his-attendance
[keka-behalf-s]: https://help.keka.com/hc/en-us/articles/39946625324049-How-to-regularize-attendance-on-behalf-of-employees
[keka-partial-s]: https://help.keka.com/admin/admin-help/how-to-setup-partial-day-policy
[keka-pen-s]: https://help.keka.com/hc/en-us/articles/39946747232529-Setting-up-a-Penalization-Policy
[jb-policy]: https://www.jibble.io/help/configuring-your-time-tracking-policy
[jb-lock]: https://www.jibble.io/help/device-lock-mobile
[jb-geo]: https://www.jibble.io/help/how-does-geofencing-work
[jb-rules]: https://www.jibble.io/help/custom-time-tracking-rules-mobile
[jb-auto]: https://www.jibble.io/help/automatic-clock-in-out-geofences
[jb-remind]: https://www.jibble.io/help/set-reminders-automatic-clock-out
[jb-reports]: https://www.jibble.io/help/what-are-the-different-types-of-reports-that-can-be-exported
[jb-att]: https://www.jibble.io/help/exporting-attendance-reports
[jb-split]: https://www.jibble.io/help/adjusting-your-end-workday-to-split-timesheets
[jb-qr]: https://www.jibble.io/help/how-to-use-jibbles-qr-code-kiosk
[jb-sched]: https://www.jibble.io/help/manage-work-schedules
[jb-cal]: https://www.jibble.io/help/using-time-off-calendar
[jb-appr]: https://www.jibble.io/help/how-multi-level-approvals-work
[jb-pto]: https://www.jibble.io/help/creating-time-off-policies
[jb-groups]: https://www.jibble.io/help/customizing-settings-for-groups
[jb-help]: https://www.jibble.io/help
[ct-gps]: https://help.connecteam.com/en/articles/6489778-time-clock-gps-location-tracking-geolocation
[ct-geofence]: https://help.connecteam.com/en/articles/3597710-how-to-create-a-geofence
[ct-geoout]: https://help.connecteam.com/en/articles/9608750-can-i-prevent-an-employee-from-clocking-out-from-outside-the-geofence
[ct-radius-s]: https://au.connecteam.com/geofence-time-clock-app/
[ct-forget]: https://help.connecteam.com/en/articles/8283183-can-i-prevent-employees-from-forgetting-to-clock-out
[ct-autoflag]: https://help.connecteam.com/en/articles/8708277-how-can-i-know-when-an-employee-has-been-auto-clocked-or-exceeded-their-daily-limit
[ct-audit]: https://help.connecteam.com/en/articles/9313978-is-it-possible-to-see-the-edit-history-in-an-employee-s-timesheet
[ct-block]: https://help.connecteam.com/en/articles/6420237-troubleshooting-my-users-can-t-clock-in-why-could-that-be
[ct-late]: https://help.connecteam.com/en/articles/10274727-can-i-notify-admins-if-an-employee-is-late-for-a-shift
[ct-tz]: https://help.connecteam.com/en/articles/9526874-my-employees-work-across-different-timezones-will-the-clock-in-limitations-by-day-work
[ct-offline]: https://help.connecteam.com/en/articles/16287971-does-the-time-clock-support-offline-mode
[ct-nfc]: https://help.connecteam.com/en/articles/11462177-starting-guide-to-nfc-clock-in
[ct-status]: https://help.connecteam.com/en/articles/17297298-shift-attendance-status-in-the-schedule
[ct-limits]: https://help.connecteam.com/en/articles/4331813-time-clock-limitations
[ct-notif]: https://help.connecteam.com/en/articles/1471987-time-clock-notifications-for-admins
[ct-conflicts]: https://help.connecteam.com/en/articles/5449127-timesheet-conflicts
[ct-timeoff]: https://help.connecteam.com/en/articles/7063866-time-clock-how-to-view-approved-time-off-on-timesheets
[ct-export]: https://help.connecteam.com/en/articles/5917303-time-clock-export-options
[ct-breaks]: https://help.connecteam.com/en/articles/3016187-how-to-set-up-breaks-paid-unpaid
[ct-round]: https://help.connecteam.com/en/articles/9203682-rounding-hours-in-connecteam
[ct-overnight]: https://help.connecteam.com/en/articles/7953603-setting-up-overtime-for-overnight-shifts
[ct-swap]: https://help.connecteam.com/en/articles/16644414-let-s-settle-this-once-and-for-all-shift-swap-or-shift-replacement
[bp-geoip]: https://docs.buddypunch.com/en/articles/13146139-using-geofences-and-ip-address-locks-together
[bp-geoalert]: https://docs.buddypunch.com/en/articles/10804459-geofence-alert
[bp-blocked]: https://docs.buddypunch.com/en/articles/16988075-punch-blocked-alert
[bp-features]: https://buddypunch.com/features/
[bp-reports]: https://docs.buddypunch.com/en/articles/3658502-overview-of-reports
[bp-device]: https://docs.buddypunch.com/en/articles/3558403-how-to-view-the-device-used-to-track-time-administrator-web
[bp-sched]: https://docs.buddypunch.com/en/articles/17507141-how-to-schedule-and-manage-advanced-reports-for-automatic-email-delivery
[bp-notif]: https://docs.buddypunch.com/en/articles/3661608-overview-of-notifications-alerts-and-reminders
[bp-blackout]: https://docs.buddypunch.com/en/articles/6041461-how-to-set-time-off-blackout-dates
[bp-missedout]: https://docs.buddypunch.com/en/articles/3120956-missed-out-alert
[bp-pto-index]: https://docs.buddypunch.com/en/collections/2738458-time-off-setup
[fa-types]: https://help.factorialhr.com/en_US/absences-approvals/how-to-create-absence-types-2
[fa-blocked]: https://help.factorialhr.com/en_US/absences-approvals/what-happens-if-an-employee-requests-time-off-during-a-blocked-period
[fa-allow]: https://help.factorialhr.com/en_US/time-off-settings/about-time-off-allowances
[fa-faq]: https://help.factorialhr.com/en_US/absences-approvals/faq-about-absences-and-approvals
[fa-delete]: https://help.factorialhr.com/en_US/absences-approvals/how-to-delete-an-absence
[fa-bank]: https://help.factorialhr.com/en_US/absences-approvals/bank-holidays-treatment
[fa-cycles]: https://help.factorialhr.com/en_US/time-off-settings/what-happens-with-absences-that-include-more-than-one-cycle
[fa-qr]: https://help.factorialhr.com/en_US/time-tracking/how-to-clock-inout-with-the-qr-code
[fa-qrfail]: https://help.factorialhr.com/en_US/time-tracking/why-clocking-in-with-a-qr-code-may-fail
[fa-geo]: https://help.factorialhr.com/en_US/time-tracking/how-to-use-geolocation-in-time-tracking
[fa-missed]: https://help.factorialhr.com/en_US/time-tracking/about-missed-clock-outs
[fa-alerts]: https://help.factorialhr.com/en_US/time-tracking/proactively-catch-timesheet-errors-with-alerts
[fa-offline]: https://help.factorialhr.com/en_US/time-tracking/how-to-clock-in-and-out-offline-mobile-app
[fa-tol]: https://help.factorialhr.com/en_US/time-tracking/about-time-tracking-tolerance
[fa-tz]: https://help.factorialhr.com/en_US/time-tracking/clocking-in-from-a-different-time-zone
[fa-night]: https://help.factorialhr.com/en_US/time-tracking/how-to-configure-overnight-shifts
[fa-ot]: https://help.factorialhr.com/en_US/time-tracking/about-overtime-request-and-approval
[fa-edit]: https://help.factorialhr.com/en_US/time-tracking/how-to-use-edit-timesheet-restriction
[fa-timeline]: https://help.factorialhr.com/en_US/time-tracking/time-tracking-policies-timeline
[fa-wfh]: https://help.factorialhr.com/en_US/time-tracking/how-to-reflect-work-from-home-in-factorial
[fa-log]: https://help.factorialhr.com/en_US/time-tracking/activity-log-for-time-tracking
[fa-export]: https://help.factorialhr.com/en_US/time-tracking/how-to-export-a-time-tracking-report
[fa-shiftleave]: https://help.factorialhr.com/en_US/shift-management/how-to-manage-leaves-in-shifts-
[fa-index]: https://help.factorialhr.com/en_US/time-tracking-absences
[kj-policy]: https://help.kenjo.io/de/articles/597583-zeiterfassung-und-richtlinien-einrichten
[kj-limits]: https://help.kenjo.io/de/articles/653619-limitierungen-fur-das-einchecken-fur-schichtmitarbeiter-einrichten
[kj-geo]: https://help.kenjo.io/de/articles/653613-standorterfassung-und-geolocation-einrichten
[kj-abs]: https://help.kenjo.io/de/articles/653627-abwesenheitsarten-und-abwesenheitsrichtlinien-einrichten
[kj-deduct]: https://help.kenjo.io/de/articles/818914-abzugsregeln-fur-abwesenheiten-einrichten
[kj-block]: https://help.kenjo.io/de/articles/597733-urlaubssperren-erstellen-und-verwalten
[kj-approve]: https://help.kenjo.io/de/articles/597622-zeiterfassungen-genehmigen
[kj-index-att]: https://help.kenjo.io/de/collections/1341111-anwesenheit
[dp-loc-s]: https://help.deputy.com/hc/en-au/articles/4657642198159-Customize-your-Timesheet-settings-by-Location
[dp-leave-s]: https://help.deputy.com/hc/en-au/articles/4663059378191-Leave-Management-FAQs
[dp-behalf-s]: https://help.deputy.com/hc/en-au/articles/4658299643919-Managers-can-enter-leave-on-behalf-of-their-team-members
[dp-blog-s]: https://www.deputy.com/gb/blog/how-to-streamline-your-team-s-leave-management-with-deputy
[ps-carry-s]: https://support.personio.de/hc/en-us/articles/360007040017-Edit-carryover-settings-for-time-off
[ps-half-s]: https://community.personio.com/time-off-attendance-87/work-levels-with-half-days-off-e-g-70-90-3266
[ps-report-s]: https://support.personio.de/hc/en-us/articles/115005490989-Track-employees-unused-time-off-using-reports
[bx-day]: https://helpdesk.bitrix24.ru/open/5355941/
[bx-overview]: https://helpdesk.bitrix24.ru/open/17832334/
[bx-sched]: https://helpdesk.bitrix24.ru/open/17921146/
[bx-mobile]: https://helpdesk.bitrix24.ru/open/28243380/
[bx-control]: https://helpdesk.bitrix24.ru/open/17934454
[bx-21604602]: https://helpdesk.bitrix24.ru/open/21604602
[t13]: https://ppt.ru/art/rabota/oboznacheniya-v-tabele
[zup-codes]: https://buhexpert8.ru/?p=546964
[ti]: https://truein.com/time-clock-software-stop-buddy-punching
[gi]: https://giriton.com/en/blog/the-my-attendance-app-recognizes-a-fraudulent-location
[db]: https://blog.data-basics.com/clock-in/out-gps-spoofing-detection-and-audit-guide-1
