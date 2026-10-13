-- Direct HR records share the immutable request journal; no phone facts are created.
SET lock_timeout = '3s';
ALTER TABLE "mtm_hrm_requests" DROP CONSTRAINT "mtm_attendance_request_details_check";
ALTER TABLE "mtm_hrm_requests" ADD CONSTRAINT "mtm_attendance_request_details_check" CHECK (
  "attendanceDetails" IS NULL OR (
    jsonb_typeof("attendanceDetails") = 'object'
    AND "attendanceDetails"->>'version' = '1'
    AND "attendanceDetails"->>'unit' IN ('DAYS', 'HOURS')
    AND "attendanceDetails"->>'kind' IN ('ANNUAL_LEAVE', 'SICK_LEAVE', 'TIME_OFF', 'HOURLY_ABSENCE', 'BUSINESS_TRIP', 'REMOTE_WORK', 'OVERTIME', 'TIME_CORRECTION', 'HR_RECORD')
    AND "attendanceDetails"->>'submissionHash' ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("attendanceDetails"->'attachmentIds') = 'array'
    AND jsonb_array_length("attendanceDetails"->'attachmentIds') <= 3
    AND (("attendanceDetails"->>'kind' = 'HR_RECORD') = ("attendanceDetails" ? 'recording'))
    AND ("attendanceDetails"->>'kind' <> 'HR_RECORD' OR (
      jsonb_typeof("attendanceDetails"->'recording') = 'object'
      AND length("attendanceDetails"->'recording'->>'userId') > 0
      AND "attendanceDetails"->'recording'->>'operationId' = "clientRequestId"
      AND "decidedByUserId" = "attendanceDetails"->'recording'->>'userId'
      AND "decidedAt" IS NOT NULL AND "status" IN ('APPROVED', 'CANCELLED')
      AND jsonb_array_length("attendanceDetails"->'attachmentIds') = 0
    ))
    AND (("type" = 'TIME_CORRECTION') = ("attendanceDetails"->>'kind' = 'TIME_CORRECTION'))
    AND ("type" <> 'TIME_CORRECTION' OR (
      "startDate" = "endDate" AND "requestedStartAt" IS NOT NULL AND "requestedEndAt" > "requestedStartAt"
      AND "attendanceDetails"->>'unit' = 'HOURS'
      AND "attendanceDetails"->'correctionBasis'->>'kind' IN ('MISSING', 'WORKDAY')
    ))
  ) IS TRUE
);
