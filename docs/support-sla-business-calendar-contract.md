# Support SLA business calendar v1

Status: draft implementation in the Support UX audit PR; independent acceptance pending. This contract is prospective and does not authorize deployment, enabling a production policy, or migration execution.

## Explicit selection and compatibility

An administrator selects Capture in an SLA policy and reviews the organization-wide active BusinessHours record (channelType=all): IANA timezone, weekly intervals and holiday overrides. Saving sends the reviewed source updatedAt. A changed source returns 409; reopen the form and review again. Capture saves a versioned immutable JSON snapshot, not a live reference. Later edits to BusinessHours do not change captured policies. Preserve retains the snapshot; Clear removes it from the policy. Disabling businessHoursOnly selects elapsed calendar time.

A legacy policy without a snapshot retains elapsed calendar-time arithmetic even when businessHoursOnly is true. No implicit capture occurs on create, read or ordinary edit. Both optional JSON columns have no default. The additive SQL migration only adds SlaPolicy.businessCalendar and Ticket.slaCalendarSnapshot; it contains no backfill. It has not been applied to a persistent database.

## Arithmetic and boundaries

The authoritative timezone is the captured IANA timezone, independent of the browser, server and ticket owner's timezone. Weekly windows use the existing BusinessHours HH:mm model, sorted non-overlapping half-open intervals [start,end). Overnight windows must be split across days; 24:00 is not accepted by this existing model. Breaks and nonworking days do not consume the target. A holiday's explicit intervals override the week; otherwise a closed holiday has no working time, while closed=false follows the week.

The engine counts actual elapsed milliseconds inside eligible windows, including offset changes. Ambiguous or nonexistent local interval boundaries are rejected with SLA_CALENDAR_BOUNDARY_INVALID; there is no silent offset choice or calendar-time fallback. Valid night-shift endpoints may cross a DST transition and count actual elapsed time. Capture validates current response/resolution targets; future DST boundary configurations can still fail closed when encountered and need administrator correction. The search horizon is 3660 calendar days; insufficient capacity returns SLA_CALENDAR_LIMIT. Target validation remains between one minute and 8760 hours, with resolution no earlier than response.

Example: Mon–Fri 09:00–18:00 Asia/Baku, Friday 16:00 plus four working hours = Monday 11:00. A closed Monday holiday changes that to Tuesday 11:00.

## Anchors, pauses and reopening

Ticket creation uses the existing resolver anchor (now). A matched working policy stores its snapshot alongside the calculated due timestamps. A matched elapsed policy stores a null snapshot. No policy still returns the existing empty result.

Customer-reply reopening already invokes the resolver and recalculates the new SLA window; its existing first-response behavior is preserved. Manual status reopening currently preserves deadlines and continues to do so. This change does not unify those separate lifecycle contracts.

Waiting status does not pause the current ticket or milestone clocks. Suspended entitlements affect eligibility for new work, not historical clocks. The pure arithmetic helper can exclude explicit completed pause intervals supplied by a caller; no new status-driven pause/resume writer or UI is introduced.

New entitlement milestones use the entitlement's captured SLA policy calendar and retain that snapshot in existing milestone metadata. Existing ticket and milestone deadlines, events and snapshots are never rewritten by policy or source-calendar edits.

## Evidence and remaining acceptance

Unit behavior coverage includes weekends, holidays, breaks, fractional targets, interval boundaries, explicit pauses, spring/fall DST, invalid local boundaries, immutable inputs, long targets and legacy resolver behavior. API tests cover tenant-specific capture and source-version conflicts. These are not proof of physical PostgreSQL transactions or browser behavior.

Before release: generate Prisma client on an isolated hosted Linux runner; run required typecheck gates and build; validate additive migration against a disposable database; verify creation/reopen/policy edits preserve historical deadlines; verify macro transaction rollback/concurrency separately; perform independent browser acceptance at the exact candidate SHA. Draft skipped gates are NOT RUN, not PASS.
