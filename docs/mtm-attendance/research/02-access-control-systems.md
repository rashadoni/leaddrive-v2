> Разведка 2026-10-13 для `docs/mtm-attendance/README.md`. Отчёт собран помощником-исследователем:
> пути и номера строк верны на эту дату, перед использованием сверяй с кодом. `<repo>` — корень репозитория.

# Time & Attendance systems — data model, rules, exceptions, reports

Source tags in square brackets resolve to URLs in the "Sources" section at the end. `[ZK p.N]` is the printed page of the BioTime 8.0 manual. "Screenshot" means the value was read from a screenshot in that manual, so it may be an example rather than a factory default.

## 0. Coverage and limits

| Product | Evidence used | Confidence |
|---|---|---|
| ZKTeco BioTime 8.0 (sw 8.0.5+, manual v5.0, July 2021) | Full official manual, text and screenshots [ZK] | High |
| ZKBio Time 9.x | Reseller feature page [ZK9] and product page [ZKP] only; the 9.0.4–9.0.6 manual PDF exceeded the fetch size limit | Low |
| Hikvision HikCentral Professional | Official online help, about 30 pages [H-*] | High for rules, medium for reports |
| Suprema BioStar 2 TA | Field detail comes from Suprema's BioStar X docs site [S-*]; report types are confirmed for BioStar 2 by the BioStar 2 TA API article [S-API] | Medium |
| Anviz CrossChex | Standard V1.0 manual [A-STD], Lite guide [A-LITE], Cloud community tutorials [A-C7/C9/C10], App Store page [A-APP] | Medium |
| PERCo-Web "Учёт рабочего времени" (WM-01, v3.0.1.111) | Official user guide [P] | High |
| Sigur, Parsec | Not researched: the one search returned no vendor documentation | — |

The 15-search budget is fully used.

## 1. ZKTeco BioTime 8.0

### 1.1 Scheduling model

| Element | What the manual says | Source |
|---|---|---|
| Chain | Break Time → Timetable → Shift → Schedule (Department / Group / Employee / Temporary) → Schedule Preview | [ZK p.104–132] |
| Timetable | "The minimum unit in the attendance time settings"; two kinds: Normal and Flexible | [ZK p.108, 116] |
| Normal timetable fields | Check-In and Check-Out times; Check-In Start/End and Check-Out Start/End (punches outside are invalid); cross-day up to 3 days; Workday count; colour; several break times; Early In and Late Out mapped to a pay code with a minimum; Max OT plus 3 OT levels; Clock-In/Out required; Allow Late-In / Early-Out; duplicate punch policy; Punch State Based; Day Change Time | [ZK p.108–115] |
| Screenshot values | 09:00–18:00; in-window 08:00–10:00; out-window 17:00–19:00; WorkDay 1.0; clock-in/out required Yes; allow late-in 0 min; allow early-out 0 min; duplicate punch "Rule Based" (1 min); punch-state based No; day change 00:00:00 | [ZK p.108, 112] |
| Flexible timetable | Check-In, Check-Out, Work Time (required hours), Work Type (normal work / day off / weekend), Late Out mapped to a pay code, OT rule, Multiple In/Out (each pair summed) | [ZK p.116–118] |
| Shift | Timetables on a cycle; unit day / week / month; cycle = number × unit; unselected dates are days off; optional Weekly Overtime threshold | [ZK p.119–121] |
| Auto shift | "Intelligent scheduling": with several periods in one shift, the system picks the one matching the punches; overlapping periods are allowed only with Auto shift on | [ZK p.120] |
| Assignment | Department schedule; Group schedule (group = people with the same rule from different departments); Employee schedule ("Overwrite Shift", import) | [ZK p.95, 121–126] |
| Temporary schedule | Employee(s) + date(s) + timetable(s); for that day only the temporary schedule is used; typically for overtime, weekend or holiday work; importable | [ZK p.126–127] |
| No schedule | "Rule for Non-scheduled Days": Max Work Hours, Day Change Time, Pairing Rule (First And Last / Odd Even / Punch State Based), Daily Overtime tiers; screenshot shows 24.0 h, 00:00:00, First And Last | [ZK p.98–99, 162] |
| Per-employee switches | Enable Attendance, Enable Schedule, Enable Holiday, Enable Overtime (enabled by default) | [ZK p.33] |

### 1.2 Rule parameters

| Parameter | Behaviour and values | Source |
|---|---|---|
| Rule scope | Global, Department, Group; priority Group > Department > Global | [ZK p.97–104] |
| Basic | Weekend1 / Weekend2, week start, Duplicate Punch Interval; screenshot: Saturday, Sunday, Monday, 1 min | [ZK p.98] |
| Late or early becomes absence | "Late coming or early leaving exceeding by N minutes is counted as absence"; screenshot: 100 min each | [ZK p.101] |
| Missing check-in | Counted as late, absence or incomplete for N minutes; screenshot: Late, 60 min | [ZK p.101] |
| Missing check-out | Counted as early leave, absence or incomplete for N minutes; screenshot: Early Leave, 60 min | [ZK p.101] |
| Grace | Allow Late-In / Allow Early-Out per timetable; text example 5 min | [ZK p.112] |
| Which punch | Earliest punch in the check-in window and latest in the check-out window, unless Punch State Based | [ZK p.161] |
| Break | "Auto deduct" (allowed duration always deducted) or "Required Punch"; window, duration, Multiple In/Out, Minimum Break Time; early return can go to an OT pay code; late return can count as late, early out or absence | [ZK p.104–107] |
| Overtime mode | Disable Overtime / Calculation OT (from punches) / Approval OT (from requests) / Approval OT Priority / Minimum OT (lesser of the two) | [ZK p.100] |
| OT before and after shift | Early In and Late Out each have a minimum; "Count the Minimum" decides whether the first N minutes count | [ZK p.110–111] |
| OT levels | Three tiers by worked-hours range, each mapped to a pay code (Normal OT, OT1, OT2, OT3); Max OT cap per timetable; Weekly OT on the shift | [ZK p.99–100, 112, 120] |
| Weekend and holiday OT | Separate tier tables; screenshot example: weekend 1–4 h OT1, 4–6 h OT2, 6–10 h OT3; holiday 1–3, 3–5, 5–10 h | [ZK p.100] |
| Rounding | Per pay code: Round Off / Up / Down with a minimum unit; fixed codes show HH:MM, Round Off, 0.1 | [ZK p.93–94, 162] |
| Cross-day | Day Change Time: punches before it belong to the previous day | [ZK p.98, 115] |
| Alerts | Thresholds for counts of late, early leave and absent; sent daily, weekly or monthly | [ZK p.101–102] |

### 1.3 Exceptions, corrections, approval

| Item | Detail | Source |
|---|---|---|
| Manual Log | For business trips or forgotten punches; fields: punch time, punch state (check-in, check-out, break in/out, overtime in/out), work code, attachment, reason; bulk add and import | [ZK p.133–136] |
| Leave | Start and end time, leave pay code, attachment, reason; shows balance; bulk add and import | [ZK p.136–140] |
| Overtime request | Admin entry is auto-approved; employee entry needs approval; can be auto-created from Overtime In/Out punches | [ZK p.113–115, 140–142] |
| Training | Request with a Training-type pay code | [ZK p.142–144] |
| Schedule Adjustment | Employee requests a shift change in the app; admin approves on the web | [ZK p.144] |
| Actions | Approve / Reject / Revoke with remarks; an approved record cannot be edited; "Auto Approved" switch per entry | [ZK p.134–136] |
| Pay code types | Regular, Overtime, Leave, Exception, Training; custom codes with code, name, unit, symbol, rounding, colour, order | [ZK p.92–94] |
| Default pay codes (14 of 18 visible) | REG Regular, L Late In, E Early Out, A Absence, NOT Normal OT, WOT Weekend OT, HOT Holiday OT, OT1, OT2, OT3, AL Annual Leave, SL Sick Leave, CL Casual Leave, ML Maternity Leave | [ZK p.92 screenshot] |
| Leave entitlement types | Based On Service (seniority tiers, carry-forward with a cap, pro-rata first year, minimum days employed before applying); Unlimited (unpaid, work injury); One-Time (maternity, marriage, paternity, compensation); Fixed Quota (paid sick, birthday) | [ZK p.144–150] |
| Leave over non-working days | "Deduct Non-working Day" defaults to No: rest days and public holidays inside a leave are not deducted | [ZK p.146] |
| Workflow | Workflow Roles plus Workflow Builder per content type; ordered nodes, each with an Approver Role and a Notifier Role, scoped "Own Department" or "All"; example Manager → Boss; e-mail on completion | [ZK p.44–48] |
| Self-service | Employees approve and apply "within the self-service and mobile app" | [ZK p.48, 80] |

### 1.4 Holidays

| Item | Detail | Source |
|---|---|---|
| Holiday record | Name, start date, duration in days, colour, own OT tier table, optional department or group scope (blank = all) | [ZK p.152–154] |
| Interaction | A holiday is treated as normal work or overtime "according to the value set on holiday"; rule-level Holiday Overtime switch; per-employee Enable Holiday | [ZK p.33, 100, 161–162] |

### 1.5 Reports

| Group | Report names | Source |
|---|---|---|
| Transaction | Transaction; Time Card; First & Last; First In Last Out | [ZK p.156] |
| Daily | Total Time Card; Worked Hrs.; Overtime Report; Leave Report; Late In Report; Early Out Report; Absent Report; Exception Report; Scheduled Log; Paired Punch; Multiple Worked Hrs; Multiple Break Time | [ZK p.157–159] |
| Weekly | Weekly Worked Hrs.; Weekly Overtime | [ZK p.159] |
| Monthly | Monthly Status; Monthly Check-in/out; Monthly Worked Hrs.; Monthly Overtime; Monthly Absence | [ZK p.159] |
| Summary | Employee Attendance; Employee Overtime; Employee Leave; Department Attendance; Department Overtime; Group Attendance; Group Overtime; Leave Balance | [ZK p.159–160] |
| Payroll | Salary Structure; Increase Items; Deduction Items; Salary Detail; Attendance Parameters | [ZK p.194–196] |

| Capability | Detail | Source |
|---|---|---|
| Total Time Card columns | Total Hrs, Total Hrs of Break, Break Time, Worked Hrs, Duty Duration, Total OT; right-click a row to add a manual log, leave or overtime | [ZK p.157] |
| Field selection | Any report: tick the fields to show; no separate report designer is described | [ZK p.159] |
| Export | .xls, PDF, CSV, .txt | [ZK p.159] |
| Scheduled export of punches | Template built by dragging fields; Excel / CSV / Txt; daily, weekly, monthly or by interval; to folder, e-mail or FTP | [ZK p.249–253] |
| Scheduled export of reports | Report type plus saved template; Excel / CSV / Txt | [ZK p.254–255] |
| Payroll | Built-in module: formulas for overtime, exception and leave pay codes; loans, advances, reimbursements; salary calculation | [ZK p.182–196] |
| Integration | Middleware table and API request log in the manual; reseller cites a built-in API for HR/ERP | [ZK p.256–258], [ZK9] |

Not found in the 8.0.5 manual: Total Punches, Break Time (as a report), Abnormal, Multiple Transaction, Daily Attendance / Details / Summary / Status, Monthly Basic Status, Monthly Status Summary, Monthly Overtime Summary, Employee Summary, Leave Summary, Department Summary, Yearly Summary, Staff Summary. They may exist in other versions; I could not confirm it.

### 1.6 Symbols and colours

| Item | Detail | Source |
|---|---|---|
| Mechanism | Each pay code has an editable Symbol, colour and display order; Monthly Status "uses symbols or digits or the combination" | [ZK p.93–94, 159] |
| Visible defaults | P Regular, L Late In, E Early Out, A Absence; OT and leave codes show no symbol | [ZK p.92 screenshot] |
| Colours | Set per pay code, weekend day, holiday and timetable | [ZK p.94, 98, 109, 153] |
| Fixed codes (14 of 20 visible; text says 19) | Duration, Duty Duration, Total Hrs, Worked Hrs, Actual Worked Hrs, Break Duration, Break Total Hrs, Break Hrs, Actual Break Hrs, Approval Hrs, Early In, Late Out, Unschedule, Remaining | [ZK p.94 screenshot] |

### 1.7 Mobile check-in

| Item | Detail | Source |
|---|---|---|
| Access | App enabled per employee; login with employee ID and self-service password; admin sees client ID and device token | [ZK p.40, 80] |
| Geo-fence | Named GPS location on Google Map; assigned per employee or department with a distance in metres and a validity period; several locations allowed; out-of-range punch is refused with a prompt | [ZK p.85–89] |
| Punch requirements | Capture (photo must be uploaded), Work Code, Punch State; all "No" in the screenshot | [ZK p.101] |
| Session control | Force Offline for a user active on several phones; disable or delete account | [ZK p.81–82] |
| ZKBio Time 9.5 | "Geofencing Mobile Punches", "Multiple Level Approval", "WhatsApp Notification", "Leave Balance Management", roster | [ZK9] |
| Mock-location detection, device binding, liveness | Not found | — |

## 2. Hikvision HikCentral Professional

### 2.1 Scheduling model

| Element | Detail | Source |
|---|---|---|
| Chain | Attendance group → timetable (work and break) → shift → schedule → approval flow → records → reports | [H-FLOWCHART] |
| Timetable types | Normal shift and Flexible shift; an older support article calls the second "Man-Hour Shift" | [H-TT], [H-FLEX], [H-US] |
| Normal timetable | Scheduled Work Time; Valid Check-In and Check-Out Periods (cross-day allowed); Min. Work Hours (below it = absent); Flexible Mode: "Allow Late/Early Leave" or "Flexible Period"; break timetables; own absence rule; "Count Timetable as Overtime" | [H-TT] |
| Flexible timetable | Valid Check-In/Out Period; Min. Work Hours; Latest Check-In Time (later = Late); break; absence; overtime | [H-FLEX] |
| Shift | Repeats by Week (1–52), Day (1–31) or Month (1–12); several non-overlapping timetables per day for Normal; up to 8 timetables per shift; holidays on which the shift is not effective | [H-SHIFT] |
| Schedule targets | Department, attendance group, person, temporary | [H-SCHED] |
| Priority | Person schedule above department schedule; temporary schedule above all others | [H-PSCHED], [H-TEMP] |
| Schedule options | Effective period; several shifts; Check-In Not Required; Check-Out Not Required; Effective for Overtime; Attendance Check Points | [H-PSCHED] |
| Temporary schedule | Person(s) + timetable(s) + clicked calendar dates; "Restore to Initial Schedule" | [H-TEMP] |

### 2.2 Rule parameters

| Parameter | Detail | Source |
|---|---|---|
| Rule scope | Global, Department, Attendance Group; group above department above global | [H-RULE] |
| No check-in | Mark as Absent, or Late with a fixed "Late Duration" (example 60 min) | [H-ABS] |
| Late becomes absent | "Absent If Check-In Late" with a "Late for" threshold | [H-ABS] |
| No check-out / early | Mirror options: Absent or Early Leave with fixed duration; "Absent If Check-Out Early" | [H-ABS] |
| Which punch | "First In & Last Out" or "Each Check-In/Out" with a Min. Interval to drop repeats | [H-CALC] |
| Day change | Day Change Time; example 08:00:00 | [H-CALC] |
| Break | Start, End, Earliest Allowable Start, Latest Allowable End; duration mode "Period" (fixed) or "Must Check" (actual) | [H-BRK] |
| Early or late return from break | Threshold by duration or time point; mark as overtime, late, early leave, absent or Normal | [H-BRK] |
| Break counted as work | "Count Break Time in Work Hours", checked by default | [H-TT] |
| Workday and weekend OT | "By Total Work Hours" or "By Time Points"; duration Fixed or Actual with a minimum threshold (example 60 min); early check-in threshold (example 30 min) | [H-OT] |
| OT levels | Several levels, each with a work hour rate | [H-OT], [H-PAY] |
| Holiday OT | Valid threshold, optional maximum, OT level per holiday | [H-OT] |
| OT outside the valid window | Optional, with a selectable level | [H-OT] |
| Units and rounding | Per pay code: minute / hour / day / HH:MM; Round Up / Nearest / Down; fixed codes allow a minimum of 1 or 0.5 | [H-PAY], [H-FIX] |
| Leave in results | Leave time shown as Normal, Leave or Absent | [H-LVCALC] |
| Device status | "Enable T&A Status on Device": keep or ignore the in/out key pressed on the terminal | [H-TT] |

### 2.3 Exceptions and approval

| Item | Detail | Source |
|---|---|---|
| Request types | Leave, Overtime, Check-In/Out Correction; mobile check-in/out is also routed through the flow | [H-SUBMIT], [H-FLOW] |
| Leave types | User-defined pay codes of type Leave; no built-in list documented | [H-PAY] |
| Leave rule | Optional day limit; "Auto Issue Annually" or "Issue All Days of Leave Once"; "Fixed Amount" or "Depends On Employment Years"; expiry; minimum days employed | [H-LVRULE] |
| Approval | Approval roles; separate flows for department, attendance group and person; several reviewer nodes in sequence, each with roles to notify | [H-APPR], [H-FLOW] |
| Self-service | Employees submit and track requests and view records in the Self-Service module | [H-EMP] |
| Business trip, shift swap, training | Not found | — |

### 2.4 Holidays

| Item | Detail | Source |
|---|---|---|
| Holiday | Regular or irregular holiday | [H-HOL] |
| Working holidays | "Holidays Requiring Attendance": treated as a normal weekday | [H-HOL] |
| Shift | A shift can list holidays on which it is not effective | [H-SHIFT] |
| Overtime | Holiday OT has its own threshold, cap and level | [H-OT] |

### 2.5 Reports

| Item | Detail | Source |
|---|---|---|
| Record views | Transaction; Time Card; Check In&Out Record; First & Last Access Report; Leave Record; Check In&Out Correction Record; Overtime Record | [H-REC] |
| Reports | Daily Report; Weekly Report; Monthly Report; Summary Report (person or department) | [H-REP] |
| Scheduled types | Department Attendance / Overtime Summary; Group Attendance / Overtime Summary; Time Card | [H-SEND] |
| Custom report | Move items from "Optional Fields" to "Selected Fields", drag to order, pick a sort rule; field list not published | [H-CUST] |
| Export | Excel, PDF, CSV; saved column layouts can be shared | [H-REP], [H-REC] |
| Scheduled delivery | Daily, weekly or monthly; Excel (TXT for Time Card); e-mail template, SFTP or local storage; selectable language | [H-SEND] |
| Cover | Company name and logo; date and time format | [H-DISP] |
| Payroll | Pay code "defines the attendance status and calculation codes for calculating the attendance statistics on the third-party system"; third-party database sync is a setup step | [H-PAY], [H-FLOWCHART] |

### 2.6 Symbols

Fixed codes have an editable symbol and colour ("different symbols indicate… late, absent, no schedule, holiday, etc."), and pay codes have a colour [H-FIX], [H-PAY]. The default symbols are not listed: not found.

### 2.7 Mobile check-in

| Item | Detail | Source |
|---|---|---|
| Geofence | Circle (maximum radius) or polygon drawn on a GIS map | [H-MOB] |
| Eligibility | Per person: "Allow Check-In/Out via Mobile Client" | [H-MOB] |
| Photo | "Taking Photo Required" | [H-MOB] |
| Approval | "Auto Approve Check-In/Out via Mobile Client"; otherwise it follows the approval flow | [H-MOB], [H-FLOW] |
| Fake-GPS, Wi-Fi/Bluetooth, device binding | Not found | — |

## 3. Suprema BioStar 2 TA

| Topic | Detail | Source |
|---|---|---|
| Chain | Time Code → Shift → Schedule Template → Rule → Schedule | [S-CRASH], [S-REP] |
| Time Code | Types: Attendance management, Overtime management, Leave management ("leaves, business trips, etc."); Time Rate multiplier; colour | [S-TC] |
| Shift types | Fixed (set times); Flexible (daily hours, start floats); Floating (arrival and departure flexible) | [S-SHIFT] |
| Shift fields | Day start time; "Allowed a day before/after time" (max 6 h); "First check-in & Last check-out"; segments with time code, Min. Duration, Grace, Rounding | [S-SHIFT] |
| Meal deduction | By Punch; Auto (deduction time after a minimum of hours worked); Fixed (start and end) | [S-SHIFT] |
| Break | By Punch with optional maximum minutes; or Fixed | [S-SHIFT] |
| Schedule template | Weekly or Daily (repeating cycle); weekend days; shifts cannot overlap | [S-TPL], [S-CRASH] |
| Rule | Overtime on a daily, weekly or monthly basis; a further rule after a set amount; maximum limit; weekend and holiday OT each with a time code; a Rule replaces the shift's own OT rules | [S-RULE] |
| Schedule | Rule, template (fixed once set), period, holiday schedule, users; temporary schedule per user per date | [S-SCHED] |
| Punch types | Check In, Check Out, Break Start, Break End, Meal Time Start, Meal Time End | [S-SET] |
| Corrections | Admin adds, changes or deletes punches in the report and adds an absence with a leave time code; changes are logged | [S-EDIT], [S-REP] |
| Approval workflow, self-service | Not found | — |
| Reports | Daily; Daily Summary; Individual (In/Out Only or All Punches); Individual Summary; Leave; Exception; Modified Punch Log History; Working alarm time | [S-REP], [S-API] |
| Exception values | NORMAL, ABSENCE, LATE_IN, EARLY_OUT, MISSING_PUNCH_IN, MISSING_PUNCH_OUT, MISSING_PUNCH_MEAL_START/END, MISSING_PUNCH_BREAK_START/END, MISSING_EVENT_TYPE, INSUFFICIENT_WORK_TIME | [S-API] |
| Columns | datetime, userName, userId, userGroupName, shift, leave, inTime, outTime, exceptionForView, normalRegular, normalOvertime, totalWorkTime, punchBreak, overBreak, mealTime, regularByTimeRate, overtimeByTimeRate | [S-API] |
| Customisation | Reorder or hide columns; period daily, weekly, monthly or custom | [S-REP] |
| Export and e-mail | CSV and PDF; automated e-mail only for the working alarm time report | [S-REP], [S-SET] |
| Symbols | Colour per time code; no letter codes documented | [S-TC] |
| Mobile GPS punch, payroll export | Not found | — |

## 4. Anviz CrossChex

### 4.1 CrossChex Standard (desktop)

| Topic | Detail | Source |
|---|---|---|
| Chain | Time table → Shift (cycle 1–100; unit day / week / month; default shift for new staff) → Employee Scheduling | [A-STD p.29–32] |
| Scheduling modes | Not Scheduled (no late or early; time = out minus in); Normal Scheduling (shift plus dates); Intelligent scheduling (several timetables, system matches); Temporary | [A-STD p.33–35] |
| Time table fields | On and off duty time; Begin/End Clock-In; Begin/End Clock-Out; late and early allowance (example 5 min); Count As Work Day; Count As Work Time; Must C-In; Must C-Out; Free time; OT-time; may cross midnight | [A-STD p.29–30] |
| Must C-In / C-Out | If set and there is no punch and no leave, the day is absence; if not set, a single punch is still normal | [A-STD p.30] |
| Stat. Rule defaults | Work day = 480 min; shortest interval 10 min; longest 720 min; no clock-in = late 60 min; no clock-out = early 60 min; OT if in 30 min early or out 30 min late; weekend Saturday and Sunday | [A-STD p.23–24] |
| Cross-day | "Shift over two days": assign to the first or second day | [A-STD p.24] |
| Stat. Items | Normal, late, early, business leave, leave, absence, stay away, overtime, free overtime; unit day / hour / minute; rounding down / up / off; "Round at total"; "Accumulate by times" | [A-STD p.24] |
| Leave class | Name, colour, unit, minimum, rounding, symbol, "Count as leave"; examples annual and marriage leave | [A-STD p.26–27] |
| Holiday list | Name, start date, days; shown on reports | [A-STD p.28–29] |
| Corrections | Away On Business/Leave; Append Record; Group Late/Early | [A-STD p.70] |
| Analysis screens | Statistical Analysis; Search Results; Record Management; Scheduling Record Analysis; Analysis of Away/Leave; Attendance Statistics; Report Preview | [A-STD p.65–69] |
| Export | .txt, .csv, .xls with chosen fields; automatic download and text export for ERP | [A-STD p.22, 64] |
| Symbols | Each stat item and leave class has an editable 2-byte symbol; defaults not shown | [A-STD p.24, 27] |
| Approval workflow | Not found | — |

A search-result summary mentioned a "Monthly Attendance Report" and an "Attendance Exception Report" (late / early / absent / single punch); I did not open the source page, so treat those names as unverified. A vendor reply says scheduled Excel report export is not available, only automatic text download [A-EXP].

### 4.2 CrossChex Cloud and Lite

| Topic | Detail | Source |
|---|---|---|
| Cloud shift fields | Duty On/Off; late and early allowances in minutes; "Without punch out mark as" exception / leave early / absent; early-in and late-out as OT; break with threshold hours, window and duration; colour | [A-C9] |
| Cloud assignment | Per employee with dates; Saturday and Sunday excluded by default; option to exclude holidays | [A-C10] |
| Cloud requests | Manual Record, Leave Request, Overtime Request; Pending → Approve or Decline by supervisor or admin | [A-C7] |
| Cloud manual records | Owner, admins and supervisors "are not able to create or add manual records by themselves" | [A-C7] |
| Cloud app | "GPS remote punch"; timesheets, shifts, time-off requests; "geo-attendance clock-in" added in v1.1.10 (12/2024) | [A-APP] |
| Lite | Hourly mode (weekly total, OT rule, vacation and sick days, pay rates, round clock) or Monthly mode (fixed times, unpaid rest, OT offsets); reports export CSV / XLS | [A-LITE] |
| Cloud report names, anti-fraud | Not found (help centre returned 403) | — |

## 5. PERCo-Web "Учёт рабочего времени"

### 5.1 Schedule types

| Type | Meaning | Source |
|---|---|---|
| Недельный | Fixed intervals per weekday with fixed break times | [P p.7–8] |
| Сменный | Cycle of up to 30 days (default 3) from a start date; an interval may run past midnight | [P p.9] |
| По присутствию | No intervals; only time on site is counted | [P p.11] |
| С накоплением нарушений | Mandatory intervals plus break windows; the break may be taken any time in the window up to a set length | [P p.12–14] |
| С накоплением нарушений на основе баланса | Weekly hour norm within a permitted time range; optional core hours; time bank | [P p.15–18] |

One schedule is set on the employee card [P p.7]. A "временная замена" (temporary replacement) by another schedule is mentioned [P p.22]. Intervals are 15 min to 24 h, cannot overlap, and are marked start of shift, intermediate, end of shift or full shift [P p.5].

### 5.2 Rule parameters (per schedule)

| Parameter | Meaning | Source |
|---|---|---|
| Не учитывать праздники | Holidays are treated as working days | [P p.8] |
| Учитывать только первый вход и последний выход | Exits during the day are ignored | [P p.8] |
| Разрешить опоздание / уход раньше не более чем на… | Grace; beyond it only a justification document clears the violation | [P p.8] |
| Не учитывать нарушения менее чем на… | Daily total of violations below this is ignored | [P p.8] |
| Не учитывать переработку менее чем на… | Daily overwork below this is ignored | [P p.8] |
| Продолжительность перерывов, включая обед | Always deducted even if unused; any excess is a violation | [P p.13] |
| Количество часов в неделю, включая перерывы | Weekly norm; example 45 h = 40 work + 5 breaks | [P p.16–17] |
| Допустимое время работы с… по… | Permitted presence window; example 07:00–20:00 | [P p.16–17] |
| Считать опозданием приход позже… / уходом раньше… | Optional core-hours boundaries | [P p.16] |
| Максимальный положительный баланс за месяц | Time-bank cap | [P p.16] |
| Вечернее / ночное время | Global evening and night ranges for premium pay | [P p.3] |
| Задолженность / Непогашаемая задолженность | Debt inside tolerances can be worked off; outside them only a document clears it | [P p.9, 22] |
| Регистрирующие помещения | Rooms counted as work time and rooms counted as non-work (break) time | [P p.6] |

### 5.3 Exceptions, holidays, reports, codes

| Topic | Detail | Source |
|---|---|---|
| Violations | Неявка, опоздание, выход в течение рабочего дня, уход раньше | [P p.20] |
| Document classes | Оправдательные; Сверхурочные; Объяснительные (reasons the employee picks on the CR11 terminal) | [P p.23] |
| Document type settings | Numeric and letter code; "Добавить к рабочему времени" Нет / Добавлять; counting in working days or calendar days with or without holidays; overtime on holidays and weekends | [P p.24–25] |
| Default document types | Those "по умолчанию используемых при составлении Табеля"; not enumerated | [P p.23–24] |
| Corrections | A day with an unpaired entry or exit is flagged "Требуется корректировка проходов"; operator excludes passes, adds documents, recalculates | [P p.20–22] |
| Approval workflow, self-service, mobile | Not found | — |
| Holidays | "Праздничные дни" list in the standard package; per-schedule ignore flag; document day-count modes | [P p.8, 24] |
| Журнал отработанного времени | Columns: Присутствие, Рабочее время, Отсутствие, Задолженность, Непогашаемая задолженность, Работа в ночное время, Переработка, Баланс отработанного времени, documents with and without added time, График работы, Ошибки | [P p.21–22] |
| Табель Т-13 | Per department per month; whole month, first half, second half or a period; minutes or rounded hours; option to split cross-midnight shifts; Excel download | [P p.25–26] |
| Отчеты по дисциплине | Нарушители; Присутствующие на данный момент; Отсутствующие сегодня; Опоздавшие сегодня; Ушедшие раньше сегодня; Переработка | [P p.27] |
| Нарушители columns | Опозданий, Уходов раньше, Неявок, Нарушений в течение рабочего дня, Итого нарушений, Оправдательные документы | [P p.28] |
| Other sections | Отчет УРВ; Время присутствия; Выданные документы | [P p.29–33] |
| Export | Print; spreadsheet export; column chooser; 1С integration via module WM03 | [P p.4, 21] |

Т-12/Т-13 letter codes [T13]:

| Code | Meaning | Code | Meaning |
|---|---|---|---|
| Я | Day work | Б | Sick leave, paid |
| Н | Night work | Т | Sick leave, unpaid |
| РВ | Work on weekend or holiday | ПР | Unexcused absence |
| С | Overtime | В | Weekend or holiday |
| К | Business trip | ОВ | Extra paid day off |
| ПК | Training off the job | НВ | Extra unpaid day off |
| ОТ | Annual paid leave | НН | Absence, reason unknown |
| ОД | Additional paid leave | Г | State duties |
| У | Study leave, paid | РП | Downtime, employer's fault |
| Р | Maternity leave | НП | Downtime, nobody's fault |
| ОЖ | Childcare leave to age 3 | ВП | Downtime, employee's fault |
| ДО | Unpaid leave by permission | НО / НБ | Suspension, paid / unpaid |

The source lists 36 codes (01–36). I supplied the code letters in the fetch prompt and the page returned the meanings, so check the table against the form itself before hard-coding it.

## 6. Synthesis

### (a) Common data model

All five share one skeleton. Raw punches (person, time, device or location, optional state such as in / out / break / overtime, optional work code, source: device, mobile or manual) are never the result. A timetable or time segment defines planned start and end, valid punch windows, grace, breaks and a day boundary. A shift arranges timetables on a day, week or month cycle. A schedule assigns a shift to a department, group or person for a date range, a temporary schedule overrides one date, and a fallback rule covers people with no schedule. Layered rule sets (global, department, group) hold the absence, overtime and rounding policy. Pay codes or time codes (regular, overtime tiers, leave types, exceptions, training) each carry a unit, rounding, multiplier, symbol and colour, and every computed minute lands in one. Approved documents (correction, leave, overtime, trip) are merged with punches when the day is calculated. Results are stored per person per day and re-calculated on demand; every report is a projection of those daily results or of the raw punches. [ZK p.92–162], [H-FLOWCHART], [S-TC], [A-STD p.23–34], [P p.20–25]

### (b) Merged rule parameters

| Parameter | Options seen | Documented value | Source |
|---|---|---|---|
| Rule scope | Global / department / group; most specific wins | — | [ZK p.104], [H-RULE] |
| Weekend days | Any two days | Saturday + Sunday | [ZK p.98], [A-STD p.24] |
| Valid check-in window | Start and end around planned start | 08:00–10:00 for 09:00 | [ZK p.108] |
| Valid check-out window | Start and end around planned end | 17:00–19:00 for 18:00 | [ZK p.108] |
| Check-in / check-out required | Yes or No, per timetable or schedule | Yes | [ZK p.112], [H-PSCHED] |
| Late / early grace | Minutes | 0 (ZK screenshot); 5 in examples | [ZK p.112], [A-STD p.30] |
| Flexible start | Shift whole day by a flexible period, or latest check-in | — | [H-TT], [H-FLEX] |
| Late or early becomes absent | Threshold in minutes | 100 | [ZK p.101], [H-ABS] |
| Missing check-in | Late for N min / absent / incomplete | Late, 60 min | [ZK p.101], [A-STD p.23], [H-ABS] |
| Missing check-out | Early for N min / absent / exception | Early leave, 60 min | [ZK p.101], [A-STD p.23], [A-C9] |
| Minimum work hours | Below it the day is absent | — | [H-TT] |
| Punch selection | First-in/last-out; each pair; odd-even; by punch state | First and last | [ZK p.99], [H-CALC] |
| Duplicate punch interval | Minutes | 1 | [ZK p.98] |
| Shortest / longest interval | Minutes | 10 / 720 | [A-STD p.23] |
| Day change time | Clock time | 00:00 | [ZK p.99], [H-CALC] |
| Cross-day shift | Max span; which day owns the hours | 3 days (ZK); first or second day (Anviz); split option (PERCo) | [ZK p.108], [A-STD p.24], [P p.26] |
| Break mode | Auto-deduct fixed / by punch / fixed window | — | [ZK p.105], [S-SHIFT], [H-BRK] |
| Break counted as work | Yes or No | Yes | [H-TT] |
| Over-long break | Late / early / absent / violation | — | [ZK p.107], [H-BRK], [P p.13] |
| Auto meal deduction | Deduct N after M hours worked | — | [S-SHIFT] |
| OT source | Calculated / approved only / approved first / lesser of both / off | — | [ZK p.100] |
| OT basis | Over total hours, or before/after time points | — | [H-OT] |
| OT minimum | Minutes before or after shift | 30 | [A-STD p.23], [ZK p.111] |
| OT cap | Per timetable, day or holiday | — | [ZK p.112], [H-OT], [S-RULE] |
| OT levels | 3 tiers by hours, each with its own code and rate | — | [ZK p.99–100], [H-OT] |
| Weekly / monthly OT | Threshold over the period | — | [ZK p.120], [S-RULE] |
| Weekend / holiday OT | Own tiers or code | — | [ZK p.100], [H-OT], [S-RULE] |
| Rounding | Up / down / nearest with a minimum unit, per code | Round off, 0.1 h | [ZK p.94], [H-PAY] |
| Work-day length | Minutes per day for conversion | 480 | [A-STD p.23] |
| Night / evening hours | Global ranges | — | [P p.3] |
| Time bank | Maximum positive monthly balance | — | [P p.16] |
| Unscheduled-day rule | Max hours and pairing rule | 24 h | [ZK p.98–99] |
| Leave over rest days | Deduct or not | Not deducted | [ZK p.146] |

### (c) Merged report types

| Report | Definition | Seen as |
|---|---|---|
| Raw transactions | Every punch with time, device and state | Transaction [ZK p.156], [H-REC] |
| Time card | A person's punches in day order | Time Card [ZK p.156], [H-REC] |
| First and last punch | Earliest and latest punch per day, any state | First & Last [ZK p.156], [H-REC] |
| First in, last out | Earliest valid check-in and latest valid check-out | First In Last Out [ZK p.156] |
| Paired punches | Consecutive in/out pairs with hours each | Paired Punch [ZK p.158] |
| Scheduled log | Punches matched to scheduled slots | Scheduled Log [ZK p.158] |
| Daily detail | Per person per day: schedule, in, out, worked, break, late, early, OT, leave, status | Total Time Card [ZK p.157]; Daily [S-REP], [H-REP] |
| Daily summary | Totals for one day across people | Daily Summary [S-REP] |
| Worked hours by code | Hours in each pay code | Worked Hrs. [ZK p.158] |
| Late | Late arrivals with minutes | Late In Report [ZK p.158]; Опоздавшие сегодня [P p.27] |
| Early leave | Early departures with minutes | Early Out Report [ZK p.158]; Ушедшие раньше [P p.27] |
| Absence | Absent days | Absent Report [ZK p.158]; Отсутствующие сегодня [P p.27] |
| Exceptions | All anomalies including missing punch and short hours | Exception [ZK p.158], [S-REP]; Нарушители [P p.27] |
| Overtime | OT by day, person and code | Overtime Report [ZK p.158], [H-REC]; Переработка [P p.27] |
| Leave | Leave records by type | Leave Report [ZK p.158], [S-REP], [H-REC] |
| Break time | Each break period and total | Multiple Break Time [ZK p.159] |
| Multi-segment hours | Each worked segment and total | Multiple Worked Hrs [ZK p.158] |
| Weekly hours / OT | Totals per week | [ZK p.159], [H-REP] |
| Monthly status sheet | Person × day grid of symbols with totals | Monthly Status [ZK p.159]; Табель Т-13 [P p.25] |
| Monthly check-in/out | Person × day grid of actual times | Monthly Check-in/out [ZK p.159] |
| Monthly hours / OT / absence | Monthly totals | [ZK p.159] |
| Person summary | Period totals per person | Employee Attendance [ZK p.159]; Individual Summary [S-REP] |
| Department / group summary | The same, aggregated | [ZK p.160], [H-SEND] |
| Leave balance | Entitlement, used, remaining | Leave Balance [ZK p.160] |
| Presence now | Who is on site | Присутствующие на данный момент [P p.27] |
| Balance and debt | Worked versus norm, with recoverable and non-recoverable debt | Журнал / Отчет УРВ [P p.22, 29] |
| Correction audit | Who changed which punch | Modified Punch Log History [S-REP]; Correction Record [H-REC] |
| Hours-threshold alert | People near or over a working-hours limit | Working alarm time [S-REP] |
| Custom report | User-picked fields, order and sort | [H-CUST]; field selection [ZK p.159], [S-REP] |

Delivery found across products: export to Excel, PDF, CSV and TXT [ZK p.159], [H-REP]; scheduled export to e-mail, FTP/SFTP or folder [ZK p.253], [H-SEND]; payroll via a built-in module [ZK p.182] or codes for a third-party system [H-PAY].

### (d) Merged exception and request types

| Type | Detail | Source |
|---|---|---|
| Punch correction | Forgotten punch; time, state, reason, attachment | [ZK p.133], [H-SUBMIT], [A-C7] |
| Leave | By type; with balance, accrual and carry-over | [ZK p.136, 144–150], [H-LVRULE] |
| Overtime request | Pre- or post-approval; can be the only source of OT | [ZK p.100, 140], [H-SUBMIT] |
| Business trip / official duty | A leave-type code or a manual log | [S-TC], [A-STD p.70], [ZK p.133] |
| Training | Own pay code type | [ZK p.142] |
| Shift change | Requested by the employee | [ZK p.144] |
| Temporary schedule | Admin override for a date | [ZK p.126], [H-TEMP], [S-SCHED] |
| Group late/early | Mass excuse for a group | [A-STD p.70] |
| Explanatory note | Reason chosen on the terminal | [P p.23] |
| Justification document | Clears a violation, with or without adding hours | [P p.24] |
| Mobile punch approval | Off-site punch awaiting approval | [H-MOB], [H-FLOW] |
| Workflow shape | Role-based nodes in sequence, scoped to own department or all, with notified roles; approve / reject / revoke | [ZK p.44–48], [H-FLOW] |

## 7. Not found

- Default symbols for HikCentral, BioStar and CrossChex monthly sheets; only BioTime's P / L / E / A and the Т-13 codes are documented.
- The four BioTime pay codes and six fixed codes on the second screenshot pages.
- Any documented anti-spoofing for mobile punches (mock GPS, device binding, liveness) in any product.
- Half-day leave as an explicit option; only units and minimum values (0.5) are documented [H-FIX], [A-STD p.27].
- Paid versus unpaid as a leave flag: BioTime and HikCentral model it through pay codes [ZK p.185], [H-PAY]; PERCo through "Добавить к рабочему времени" [P p.24].

## 8. Housekeeping

No repository was touched. The fetch tool saved the downloaded PDFs under the session's `tool-results` folder, and I extracted a few manual screenshots into `scratchpad/ta-research` to read the defaults.

## Sources

- [ZK] https://www.zkteco.com.ar/assets/pdf/BioTime-8.0_User-Manual_.pdf
- [ZK9] https://alnahar.net/zkteco-biotime-9-5/
- [ZKP] https://www.zkteco.com/en/ZKBio_Time
- [H-US] https://supportusa.hikvision.com/support/solutions/articles/17000120924-time-and-attendance-setup-on-hikcentral
- HikCentral help pages share the base `https://enpinfo.hikvision.com/hkwsen/unzip/20230830144955_12918_doc/` followed by:
  - [H-FLOWCHART] GUID-558054D1-0A7D-4D07-B9CA-7EB675434FA6.html
  - [H-TT] GUID-6E4A3479-16B1-42E8-9924-5B12646AAD79.html
  - [H-FLEX] GUID-03A95746-EC35-4362-9E08-7BF49B1A19CC.html
  - [H-BRK] GUID-7CB01851-9F04-4A5C-9891-23794755582D.html
  - [H-SHIFT] GUID-DEBDC69C-0CC3-43A1-9A9F-3E500F0CCE58.html
  - [H-SCHED] GUID-232E815B-0870-48B6-972D-B8842679F813.html
  - [H-PSCHED] GUID-FFA1BC77-97E3-46C2-B4A0-855DF50F6D96.html
  - [H-TEMP] GUID-2FA2F954-E67C-4380-8928-50061F562E94.html
  - [H-RULE] GUID-E5BC3C52-CF65-454A-90C9-1A9EC3913A77.html
  - [H-ABS] GUID-808B72B4-D3F9-4F3D-B955-C3D0BE1AB4B4.html
  - [H-OT] GUID-D6C8CE8C-A19F-4A03-8BC2-301B105ECF61.html
  - [H-CALC] GUID-898A5DAB-30D2-431E-92D7-0681599BFBD0.html
  - [H-HOL] GUID-2DA4D533-E4C0-4246-9B41-29964AA13F5B.html
  - [H-LVCALC] GUID-712530F9-30BD-46C2-B4DC-F6E2291A72BE.html
  - [H-PAY] GUID-B28F7CCA-3344-4FC9-8267-5A36FBE2E700.html
  - [H-FIX] GUID-8AD57D44-1C1F-468C-85B3-F0C1991F72E6.html
  - [H-LVRULE] GUID-C870C8B0-9EAF-4E11-AA16-24C360B85EA7.html
  - [H-MOB] GUID-547B4525-DDF2-4EE7-99A0-8CA99CCC5165.html
  - [H-APPR] GUID-BC90E62A-4B9D-40D7-9987-336A97AB36B4.html
  - [H-FLOW] GUID-682ECBEE-6D77-40F2-80E7-4710DB63374A.html
  - [H-EMP] GUID-A8E3AD66-D60F-4563-8285-3F6DE6681D55.html
  - [H-SUBMIT] GUID-CC96462F-EB5F-495D-A885-BA966D409E7D.html
  - [H-REC] GUID-A40FE706-5BBD-4C01-A70F-6A435223C84E.html
  - [H-REP] GUID-7FADF7CC-575C-4ED3-A8DB-0B830FC6A26F.html
  - [H-DISP] GUID-98BAA8BD-B5AB-4272-858D-56D1ECBBDF81.html
  - [H-SEND] GUID-006D96B1-AFB3-43FF-9A62-78409A9FA015.html
  - [H-CUST] GUID-3E4D57C9-5E76-4A1D-A049-5758D074D612.html
- [S-REP] https://docs.supremainc.com/en/platform/biostar_x/tna-report
- [S-TC] https://docs.supremainc.com/en/platform/biostar_x/tna-rule-shift-paycode
- [S-SHIFT] https://docs.supremainc.com/en/platform/biostar_x/tna-rule-shift-day
- [S-TPL] https://docs.supremainc.com/en/platform/biostar_x/tna-rule-shift-schedule
- [S-RULE] https://docs.supremainc.com/en/platform/biostar_x/tna-rule-shift-overtime
- [S-SCHED] https://docs.supremainc.com/en/platform/biostar_x/tna-rule-schedule
- [S-EDIT] https://docs.supremainc.com/en/platform/biostar_x/tna-report-edit
- [S-SET] https://docs.supremainc.com/en/platform/biostar_x/tna-settings
- [S-API] https://support.supremainc.com/en/support/solutions/articles/24000073530
- [S-CRASH] https://support.supremainc.com/en/support/solutions/articles/24000056661--biostar-2-biostar-2-ta-beginner-crash-course-
- [A-STD] https://www.anviz.com/file/download/927/647669_CrossChex_Standard_User_Manual_V1.0_EN.pdf
- [A-LITE] https://www.anviz.com/file/download/10285/CrossChexLiteUserGuideENV1.2.pdf
- [A-C7] https://community.anviz.com/t/crosschex-cloud-7-how-to-add-manual-records/163
- [A-C9] https://community.anviz.com/t/crosschex-cloud-9-how-to-add-fixed-working-shifts-break-function/400
- [A-C10] https://community.anviz.com/t/crosschex-cloud-10-how-to-schedule-and-assign-working-shifts/556
- [A-EXP] https://community.anviz.com/t/scheduled-attendance-report-export/1094
- [A-APP] https://apps.apple.com/app/id1638898641
- [P] https://www.perco.com/download/documentation/rus/WM-01_UsersGuide.pdf
- [T13] https://ppt.ru/amp/rabochee-vremia/zapolnenie-tabelya
