import { withMtmAttendanceAuth } from "@/lib/mtm/with-attendance-auth"
import { attendanceRequestFailure, attendanceRequestResponse } from "@/lib/mtm/attendance-request-http"
import { AttendanceRequestError } from "@/lib/mtm/attendance-request-contract"
import { readAttendanceMonth } from "@/lib/mtm/attendance-month-store"
type MonthContext={params:Promise<{id:string}>}
export const GET=withMtmAttendanceAuth<MonthContext>("read",async(req,auth,ctx)=>{try{if(auth.principalType!=="session")throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_FORBIDDEN",403);const locale=req.nextUrl.searchParams.get("locale")??"az";if(!["az","ru","en"].includes(locale))throw new AttendanceRequestError("MTM_ATTENDANCE_MONTH_INVALID",400);return attendanceRequestResponse(await readAttendanceMonth({organizationId:auth.orgId,userId:auth.userId,principalType:auth.principalType??"api_key"},(await ctx.params).id,locale as "az"|"ru"|"en"))}catch(error){return attendanceRequestFailure(error)}})
