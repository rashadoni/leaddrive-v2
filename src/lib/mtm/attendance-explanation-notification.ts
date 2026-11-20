/**
 * The bell's notice that an employee wrote an explanation (late or absent).
 * Client-safe: the bell imports these, the store writes them.
 *
 * Zeytun, 2026-11-20: Ayshan asked the owner why he was late, he answered in
 * the app, and nothing showed in her bell — the row was written, but the bell
 * shows only entity types it knows (notifications/taxonomy.ts), and this one
 * had never been added. A new notice type goes into ENTITY_TO_MODULE there.
 */
export const ATTENDANCE_EXPLANATION_NOTIFICATION_ENTITY = "mtm_attendance_explanation"
export const ATTENDANCE_EXPLANATION_NOTIFICATION_KIND = "mtm.attendanceExplanation.answered"
export const ATTENDANCE_EXPLANATION_NOTIFICATION_URL = "/mtm/attendance/explanations"
